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
Injected into the agent's per-channel memory as a SystemMessage, and
persisted to MongoDB by `DualMemoryStore.save_meeting`.

**Note on `channelId`:** this field is the *voice* channel the meeting took
place in, not the Discord text channel the chat agent reads from. Consumers
must resolve it to a text channel via `VOICE_TO_TEXT_CHANNEL_MAP` before using
it as a memory key — `MeetingMemoryInjector` does this resolution and passes
the resolved text channel id (plus the project key resolved from
`channel_mappings`) explicitly into `save_meeting`, rather than the raw event
field. An earlier version stored the raw voice channel id directly, which
silently broke every subsequent meeting-context lookup for that channel.

## tool-config.updated

Published by auth-service when an org's tool configuration is created or updated.
Consumed by scrum-master-ai (BotConnectionManager) and agent-bridge
(DiscordPlatformManager) to establish or update per-org connections.

Key: `orgId` (not `toolId` — partitioning by org keeps all of one org's
events in order relative to each other, which matters more than ordering
across orgs for the same tool).

```typescript
{
  schemaVersion: "1.0";
  eventType: "tool-config.updated";
  sourceSystem: "auth-service";
  publishedAt: number;
  toolId: string;        // "discord"
  orgId: string;         // org id (uuid), not a slug
}
```

Note: `category` (`communication` | `project_management` | `meeting_provider`)
is stored in auth-service's `tool_configs` collection but is NOT included in
this event payload — consumers that need it look it up via
`GET /internal/orgs/:orgId/tools/:toolId/credentials` or already know it
implicitly (e.g. DiscordPlatformManager only ever handles `toolId: "discord"`).

## tool-config.removed

Published by auth-service when an org's tool configuration is deleted.
Consumed by scrum-master-ai and agent-bridge to tear down the org's connection.

Key: `orgId` (same reasoning as tool-config.updated above).

```typescript
{
  schemaVersion: "1.0";
  eventType: "tool-config.removed";
  sourceSystem: "auth-service";
  publishedAt: number;
  toolId: string;
  orgId: string;
}
```
