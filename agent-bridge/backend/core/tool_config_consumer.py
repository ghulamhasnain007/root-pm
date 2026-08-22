"""
core/tool_config_consumer.py — Handles tool-config.updated and
tool-config.removed events from Kafka, delegating to DiscordPlatformManager.
"""
from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from platforms.communication.discord_platform_manager import DiscordPlatformManager
    from core.config_events import ConfigEventConsumer

logger = logging.getLogger("agent_bridge.tool_config_consumer")


def setup_config_consumer(
    consumer: "ConfigEventConsumer",
    manager: "DiscordPlatformManager",
    loop: asyncio.AbstractEventLoop,
) -> None:
    """
    Wire the config event consumer to DiscordPlatformManager.

    IMPORTANT: consumer's handlers run inside ConfigEventConsumer's own
    background thread (see core/config_events.py's _consume_loop, a plain
    threading.Thread — not an asyncio task), which has no running event
    loop. Calling asyncio.create_task() from there raises "no running event
    loop" immediately, every time — every tool-config event would fail
    silently (swallowed by _dispatch's try/except) and never actually
    add/remove a connection. asyncio.run_coroutine_threadsafe(coro, loop)
    is the correct cross-thread bridge: it schedules the coroutine onto the
    given loop (the bot's main asyncio loop, passed in from
    server/bot/main.py) and is safe to call from any thread.
    """

    def handle_updated(event: dict) -> None:
        if event.get("toolId") == "discord":
            org_id = event.get("orgId")
            logger.info("Org %s: tool-config.updated — adding connection", org_id)
            asyncio.run_coroutine_threadsafe(manager.add_org(org_id), loop)

    def handle_removed(event: dict) -> None:
        if event.get("toolId") == "discord":
            org_id = event.get("orgId")
            logger.info("Org %s: tool-config.removed — removing connection", org_id)
            asyncio.run_coroutine_threadsafe(manager.remove_org(org_id), loop)

    consumer.on("tool-config.updated", handle_updated)
    consumer.on("tool-config.removed", handle_removed)
