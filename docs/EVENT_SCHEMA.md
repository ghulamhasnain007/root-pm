# Kafka Event Schema

Schema version: `1.0`

All events share these envelope fields:
- `schemaVersion` — always "1.0"
- `eventType` — routing key
- `sourceSystem` — "scrum-master-ai" or "agent-bridge"
- `publishedAt` — Unix ms timestamp

See `scrum-master-ai/backend/src/kafka/events.ts` for the canonical TypeScript definitions.

## task.created
Published when the voice bot creates a task (voice command or meeting discussion).
Consumed by agent-bridge → creates item in Taiga.

## task.closed
Published when the voice bot closes a task.
Consumed by agent-bridge → closes item in Taiga.

## task.updated
Published when the voice bot updates a task (rename, description change, or
assignment via `update_task`). Carries:
- `changes` — only the fields that actually changed (`title`, `description`, `assignee`)
- `title` — current (post-change) title
- `previousTitle` — title before the change

Consumed by agent-bridge → finds the item in Taiga (by `previousTitle` when the
task was renamed, otherwise by `title`) and patches that item (`assigned_to` is
resolved against the project's membership list).

## meeting.started
Published when the voice bot joins a Discord channel and starts an ambient session.

## meeting.transcript
Published on every Gemini Live transcript turn (user or assistant).
Optional live injection into agent memory (INJECT_LIVE_TRANSCRIPT=true).

## meeting.ended
Published when the ambient session ends.
Contains the complete transcript and a list of tasks created/closed.
Injected into the agent's per-channel memory as a SystemMessage.
