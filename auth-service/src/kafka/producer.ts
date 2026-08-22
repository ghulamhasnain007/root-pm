/**
 * kafka/producer.ts — Kafka producer wrapper for auth-service.
 * Publishes tool-config events when org credentials change.
 */
import { Kafka, type Producer } from 'kafkajs';

let producer: Producer | null = null;
let connected = false;

export async function connectProducer(brokers: string[]): Promise<void> {
  if (connected) return;
  const kafka = new Kafka({ brokers, clientId: 'auth-service' });
  producer = kafka.producer();
  await producer.connect();
  connected = true;
}

export async function publishToolConfigEvent(event: {
  orgId: string; toolId: string; action: 'updated' | 'removed';
  status?: string;
}): Promise<void> {
  if (!producer || !connected) {
    throw new Error('Kafka producer not connected');
  }

  const eventType = event.action === 'updated' ? 'tool-config.updated' : 'tool-config.removed';
  const payload: Record<string, unknown> = {
    schemaVersion: '1.0',
    eventType,
    sourceSystem: 'auth-service',
    publishedAt: Date.now(),
    orgId: event.orgId,
    toolId: event.toolId,
  };
  if (event.status) {
    payload.status = event.status;
  }

  await producer.send({
    topic: 'agent-bridge.config-events',
    messages: [{ key: event.orgId, value: JSON.stringify(payload) }],
  });
}

export async function disconnectProducer(): Promise<void> {
  if (producer && connected) {
    await producer.disconnect();
    connected = false;
    producer = null;
  }
}
