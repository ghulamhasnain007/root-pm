"""
memory/consolidation.py
───────────────────────
Background worker that consolidates raw meeting transcripts into structured
long-term memory (decisions, action items, blockers, topics, durable facts).

Runs as a daemon thread alongside the Kafka consumer. Polls MongoDB every
5 minutes for unconsolidated meetings older than 10 minutes, calls the LLM
to extract structured entities, and *reconciles* (not just appends to) the
project context — resolved action items/blockers are retired, contradicted
facts are superseded — so project_context stays a trustworthy current-state
snapshot rather than an ever-growing log. When an embedding provider is
configured, extracted decisions/action items/blockers/topics are also
embedded and indexed in `meeting_chunks` for semantic search.

Design:
  - Uses synchronous pymongo (same thread as Kafka consumer)
  - LLM calls use the same Gemini model as the agent
  - Meetings are claimed atomically (find_one_and_update) before processing,
    so it's safe to run more than one consumer replica for HA — without
    this two replicas racing on the same unconsolidated-meeting query would
    both call the LLM and could double-apply reconciliation.
  - Extraction failures are logged and marked so they're not retried infinitely
"""
from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any

from langchain_core.messages import HumanMessage

logger = logging.getLogger("agent_bridge.consolidation")

EXTRACTION_PROMPT = """\
You are a meeting analysis assistant. Extract structured information from this meeting transcript.

Transcript:
{transcript}

Participants: {participants}

Items already tracked as OPEN from earlier meetings (for this same project) — check whether
this meeting resolved, closed, or superseded any of them:
Open action items: {existing_action_items}
Open blockers: {existing_blockers}
Known facts: {existing_facts}

Return ONLY valid JSON with this exact schema, no markdown fences:
{{
  "decisions": ["list of decisions made during the meeting"],
  "action_items": [
    {{"owner": "participant name or null", "text": "description of action item", "task_id": "task ID if mentioned or null"}}
  ],
  "blockers": [
    {{"owner": "participant name or null", "text": "description of blocker"}}
  ],
  "topics": ["3-5 keyword topics for this meeting"],
  "resolved_action_items": ["exact text of any OPEN action item above that this meeting indicates is now done"],
  "resolved_blockers": ["exact text of any OPEN blocker above that this meeting indicates is now resolved"],
  "facts_asserted": ["durable facts about the project stated in this meeting, e.g. 'the API uses OAuth2', phrased as standalone statements"],
  "facts_contradicted": ["exact text of any KNOWN fact above that this meeting contradicts or supersedes"]
}}

Rules:
- Extract ONLY clearly stated decisions, not opinions or discussions
- New action items must have a clear owner and action
- Blockers must be actual impediments, not just questions
- Topics should be short keyword phrases (2-4 words each)
- Only include an item in resolved_action_items/resolved_blockers if it EXACTLY matches text
  from the "already tracked" lists above — do not paraphrase
- Only include a fact in facts_contradicted if it EXACTLY matches text from "Known facts" above
- Durable facts should be stable project knowledge, not meeting-specific chatter
- If the transcript is too short or unclear, return empty arrays for all fields"""


