# 🤖 AI Scrum Master — Gemini Live Edition

A full-stack AI-powered Scrum Master that conducts daily standup meetings through real-time voice conversation, powered by the **Google Gemini Live API** (free tier available).

---

## ✨ Features

- **Real-time voice conversation** — speak naturally, AI listens and responds by voice
- **Structured standup** — collects yesterday's work, today's plan, and blockers
- **Time-aware AI** — adapts pacing based on remaining meeting time
- **Auto time-limit handling** — summarizes and closes when time runs out
- **Live transcript** — both user and AI speech appear in real time
- **Structured data panel** — standup info updates as the conversation progresses
- **Phase tracker** — visual stepper showing current standup phase
- **Completion ring** — 0–100% progress indicator
- **Topic guard** — AI redirects off-topic conversations back to the standup
- **Urgency timer** — color changes green → yellow → orange → red as time runs out

---

## 🆓 Free API Access

1. Go to **https://aistudio.google.com/apikey**
2. Sign in with a Google account
3. Click **Create API key**
4. Copy it — that's it!

Gemini API has a **free tier** with generous limits, plenty for running standups.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- A microphone
- Chrome or Edge (best WebAudio support)

### 1. Install

```bash
cd scrum-master-ai
npm install        # installs concurrently
npm run setup      # installs backend + frontend deps
```

### 2. Configure

```bash
cd backend
cp .env.example .env
# Edit .env — set GEMINI_API_KEY=your-key-here
```

### 3. Run

```bash
# From the root directory:
npm run dev
```

Or separately:
```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

### 4. Open

**http://localhost:5173**

Click **Start Daily Standup**, allow microphone access, and start talking!

---

## 🗂 Project Structure

```
scrum-master-ai/
├── package.json               # Root scripts (concurrently)
├── README.md
│
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                      # Fastify server entry
│       ├── config/index.ts               # Env configuration
│       ├── types/index.ts                # Shared TypeScript types
│       ├── handlers/websocket.ts         # WS route (one session per client)
│       └── services/
│           ├── MeetingStateService.ts    # Owns all meeting state
│           ├── GeminiLiveService.ts      # Raw WS client for Gemini Live API
│           └── MeetingSession.ts         # Orchestrates session + timer
│
└── frontend/
    ├── index.html
    ├── vite.config.ts
    ├── tailwind.config.js
    └── src/
        ├── main.tsx
        ├── App.tsx                       # Root layout
        ├── index.css                     # Tailwind + animations
        ├── types/index.ts                # Shared types
        ├── hooks/
        │   ├── useMeeting.ts             # Main state hook
        │   ├── useWebSocket.ts           # Auto-reconnecting WS hook
        │   └── useAudio.ts               # Mic capture (16 kHz) + playback (24 kHz)
        └── components/
            ├── MeetingControls.tsx       # Start/End + mic visualizer
            ├── MeetingTimer.tsx          # Countdown with urgency colors
            ├── TranscriptPanel.tsx       # Live conversation bubbles
            └── StandupPanel.tsx          # Structured data + phase stepper
```

---

## 🏗 Architecture

```
Browser (React + WebAudio)
  │  PCM16 16kHz audio chunks (base64)
  │  WS JSON messages
  ▼
Fastify Backend  (Node.js :3001)
  │  MeetingSession ──► MeetingStateService (owns state)
  │         └──────────► GeminiLiveService
  │                           │
  │                    Raw WebSocket
  ▼
Google Gemini Live API
  ├── Server VAD (detects speech start/end)
  ├── gemini-2.5-flash-native-audio-preview (text + audio I/O)
  ├── Function calling → update_standup_data
  └── Audio output: PCM16 24kHz → base64 chunks
```

**Key design decisions:**

- **Backend owns state** — the frontend is pure display + mic/speaker I/O
- **Raw WebSocket** to Gemini Live API (no SDK dependency, full protocol control)
- **Function calling** — after every user response, Gemini calls `update_standup_data` to populate the structured standup state
- **Server VAD** — Gemini detects speech automatically, no push-to-talk needed
- **Time-context injection** — after each user turn, a silent text message updates the AI about remaining time
- **Time-limit trigger** — server-side interval fires a summary instruction when time expires

---

## ⚙ Configuration

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | *(required)* | Google AI API key |
| `GEMINI_MODEL` | `gemini-2.5-flash-native-audio-preview-12-2025` | Model to use |
| `PORT` | `3001` | Backend port |
| `HOST` | `0.0.0.0` | Backend host |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed frontend origin |

### Changing the voice

In `GeminiLiveService.ts`, change `voiceName` in `sendSetup()`:

Available voices: `Puck`, `Charon`, `Kore`, `Fenrir`, `Aoede` (default), `Orbit`, `Zephyr`

### Changing the model

In your `.env`:
```
# Best quality (native audio):
GEMINI_MODEL=gemini-2.5-flash-native-audio-preview-12-2025

# Stable GA release:
GEMINI_MODEL=gemini-2.0-flash-live-001
```

---

## 🔧 Extending

- **Persistence** — add a DB call in `MeetingSession.endMeeting()` to save summaries
- **Multi-user** — add a session map in `websocket.ts` keyed by user ID
- **Export** — add a REST endpoint that returns standup JSON or generates a PDF
- **Slack/Teams** — post the standup summary to a channel when meeting completes
- **Custom phases** — add new phases to the enum + system prompt
- **Video input** — Gemini Live supports video frames; extend `GeminiLiveService` to forward webcam frames

---

## 🛠 Troubleshooting

**"GEMINI_API_KEY environment variable is required"**
→ Make sure you created `backend/.env` from `.env.example` and set your key.

**Microphone not working**
→ Must be on `localhost` (not an IP). Check browser permissions (lock icon in address bar).

**Audio echo / feedback**
→ Use headphones. The AI's voice will otherwise loop back into the mic.

**Model not available**
→ Try `GEMINI_MODEL=gemini-2.0-flash-live-001` which is the stable GA model with broader availability.

**Connection drops during meeting**
→ The Gemini Live API has a session time limit (~10 min). For longer meetings, implement session resumption using `sessionResumption` in the setup config.
