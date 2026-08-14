"""platforms/pm/linear_platform.py — Linear stub (coming soon)."""
from __future__ import annotations
from typing import Any
from core.base import ProjectManagementPlatform, ProjectContext, ProjectItem
from core.registry import pm_platform

@pm_platform
class LinearPlatform(ProjectManagementPlatform):
    platform_id = "linear"; display_name = "Linear"
    required_config_keys = ["api_key", "team_id"]
    def configure(self, config: dict[str, Any]) -> None: raise NotImplementedError("Linear: coming soon")
    def get_project_id(self, key: str) -> str: raise NotImplementedError
    def get_project_context(self, pid: str) -> ProjectContext: raise NotImplementedError
    def create_item(self, *a, **k) -> ProjectItem: raise NotImplementedError
    def update_item(self, *a, **k) -> ProjectItem: raise NotImplementedError
    def close_item(self, *a, **k) -> ProjectItem: raise NotImplementedError
    def get_item(self, *a, **k) -> ProjectItem: raise NotImplementedError
    def list_items(self, *a, **k) -> list: raise NotImplementedError
    def search_items(self, *a, **k) -> list: raise NotImplementedError
    def list_members(self, *a, **k) -> list: raise NotImplementedError
