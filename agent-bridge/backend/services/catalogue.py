"""
backend/services/catalogue.py  —  Static catalogue of all platforms
"""
from models.schemas import PlatformInfo

COMM_PLATFORMS: list[PlatformInfo] = [
    PlatformInfo(
        id="discord", display_name="Discord",
        icon="brand-discord", color="#5865F2", bg_color="#EEEFFE",
        description="Bot with @mention & role triggers",
        status="live",
        required_keys=["bot_token", "trigger_role"],
    ),
    PlatformInfo(
        id="slack", display_name="Slack",
        icon="brand-slack", color="#4A154B", bg_color="#F3EAF5",
        description="Slash commands and app mentions",
        status="coming_soon",
        required_keys=["bot_token", "signing_secret"],
    ),
    PlatformInfo(
        id="teams", display_name="MS Teams",
        icon="brand-teams", color="#6264A7", bg_color="#EEEEF8",
        description="Bot Framework adaptive cards",
        status="coming_soon",
        required_keys=["app_id", "app_password"],
    ),
    PlatformInfo(
        id="telegram", display_name="Telegram",
        icon="brand-telegram", color="#2AABEE", bg_color="#E5F6FF",
        description="Bot API webhook integration",
        status="coming_soon",
        required_keys=["bot_token"],
    ),
]

PM_PLATFORMS: list[PlatformInfo] = [
    PlatformInfo(
        id="taiga", display_name="Taiga",
        icon="leaf", color="#1D9E75", bg_color="#E0F5EE",
        description="Open-source agile project management",
        status="live",
        required_keys=["url", "username", "password"],
    ),
    PlatformInfo(
        id="jira", display_name="Jira",
        icon="brand-jira", color="#0052CC", bg_color="#E5EFFE",
        description="Atlassian issue & project tracker",
        status="coming_soon",
        required_keys=["url", "email", "api_token"],
    ),
    PlatformInfo(
        id="linear", display_name="Linear",
        icon="line", color="#5E6AD2", bg_color="#EDEEF9",
        description="Modern software project tracking",
        status="coming_soon",
        required_keys=["api_key", "team_id"],
    ),
    PlatformInfo(
        id="asana", display_name="Asana",
        icon="brand-asana", color="#F06A6A", bg_color="#FEF0F0",
        description="Team task and work management",
        status="coming_soon",
        required_keys=["access_token", "workspace_id"],
    ),
]


def get_comm_platforms() -> list[PlatformInfo]:
    return COMM_PLATFORMS


def get_pm_platforms() -> list[PlatformInfo]:
    return PM_PLATFORMS


def get_comm_platform(platform_id: str) -> PlatformInfo | None:
    return next((p for p in COMM_PLATFORMS if p.id == platform_id), None)


def get_pm_platform(platform_id: str) -> PlatformInfo | None:
    return next((p for p in PM_PLATFORMS if p.id == platform_id), None)
