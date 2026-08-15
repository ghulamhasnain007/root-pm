"""
tests/test_suite.py — Unit tests for Agent Bridge core components.
Run with: pytest tests/ -v
"""
from __future__ import annotations
import json
import pytest
from unittest.mock import MagicMock, patch


# ─────────────────────────────────────────────
# Platform Registry Tests
# ─────────────────────────────────────────────

class TestPlatformRegistry:
    def setup_method(self):
        # Import triggers self-registration
        import backend.platforms.communication.discord_platform  # noqa
        import backend.platforms.pm.taiga_platform              # noqa

    def test_discord_registered(self):
        from core.registry import PlatformRegistry
        assert "discord" in PlatformRegistry.list_comm()

    def test_taiga_registered(self):
        from core.registry import PlatformRegistry
        assert "taiga" in PlatformRegistry.list_pm()

    def test_slack_stub_registered(self):
        import backend.platforms.communication.slack_platform  # noqa
        from core.registry import PlatformRegistry
        assert "slack" in PlatformRegistry.list_comm()

    def test_jira_stub_registered(self):
        import backend.platforms.pm.jira_platform  # noqa
        from core.registry import PlatformRegistry
        assert "jira" in PlatformRegistry.list_pm()

    def test_unknown_comm_raises(self):
        from core.registry import PlatformRegistry
        with pytest.raises(KeyError):
            PlatformRegistry.get_comm("nonexistent_xyz")

    def test_unknown_pm_raises(self):
        from core.registry import PlatformRegistry
        with pytest.raises(KeyError):
            PlatformRegistry.get_pm("nonexistent_xyz")


# ─────────────────────────────────────────────
# Discord RBAC Tests
# ─────────────────────────────────────────────

class TestDiscordRBAC:
    def _make(self, role_perms=None):
        import backend.platforms.communication.discord_platform  # noqa
        from platforms.communication.discord_platform import DiscordPlatform
        p = DiscordPlatform()
        p._config = {
            "bot_token": "test", "trigger_role": "FYP",
            "channel_map": {}, "role_permissions": role_perms or {},
        }
        return p

    def test_project_manager_admin(self):
        assert self._make().get_permission_tier(["Project Manager"]) == "admin"

    def test_developer_write(self):
        assert self._make().get_permission_tier(["Developer"]) == "write"

    def test_viewer_read(self):
        assert self._make().get_permission_tier(["Viewer"]) == "read"

    def test_unknown_none(self):
        assert self._make().get_permission_tier(["RandomRole"]) == "none"

    def test_empty_none(self):
        assert self._make().get_permission_tier([]) == "none"

    def test_custom_role_override(self):
        p = self._make({"Lead": "admin", "Intern": "read"})
        assert p.get_permission_tier(["Lead"]) == "admin"
        assert p.get_permission_tier(["Intern"]) == "read"

    def test_resolve_project_key_hit(self):
        p = self._make()
        p._config["channel_map"] = {"guild1": {"ch1": "project-alpha"}}
        assert p.resolve_project_key("guild1", "ch1") == "project-alpha"

    def test_resolve_project_key_miss_channel(self):
        p = self._make()
        p._config["channel_map"] = {"guild1": {"ch1": "project-alpha"}}
        assert p.resolve_project_key("guild1", "ch_unknown") is None

    def test_resolve_project_key_miss_guild(self):
        p = self._make()
        p._config["channel_map"] = {}
        assert p.resolve_project_key("unknown_guild", "ch1") is None


# ─────────────────────────────────────────────
# Tool Builder Tests
# ─────────────────────────────────────────────

