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


def build_bridge(memory_store=None):
    """
    Build and return (consumer, taiga_handler, memory_injector).
    Returns (None, None, None) if KAFKA_BROKERS is not set.
    """
    from bridge_kafka.bridge_consumer import build_consumer_from_env
    consumer = build_consumer_from_env()
    if consumer is None:
        return None, None, None

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
        consumer.on("task.closed",  taiga_handler.on_task_closed)
        logger.info("Taiga sync registered for project '%s'", project_slug)
    else:
        logger.warning("Taiga config incomplete — task sync disabled. "
                       "Set TAIGA_URL, TAIGA_USER, TAIGA_PASS, TAIGA_PROJECT_SLUG.")

    # ── Meeting memory injection ───────────────────────────────────────────────
    channel_map  = _parse_channel_map()
    inject_live  = os.environ.get("INJECT_LIVE_TRANSCRIPT", "false").lower() == "true"

    if memory_store is None:
        from agent.agent import ChannelMemoryStore
        memory_store = ChannelMemoryStore(max_messages=50)
        logger.info("Standalone mode — memory store is local to this process.")

    from memory.meeting_memory import MeetingMemoryInjector
    injector = MeetingMemoryInjector(
        memory_store=memory_store,
        channel_map=channel_map,
        inject_live_transcript=inject_live,
    )
    consumer.on("meeting.started",    injector.on_meeting_started)
    consumer.on("meeting.transcript", injector.on_transcript)
    consumer.on("meeting.ended",      injector.on_meeting_ended)
    logger.info("Meeting memory injector registered (live=%s, map=%s)", inject_live, channel_map)

    return consumer, taiga_handler, injector


def start_kafka_bridge(memory_store=None):
    """
    Called from agent-bridge/main.py to start the Kafka bridge inline.
    Returns the consumer (or None if Kafka not configured).
    """
    consumer, _, _ = build_bridge(memory_store=memory_store)
    if consumer:
        consumer.start()
        logger.info("Kafka bridge started (background thread)")
    return consumer


def main():
    logger.info("=" * 60)
    logger.info("Agent Bridge — Kafka Consumer (standalone)")
    logger.info("  AGENT_BRIDGE_ROOT: %s", AGENT_BRIDGE_ROOT)
    logger.info("=" * 60)

    consumer, _, _ = build_bridge()
    if consumer is None:
        logger.error("Cannot start — set KAFKA_BROKERS.")
        sys.exit(1)

    consumer.start()

    def _shutdown(sig, frame):
        logger.info("Shutting down (signal %s)", sig)
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
