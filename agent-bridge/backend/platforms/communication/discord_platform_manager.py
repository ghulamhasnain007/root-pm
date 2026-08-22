"""
platforms/communication/discord_platform_manager.py — Manages N concurrent
Discord connections, one per org that has Discord configured.

Each org gets its own DiscordPlatform instance running as its own
asyncio.Task. Failure in one org's connection does not affect others.

Credential fetching reuses core.auth_service_client.AuthServiceClient (the
same client server/bot/main.py's single-org overlay path uses) rather than
a second, separately-implemented HTTP client — one way to talk to
auth-service in this codebase, not two, and it keeps this module on
`requests` instead of adding `httpx` as an undeclared second HTTP library.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from core.auth_service_client import AuthServiceClient
from platforms.communication.discord_platform import DiscordPlatform
from core.registry import PlatformRegistry

logger = logging.getLogger("agent_bridge.discord_manager")


class OrgPlatformEntry:
    """Tracks a single org's Discord connection."""

    def __init__(self, org_id: str, platform: DiscordPlatform | None, task: asyncio.Task | None):
        self.org_id = org_id
        self.platform = platform
        self.task = task
        self.status: str = "connecting"
        self.last_error: str | None = None
        self.connected_at: float | None = None


class DiscordPlatformManager:
    """
    Manages multiple DiscordPlatform instances, one per org.
    """

    def __init__(self, auth_client: AuthServiceClient, status_redis=None):
        self._platforms: dict[str, OrgPlatformEntry] = {}
        self._callback = None
        self._auth_client = auth_client
        # Optional — agent-bridge's bot process and its FastAPI config API
        # are separate processes (unlike scrum-master-ai, where one process
        # serves both the bot and its HTTP routes), so there's no in-memory
        # way for the API process to read this manager's status directly.
        # When a Redis client is provided, status is mirrored there on every
        # change and a FastAPI route (routers/discord_connections.py) reads
        # it back — same cross-process pattern this codebase already uses
        # for memory (see routers/memory.py's cached Redis client).
        self._status_redis = status_redis
        self._status_redis_key = "agent_bridge:discord_connections:status"

    def _set_status(self, org_id: str, status: str, last_error: str | None = None, connected_at: float | None = None) -> None:
        """Single place every status mutation goes through, so publishing to
        Redis (see _publish_status) can't be forgotten at one of the several
        call sites that change status."""
        entry = self._platforms.get(org_id)
        if not entry:
            return
        entry.status = status
        entry.last_error = last_error
        if connected_at is not None:
            entry.connected_at = connected_at
        self._publish_status()

    def _publish_status(self) -> None:
        if not self._status_redis:
            return
        try:
            import json
            self._status_redis.set(self._status_redis_key, json.dumps(self.get_status()))
        except Exception as e:
            logger.warning("Failed to publish connection status to Redis: %s", e)

    def set_message_callback(self, callback) -> None:
        """
        Sets the callback used for every org connected from this point
        forward. IMPORTANT: this does not retroactively update orgs already
        connected — call this BEFORE discover_and_connect()/add_org(), not
        after. (A prior version of this manager could be started before the
        real message handler existed, silently leaving every connected
        org's bot unable to respond to anything — see server/bot/main.py
        for where this is now sequenced correctly.)
        """
        self._callback = callback

    async def discover_and_connect(self) -> None:
        """Discover orgs with Discord configured and start connections."""
        orgs = await asyncio.to_thread(self._auth_client.list_orgs_for_tool, "discord")
        for org_info in orgs:
            await self.add_org(org_info["orgId"])

    async def add_org(self, org_id: str, config_overrides: dict[str, Any] | None = None) -> None:
        """
        Start a Discord connection for a specific org.

        Deliberately does NOT fall back to a shared env-var bot token if
        the auth-service credential fetch fails. See
        BotConnectionManager.addOrg (scrum-master-ai, TypeScript) for the
        full reasoning — same design, same reasoning, both sides: a shared
        fallback would mean transient auth-service unavailability makes
        multiple orgs silently share one bot identity, and Discord only
        allows one active gateway session per token, so their connections
        would repeatedly kick each other off. Failing this org's connection
        cleanly, isolated from every other org, is correct here.
        """
        if org_id in self._platforms:
            logger.warning("Org %s already has a Discord connection", org_id)
            return

        config_overrides = config_overrides or {}

        try:
            credentials = await asyncio.to_thread(
                self._auth_client.get_tool_credentials, org_id, "discord"
            )
        except RuntimeError as e:
            logger.error("Org %s: failed to fetch Discord credentials — %s", org_id, e)
            self._platforms[org_id] = OrgPlatformEntry(org_id, None, None)
            self._set_status(org_id, "failed", last_error=str(e))
            return

        bot_token = (credentials or {}).get("botToken") or (credentials or {}).get("bot_token")
        if not bot_token:
            logger.error("Org %s: no Discord bot token configured", org_id)
            self._platforms[org_id] = OrgPlatformEntry(org_id, None, None)
            self._set_status(org_id, "failed", last_error="No bot token configured for this org's Discord tool")
            return

        org_config = {
            "bot_token": bot_token,
            "trigger_role": config_overrides.get("trigger_role", "FYP"),
            "channel_map": config_overrides.get("channel_map", {}),
            "role_permissions": config_overrides.get("role_permissions", {}),
        }

        CommClass = PlatformRegistry.get_comm("discord")
        platform = CommClass()
        platform.configure(org_config)
        if self._callback:
            platform.set_message_callback(self._callback)
        else:
            logger.warning(
                "Org %s: connecting with no message callback set — incoming messages "
                "will not be routed to the agent. set_message_callback() must be called "
                "before discover_and_connect()/add_org().", org_id,
            )

        entry = OrgPlatformEntry(org_id, platform, None)
        self._platforms[org_id] = entry
        self._publish_status()  # reflect the new "connecting" entry immediately

        def _on_ready(entry=entry):
            # Fired from discord.py's event loop once the gateway connection
            # is actually established — see DiscordPlatform.set_ready_callback.
            # This, not start() returning, is what "connected" means: start()
            # blocks for the connection's entire lifetime and only returns on
            # disconnect.
            self._set_status(org_id, "connected", connected_at=time.time())
            logger.info("Org %s: Discord connection established", org_id)

        platform.set_ready_callback(_on_ready)
        entry.task = asyncio.create_task(self._run_platform(org_id, platform))
        logger.info("Org %s: Discord connection starting", org_id)

    async def remove_org(self, org_id: str) -> None:
        """Stop and remove a Discord connection for a specific org."""
        entry = self._platforms.get(org_id)
        if not entry:
            return

        # Publish the transitional "disconnecting" state before actually
        # popping the entry — _set_status looks entries up by org_id in
        # self._platforms, so it has to still be present when this runs.
        self._set_status(org_id, "disconnecting")

        if entry.platform:
            try:
                await entry.platform.stop()
            except Exception as e:
                logger.warning("Org %s: error stopping platform — %s", org_id, e)
        if entry.task:
            entry.task.cancel()

        del self._platforms[org_id]
        self._publish_status()  # reflect the org's removal
        logger.info("Org %s: Discord connection removed", org_id)

    def get_platform(self, org_id: str) -> DiscordPlatform | None:
        entry = self._platforms.get(org_id)
        return entry.platform if entry else None

    def get_status(self) -> list[dict]:
        return [
            {
                "orgId": entry.org_id,
                "status": entry.status,
                "lastError": entry.last_error,
                "connectedAt": entry.connected_at,
            }
            for entry in self._platforms.values()
        ]

    async def _run_platform(self, org_id: str, platform: DiscordPlatform) -> None:
        """Run a single org's Discord platform, with error isolation.
        Status transitions to 'connected' via the on_ready callback (see
        add_org), not here — start() blocks for the connection's entire
        lifetime and only returns once the connection ends, so setting
        status based on start() returning would mean it only ever flips at
        disconnect time, never while actually connected."""
        entry = self._platforms.get(org_id)
        try:
            await platform.start()
            # start() returned normally — the connection ended (stop() was
            # called, or discord.py's client closed on its own). Not an
            # error, but also not "connected" anymore.
            if entry and entry.status != "disconnecting":
                self._set_status(org_id, "disconnected")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Org %s: Discord connection failed — %s", org_id, e)
            if entry:
                self._set_status(org_id, "failed", last_error=str(e))
