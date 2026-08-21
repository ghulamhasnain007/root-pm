"""
platforms/communication/discord_platform_manager.py — Manages N concurrent Discord
connections, one per org that has Discord configured.

Each org gets its own DiscordPlatform instance running as its own asyncio.Task.
Failure in one org's connection does not affect others.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from platforms.communication.discord_platform import DiscordPlatform
from core.registry import PlatformRegistry

logger = logging.getLogger("agent_bridge.discord_manager")


class OrgPlatformEntry:
    """Tracks a single org's Discord connection."""

    def __init__(self, org_id: str, platform: DiscordPlatform, task: asyncio.Task):
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

    def __init__(self):
        self._platforms: dict[str, OrgPlatformEntry] = {}
        self._callback = None

    def set_message_callback(self, callback) -> None:
        self._callback = callback

    async def discover_and_connect(
        self,
        auth_service_url: str,
        internal_key: str,
        config_overrides: dict[str, Any] | None = None,
    ) -> None:
        """Discover orgs with Discord configured and start connections."""
        orgs = await self._fetch_orgs(auth_service_url, internal_key, "discord")
        for org_info in orgs:
            await self.add_org(
                org_info["orgId"],
                auth_service_url,
                internal_key,
                config_overrides or {},
            )

    async def add_org(
        self,
        org_id: str,
        auth_service_url: str,
        internal_key: str,
        config_overrides: dict[str, Any],
    ) -> None:
        """Start a Discord connection for a specific org."""
        if org_id in self._platforms:
            logger.warning("Org %s already has a Discord connection", org_id)
            return

        try:
            credentials = {}
            try:
                credentials = await self._fetch_credentials(auth_service_url, internal_key, org_id, "discord")
            except Exception:
                # Fallback to env vars — deprecated, will be removed in future release
                import os
                env_token = os.environ.get("DISCORD_BOT_TOKEN") or os.environ.get("BOT_TOKEN", "")
                if env_token:
                    logger.warning(
                        "DEPRECATED: Using env-var fallback for org %s. "
                        "Migrate to auth-service tool config: npx tsx scripts/migrate-to-org.ts",
                        org_id,
                    )
                    credentials = {
                        "bot_token": env_token,
                        "trigger_role": os.environ.get("DISCORD_TRIGGER_ROLE", "FYP"),
                    }

            bot_token = credentials.get("bot_token") or credentials.get("token", "")
            if not bot_token:
                raise ValueError("No bot token found in credentials")

            # Build config for this org's DiscordPlatform
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

            task = asyncio.create_task(self._run_platform(org_id, platform))
            entry = OrgPlatformEntry(org_id, platform, task)
            self._platforms[org_id] = entry
            logger.info("Org %s: Discord connection started", org_id)

        except Exception as e:
            logger.error("Org %s: failed to start Discord connection — %s", org_id, e)
            self._platforms[org_id] = OrgPlatformEntry(
                org_id,
                DiscordPlatform(),
                asyncio.create_task(asyncio.sleep(0)),
            )
            self._platforms[org_id].status = "failed"
            self._platforms[org_id].last_error = str(e)

    async def remove_org(self, org_id: str) -> None:
        """Stop and remove a Discord connection for a specific org."""
        entry = self._platforms.pop(org_id, None)
        if not entry:
            return

        entry.status = "disconnecting"
        try:
            await entry.platform.stop()
        except Exception as e:
            logger.warning("Org %s: error stopping platform — %s", org_id, e)
        entry.task.cancel()
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
        """Run a single org's Discord platform, with error isolation."""
        try:
            entry = self._platforms.get(org_id)
            if entry:
                entry.status = "connected"
                import time
                entry.connected_at = time.time()
            await platform.start()
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Org %s: Discord connection failed — %s", org_id, e)
            entry = self._platforms.get(org_id)
            if entry:
                entry.status = "failed"
                entry.last_error = str(e)

    async def _fetch_orgs(self, url: str, key: str, tool_id: str) -> list[dict]:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{url}/internal/tools/{tool_id}/orgs", headers={"X-Internal-Key": key})
            if resp.status_code == 404:
                return []
            resp.raise_for_status()
            return resp.json().get("orgs", [])

    async def _fetch_credentials(self, url: str, key: str, org_id: str, tool_id: str) -> dict:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{url}/internal/orgs/{org_id}/tools/{tool_id}/credentials",
                headers={"X-Internal-Key": key},
            )
            resp.raise_for_status()
            return resp.json().get("credentials", {})
