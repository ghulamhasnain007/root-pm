"""
core/auth_service_client.py — Client for auth-service's internal
(service-to-service) credential-fetch endpoint.

Mirrors scrum-master-ai/backend/src/integrations/store/AuthServiceClient.ts
— same endpoint shape, same short-TTL cache reasoning, same trust boundary
(X-Internal-Key header, not a user JWT — see auth-service's
http/plugins/internalAuth.ts for why these are deliberately different).

Uses `requests` (sync) rather than an async HTTP client to match this
codebase's existing convention for external calls (see
platforms/pm/taiga_platform.py) rather than introducing a second HTTP
client library for one new caller.
"""
from __future__ import annotations

import logging
import time
from typing import Any

import requests

logger = logging.getLogger("agent_bridge.auth_service_client")


class AuthServiceClient:
    def __init__(self, base_url: str, internal_service_key: str, cache_ttl_seconds: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.internal_service_key = internal_service_key
        self.cache_ttl_seconds = cache_ttl_seconds
        self._cache: dict[tuple[str, str], tuple[dict[str, Any] | None, float]] = {}

    def get_tool_credentials(self, org_id: str, tool_id: str) -> dict[str, Any] | None:
        """Fetch decrypted credentials for a tool, cached for
        cache_ttl_seconds. Returns None if the tool isn't configured for
        this org (not an error) — raises only on unexpected failures
        (wrong key, auth-service unreachable, 5xx)."""
        key = (org_id, tool_id)
        cached = self._cache.get(key)
        if cached and (time.monotonic() - cached[1]) < self.cache_ttl_seconds:
            return cached[0]

        url = f"{self.base_url}/internal/orgs/{org_id}/tools/{tool_id}/credentials"
        try:
            resp = requests.get(url, headers={"X-Internal-Key": self.internal_service_key}, timeout=5)
        except requests.RequestException as e:
            raise RuntimeError(f"auth-service unreachable while fetching {tool_id} credentials for org {org_id}: {e}") from e

        if resp.status_code == 200:
            credentials = resp.json().get("credentials")
        elif resp.status_code == 404:
            credentials = None
        else:
            raise RuntimeError(f"auth-service credential fetch failed: {resp.status_code} {resp.text[:200]}")

        self._cache[key] = (credentials, time.monotonic())
        return credentials

    def invalidate(self, org_id: str, tool_id: str) -> None:
        """Drop a cached entry immediately. Used once event-driven cache
        invalidation exists (auth-service publishing org.tool_updated over
        Kafka — not wired yet, see auth-service's ToolConfigEventPublisher);
        until then, credentials simply refresh within cache_ttl_seconds on
        their own."""
        self._cache.pop((org_id, tool_id), None)

    def list_orgs_for_tool(self, tool_id: str) -> list[dict[str, Any]]:
        """List orgs that have a given tool configured — used by
        DiscordPlatformManager at startup to discover which orgs to
        connect. Not cached (called once at startup / on explicit
        re-discovery, not a hot path like get_tool_credentials)."""
        url = f"{self.base_url}/internal/tools/{tool_id}/orgs"
        try:
            resp = requests.get(url, headers={"X-Internal-Key": self.internal_service_key}, timeout=5)
        except requests.RequestException as e:
            raise RuntimeError(f"auth-service unreachable while listing orgs for tool {tool_id}: {e}") from e

        if resp.status_code != 200:
            raise RuntimeError(f"auth-service org listing failed: {resp.status_code} {resp.text[:200]}")
        return resp.json().get("orgs", [])


def overlay_auth_service_credentials(cfg: dict, org_id: str, client: AuthServiceClient) -> dict:
    """
    Overlay Discord/Taiga credentials fetched from auth-service onto a
    loaded config dict, in place, and return it.

    Deliberately a pure function taking the client as a parameter (rather
    than reaching for a module-level singleton) so it's trivially testable
    with a fake client — no monkeypatching requests, no server bootstrap
    needed. Only overlays a tool's fields if auth-service actually has
    something configured for it (returns non-None); a tool not yet
    migrated to auth-service falls through to whatever load_config() /
    env vars already put in cfg, so migration can happen one tool at a
    time rather than all-or-nothing.
    """
    discord_creds = client.get_tool_credentials(org_id, "discord")
    bot_token = discord_creds and (discord_creds.get("bot_token") or discord_creds.get("botToken"))
    if bot_token:
        cfg.setdefault("discord", {})["bot_token"] = bot_token
        logger.info("Discord bot token sourced from auth-service for org %s", org_id)

    taiga_creds = client.get_tool_credentials(org_id, "taiga")
    if taiga_creds and taiga_creds.get("url"):
        taiga_cfg = cfg.setdefault("taiga", {})
        taiga_cfg["url"] = taiga_creds.get("url", taiga_cfg.get("url", ""))
        taiga_cfg["username"] = taiga_creds.get("username", taiga_cfg.get("username", ""))
        taiga_cfg["password"] = taiga_creds.get("password", taiga_cfg.get("password", ""))
        logger.info("Taiga credentials sourced from auth-service for org %s", org_id)

    return cfg
