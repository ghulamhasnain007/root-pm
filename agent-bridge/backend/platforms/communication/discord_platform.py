"""
platforms/communication/discord_platform.py — Full Discord adapter.
"""
from __future__ import annotations
import logging
from typing import Any
import discord
from core.base import CommunicationPlatform, IncomingMessage, OutgoingMessage
from core.registry import comm_platform

logger = logging.getLogger("agent_bridge.discord")

_DEFAULT_ROLE_TIERS = {
    "Project Manager": "admin",
    "Developer":       "write",
    "Viewer":          "read",
}

@comm_platform
class DiscordPlatform(CommunicationPlatform):
    platform_id    = "discord"
    display_name   = "Discord"
    required_config_keys = ["bot_token", "trigger_role", "channel_map", "role_permissions"]

    def __init__(self):
        self._config: dict[str, Any] = {}
        self._client: discord.Client | None = None
        self._message_callback = None
        self._ready_callback = None

    def set_ready_callback(self, callback) -> None:
        """Optional hook invoked once the Discord gateway connection is
        actually established (on_ready fires) — not when start() is called,
        since start() blocks for the connection's entire lifetime and only
        returns on disconnect. Used by DiscordPlatformManager to know when
        it's accurate to report an org's connection as 'connected' rather
        than inferring it from start() returning (which would mean the
        status only ever flips at the very end, on disconnect)."""
        self._ready_callback = callback

    def configure(self, config: dict[str, Any]) -> None:
        self._config = config
        intents = discord.Intents.default()
        intents.messages = True
        intents.message_content = True
        intents.members = True
        self._client = discord.Client(intents=intents)
        self._client.event(self.on_ready)
        self._client.event(self.on_message)
        logger.info("Discord platform configured")

    async def start(self) -> None:
        await self._client.start(self._config["bot_token"])

    async def stop(self) -> None:
        if self._client:
            await self._client.close()

    async def send_message(self, msg: OutgoingMessage) -> None:
        if not self._client:
            return
        try:
            channel = self._client.get_channel(int(msg.channel_id))
            if channel is None:
                logger.error("Channel %s not found", msg.channel_id)
                return
            # Discord max 2000 chars per message; split if needed
            content = str(msg.content)
            if len(content) <= 2000:
                await channel.send(content)
            else:
                # Send in chunks
                for i in range(0, len(content), 1900):
                    await channel.send(content[i:i+1900])
        except Exception as e:
            logger.error("send_message failed: %s", e)

    def resolve_project_key(self, server_id: str, channel_id: str) -> str | None:
        channel_map: dict = self._config.get("channel_map", {})
        guild_map = channel_map.get(str(server_id), {})
        return guild_map.get(str(channel_id))

    def get_permission_tier(self, author_roles: list[str]) -> str:
        role_perms: dict = {
            **_DEFAULT_ROLE_TIERS,
            **self._config.get("role_permissions", {}),
        }
        for role in author_roles:
            if role in role_perms:
                return role_perms[role]
        return "none"

    def set_message_callback(self, callback) -> None:
        self._message_callback = callback

    # ── Discord events ───────────────────────────────────────────────

    async def on_ready(self) -> None:
        logger.info("Discord bot online as %s (id=%s)", self._client.user, self._client.user.id)
        print(f"[Agent Bridge] Discord bot ready: {self._client.user} (id={self._client.user.id})")
        if self._ready_callback:
            self._ready_callback()

    async def on_message(self, message: discord.Message) -> None:
        logger.info(
            "Message received in %s/%s from %s: %s",
            getattr(message.guild, "id", "dm"),
            getattr(message.channel, "id", "unknown"),
            getattr(message.author, "display_name", getattr(message.author, "name", "unknown")),
            getattr(message, "content", "")[:120],
        )

        # Ignore bot's own messages
        if message.author == self._client.user:
            logger.info("Ignoring bot's own message")
            return

        bot_mentioned  = self._client.user.mentioned_in(message)
        trigger_role    = self._config.get("trigger_role", "").strip()
        author_roles    = [r.name for r in getattr(message.author, "roles", [])]
        mentioned_roles = [r.name for r in getattr(message, "role_mentions", [])]
        trigger_lower   = trigger_role.lower()
        role_triggered  = trigger_lower in [r.lower() for r in author_roles] if trigger_lower else False
        role_mentioned  = trigger_lower in [r.lower() for r in mentioned_roles] if trigger_lower else False

        if not bot_mentioned and not role_triggered and not role_mentioned:
            logger.info(
                "Ignoring message: bot_mentioned=%s role_triggered=%s role_mentioned=%s",
                bot_mentioned,
                role_triggered,
                role_mentioned,
            )
            return

        # Strip all bot/role mentions from the message text
        content = message.content
        for variant in (f"<@{self._client.user.id}>", f"<@!{self._client.user.id}>"):
            content = content.replace(variant, "")
        for role in getattr(message, "role_mentions", []):
            content = content.replace(f"<@&{role.id}>", "")
        content = content.strip()

        if not content:
            await message.channel.send("How can I help? Type a command like `create a task`, `list open tasks`, or `sprint status`.")
            return

        guild_id = str(message.guild.id) if message.guild else ""
        channel_id = str(message.channel.id)
        author_roles = [r.name for r in getattr(message.author, "roles", [])]

        incoming = IncomingMessage(
            platform            = self.platform_id,
            platform_message_id = str(message.id),
            channel_id          = channel_id,
            channel_name        = getattr(message.channel, "name", "unknown"),
            server_id           = guild_id,
            author_id           = str(message.author.id),
            author_name         = str(message.author.display_name),
            author_roles        = author_roles,
            content             = content,
            raw_content         = message.content,
        )

        if self._message_callback:
            async with message.channel.typing():
                try:
                    reply = await self._message_callback(incoming)
                    await self.send_message(reply)
                except Exception as e:
                    logger.exception("Error handling message")
                    await message.channel.send(f"⚠️ An error occurred: {e}")
