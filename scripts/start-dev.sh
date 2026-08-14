#!/bin/bash
# start-dev.sh — Start all services locally for development

set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "Starting development environment from $ROOT"

# ── 1. Kafka (Docker) ─────────────────────────────────────────────────────────
echo "[1/5] Starting Kafka..."
docker compose -f "$ROOT/docker/docker-compose.yml" up -d kafka kafka-init kafka-ui
echo "  Kafka UI → http://localhost:8080"

# ── 2. Voice bot backend ──────────────────────────────────────────────────────
echo "[2/5] Starting voice bot backend (scrum-master-ai)..."
cd "$ROOT/scrum-master-ai/backend"
npm install --silent
KAFKA_BROKERS=localhost:9093 npm run dev &
SMA_PID=$!
echo "  Voice backend → http://localhost:3001 (pid $SMA_PID)"

# ── 3. Voice bot frontend ─────────────────────────────────────────────────────
echo "[3/5] Starting voice bot frontend..."
cd "$ROOT/scrum-master-ai/frontend"
npm install --silent
npm run dev -- --port 5173 &
FRONTEND_PID=$!
echo "  Voice frontend → http://localhost:5173 (pid $FRONTEND_PID)"

# ── 4. Agent Bridge config API ────────────────────────────────────────────────
echo "[4/5] Starting agent-bridge config API..."
cd "$ROOT/agent-bridge"
pip install -q -r requirements.txt
cd backend
uvicorn main:app --reload --port 8000 &
API_PID=$!
echo "  Config API → http://localhost:8000 (pid $API_PID)"

# ── 5. Agent Bridge dashboard ─────────────────────────────────────────────────
echo "[5/5] Starting agent-bridge dashboard..."
cd "$ROOT/agent-bridge/frontend"
npm install --silent
npm run dev -- --port 5174 &
DASH_PID=$!
echo "  Dashboard → http://localhost:5174 (pid $DASH_PID)"

echo ""
echo "─────────────────────────────────────────────"
echo "All services running. To start the Discord bots:"
echo ""
echo "  Voice bot:   (already running in background)"
echo "  Text bot:    cd $ROOT/agent-bridge && python main.py"
echo ""
echo "Press Ctrl+C to stop all services."
echo "─────────────────────────────────────────────"

trap "kill $SMA_PID $FRONTEND_PID $API_PID $DASH_PID 2>/dev/null; docker compose -f $ROOT/docker/docker-compose.yml stop kafka kafka-ui" EXIT
wait