class TestToolBuilder:
    def _mock_pm(self):
        from core.base import ProjectItem
        pm = MagicMock()
        pm.platform_id = "taiga"
        pm.display_name = "Taiga"
        pm.list_members.return_value = [
            {"id": 1, "username": "alice", "full_name": "Alice", "role": "dev"}
        ]
        pm.create_item.return_value = ProjectItem(
            platform="taiga", item_id="42", item_type="tasks",
            subject="Test task", description="", status="new",
            assignee=None, tags=[], url="https://taiga.test/task/42"
        )
        pm.close_item.return_value = ProjectItem(
            platform="taiga", item_id="42", item_type="tasks",
            subject="Test task", description="", status="done",
            assignee=None, tags=[], url=None
        )
        pm.list_items.return_value = []
        pm.search_items.return_value = []
        pm.get_project_context.return_value = MagicMock(
            project_name="Test", active_sprint=None, sprint_end_date=None,
            open_task_count=0, open_issue_count=0, open_story_count=0, members=[])
        return pm

    def test_read_tier_excludes_write(self):
        from agent.tools import build_tools
        tools = {t.name for t in build_tools(self._mock_pm(), "99", "read")}
        assert "create_item" not in tools
        assert "close_item" not in tools
        assert "list_items" in tools

    def test_write_tier_includes_crud(self):
        from agent.tools import build_tools
        tools = {t.name for t in build_tools(self._mock_pm(), "99", "write")}
        assert "create_item" in tools
        assert "close_item" in tools
        assert "bulk_create" not in tools

    def test_admin_tier_includes_bulk(self):
        from agent.tools import build_tools
        tools = {t.name for t in build_tools(self._mock_pm(), "99", "admin")}
        assert "bulk_create" in tools
        assert "bulk_close" in tools

    def test_none_tier_returns_read(self):
        from agent.tools import build_tools
        tools = {t.name for t in build_tools(self._mock_pm(), "99", "none")}
        assert "list_items" in tools
        assert "create_item" not in tools

    def test_create_item_calls_pm(self):
        from agent.tools import build_tools
        pm = self._mock_pm()
        tools = {t.name: t for t in build_tools(pm, "99", "write")}
        result = tools["create_item"].invoke({
            "item_type": "task", "subject": "Fix bug",
            "description": "", "assigned_to": "", "tags": ""
        })
        pm.create_item.assert_called_once()
        assert "42" in result or "Fix bug" in result

    def test_close_item_calls_pm(self):
        from agent.tools import build_tools
        pm = self._mock_pm()
        tools = {t.name: t for t in build_tools(pm, "99", "write")}
        result = tools["close_item"].invoke({"item_id": "42"})
        pm.close_item.assert_called_once_with("99", "42")
        assert "done" in result.lower() or "42" in result

    def test_bulk_create_parses_json(self):
        from agent.tools import build_tools
        from core.base import ProjectItem
        pm = self._mock_pm()
        pm.create_item.return_value = ProjectItem(
            platform="taiga", item_id="1", item_type="tasks",
            subject="X", description="", status="new",
            assignee=None, tags=[], url=None
        )
        tools = {t.name: t for t in build_tools(pm, "99", "admin")}
        payload = json.dumps([
            {"item_type": "task", "subject": "A"},
            {"item_type": "issue", "subject": "B"},
        ])
        result = tools["bulk_create"].invoke({"items_json": payload})
        assert pm.create_item.call_count == 2

    def test_bulk_create_invalid_json(self):
        from agent.tools import build_tools
        tools = {t.name: t for t in build_tools(self._mock_pm(), "99", "admin")}
        result = tools["bulk_create"].invoke({"items_json": "not-json"})
        assert "Invalid JSON" in result or "❌" in result


# ─────────────────────────────────────────────
# Taiga HTTP / normalise_type Tests
# ─────────────────────────────────────────────

class TestNormaliseType:
    def test_task(self):
        from platforms.pm.taiga_platform import _norm
        assert _norm("task") == "tasks"
        assert _norm("tasks") == "tasks"

    def test_story(self):
        from platforms.pm.taiga_platform import _norm
        assert _norm("story") == "userstories"
        assert _norm("userstory") == "userstories"
        assert _norm("userstories") == "userstories"

    def test_epic(self):
        from platforms.pm.taiga_platform import _norm
        assert _norm("epic") == "epics"
        assert _norm("epics") == "epics"

    def test_issue(self):
        from platforms.pm.taiga_platform import _norm
        assert _norm("issue") == "issues"
        assert _norm("issues") == "issues"

    def test_case_insensitive(self):
        from platforms.pm.taiga_platform import _norm
        assert _norm("TASK") == "tasks"
        assert _norm("Story") == "userstories"


