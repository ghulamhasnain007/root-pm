"""
core/events.py — Kafka event types for config changes (auth-service → bot managers).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class ToolConfigUpdatedEvent:
    schemaVersion: str
    eventType: Literal["tool-config.updated"]
    sourceSystem: Literal["auth-service"]
    publishedAt: int
    orgId: str
    toolId: str
    status: Literal["connected", "failed", "pending", "configured"]


@dataclass(frozen=True)
class ToolConfigRemovedEvent:
    schemaVersion: str
    eventType: Literal["tool-config.removed"]
    sourceSystem: Literal["auth-service"]
    publishedAt: int
    orgId: str
    toolId: str


ToolConfigEvent = ToolConfigUpdatedEvent | ToolConfigRemovedEvent
