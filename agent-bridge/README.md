# Agent Bridge

A pluggable agentic system that connects Discord to Taiga via LangChain + Gemini AI.
Team members talk to the bot in Discord — it creates tasks, closes issues, queries sprints, and more.

## Quick Start (3 steps)

### Step 1 — Install dependencies
```bash
pip install -r requirements.txt
```

### Step 2 — Start the config dashboard
```bash
# Terminal 1 — Config API
cd backend
uvicorn main:app --reload --port 8000

# Terminal 2 — React UI
cd frontend2
npm install && npm run dev
```
Open http://localhost:5173, configure everything, save.

### Step 3 — Start the bot
```bash
# Terminal 3 — The actual Discord bot
python main.py --config backend/data/config.json
```

That's it. The bot is now live in Discord.

---

## Two Processes, One System

| Process | Command | Purpose |
|---|---|---|
| Config API | `cd backend && uvicorn main:app --reload` | Serves the admin dashboard |
| Discord Bot | `python main.py` | The actual agent that handles messages |

Both must run. The dashboard saves `backend/data/config.json`. The bot reads it.

---

## What the Bot Can Do

Users @mention the bot or use the trigger role (default: `@FYP`):

```
@bot create a task "Fix login timeout bug" and assign to alice
@bot close task #204
@bot what's open in the current sprint?
@bot create an epic "User Authentication" with stories for login, password reset, JWT
@bot list all open issues assigned to me
@bot search for payment
```

## Permission Tiers

| Discord Role | Tier | Can Do |
|---|---|---|
| Project Manager | admin | Everything including bulk operations |
| Developer | write | Create, update, close items |
| Intern | read | List, search, query only |
| (not listed) | none | Bot ignores them |

Configure roles in the dashboard → Permissions page.

## Channel Mapping

Each Discord channel must be mapped to a Taiga project slug.
Configure in the dashboard → Channel map page.

To find IDs: Discord → Settings → Advanced → Developer Mode → right-click server/channel → Copy ID.

## Project Structure

```
agent-bridge-app/
├── main.py                          ← Bot bootstrap (run this)
├── requirements.txt                 ← All Python dependencies
├── core/
│   ├── base.py                      ← Abstract interfaces
│   └── registry.py                  ← @comm_platform / @pm_platform decorators
├── platforms/
│   ├── communication/
│   │   ├── discord_platform.py      ← Discord adapter (live)
│   │   └── slack_platform.py        ← Stub (coming soon)
│   └── pm/
│       ├── taiga_platform.py        ← Taiga adapter (live)
│       ├── jira_platform.py         ← Stub (coming soon)
│       └── linear_platform.py       ← Stub (coming soon)
├── agent/
│   ├── agent.py                     ← AgentBridge orchestrator
│   └── tools.py                     ← 14 LangChain tools
├── backend/                         ← FastAPI config dashboard API
│   ├── main.py
│   ├── core/store.py
│   ├── models/schemas.py
│   ├── routers/
│   └── services/
├── frontend2/                       ← React config dashboard UI
├── tests/test_suite.py              ← 30+ unit tests
├── docker-compose.yml
└── .env.example
```

## Running Tests

```bash
pytest tests/ -v
```

## Docker

```bash
cp .env.example .env
# Fill in your credentials in .env
docker compose up -d
```
