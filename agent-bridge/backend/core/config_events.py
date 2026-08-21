"""
core/config_events.py — Kafka consumer for tool-config events from auth-service.
Extends BridgeConsumer to also subscribe to config-events topic.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from typing import Callable, Any

from kafka import KafkaConsumer
from kafka.errors import KafkaConnectionError, KafkaError

logger = logging.getLogger("agent_bridge.config_events")

CONFIG_TOPIC = "agent-bridge.config-events"


class ConfigEventConsumer:
    """
    Long-running Kafka consumer that dispatches tool-config events.
    Runs in a daemon thread alongside the existing BridgeConsumer.
    """

    def __init__(
        self,
        brokers: list[str],
        group_id: str = "agent-bridge-config-consumer",
        auto_offset_reset: str = "latest",
        sasl_username: str | None = None,
        sasl_password: str | None = None,
        ssl: bool = False,
    ):
        self._brokers = brokers
        self._group_id = group_id
        self._auto_offset_reset = auto_offset_reset
        self._sasl_username = sasl_username
        self._sasl_password = sasl_password
        self._ssl = ssl
        self._handlers: dict[str, list[Callable[[dict], None]]] = {}
        self._running = False
        self._thread: threading.Thread | None = None

    def on(self, event_type: str, handler: Callable[[dict], None]) -> None:
        self._handlers.setdefault(event_type, []).append(handler)

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._consume_loop, daemon=True, name="config-event-consumer")
        self._thread.start()
        logger.info("Config event consumer started (brokers=%s group=%s)", self._brokers, self._group_id)

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=5)

    def _build_consumer(self) -> KafkaConsumer:
        kwargs: dict[str, Any] = dict(
            bootstrap_servers=self._brokers,
            group_id=self._group_id,
            auto_offset_reset=self._auto_offset_reset,
            enable_auto_commit=True,
            auto_commit_interval_ms=1000,
            value_deserializer=lambda v: json.loads(v.decode("utf-8")),
            consumer_timeout_ms=1000,
            reconnect_backoff_ms=500,
            reconnect_backoff_max_ms=10_000,
        )
        if self._ssl:
            kwargs["security_protocol"] = "SASL_SSL" if self._sasl_username else "SSL"
        if self._sasl_username:
            kwargs["sasl_mechanism"] = "PLAIN"
            kwargs["sasl_plain_username"] = self._sasl_username
            kwargs["sasl_plain_password"] = self._sasl_password
            if not self._ssl:
                kwargs["security_protocol"] = "SASL_PLAINTEXT"
        return KafkaConsumer(CONFIG_TOPIC, **kwargs)

    def _consume_loop(self) -> None:
        consumer: KafkaConsumer | None = None
        while self._running:
            try:
                if consumer is None:
                    consumer = self._build_consumer()
                    logger.info("Config event consumer connected, subscribed to %s", CONFIG_TOPIC)

                for msg in consumer:
                    if not self._running:
                        break
                    try:
                        self._dispatch(msg.value)
                    except Exception as e:
                        logger.error("Handler error on config event %s: %s",
                                     msg.value.get("eventType"), e, exc_info=True)

            except StopIteration:
                pass
            except (KafkaConnectionError, KafkaError) as e:
                logger.warning("Kafka error: %s — reconnecting in 10s", e)
                time.sleep(10)
                consumer = None
            except Exception as e:
                logger.error("Consumer loop error: %s — restarting in 5s", e, exc_info=True)
                time.sleep(5)
                consumer = None

        if consumer:
            consumer.close()
        logger.info("Config event consumer stopped")

    def _dispatch(self, event: dict) -> None:
        event_type = event.get("eventType")
        if not event_type:
            logger.warning("Event missing eventType: %s", event)
            return
        for handler in self._handlers.get(event_type, []):
            try:
                handler(event)
            except Exception as e:
                logger.error("Handler %s failed for %s: %s", handler.__name__, event_type, e)


def build_config_consumer_from_env() -> ConfigEventConsumer | None:
    brokers_raw = os.environ.get("KAFKA_BROKERS", "")
    if not brokers_raw:
        logger.warning("KAFKA_BROKERS not set — config event consumer disabled")
        return None
    brokers = [b.strip() for b in brokers_raw.split(",") if b.strip()]
    return ConfigEventConsumer(
        brokers=brokers,
        group_id=os.environ.get("KAFKA_CONFIG_GROUP_ID", "agent-bridge-config-consumer"),
        auto_offset_reset=os.environ.get("KAFKA_AUTO_OFFSET_RESET", "latest"),
        sasl_username=os.environ.get("KAFKA_SASL_USERNAME"),
        sasl_password=os.environ.get("KAFKA_SASL_PASSWORD"),
        ssl=os.environ.get("KAFKA_SSL", "false").lower() == "true",
    )
