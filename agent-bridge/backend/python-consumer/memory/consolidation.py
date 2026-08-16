"""
memory/consolidation.py
───────────────────────
Background worker that consolidates raw meeting transcripts into structured
long-term memory (decisions, action items, blockers, topics).

Runs as a daemon thread alongside the Kafka consumer. Polls MongoDB every
5 minutes for unconsolidated meetings older than 10 minutes, calls the LLM
to extract structured entities, and updates the meeting document + project
context.

Design:
  - Uses synchronous pymongo (same thread as Kafka consumer)
  - LLM calls use the same Gemini model as the agent
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

Return ONLY valid JSON with this exact schema, no markdown fences:
{{
  "decisions": ["list of decisions made during the meeting"],
  "action_items": [
    {{"owner": "participant name or null", "text": "description of action item", "task_id": "task ID if mentioned or null"}}
  ],
  "blockers": [
    {{"owner": "participant name or null", "text": "description of blocker"}}
  ],
  "topics": ["3-5 keyword topics for this meeting"]
}}

Rules:
- Extract ONLY clearly stated decisions, not opinions or discussions
- Action items must have a clear owner and action
- Blockers must be actual impediments, not just questions
- Topics should be short keyword phrases (2-4 words each)
- If the transcript is too short or unclear, return empty arrays for all fields"""


class ConsolidationWorker:
    """
    Background thread that processes unconsolidated meetings in MongoDB.

    Every POLL_INTERVAL seconds, finds meetings where consolidated=false
    and ended_at is older than MIN_AGE_MINUTES, extracts structured entities
    via LLM, and updates the document.
    """

    POLL_INTERVAL = 300    # 5 minutes
    MIN_AGE_MINUTES = 10   # Don't process meetings younger than this

    def __init__(self, mongo_db, llm):
        """
        mongo_db: pymongo database instance
        llm: LangChain ChatModel instance (same Gemini model as agent)
        """
        self._mongo = mongo_db
        self._llm = llm
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
        """Find and process all unconsolidated meetings."""
        cutoff = datetime.now(timezone.utc).replace(
            hour=datetime.now(timezone.utc).hour,
            minute=max(0, datetime.now(timezone.utc).minute - self.MIN_AGE_MINUTES),
        )

        try:
            meetings = list(self._mongo.meetings.find({
                "consolidated": False,
                "ended_at": {"$lt": int(cutoff.timestamp() * 1000)},
            }).limit(10))
        except Exception as e:
            logger.warning("Failed to query unconsolidated meetings: %s", e)
            return

        if not meetings:
            return

        logger.info("Processing %d unconsolidated meeting(s)", len(meetings))

        for meeting in meetings:
            try:
                self._consolidate_meeting(meeting)
            except Exception as e:
                logger.error("Failed to consolidate meeting %s: %s",
                             meeting.get("meeting_id"), e, exc_info=True)
                # Mark as consolidated with error to avoid infinite retries
                self._mark_error(meeting)

    def _consolidate_meeting(self, meeting: dict) -> None:
        """Extract structured entities from a single meeting and update MongoDB."""
        meeting_id = meeting.get("meeting_id", "unknown")
        transcript = meeting.get("transcript", [])
        participants = meeting.get("participants", [])

        if not transcript:
            logger.info("Meeting %s has no transcript, skipping extraction", meeting_id)
            self._mark_consolidated(meeting)
            return

        # Format transcript for LLM
        transcript_text = "\n".join(
            f"[{entry.get('speaker', 'Unknown')}]: {entry.get('text', '')}"
            for entry in transcript
            if entry.get("text", "").strip()
        )

        if not transcript_text.strip():
            logger.info("Meeting %s has empty transcript, skipping extraction", meeting_id)
            self._mark_consolidated(meeting)
            return

        # Call LLM for extraction
        prompt = EXTRACTION_PROMPT.format(
            transcript=transcript_text,
            participants=", ".join(participants),
        )

        try:
            resp = self._llm.invoke([HumanMessage(content=prompt)])
            text = resp.content.strip()

            # Strip markdown fences if model adds them
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

        # Update meeting document with extracted entities
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

        # Update project context
        self._update_project_context(meeting, extracted)

    def _update_project_context(self, meeting: dict, extracted: dict) -> None:
        """Update the rolling project context document with new meeting data."""
        project_key = meeting.get("project_key", "")
        if not project_key:
            return

        decisions = extracted.get("decisions", [])
        action_items = extracted.get("action_items", [])
        blockers = extracted.get("blockers", [])

        try:
            # Upsert project context
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

            # Append new decisions
            for d in decisions:
                ctx["recent_decisions"].append({
                    "text": d,
                    "meeting_id": meeting.get("meeting_id"),
                    "date": meeting.get("ended_at", 0),
                })
            # Keep only last 20 decisions
            ctx["recent_decisions"] = ctx["recent_decisions"][-20:]

            # Append new action items (only if not already present)
            existing_texts = {ai.get("text") for ai in ctx.get("open_action_items", [])}
            for ai_item in action_items:
                if ai_item.get("text") not in existing_texts:
                    ctx["open_action_items"].append({
                        "owner": ai_item.get("owner"),
                        "text": ai_item.get("text"),
                        "created_in": meeting.get("meeting_id"),
                    })

            # Update blockers
            ctx["open_blockers"] = [
                b.get("text", "") for b in blockers
            ]

            # Update last meeting timestamp
            ctx["last_meeting_at"] = meeting.get("ended_at", 0)

            # Upsert
            self._mongo.project_context.update_one(
                {"_id": project_key},
                {"$set": ctx},
                upsert=True,
            )
            logger.info("Project context updated for %s", project_key)
        except Exception as e:
            logger.error("Failed to update project context for %s: %s", project_key, e)

    def _mark_consolidated(self, meeting: dict) -> None:
        """Mark a meeting as consolidated (with empty extraction)."""
        try:
            self._mongo.meetings.update_one(
                {"_id": meeting["_id"]},
                {"$set": {
                    "consolidated": True,
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
                    "consolidated_at": datetime.now(timezone.utc),
                    "extraction_error": True,
                }},
            )
        except Exception as e:
            logger.error("Failed to mark meeting %s with error: %s",
                         meeting.get("meeting_id"), e)
