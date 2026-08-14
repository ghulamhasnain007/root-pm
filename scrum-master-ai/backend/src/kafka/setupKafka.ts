/**
 * kafka/setupKafka.ts
 * ───────────────────
 * Reads Kafka config from environment, creates a singleton producer.
 * Called once from setupAmbient.ts before mounting the ambient assistant.
 */
import { KafkaBridgeProducer, type KafkaProducerConfig } from './KafkaProducer.js';

let _producer: KafkaBridgeProducer | null = null;

export function getKafkaConfig(): KafkaProducerConfig | null {
  const brokers = process.env.KAFKA_BROKERS;
  if (!brokers) {
    console.warn('[Kafka] KAFKA_BROKERS not set — Kafka publishing disabled. Tasks will only save to MongoDB.');
    return null;
  }
  const cfg: KafkaProducerConfig = {
    brokers:  brokers.split(',').map(b => b.trim()),
    clientId: process.env.KAFKA_CLIENT_ID ?? 'scrum-master-ai',
    ssl:      process.env.KAFKA_SSL === 'true',
  };
  const user = process.env.KAFKA_SASL_USERNAME;
  const pass = process.env.KAFKA_SASL_PASSWORD;
  if (user && pass) {
    cfg.sasl = { mechanism: 'plain', username: user, password: pass };
  }
  return cfg;
}

/**
 * Returns a connected producer, or null if Kafka is not configured.
 * Safe to call multiple times — returns the same instance.
 */
export async function getOrCreateProducer(): Promise<KafkaBridgeProducer | null> {
  if (_producer) return _producer;
  const cfg = getKafkaConfig();
  if (!cfg) return null;
  _producer = new KafkaBridgeProducer(cfg);
  await _producer.connect();
  return _producer;
}

export async function disconnectProducer(): Promise<void> {
  await _producer?.disconnect();
  _producer = null;
}
