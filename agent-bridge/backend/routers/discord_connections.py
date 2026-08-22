"""
routers/discord_connections.py — Multi-org Discord connection status.

agent-bridge's bot process (server/bot/main.py, where DiscordPlatformManager
actually lives) and this FastAPI config API are separate processes — there's
no in-memory way for this process to read the manager's state directly.
DiscordPlatformManager mirrors its status to Redis on every change; this
route reads it back. Same cross-process pattern already used for memory
(see routers/memory.py's cached Redis client) — replicated locally here
rather than imported from that module since its client is a module-private
implementation detail, and each router in this codebase already builds its
own cached client rather than sharing one.
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter

logger = logging.getLogger("agent_bridge.routers.discord_connections")
router = APIRouter()

STATUS_REDIS_KEY = "agent_bridge:discord_connections:status"

_redis_client = None


def _get_redis():
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


@router.get("")
def get_discord_connections():
    """Returns the multi-org Discord connection status last published by
    DiscordPlatformManager. Empty list (not an error) if the bot process
    hasn't published anything yet — e.g. AUTH_SERVICE_URL isn't set, so
    multi-org discovery never ran, which is the default, backward-compatible
    state for a single-tenant deployment."""
    r = _get_redis()
    if not r:
        return {"connections": []}
    try:
        raw = r.get(STATUS_REDIS_KEY)
        return {"connections": json.loads(raw) if raw else []}
    except Exception as e:
        logger.warning("Failed to read Discord connection status from Redis: %s", e)
        return {"connections": []}
