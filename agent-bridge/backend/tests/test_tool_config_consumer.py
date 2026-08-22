"""
tests/test_tool_config_consumer.py — Tests for core/tool_config_consumer.py.

The key regression to guard: consumer.on(...) handlers execute inside
ConfigEventConsumer's background threading.Thread (see
core/config_events.py's _consume_loop), which has no running asyncio event
loop. asyncio.create_task() from there raises "no running event loop"
immediately — this test calls the registered handler from a plain thread
(not the pytest-asyncio event loop thread) to prove the fix actually works
across threads, not just when accidentally called from the right one.
"""
from __future__ import annotations

import asyncio
import sys
import threading
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.tool_config_consumer import setup_config_consumer


def test_dead_duplicate_function_was_removed():
    """register_tool_config_handlers() was a broken, never-actually-wired
    duplicate of setup_config_consumer() left in an earlier version — it
    built handler closures but never called consumer.on(...), so nothing
    using it would ever have worked. Confirms it's gone, not just unused."""
    import core.tool_config_consumer as module
    assert not hasattr(module, "register_tool_config_handlers")


def test_handlers_registered_on_consumer():
    consumer = MagicMock()
    manager = MagicMock()
    loop = asyncio.new_event_loop()

    setup_config_consumer(consumer, manager, loop)

    registered_events = [call.args[0] for call in consumer.on.call_args_list]
    assert "tool-config.updated" in registered_events
    assert "tool-config.removed" in registered_events
    loop.close()


def test_handle_updated_schedules_add_org_across_threads():
    """Simulates the real deployment shape: the loop runs in one thread
    (the bot's main asyncio loop), the handler is invoked from a different
    thread (ConfigEventConsumer's background thread) — exactly how
    core/config_events.py actually calls these handlers."""
    consumer = MagicMock()
    manager = MagicMock()

    async def fake_add_org(org_id):
        return None
    manager.add_org = MagicMock(side_effect=lambda org_id: fake_add_org(org_id))

    loop = asyncio.new_event_loop()
    loop_thread = threading.Thread(target=loop.run_forever, daemon=True)
    loop_thread.start()

    try:
        setup_config_consumer(consumer, manager, loop)
        handle_updated = dict(
            (call.args[0], call.args[1]) for call in consumer.on.call_args_list
        )["tool-config.updated"]

        result_holder = {}

        def call_from_another_thread():
            try:
                handle_updated({"toolId": "discord", "orgId": "org1"})
                result_holder["ok"] = True
            except RuntimeError as e:
                result_holder["error"] = str(e)

        t = threading.Thread(target=call_from_another_thread)
        t.start()
        t.join(timeout=5)

        assert result_holder.get("ok") is True, (
            f"handler raised from a non-loop thread (the exact bug being fixed): "
            f"{result_holder.get('error')}"
        )

        # Give run_coroutine_threadsafe's scheduled coroutine a moment to
        # actually execute on the loop thread.
        import time
        time.sleep(0.2)
        manager.add_org.assert_called_once_with("org1")
    finally:
        loop.call_soon_threadsafe(loop.stop)
        loop_thread.join(timeout=2)
        loop.close()


def test_handle_removed_ignores_non_discord_tools():
    consumer = MagicMock()
    manager = MagicMock()
    manager.remove_org = MagicMock()
    loop = asyncio.new_event_loop()

    setup_config_consumer(consumer, manager, loop)
    handle_removed = dict(
        (call.args[0], call.args[1]) for call in consumer.on.call_args_list
    )["tool-config.removed"]

    handle_removed({"toolId": "taiga", "orgId": "org1"})  # not discord — should be ignored

    manager.remove_org.assert_not_called()
    loop.close()
