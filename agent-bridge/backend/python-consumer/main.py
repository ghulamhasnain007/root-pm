#!/usr/bin/env python3
"""
kafka-bridge/python-consumer/main.py
─────────────────────────────────────
Runs the Kafka→Taiga sync and meeting memory injection.
Can run standalone (python main.py) or be imported by agent-bridge/main.py
for single-process operation (start_kafka_bridge()).
"""
from __future__ import annotations
import logging
import os
import signal
import sys
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("kafka_bridge")

AGENT_BRIDGE_ROOT = os.environ.get(
    "AGENT_BRIDGE_ROOT",
    str(Path(__file__).parent.parent.parent / "agent-bridge"),
)
if AGENT_BRIDGE_ROOT not in sys.path:
    sys.path.insert(0, AGENT_BRIDGE_ROOT)

# Add consumer root itself so submodules resolve
_CONSUMER_ROOT = str(Path(__file__).parent)
if _CONSUMER_ROOT not in sys.path:
    sys.path.insert(0, _CONSUMER_ROOT)


def _parse_channel_map() -> dict[str, str]:
    raw = os.environ.get("VOICE_TO_TEXT_CHANNEL_MAP", "")
    result: dict[str, str] = {}
    for pair in raw.split(","):
        pair = pair.strip()
        if ":" in pair:
            voice, text = pair.split(":", 1)
            result[voice.strip()] = text.strip()
    if not result:
        logger.warning(
            "VOICE_TO_TEXT_CHANNEL_MAP not set — meeting transcripts will NOT be "
            "injected into agent memory. Format: voice_channel_id:text_channel_id"
        )
    return result


def _build_mongo_client():
    """Build a pymongo.MongoClient from env vars if configured."""
    mongo_uri = os.environ.get("MONGO_URI", "")
    mongo_db_name = os.environ.get("MONGO_DATABASE", "agent_bridge")
    if not mongo_uri:
        return None
    try:
        import pymongo
        client = pymongo.MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        db = client[mongo_db_name]
        logger.info("MongoDB connected for consolidation: %s", mongo_uri)
        return db
    except Exception as e:
        logger.warning("MongoDB not available for consolidation: %s", e)
        return None


def build_bridge(memory_store=None):
    """
    Build and return (consumer, taiga_handler, memory_injector, consolidation_worker).
    Returns (None, None, None, None) if KAFKA_BROKERS is not set.
    """
    from bridge_kafka.bridge_consumer import build_consumer_from_env
    consumer = build_consumer_from_env()
    if consumer is None:
        return None, None, None, None

    # ── Taiga sync ────────────────────────────────────────────────────────────
    import platforms.pm.taiga_platform  # noqa — self-registers
    from platforms.pm.taiga_platform import TaigaPlatform
    from taiga.taiga_sync import TaigaSyncHandler

    taiga_url    = os.environ.get("TAIGA_URL", "")
    taiga_user   = os.environ.get("TAIGA_USER", "")
    taiga_pass   = os.environ.get("TAIGA_PASS", "")
    project_slug = os.environ.get("TAIGA_PROJECT_SLUG", "")

    taiga_handler = None
    if all([taiga_url, taiga_user, taiga_pass, project_slug]):
        pm = TaigaPlatform()
        pm.configure({
            "url": taiga_url, "username": taiga_user, "password": taiga_pass,
            "context_cache_ttl": int(os.environ.get("CONTEXT_CACHE_TTL", "60")),
        })
        taiga_handler = TaigaSyncHandler(pm, project_slug)
        consumer.on("task.created", taiga_handler.on_task_created)
        consumer.on("task.updated", taiga_handler.on_task_updated)
        consumer.on("task.closed",  taiga_handler.on_task_closed)
        logger.info("Taiga sync registered for project '%s'", project_slug)
    else:
        logger.warning("Taiga config incomplete — task sync disabled. "
                       "Set TAIGA_URL, TAIGA_USER, TAIGA_PASS, TAIGA_PROJECT_SLUG.")

    # ── Shared embedding provider (optional semantic memory search) ────────────
    # Built once and threaded through both the live injector (so a fresh
    # meeting's transcript is searchable right away) and the consolidation
    # worker (so decisions/action items get embedded too). Degrades silently
    # to keyword/regex-only search if GEMINI_API_KEY is unset.
    embeddings = None
    try:
        from core.embeddings import EmbeddingProvider
        gemini_key_for_embeddings = os.environ.get("GEMINI_API_KEY", "")
        embedding_model = os.environ.get("EMBEDDING_MODEL", "models/text-embedding-004")
        embeddings = EmbeddingProvider(api_key=gemini_key_for_embeddings, model=embedding_model)
    except Exception as e:
        logger.info("Semantic memory search unavailable: %s", e)

    # ── Meeting memory injection ───────────────────────────────────────────────
    channel_map  = _parse_channel_map()
    inject_live  = os.environ.get("INJECT_LIVE_TRANSCRIPT", "false").lower() == "true"

    if memory_store is None:
        from agent.agent import ChannelMemoryStore
        memory_store = ChannelMemoryStore(max_messages=50)
        logger.info("Standalone mode — memory store is local to this process.")
    elif hasattr(memory_store, "_embeddings") and getattr(memory_store, "_embeddings", None) is None:
        # DualMemoryStore built elsewhere (e.g. agent-bridge/main.py) without
        # an embedding provider — attach the one we just built so semantic
        # search/remember_fact/recall_facts work end to end.
        memory_store._embeddings = embeddings

    project_key_map = _parse_channel_to_project_map()

    from memory.meeting_memory import MeetingMemoryInjector
    injector = MeetingMemoryInjector(
        memory_store=memory_store,
        channel_map=channel_map,
        inject_live_transcript=inject_live,
        project_key_map=project_key_map,
    )
    consumer.on("meeting.started",    injector.on_meeting_started)
    consumer.on("meeting.transcript", injector.on_transcript)
    consumer.on("meeting.ended",      injector.on_meeting_ended)
    logger.info("Meeting memory injector registered (live=%s, map=%s)", inject_live, channel_map)

    # ── Consolidation worker ──────────────────────────────────────────────────
    consolidation_worker = None
    # Use the memory_store's MongoDB connection if it's a DualMemoryStore
    mongo_db = None
    if hasattr(memory_store, "_mongo"):
        mongo_db = memory_store._mongo
    else:
        mongo_db = _build_mongo_client()

    if mongo_db is not None:
        _ensure_memory_indexes(mongo_db)
        try:
            from memory.consolidation import ConsolidationWorker
            from langchain_google_genai import ChatGoogleGenerativeAI

            gemini_key = os.environ.get("GEMINI_API_KEY", "")
            agent_model = os.environ.get("AGENT_MODEL", "gemini-2.5-flash")
            if gemini_key:
                llm = ChatGoogleGenerativeAI(
                    model=agent_model, google_api_key=gemini_key, temperature=0,
                )
                consolidation_worker = ConsolidationWorker(
                    mongo_db=mongo_db, llm=llm, embeddings=embeddings,
                )
                consolidation_worker.start()
            else:
                logger.warning("GEMINI_API_KEY not set — consolidation worker disabled")
        except Exception as e:
            logger.warning("Could not start consolidation worker: %s", e)

    return consumer, taiga_handler, injector, consolidation_worker


