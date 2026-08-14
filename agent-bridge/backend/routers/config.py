"""
backend/routers/config.py
"""
from fastapi import APIRouter, HTTPException
from models.schemas import (
    AppConfig, ExportedConfig,
    TestConnectionRequest, TestConnectionResponse,
)
from core.store import get_config, save_config, append_log
from services.connection_test import run_test

router = APIRouter()


@router.get("", response_model=AppConfig)
def read_config():
    return get_config()


@router.put("", response_model=AppConfig)
def write_config(cfg: AppConfig):
    save_config(cfg)
    append_log("INFO", "api", "Configuration saved")
    return cfg


@router.patch("", response_model=AppConfig)
def patch_config(partial: dict):
    cfg = get_config()
    updated = cfg.model_copy(update=partial)
    save_config(updated)
    append_log("INFO", "api", f"Config patched: {list(partial.keys())}")
    return updated


@router.get("/export", response_model=ExportedConfig)
def export_config():
    cfg = get_config()
    channel_map: dict = {}
    for m in cfg.channel_mappings:
        if m.guild_id and m.channel_id and m.project_slug and m.active:
            if m.guild_id not in channel_map:
                channel_map[m.guild_id] = {}
            channel_map[m.guild_id][m.channel_id] = m.project_slug

    role_perms = {r.role_name: r.tier for r in cfg.role_permissions if r.role_name}

    return ExportedConfig(
        communication={
            "platform": cfg.comm_platform,
            "config": {
                "bot_token":        "$DISCORD_TOKEN",
                "trigger_role":     cfg.discord.trigger_role,
                "channel_map":      channel_map,
                "role_permissions": role_perms,
            },
        },
        project_management={
            "platform": cfg.pm_platform,
            "config": {
                "url":      "$TAIGA_URL",
                "username": "$TAIGA_USER",
                "password": "$TAIGA_PASS",
            },
        },
        llm={
            "gemini_api_key":   "$GEMINI_API_KEY",
            "agent_model":      cfg.llm.agent_model,
            "classifier_model": cfg.llm.classifier_model,
        },
        advanced=cfg.advanced.model_dump(),
    )


@router.post("/test-connection", response_model=TestConnectionResponse)
def test_connection(req: TestConnectionRequest):
    result = run_test(req.platform, req.config)
    level = "INFO" if result.success else "WARN"
    append_log(level, "connection-test", f"{req.platform}: {result.message}")
    return result
