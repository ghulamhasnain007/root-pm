"""
agent/tools.py
--------------
Builds LangChain tools bound to a specific PM platform instance and project.
Tools are permission-tier-gated — the agent only sees what the user can do.
"""
from __future__ import annotations
import json
import logging
from typing import Any
from langchain_core.tools import tool
from core.base import ProjectManagementPlatform, MemoryStore

logger = logging.getLogger("agent_bridge.tools")


def build_tools(pm: ProjectManagementPlatform, project_id: str, tier: str,
                memory_store: MemoryStore | None = None,
                project_key: str | None = None) -> list:
    """
    Return the tool list for the given permission tier.
    tier: 'admin' | 'write' | 'read' | 'none'
    memory_store: optional DualMemoryStore for meeting memory queries
    project_key: the PM platform's project *slug* (e.g. Taiga project slug) —
        NOT the same as project_id (the platform's internal numeric/opaque
        ID). Meeting memory (save_meeting, consolidation, project_context,
        project_facts) is keyed by project_key throughout, so memory tools
        must use project_key, never project_id, when querying the memory
        store — mixing the two means queries silently match nothing.
    """
    project_key = project_key or project_id

    # ── READ TOOLS (available to everyone with tier >= read) ────────────

    @tool
    def list_items(item_type: str = "all", status: str = "open", assigned_to: str = "") -> str:
        """
        List work items in the current project.
        item_type: task | story | issue | epic | all
        status: open | closed | all
        assigned_to: username (optional, leave blank for all)
        Returns a formatted list of items.
        """
        try:
            results = pm.list_items(
                project_id,
                item_type=None if item_type in ("all", "") else item_type,
                status=None if status == "all" else status,
                assigned_to=assigned_to or None,
            )
            if not results:
                return f"No {item_type} items found with status '{status}'."
            lines = [f"Found {len(results)} item(s):"]
            for item in results[:15]:
                assignee = f" → {item.assignee}" if item.assignee else ""
                lines.append(f"  • #{item.item_id} [{item.item_type}] {item.subject} ({item.status}){assignee}")
            return "\n".join(lines)
        except Exception as e:
            logger.error("list_items error: %s", e)
            return f"Error listing items: {e}"

    @tool
    def get_item(item_id: str) -> str:
        """
        Fetch full details of a single work item by its numeric ID.
        item_id: the numeric ID of the item (e.g. '42')
        """
        try:
            item = pm.get_item(project_id, item_id)
            lines = [
                f"**{item.subject}** (#{item.item_id})",
                f"Type: {item.item_type} | Status: {item.status}",
                f"Assignee: {item.assignee or 'Unassigned'}",
                f"Tags: {', '.join(item.tags) if item.tags else 'None'}",
            ]
            if item.description:
                lines.append(f"Description: {item.description[:300]}")
            if item.url:
                lines.append(f"URL: {item.url}")
            return "\n".join(lines)
        except Exception as e:
            return f"Error fetching item #{item_id}: {e}"

    @tool
    def search_items(query: str) -> str:
        """
        Full-text search across all item types (tasks, stories, issues, epics).
        query: the search term or phrase
        """
        try:
            results = pm.search_items(project_id, query)
            if not results:
                return f"No items found matching '{query}'."
            lines = [f"Search results for '{query}' ({len(results)} found):"]
            for item in results[:10]:
                lines.append(f"  • #{item.item_id} [{item.item_type}] {item.subject}")
                if item.url:
                    lines.append(f"    {item.url}")
            return "\n".join(lines)
        except Exception as e:
            return f"Error searching: {e}"

    @tool
    def get_sprint_status() -> str:
        """Get the current active sprint's name, end date, and progress."""
        try:
            sprint = pm.get_active_sprint(project_id)
            if not sprint:
                return "No active sprint found in this project."
            lines = [
                f"**Sprint: {sprint.get('name', 'Unnamed')}**",
                f"Ends: {sprint.get('estimated_finish', 'N/A')}",
                f"Closed points: {sprint.get('closed_points', 0)} / {sprint.get('total_points', 0)}",
            ]
            return "\n".join(lines)
        except Exception as e:
            return f"Error fetching sprint: {e}"

    @tool
    def list_members() -> str:
        """List all team members in the current project with their usernames and roles."""
        try:
            members = pm.list_members(project_id)
            if not members:
                return "No members found."
            lines = ["Team members:"]
            for m in members:
                lines.append(f"  • {m['username']} — {m.get('full_name', '')} ({m.get('role', '')})")
            return "\n".join(lines)
        except Exception as e:
            return f"Error listing members: {e}"

    @tool
    def get_project_info() -> str:
        """Get high-level project statistics: open items, sprint info, member count."""
        try:
            ctx = pm.get_project_context(project_id)
            return (
                f"**Project: {ctx.project_name}**\n"
                f"Active sprint: {ctx.active_sprint or 'None'} (ends {ctx.sprint_end_date or 'N/A'})\n"
                f"Open tasks: {ctx.open_task_count} | Open issues: {ctx.open_issue_count} | Open stories: {ctx.open_story_count}\n"
                f"Team members: {len(ctx.members)}"
            )
        except Exception as e:
            return f"Error fetching project info: {e}"

    read_tools = [list_items, get_item, search_items, get_sprint_status, list_members, get_project_info]

    # ── MEMORY TOOLS (available to all tiers if memory_store is available) ────

    if memory_store and hasattr(memory_store, "search_meetings"):
        @tool
        def search_meetings(query: str) -> str:
            """
            Search past meeting transcripts and summaries for keywords, people, decisions,
            or topics — including paraphrased matches, not just exact wording (e.g. a query
            for "auth decision" can match a meeting that said "we agreed to use OAuth").
            Returns matching meeting excerpts with dates and participants.
            Use this when asked about what was discussed, decided, or said in meetings.
            """
            try:
                meetings = memory_store.search_meetings(query, project_key=project_key)
                if not meetings:
                    return f"No meeting records found matching '{query}'."
                lines = [f"Meeting search results for '{query}' ({len(meetings)} found):"]
                for m in meetings:
                    date = m.get("ended_at", "")
                    participants = m.get("participants", [])
                    decisions = m.get("decisions", [])
                    topics = m.get("topics", [])
                    lines.append(f"\n  Meeting on {date}")
                    lines.append(f"  Participants: {', '.join(participants)}")
                    if topics:
                        lines.append(f"  Topics: {', '.join(topics)}")
                    if decisions:
                        lines.append(f"  Decisions: {'; '.join(decisions)}")
                    matched = m.get("matched_chunks")
                    if matched:
                        lines.append("  Most relevant excerpts:")
                        for c in matched:
                            lines.append(f"    ({c.get('kind', 'excerpt')}, score={c.get('score')}) {c.get('text', '')[:200]}")
                    else:
                        # Fall back to a plain keyword scan of the raw transcript
                        transcript = m.get("transcript", [])
                        matching = [t for t in transcript if query.lower() in t.get("text", "").lower()]
                        if matching:
                            lines.append("  Matching transcript excerpts:")
                            for t in matching[:3]:
                                lines.append(f"    [{t.get('speaker', '?')}]: {t.get('text', '')[:150]}")
                return "\n".join(lines)
            except Exception as e:
                return f"Error searching meetings: {e}"

        @tool
        def get_project_decisions() -> str:
            """
            Get recent decisions made in project meetings.
            Returns the last 10 decisions with dates and which meeting they were made in.
            Use this when asked about what was decided or agreed upon.
            """
            try:
                decisions = memory_store.get_project_decisions(project_key)
                if not decisions:
                    return "No decisions recorded in meetings yet."
                lines = ["Recent project decisions:"]
                for d in decisions:
                    date = d.get("date", "")
                    text = d.get("decision", "")
                    lines.append(f"  • {text} (meeting {d.get('meeting_id', '?')}, {date})")
                return "\n".join(lines)
            except Exception as e:
                return f"Error fetching decisions: {e}"

        @tool
        def get_action_items(owner: str = "") -> str:
            """
            Get currently OPEN action items tracked from past meetings, optionally
            filtered to a specific person. This reflects the reconciled state — items
            resolved in a later meeting are automatically dropped, so this always
            reflects what's still outstanding, not a raw historical log.
            owner: optional name/username to filter by (leave blank for everyone)
            """
            try:
                items = memory_store.get_action_items(project_key, owner=owner or None)
                if not items:
                    scope = f" for {owner}" if owner else ""
                    return f"No open action items{scope}."
                lines = [f"Open action items ({len(items)}):"]
                for i in items:
                    who = i.get("owner") or "Unassigned"
                    text = i.get("text", "")
                    ref = i.get("created_in", "")
                    lines.append(f"  • [{who}] {text}" + (f" (from meeting {ref})" if ref else ""))
                return "\n".join(lines)
            except Exception as e:
                return f"Error fetching action items: {e}"

        @tool
        def remember_fact(fact: str) -> str:
            """
            Record a durable fact about this project that should be remembered going
            forward — independent of any single meeting or conversation (e.g. "the
            staging environment URL is X", "Alice is the on-call lead this sprint").
            Use this when the user explicitly tells you something to remember.
            fact: the fact to remember, stated plainly in one sentence
            """
            try:
                memory_store.remember_fact(project_key, fact, source="chat")
                return f"✅ Noted: {fact}"
            except Exception as e:
                return f"❌ Error saving fact: {e}"

        @tool
        def recall_facts(topic: str = "") -> str:
            """
            Recall durable facts previously saved about this project (via remember_fact
            or extracted from meetings), optionally filtered to a topic.
            topic: optional keyword/topic to filter by (leave blank for the most recent facts)
            """
            try:
                facts = memory_store.recall_facts(project_key, topic=topic or None)
                if not facts:
                    return "No project facts recorded yet."
                lines = ["Project facts:"]
                for f in facts:
                    lines.append(f"  • {f.get('fact', '')} (source: {f.get('source', 'unknown')})")
                return "\n".join(lines)
            except Exception as e:
                return f"Error recalling facts: {e}"

        read_tools.extend([
            search_meetings, get_project_decisions,
            get_action_items, remember_fact, recall_facts,
        ])

    if tier in ("none", "read"):
        return read_tools

    # ── WRITE TOOLS (write + admin) ──────────────────────────────────

    @tool
    def create_item(item_type: str, subject: str, description: str = "",
                    assigned_to: str = "", tags: str = "") -> str:
        """
        Create a new work item in the project.
        item_type: task | story | issue | epic
        subject: title of the item (required)
        description: optional detailed description
        assigned_to: optional username to assign to (must be a team member username)
        tags: optional comma-separated tags e.g. 'backend,urgent'
        """
        try:
            tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
            item = pm.create_item(
                project_id, item_type, subject, description,
                assigned_to or None, tag_list or None,
            )
            result = f"✅ Created {item_type} **#{item.item_id}**: {item.subject}"
            if item.assignee:
                result += f"\n   Assigned to: {item.assignee}"
            if item.url:
                result += f"\n   {item.url}"
            return result
        except Exception as e:
            logger.error("create_item error: %s", e)
            return f"❌ Error creating {item_type}: {e}"

    @tool
    def close_item(item_id: str) -> str:
        """
        Mark a work item as closed/done.
        item_id: the numeric ID of the item to close (e.g. '42')
        """
        try:
            item = pm.close_item(project_id, item_id)
            result = f"✅ Closed #{item.item_id}: **{item.subject}** → {item.status}"
            if item.url:
                result += f"\n   {item.url}"
            return result
        except Exception as e:
            return f"❌ Error closing item #{item_id}: {e}"

    @tool
    def update_item(item_id: str, subject: str = "", description: str = "",
                    assigned_to: str = "") -> str:
        """
        Update fields on an existing work item. Only provide fields you want to change.
        item_id: numeric ID of the item
        subject: new title (optional)
        description: new description (optional)
        assigned_to: username to assign to (optional)
        """
        try:
            fields: dict[str, Any] = {}
            if subject:
                fields["subject"] = subject
            if description:
                fields["description"] = description
            if assigned_to:
                members = pm.list_members(project_id)
                m = next((x for x in members if x["username"] == assigned_to), None)
                if m:
                    fields["assigned_to"] = m["id"]
                else:
                    return f"❌ User '{assigned_to}' not found in project. Use list_members to check usernames."
            if not fields:
                return "No fields to update. Provide at least one of: subject, description, assigned_to."
            item = pm.update_item(project_id, item_id, fields)
            return f"✅ Updated #{item.item_id}: **{item.subject}**"
        except Exception as e:
            return f"❌ Error updating item #{item_id}: {e}"

    @tool
    def create_epic(subject: str, description: str = "") -> str:
        """
        Create a new epic in the project.
        subject: title of the epic
        description: optional description
        """
        try:
            item = pm.create_epic(project_id, subject, description)
            result = f"✅ Created epic **#{item.item_id}**: {item.subject}"
            if item.url:
                result += f"\n   {item.url}"
            return result
        except Exception as e:
            return f"❌ Error creating epic: {e}"

    @tool
    def link_story_to_epic(story_id: str, epic_id: str) -> str:
        """
        Link a user story to an existing epic.
        story_id: numeric ID of the user story
        epic_id: numeric ID of the epic
        """
        try:
            item = pm.link_to_epic(project_id, story_id, epic_id)
            return f"✅ Linked story #{story_id} to epic #{epic_id}"
        except Exception as e:
            return f"❌ Error linking story to epic: {e}"

    write_tools = [create_item, close_item, update_item, create_epic, link_story_to_epic]

    if tier == "write":
        return read_tools + write_tools

    # ── ADMIN TOOLS (admin only) ─────────────────────────────────────

    @tool
    def bulk_create(items_json: str) -> str:
        """
        Create multiple items at once.
        items_json: JSON array of objects, each with 'item_type' and 'subject' keys.
        Example: [{"item_type":"task","subject":"Fix login bug"},{"item_type":"issue","subject":"UI crash"}]
        """
        try:
            items = json.loads(items_json)
            results = []
            for it in items:
                item = pm.create_item(project_id, it["item_type"], it["subject"],
                    it.get("description", ""))
                results.append(f"  ✅ #{item.item_id} [{item.item_type}] {item.subject}")
            return f"Bulk created {len(results)} items:\n" + "\n".join(results)
        except json.JSONDecodeError:
            return "❌ Invalid JSON. Format: [{\"item_type\":\"task\",\"subject\":\"...\"},...]"
        except Exception as e:
            return f"❌ Error in bulk create: {e}"

    @tool
    def bulk_close(item_ids_csv: str) -> str:
        """
        Close multiple items by ID.
        item_ids_csv: comma-separated numeric item IDs, e.g. '101,102,103'
        """
        try:
            ids = [i.strip() for i in item_ids_csv.split(",") if i.strip()]
            results = []
            for item_id in ids:
                try:
                    item = pm.close_item(project_id, item_id)
                    results.append(f"  ✅ #{item.item_id} {item.subject} → {item.status}")
                except Exception as e:
                    results.append(f"  ❌ #{item_id}: {e}")
            return f"Bulk close results ({len(ids)} items):\n" + "\n".join(results)
        except Exception as e:
            return f"❌ Error in bulk close: {e}"

    admin_tools = [bulk_create, bulk_close]
    return read_tools + write_tools + admin_tools