class ConsolidationWorker:
    """
    Background thread that processes unconsolidated meetings in MongoDB.

    Every POLL_INTERVAL seconds, atomically claims meetings where
    consolidated=false and ended_at is older than MIN_AGE_MINUTES, extracts
    structured entities via LLM, and reconciles the document + rolling
    project context.
    """

    POLL_INTERVAL = 300    # 5 minutes
    MIN_AGE_MINUTES = 10   # Don't process meetings younger than this
    MAX_FACTS_IN_PROMPT = 20
    MAX_ITEMS_IN_PROMPT = 20

    def __init__(self, mongo_db, llm, embeddings=None,
                 chunk_tokens: int = 400, chunk_overlap_tokens: int = 60):
        """
        mongo_db: pymongo database instance
        llm: LangChain ChatModel instance (same Gemini model as agent)
        embeddings: optional core.embeddings.EmbeddingProvider — when given,
            extracted decisions/action items/blockers/topics are embedded and
            indexed in `meeting_chunks` for semantic search. Purely additive;
            consolidation still works (regex-search-only) without it.
        """
        self._mongo = mongo_db
        self._llm = llm
        self._embeddings = embeddings
        self._chunk_tokens = chunk_tokens
        self._chunk_overlap_tokens = chunk_overlap_tokens
        self._running = False
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        """Start the consolidation worker as a daemon thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._loop,
            daemon=True,
            name="consolidation-worker",
        )
        self._thread.start()
        logger.info("Consolidation worker started (poll every %ds)", self.POLL_INTERVAL)

    def stop(self) -> None:
        """Stop the consolidation worker."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)

    def _loop(self) -> None:
        """Main polling loop."""
        while self._running:
            try:
                self._process_unconsolidated()
            except Exception as e:
                logger.error("Consolidation loop error: %s", e, exc_info=True)
            time.sleep(self.POLL_INTERVAL)

    def _process_unconsolidated(self) -> None:
        """Claim and process unconsolidated meetings one at a time."""
        cutoff_ms = int(time.time() * 1000) - self.MIN_AGE_MINUTES * 60_000
        claimed_count = 0

        while claimed_count < 10:
            meeting = self._claim_next(cutoff_ms)
            if meeting is None:
                break
            claimed_count += 1
            try:
                self._consolidate_meeting(meeting)
            except Exception as e:
                logger.error("Failed to consolidate meeting %s: %s",
                             meeting.get("meeting_id"), e, exc_info=True)
                self._mark_error(meeting)

        if claimed_count:
            logger.info("Processed %d unconsolidated meeting(s)", claimed_count)

    def _claim_next(self, cutoff_ms: int) -> dict | None:
        """
        Atomically claim the next unconsolidated meeting by flipping it to
        `consolidating=true` in one find_one_and_update call. This is what
        makes it safe to run multiple consumer replicas — without an atomic
        claim, two replicas could both read the same unconsolidated meeting
        and double-process it (duplicate LLM calls, duplicate reconciliation
        writes to project_context).
        """
        try:
            return self._mongo.meetings.find_one_and_update(
                {
                    "consolidated": False,
                    "consolidating": {"$ne": True},
                    "ended_at": {"$lt": cutoff_ms},
                },
                {"$set": {"consolidating": True, "consolidating_at": datetime.now(timezone.utc)}},
            )
        except Exception as e:
            logger.warning("Failed to claim next unconsolidated meeting: %s", e)
            return None

    def _consolidate_meeting(self, meeting: dict) -> None:
        """Extract structured entities from a single meeting, reconciling
        against existing open project state, and update MongoDB."""
        meeting_id = meeting.get("meeting_id", "unknown")
        transcript = meeting.get("transcript", [])
        participants = meeting.get("participants", [])
        project_key = meeting.get("project_key", "")

        if not transcript:
            logger.info("Meeting %s has no transcript, skipping extraction", meeting_id)
            self._mark_consolidated(meeting)
            return

        transcript_text = "\n".join(
            f"[{entry.get('speaker', 'Unknown')}]: {entry.get('text', '')}"
            for entry in transcript
            if entry.get("text", "").strip()
        )

        if not transcript_text.strip():
            logger.info("Meeting %s has empty transcript, skipping extraction", meeting_id)
            self._mark_consolidated(meeting)
            return

        existing_ctx = self._get_project_context(project_key) if project_key else None
        existing_action_items = [
            i.get("text", "") for i in (existing_ctx.get("open_action_items", []) if existing_ctx else [])
        ][: self.MAX_ITEMS_IN_PROMPT]
        existing_blockers = list(
            (existing_ctx.get("open_blockers", []) if existing_ctx else [])
        )[: self.MAX_ITEMS_IN_PROMPT]
        existing_facts = [
            f.get("fact", "") for f in self._get_known_facts(project_key)
        ][: self.MAX_FACTS_IN_PROMPT] if project_key else []

        prompt = EXTRACTION_PROMPT.format(
            transcript=transcript_text,
            participants=", ".join(participants),
            existing_action_items=json.dumps(existing_action_items),
            existing_blockers=json.dumps(existing_blockers),
            existing_facts=json.dumps(existing_facts),
        )

        try:
            resp = self._llm.invoke([HumanMessage(content=prompt)])
            text = resp.content.strip()

            if "```" in text:
                parts = text.split("```")
                for part in parts:
                    part = part.strip()
                    if part.startswith("json"):
                        part = part[4:].strip()
                    if part.startswith("{"):
                        text = part
                        break

            extracted = json.loads(text)
        except json.JSONDecodeError as e:
            logger.warning("LLM returned invalid JSON for meeting %s: %s", meeting_id, e)
            self._mark_consolidated(meeting)
            return
        except Exception as e:
            logger.error("LLM extraction failed for meeting %s: %s", meeting_id, e)
            self._mark_consolidated(meeting)
            return

        decisions = extracted.get("decisions", [])
        action_items = extracted.get("action_items", [])
        blockers = extracted.get("blockers", [])
        topics = extracted.get("topics", [])

        try:
            self._mongo.meetings.update_one(
                {"_id": meeting["_id"]},
                {"$set": {
                    "decisions": decisions,
                    "action_items": action_items,
                    "blockers": blockers,
                    "topics": topics,
                    "consolidated": True,
                    "consolidating": False,
                    "consolidated_at": datetime.now(timezone.utc),
                }},
            )
            logger.info(
                "Meeting %s consolidated: %d decisions, %d action items, %d blockers, %d topics",
                meeting_id, len(decisions), len(action_items), len(blockers), len(topics),
            )
        except Exception as e:
            logger.error("Failed to update meeting %s in MongoDB: %s", meeting_id, e)
            return

        if project_key:
            self._reconcile_project_context(project_key, meeting, extracted)
            self._reconcile_facts(project_key, extracted)

        self._embed_extracted_chunks(meeting, extracted)

    # ── Reconciliation (not just append) ────────────────────────────────────

    def _get_project_context(self, project_key: str) -> dict | None:
        try:
            return self._mongo.project_context.find_one({"_id": project_key})
        except Exception as e:
            logger.warning("Failed to read project_context for %s: %s", project_key, e)
            return None

    def _get_known_facts(self, project_key: str) -> list[dict]:
        try:
            return list(
                self._mongo.project_facts.find(
                    {"project_key": project_key, "superseded": {"$ne": True}}
                ).limit(self.MAX_FACTS_IN_PROMPT)
            )
        except Exception:
            return []

    def _reconcile_project_context(self, project_key: str, meeting: dict, extracted: dict) -> None:
        """
        Update the rolling project context: retire action items/blockers this
        meeting resolved, append genuinely new ones (deduped), and refresh
        the last-meeting timestamp. Unlike a plain append, this keeps
        `open_action_items`/`open_blockers` an accurate picture of what's
        still outstanding rather than a monotonically growing log.
        """
        decisions = extracted.get("decisions", [])
        action_items = extracted.get("action_items", [])
        blockers = extracted.get("blockers", [])
        resolved_action_items = set(extracted.get("resolved_action_items", []))
        resolved_blockers = set(extracted.get("resolved_blockers", []))

        try:
            ctx = self._mongo.project_context.find_one({"_id": project_key})
            if ctx is None:
                ctx = {
                    "_id": project_key,
                    "last_meeting_at": meeting.get("ended_at", 0),
                    "summary": "",
                    "open_blockers": [],
                    "recent_decisions": [],
                    "open_action_items": [],
                }

            for d in decisions:
                ctx["recent_decisions"].append({
                    "text": d,
                    "meeting_id": meeting.get("meeting_id"),
                    "date": meeting.get("ended_at", 0),
                })
            ctx["recent_decisions"] = ctx["recent_decisions"][-20:]

            # Retire resolved items (exact-text match against what we sent
            # the LLM), then add newly-open ones (deduped by text).
            remaining_open = [
                i for i in ctx.get("open_action_items", [])
                if i.get("text") not in resolved_action_items
            ]
            resolved_count = len(ctx.get("open_action_items", [])) - len(remaining_open)
            existing_texts = {i.get("text") for i in remaining_open}
            for ai_item in action_items:
                if ai_item.get("text") and ai_item.get("text") not in existing_texts:
                    remaining_open.append({
                        "owner": ai_item.get("owner"),
                        "text": ai_item.get("text"),
                        "created_in": meeting.get("meeting_id"),
                    })
            ctx["open_action_items"] = remaining_open

            # Blockers: previously this was a full overwrite each run (any
            # blocker not re-mentioned silently vanished). Now: keep prior
            # open blockers minus explicitly-resolved ones, plus new ones.
            prior_blockers = ctx.get("open_blockers", [])
            # Older data may have stored blockers as plain strings.
            prior_blocker_texts = [
                b if isinstance(b, str) else b.get("text", "") for b in prior_blockers
            ]
            remaining_blocker_texts = [
                t for t in prior_blocker_texts if t not in resolved_blockers
            ]
            new_blocker_texts = [b.get("text", "") for b in blockers if b.get("text")]
            for t in new_blocker_texts:
                if t not in remaining_blocker_texts:
                    remaining_blocker_texts.append(t)
            ctx["open_blockers"] = remaining_blocker_texts

            ctx["last_meeting_at"] = meeting.get("ended_at", 0)

            self._mongo.project_context.update_one(
                {"_id": project_key}, {"$set": ctx}, upsert=True,
            )
            logger.info(
                "Project context reconciled for %s (%d action items resolved, %d open remain)",
                project_key, resolved_count, len(remaining_open),
            )
        except Exception as e:
            logger.error("Failed to reconcile project context for %s: %s", project_key, e)

    def _reconcile_facts(self, project_key: str, extracted: dict) -> None:
        """Insert newly-asserted facts and mark contradicted facts as
        superseded, so stale facts stop surfacing in recall_facts()."""
        facts_asserted = [f for f in extracted.get("facts_asserted", []) if f and f.strip()]
        facts_contradicted = set(extracted.get("facts_contradicted", []))

        if facts_contradicted:
            try:
                self._mongo.project_facts.update_many(
                    {"project_key": project_key, "fact": {"$in": list(facts_contradicted)}},
                    {"$set": {"superseded": True, "superseded_at": datetime.now(timezone.utc)}},
                )
            except Exception as e:
                logger.warning("Failed to mark facts superseded for %s: %s", project_key, e)

        if not facts_asserted:
            return

        try:
            existing = {
                f.get("fact")
                for f in self._mongo.project_facts.find(
                    {"project_key": project_key, "superseded": {"$ne": True}},
                    {"fact": 1},
                )
            }
            new_docs = []
            for fact in facts_asserted:
                if fact in existing:
                    continue
                doc: dict[str, Any] = {
                    "project_key": project_key,
                    "fact": fact,
                    "source": "meeting_consolidation",
                    "created_at": datetime.now(timezone.utc),
                    "superseded": False,
                }
                if self._embeddings and self._embeddings.available:
                    vec = self._embeddings.embed_query(fact)
                    if vec:
                        doc["embedding"] = vec
                new_docs.append(doc)
            if new_docs:
                self._mongo.project_facts.insert_many(new_docs)
        except Exception as e:
            logger.warning("Failed to persist asserted facts for %s: %s", project_key, e)

    # ── Semantic indexing of extracted entities ─────────────────────────────

    def _embed_extracted_chunks(self, meeting: dict, extracted: dict) -> None:
        """Embed decisions/action items/blockers/topics as individual
        `meeting_chunks` records — higher-signal and more precisely-scoped
        than the raw-transcript chunks indexed at meeting-end, so semantic
        search tends to surface these first."""
        if not (self._embeddings and self._embeddings.available):
            return

        meeting_id = meeting.get("meeting_id", "unknown")
        channel_id = meeting.get("text_channel_id", "")
        project_key = meeting.get("project_key", "")
        ended_at = meeting.get("ended_at", 0)

        texts_with_kind: list[tuple[str, str]] = []
        for d in extracted.get("decisions", []):
            texts_with_kind.append(("decision", d))
        for ai_item in extracted.get("action_items", []):
            t = ai_item.get("text", "")
            if t:
                texts_with_kind.append(("action_item", t))
        for b in extracted.get("blockers", []):
            t = b.get("text", "")
            if t:
                texts_with_kind.append(("blocker", t))
        for topic in extracted.get("topics", []):
            texts_with_kind.append(("topic", topic))

        if not texts_with_kind:
            return

        texts = [t for _, t in texts_with_kind]
        vectors = self._embeddings.embed_documents(texts)
        if not vectors or len(vectors) != len(texts):
            logger.warning("Embedding extracted entities failed/mismatched for meeting %s", meeting_id)
            return

        try:
            docs = [
                {
                    "meeting_id": meeting_id,
                    "channel_id": channel_id,
                    "project_key": project_key,
                    "kind": kind,
                    "text": text,
                    "embedding": vector,
                    "ended_at": ended_at,
                    "created_at": datetime.now(timezone.utc),
                }
                for (kind, text), vector in zip(texts_with_kind, vectors)
            ]
            self._mongo.meeting_chunks.insert_many(docs)
        except Exception as e:
            logger.warning("Failed to index extracted chunks for meeting %s: %s", meeting_id, e)

    # ── Terminal states ──────────────────────────────────────────────────────

    def _mark_consolidated(self, meeting: dict) -> None:
        """Mark a meeting as consolidated (with empty extraction)."""
        try:
            self._mongo.meetings.update_one(
                {"_id": meeting["_id"]},
                {"$set": {
                    "consolidated": True,
                    "consolidating": False,
                    "consolidated_at": datetime.now(timezone.utc),
                }},
            )
        except Exception as e:
            logger.error("Failed to mark meeting %s as consolidated: %s",
                         meeting.get("meeting_id"), e)

    def _mark_error(self, meeting: dict) -> None:
        """Mark a meeting as consolidated with extraction error."""
        try:
            self._mongo.meetings.update_one(
                {"_id": meeting["_id"]},
                {"$set": {
                    "consolidated": True,
                    "consolidating": False,
                    "consolidated_at": datetime.now(timezone.utc),
                    "extraction_error": True,
                }},
            )
        except Exception as e:
            logger.error("Failed to mark meeting %s with error: %s",
                         meeting.get("meeting_id"), e)
