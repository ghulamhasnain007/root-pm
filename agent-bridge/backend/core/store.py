"""
backend/core/store.py  —  Singleton config store with JSON persistence
"""
from __future__ import annotations
import json
import time

from core.settings import (
    CONFIG_PATH,
    DEFAULT_AGENT_MODEL,
    DEFAULT_CLASSIFIER_MODEL,
    DEFAULT_COMM_PLATFORM,
    DEFAULT_CONTEXT_CACHE_TTL,
    DEFAULT_DISCORD_BOT_TOKEN,
    DEFAULT_DISCORD_TRIGGER_ROLE,
    DEFAULT_GEMINI_API_KEY,
    DEFAULT_MAX_ITERATIONS,
    DEFAULT_MEMORY_MAX_TOKENS,
    DEFAULT_MONGO_DATABASE,
    DEFAULT_MONGO_URI,
    DEFAULT_PM_PLATFORM,
    DEFAULT_REDIS_URL,
    DEFAULT_TAIGA_PASSWORD,
    DEFAULT_TAIGA_URL,
    DEFAULT_TAIGA_USERNAME,
)
from models.schemas import (
    AdvancedConfig,
    AppConfig,
    DiscordConfig,
    LLMConfig,
    LogEntry,
    MongoConfig,
    RedisConfig,
    RolePermission,
    TaigaConfig,
)
from datetime import datetime, timezone

CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)

_DEFAULT_ROLES = [
    {"id": "r1", "role_name": "Project Manager", "tier": "admin"},
    {"id": "r2", "role_name": "Developer",        "tier": "write"},
    {"id": "r3", "role_name": "Intern",            "tier": "read"},
]

_start_time = time.time()
_messages_today = 0
_log_buffer: list[LogEntry] = []


def _build_default_config() -> AppConfig:
    cfg = AppConfig(
        comm_platform=DEFAULT_COMM_PLATFORM,
        pm_platform=DEFAULT_PM_PLATFORM,
        discord=DiscordConfig(
            bot_token=DEFAULT_DISCORD_BOT_TOKEN,
            trigger_role=DEFAULT_DISCORD_TRIGGER_ROLE,
        ),
        taiga=TaigaConfig(
            url=DEFAULT_TAIGA_URL,
            username=DEFAULT_TAIGA_USERNAME,
            password=DEFAULT_TAIGA_PASSWORD,
        ),
        llm=LLMConfig(
            gemini_api_key=DEFAULT_GEMINI_API_KEY,
            agent_model=DEFAULT_AGENT_MODEL,
            classifier_model=DEFAULT_CLASSIFIER_MODEL,
        ),
        advanced=AdvancedConfig(
            max_iterations=DEFAULT_MAX_ITERATIONS,
            context_cache_ttl=DEFAULT_CONTEXT_CACHE_TTL,
            memory_max_tokens=DEFAULT_MEMORY_MAX_TOKENS,
        ),
        redis=RedisConfig(
            url=DEFAULT_REDIS_URL,
        ),
        mongo=MongoConfig(
            uri=DEFAULT_MONGO_URI,
            database=DEFAULT_MONGO_DATABASE,
        ),
    )
    cfg.role_permissions = [RolePermission(**r) for r in _DEFAULT_ROLES]
    return cfg


def _apply_env_defaults(cfg: AppConfig) -> AppConfig:
    defaults = _build_default_config()

    cfg.comm_platform = cfg.comm_platform or defaults.comm_platform
    cfg.pm_platform = cfg.pm_platform or defaults.pm_platform

    cfg.discord.bot_token = cfg.discord.bot_token or defaults.discord.bot_token
    cfg.discord.trigger_role = cfg.discord.trigger_role or defaults.discord.trigger_role

    cfg.taiga.url = cfg.taiga.url or defaults.taiga.url
    cfg.taiga.username = cfg.taiga.username or defaults.taiga.username
    cfg.taiga.password = cfg.taiga.password or defaults.taiga.password

    cfg.llm.gemini_api_key = cfg.llm.gemini_api_key or defaults.llm.gemini_api_key
    cfg.llm.agent_model = cfg.llm.agent_model or defaults.llm.agent_model
    cfg.llm.classifier_model = cfg.llm.classifier_model or defaults.llm.classifier_model

    cfg.advanced.max_iterations = cfg.advanced.max_iterations or defaults.advanced.max_iterations
    cfg.advanced.context_cache_ttl = cfg.advanced.context_cache_ttl or defaults.advanced.context_cache_ttl
    cfg.advanced.memory_max_tokens = cfg.advanced.memory_max_tokens or defaults.advanced.memory_max_tokens

    cfg.redis.url = cfg.redis.url or defaults.redis.url
    cfg.mongo.uri = cfg.mongo.uri or defaults.mongo.uri
    cfg.mongo.database = cfg.mongo.database or defaults.mongo.database

    if not cfg.role_permissions:
        cfg.role_permissions = defaults.role_permissions

    return cfg


def _load() -> AppConfig:
    if CONFIG_PATH.exists():
        try:
            return _apply_env_defaults(AppConfig(**json.loads(CONFIG_PATH.read_text())))
        except Exception:
            pass
    return _build_default_config()


_config: AppConfig = _load()


def get_config() -> AppConfig:
    return _config


def save_config(cfg: AppConfig) -> None:
    global _config
    _config = cfg
    CONFIG_PATH.write_text(cfg.model_dump_json(indent=2))


def get_uptime() -> float:
    return time.time() - _start_time


def get_messages_today() -> int:
    return _messages_today


def append_log(level: str, source: str, message: str, metadata: dict | None = None) -> None:
    entry = LogEntry(
        timestamp=datetime.now(timezone.utc).isoformat(),
        level=level,
        source=source,
        message=message,
        metadata=metadata or {},
    )
    _log_buffer.append(entry)
    if len(_log_buffer) > 500:
        _log_buffer.pop(0)


def get_logs(limit: int = 100, level: str | None = None) -> list[LogEntry]:
    entries = list(reversed(_log_buffer))
    if level:
        entries = [e for e in entries if e.level == level]
    return entries[:limit]
