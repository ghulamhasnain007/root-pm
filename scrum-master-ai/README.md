# 🤖 Scrum Master AI — Voice Bot Backend

The voice half of Root-PM: joins Discord voice channels, runs structured
standups and an always-on ambient assistant over the **Google Gemini Live
API**, and manages OAuth-based meeting-platform integrations (Zoom, Google
Meet, Microsoft Teams) alongside Discord.

**This package has no frontend of its own.** All dashboard UI for this
service — Schedule, Ambient, Integrations — lives in the repo's unified
[`client/`](../client) app (`/voice/*` routes), which talks to this
backend's REST API. There used to be a separate `scrum-master-ai/frontend`;
it was merged into `client/` so the whole system has one dashboard instead
of two. If you're looking for the UI, that's where it is now.

---

## What this service does

- **Structured standups** — joins a Discord voice channel, runs a live
  voice-to-voice conversation over Gemini Live (server-side voice activity
  detection, no push-to-talk), collects yesterday/today/blockers via
  function calling, and auto-summarizes when the time limit is reached.
- **Ambient assistant** — an always-on presence in a configured channel
  that listens for explicit task-management requests ("create a task
  to…", "mark that done") without running a formal standup.
- **Scheduling** — recurring or one-off standup times, auto-launched by a
  background poller with no manual "start meeting" step.
- **Meeting-platform integrations** — pluggable OAuth adapters (Discord,
  Zoom, Google Meet, Teams) behind one common interface; see
  `src/integrations/`.

## Multi-org / authentication

This service is multi-tenant: every route that reads or writes org-specific
data (schedules, ambient config, tool credentials, task history) resolves
`orgId` from the caller's authenticated session — a JWT issued by
[`auth-service`](../auth-service), verified against its published JWKS. See
`src/auth/requireAuth.ts`.

If `AUTH_SERVICE_URL` isn't set, this service falls back to a fixed
`orgId: "default"` with no authentication required — useful for standalone
local development without standing up auth-service, but not for anything
resembling production. Set `AUTH_SERVICE_URL` (and have the `client` app
send a real session token) to enforce real per-org auth. See
`backend/.env.example`.

---

## Quick start

### Prerequisites
- Node.js 18+
- A [Gemini API key](https://aistudio.google.com/apikey) (free tier is enough for testing)

### Install & run

```bash
cd scrum-master-ai
npm install              # installs concurrently (used by the monorepo root's dev script)
npm run setup             # installs backend deps
cd backend
cp .env.example .env
# edit .env — set GEMINI_API_KEY, and AUTH_SERVICE_URL if running with auth-service
npm run dev
```

The backend listens on `:3001` by default. Point the unified `client` app
(see the repo root README) at it via `VITE_VOICE_API`.

---

## Project structure

```
scrum-master-ai/
├── package.json
├── README.md
└── backend/
    ├── .env.example
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts                    # Fastify server entry
        ├── config/index.ts             # Env configuration
        ├── auth/                       # JWT verification against auth-service's JWKS
        │   ├── jwksVerifier.ts
        │   └── requireAuth.ts
        ├── handlers/websocket.ts       # WS route (one session per client)
        ├── services/
        │   ├── MeetingStateService.ts  # Owns standup state, independent of transport
        │   ├── GeminiLiveService.ts    # Raw WS client for Gemini Live API
        │   └── MeetingSession.ts       # Orchestrates session + timer
        └── integrations/
            ├── discord/                # Discord bot client, ambient assistant, meeting manager
            ├── scheduling/             # Recurring standup scheduler + per-provider launchers
            ├── store/                  # Pluggable credential/connection storage (Mongo, file, auth-service)
            ├── adapters/                # Zoom/Google Meet/Teams OAuth adapters
            └── routes/                  # REST API — schedules, integrations, Discord meetings
```

---

## Architecture

```
Discord voice channel
  │  Opus audio via @discordjs/voice
  ▼
DiscordMeetingManager / DiscordAmbientRoom
  │  PCM16 16kHz audio chunks
  ▼
GeminiLiveService / GeminiAmbientService
  │  Raw WebSocket to Gemini Live API
  ▼
Google Gemini Live API
  ├── Server VAD (detects speech start/end)
  ├── gemini-2.5-flash-native-audio-preview (text + audio I/O)
  ├── Function calling → update_standup_data / ambient task actions
  └── Audio output: PCM16 24kHz
```

**Key design decisions:**

- **Backend owns state** — meeting/standup state lives in
  `MeetingStateService`, independent of the Discord transport.
- **Raw WebSocket** to Gemini Live API (no SDK dependency, full protocol
  control).
- **Function calling** — Gemini calls structured functions
  (`update_standup_data`, task-management tools) to report state back to
  the backend, rather than free-text parsing.
- **Server VAD** — Gemini detects speech automatically, no push-to-talk.
- **Pluggable storage** — credentials, connections, and schedules are all
  behind interfaces (`CredentialsStore`, `IntegrationStore`,
  `ScheduledMeetingStore`) with Mongo/file/auth-service-backed
  implementations, so swapping the backing store never touches route or
  business logic.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | *(required)* | Google AI API key |
| `GEMINI_MODEL` | `gemini-2.5-flash-native-audio-preview-12-2025` | Model to use |
| `PORT` | `3001` | Backend port |
| `HOST` | `0.0.0.0` | Backend host |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed origin for the `client` app |
| `AUTH_SERVICE_URL` | *(unset — single-org fallback)* | auth-service base URL; enables real per-org authentication |
| `MONGODB_URI` | *(required for scheduling/ambient)* | MongoDB connection string |
| `INTEGRATIONS_STORAGE_DRIVER` | `mongo` | `mongo` \| `file` — OAuth token storage |
| `CREDENTIALS_STORE_DRIVER` | matches `INTEGRATIONS_STORAGE_DRIVER` | `mongo` \| `file` \| `auth-service` — tool credential storage |

See `backend/.env.example` for the complete list.

### Changing the voice

In `GeminiLiveService.ts`, change `voiceName` in `sendSetup()`. Available
voices: `Puck`, `Charon`, `Kore`, `Fenrir`, `Aoede` (default), `Orbit`, `Zephyr`.

---

## Troubleshooting

**"GEMINI_API_KEY environment variable is required"**
→ Make sure `backend/.env` exists (copied from `.env.example`) with a real key set.

**Every `/integrations/*` request returns 401**
→ `AUTH_SERVICE_URL` is set, so real authentication is enforced — the
caller (normally the `client` app) needs a valid session token. For local
testing without auth-service, unset `AUTH_SERVICE_URL`.

**Connection drops during a meeting**
→ The Gemini Live API has a session time limit (~10 min). For longer
meetings, implement session resumption via `sessionResumption` in the
setup config.

**Model not available**
→ Try `GEMINI_MODEL=gemini-2.0-flash-live-001`, the stable GA model with
broader availability.
