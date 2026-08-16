"""
tests/test_memory_enhancements.py — Tests for the memory retrieval/storage
enhancements: token-budgeted context assembly, hybrid (keyword + semantic)
search, reconciling consolidation, and the project_key wiring fix.

Run with: pytest tests/test_memory_enhancements.py -v
"""
from __future__ import annotations

import json
import sys
import os
from unittest.mock import MagicMock

import pytest


def _ensure_consumer_on_path():
    root = os.path.join(os.path.dirname(__file__), "..", "python-consumer")
    if root not in sys.path:
        sys.path.insert(0, root)


# ─────────────────────────────────────────────
# core/tokens.py
# ─────────────────────────────────────────────

class TestTokenCounting:
    def test_count_tokens_nonzero_for_text(self):
        from core.tokens import count_tokens
        assert count_tokens("hello world") > 0
        assert count_tokens("") == 0

    def test_truncate_respects_budget(self):
        from core.tokens import count_tokens, truncate_to_tokens
        long_text = "word " * 2000
        truncated = truncate_to_tokens(long_text, 50)
        assert count_tokens(truncated) <= 55  # small slack for the heuristic


# ─────────────────────────────────────────────
# core/embeddings.py
# ─────────────────────────────────────────────

class TestEmbeddingUtils:
    def test_chunk_text_splits_long_input(self):
        from core.embeddings import chunk_text
        text = "\n".join(f"Line {i} of a long transcript." for i in range(200))
        chunks = chunk_text(text, chunk_tokens=100, overlap_tokens=20)
        assert len(chunks) > 1

    def test_chunk_text_short_input_single_chunk(self):
        from core.embeddings import chunk_text
        assert chunk_text("short text", chunk_tokens=400) == ["short text"]

    def test_cosine_similarity(self):
        from core.embeddings import cosine_similarity
        assert cosine_similarity([1, 0, 0], [1, 0, 0]) == pytest.approx(1.0)
        assert cosine_similarity([1, 0, 0], [0, 1, 0]) == pytest.approx(0.0)
        assert cosine_similarity([], [1]) == 0.0

    def test_rank_by_similarity_handles_missing_embeddings(self):
        from core.embeddings import rank_by_similarity
        candidates = [
            {"text": "x", "embedding": [1, 0, 0]},
            {"text": "y", "embedding": None},
        ]
        ranked = rank_by_similarity([1, 0, 0], candidates, top_k=2)
        assert ranked[0]["text"] == "x"

    def test_embedding_provider_disabled_without_key(self):
        from core.embeddings import EmbeddingProvider
        ep = EmbeddingProvider(api_key="")
        assert ep.available is False
        assert ep.embed_query("hi") is None
        assert ep.embed_documents(["a"]) is None


# ─────────────────────────────────────────────
# agent/context.py — token-budgeted context assembly
# ─────────────────────────────────────────────

class TestContextAssembler:
    def _history(self, n=50):
        from langchain_core.messages import HumanMessage, AIMessage
        msgs = []
        for i in range(n):
            msgs.append(HumanMessage(content=f"Message {i} " + "x" * 40))
            msgs.append(AIMessage(content=f"Reply {i} " + "y" * 40))
        return msgs

    def test_fits_within_budget(self):
        from agent.context import ContextAssembler
        assembler = ContextAssembler(total_budget_tokens=800, system_reserve_tokens=100,
                                      reply_reserve_tokens=100)
        meetings = ["Meeting A: " + ("point. " * 300), "Meeting B: short."]
        result = assembler.assemble(meetings, self._history(100))
        assert result.meeting_tokens + result.history_tokens <= assembler.available_tokens + 5

    def test_no_drop_when_budget_is_generous(self):
        from agent.context import ContextAssembler
        assembler = ContextAssembler(total_budget_tokens=5000, system_reserve_tokens=100,
                                      reply_reserve_tokens=100)
        result = assembler.assemble(["short meeting"], self._history(2))
        assert result.meetings_dropped == 0
        assert result.history_dropped == 0

    def test_truncated_meeting_not_double_counted_as_dropped(self):
        """A meeting that gets truncated-and-included should not also be
        reported as dropped — regression test for a labeling bug caught
        during implementation."""
        from agent.context import ContextAssembler
        assembler = ContextAssembler(total_budget_tokens=800, system_reserve_tokens=100,
                                      reply_reserve_tokens=100)
        meetings = ["Meeting A: " + ("point. " * 300), "Meeting B: short.", "Meeting C: short too."]
        result = assembler.assemble(meetings, [])
        assert len(result.meeting_summaries) == 1  # only the truncated one fits
        assert result.meetings_dropped == 2         # the two that got zero space