class TestTaigaHTTP:
    @patch("platforms.pm.taiga_platform.requests.request")
    def test_get_project_id_caches(self, mock_req):
        from platforms.pm.taiga_platform import _TaigaHTTP
        mock_req.return_value.status_code = 200
        mock_req.return_value.json.return_value = {"id": 77, "name": "Alpha"}
        mock_req.return_value.text = '{"id":77}'
        http = _TaigaHTTP("https://t.test/api/v1", "u", "p")
        http.token = "tok"
        id1 = http.get_project_id("alpha")
        id2 = http.get_project_id("alpha")
        assert id1 == id2 == "77"
        assert mock_req.call_count == 1  # cached on second call

    @patch("platforms.pm.taiga_platform.requests.request")
    def test_closed_status_raises_when_missing(self, mock_req):
        from platforms.pm.taiga_platform import _TaigaHTTP
        mock_req.return_value.status_code = 200
        mock_req.return_value.json.return_value = [
            {"id": 1, "name": "New", "is_closed": False}
        ]
        mock_req.return_value.text = '[{"id":1}]'
        http = _TaigaHTTP("https://t.test/api/v1", "u", "p")
        http.token = "tok"
        with pytest.raises(ValueError, match="No closed status"):
            http.get_closed_status_id("tasks", "5")


# ─────────────────────────────────────────────
# Config loading test
# ─────────────────────────────────────────────

