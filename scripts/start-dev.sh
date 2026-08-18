#!/bin/bash
# start-dev.sh — Start all services locally for development

set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "Starting development environment from $ROOT"

# ── 1. Kafka (Docker) ─────────────────────────────────────────────────────────
echo "[1/4] Starting Kafka..."
docker compose -f "$ROOT/docker/docker-compose.yml" up -d kafka kafka-init kafka-ui
echo "  Kafka UI → http://localhost:8080"

# ── 2. Voice bot backend ──────────────────────────────────────────────────────
echo "[2/4] Starting voice bot backend (scrum-master-ai)..."
cd "$ROOT/scrum-master-ai/backend"
npm install --silent
KAFKA_BROKERS=localhost:9093 npm run dev &
SMA_PID=$!
echo "  Voice backend → http://localhost:3001 (pid $SMA_PID)"

# ── 3. Agent Bridge config API ────────────────────────────────────────────────
echo "[3/4] Starting agent-bridge config API..."
cd "$ROOT/agent-bridge"
pip install -q -r requirements.txt
cd backend
uvicorn main:app --reload --port 8000 &
API_PID=$!
echo "  Config API → http://localhost:8000 (pid $API_PID)"

# ── 4. Unified client (config dashboard + voice bot console) ───────────────────
# Replaces the two previously-separate frontends — Vite's dev-server proxy
# (client/vite.config.ts) routes /api to :8000 and /integrations,/ws to :3001,
# so both backends above need to already be running before this starts.
echo "[4/4] Starting unified client..."
cd "$ROOT/client"
npm install --silent
npm run dev -- --port 5173 &
CLIENT_PID=$!
echo "  Client → http://localhost:5173 (pid $CLIENT_PID)"

echo ""
echo "─────────────────────────────────────────────"
echo "All services running. To start the Discord bots:"
echo ""
echo "  Voice bot:   (already running in background)"
echo "  Text bot:    cd $ROOT/agent-bridge && python main.py"
echo ""
echo "Press Ctrl+C to stop all services."
echo "─────────────────────────────────────────────"

trap "kill $SMA_PID $API_PID $CLIENT_PID 2>/dev/null; docker compose -f $ROOT/docker/docker-compose.yml stop kafka kafka-ui" EXIT
wait
