"""
core/embeddings.py — Semantic memory support.

Provides:
  - chunk_text(): sliding-window text chunking by token count
  - EmbeddingProvider: thin wrapper around Gemini embeddings, degrades to
    `None` (disabled) if no API key / package is available so the rest of
    the memory pipeline keeps working with regex-only search.
  - cosine_similarity(): pure-python vector similarity (no numpy dependency)

Vectors are stored as plain float lists directly on Mongo documents (in a
`meeting_chunks` collection). This works with any MongoDB (no Atlas Vector
Search required) — similarity is computed in Python over a pre-filtered
candidate set (scoped by project_key and/or recency), which is the right
tradeoff at the data volumes a single-team PM bot accumulates. If/when this
needs to scale past a few thousand chunks, swap `_brute_force_search` for an
Atlas `$vectorSearch` or an external vector DB — the interface is unchanged.
"""
from __future__ import annotations

import logging
import math
from typing import Any

from core.tokens import count_tokens

logger = logging.getLogger("agent_bridge.embeddings")


def chunk_text(text: str, chunk_tokens: int = 400, overlap_tokens: int = 60) -> list[str]:
    """
    Split text into overlapping chunks, sized by (approximate) token count.
    Splits on paragraph/line boundaries where possible to avoid cutting
    sentences mid-way, which keeps embedded chunks semantically coherent.
    """
    if not text or not text.strip():
        return []
    if count_tokens(text) <= chunk_tokens:
        return [text.strip()]

    lines = [l for l in text.split("\n") if l.strip()]
    chunks: list[str] = []
    current: list[str] = []
    current_tokens = 0

    for line in lines:
        line_tokens = count_tokens(line)
        if current and current_tokens + line_tokens > chunk_tokens:
            chunks.append("\n".join(current))
            # Build overlap from the tail of the previous chunk
            overlap: list[str] = []
            overlap_count = 0
            for prev_line in reversed(current):
                t = count_tokens(prev_line)
                if overlap_count + t > overlap_tokens:
                    break
                overlap.insert(0, prev_line)
                overlap_count += t
            current = overlap
            current_tokens = overlap_count
        current.append(line)
        current_tokens += line_tokens

    if current:
        chunks.append("\n".join(current))

    return chunks


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Pure-python cosine similarity — avoids a numpy dependency for what's
    typically a few hundred to a few thousand short comparisons per query."""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


class EmbeddingProvider:
    """
    Wraps langchain-google-genai's embeddings client. Instantiation never
    raises — call `.available` before use. This keeps semantic search purely
    additive: if GEMINI_API_KEY is unset or the package can't be imported,
    every caller falls back to regex/keyword search automatically.
    """

    def __init__(self, api_key: str, model: str = "models/text-embedding-004"):
        self.model = model
        self._client = None
        self.available = False

        if not api_key:
            logger.info("No Gemini API key configured — semantic memory search disabled.")
            return

        try:
            from langchain_google_genai import GoogleGenerativeAIEmbeddings
            self._client = GoogleGenerativeAIEmbeddings(model=model, google_api_key=api_key)
            self.available = True
        except Exception as e:
            logger.warning(
                "Embedding provider unavailable (%s) — falling back to keyword search only.", e
            )

    def embed_query(self, text: str) -> list[float] | None:
        if not self.available or not text.strip():
            return None
        try:
            return self._client.embed_query(text)
        except Exception as e:
            logger.warning("embed_query failed: %s", e)
            return None

    def embed_documents(self, texts: list[str]) -> list[list[float]] | None:
        if not self.available or not texts:
            return None
        try:
            return self._client.embed_documents(texts)
        except Exception as e:
            logger.warning("embed_documents failed: %s", e)
            return None


def rank_by_similarity(
    query_vector: list[float],
    candidates: list[dict[str, Any]],
    vector_field: str = "embedding",
    top_k: int = 5,
) -> list[dict[str, Any]]:
    """
    Score and sort a list of candidate documents (each carrying a stored
    embedding under `vector_field`) against a query vector. Documents missing
    an embedding score 0 and sink to the bottom rather than erroring out —
    lets old pre-embedding records coexist with new ones during rollout.
    """
    scored = []
    for doc in candidates:
        vec = doc.get(vector_field)
        score = cosine_similarity(query_vector, vec) if vec else 0.0
        scored.append((score, doc))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [dict(doc, _score=score) for score, doc in scored[:top_k]]
