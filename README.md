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
open http://localhost:5173   # unified client (config dashboard + voice console)
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
| Agent Bridge config API | 8000 | http://localhost:8000 |
| Client (unified dashboard) | 5173 | http://localhost:5173 |
| Auth service (orgs/staff/sessions) | 4000 | http://localhost:4000 |
| Kafka | 9092/9093 | — |
| Kafka UI | 8080 | http://localhost:8080 |

`auth-service` is currently standalone (Phase 1 of the multi-tenancy plan) —
org registration, email verification, staff invites, and sessions all work
end to end, but `agent-bridge`/`scrum-master-ai` don't consume it yet and
`client` has no login screen yet. See `auth-service/README.md`.

## Docs
- [Architecture overview](docs/ARCHITECTURE.md)
- [Kafka event schema](docs/EVENT_SCHEMA.md)
- [Runbook](docs/RUNBOOK.md)
