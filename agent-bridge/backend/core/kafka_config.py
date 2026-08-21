"""
core/kafka_config.py — Kafka topic constants and configuration for agent-bridge.
"""
from __future__ import annotations

import os

TOPICS = {
    "TASK_EVENTS":    "agent-bridge.task-events",
    "MEETING_EVENTS": "agent-bridge.meeting-events",
    "CONFIG_EVENTS":  "agent-bridge.config-events",
}

KAFKA_BROKERS = [b.strip() for b in os.environ.get("KAFKA_BROKERS", "localhost:9092").split(",") if b.strip()]
KAFKA_GROUP_ID = os.environ.get("KAFKA_GROUP_ID", "agent-bridge-consumer")
KAFKA_AUTO_OFFSET_RESET = os.environ.get("KAFKA_AUTO_OFFSET_RESET", "latest")
KAFKA_SASL_USERNAME = os.environ.get("KAFKA_SASL_USERNAME")
KAFKA_SASL_PASSWORD = os.environ.get("KAFKA_SASL_PASSWORD")
KAFKA_SSL = os.environ.get("KAFKA_SSL", "false").lower() == "true"
