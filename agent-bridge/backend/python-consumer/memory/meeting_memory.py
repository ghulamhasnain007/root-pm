"""
memory/meeting_memory.py
────────────────────────
Injects meeting context from Kafka events into the agent's per-channel
memory (the DualMemoryStore in agent/agent.py).

When a meeting ends, a rich summary is built from the full transcript and
injected as a SystemMessage into the channel's conversation history. This means
when a developer types "@bot create a task for the auth bug Alice mentioned"
— the agent already has the entire meeting transcript in its context window
and can resolve "Alice" and "the auth bug" without asking.

The DualMemoryStore also persists the meeting to MongoDB for long-term recall.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from langchain_core.messages import SystemMessage, HumanMessage

logger = logging.getLogger("agent_bridge.meeting_memory")


def _fmt_timestamp(ts_ms: int) -> str:
    dt = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
    return dt.strftime("%H:%M:%S UTC")


def build_meeting_summary_message(event: dict) -> SystemMessage:
    """
    Convert a meeting.ended event into a SystemMessage that gets injected
    into the channel's conversation history.
    """
    summary   = event.get("summary", {})
    meeting_id = event.get("meetingId", "unknown")
    channel_id = event.get("channelId", "unknown")
    ended_at   = event.get("endedAt", 0)
    duration_ms = event.get("durationMs", 0)
    duration_min = round(duration_ms / 60_000, 1)

    participants = summary.get("participants", [])
    tasks_created = summary.get("tasksCreated", [])
    tasks_closed  = summary.get("tasksClosed", [])
    full_transcript = summary.get("fullTranscript", [])

    # ── Build the transcript text ─────────────────────────────────────────────
    lines = []
    for entry in full_transcript:
        role    = entry.get("role", "user")
        speaker = entry.get("speakerName", "Assistant" if role == "assistant" else "Unknown")
        text    = entry.get("text", "").strip()
        ts      = _fmt_timestamp(entry.get("timestamp", 0))
        if text:
            lines.append(f"  [{ts}] {speaker}: {text}")

    transcript_text = "\n".join(lines) if lines else "  (no transcript recorded)"

    participant_names = ", ".join(p.get("name", "?") for p in participants) or "unknown"

    tasks_section = ""
    if tasks_created:
        tasks_section += f"\nTasks CREATED during this meeting: {', '.join(tasks_created)}"
    if tasks_closed:
        tasks_section += f"\nTasks CLOSED during this meeting: {', '.join(tasks_closed)}"

    content = f"""[MEETING CONTEXT — injected automatically]
Meeting ID: {meeting_id}
Voice channel: {channel_id}
Ended at: {_fmt_timestamp(ended_at)}
Duration: {duration_min} minutes
Participants ({len(participants)}): {participant_names}{tasks_section}

FULL TRANSCRIPT:
{transcript_text}

[END OF MEETING CONTEXT]
This context is available for you to reference when answering questions or creating tasks.
"""

    return SystemMessage(content=content)


def build_transcript_chunk_message(event: dict) -> HumanMessage | None:
    """
    Optional: inject individual transcript lines as they arrive (streaming context).
    Only used when real-time context injection is enabled.
    """
    text = event.get("text", "").strip()
    if not text:
        return None
    role   = event.get("role", "user")
    speaker = event.get("speakerName", "Voice bot" if role == "assistant" else "Unknown")
    ts     = _fmt_timestamp(event.get("timestamp", 0))
    return HumanMessage(content=f"[Live meeting transcript — {speaker} at {ts}]: {text}")


class MeetingMemoryInjector:
    """
    Receives Kafka events and injects meeting context into the agent's
    memory store (DualMemoryStore or ChannelMemoryStore).

    Wire-up in main.py:
        injector = MeetingMemoryInjector(memory_store, channel_map)
        consumer.on("meeting.ended",      injector.on_meeting_ended)
        consumer.on("meeting.transcript", injector.on_transcript)    # optional streaming
        consumer.on("meeting.started",    injector.on_meeting_started)
    """

    def __init__(self, memory_store, channel_map: dict[str, str],
                 inject_live_transcript: bool = False,
                 project_key_map: dict[str, str] | None = None):
        """
        memory_store: the DualMemoryStore (or ChannelMemoryStore) instance
        channel_map:  {voice_channel_id → discord_text_channel_id}
                      Routes meeting events to the right text channel's memory.
        inject_live_transcript: if True, inject each transcript line in real time.
        project_key_map: {discord_text_channel_id → PM project key/slug}
                      Used to scope persisted meeting memory by project (not
                      just channel), so channels mapped to the same project
                      share recall. Falls back to no project scoping (empty
                      string) if a channel has no mapping — memory still
                      works, just isn't cross-channel-searchable by project.
        """
        self._memory  = memory_store
        self._map     = channel_map
        self._live    = inject_live_transcript
        self._project_key_map = project_key_map or {}

    def _target_channel(self, voice_channel_id: str) -> str | None:
        """Map a voice channel to the Discord text channel whose memory we update."""
        return self._map.get(str(voice_channel_id))

    def _project_key_for(self, text_channel_id: str) -> str | None:
        """Resolve the PM project key/slug for a given text channel."""
        return self._project_key_map.get(str(text_channel_id))

    def on_meeting_started(self, event: dict) -> None:
        channel_id = event.get("channelId", "")
        target     = self._target_channel(channel_id)
        participants = [p.get("name", "?") for p in event.get("participants", [])]
        logger.info("Meeting started in channel %s → injecting start notice into %s",
                    channel_id, target or "nowhere")
        if not target:
            return
        notice = SystemMessage(content=(
            f"[MEETING STARTED in voice channel {channel_id}] "
            f"Participants: {', '.join(participants) or 'unknown'}. "
            f"Meeting ID: {event.get('meetingId', '?')}. "
            f"Tasks discussed in this meeting will appear in context when it ends."
        ))
        self._memory.append(target, [notice])

    def on_transcript(self, event: dict) -> None:
        if not self._live:
            return
        channel_id = event.get("channelId", "")
        target     = self._target_channel(channel_id)
        if not target:
            return
        msg = build_transcript_chunk_message(event)
        if msg:
            self._memory.append(target, [msg])

    def on_meeting_ended(self, event: dict) -> None:
        channel_id = event.get("channelId", "")
        target     = self._target_channel(channel_id)
        logger.info("Meeting ended in channel %s → injecting full summary into memory channel %s",
                    channel_id, target or "nowhere (no mapping)")
        if not target:
            logger.warning(
                "No text channel mapped for voice channel %s. "
                "Add it to VOICE_TO_TEXT_CHANNEL_MAP in config.", channel_id)
            return

        # 1. Inject summary into channel conversation history (short-term)
        summary_msg = build_meeting_summary_message(event)
        self._memory.append(target, [summary_msg])
        logger.info("Meeting summary injected into channel %s memory (%d transcript lines)",
                    target, event.get("summary", {}).get("transcriptLineCount", 0))

        # 2. Persist to MongoDB for long-term recall (DualMemoryStore only)
        if hasattr(self._memory, "save_meeting"):
            try:
                self._memory.save_meeting(
                    event,
                    project_key=self._project_key_for(target),
                    channel_id=target,
                )
            except Exception as e:
                logger.error("Failed to persist meeting to long-term storage: %s", e)
