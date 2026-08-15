# Architecture

## System diagram

```
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

When `TAIGA_URL`/`TAIGA_USER`/`TAIGA_PASS`/`TAIGA_PROJECT_SLUG` are set for the
voice bot, the ambient assistant uses `TaigaTaskStore` and reads/writes the real
PM platform directly (create, close, update/assign, list, sprint and member
queries). Without Taiga, it falls back to `KafkaTaskStore` (MongoDB + Kafka → the
bridge mirrors events to Taiga) or plain `MongoTaskStore`.

The MeetingMemoryInjector runs inside the agent-bridge bot process and shares the
same `ChannelMemoryStore` the chat agent reads, so meeting transcripts are visible
to the text agent.

## Topics

| Topic | Key | Events |
|---|---|---|
| `agent-bridge.task-events` | `orgId:channelId` | task.created, task.closed, task.updated |
| `agent-bridge.meeting-events` | `orgId:channelId` | meeting.started, meeting.transcript, meeting.ended |
