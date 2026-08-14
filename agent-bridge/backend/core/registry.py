"""
core/registry.py — Self-registration registry for platform adapters.
"""
from __future__ import annotations
from typing import Type
from core.base import CommunicationPlatform, ProjectManagementPlatform


class PlatformRegistry:
    _comm: dict[str, Type[CommunicationPlatform]] = {}
    _pm: dict[str, Type[ProjectManagementPlatform]] = {}

    @classmethod
    def register_comm(cls, klass: Type[CommunicationPlatform]) -> None:
        cls._comm[klass.platform_id] = klass

    @classmethod
    def register_pm(cls, klass: Type[ProjectManagementPlatform]) -> None:
        cls._pm[klass.platform_id] = klass

    @classmethod
    def get_comm(cls, pid: str) -> Type[CommunicationPlatform]:
        if pid not in cls._comm:
            raise KeyError(f"Communication platform '{pid}' not registered. Available: {list(cls._comm)}")
        return cls._comm[pid]

    @classmethod
    def get_pm(cls, pid: str) -> Type[ProjectManagementPlatform]:
        if pid not in cls._pm:
            raise KeyError(f"PM platform '{pid}' not registered. Available: {list(cls._pm)}")
        return cls._pm[pid]

    @classmethod
    def list_comm(cls) -> list[str]:
        return list(cls._comm)

    @classmethod
    def list_pm(cls) -> list[str]:
        return list(cls._pm)


def comm_platform(klass: Type[CommunicationPlatform]):
    """Class decorator — registers a CommunicationPlatform."""
    PlatformRegistry.register_comm(klass)
    return klass


def pm_platform(klass: Type[ProjectManagementPlatform]):
    """Class decorator — registers a ProjectManagementPlatform."""
    PlatformRegistry.register_pm(klass)
    return klass
