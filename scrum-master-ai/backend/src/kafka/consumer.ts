/**
 * kafka/consumer.ts — Kafka consumer wrapper for scrum-master-ai.
 * Subscribes to config-events topic for tool configuration changes.
 */
import { Kafka, type Consumer } from 'kafkajs';

let consumer: Consumer | null = null;
let running = false;

export interface ConfigEvent {
  schemaVersion: string;
  eventType: 'tool-config.updated' | 'tool-config.removed';
  sourceSystem: string;
  publishedAt: number;
  orgId: string;
  toolId: string;
  status?: string;
}

type Handler = (event: ConfigEvent) => void | Promise<void>;

const handlers: Handler[] = [];

export function onConfigEvent(handler: Handler): void {
  handlers.push(handler);
}

export async function startConfigConsumer(brokers: string[], groupId: string = 'scrum-master-ai-config'): Promise<void> {
  if (running) return;

  const kafka = new Kafka({ brokers, clientId: 'scrum-master-ai' });
  consumer = kafka.consumer({ groupId });

  await consumer.connect();
  await consumer.subscribe({ topic: 'agent-bridge.config-events', fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }: { message: any }) => {
      if (!message.value) return;
      try {
        const event: ConfigEvent = JSON.parse(message.value.toString());
        for (const handler of handlers) {
          await handler(event);
        }
      } catch (err) {
        console.error('[Kafka] Failed to process config event:', err);
      }
    },
  });

  running = true;
}

export async function stopConfigConsumer(): Promise<void> {
  if (consumer && running) {
    await consumer.disconnect();
    running = false;
    consumer = null;
  }
}
