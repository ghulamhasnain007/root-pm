"""
platforms/communication/status.py — Per-org connection status endpoint for agent-bridge.
"""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from platforms.communication.discord_platform_manager import DiscordPlatformManager


def register_status_routes(app, manager: 'DiscordPlatformManager') -> None:
    """Register /status route on the Fastify-equivalent app (if agent-bridge has one)."""
    # agent-bridge doesn't have a Fastify-style HTTP server for routes.
    # Status is surfaced via the existing status mechanism or logged.
    pass


def get_status_dict(manager: 'DiscordPlatformManager') -> dict:
    """Return status as a dict for health check or logging."""
    return {"connections": manager.get_status()}
