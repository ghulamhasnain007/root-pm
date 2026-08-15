"""
agent_bridge_main_patch.py
──────────────────────────
SUPERSEDED — the Kafka bridge is now started in-process by
agent-bridge/backend/server/bot/main.py (search for "Kafka bridge (voice bot").

That implementation launches the python-consumer via importlib in the same
process as the Discord bot and passes bridge._memory so meeting transcripts
injected by MeetingMemoryInjector land in the SAME ChannelMemoryStore the
chat agent reads.

This file is kept only for history of the approach.
"""

# ── FULL REPLACEMENT agent-bridge/main.py ─────────────────────────────────────

from __future__ import annotations
import argparse
import asyncio
import json
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("agent_bridge")

# Register platform adapters
import platforms.communication.discord_platform   # noqa
import platforms.communication.slack_platform     # noqa
import platforms.pm.taiga_platform                # noqa
import platforms.pm.jira_platform                 # noqa
import platforms.pm.linear_platform               # noqa

from core.registry import PlatformRegistry
from agent.agent import AgentBridge


def _resolve_env(val):
    if isinstance(val, str) and val.startswith("$"):
        return os.environ.get(val[1:], val)
    if isinstance(val, dict):
        return {k: _resolve_env(v) for k, v in val.items()}
    if isinstance(val, list):
        return [_resolve_env(v) for v in val]
    return val


def load_config(path: str) -> dict:
    config_path = Path(path)
    if not config_path.exists():
        logger.error("Config file not found: %s", path)
        sys.exit(1)
    with open(config_path, encoding="utf-8") as f:
        return _resolve_env(json.load(f))


async def main(config_path: str) -> None:
    cfg = load_config(config_path)

    bot_token  = cfg.get("discord", {}).get("bot_token", "")
    gemini_key = cfg.get("llm", {}).get("gemini_api_key", "")
    taiga_url  = cfg.get("taiga", {}).get("url", "")

    for name, val in [("Discord bot_token", bot_token),
                      ("Gemini API key", gemini_key), ("Taiga URL", taiga_url)]:
        if not val or val.startswith("$"):
            logger.error("%s is missing.", name); sys.exit(1)

    # Build channel map {guild_id: {channel_id: project_slug}}
    channel_map: dict = {}
    for m in cfg.get("channel_mappings", []):
        if not m.get("active", True): continue
        g, c, p = str(m.get("guild_id","")), str(m.get("channel_id","")), m.get("project_slug","")
        if g and c and p:
            channel_map.setdefault(g, {})[c] = p

    role_perms = {r["role_name"]: r["tier"] for r in cfg.get("role_permissions", []) if r.get("role_name")}

    # Communication platform
    comm_id = cfg.get("comm_platform", "discord")
    comm = PlatformRegistry.get_comm(comm_id)()
    comm.configure({
        "bot_token":        bot_token,
        "trigger_role":     cfg.get("discord", {}).get("trigger_role", "FYP"),
        "channel_map":      channel_map,
        "role_permissions": role_perms,
    })

    # PM platform
    pm_id = cfg.get("pm_platform", "taiga")
    pm = PlatformRegistry.get_pm(pm_id)()
    pm.configure({
        "url":               taiga_url,
        "username":          cfg.get("taiga", {}).get("username", ""),
        "password":          cfg.get("taiga", {}).get("password", ""),
        "context_cache_ttl": cfg.get("advanced", {}).get("context_cache_ttl", 60),
    })

    adv = cfg.get("advanced", {})
    bridge = AgentBridge(
        comm_platform=comm, pm_platform=pm,
        gemini_api_key=gemini_key,
        agent_model=cfg.get("llm", {}).get("agent_model", "gemini-1.5-pro"),
        classifier_model=cfg.get("llm", {}).get("classifier_model", "gemini-1.5-flash"),
        max_iterations=adv.get("max_iterations", 8),
        memory_max_tokens=adv.get("memory_max_tokens", 2000),
    )

    # ── NEW: Start Kafka bridge (shares bridge._memory with agent) ─────────────
    kafka_consumer = None
    kafka_bridge_root = os.environ.get(
        "KAFKA_BRIDGE_ROOT",
        str(Path(__file__).parent.parent / "kafka-bridge" / "python-consumer"),
    )
    if kafka_bridge_root not in sys.path:
        sys.path.insert(0, kafka_bridge_root)
    if os.environ.get("KAFKA_BROKERS"):
        try:
            from main import start_kafka_bridge  # kafka-bridge/python-consumer/main.py
            kafka_consumer = start_kafka_bridge(memory_store=bridge._memory)
            if kafka_consumer:
                logger.info("Kafka bridge active — voice events will sync to Taiga + memory")
        except Exception as e:
            logger.warning("Could not start Kafka bridge: %s — continuing without it", e)
    else:
        logger.info("KAFKA_BROKERS not set — Kafka bridge disabled")

    comm.set_message_callback(bridge.handle)

    logger.info("=" * 60)
    logger.info("Agent Bridge starting  comm=%s  pm=%s", comm_id, pm_id)
    logger.info("Channel maps: %d mapping(s)", sum(len(v) for v in channel_map.values()))
    logger.info("Kafka bridge: %s", "active" if kafka_consumer else "disabled")
    logger.info("=" * 60)

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
    parser.add_argument("--config", default="backend/data/config.json")
    args = parser.parse_args()
    asyncio.run(main(args.config))