def _parse_channel_to_project_map() -> dict[str, str]:
    """
    Maps Discord text channel ID -> PM project key/slug, read from the same
    config the FastAPI dashboard writes (data/config.json's channel_mappings),
    so meetings get scoped by project_key rather than just channel_id — a
    decision made in #eng and #standup (both mapped to the same project)
    should be recallable from either channel.

    Falls back to TAIGA_PROJECT_SLUG env var for all channels when the app
    config isn't reachable (e.g. standalone consumer with no dashboard).
    """
    result: dict[str, str] = {}
    try:
        from core.store import get_config
        cfg = get_config()
        for mapping in getattr(cfg, "channel_mappings", []):
            if mapping.channel_id and mapping.project_slug:
                result[mapping.channel_id] = mapping.project_slug
    except Exception as e:
        logger.info("Could not load channel->project map from app config: %s", e)

    if not result:
        fallback_slug = os.environ.get("TAIGA_PROJECT_SLUG", "")
        if fallback_slug:
            logger.info("Using TAIGA_PROJECT_SLUG as the project key for all channels "
                        "(no channel_mappings configured).")
        result = _FallbackProjectMap(fallback_slug)  # type: ignore[assignment]
    return result


class _FallbackProjectMap(dict):
    """A dict subclass that returns the same fallback project_key for any
    channel_id key, instead of KeyError/None — used when no per-channel
    config exists yet but a single default project is configured via env."""

    def __init__(self, fallback: str):
        super().__init__()
        self._fallback = fallback

    def get(self, key, default=None):
        return self._fallback or default


def _ensure_memory_indexes(mongo_db) -> None:
    """Create indexes needed for memory queries to stay fast as data grows.
    Safe to call on every startup — create_index is idempotent."""
    try:
        mongo_db.meetings.create_index("text_channel_id")
        mongo_db.meetings.create_index("project_key")
        mongo_db.meetings.create_index([("consolidated", 1), ("consolidating", 1), ("ended_at", 1)])
        mongo_db.meeting_chunks.create_index("meeting_id")
        mongo_db.meeting_chunks.create_index("channel_id")
        mongo_db.meeting_chunks.create_index([("project_key", 1), ("ended_at", -1)])
        mongo_db.project_facts.create_index([("project_key", 1), ("superseded", 1)])
        logger.info("Memory collection indexes ensured.")
    except Exception as e:
        logger.warning("Failed to ensure memory indexes: %s", e)


def start_kafka_bridge(memory_store=None):
    """
    Called from agent-bridge/main.py to start the Kafka bridge inline.
    Returns the consumer (or None if Kafka not configured).
    """
    consumer, _, _, _ = build_bridge(memory_store=memory_store)
    if consumer:
        consumer.start()
        logger.info("Kafka bridge started (background thread)")
    return consumer


def main():
    logger.info("=" * 60)
    logger.info("Agent Bridge — Kafka Consumer (standalone)")
    logger.info("  AGENT_BRIDGE_ROOT: %s", AGENT_BRIDGE_ROOT)
    logger.info("=" * 60)

    consumer, _, _, consolidation_worker = build_bridge()
    if consumer is None:
        logger.error("Cannot start — set KAFKA_BROKERS.")
        sys.exit(1)

    consumer.start()

    def _shutdown(sig, frame):
        logger.info("Shutting down (signal %s)", sig)
        if consolidation_worker:
            consolidation_worker.stop()
        consumer.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT,  _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    logger.info("Kafka bridge running. Press Ctrl+C to stop.")
    import time
    while consumer._running:
        time.sleep(1)


if __name__ == "__main__":
    main()
