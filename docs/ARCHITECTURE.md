# Architecture

## System diagram

```
Discord Voice ──► scrum-master-ai ──► KafkaTaskStore ──► MongoDB
                       │                    │
                MeetingEventPublisher        └──► Kafka: agent-bridge.task-events
                       │
                       └──► Kafka: agent-bridge.meeting-events
                                        │
                             ┌──────────▼──────────────────┐
                             │   BridgeConsumer (Python)   │
                             │  (inside agent-bridge bot)  │
                             │                             │
                             ├── task.created ──► TaigaSyncHandler ──► Taiga
                             ├── task.closed  ──► TaigaSyncHandler ──► Taiga
                             ├── meeting.started ──► MeetingMemoryInjector
                             ├── meeting.transcript ──► (optional live)
                             └── meeting.ended ──► ChannelMemoryStore
                                                        │
Discord Text ──► agent-bridge ──► LangChain Agent ─────┘
    @mention          │            (sees meeting context)
                      └──► Taiga REST API
```

## Topics

| Topic | Key | Events |
|---|---|---|
| `agent-bridge.task-events` | `orgId:channelId` | task.created, task.closed, task.updated |
| `agent-bridge.meeting-events` | `orgId:channelId` | meeting.started, meeting.transcript, meeting.ended |
