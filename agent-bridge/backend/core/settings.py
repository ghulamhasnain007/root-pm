"""
backend/core/settings.py  —  Central environment-backed settings
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import find_dotenv, load_dotenv


_DOTENV_PATH = find_dotenv(usecwd=True)
if _DOTENV_PATH:
    load_dotenv(_DOTENV_PATH, override=False)
else:
    load_dotenv(override=False)


def _split_csv(value: str | None, default: list[str]) -> list[str]:
    if not value:
        return default
    items = [item.strip() for item in value.split(",")]
    return [item for item in items if item]


def _get_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        return default


APP_TITLE = os.getenv("APP_TITLE", "Agent Bridge API")
APP_VERSION = os.getenv("APP_VERSION", "0.1.0")
_PROJECT_ROOT = Path(__file__).resolve().parents[1]
_DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[1] / "data" / "config.json"


def _resolve_config_path(raw_path: str) -> Path:
    config_path = Path(raw_path)
    if not config_path.is_absolute():
        config_path = _PROJECT_ROOT / config_path
    return config_path


CONFIG_PATH = _resolve_config_path(os.getenv("CONFIG_PATH", str(_DEFAULT_CONFIG_PATH)))
CORS_ORIGINS = _split_csv(
    os.getenv("CORS_ORIGINS"),
    ["http://localhost:5173", "http://localhost:3000"],
)

DEFAULT_COMM_PLATFORM = os.getenv("COMM_PLATFORM", "discord")
DEFAULT_PM_PLATFORM = os.getenv("PM_PLATFORM", "taiga")

DEFAULT_DISCORD_BOT_TOKEN = os.getenv("DISCORD_BOT_TOKEN", "")
DEFAULT_DISCORD_TRIGGER_ROLE = os.getenv("DISCORD_TRIGGER_ROLE", "FYP")

DEFAULT_TAIGA_URL = os.getenv("TAIGA_URL", "")
DEFAULT_TAIGA_USERNAME = os.getenv("TAIGA_USER", "")
DEFAULT_TAIGA_PASSWORD = os.getenv("TAIGA_PASS", "")

DEFAULT_GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
DEFAULT_AGENT_MODEL = os.getenv("AGENT_MODEL", "gemini-2.5-flash")
DEFAULT_CLASSIFIER_MODEL = os.getenv("CLASSIFIER_MODEL", "gemini-2.5-flash")

DEFAULT_MAX_ITERATIONS = _get_int("MAX_ITERATIONS", 8)
DEFAULT_CONTEXT_CACHE_TTL = _get_int("CONTEXT_CACHE_TTL", 60)
DEFAULT_MEMORY_MAX_TOKENS = _get_int("MEMORY_MAX_TOKENS", 2000)

DEFAULT_REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
DEFAULT_MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DEFAULT_MONGO_DATABASE = os.getenv("MONGO_DATABASE", "agent_bridge")

# ── Memory retrieval/embeddings ─────────────────────────────────────────────
DEFAULT_EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "models/text-embedding-004")
DEFAULT_EMBEDDING_DIMENSIONS = _get_int("EMBEDDING_DIMENSIONS", 768)
DEFAULT_MEMORY_CHUNK_TOKENS = _get_int("MEMORY_CHUNK_TOKENS", 400)
DEFAULT_MEMORY_CHUNK_OVERLAP = _get_int("MEMORY_CHUNK_OVERLAP", 60)
DEFAULT_MEMORY_TOP_K = _get_int("MEMORY_TOP_K", 5)

# Optional API key required on /api/memory/* (sensitive: transcripts, facts).
# Leave unset to keep the previous (dev-only) unauthenticated behavior.
DEFAULT_MEMORY_API_KEY = os.getenv("MEMORY_API_KEY", "")