# ─────────────────────────────────────────────
# agent/agent.py — ChannelMemoryStore honors the MemoryStore interface
# ─────────────────────────────────────────────

class TestChannelMemoryStoreDefaults:
    def test_optional_methods_degrade_gracefully(self):
        from agent.agent import ChannelMemoryStore
        mem = ChannelMemoryStore(max_messages=10)
        assert mem.get_action_items("proj") == []
        assert mem.recall_facts("proj") == []
        assert mem.remember_fact("proj", "some fact") is None  # no-op, doesn't raise

    def test_relevant_meeting_context_falls_back_to_recency(self):
        from agent.agent import ChannelMemoryStore
        from langchain_core.messages import SystemMessage
        mem = ChannelMemoryStore(max_messages=10)
        mem.append("ch1", [SystemMessage(content="[MEETING CONTEXT — injected automatically]\nMeeting ID: m1")])
        result = mem.get_relevant_meeting_context("ch1", "what did we discuss")
        assert len(result) == 1


# ─────────────────────────────────────────────
# agent/agent.py — DualMemoryStore (mocked Redis/Mongo)
# ─────────────────────────────────────────────

class TestDualMemoryStore:
    def test_search_meetings_escapes_regex(self):
        import re
        from agent.agent import DualMemoryStore
        mongo = MagicMock()
        mongo.meetings.find.return_value.sort.return_value.limit.return_value = []
        store = DualMemoryStore(redis_client=MagicMock(), mongo_db=mongo)
        store.search_meetings("weird(query[with*regex")
        filter_query = mongo.meetings.find.call_args[0][0]
        pattern = filter_query["$or"][0]["transcript.text"]["$regex"]
        re.compile(pattern)  # must not raise — proves it's escaped, not raw
        assert "\\(" in pattern

    def test_search_meetings_scopes_by_project_key(self):
        from agent.agent import DualMemoryStore
        mongo = MagicMock()
        mongo.meetings.find.return_value.sort.return_value.limit.return_value = []
        store = DualMemoryStore(redis_client=MagicMock(), mongo_db=mongo)
        store.search_meetings("auth", project_key="PROJ1")
        filter_query = mongo.meetings.find.call_args[0][0]
        assert filter_query["project_key"] == "PROJ1"

    def test_save_meeting_uses_resolved_channel_not_voice_channel(self):
        """Regression test: event['channelId'] is the *voice* channel, not
        the Discord text channel — save_meeting must store the caller-
        resolved text channel_id, not the raw event field."""
        from agent.agent import DualMemoryStore
        mongo = MagicMock()
        store = DualMemoryStore(redis_client=MagicMock(), mongo_db=mongo)
        event = {
            "meetingId": "m1", "channelId": "VOICE_CHANNEL_ID", "startedAt": 0,
            "endedAt": 1000, "durationMs": 60000, "participants": [{"name": "Alice"}],
            "summary": {"fullTranscript": [], "tasksCreated": [], "tasksClosed": []},
        }
        store.save_meeting(event, project_key="PROJ1", channel_id="TEXT_CHANNEL_ID")
        inserted = mongo.meetings.insert_one.call_args[0][0]
        assert inserted["text_channel_id"] == "TEXT_CHANNEL_ID"
        assert inserted["text_channel_id"] != "VOICE_CHANNEL_ID"
        assert inserted["project_key"] == "PROJ1"

    def test_get_action_items_filters_by_owner(self):
        from agent.agent import DualMemoryStore
        mongo = MagicMock()
        mongo.project_context.find_one.return_value = {
            "_id": "PROJ1",
            "open_action_items": [
                {"owner": "Alice", "text": "Fix bug"},
                {"owner": "Bob", "text": "Write docs"},
            ],
        }
        store = DualMemoryStore(redis_client=MagicMock(), mongo_db=mongo)
        items = store.get_action_items("PROJ1", owner="alice")
        assert len(items) == 1 and items[0]["owner"] == "Alice"

    def test_remember_and_recall_facts(self):
        from agent.agent import DualMemoryStore
        mongo = MagicMock()
        store = DualMemoryStore(redis_client=MagicMock(), mongo_db=mongo)
        store.remember_fact("PROJ1", "Staging URL is example.com")
        inserted = mongo.project_facts.insert_one.call_args[0][0]
        assert inserted["project_key"] == "PROJ1"
        assert inserted["superseded"] is False


