"""
routers/memory.py — Memory management endpoints for the dashboard.
Provides read/delete access to conversation history, meeting data, the
reconciled project context (open action items, durable facts), and a debug
endpoint for inspecting what context would be assembled for a channel.

Connections are cached at module scope instead of opened per-request — the
previous version constructed a new pymongo.MongoClient/redis.Redis on every
single call, which is needless connection churn under load.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException

logger = logging.getLogger("agent_bridge.routers.memory")
router = APIRouter()

MAX_LIST_LIMIT = 100

_redis_client = None
_mongo_client = None
_mongo_db = None


def _get_redis():
    """Get a cached Redis client, reconnecting if the config URL changed or
    the previous connection died."""
    global _redis_client
    try:
        from core.store import get_config
        cfg = get_config()
        if _redis_client is None:
            import redis
            _redis_client = redis.Redis.from_url(cfg.redis.url, decode_responses=True)
        _redis_client.ping()
        return _redis_client
    except Exception:
        _redis_client = None
        return None


def _get_mongo():
    """Get a cached MongoDB database handle, reconnecting on failure."""
    global _mongo_client, _mongo_db
    try:
        from core.store import get_config
        cfg = get_config()
        if _mongo_client is None:
            import pymongo
            _mongo_client = pymongo.MongoClient(cfg.mongo.uri, serverSelectionTimeoutMS=3000)
            _mongo_db = _mongo_client[cfg.mongo.database]
        _mongo_client.admin.command("ping")
        return _mongo_db
    except Exception:
        _mongo_client = None
        _mongo_db = None
        return None


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """
    Optional API-key gate for memory endpoints — these expose meeting
    transcripts and project facts, which can be sensitive. Set MEMORY_API_KEY
    to require `X-API-Key` on every request under this router; leave it unset
    to preserve the previous (dev-only) unauthenticated behavior.
    """
    from core.settings import DEFAULT_MEMORY_API_KEY
    if not DEFAULT_MEMORY_API_KEY:
        return
    if x_api_key != DEFAULT_MEMORY_API_KEY:
        raise HTTPException(status_code=401, detail="Missing or invalid X-API-Key")


router.dependencies.append(Depends(require_api_key))


def _serialize(doc: dict) -> dict:
    """Convert ObjectId/datetime fields to JSON-safe values."""
    doc = dict(doc)
    if "_id" in doc:
        doc["_id"] = str(doc["_id"])
    for key in ("stored_at", "consolidated_at", "consolidating_at", "created_at", "superseded_at"):
        val = doc.get(key)
        if hasattr(val, "isoformat"):
            doc[key] = val.isoformat()
    return doc


@router.get("/stats")
def memory_stats() -> dict[str, Any]:
    """Get memory usage statistics."""
    stats: dict[str, Any] = {
        "redis": {"connected": False, "channels": 0, "meetings": 0},
        "mongo": {"connected": False, "meetings": 0, "projects": 0,
                  "facts": 0, "indexed_chunks": 0},
    }

    r = _get_redis()
    if r:
        try:
            stats["redis"]["connected"] = True
            channel_keys = list(r.scan_iter("channel:*:history", count=100))
            stats["redis"]["channels"] = len(channel_keys)
            meeting_keys = list(r.scan_iter("meeting:*:transcript", count=100))
            stats["redis"]["meetings"] = len(meeting_keys)
        except Exception:
            pass

    db = _get_mongo()
    if db:
        try:
            stats["mongo"]["connected"] = True
            stats["mongo"]["meetings"] = db.meetings.count_documents({})
            stats["mongo"]["projects"] = db.project_context.count_documents({})
            stats["mongo"]["facts"] = db.project_facts.count_documents({"superseded": {"$ne": True}})
            stats["mongo"]["indexed_chunks"] = db.meeting_chunks.count_documents({})
        except Exception:
            pass

    return stats


@router.get("/channels")
def list_channels() -> list[dict[str, Any]]:
    """List all channels with stored conversation history."""
    r = _get_redis()
    if not r:
        return []
    try:
        channel_keys = list(r.scan_iter("channel:*:history", count=100))
        channels = []
        for key in channel_keys:
            channel_id = key.replace("channel:", "").replace(":history", "")
            channels.append({
                "channel_id": channel_id,
                "message_count": r.llen(key),
                "ttl_seconds": r.ttl(key),
            })
        return channels
    except Exception:
        return []


@router.delete("/channels/{channel_id}")
def clear_channel(channel_id: str) -> dict[str, str]:
    """Clear conversation history for a channel."""
    r = _get_redis()
    if not r:
        raise HTTPException(status_code=503, detail="Redis not available")
    try:
        r.delete(f"channel:{channel_id}:history")
        return {"status": "ok", "message": f"Cleared history for channel {channel_id}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/meetings")
def list_meetings(limit: int = 20, offset: int = 0) -> list[dict[str, Any]]:
    """List stored meetings from MongoDB."""
    db = _get_mongo()
    if not db:
        return []
    limit = max(1, min(limit, MAX_LIST_LIMIT))
    offset = max(0, offset)
    try:
        meetings = list(
            db.meetings.find({}, {"transcript": 0})
            .sort("ended_at", -1)
            .skip(offset)
            .limit(limit)
        )
        return [_serialize(m) for m in meetings]
    except Exception:
        return []


@router.get("/meetings/{meeting_id}")
def get_meeting(meeting_id: str) -> dict[str, Any]:
    """Get a specific meeting with full transcript."""
    db = _get_mongo()
    if not db:
        raise HTTPException(status_code=503, detail="MongoDB not available")
    try:
        meeting = db.meetings.find_one({"meeting_id": meeting_id})
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")
        return _serialize(meeting)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/meetings/search/{query}")
def search_meetings_endpoint(query: str, project_key: str | None = None) -> list[dict[str, Any]]:
    """
    Hybrid (keyword + semantic, when configured) search over meeting memory —
    exposes the same search DualMemoryStore.search_meetings uses internally,
    for dashboard debugging/browsing.
    """
    db = _get_mongo()
    if not db:
        return []
    safe_query = re.escape(query.strip()[:200])
    if not safe_query:
        return []
    try:
        filter_query: dict = {"consolidated": True}
        if project_key:
            filter_query["project_key"] = project_key
        filter_query["$or"] = [
            {"transcript.text": {"$regex": safe_query, "$options": "i"}},
            {"decisions": {"$regex": safe_query, "$options": "i"}},
            {"topics": {"$regex": safe_query, "$options": "i"}},
        ]
        meetings = list(
            db.meetings.find(filter_query, {"transcript": 0}).sort("ended_at", -1).limit(10)
        )
        return [_serialize(m) for m in meetings]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects")
def list_project_contexts() -> list[dict[str, Any]]:
    """List all project context documents."""
    db = _get_mongo()
    if not db:
        return []
    try:
        return [_serialize(ctx) for ctx in db.project_context.find({})]
    except Exception:
        return []


@router.get("/projects/{project_key}")
def get_project_context(project_key: str) -> dict[str, Any]:
    """Get the rolling (reconciled) project context for a specific project."""
    db = _get_mongo()
    if not db:
        raise HTTPException(status_code=503, detail="MongoDB not available")
    try:
        ctx = db.project_context.find_one({"_id": project_key})
        if not ctx:
            raise HTTPException(status_code=404, detail="Project context not found")
        return _serialize(ctx)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_key}/action-items")
def get_action_items(project_key: str, owner: str | None = None) -> list[dict[str, Any]]:
    """List currently-open action items for a project (reconciled — resolved
    items are already excluded, not just the raw historical log)."""
    db = _get_mongo()
    if not db:
        return []
    try:
        ctx = db.project_context.find_one({"_id": project_key})
        if not ctx:
            return []
        items = ctx.get("open_action_items", [])
        if owner:
            owner_lower = owner.strip().lower()
            items = [i for i in items if owner_lower in (i.get("owner") or "").lower()]
        return items
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_key}/facts")
def get_project_facts(project_key: str, topic: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    """List durable, project-scoped facts (superseded facts excluded)."""
    db = _get_mongo()
    if not db:
        return []
    limit = max(1, min(limit, MAX_LIST_LIMIT))
    try:
        filter_query: dict = {"project_key": project_key, "superseded": {"$ne": True}}
        if topic:
            filter_query["fact"] = {"$regex": re.escape(topic.strip()[:200]), "$options": "i"}
        facts = list(
            db.project_facts.find(filter_query, {"embedding": 0})
            .sort("created_at", -1)
            .limit(limit)
        )
        return [_serialize(f) for f in facts]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/debug/{channel_id}")
def debug_context(channel_id: str, query: str = "", project_key: str | None = None) -> dict[str, Any]:
    """
    Show exactly what context would be assembled for this channel right now
    — which meeting summaries would be selected (and why: semantic vs
    recency fallback), the token budget breakdown, and current history
    length. Meant for tuning retrieval/budget logic without needing to
    trigger a real conversation through Discord.
    """
    db = _get_mongo()
    r = _get_redis()
    if not db:
        raise HTTPException(status_code=503, detail="MongoDB not available")

    try:
        from core.store import get_config
        from core.embeddings import EmbeddingProvider
        from agent.agent import DualMemoryStore
        from agent.context import ContextAssembler

        cfg = get_config()
        embeddings = EmbeddingProvider(
            api_key=cfg.llm.gemini_api_key,
            model=__import__("os").environ.get("EMBEDDING_MODEL", "models/text-embedding-004"),
        )
        store = DualMemoryStore(redis_client=r, mongo_db=db, embeddings=embeddings)

        candidate_meetings = store.get_relevant_meeting_context(
            channel_id, query, project_key=project_key, top_k=3
        )
        history = store.get(channel_id) if r else []

        assembler = ContextAssembler(total_budget_tokens=cfg.advanced.memory_max_tokens)
        assembled = assembler.assemble(candidate_meetings, history)

        return {
            "channel_id": channel_id,
            "query": query,
            "semantic_search_available": embeddings.available,
            "ranking_mode": "semantic" if (query and embeddings.available) else "recency_fallback",
            "selected_meeting_summaries": assembled.meeting_summaries,
            "history_message_count": len(assembled.history),
            "history_messages_dropped": assembled.history_dropped,
            "meetings_dropped": assembled.meetings_dropped,
            "token_budget": assembled.debug,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
