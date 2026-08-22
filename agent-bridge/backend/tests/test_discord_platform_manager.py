"""
tests/test_discord_platform_manager.py — Tests for DiscordPlatformManager,
the multi-org Discord connection manager.

Uses a fake platform class (registered in place of the real DiscordPlatform
via PlatformRegistry) rather than the real discord.py client, so tests
don't attempt real network connections to Discord's gateway.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from platforms.communication.discord_platform_manager import DiscordPlatformManager


class FakeDiscordPlatform:
    """Stand-in for the real DiscordPlatform — no real discord.py client,
    no network calls, but exercises the same interface DiscordPlatformManager
    depends on (configure/set_message_callback/set_ready_callback/start/stop)."""

    instances: list["FakeDiscordPlatform"] = []

    def __init__(self):
        self.configured_with = None
        self.message_callback = None
        self.ready_callback = None
        self.started = False
        self.stopped = False
        self._ready_event = asyncio.Event()
        FakeDiscordPlatform.instances.append(self)

    def configure(self, config):
        self.configured_with = config

    def set_message_callback(self, cb):
        self.message_callback = cb

    def set_ready_callback(self, cb):
        self.ready_callback = cb

    async def start(self):
        self.started = True
        if self.ready_callback:
            self.ready_callback()
        await self._ready_event.wait()  # blocks like the real start() does, until stop()

    async def stop(self):
        self.stopped = True
        self._ready_event.set()


@pytest.fixture(autouse=True)
def _patch_registry(monkeypatch):
    FakeDiscordPlatform.instances = []
    monkeypatch.setattr(
        "platforms.communication.discord_platform_manager.PlatformRegistry.get_comm",
        lambda platform_id: FakeDiscordPlatform,
    )
    yield


def fake_client(credentials_by_org: dict, raise_for: set[str] | None = None) -> MagicMock:
    client = MagicMock()

    def get_tool_credentials(org_id, tool_id):
        if raise_for and org_id in raise_for:
            raise RuntimeError(f"auth-service unreachable for {org_id}")
        return credentials_by_org.get(org_id)

    client.get_tool_credentials.side_effect = get_tool_credentials
    return client


class TestAddOrg:
    @pytest.mark.asyncio
    async def test_connects_successfully_with_valid_credentials(self):
        client = fake_client({"org1": {"botToken": "org1-token"}})
        manager = DiscordPlatformManager(client)
        manager.set_message_callback(lambda msg: None)

        await manager.add_org("org1")
        await asyncio.sleep(0)  # let the connection task run to the ready callback

        status = manager.get_status()
        assert status == [{"orgId": "org1", "status": "connected", "lastError": None, "connectedAt": status[0]["connectedAt"]}]
        assert status[0]["connectedAt"] is not None
        assert FakeDiscordPlatform.instances[0].configured_with["bot_token"] == "org1-token"

    @pytest.mark.asyncio
    async def test_fails_cleanly_when_credentials_fetch_raises(self):
        client = fake_client({}, raise_for={"org1"})
        manager = DiscordPlatformManager(client)

        await manager.add_org("org1")  # must not raise

        assert manager.get_status() == [
            {"orgId": "org1", "status": "failed", "lastError": "auth-service unreachable for org1", "connectedAt": None}
        ]
        assert len(FakeDiscordPlatform.instances) == 0  # never even attempted to connect

    @pytest.mark.asyncio
    async def test_fails_cleanly_when_no_bot_token_in_credentials(self):
        client = fake_client({"org1": {"someOtherField": "x"}})
        manager = DiscordPlatformManager(client)

        await manager.add_org("org1")

        status = manager.get_status()
        assert status[0]["status"] == "failed"
        assert "bot token" in status[0]["lastError"].lower()

    @pytest.mark.asyncio
    async def test_does_not_fall_back_to_shared_env_token_on_failure(self, monkeypatch):
        """Regression test for the cross-tenant token-sharing bug: a
        transient auth-service failure must never cause this org's
        connection to silently use a shared/global env-var bot token."""
        monkeypatch.setenv("DISCORD_BOT_TOKEN", "shared-token-should-never-be-used")
        client = fake_client({}, raise_for={"org1"})
        manager = DiscordPlatformManager(client)

        await manager.add_org("org1")

        assert len(FakeDiscordPlatform.instances) == 0
        assert manager.get_status()[0]["status"] == "failed"

    @pytest.mark.asyncio
    async def test_one_org_failing_does_not_affect_another_already_connected(self):
        client = fake_client({"org-a": {"botToken": "token-a"}}, raise_for={"org-b"})
        manager = DiscordPlatformManager(client)
        manager.set_message_callback(lambda msg: None)

        await manager.add_org("org-a")
        await asyncio.sleep(0)
        await manager.add_org("org-b")

        statuses = {s["orgId"]: s["status"] for s in manager.get_status()}
        assert statuses["org-a"] == "connected"
        assert statuses["org-b"] == "failed"

    @pytest.mark.asyncio
    async def test_idempotent_add_org(self):
        client = fake_client({"org1": {"botToken": "org1-token"}})
        manager = DiscordPlatformManager(client)
        manager.set_message_callback(lambda msg: None)

        await manager.add_org("org1")
        await manager.add_org("org1")

        assert len(FakeDiscordPlatform.instances) == 1

    @pytest.mark.asyncio
    async def test_message_callback_is_wired_before_connecting(self):
        """Regression test: the callback set via set_message_callback()
        must actually reach the platform instance — this is what broke
        multi-org message routing entirely in an earlier version."""
        client = fake_client({"org1": {"botToken": "org1-token"}})
        manager = DiscordPlatformManager(client)

        def handler(msg):
            pass

        manager.set_message_callback(handler)
        await manager.add_org("org1")

        assert FakeDiscordPlatform.instances[0].message_callback is handler

    @pytest.mark.asyncio
    async def test_status_is_connecting_until_ready_fires(self):
        """Status must not read 'connected' before the gateway connection
        is actually established — regression test for setting status
        immediately/optimistically rather than on the ready callback."""
        client = fake_client({"org1": {"botToken": "org1-token"}})
        manager = DiscordPlatformManager(client)
        manager.set_message_callback(lambda msg: None)

        await manager.add_org("org1")
        # Before yielding control, the task hasn't run yet — status must
        # still be "connecting", not prematurely "connected".
        assert manager.get_status()[0]["status"] == "connecting"

        await asyncio.sleep(0)
        assert manager.get_status()[0]["status"] == "connected"


class TestRemoveOrg:
    @pytest.mark.asyncio
    async def test_stops_the_platform_and_removes_it(self):
        client = fake_client({"org1": {"botToken": "org1-token"}})
        manager = DiscordPlatformManager(client)
        manager.set_message_callback(lambda msg: None)
        await manager.add_org("org1")
        await asyncio.sleep(0)

        await manager.remove_org("org1")
        await asyncio.sleep(0)

        assert FakeDiscordPlatform.instances[0].stopped is True
        assert manager.get_status() == []
        assert manager.get_platform("org1") is None

    @pytest.mark.asyncio
    async def test_removing_unknown_org_is_a_safe_noop(self):
        client = fake_client({})
        manager = DiscordPlatformManager(client)
        await manager.remove_org("never-added")  # must not raise


class TestStatusPublishing:
    """agent-bridge's bot process and FastAPI config API are separate
    processes — status is mirrored to Redis so the API process can read it.
    See routers/discord_connections.py."""

    @pytest.mark.asyncio
    async def test_publishes_to_redis_on_connect(self):
        import json
        redis = MagicMock()
        client = fake_client({"org1": {"botToken": "org1-token"}})
        manager = DiscordPlatformManager(client, status_redis=redis)
        manager.set_message_callback(lambda msg: None)

        await manager.add_org("org1")
        await asyncio.sleep(0)

        assert redis.set.called
        last_call_value = redis.set.call_args_list[-1][0][1]
        published = json.loads(last_call_value)
        assert published == [{"orgId": "org1", "status": "connected", "lastError": None, "connectedAt": published[0]["connectedAt"]}]

    @pytest.mark.asyncio
    async def test_publishes_to_redis_on_removal(self):
        import json
        redis = MagicMock()
        client = fake_client({"org1": {"botToken": "org1-token"}})
        manager = DiscordPlatformManager(client, status_redis=redis)
        manager.set_message_callback(lambda msg: None)
        await manager.add_org("org1")
        await asyncio.sleep(0)

        await manager.remove_org("org1")

        last_call_value = redis.set.call_args_list[-1][0][1]
        assert json.loads(last_call_value) == []

    @pytest.mark.asyncio
    async def test_redis_failure_does_not_crash_the_manager(self):
        redis = MagicMock()
        redis.set.side_effect = ConnectionError("redis down")
        client = fake_client({"org1": {"botToken": "org1-token"}})
        manager = DiscordPlatformManager(client, status_redis=redis)
        manager.set_message_callback(lambda msg: None)

        await manager.add_org("org1")  # must not raise even though redis.set fails
        await asyncio.sleep(0)

        assert manager.get_status()[0]["status"] == "connected"

    @pytest.mark.asyncio
    async def test_no_redis_configured_is_fine(self):
        client = fake_client({"org1": {"botToken": "org1-token"}})
        manager = DiscordPlatformManager(client)  # status_redis defaults to None
        manager.set_message_callback(lambda msg: None)

        await manager.add_org("org1")  # must not raise
        await asyncio.sleep(0)
        assert manager.get_status()[0]["status"] == "connected"
