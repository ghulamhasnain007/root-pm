"""
backend/routers/logs.py
"""
from fastapi import APIRouter, Query
from models.schemas import LogEntry
from core.store import get_logs, append_log

router = APIRouter()


@router.get("", response_model=list[LogEntry])
def read_logs(
    limit: int = Query(default=100, le=500),
    level: str | None = Query(default=None),
):
    return get_logs(limit=limit, level=level)


@router.delete("", status_code=204)
def clear_logs():
    from core.store import _log_buffer
    _log_buffer.clear()
