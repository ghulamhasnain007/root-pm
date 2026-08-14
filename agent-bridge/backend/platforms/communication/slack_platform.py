"""platforms/communication/slack_platform.py — Slack stub (coming soon)."""
from __future__ import annotations
from typing import Any
from core.base import CommunicationPlatform, OutgoingMessage
from core.registry import comm_platform

@comm_platform
class SlackPlatform(CommunicationPlatform):
    platform_id = "slack"; display_name = "Slack"
    required_config_keys = ["bot_token", "signing_secret"]
    def configure(self, config: dict[str, Any]) -> None: raise NotImplementedError("Slack: coming soon")
    async def start(self) -> None: raise NotImplementedError
    async def stop(self) -> None: pass
    async def send_message(self, msg: OutgoingMessage) -> None: raise NotImplementedError
    def resolve_project_key(self, server_id: str, channel_id: str) -> str | None: return None
    def get_permission_tier(self, author_roles: list[str]) -> str: return "none"
