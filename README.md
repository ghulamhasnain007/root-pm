# Agent Bridge — Event-Driven AI Project Management Platform

A monorepo containing two AI services connected by Kafka:

| Service | Language | Role |
|---|---|---|
| `scrum-master-ai` | Node.js + TypeScript | Voice bot — Discord voice channels, Gemini Live audio, task creation |
| `agent-bridge` | Python | Text bot — @mention interface, LangChain + Gemini agent, Taiga integration |

Kafka connects them: voice-created tasks are mirrored to Taiga, meeting transcripts are injected into the agent's memory.

## Quick start (Docker)
```bash
cp .env.example .env   # fill in your credentials
docker compose up -d
open http://localhost:5173   # voice bot dashboard
open http://localhost:5174   # agent-bridge config dashboard
open http://localhost:8080   # Kafka UI
```

## Quick start (local dev)
```bash
bash scripts/start-dev.sh
```

## Services & ports
| Service | Port | URL |
|---|---|---|
| Voice bot backend | 3001 | http://localhost:3001 |
| Voice bot frontend | 5173 | http://localhost:5173 |
| Agent Bridge config API | 8000 | http://localhost:8000 |
| Agent Bridge dashboard | 5174 | http://localhost:5174 |
| Kafka | 9092/9093 | — |
| Kafka UI | 8080 | http://localhost:8080 |

## Docs
- [Architecture overview](docs/ARCHITECTURE.md)
- [Kafka event schema](docs/EVENT_SCHEMA.md)
- [Runbook](docs/RUNBOOK.md)
