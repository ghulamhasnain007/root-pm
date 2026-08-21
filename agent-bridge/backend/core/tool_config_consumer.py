"""
core/tool_config_consumer.py — Handles tool-config.updated and tool-config.removed
events from Kafka, delegating to DiscordPlatformManager.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from platforms.communication.discord_platform_manager import DiscordPlatformManager

logger = logging.getLogger("agent_bridge.tool_config_consumer")


def register_tool_config_handlers(
    manager: DiscordPlatformManager,
    auth_service_url: str,
    internal_key: str,
) -> None:
    """Register handlers for tool-config events on the ConfigEventConsumer."""
    from core.config_events import ConfigEventConsumer

    # We create a module-level consumer instance to register with
    # This will be called from main.py after building the manager
    def handle_updated(event: dict) -> None:
        if event.get("toolId") == "discord":
            logger.info("Org %s: tool-config.updated — adding connection", event.get("orgId"))
            import asyncio
            asyncio.create_task(manager.add_org(
                event["orgId"], auth_service_url, internal_key, {},
            ))

    def handle_removed(event: dict) -> None:
        if event.get("toolId") == "discord":
            logger.info("Org %s: tool-config.removed — removing connection", event.get("orgId"))
            import asyncio
            asyncio.create_task(manager.remove_org(event["orgId"]))

    # Store handlers for later registration
    register_tool_config_handlers._handlers = (handle_updated, handle_removed)  # type: ignore
    register_tool_config_handlers._manager = manager  # type: ignore


def setup_config_consumer(consumer: 'ConfigEventConsumer', manager: 'DiscordPlatformManager', auth_service_url: str, internal_key: str) -> None:
    """Wire config event consumer to DiscordPlatformManager."""
    def handle_updated(event: dict) -> None:
        if event.get("toolId") == "discord":
            logger.info("Org %s: tool-config.updated — adding connection", event.get("orgId"))
            import asyncio
            asyncio.create_task(manager.add_org(
                event["orgId"], auth_service_url, internal_key, {},
            ))

    def handle_removed(event: dict) -> None:
        if event.get("toolId") == "discord":
            logger.info("Org %s: tool-config.removed — removing connection", event.get("orgId"))
            import asyncio
            asyncio.create_task(manager.remove_org(event["orgId"]))

    consumer.on("tool-config.updated", handle_updated)
    consumer.on("tool-config.removed", handle_removed)
