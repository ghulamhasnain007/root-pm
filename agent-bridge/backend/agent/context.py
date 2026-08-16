"""
agent/context.py — Token-budgeted context assembly.

Replaces the old "always inject the last 3 meetings + last N messages"
behavior with a real budget: meeting context and conversation history are
trimmed to fit `memory_max_tokens` (previously loaded but never enforced),
so the agent never silently blows past the model's context window when a
channel has a lot of history or a long, relevant meeting transcript.

Priority order when trimming (highest priority survives first):
  1. System rules / project context header (never trimmed — small & fixed)
  2. Relevant meeting context (ranked by the caller — semantic search result
     order if available, else most-recent-first)
  3. Recent conversation history (most recent messages kept first)
"""
from __future__ import annotations

from dataclasses import dataclass, field

from langchain_core.messages import BaseMessage

from core.tokens import count_message_tokens, count_tokens, truncate_to_tokens


@dataclass
class AssembledContext:
    meeting_summaries: list[str]
    history: list[BaseMessage]
    meeting_tokens: int = 0
    history_tokens: int = 0
    meetings_dropped: int = 0
    history_dropped: int = 0
    debug: dict = field(default_factory=dict)


class ContextAssembler:
    """
    total_budget_tokens: the full `memory_max_tokens` setting.
    system_reserve_tokens: rough estimate for the fixed parts of the system
        prompt (instructions, project stats, member list) — left untouched.
    reply_reserve_tokens: headroom left for the model's own reply + tool
        call/result round-trips, so the *input* budget doesn't consume 100%
        of the context window.
    """

    def __init__(
        self,
        total_budget_tokens: int = 2000,
        system_reserve_tokens: int = 400,
        reply_reserve_tokens: int = 512,
        meeting_share: float = 0.5,
    ):
        self.total_budget_tokens = max(total_budget_tokens, system_reserve_tokens + 200)
        self.system_reserve_tokens = system_reserve_tokens
        self.reply_reserve_tokens = reply_reserve_tokens
        self.meeting_share = meeting_share

    @property
    def available_tokens(self) -> int:
        return max(
            200,
            self.total_budget_tokens - self.system_reserve_tokens - self.reply_reserve_tokens,
        )

    def assemble(
        self,
        meeting_summaries: list[str],
        history: list[BaseMessage],
    ) -> AssembledContext:
        available = self.available_tokens
        meeting_budget = int(available * self.meeting_share)
        history_budget = available - meeting_budget

        picked_meetings, meeting_tokens, meetings_dropped = self._fit_meetings(
            meeting_summaries, meeting_budget
        )
        # Give any unused meeting budget back to history — most conversations
        # don't have 3+ relevant meetings, and recent chat context is usually
        # more useful than padding.
        leftover = max(0, meeting_budget - meeting_tokens)
        picked_history, history_tokens, history_dropped = self._fit_history(
            history, history_budget + leftover
        )

        return AssembledContext(
            meeting_summaries=picked_meetings,
            history=picked_history,
            meeting_tokens=meeting_tokens,
            history_tokens=history_tokens,
            meetings_dropped=meetings_dropped,
            history_dropped=history_dropped,
            debug={
                "total_budget_tokens": self.total_budget_tokens,
                "available_tokens": available,
                "meeting_budget": meeting_budget,
                "history_budget": history_budget,
                "meeting_tokens_used": meeting_tokens,
                "history_tokens_used": history_tokens,
            },
        )

    @staticmethod
    def _fit_meetings(meetings: list[str], budget: int) -> tuple[list[str], int, int]:
        """Greedily keep meetings (assumed pre-ranked, most relevant first)
        until the budget runs out; truncate the last one that partially fits
        rather than dropping it entirely. `dropped` only counts meetings that
        received zero space — a truncated-but-included meeting is not
        counted as dropped."""
        picked: list[str] = []
        used = 0
        dropped = 0
        for m in meetings:
            if used >= budget:
                dropped += 1
                continue
            t = count_tokens(m)
            if used + t <= budget:
                picked.append(m)
                used += t
                continue
            remaining = budget - used
            if remaining > 100:  # only worth truncating if meaningful room left
                truncated = truncate_to_tokens(m, remaining)
                picked.append(truncated)
                used += count_tokens(truncated)
            else:
                dropped += 1
        return picked, used, dropped

    @staticmethod
    def _fit_history(history: list[BaseMessage], budget: int) -> tuple[list[BaseMessage], int, int]:
        """Keep the most recent messages that fit the budget (walk backwards),
        then restore chronological order."""
        kept: list[BaseMessage] = []
        used = 0
        dropped = 0
        for msg in reversed(history):
            role = getattr(msg, "type", msg.__class__.__name__)
            content = msg.content if isinstance(msg.content, str) else str(msg.content)
            t = count_message_tokens(role, content)
            if used + t > budget:
                dropped += 1
                continue
            kept.append(msg)
            used += t
        kept.reverse()
        return kept, used, dropped