class TestConfigLoader:
    """load_config lives in backend/server/bot/main.py (bot entry point)."""

    @staticmethod
    def _import_bot_main():
        import importlib.util, os
        path = os.path.join(os.path.dirname(__file__), "..", "server", "bot", "main.py")
        spec = importlib.util.spec_from_file_location("bot_main_module", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def test_env_var_resolution(self, tmp_path, monkeypatch):
        monkeypatch.setenv("MY_TOKEN", "resolved!")
        cfg_file = tmp_path / "config.json"
        cfg_file.write_text(json.dumps({
            "comm_platform": "discord", "pm_platform": "taiga",
            "discord": {"bot_token": "$MY_TOKEN", "trigger_role": "FYP"},
            "taiga": {"url": "https://t.test/api/v1", "username": "u", "password": "p"},
            "llm": {"gemini_api_key": "key", "agent_model": "m", "classifier_model": "m2"},
            "advanced": {"max_iterations": 8, "context_cache_ttl": 60, "memory_max_tokens": 2000},
            "channel_mappings": [], "role_permissions": [],
        }))
        cfg = self._import_bot_main().load_config(str(cfg_file))
        assert cfg["discord"]["bot_token"] == "resolved!"

    def test_missing_config_exits(self, tmp_path):
        mod = self._import_bot_main()
        with pytest.raises(SystemExit):
            mod.load_config(str(tmp_path / "nonexistent.json"))


# ─────────────────────────────────────────────
# TaigaSyncHandler tests (voice → Taiga mirror)
# ─────────────────────────────────────────────

class TestTaigaSyncHandler:
    """Mirrors voice task events into Taiga via the Python consumer."""

    def setup_method(self):
        import sys, os
        from unittest.mock import MagicMock
        root = os.path.join(os.path.dirname(__file__), "..", "python-consumer")
        if root not in sys.path:
            sys.path.insert(0, root)
        from taiga.taiga_sync import TaigaSyncHandler
        self.TaigaSyncHandler = TaigaSyncHandler
        self.MagicMock = MagicMock

    def _item(self, **overrides):
        from core.base import ProjectItem
        fields = dict(
            platform="taiga", item_id="100", item_type="tasks",
            subject="Fix login bug", description="", status="new",
            assignee=None, tags=[], url=None,
        )
        fields.update(overrides)
        return ProjectItem(**fields)

    def test_created_appends_context_and_passes_assignee(self):
        pm = self.MagicMock()
        pm.get_project_id.return_value = "77"
        pm.create_item.return_value = self._item(subject="New task")
        handler = self.TaigaSyncHandler(pm, "proj")

        handler.on_task_created({
            "eventType": "task.created", "taskId": "m1", "title": "New task",
            "description": "do it", "assignee": "alice",
            "createdBy": "Alice", "meetingId": "mtg1",
        })

        kwargs = pm.create_item.call_args.kwargs
        assert kwargs["assigned_to"] == "alice"
        assert kwargs["subject"] == "New task"
        assert "Meeting session: mtg1" in kwargs["description"]
        assert "from-meeting" in kwargs["tags"]

    def test_updated_applies_assignee_and_description(self):
        pm = self.MagicMock()
        pm.get_project_id.return_value = "77"
        pm.search_items.return_value = [self._item()]
        pm.list_members.return_value = [
            {"id": 5, "username": "alice", "full_name": "Alice", "role": "dev"}]
        pm.update_item.return_value = self._item(assignee="alice")
        handler = self.TaigaSyncHandler(pm, "proj")

        handler.on_task_updated({
            "eventType": "task.updated", "taskId": "m1",
            "title": "Fix login bug",
            "changes": {"assignee": "alice", "description": "updated description"},
        })

        assert pm.update_item.call_count == 1
        _, _, fields = pm.update_item.call_args.args
        assert fields["assigned_to"] == 5
        assert fields["description"] == "updated description"
        assert "subject" not in fields

    def test_updated_rename_searches_by_previous_title(self):
        pm = self.MagicMock()
        pm.get_project_id.return_value = "77"
        pm.search_items.return_value = [self._item()]  # old title still in Taiga
        pm.update_item.return_value = self._item(subject="New title")
        handler = self.TaigaSyncHandler(pm, "proj")

        handler.on_task_updated({
            "eventType": "task.updated", "taskId": "m1",
            "title": "New title", "previousTitle": "Fix login bug",
            "changes": {"title": "New title"},
        })

        _, search = pm.search_items.call_args.args
        assert search == "Fix login bug"
        _, _, fields = pm.update_item.call_args.args
        assert fields["subject"] == "New title"

    def test_updated_missing_match_skips(self):
        pm = self.MagicMock()
        pm.get_project_id.return_value = "77"
        pm.search_items.return_value = []  # no matching Taiga item
        handler = self.TaigaSyncHandler(pm, "proj")

        handler.on_task_updated({
            "eventType": "task.updated", "taskId": "m1",
            "title": "Ghost task", "changes": {"description": "x"},
        })

        pm.update_item.assert_not_called()


# ─────────────────────────────────────────────
# Meeting memory tests (voice → chat agent context)
# ─────────────────────────────────────────────

class TestMeetingMemory:
    """Meeting transcripts shared with the chat agent's memory store."""

    def setup_method(self):
        import sys, os
        root = os.path.join(os.path.dirname(__file__), "..", "python-consumer")
        if root not in sys.path:
            sys.path.insert(0, root)

    def test_get_meeting_context_returns_summaries_only(self):
        from agent.agent import ChannelMemoryStore
        from langchain_core.messages import SystemMessage, HumanMessage

        mem = ChannelMemoryStore(max_messages=10)
        mem.append("ch1", [
            SystemMessage(content="[MEETING CONTEXT — injected automatically]\nMeeting ID: m1"),
            HumanMessage(content="hello"),
        ])

        ctx = mem.get_meeting_context("ch1")
        assert len(ctx) == 1
        assert ctx[0].startswith("[MEETING CONTEXT")

        other = mem.get_meeting_context("ch2")
        assert other == []

    def test_meeting_summary_message_builds(self):
        from memory.meeting_memory import build_meeting_summary_message
        from langchain_core.messages import SystemMessage

        msg = build_meeting_summary_message({
            "meetingId": "m1", "channelId": "vc1", "endedAt": 0,
            "durationMs": 60_000,
            "summary": {
                "participants": [{"name": "Alice"}],
                "tasksCreated": ["task A"], "tasksClosed": [],
                "fullTranscript": [{"role": "user", "speakerName": "Bob",
                                    "text": "we should fix the auth bug", "timestamp": 0}],
            },
        })

        assert isinstance(msg, SystemMessage)
        assert "[MEETING CONTEXT" in msg.content
        assert "Alice" in msg.content
        assert "task A" in msg.content
