"""
routers/memory.py — Memory management endpoints for the dashboard.
Provides read/delete access to conversation history and meeting data.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException

logger = logging.getLogger("agent_bridge.routers.memory")
router = APIRouter()


def _get_redis():
    """Get Redis client from the app's memory store (if available)."""
    # This is a lightweight way to access the Redis client without global state.
    # In production, you'd inject this via FastAPI dependency injection.
    try:
        from core.store import get_config
        cfg = get_config()
        import redis
        return redis.Redis.from_url(cfg.redis.url, decode_responses=True)
    except Exception:
        return None


def _get_mongo():
    """Get MongoDB database from the app's memory store (if available)."""
    try:
        from core.store import get_config
        cfg = get_config()
        import pymongo
        client = pymongo.MongoClient(cfg.mongo.uri, serverSelectionTimeoutMS=3000)
        client.admin.command("ping")
        return client[cfg.mongo.database]
    except Exception:
        return None


@router.get("/stats")
def memory_stats() -> dict[str, Any]:
    """Get memory usage statistics."""
    stats: dict[str, Any] = {
        "redis": {"connected": False, "channels": 0, "meetings": 0},
        "mongo": {"connected": False, "meetings": 0, "projects": 0},
    }

    # Redis stats
    r = _get_redis()
    if r:
        try:
            r.ping()
            stats["redis"]["connected"] = True
            # Count channel history keys
            channel_keys = list(r.scan_iter("channel:*:history", count=100))
            stats["redis"]["channels"] = len(channel_keys)
            # Count meeting transcript keys
            meeting_keys = list(r.scan_iter("meeting:*:transcript", count=100))
            stats["redis"]["meetings"] = len(meeting_keys)
        except Exception:
            pass

    # MongoDB stats
    db = _get_mongo()
    if db:
        try:
            stats["mongo"]["connected"] = True
            stats["mongo"]["meetings"] = db.meetings.count_documents({})
            stats["mongo"]["projects"] = db.project_context.count_documents({})
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
            msg_count = r.llen(key)
            ttl = r.ttl(key)
            channels.append({
                "channel_id": channel_id,
                "message_count": msg_count,
                "ttl_seconds": ttl,
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
        key = f"channel:{channel_id}:history"
        r.delete(key)
        return {"status": "ok", "message": f"Cleared history for channel {channel_id}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/meetings")
def list_meetings(limit: int = 20, offset: int = 0) -> list[dict[str, Any]]:
    """List stored meetings from MongoDB."""
    db = _get_mongo()
    if not db:
        return []

    try:
        meetings = list(
            db.meetings.find(
                {},
                {"transcript": 0}  # Exclude full transcript for list view
            )
            .sort("ended_at", -1)
            .skip(offset)
            .limit(limit)
        )
        # Serialize ObjectIds and datetimes
        for m in meetings:
            m["_id"] = str(m["_id"])
            if hasattr(m.get("stored_at"), "isoformat"):
                m["stored_at"] = m["stored_at"].isoformat()
            if hasattr(m.get("consolidated_at"), "isoformat"):
                m["consolidated_at"] = m["consolidated_at"].isoformat()
        return meetings
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
        meeting["_id"] = str(meeting["_id"])
        if hasattr(meeting.get("stored_at"), "isoformat"):
            meeting["stored_at"] = meeting["stored_at"].isoformat()
        if hasattr(meeting.get("consolidated_at"), "isoformat"):
            meeting["consolidated_at"] = meeting["consolidated_at"].isoformat()
        return meeting
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects")
def list_project_contexts() -> list[dict[str, Any]]:
    """List all project context documents."""
    db = _get_mongo()
    if not db:
        return []

    try:
        contexts = list(db.project_context.find({}))
        for ctx in contexts:
            ctx["_id"] = str(ctx["_id"])
        return contexts
    except Exception:
        return []


@router.get("/projects/{project_key}")
def get_project_context(project_key: str) -> dict[str, Any]:
    """Get the rolling project context for a specific project."""
    db = _get_mongo()
    if not db:
        raise HTTPException(status_code=503, detail="MongoDB not available")

    try:
        ctx = db.project_context.find_one({"_id": project_key})
        if not ctx:
            raise HTTPException(status_code=404, detail="Project context not found")
        ctx["_id"] = str(ctx["_id"])
        return ctx
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
