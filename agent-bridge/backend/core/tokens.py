"""
core/tokens.py — Token counting for memory/context budgeting.

Uses tiktoken when available (close enough for Gemini models — we care about
a stable, fast *relative* budget more than exact provider parity). Falls back
to a conservative chars/4 heuristic so the rest of the memory system never
hard-fails just because tiktoken isn't installed.
"""
from __future__ import annotations

from functools import lru_cache

try:
    import tiktoken
    _ENCODING = tiktoken.get_encoding("cl100k_base")
except Exception:  # pragma: no cover - exercised when tiktoken isn't installed
    tiktoken = None
    _ENCODING = None


def count_tokens(text: str) -> int:
    """Best-effort token count for a string."""
    if not text:
        return 0
    if _ENCODING is not None:
        try:
            return len(_ENCODING.encode(text))
        except Exception:
            pass
    # Heuristic fallback: ~4 chars/token for English text.
    return max(1, len(text) // 4)


def count_message_tokens(role: str, content: str) -> int:
    """Token count for a chat message, including a small per-message overhead
    (role tag, separators) similar to OpenAI/Gemini chat formatting cost."""
    return count_tokens(content) + count_tokens(role) + 4


@lru_cache(maxsize=2048)
def _cached_count(text: str) -> int:
    return count_tokens(text)


def truncate_to_tokens(text: str, max_tokens: int) -> str:
    """Truncate text to at most max_tokens, preferring to cut on a line break."""
    if max_tokens <= 0 or not text:
        return ""
    if count_tokens(text) <= max_tokens:
        return text

    if _ENCODING is not None:
        try:
            tokens = _ENCODING.encode(text)
            return _ENCODING.decode(tokens[:max_tokens])
        except Exception:
            pass

    # Heuristic fallback
    approx_chars = max_tokens * 4
    truncated = text[:approx_chars]
    last_break = truncated.rfind("\n")
    if last_break > approx_chars * 0.5:
        truncated = truncated[:last_break]
    return truncated + "\n…[truncated]"
