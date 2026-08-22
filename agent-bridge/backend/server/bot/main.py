#!/usr/bin/env python3
"""
main.py — Agent Bridge bootstrap.
Reads config.json, instantiates platforms from the registry, wires the agent, starts the bot.

Usage:
    python main.py [--config path/to/config.json]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# ── Load .env before anything else ──────────────────────────────────────────
load_dotenv()

# ── Set up logging ───────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("agent_bridge")

# ── Register all platform adapters by importing them ────────────────────────
import platforms.communication.discord_platform  # noqa: F401
import platforms.communication.slack_platform    # noqa: F401
import platforms.pm.taiga_platform               # noqa: F401
import platforms.pm.jira_platform                # noqa: F401
import platforms.pm.linear_platform              # noqa: F401

from core.registry import PlatformRegistry
from agent.agent import AgentBridge, DualMemoryStore, ChannelMemoryStore
from core.auth_service_client import AuthServiceClient
from platforms.communication.discord_platform_manager import DiscordPlatformManager
from core.config_events import build_config_consumer_from_env
from core.tool_config_consumer import setup_config_consumer


DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[2] / "data" / "config.json"
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _resolve_config_path(path: str) -> Path:
    config_path = Path(path)
    if not config_path.is_absolute():
        config_path = PROJECT_ROOT / config_path
    return config_path


def _resolve_env(val):
    """Replace $VAR_NAME references with environment variable values."""
    if isinstance(val, str) and val.startswith("$"):
        env_val = os.environ.get(val[1:], "")
        return env_val if env_val else val
    if isinstance(val, dict):
        return {k: _resolve_env(v) for k, v in val.items()}
    if isinstance(val, list):
        return [_resolve_env(v) for v in val]
    return val


def load_config(path: str) -> dict:
    config_path = _resolve_config_path(path)
    if not config_path.exists():
        logger.error("Config file not found: %s", path)
        sys.exit(1)
    with open(config_path, encoding="utf-8") as f:
        raw = json.load(f)
    return _resolve_env(raw)


def _build_memory_store(cfg: dict):
    """
    Build the memory store based on configuration.
    Returns DualMemoryStore if Redis/MongoDB are available, else ChannelMemoryStore.
    """
    redis_url = cfg.get("redis", {}).get("url", "")
    mongo_uri = cfg.get("mongo", {}).get("uri", "")
    mongo_db_name = cfg.get("mongo", {}).get("database", "agent_bridge")

    # Allow env var overrides
    redis_url = os.environ.get("REDIS_URL", redis_url)
    mongo_uri = os.environ.get("MONGO_URI", mongo_uri)
    mongo_db_name = os.environ.get("MONGO_DATABASE", mongo_db_name)

    if not redis_url or not mongo_uri:
        logger.warning(
            "Redis or MongoDB not configured — using in-memory fallback. "
            "Set redis.url and mongo.uri in config or REDIS_URL/MONGO_URI env vars."
        )
        return ChannelMemoryStore(max_messages=30)

    try:
        import redis
        r = redis.Redis.from_url(redis_url, decode_responses=True)
        r.ping()
        logger.info("Redis connected: %s", redis_url)
    except Exception as e:
        logger.warning("Redis connection failed (%s) — using in-memory fallback", e)
        return ChannelMemoryStore(max_messages=30)

    try:
        import pymongo
        client = pymongo.MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        db = client[mongo_db_name]
        logger.info("MongoDB connected: %s (database: %s)", mongo_uri, mongo_db_name)
    except Exception as e:
        logger.warning("MongoDB connection failed (%s) — using in-memory fallback", e)
        return ChannelMemoryStore(max_messages=30)

    # Ensure indexes for efficient queries
    try:
        db.meetings.create_index("text_channel_id")
        db.meetings.create_index("project_key")
        db.meetings.create_index("ended_at")
        db.meetings.create_index([("consolidated", 1), ("consolidating", 1), ("ended_at", 1)])
        db.meetings.create_index("meeting_id", unique=True)
        db.project_context.create_index("_id")
        db.project_facts.create_index([("project_key", 1), ("superseded", 1)])
        db.meeting_chunks.create_index("meeting_id")
        db.meeting_chunks.create_index("channel_id")
        db.meeting_chunks.create_index([("project_key", 1), ("ended_at", -1)])
    except Exception as e:
        logger.warning("Failed to create MongoDB indexes: %s", e)

    embeddings = None
    try:
        from core.embeddings import EmbeddingProvider
        gemini_key = cfg.get("llm", {}).get("gemini_api_key", "") or os.environ.get("GEMINI_API_KEY", "")
        embedding_model = os.environ.get("EMBEDDING_MODEL", "models/text-embedding-004")
        embeddings = EmbeddingProvider(api_key=gemini_key, model=embedding_model)
        if embeddings.available:
            logger.info("Semantic memory search enabled (model: %s)", embedding_model)
    except Exception as e:
        logger.info("Semantic memory search unavailable: %s", e)

    return DualMemoryStore(
        redis_client=r,
        mongo_db=db,
        max_messages=cfg.get("redis", {}).get("max_history_per_channel", 50),
        history_ttl_seconds=cfg.get("redis", {}).get("history_ttl_days", 7) * 86400,
        meeting_ttl_seconds=cfg.get("redis", {}).get("meeting_ttl_hours", 24) * 3600,
        embeddings=embeddings,
        chunk_tokens=int(os.environ.get("MEMORY_CHUNK_TOKENS", "400")),
        chunk_overlap_tokens=int(os.environ.get("MEMORY_CHUNK_OVERLAP", "60")),
    )


async def main(config_path: str) -> None:
    cfg = load_config(config_path)

    # ── Optional: overlay Discord/Taiga credentials from auth-service ───────
    # Off by default (fully backward compatible with the existing
    # env-var/config.json flow). Set AUTH_SERVICE_URL to opt in — see
    # core/auth_service_client.py. This only overlays cfg before validation
    # runs below; everything downstream of this block is unchanged.
    auth_service_url = os.environ.get("AUTH_SERVICE_URL", "")
    if auth_service_url:
        from core.auth_service_client import AuthServiceClient, overlay_auth_service_credentials

        internal_key = os.environ.get("AUTH_SERVICE_INTERNAL_KEY", "")
        org_id = os.environ.get("ORG_ID", "default")
        if not internal_key:
            logger.error("AUTH_SERVICE_URL is set but AUTH_SERVICE_INTERNAL_KEY is missing — cannot fetch credentials.")
            sys.exit(1)
        cache_ttl = float(os.environ.get("AUTH_SERVICE_CACHE_TTL_SECONDS", "30"))
        client = AuthServiceClient(auth_service_url, internal_key, cache_ttl)
        try:
            overlay_auth_service_credentials(cfg, org_id, client)
        except RuntimeError as e:
            logger.error("Failed to fetch credentials from auth-service: %s", e)
            sys.exit(1)

    # ── Validate required keys ───────────────────────────────────────────────
    bot_token = cfg.get("discord", {}).get("bot_token", "")
    gemini_key = cfg.get("llm", {}).get("gemini_api_key", "")
    taiga_url = cfg.get("taiga", {}).get("url", "")

    if not bot_token or bot_token.startswith("$"):
        logger.error("Discord bot_token is missing. Set DISCORD_BOT_TOKEN env var or configure it in the dashboard.")
        sys.exit(1)
    if not gemini_key or gemini_key.startswith("$"):
        logger.error("Gemini API key is missing. Set GEMINI_API_KEY env var or configure it in the dashboard.")
        sys.exit(1)
    if not taiga_url or taiga_url.startswith("$"):
        logger.error("Taiga URL is missing. Set TAIGA_URL env var or configure it in the dashboard.")
        sys.exit(1)

    # ── Build channel_map in the format DiscordPlatform expects ─────────────
    # Config stores: channel_mappings = [{guild_id, channel_id, project_slug, active}, ...]
    # Discord adapter expects: channel_map = {guild_id: {channel_id: project_slug}}
    channel_map: dict = {}
    for mapping in cfg.get("channel_mappings", []):
        if not mapping.get("active", True):
            continue
        guild_id = str(mapping.get("guild_id", ""))
        channel_id = str(mapping.get("channel_id", ""))
        project_slug = mapping.get("project_slug", "")
        if guild_id and channel_id and project_slug:
            if guild_id not in channel_map:
                channel_map[guild_id] = {}
            channel_map[guild_id][channel_id] = project_slug

    # Build role_permissions in the format DiscordPlatform expects
    # Config stores: [{role_name, tier}, ...]
    # Discord adapter expects: {role_name: tier}
    role_perms: dict = {}
    for rp in cfg.get("role_permissions", []):
        if rp.get("role_name"):
            role_perms[rp["role_name"]] = rp["tier"]

    logger.info("Channel map: %s", channel_map)
    logger.info("Role permissions: %s", role_perms)

    # ── Instantiate communication platform ───────────────────────────────────
    comm_id = cfg.get("comm_platform", "discord")
    CommClass = PlatformRegistry.get_comm(comm_id)
    comm = CommClass()
    comm.configure({
        "bot_token":        bot_token,
        "trigger_role":     cfg.get("discord", {}).get("trigger_role", "FYP"),
        "channel_map":      channel_map,
        "role_permissions": role_perms,
    })

    # ── Instantiate PM platform ──────────────────────────────────────────────
    pm_id = cfg.get("pm_platform", "taiga")
    PMClass = PlatformRegistry.get_pm(pm_id)
    pm = PMClass()
    pm.configure({
        "url":               taiga_url,
        "username":          cfg.get("taiga", {}).get("username", ""),
        "password":          cfg.get("taiga", {}).get("password", ""),
        "context_cache_ttl": cfg.get("advanced", {}).get("context_cache_ttl", 60),
    })

    # ── Build memory store (Redis+MongoDB or in-memory fallback) ────────────
    memory_store = _build_memory_store(cfg)

    # ── Instantiate the agent bridge ─────────────────────────────────────────
    adv = cfg.get("advanced", {})
    bridge = AgentBridge(
        comm_platform      = comm,
        pm_platform        = pm,
        gemini_api_key     = gemini_key,
        agent_model        = cfg.get("llm", {}).get("agent_model", "gemini-2.5-flash"),
        classifier_model   = cfg.get("llm", {}).get("classifier_model", "gemini-2.5-flash"),
        max_iterations     = adv.get("max_iterations", 8),
        memory_max_tokens  = adv.get("memory_max_tokens", 2000),
        memory_store       = memory_store,
    )

    # ── Wire the message callback (single-org legacy path) ──────────────────
    comm.set_message_callback(bridge.handle)

    # ── Multi-org Discord connection manager ─────────────────────────────
    # IMPORTANT: set_message_callback(bridge.handle) MUST happen before
    # discover_and_connect()/setup_config_consumer() — DiscordPlatformManager
    # only applies the callback to orgs connected AFTER it's set (see
    # DiscordPlatformManager.set_message_callback's docstring). An earlier
    # version of this wiring built the manager and started connecting orgs
    # before `bridge` even existed, which meant every multi-org connection
    # ran with no message callback at all — bots would join Discord and
    # receive messages but never respond to any of them.
    auth_service_url = os.environ.get("AUTH_SERVICE_URL", "")
    internal_key = os.environ.get("AUTH_SERVICE_INTERNAL_KEY", "")
    if auth_service_url and internal_key:
        cache_ttl = float(os.environ.get("AUTH_SERVICE_CACHE_TTL_SECONDS", "30"))
        auth_client = AuthServiceClient(auth_service_url, internal_key, cache_ttl)

        # Status is mirrored to Redis so the (separate-process) FastAPI
        # config API can read it back — see routers/discord_connections.py.
        # Best-effort: if Redis isn't reachable, the manager still works
        # fine, it just has no cross-process status visibility.
        status_redis = None
        redis_url = os.environ.get("REDIS_URL", cfg.get("redis", {}).get("url", ""))
        if redis_url:
            try:
                import redis
                status_redis = redis.Redis.from_url(redis_url, decode_responses=True)
                status_redis.ping()
            except Exception as e:
                logger.warning("Discord connection status Redis unavailable (%s) — status won't be visible via the API", e)
                status_redis = None

        discord_manager = DiscordPlatformManager(auth_client, status_redis=status_redis)
        discord_manager.set_message_callback(bridge.handle)

        try:
            await discord_manager.discover_and_connect()
            logger.info("DiscordPlatformManager: %d org(s) connected", len(discord_manager.get_status()))
        except Exception as e:
            logger.warning("DiscordPlatformManager discovery failed: %s", e)

        # Wire config event consumer for live add/remove updates
        if os.environ.get("KAFKA_BROKERS"):
            config_consumer = build_config_consumer_from_env()
            if config_consumer:
                setup_config_consumer(config_consumer, discord_manager, asyncio.get_running_loop())
                config_consumer.start()
                logger.info("Config event consumer started")
    else:
        discord_manager = None
        logger.info("AUTH_SERVICE_URL not set — multi-org discovery disabled, using single-org fallback")

    # ── Kafka bridge (voice bot → Taiga sync + meeting memory) ──────────────
    # Runs the python-consumer in-process so it shares bridge._memory: meeting
    # transcripts injected by MeetingMemoryInjector land in the SAME
    # memory store the chat agent reads. Without this the consumer runs
    # standalone with its own memory and the chat agent never sees meetings.
    consumer_root = os.environ.get(
        "AGENT_BRIDGE_CONSUMER_ROOT",
        os.environ.get(
            "KAFKA_BRIDGE_ROOT",
            str(Path(__file__).resolve().parents[2] / "python-consumer"),
        ),
    )
    kafka_consumer = None
    if os.environ.get("KAFKA_BROKERS"):
        try:
            import importlib.util
            spec = importlib.util.spec_from_file_location(
                "kafka_bridge_main", os.path.join(consumer_root, "main.py"))
            mod = importlib.util.module_from_spec(spec)
            sys.modules["kafka_bridge_main"] = mod
            spec.loader.exec_module(mod)
            kafka_consumer = mod.start_kafka_bridge(memory_store=bridge._memory)
            if kafka_consumer:
                logger.info(
                    "Kafka bridge active — voice events sync to Taiga and "
                    "meeting transcripts are shared with the chat agent")
        except Exception as e:
            logger.warning("Could not start Kafka bridge: %s — continuing without it", e)
    else:
        logger.info("KAFKA_BROKERS not set — Kafka bridge disabled")

    # Detect memory store type for logging
    memory_type = "DualMemoryStore (Redis+MongoDB)" if isinstance(memory_store, DualMemoryStore) else "ChannelMemoryStore (in-memory)"

    logger.info("=" * 60)
    logger.info("Agent Bridge starting")
    logger.info("  Communication : %s", comm_id)
    logger.info("  PM platform   : %s", pm_id)
    logger.info("  Agent model   : %s", cfg.get("llm", {}).get("agent_model"))
    logger.info("  Classifier    : %s", cfg.get("llm", {}).get("classifier_model"))
    logger.info("  Channel maps  : %d mapping(s)", sum(len(v) for v in channel_map.values()))
    logger.info("  Max iterations: %d", adv.get("max_iterations", 8))
    logger.info("  Memory store  : %s", memory_type)
    logger.info("=" * 60)

    # ── Start the bot (blocks until disconnected) ────────────────────────────
    try:
        await comm.start()
    except KeyboardInterrupt:
        logger.info("Shutting down...")
    finally:
        if kafka_consumer:
            kafka_consumer.stop()
        await comm.stop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Agent Bridge Bot")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH),
        help="Path to config.json (default: backend/data/config.json)")
    args = parser.parse_args()
    asyncio.run(main(args.config))
