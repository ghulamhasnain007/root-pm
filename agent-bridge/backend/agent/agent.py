"""
agent/agent.py
--------------
AgentBridge — full pipeline using LangChain 1.x native tool-calling loop.
No AgentExecutor — uses the bind_tools + manual ReAct pattern that works
with LangChain >= 1.0 and Gemini.

Memory architecture:
  - DualMemoryStore: Redis (short-term conversation history) + MongoDB (long-term meeting data)
  - ChannelMemoryStore: In-memory fallback for standalone mode (no Redis/MongoDB)
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.tools import BaseTool
from langchain_core.messages import (
    HumanMessage, SystemMessage, AIMessage, ToolMessage, BaseMessage
)

from core.base import (
    IncomingMessage, OutgoingMessage,
    CommunicationPlatform, ProjectManagementPlatform, ProjectContext,
    MemoryStore,
)
from agent.tools import build_tools

logger = logging.getLogger("agent_bridge.agent")


# ── System prompt ──────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """\
You are Agent Bridge, a project management assistant embedded in {comm_platform}.
You help the team manage their work in {pm_platform}.

## Current Project: {project_name}
- Active Sprint: {active_sprint} (ends {sprint_end})
- Open Tasks: {open_tasks}  |  Open Issues: {open_issues}  |  Open Stories: {open_stories}
- Team members: {members}

## Recent meeting context
{meetings}

## Guidelines
- Use available tools to perform actions — never fabricate IDs or data.
- If a request is ambiguous, ask ONE short clarifying question before acting.
- For bulk or destructive actions (closing many items), confirm with the user first.
- Keep replies concise and clear. Use ✅ for success, ❌ for errors.
- When you create or close an item, always include the item ID and URL if available.
- If you cannot find a user by username, call list_members first.
- You may reference details from the meeting transcripts above (people, decisions,
  tasks discussed) when answering — prefer them over guessing.
- Today you are speaking with: {author_name} (permission tier: {tier})
"""

# ── Intent classifier ──────────────────────────────────────────────────────────

CLASSIFIER_PROMPT = """\
Classify this project management message. Respond ONLY with valid JSON, no markdown fences.

Message: {message}

