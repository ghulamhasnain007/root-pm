"""
backend/routers/status.py
"""
from fastapi import APIRouter
from models.schemas import StatusResponse, CheckResult
from core.store import get_config, get_uptime, get_messages_today

router = APIRouter()


@router.get("", response_model=StatusResponse)
def get_status():
    cfg = get_config()

    checks = [
        CheckResult(
            label="Discord credentials",
            ok=bool(cfg.discord.bot_token and len(cfg.discord.bot_token) > 10),
            detail="Bot token is set" if cfg.discord.bot_token else "Bot token missing",
        ),
        CheckResult(
            label="Taiga credentials",
            ok=bool(cfg.taiga.url and cfg.taiga.username and cfg.taiga.password),
            detail="URL, username & password set" if cfg.taiga.url else "Taiga URL missing",
        ),
        CheckResult(
            label="Gemini API key",
            ok=bool(cfg.llm.gemini_api_key and len(cfg.llm.gemini_api_key) > 10),
            detail="API key is set" if cfg.llm.gemini_api_key else "API key missing",
        ),
        CheckResult(
            label="Channel mappings",
            ok=any(m.guild_id and m.project_slug for m in cfg.channel_mappings),
            detail=f"{len(cfg.channel_mappings)} mapping(s) configured",
        ),
        CheckResult(
            label="Role permissions",
            ok=len(cfg.role_permissions) > 0,
            detail=f"{len(cfg.role_permissions)} role(s) defined",
        ),
    ]

    all_ok  = all(c.ok for c in checks)
    any_ok  = any(c.ok for c in checks)
    overall = "ready" if all_ok else ("partial" if any_ok else "unconfigured")

    return StatusResponse(
        overall=overall,
        checks=checks,
        comm_platform=cfg.comm_platform,
        pm_platform=cfg.pm_platform,
        messages_handled_today=get_messages_today(),
        uptime_seconds=get_uptime(),
    )
