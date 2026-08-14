# Docker compose and local Kafka

This folder includes two compose files to help run both projects together, or just Kafka locally.

Files:
- `docker-compose.yml` — full stack: Zookeeper, Kafka, agent-bridge services, and the `scrum-master-backend` service (built from the sibling workspace).
- `docker-compose.kafka-only.yml` — starts only Zookeeper + Kafka for local development.

Quick start (full stack)

1. From this folder (`agent-bridge-new`) set required env variables (or create a `.env` here):

```
GEMINI_API_KEY=your_key_here
```

2. Build and start everything:

```bash
docker-compose up --build
```

This builds `scrum-master-backend` from `../../scrum-master/scrum-master-ai/backend` and the existing agent-bridge images.

Kafka-only (run Kafka locally, run services on host)

```bash
docker-compose -f docker-compose.kafka-only.yml up -d
```

Services on host should connect to Kafka at `localhost:9092` (or `kafka:9092` when running in compose network).

Notes:
- The `scrum-master` backend requires `GEMINI_API_KEY` to be set; provide it via `.env` or environment when running compose.
- If you prefer different Kafka images (e.g. Confluent), update `docker-compose.yml` accordingly.

Troubleshooting:
- To view logs: `docker-compose logs -f` (or include `-f` and service name)
- To rebuild a single service: `docker-compose build scrum-master-backend`
