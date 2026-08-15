"""
taiga/taiga_sync.py
───────────────────
Handles task events from the voice bot and mirrors them to Taiga.

When the voice bot says "create a task for Alice to fix the login bug",
the task is:
  1. Written to MongoDB by KafkaTaskStore (voice bot side)
  2. Published to Kafka as task.created
  3. Consumed here → create_item() called on TaigaPlatform
  4. Taiga item now exists with the voice-created data

This is the "objective completion" path: voice creates tasks in Taiga,
not just in MongoDB.
"""
from __future__ import annotations

import logging
import sys
import os

logger = logging.getLogger("agent_bridge.taiga_sync")

# Add agent-bridge root to path so we can import the existing adapters
_AGENT_BRIDGE_ROOT = os.environ.get(
    "AGENT_BRIDGE_ROOT",
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "agent-bridge")
)
if _AGENT_BRIDGE_ROOT not in sys.path:
    sys.path.insert(0, _AGENT_BRIDGE_ROOT)


class TaigaSyncHandler:
    """
    Receives task events from the Kafka consumer and calls the existing
    TaigaPlatform adapter (platforms/pm/taiga_platform.py) to mirror them.

    Wire-up in main.py:
        handler = TaigaSyncHandler(taiga_platform, project_slug)
        consumer.on("task.created", handler.on_task_created)
        consumer.on("task.updated", handler.on_task_updated)
        consumer.on("task.closed",  handler.on_task_closed)
    """

    def __init__(self, pm_platform, project_slug: str):
        """
        pm_platform:   a configured TaigaPlatform instance
        project_slug:  the Taiga project slug to create tasks in
        """
        self._pm      = pm_platform
        self._slug    = project_slug
        self._project_id: str | None = None

    def _get_project_id(self) -> str:
        if self._project_id is None:
            self._project_id = self._pm.get_project_id(self._slug)
        return self._project_id

    def on_task_created(self, event: dict) -> None:
        """Mirror a voice-created task into Taiga."""
        try:
            project_id = self._get_project_id()
            title      = event.get("title", "").strip()
            if not title:
                logger.warning("task.created event missing title — skipping")
                return

            description = event.get("description", "") or ""
            assignee    = event.get("assignee")
            created_by  = event.get("createdBy", "voice-bot")
            task_id     = event.get("taskId", "?")
            meeting_id  = event.get("meetingId")

            # Append context note to description
            context_lines = [description] if description else []
            context_lines.append(f"Created via voice command by: {created_by}")
            if meeting_id:
                context_lines.append(f"Meeting session: {meeting_id}")
            context_lines.append(f"MongoDB task ID: {task_id}")
            full_description = "\n".join(context_lines)

            tags = ["voice-created"]
            if meeting_id:
                tags.append("from-meeting")

            item = self._pm.create_item(
                project_id  = project_id,
                item_type   = "task",
                subject     = title,
                description = full_description,
                assigned_to = assignee or None,
                tags        = tags,
            )
            logger.info(
                "task.created → Taiga item #%s '%s' (mongo_id=%s assignee=%s)",
                item.item_id, item.subject, task_id, assignee or "none"
            )

        except Exception as e:
            logger.error("Failed to sync task.created to Taiga: %s (event=%s)", e, event, exc_info=True)

    def on_task_closed(self, event: dict) -> None:
        """Mirror a voice-closed task into Taiga by searching title."""
        try:
            project_id  = self._get_project_id()
            title       = event.get("title", "").strip()
            task_id     = event.get("taskId", "?")

            if not title:
                logger.warning("task.closed event missing title — skipping")
                return

            # Search Taiga for the task by title (voice bot uses title matching too)
            results = self._pm.search_items(project_id, title)
            open_matches = [
                r for r in results
                if r.status.lower() not in ("done", "closed", "cancelled")
                and title.lower() in r.subject.lower()
            ]

            if not open_matches:
                logger.warning(
                    "task.closed: no open Taiga item matching '%s' (mongo_id=%s)", title, task_id)
                return

            # Close the best match (most similar title)
            target = min(open_matches, key=lambda r: abs(len(r.subject) - len(title)))
            item = self._pm.close_item(project_id, target.item_id)
            logger.info(
                "task.closed → Closed Taiga item #%s '%s' (mongo_id=%s)",
                item.item_id, item.subject, task_id
            )

        except Exception as e:
            logger.error("Failed to sync task.closed to Taiga: %s (event=%s)", e, event, exc_info=True)

    def _find_open_item(self, project_id: str, title: str) -> object | None:
        """Search open Taiga items by title; return the best-scoring match."""
        results = self._pm.search_items(project_id, title)
        open_matches = [
            r for r in results
            if r.status.lower() not in ("done", "closed", "cancelled")
            and title.lower() in r.subject.lower()
        ]
        if not open_matches:
            return None
        return min(open_matches, key=lambda r: abs(len(r.subject) - len(title)))

    def _resolve_assignee_id(self, project_id: str, name: str) -> int | None:
        """Resolve a freeform assignee name to a Taiga user id, or None."""
        target = name.strip().lower()
        if not target:
            return None
        members = self._pm.list_members(project_id)
        exact = next(
            (m for m in members
             if m.get("username", "").lower() == target
             or m.get("full_name", "").lower() == target),
            None
        )
        if exact:
            return exact["id"]
        partial = next(
            (m for m in members if target in m.get("username", "").lower()),
            None
        )
        return partial["id"] if partial else None

    def on_task_updated(self, event: dict) -> None:
        """Mirror a voice-updated task (rename, description or assignee) into Taiga."""
        try:
            project_id = self._get_project_id()
            task_id    = event.get("taskId", "?")
            changes    = event.get("changes", {}) or {}

            # Locate the item: a rename means Taiga still holds the OLD title,
            # so prefer previousTitle when it exists.
            match_key = event.get("previousTitle") or event.get("title") or ""
            if not match_key.strip():
                logger.warning("task.updated event missing title/previousTitle — skipping")
                return

            target = self._find_open_item(project_id, match_key)
            if target is None:
                logger.warning(
                    "task.updated: no open Taiga item matching '%s' (mongo_id=%s)",
                    match_key, task_id)
                return

            fields: dict[str, object] = {}
            new_title = (changes.get("title") or "").strip()
            if new_title and new_title.lower() != target.subject.lower():
                fields["subject"] = new_title

            description = changes.get("description")
            if description is not None:
                fields["description"] = description or ""

            assignee = (changes.get("assignee") or "").strip()
            if assignee:
                member_id = self._resolve_assignee_id(project_id, assignee)
                if member_id is None:
                    logger.warning(
                        "task.updated: assignee '%s' not found in project members — "
                        "item %s left unassigned (mongo_id=%s)", assignee, target.item_id, task_id)
                else:
                    fields["assigned_to"] = member_id

            if not fields:
                logger.info(
                    "task.updated: no effective changes for item #%s '%s' (mongo_id=%s)",
                    target.item_id, target.subject, task_id)
                return

            item = self._pm.update_item(project_id, target.item_id, fields)
            logger.info(
                "task.updated → Updated Taiga item #%s '%s' (fields=%s, mongo_id=%s)",
                item.item_id, item.subject, list(fields.keys()), task_id
            )

        except Exception as e:
            logger.error("Failed to sync task.updated to Taiga: %s (event=%s)", e, event, exc_info=True)
