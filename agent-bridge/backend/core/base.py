"""
core/base.py — Abstract interfaces and shared dataclasses.
Every communication and PM adapter must implement these.
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from langchain_core.messages import BaseMessage


@dataclass
class IncomingMessage:
    platform: str
    platform_message_id: str
    channel_id: str
    channel_name: str
    server_id: str
    author_id: str
    author_name: str
    author_roles: list[str]
    content: str
    raw_content: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class OutgoingMessage:
    channel_id: str
    content: str
    reply_to_message_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProjectItem:
    platform: str
    item_id: str
    item_type: str
    subject: str
    description: str
    status: str
    assignee: str | None
    tags: list[str]
    url: str | None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProjectContext:
    project_id: str
    project_name: str
    active_sprint: str | None
    sprint_end_date: str | None
    open_task_count: int
    open_issue_count: int
    open_story_count: int
    members: list[dict]
    recent_items: list[ProjectItem]


class CommunicationPlatform(ABC):
    platform_id: str
    display_name: str
    required_config_keys: list[str]
    _message_callback = None

    @abstractmethod
    def configure(self, config: dict[str, Any]) -> None: ...

    @abstractmethod
    async def start(self) -> None: ...

    @abstractmethod
    async def stop(self) -> None: ...

    @abstractmethod
    async def send_message(self, msg: OutgoingMessage) -> None: ...

    @abstractmethod
    def resolve_project_key(self, server_id: str, channel_id: str) -> str | None: ...

    @abstractmethod
    def get_permission_tier(self, author_roles: list[str]) -> str: ...

    def set_message_callback(self, callback) -> None:
        self._message_callback = callback


class ProjectManagementPlatform(ABC):
    platform_id: str
    display_name: str
    required_config_keys: list[str]

    @abstractmethod
    def configure(self, config: dict[str, Any]) -> None: ...

    @abstractmethod
    def get_project_id(self, key: str) -> str: ...

    @abstractmethod
    def get_project_context(self, project_id: str) -> ProjectContext: ...

    @abstractmethod
    def create_item(self, project_id: str, item_type: str, subject: str,
                    description: str = "", assigned_to: str | None = None,
                    tags: list[str] | None = None) -> ProjectItem: ...

    @abstractmethod
    def update_item(self, project_id: str, item_id: str,
                    fields: dict[str, Any]) -> ProjectItem: ...

    @abstractmethod
    def close_item(self, project_id: str, item_id: str) -> ProjectItem: ...

    @abstractmethod
    def get_item(self, project_id: str, item_id: str) -> ProjectItem: ...

    @abstractmethod
    def list_items(self, project_id: str, item_type: str | None = None,
                   status: str | None = None, assigned_to: str | None = None,
                   limit: int = 20) -> list[ProjectItem]: ...

    @abstractmethod
    def search_items(self, project_id: str, query: str) -> list[ProjectItem]: ...

    @abstractmethod
    def list_members(self, project_id: str) -> list[dict]: ...

    def get_active_sprint(self, project_id: str) -> dict | None:
        return None

    def list_sprints(self, project_id: str) -> list[dict]:
        return []

    def create_epic(self, project_id: str, subject: str,
                    description: str = "") -> ProjectItem:
        raise NotImplementedError(f"{self.display_name} does not support epics.")

    def link_to_epic(self, project_id: str, item_id: str,
                     epic_id: str) -> ProjectItem:
        raise NotImplementedError(f"{self.display_name} does not support epics.")


class MemoryStore(ABC):
    """Abstract interface for conversation and meeting memory."""

    @abstractmethod
    def get(self, channel_id: str) -> list[BaseMessage]:
        """Retrieve conversation history for a channel."""
        ...

    @abstractmethod
    def append(self, channel_id: str, messages: list[BaseMessage]) -> None:
        """Append messages to a channel's history."""
        ...

    @abstractmethod
    def get_meeting_context(self, channel_id: str) -> list[str]:
        """Return the most recent formatted meeting summaries for a channel,
        newest first. Used as a fallback when no query is available or the
        store doesn't support relevance ranking."""
        ...

    @abstractmethod
    def clear(self, channel_id: str) -> None:
        """Clear all memory for a channel."""
        ...

    # ── Optional capabilities ───────────────────────────────────────────────
    # Concrete no-op/empty defaults so ChannelMemoryStore (the standalone,
    # no-Redis/Mongo fallback) doesn't need to implement long-term-memory
    # features it has no backing store for. DualMemoryStore overrides these.

    def get_relevant_meeting_context(
        self, channel_id: str, query: str, project_key: str | None = None, top_k: int = 3
    ) -> list[str]:
        """Return formatted meeting summaries ranked by relevance to `query`
        (semantic search when available, else falls back to recency)."""
        return self.get_meeting_context(channel_id)[-top_k:]

    def get_action_items(
        self, project_key: str, owner: str | None = None, status: str = "open"
    ) -> list[dict[str, Any]]:
        """Return tracked action items for a project, optionally filtered by
        owner. Empty list when the store has no durable project memory."""
        return []

    def remember_fact(self, project_key: str, fact: str, source: str = "chat") -> None:
        """Persist a durable, project-scoped fact outside of any single
        conversation or meeting (a no-op for stores without long-term
        storage)."""
        return None

    def recall_facts(self, project_key: str, topic: str | None = None, limit: int = 10) -> list[dict[str, Any]]:
        """Retrieve durable project facts, optionally filtered by topic."""
        return []
