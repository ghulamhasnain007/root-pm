"""
backend/models/schemas.py  —  All Pydantic request/response models
"""
from __future__ import annotations
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


# ── Platform catalogue ────────────────────────────────────────────────────────

class PlatformInfo(BaseModel):
    id: str
    display_name: str
    icon: str                 # Tabler icon name e.g. "brand-discord"
    color: str                # hex
    bg_color: str             # hex, used for pill backgrounds
    description: str
    status: Literal["live", "coming_soon"]
    required_keys: list[str]


# ── Credentials ───────────────────────────────────────────────────────────────

class DiscordConfig(BaseModel):
    bot_token: str = ""
    trigger_role: str = "FYP"

class TaigaConfig(BaseModel):
    url: str = ""
    username: str = ""
    password: str = ""

class LLMConfig(BaseModel):
    gemini_api_key: str = ""
    agent_model: str = "gemini-2.5-flash"
    classifier_model: str = "gemini-2.5-flash"

class AdvancedConfig(BaseModel):
    max_iterations: int = 8
    context_cache_ttl: int = 60
    memory_max_tokens: int = 2000


class RedisConfig(BaseModel):
    url: str = "redis://localhost:6379/0"
    max_history_per_channel: int = 50
    history_ttl_days: int = 7
    meeting_ttl_hours: int = 24


class MongoConfig(BaseModel):
    uri: str = "mongodb://localhost:27017"
    database: str = "agent_bridge"


# ── Channel map ───────────────────────────────────────────────────────────────

class ChannelMapping(BaseModel):
    id: str                   # client-generated UUID
    guild_id: str = ""
    guild_name: str = ""
    channel_id: str = ""
    channel_name: str = ""
    project_slug: str = ""
    active: bool = True


# ── Role permissions ──────────────────────────────────────────────────────────

class RolePermission(BaseModel):
    id: str
    role_name: str = ""
    tier: Literal["admin", "write", "read", "none"] = "read"


# ── Full app config ───────────────────────────────────────────────────────────

class AppConfig(BaseModel):
    comm_platform: str = "discord"
    pm_platform: str = "taiga"
    discord: DiscordConfig = Field(default_factory=DiscordConfig)
    taiga: TaigaConfig = Field(default_factory=TaigaConfig)
    llm: LLMConfig = Field(default_factory=LLMConfig)
    advanced: AdvancedConfig = Field(default_factory=AdvancedConfig)
    redis: RedisConfig = Field(default_factory=RedisConfig)
    mongo: MongoConfig = Field(default_factory=MongoConfig)
    channel_mappings: list[ChannelMapping] = Field(default_factory=list)
    role_permissions: list[RolePermission] = Field(default_factory=list)


# ── Status ────────────────────────────────────────────────────────────────────

class CheckResult(BaseModel):
    label: str
    ok: bool
    detail: str

class StatusResponse(BaseModel):
    overall: Literal["ready", "partial", "unconfigured"]
    checks: list[CheckResult]
    comm_platform: str
    pm_platform: str
    messages_handled_today: int
    uptime_seconds: float


# ── Log entry ─────────────────────────────────────────────────────────────────

class LogEntry(BaseModel):
    timestamp: str
    level: Literal["INFO", "WARN", "ERROR", "DEBUG"]
    source: str
    message: str
    metadata: dict[str, Any] = Field(default_factory=dict)


# ── Test connection ───────────────────────────────────────────────────────────

class TestConnectionRequest(BaseModel):
    platform: str
    config: dict[str, Any]

class TestConnectionResponse(BaseModel):
    success: bool
    message: str
    detail: Optional[str] = None


# ── Export ────────────────────────────────────────────────────────────────────

class ExportedConfig(BaseModel):
    communication: dict[str, Any]
    project_management: dict[str, Any]
    llm: dict[str, Any]
    advanced: dict[str, Any]
