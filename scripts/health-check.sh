#!/bin/bash
# health-check.sh — Check all services are responding
check() { curl -sf "$1" > /dev/null && echo "  ✓ $2" || echo "  ✗ $2 (not responding)"; }
echo "Service health:"
check "http://localhost:3001/health"  "Voice bot backend  (localhost:3001)"
check "http://localhost:8000/api/health" "Config API         (localhost:8000)"
check "http://localhost:8080"         "Kafka UI           (localhost:8080)"
