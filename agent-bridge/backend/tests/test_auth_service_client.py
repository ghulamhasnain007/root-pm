"""
tests/test_auth_service_client.py — Tests for core/auth_service_client.py:
the internal credential-fetch client and the pure config-overlay function
used by server/bot/main.py's opt-in auth-service integration.
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.auth_service_client import AuthServiceClient, overlay_auth_service_credentials


class TestAuthServiceClient:
    @patch("core.auth_service_client.requests.get")
    def test_fetches_credentials_with_internal_key_header(self, mock_get):
        mock_get.return_value = MagicMock(status_code=200, json=lambda: {"credentials": {"botToken": "abc123"}})
        client = AuthServiceClient("http://auth-service:4000", "secret-key")

        creds = client.get_tool_credentials("org1", "discord")

        assert creds == {"botToken": "abc123"}
        call_args = mock_get.call_args
        assert call_args[0][0] == "http://auth-service:4000/internal/orgs/org1/tools/discord/credentials"
        assert call_args[1]["headers"]["X-Internal-Key"] == "secret-key"

    @patch("core.auth_service_client.requests.get")
    def test_returns_none_not_error_on_404(self, mock_get):
        mock_get.return_value = MagicMock(status_code=404)
        client = AuthServiceClient("http://auth-service:4000", "secret-key")
        assert client.get_tool_credentials("org1", "taiga") is None

    @patch("core.auth_service_client.requests.get")
    def test_raises_on_unexpected_status(self, mock_get):
        mock_get.return_value = MagicMock(status_code=401, text="Unauthorized")
        client = AuthServiceClient("http://auth-service:4000", "wrong-key")
        with pytest.raises(RuntimeError, match="401"):
            client.get_tool_credentials("org1", "discord")

    @patch("core.auth_service_client.requests.get")
    def test_raises_wrapped_error_when_unreachable(self, mock_get):
        import requests
        mock_get.side_effect = requests.ConnectionError("boom")
        client = AuthServiceClient("http://auth-service:4000", "secret-key")
        with pytest.raises(RuntimeError, match="unreachable"):
            client.get_tool_credentials("org1", "discord")

    @patch("core.auth_service_client.requests.get")
    def test_caches_within_ttl(self, mock_get):
        mock_get.return_value = MagicMock(status_code=200, json=lambda: {"credentials": {"botToken": "abc123"}})
        client = AuthServiceClient("http://auth-service:4000", "secret-key", cache_ttl_seconds=60)

        client.get_tool_credentials("org1", "discord")
        client.get_tool_credentials("org1", "discord")
        client.get_tool_credentials("org1", "discord")

        assert mock_get.call_count == 1

    @patch("core.auth_service_client.requests.get")
    def test_invalidate_forces_refetch(self, mock_get):
        mock_get.return_value = MagicMock(status_code=200, json=lambda: {"credentials": {"botToken": "abc123"}})
        client = AuthServiceClient("http://auth-service:4000", "secret-key", cache_ttl_seconds=60)

        client.get_tool_credentials("org1", "discord")
        client.invalidate("org1", "discord")
        client.get_tool_credentials("org1", "discord")

        assert mock_get.call_count == 2

    @patch("core.auth_service_client.requests.get")
    def test_separate_cache_per_org_and_tool(self, mock_get):
        mock_get.return_value = MagicMock(status_code=200, json=lambda: {"credentials": {"botToken": "abc123"}})
        client = AuthServiceClient("http://auth-service:4000", "secret-key", cache_ttl_seconds=60)

        client.get_tool_credentials("org1", "discord")
        client.get_tool_credentials("org2", "discord")
        client.get_tool_credentials("org1", "taiga")

        assert mock_get.call_count == 3


class TestOverlayAuthServiceCredentials:
    def test_overlays_discord_and_taiga_when_both_configured(self):
        client = MagicMock()
        client.get_tool_credentials.side_effect = lambda org_id, tool_id: {
            "discord": {"botToken": "new-discord-token"},
            "taiga": {"url": "https://taiga.example", "username": "bot", "password": "secret"},
        }.get(tool_id)

        cfg = {"discord": {"bot_token": "$DISCORD_BOT_TOKEN"}, "taiga": {"url": "$TAIGA_URL"}}
        result = overlay_auth_service_credentials(cfg, "org1", client)

        assert result["discord"]["bot_token"] == "new-discord-token"
        assert result["taiga"]["url"] == "https://taiga.example"
        assert result["taiga"]["username"] == "bot"
        assert result["taiga"]["password"] == "secret"

    def test_leaves_cfg_unchanged_for_tools_not_yet_migrated(self):
        """A tool not configured in auth-service (client returns None) must
        fall through to whatever was already in cfg — migration can happen
        one tool at a time, not all-or-nothing."""
        client = MagicMock()
        client.get_tool_credentials.return_value = None  # neither tool configured in auth-service

        cfg = {"discord": {"bot_token": "original-env-token"}, "taiga": {"url": "original-taiga-url"}}
        result = overlay_auth_service_credentials(cfg, "org1", client)

        assert result["discord"]["bot_token"] == "original-env-token"
        assert result["taiga"]["url"] == "original-taiga-url"

    def test_handles_missing_discord_taiga_keys_in_cfg(self):
        client = MagicMock()
        client.get_tool_credentials.side_effect = lambda org_id, tool_id: (
            {"botToken": "x"} if tool_id == "discord" else None
        )
        cfg: dict = {}  # no "discord" or "taiga" keys at all yet
        result = overlay_auth_service_credentials(cfg, "org1", client)
        assert result["discord"]["bot_token"] == "x"

    def test_partial_migration_only_taiga_configured_in_auth_service(self):
        client = MagicMock()
        client.get_tool_credentials.side_effect = lambda org_id, tool_id: (
            {"url": "https://taiga.example", "username": "u", "password": "p"} if tool_id == "taiga" else None
        )
        cfg = {"discord": {"bot_token": "still-from-env"}, "taiga": {"url": "old"}}
        result = overlay_auth_service_credentials(cfg, "org1", client)

        assert result["discord"]["bot_token"] == "still-from-env"  # untouched
        assert result["taiga"]["url"] == "https://taiga.example"    # overlaid