JSON (exactly this schema):
{{"intent": "create|update|close|list|query|search|summarize|unknown",
  "resource": "task|story|epic|issue|sprint|project|unknown",
  "confidence": 0.95,
  "needs_write": false}}"""


class IntentRouter:
    def __init__(self, api_key: str, model: str = "gemini-2.5-flash"):
        self._llm = ChatGoogleGenerativeAI(
            model=model, google_api_key=api_key, temperature=0)

    def classify(self, message: str) -> dict[str, Any]:
        try:
            resp = self._llm.invoke([
                HumanMessage(content=CLASSIFIER_PROMPT.format(message=message))
            ])
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
            return json.loads(text)
        except Exception as e:
            logger.warning("Intent classification failed (%s), defaulting to unknown", e)
            return {"intent": "unknown", "resource": "unknown",
                    "confidence": 0.0, "needs_write": True}


# ── In-memory fallback (standalone mode, no Redis/MongoDB) ─────────────────────

class ChannelMemoryStore:
    """
    Stores conversation history per Discord channel as a list of BaseMessage.
    Uses a simple ring buffer bounded by max_messages to avoid context overflow.
    Fallback for standalone mode when Redis/MongoDB are not available.
    """
    def __init__(self, max_messages: int = 20):
        self._store: dict[str, list[BaseMessage]] = {}
        self._max = max_messages

    def get(self, channel_id: str) -> list[BaseMessage]:
        return self._store.setdefault(channel_id, [])

    def append(self, channel_id: str, messages: list[BaseMessage]) -> None:
        buf = self._store.setdefault(channel_id, [])
        buf.extend(messages)
        # Keep only the last N messages to avoid context overflow
        if len(buf) > self._max:
            self._store[channel_id] = buf[-self._max:]

    def clear(self, channel_id: str) -> None:
        self._store.pop(channel_id, None)

    def get_meeting_context(self, channel_id: str) -> list[str]:
        """
        Return the raw text of every injected meeting summary
        ("[MEETING CONTEXT ...]" SystemMessages) for a channel, oldest first.
        These are surfaced to the agent through the system prompt so context
        survives even after the last-30-messages ring buffer drops them.
        """
        buf = self.get(channel_id)
        return [
            m.content
            for m in buf
            if isinstance(m, SystemMessage) and m.content.startswith("[MEETING CONTEXT")
        ]


# ── Dual-layer memory store (Redis short-term + MongoDB long-term) ─────────────

_MESSAGE_TYPE_MAP = {
    "human": HumanMessage,
    "ai": AIMessage,
    "system": SystemMessage,
    "tool": ToolMessage,
}


def _serialize_message(msg: BaseMessage) -> dict:
    """Convert a BaseMessage to a JSON-serializable dict."""
    msg_type = type(msg).__name__.lower().replace("message", "")
    if msg_type == "base":
        msg_type = "human"
    return {
        "type": msg_type,
        "content": msg.content,
        "ts": time.time(),
    }


def _deserialize_message(data: dict) -> BaseMessage:
    """Convert a dict back to a BaseMessage."""
    msg_type = data.get("type", "human")
    cls = _MESSAGE_TYPE_MAP.get(msg_type, HumanMessage)
    return cls(content=data.get("content", ""))


class DualMemoryStore(MemoryStore):
    """
    Redis for hot path (conversation history, live transcripts).
    MongoDB for durable long-term (meeting summaries, extracted entities).

    Keys:
      channel:{channel_id}:history  — Redis LIST of serialized messages, TTL 7 days
      meeting:{meeting_id}:transcript — Redis LIST of transcript lines, TTL 24h
      meeting:{meeting_id}:standup  — Redis HASH of standup data, TTL 24h
    """

    def __init__(
        self,
        redis_client,
        mongo_db,
        max_messages: int = 50,
        history_ttl_seconds: int = 7 * 86400,
        meeting_ttl_seconds: int = 24 * 3600,
    ):
        self._redis = redis_client
        self._mongo = mongo_db
        self._max = max_messages
        self._history_ttl = history_ttl_seconds
        self._meeting_ttl = meeting_ttl_seconds

    # ── Conversation history (Redis) ──────────────────────────────────────────

    def get(self, channel_id: str) -> list[BaseMessage]:
        key = f"channel:{channel_id}:history"
        try:
            raw_list = self._redis.lrange(key, 0, -1)
            return [_deserialize_message(json.loads(r)) for r in raw_list]
        except Exception as e:
            logger.warning("Redis get failed for channel %s: %s", channel_id, e)
            return []

    def append(self, channel_id: str, messages: list[BaseMessage]) -> None:
        key = f"channel:{channel_id}:history"
        try:
            pipe = self._redis.pipeline()
            for msg in messages:
                pipe.rpush(key, json.dumps(_serialize_message(msg)))
            pipe.ltrim(key, -self._max, -1)
            pipe.expire(key, self._history_ttl)
            pipe.execute()
        except Exception as e:
            logger.warning("Redis append failed for channel %s: %s", channel_id, e)

    def clear(self, channel_id: str) -> None:
        key = f"channel:{channel_id}:history"
        try:
            self._redis.delete(key)
        except Exception as e:
            logger.warning("Redis clear failed for channel %s: %s", channel_id, e)

    # ── Meeting context (MongoDB long-term) ───────────────────────────────────

    def get_meeting_context(self, channel_id: str) -> list[str]:
        """
        Query MongoDB for the last 3 consolidated meetings for this channel.
        Returns formatted summaries for the system prompt.
        """
        try:
            meetings = list(
                self._mongo.meetings.find({"text_channel_id": channel_id})
                .sort("ended_at", -1)
                .limit(3)
            )
        except Exception as e:
            logger.warning("MongoDB query failed for meeting context: %s", e)
            return []

        summaries = []
        for m in meetings:
            summaries.append(self._format_meeting_summary(m))
        return summaries

    def _format_meeting_summary(self, meeting: dict) -> str:
        """Format a MongoDB meeting document into a readable summary."""
        participants = meeting.get("participants", [])
        decisions = meeting.get("decisions", [])
        action_items = meeting.get("action_items", [])
        blockers = meeting.get("blockers", [])
        standups = meeting.get("standups", {})
        ended_at = meeting.get("ended_at", "")
        duration_min = meeting.get("duration_min", 0)
        topics = meeting.get("topics", [])

        lines = [f"[MEETING — {ended_at} | {duration_min} min]"]
        lines.append(f"Participants: {', '.join(participants) or 'unknown'}")

        if topics:
            lines.append(f"Topics: {', '.join(topics)}")

        if decisions:
            lines.append("Decisions:")
            for d in decisions:
                lines.append(f"  - {d}")

        if action_items:
            lines.append("Action items:")
            for ai_item in action_items:
                owner = ai_item.get("owner", "?")
                text = ai_item.get("text", "")
                task_id = ai_item.get("task_id")
                task_ref = f" (→ {task_id})" if task_id else ""
                lines.append(f"  - [{owner}] {text}{task_ref}")

        if blockers:
            lines.append("Blockers:")
            for b in blockers:
                owner = b.get("owner", "?")
                text = b.get("text", "")
                lines.append(f"  - [{owner}] {text}")

        if standups:
            lines.append("Standups:")
            for person, data in standups.items():
                if isinstance(data, dict):
                    yesterday = data.get("yesterday", [])
                    today = data.get("today", [])
                    person_blockers = data.get("blockers", [])
                    lines.append(f"  - {person}:")
                    if yesterday:
                        lines.append(f"    Yesterday: {'; '.join(yesterday)}")
                    if today:
                        lines.append(f"    Today: {'; '.join(today)}")
                    if person_blockers:
                        lines.append(f"    Blockers: {'; '.join(person_blockers)}")

        return "\n".join(lines)

    # ── Meeting persistence (write path) ──────────────────────────────────────

    def save_meeting(self, event: dict) -> None:
        """
        Persist a meeting.ended event to MongoDB.
        Called by MeetingMemoryInjector after injecting into channel memory.
        """
        meeting_id = event.get("meetingId", "unknown")
        summary = event.get("summary", {})
        duration_ms = event.get("durationMs", 0)

        participants = [p.get("name", "?") for p in event.get("participants", [])]
        full_transcript = summary.get("fullTranscript", [])
        tasks_created = summary.get("tasksCreated", [])
        tasks_closed = summary.get("tasksClosed", [])

        # Parse standup data from transcript (if standup format detected)
        standups = self._parse_standups_from_transcript(full_transcript, participants)

        doc = {
            "meeting_id": meeting_id,
            "text_channel_id": event.get("channelId", ""),
            "started_at": event.get("startedAt", 0),
            "ended_at": event.get("endedAt", 0),
            "duration_min": round(duration_ms / 60_000, 1),
            "participants": participants,
            "transcript": [
                {
                    "speaker": entry.get("speakerName", "Unknown"),
                    "text": entry.get("text", ""),
                    "ts": entry.get("timestamp", 0),
                    "role": entry.get("role", "user"),
                }
                for entry in full_transcript
            ],
            "standups": standups,
            "tasks_created": tasks_created,
            "tasks_closed": tasks_closed,
            "decisions": [],       # Populated by consolidation worker
            "action_items": [],    # Populated by consolidation worker
            "blockers": [],        # Populated by consolidation worker
            "topics": [],          # Populated by consolidation worker
            "consolidated": False,
            "stored_at": datetime.now(timezone.utc),
        }

        try:
            self._mongo.meetings.insert_one(doc)
            logger.info("Meeting %s persisted to MongoDB (%d transcript lines)",
                        meeting_id, len(full_transcript))
        except Exception as e:
            logger.error("Failed to persist meeting %s to MongoDB: %s", meeting_id, e)

        # Also store raw transcript in Redis for quick access (24h TTL)
        self._store_meeting_transcript_redis(meeting_id, full_transcript)

    def _store_meeting_transcript_redis(self, meeting_id: str, transcript: list) -> None:
        """Store raw transcript in Redis with 24h TTL for quick recall."""
        key = f"meeting:{meeting_id}:transcript"
        try:
            pipe = self._redis.pipeline()
            for entry in transcript:
                pipe.rpush(key, json.dumps({
                    "speaker": entry.get("speakerName", "Unknown"),
                    "text": entry.get("text", ""),
                    "ts": entry.get("timestamp", 0),
                }))
            pipe.expire(key, self._meeting_ttl)
            pipe.execute()
        except Exception as e:
            logger.warning("Failed to store transcript in Redis: %s", e)

    def _parse_standups_from_transcript(
        self, transcript: list, participants: list
    ) -> dict:
        """
        Extract standup data from transcript if it follows the standup format.
        Returns a dict like {participant_name: {yesterday: [...], today: [...], blockers: [...]}}.
        """
        standups = {}
        for name in participants:
            standups[name] = {"yesterday": [], "today": [], "blockers": []}

        # Simple heuristic: look for standup keywords in transcript
        current_speaker = None
        for entry in transcript:
            speaker = entry.get("speakerName", "")
            text = entry.get("text", "").lower().strip()
            if speaker in standups:
                current_speaker = speaker
            if current_speaker and current_speaker in standups:
                if "yesterday" in text or "what i did" in text:
                    standups[current_speaker]["yesterday"].append(entry.get("text", ""))
                elif "today" in text or "what i will" in text or "going to" in text:
                    standups[current_speaker]["today"].append(entry.get("text", ""))
                elif "blocker" in text or "blocked" in text or "issue" in text:
                    standups[current_speaker]["blockers"].append(entry.get("text", ""))

        return standups

    def get_meeting_transcript(self, meeting_id: str) -> list[dict]:
        """Read raw transcript from Redis for deep recall."""
        key = f"meeting:{meeting_id}:transcript"
        try:
            raw_list = self._redis.lrange(key, 0, -1)
            return [json.loads(r) for r in raw_list]
        except Exception as e:
            logger.warning("Redis get transcript failed for %s: %s", meeting_id, e)
            return []

    def search_meetings(self, query: str, project_key: str | None = None) -> list[dict]:
        """
        Search MongoDB meetings collection for matching transcripts.
        Returns matching meeting summaries with context.
        """
        try:
            filter_query: dict = {"consolidated": True}
            if project_key:
                filter_query["project_key"] = project_key

            # Text search on transcript
            filter_query["$or"] = [
                {"transcript.text": {"$regex": query, "$options": "i"}},
                {"decisions": {"$regex": query, "$options": "i"}},
                {"topics": {"$regex": query, "$options": "i"}},
            ]

            meetings = list(
                self._mongo.meetings.find(filter_query)
                .sort("ended_at", -1)
                .limit(5)
            )
            return meetings
        except Exception as e:
            logger.warning("MongoDB search_meetings failed: %s", e)
            return []

    def get_project_decisions(self, project_key: str) -> list[dict]:
        """Get recent decisions from consolidated meetings for a project."""
        try:
            meetings = list(
                self._mongo.meetings.find(
                    {"project_key": project_key, "consolidated": True, "decisions": {"$ne": []}}
                )
                .sort("ended_at", -1)
                .limit(5)
            )
            decisions = []
            for m in meetings:
                for d in m.get("decisions", []):
                    decisions.append({
                        "decision": d,
                        "meeting_id": m.get("meeting_id"),
                        "date": m.get("ended_at"),
                    })
            return decisions[:10]
        except Exception as e:
            logger.warning("MongoDB get_project_decisions failed: %s", e)
            return []


# ── ReAct tool-calling loop ───────────────────────────────────────────────────

def _run_agent_loop(
    llm_with_tools,
    tools_by_name: dict[str, BaseTool],
    messages: list[BaseMessage],
    max_iterations: int = 8,
) -> tuple[str, list[BaseMessage]]:
    """
    LangChain 1.x native ReAct loop:
      1. Call LLM with current message list
      2. If response has tool_calls → execute each tool, append ToolMessage results
      3. Repeat until no tool_calls or max_iterations reached
    Returns (final_text_reply, new_messages_to_store)
    """
    new_messages: list[BaseMessage] = []
    iteration = 0

    while iteration < max_iterations:
        iteration += 1
        response: AIMessage = llm_with_tools.invoke(messages + new_messages)

        if not response.tool_calls:
            # No tool calls — this is the final answer
            final = response.content or "I wasn't able to complete that request."
            new_messages.append(response)
            return final, new_messages

        # Execute all tool calls in this step
        new_messages.append(response)
        for tc in response.tool_calls:
            tool_name = tc["name"]
            tool_args = tc["args"]
            tool_id   = tc["id"]

            logger.info("Tool call: %s(%s)", tool_name, tool_args)

            tool_fn = tools_by_name.get(tool_name)
            if tool_fn is None:
                tool_result = f"Error: tool '{tool_name}' not found."
            else:
                try:
                    tool_result = tool_fn.invoke(tool_args)
                    if not isinstance(tool_result, str):
                        tool_result = str(tool_result)
                except Exception as e:
                    tool_result = f"Error executing {tool_name}: {e}"
                    logger.error("Tool %s failed: %s", tool_name, e)

            logger.info("Tool result: %s", tool_result[:200])
            new_messages.append(ToolMessage(content=tool_result, tool_call_id=tool_id))

    # Max iterations reached
    return "I reached the maximum number of steps. Please try a simpler request.", new_messages


# ── Main agent orchestrator ────────────────────────────────────────────────────

class AgentBridge:
    """Full pipeline from IncomingMessage to OutgoingMessage."""

    def __init__(
        self,
        comm_platform: CommunicationPlatform,
        pm_platform: ProjectManagementPlatform,
        gemini_api_key: str,
        agent_model: str = "gemini-2.5-flash",
        classifier_model: str = "gemini-2.5-flash",
        max_iterations: int = 8,
        memory_max_tokens: int = 2000,
        memory_store: MemoryStore | None = None,
    ):
        self.comm = comm_platform
        self.pm   = pm_platform

        self._router  = IntentRouter(gemini_api_key, classifier_model)
        self._memory  = memory_store or ChannelMemoryStore(max_messages=30)
        self._llm     = ChatGoogleGenerativeAI(
            model=agent_model, google_api_key=gemini_api_key, temperature=0)
        self._max_iter = max_iterations

        self._project_id_cache: dict[str, str] = {}

    async def handle(self, incoming: IncomingMessage) -> OutgoingMessage:
        logger.info("[%s] %s: %s",
                    incoming.channel_id, incoming.author_name, incoming.content[:100])

        # ── 1. Resolve project ───────────────────────────────────────────────
        project_key = self.comm.resolve_project_key(
            incoming.server_id, incoming.channel_id)
        if not project_key:
            return OutgoingMessage(
                channel_id=incoming.channel_id,
                content=(
                    "⚠️ This channel is not linked to a Taiga project.\n"
                    "Ask an admin to configure it in the Agent Bridge dashboard.\n"
                    f"Channel ID: `{incoming.channel_id}` | Server ID: `{incoming.server_id}`"
                ),
            )

        try:
            project_id = self._get_project_id(project_key)
        except Exception as e:
            logger.error("Could not resolve project '%s': %s", project_key, e)
            return OutgoingMessage(
                channel_id=incoming.channel_id,
                content=f"❌ Could not find Taiga project `{project_key}`: {e}",
            )

        # ── 2. RBAC ──────────────────────────────────────────────────────────
        tier = self.comm.get_permission_tier(incoming.author_roles)
        logger.info("User %s roles=%s → tier=%s", incoming.author_name, incoming.author_roles, tier)

        if tier == "none":
            return OutgoingMessage(
                channel_id=incoming.channel_id,
                content="🚫 You don't have permission to use this bot. Contact your Project Manager.",
            )

        # ── 3. Intent routing ────────────────────────────────────────────────
        intent = self._router.classify(incoming.content)
        logger.info("Intent: %s | resource: %s | needs_write: %s | confidence: %s",
                    intent.get("intent"), intent.get("resource"),
                    intent.get("needs_write"), intent.get("confidence"))

        if intent.get("needs_write") and tier == "read":
            return OutgoingMessage(
                channel_id=incoming.channel_id,
                content="🚫 You have **read-only** access and cannot create, update, or close items.",
            )

        # ── 4. Project context ───────────────────────────────────────────────
        ctx: ProjectContext | None = None
        try:
            ctx = self.pm.get_project_context(project_id)
        except Exception as e:
            logger.warning("Could not fetch project context: %s", e)

        # ── 5. Build tools and LLM ───────────────────────────────────────────
        tools = build_tools(self.pm, project_id, tier, memory_store=self._memory)
        tools_by_name = {t.name: t for t in tools}
        llm_with_tools = self._llm.bind_tools(tools)

        member_list = ", ".join(
            f"{m['username']} ({m.get('role', '')})"
            for m in (ctx.members if ctx else [])
        ) or "No member data available"

        meetings_text = "\n\n".join(
            self._memory.get_meeting_context(incoming.channel_id)[-3:]
        ) or "No meeting context recorded yet for this channel."

        system_text = SYSTEM_PROMPT.format(
            comm_platform  = self.comm.display_name,
            pm_platform    = self.pm.display_name,
            project_name   = ctx.project_name if ctx else project_key,
            active_sprint  = (ctx.active_sprint or "None") if ctx else "Unknown",
            sprint_end     = (ctx.sprint_end_date or "—") if ctx else "—",
            open_tasks     = ctx.open_task_count  if ctx else "?",
            open_issues    = ctx.open_issue_count if ctx else "?",
            open_stories   = ctx.open_story_count if ctx else "?",
            members        = member_list,
            meetings       = meetings_text,
            author_name    = incoming.author_name,
            tier           = tier,
        )

        # ── 6. Retrieve channel memory ───────────────────────────────────────
        history = self._memory.get(incoming.channel_id)
        # Meeting transcripts are surfaced through the system prompt section
        # above — drop the full SystemMessage copies from history so the same
        # transcript isn't fed through twice.
        history = [
            m for m in history
            if not (isinstance(m, SystemMessage)
                    and m.content.startswith("[MEETING CONTEXT"))
        ]

        # Full message list: system + history + new user message
        all_messages: list[BaseMessage] = (
            [SystemMessage(content=system_text)]
            + history
            + [HumanMessage(content=incoming.content)]
        )

        # ── 7. Run agent loop ────────────────────────────────────────────────
        try:
            reply, new_msgs = _run_agent_loop(
                llm_with_tools, tools_by_name, all_messages, self._max_iter)
        except Exception as e:
            logger.exception("Agent loop failed")
            reply = f"❌ An error occurred while processing your request: {e}"
            new_msgs = []

        # ── 8. Save to memory ────────────────────────────────────────────────
        # Store user message + all agent loop messages (tool calls + final answer)
        self._memory.append(incoming.channel_id, [
            HumanMessage(content=incoming.content),
            *new_msgs,
        ])

        return OutgoingMessage(
            channel_id          = incoming.channel_id,
            content             = reply,
            reply_to_message_id = incoming.platform_message_id,
        )

    def _get_project_id(self, key: str) -> str:
        if key not in self._project_id_cache:
            self._project_id_cache[key] = self.pm.get_project_id(key)
        return self._project_id_cache[key]
