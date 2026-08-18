# Runbook

## Adding a new Taiga project

1. Open the client at http://localhost:5173 (Channel map is under the config dashboard section)
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

## Voice bot not writing to Taiga

The voice bot writes straight to Taiga when all of `TAIGA_URL`, `TAIGA_USER`,
`TAIGA_PASS` and `TAIGA_PROJECT_SLUG` are set — check the startup log line:

```bash
docker logs voice-bot | grep -i "store="
```

Otherwise it uses `KafkaTaskStore` (MongoDB + Kafka) and the agent-bridge bot's
`TaigaSyncHandler` mirrors task created/updated/closed to Taiga.

## Chat agent has no meeting context

Meeting transcripts only reach the chat agent when the Kafka bridge runs inside
the agent-bot process (it shares the agent's memory store). Confirm:

```bash
docker logs agent-bot | grep "Kafka bridge active"
```

If the line says `KAFKA_BROKERS not set` the bot process can't consume meeting
events. Also verify `VOICE_TO_TEXT_CHANNEL_MAP` maps the voice channel to the
text channel whose memory the agent reads.

## Common errors

| Error | Cause | Fix |
|---|---|---|
| `KAFKA_BROKERS not set` | Env var missing | Add KAFKA_BROKERS to .env |
| `No channel map for voice channel` | VOICE_TO_TEXT_CHANNEL_MAP missing | Add mapping in .env |
| `Could not find Taiga project` | Wrong project slug | Check slug in dashboard Channel map |
