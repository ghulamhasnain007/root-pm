#!/bin/bash
# create-kafka-topics.sh — Create Kafka topics manually if kafka-init didn't run
docker exec project-kafka kafka-topics \
  --bootstrap-server localhost:9092 \
  --create --if-not-exists \
  --topic agent-bridge.task-events \
  --partitions 4 --replication-factor 1

docker exec project-kafka kafka-topics \
  --bootstrap-server localhost:9092 \
  --create --if-not-exists \
  --topic agent-bridge.meeting-events \
  --partitions 4 --replication-factor 1

docker exec project-kafka kafka-topics \
  --bootstrap-server localhost:9092 \
  --create --if-not-exists \
  --topic agent-bridge.config-events \
  --partitions 4 --replication-factor 1

echo "Topics:"
docker exec project-kafka kafka-topics --bootstrap-server localhost:9092 --list