# ─────────────────────────────────────────────
# agent/tools.py — project_key vs project_id wiring
# ─────────────────────────────────────────────

class TestToolsProjectKeyWiring:
    def test_memory_tools_use_project_key_not_project_id(self):
        """Regression test: memory tools must query by project_key (the PM
        slug used throughout save_meeting/consolidation/project_context),
        not project_id (the platform's internal/opaque ID) — mixing the two
        means every memory query silently matches nothing."""
        from agent.tools import build_tools
        pm = MagicMock()
        mem = MagicMock()
        mem.get_project_decisions = MagicMock(return_value=[])
        tools = build_tools(pm, project_id="internal-taiga-id-999", tier="read",
                            memory_store=mem, project_key="my-project-slug")
        gpd = next(t for t in tools if t.name == "get_project_decisions")
        gpd.invoke({})
        called_with = mem.get_project_decisions.call_args[0][0]
        assert called_with == "my-project-slug"

    def test_new_memory_tools_registered(self):
        from agent.tools import build_tools
        pm = MagicMock()
        mem = MagicMock()
        mem.search_meetings = MagicMock(return_value=[])
        tools = build_tools(pm, project_id="x", tier="read", memory_store=mem, project_key="p")
        names = {t.name for t in tools}
        assert {"get_action_items", "remember_fact", "recall_facts"}.issubset(names)

    def test_falls_back_to_project_id_when_no_project_key_given(self):
        """Backward compatibility: existing callers that don't pass
        project_key should keep working (using project_id as before)."""
        from agent.tools import build_tools
        pm = MagicMock()
        mem = MagicMock()
        mem.get_project_decisions = MagicMock(return_value=[])
        tools = build_tools(pm, project_id="fallback-id", tier="read", memory_store=mem)
        gpd = next(t for t in tools if t.name == "get_project_decisions")
        gpd.invoke({})
        assert mem.get_project_decisions.call_args[0][0] == "fallback-id"


# ─────────────────────────────────────────────
# python-consumer/memory/consolidation.py — reconciliation
# ─────────────────────────────────────────────

