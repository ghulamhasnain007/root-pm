# Runbook

## Adding a new Taiga project

1. Open the Agent Bridge dashboard at http://localhost:5174
2. Go to Channel map → Add row
3. Enter the Discord guild ID, channel ID, and Taiga project slug
4. Save — the bot picks up the new mapping immediately (no restart needed)

## Checking Kafka events

Open Kafka UI at http://localhost:8080
→ Topics → agent-bridge.task-events → Messages

## Resetting agent memory for a channel

The memory is in-process. Restart the agent-bot service:
```bash
docker compose restart agent-bot
```

## Voice bot not publishing to Kafka

Check KAFKA_BROKERS is set correctly in scrum-master-ai backend .env:
```bash
docker logs voice-bot | grep Kafka
```

If KAFKA_BROKERS is unset, the voice bot silently falls back to MongoDB-only.

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `KAFKA_BROKERS not set` | Env var missing | Add KAFKA_BROKERS to .env |
| `No channel map for voice channel` | VOICE_TO_TEXT_CHANNEL_MAP missing | Add mapping in .env |
| `Could not find Taiga project` | Wrong project slug | Check slug in dashboard Channel map |
