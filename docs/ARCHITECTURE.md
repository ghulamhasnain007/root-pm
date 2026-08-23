# Architecture

## System diagram

```
                              ┌─────────────────────────────────────────┐
                              │             auth-service                │
                              │  (Fastify + MongoDB + Redis + Kafka)    │
                              │  • JWT auth (register, login, refresh)  │
                              │  • Org / staff management               │
                              │  • Per-org tool config (AES-256-GCM)    │
                              │  • GET /internal/tools/:id/orgs         │
                              └──────────┬───────────┬─────────────────┘
                                         │           │
                            Kafka event   │           │  HTTP (service-to-service)
                            (config.*)    │           │
              ┌──────────────────────────┘           └──────────────────────────┐
              ▼                                                                ▼
┌──────────────────────────┐                              ┌──────────────────────────────┐
│   scrum-master-ai (TS)   │                              │     agent-bridge (Python)     │
│                          │                              │                              │
│  BotConnectionManager    │  ◄── Kafka: config-events    │  DiscordPlatformManager      │
│    • discover orgs       │      (tool-config.updated)   │    • discover orgs           │
│    • connect per org     │      (tool-config.removed)   │    • connect per org         │
│    • 1:N Discord clients │                              │    • 1:N Discord platforms   │
│                          │                              │                              │
│  Kafka producers:        │                              │  ConfigEventConsumer:        │
│    • task-events         │  ──► Kafka ──►               │    • handle config.updated   │
│    • meeting-events      │      ◄── Kafka ◄──           │    • handle config.removed   │
└──────────────────────────┘                              └──────────────────────────────┘

Discord Voice ──► scrum-master-ai ──► TaigaTaskStore ──► Taiga   (direct, when TAIGA_* set)
      │                  │             └─ or ─► KafkaTaskStore ──► MongoDB
      │           MeetingEventPublisher                  │
      │                  │                    └──► Kafka: agent-bridge.task-events
      │                  └──► Kafka: agent-bridge.meeting-events
      │                                         │
      │                              ┌──────────▼──────────────────┐
      │                              │   BridgeConsumer (Python)   │
      │                              │  (inside agent-bridge bot,  │
      │                              │   shares the agent's memory)│
      │                              ├── task.created ──► TaigaSyncHandler ──► Taiga
      │                              ├── task.updated ──► TaigaSyncHandler ──► Taiga
      │                              ├── task.closed  ──► TaigaSyncHandler ──► Taiga
      │                              ├── meeting.started ──► MeetingMemoryInjector
      │                              ├── meeting.transcript ──► (optional live)
      │                              └── meeting.ended ──► ChannelMemoryStore
      │                                                         │
Discord Text ──► agent-bridge ──► LangChain Agent ──────────────┘
    @mention          │            (sees meeting context)
                      └──► Taiga REST API
```

## Multi-tenancy architecture

Each org has:
- **Own Discord bot token** (bring-your-own) — stored encrypted (AES-256-GCM) in auth-service `tool_configs` collection
- **Own set of staff members** — with roles (owner, admin, member)
- **Own connection(s)** — BotConnectionManager (scrum-master-ai) and DiscordPlatformManager (agent-bridge) each maintain 1:N Discord clients

Org discovery is **hybrid**:
1. **Startup cold-start**: `GET /internal/tools/:toolId/orgs` from auth-service
2. **Live updates**: Kafka events on `agent-bridge.config-events` topic (`tool-config.updated`, `tool-config.removed`)

The client dashboard requires JWT authentication and shows per-org staff, tool config, and connection status.

When `TAIGA_URL`/`TAIGA_USER`/`TAIGA_PASS`/`TAIGA_PROJECT_SLUG` are set for the
voice bot, the ambient assistant uses `TaigaTaskStore` and reads/writes the real
PM platform directly (create, close, update/assign, list, sprint and member
queries). Without Taiga, it falls back to `KafkaTaskStore` (MongoDB + Kafka → the
bridge mirrors events to Taiga) or plain `MongoTaskStore`.

The MeetingMemoryInjector runs inside the agent-bridge bot process and shares the
same memory store (`DualMemoryStore` when Redis/MongoDB are configured, else
`ChannelMemoryStore`) the chat agent reads, so meeting transcripts are visible
to the text agent.

## Memory architecture

Memory is split across two layers plus a background reconciliation process:

- **Redis (working memory)** — per-channel conversation history (ring buffer,
  TTL'd), keyed by `channel:{channel_id}:history`.
- **MongoDB (durable memory)** — four collections:
  - `meetings` — one document per meeting: raw transcript, participants, and
    (once processed) extracted `decisions`/`action_items`/`blockers`/`topics`.
    Keyed by `text_channel_id` *and* `project_key` (a channel maps to exactly
    one project; a project can span multiple channels).
  - `project_context` — one document per `project_key` (`_id`), holding the
    **reconciled** current state: `open_action_items`, `open_blockers`,
    `recent_decisions`. This is updated, not just appended to — the
    consolidation worker retires items a later meeting indicates are resolved.
  - `project_facts` — durable, project-scoped facts independent of any single
    meeting (asserted via chat with `remember_fact` or extracted during
    consolidation). Contradicted facts are marked `superseded` rather than
    deleted, preserving history.
  - `meeting_chunks` — embedded chunks (raw transcript segments plus
    individually-embedded decisions/action items/blockers/topics) used for
    semantic search. Populated only when `GEMINI_API_KEY` is set; absent it,
    search falls back to MongoDB regex matching only.

**Consolidation** (`python-consumer/memory/consolidation.py`) runs as a
background thread, polling every 5 minutes for meetings older than 10 minutes
with `consolidated: false`. It claims meetings atomically
(`find_one_and_update`, safe for multiple consumer replicas), calls the LLM to
extract structured entities, and reconciles them into `project_context` and
`project_facts` — passing the currently-open items into the extraction prompt
so the LLM can report what got resolved, not just what's new.

**Retrieval** (`agent/context.py`, `agent/agent.py`) is token-budgeted and
query-aware: `ContextAssembler` fits meeting summaries and conversation
history into `memory_max_tokens`, and meeting summaries are chosen by
semantic relevance to the current message (via `meeting_chunks`) when
embeddings are configured, falling back to recency otherwise.
`search_meetings` combines keyword/regex matching with semantic search and
merges results by meeting.

## Topics

| Topic | Key | Events |
|---|---|---|
| `agent-bridge.task-events` | `orgId:channelId` | task.created, task.closed, task.updated |
| `agent-bridge.meeting-events` | `orgId:channelId` | meeting.started, meeting.transcript, meeting.ended |
| `agent-bridge.config-events` | `orgId` | tool-config.updated, tool-config.removed |
