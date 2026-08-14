"""
agent/agent.py
--------------
AgentBridge — full pipeline using LangChain 1.x native tool-calling loop.
No AgentExecutor — uses the bind_tools + manual ReAct pattern that works
with LangChain >= 1.0 and Gemini.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.tools import BaseTool
from langchain_core.messages import (
    HumanMessage, SystemMessage, AIMessage, ToolMessage, BaseMessage
)

from core.base import (
    IncomingMessage, OutgoingMessage,
    CommunicationPlatform, ProjectManagementPlatform, ProjectContext,
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

## Guidelines
- Use available tools to perform actions — never fabricate IDs or data.
- If a request is ambiguous, ask ONE short clarifying question before acting.
- For bulk or destructive actions (closing many items), confirm with the user first.
- Keep replies concise and clear. Use ✅ for success, ❌ for errors.
- When you create or close an item, always include the item ID and URL if available.
- If you cannot find a user by username, call list_members first.
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


# ── Per-channel conversation memory ───────────────────────────────────────────

class ChannelMemoryStore:
    """
    Stores conversation history per Discord channel as a list of BaseMessage.
    Uses a simple ring buffer bounded by max_messages to avoid context overflow.
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
    ):
        self.comm = comm_platform
        self.pm   = pm_platform

        self._router  = IntentRouter(gemini_api_key, classifier_model)
        self._memory  = ChannelMemoryStore(max_messages=30)
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
        tools = build_tools(self.pm, project_id, tier)
        tools_by_name = {t.name: t for t in tools}
        llm_with_tools = self._llm.bind_tools(tools)

        member_list = ", ".join(
            f"{m['username']} ({m.get('role', '')})"
            for m in (ctx.members if ctx else [])
        ) or "No member data available"

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
            author_name    = incoming.author_name,
            tier           = tier,
        )

        # ── 6. Retrieve channel memory ───────────────────────────────────────
        history = self._memory.get(incoming.channel_id)

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
