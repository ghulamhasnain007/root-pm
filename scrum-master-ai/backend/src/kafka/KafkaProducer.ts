/**
 * kafka/KafkaProducer.ts
 * ──────────────────────
 * Thin wrapper around kafkajs. Manages one persistent connection.
 * Uses the org+channel as the Kafka message key for partition locality —
 * all events for the same channel always land on the same partition,
 * preserving strict ordering without requiring a global transaction.
 */
import { Kafka, Producer, CompressionTypes, logLevel } from 'kafkajs';
import type { AnyBridgeEvent } from './events.js';

export interface KafkaProducerConfig {
  brokers: string[];          // e.g. ['localhost:9092']
  clientId: string;
  ssl?: boolean;
  sasl?: { mechanism: 'plain'; username: string; password: string };
}

export class KafkaBridgeProducer {
  private kafka: Kafka;
  private producer: Producer;
  private connected = false;

  constructor(cfg: KafkaProducerConfig) {
    this.kafka = new Kafka({
      clientId: cfg.clientId,
      brokers: cfg.brokers,
      ssl: cfg.ssl,
      sasl: cfg.sasl,
      logLevel: logLevel.WARN,
      retry: { retries: 5, initialRetryTime: 300 },
    });
    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30_000,
    });
  }

  async connect(): Promise<void> {
    await this.producer.connect();
    this.connected = true;
    console.log('[KafkaProducer] connected');
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.producer.disconnect();
      this.connected = false;
    }
  }

  /**
   * Publish a bridge event to the correct topic.
   * Key = orgId:channelId  →  same channel always hits same partition.
   */
  async publish(topic: string, event: AnyBridgeEvent, partitionKey: string): Promise<void> {
    if (!this.connected) {
      console.warn('[KafkaProducer] not connected — attempting reconnect');
      await this.connect();
    }
    await this.producer.send({
      topic,
      compression: CompressionTypes.GZIP,
      messages: [{
        key:   partitionKey,
        value: JSON.stringify(event),
        headers: {
          eventType:     event.eventType,
          schemaVersion: event.schemaVersion,
          sourceSystem:  event.sourceSystem,
          publishedAt:   String(event.publishedAt),
        },
      }],
    });
  }

  /** Publish multiple events atomically (same partition key = same topic). */
  async publishBatch(topic: string, events: AnyBridgeEvent[], partitionKey: string): Promise<void> {
    if (!this.connected) await this.connect();
    await this.producer.send({
      topic,
      compression: CompressionTypes.GZIP,
      messages: events.map(event => ({
        key:   partitionKey,
        value: JSON.stringify(event),
        headers: {
          eventType:     event.eventType,
          schemaVersion: event.schemaVersion,
          sourceSystem:  event.sourceSystem,
          publishedAt:   String(event.publishedAt),
        },
      })),
    });
  }

  get isConnected(): boolean { return this.connected; }
}