class TestConsolidationReconciliation:
    def setup_method(self):
        _ensure_consumer_on_path()

    def _worker(self, mongo, llm_content: dict):
        from memory.consolidation import ConsolidationWorker
        llm = MagicMock()
        response = MagicMock()
        response.content = json.dumps(llm_content)
        llm.invoke.return_value = response
        return ConsolidationWorker(mongo_db=mongo, llm=llm, embeddings=None)

    def _meeting(self, **overrides):
        base = {
            "_id": "abc123",
            "meeting_id": "m1",
            "project_key": "PROJ1",
            "text_channel_id": "TEXT1",
            "ended_at": 5000,
            "participants": ["Alice", "Bob"],
            "transcript": [{"speaker": "Alice", "text": "some transcript text"}],
        }
        base.update(overrides)
        return base

    def test_claim_next_uses_atomic_find_one_and_update(self):
        mongo = MagicMock()
        worker = self._worker(mongo, {})
        worker._claim_next(cutoff_ms=1000)
        filt, update = mongo.meetings.find_one_and_update.call_args[0]
        assert filt["consolidated"] is False
        assert filt["consolidating"] == {"$ne": True}
        assert update["$set"]["consolidating"] is True

    def test_resolved_action_items_are_retired_not_just_appended(self):
        mongo = MagicMock()
        mongo.project_context.find_one.return_value = {
            "_id": "PROJ1",
            "open_action_items": [
                {"owner": "Alice", "text": "Fix auth bug"},
                {"owner": "Bob", "text": "Write docs"},
            ],
            "open_blockers": [],
            "recent_decisions": [],
            "last_meeting_at": 0,
        }
        mongo.project_facts.find.return_value.limit.return_value = []
        mongo.project_facts.find.return_value = []

        worker = self._worker(mongo, {
            "decisions": [], "action_items": [], "blockers": [], "topics": [],
            "resolved_action_items": ["Fix auth bug"],
            "resolved_blockers": [], "facts_asserted": [], "facts_contradicted": [],
        })
        worker._consolidate_meeting(self._meeting())

        new_ctx = mongo.project_context.update_one.call_args[0][1]["$set"]
        texts = {i["text"] for i in new_ctx["open_action_items"]}
        assert "Fix auth bug" not in texts, "resolved item must be retired"
        assert "Write docs" in texts, "untouched item must be preserved"

    def test_new_action_items_are_added(self):
        mongo = MagicMock()
        mongo.project_context.find_one.return_value = None  # no prior context
        mongo.project_facts.find.return_value.limit.return_value = []
        mongo.project_facts.find.return_value = []

        worker = self._worker(mongo, {
            "decisions": [], "action_items": [{"owner": "Carol", "text": "New task", "task_id": None}],
            "blockers": [], "topics": [],
            "resolved_action_items": [], "resolved_blockers": [],
            "facts_asserted": [], "facts_contradicted": [],
        })
        worker._consolidate_meeting(self._meeting())

        new_ctx = mongo.project_context.update_one.call_args[0][1]["$set"]
        texts = {i["text"] for i in new_ctx["open_action_items"]}
        assert "New task" in texts

    def test_blockers_are_not_fully_overwritten(self):
        """Regression test for the pre-existing bug where open_blockers was
        fully replaced every consolidation run, silently dropping any
        blocker not re-mentioned in the latest meeting."""
        mongo = MagicMock()
        mongo.project_context.find_one.return_value = {
            "_id": "PROJ1",
            "open_action_items": [],
            "open_blockers": ["Blocker A", "Blocker B"],
            "recent_decisions": [],
            "last_meeting_at": 0,
        }
        mongo.project_facts.find.return_value.limit.return_value = []
        mongo.project_facts.find.return_value = []

        worker = self._worker(mongo, {
            "decisions": [], "action_items": [], "blockers": [{"owner": None, "text": "Blocker C"}],
            "topics": [], "resolved_action_items": [], "resolved_blockers": ["Blocker A"],
            "facts_asserted": [], "facts_contradicted": [],
        })
        worker._consolidate_meeting(self._meeting())

        new_ctx = mongo.project_context.update_one.call_args[0][1]["$set"]
        assert "Blocker A" not in new_ctx["open_blockers"]   # explicitly resolved
        assert "Blocker B" in new_ctx["open_blockers"]        # untouched, preserved
        assert "Blocker C" in new_ctx["open_blockers"]        # newly reported

    def test_contradicted_facts_marked_superseded(self):
        mongo = MagicMock()
        mongo.project_context.find_one.return_value = None
        mongo.project_facts.find.return_value.limit.return_value = [{"fact": "Old fact"}]
        mongo.project_facts.find.return_value = []

        worker = self._worker(mongo, {
            "decisions": [], "action_items": [], "blockers": [], "topics": [],
            "resolved_action_items": [], "resolved_blockers": [],
            "facts_asserted": ["New fact"], "facts_contradicted": ["Old fact"],
        })
        worker._consolidate_meeting(self._meeting())

        superseded_filter = mongo.project_facts.update_many.call_args[0][0]
        assert superseded_filter["fact"]["$in"] == ["Old fact"]
        inserted = mongo.project_facts.insert_many.call_args[0][0]
        assert inserted[0]["fact"] == "New fact"

    def test_empty_transcript_marks_consolidated_without_llm_call(self):
        mongo = MagicMock()
        worker = self._worker(mongo, {})
        worker._consolidate_meeting(self._meeting(transcript=[]))
        assert worker._llm.invoke.call_count == 0
        update_call = mongo.meetings.update_one.call_args[0][1]["$set"]
        assert update_call["consolidated"] is True

    def test_invalid_json_from_llm_does_not_crash(self):
        mongo = MagicMock()
        worker = self._worker(mongo, {})
        worker._llm.invoke.return_value.content = "not valid json {{"
        # Should not raise
        worker._consolidate_meeting(self._meeting())
        update_call = mongo.meetings.update_one.call_args
        assert update_call is None or True  # just asserting no exception propagated
