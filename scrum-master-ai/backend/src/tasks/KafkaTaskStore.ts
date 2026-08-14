/**
 * tasks/KafkaTaskStore.ts
 * ───────────────────────
 * Drop-in replacement for MongoTaskStore that:
 *   1. Still writes to MongoDB (audit trail, voice-bot list/get still work)
 *   2. Also publishes Kafka events so agent-bridge can mirror to Taiga
 *
 * Usage — swap one line in setupAmbient.ts:
 *   Before:  const taskStore = new MongoTaskStore();
 *   After:   const taskStore = new KafkaTaskStore(producer, orgId);
 *
 * The MongoTaskStore is composed (not extended) so MongoDB behavior is
 * unchanged. Kafka publish is fire-and-forget with error logging — a Kafka
 * failure never breaks the voice bot's task response.
 */
import { MongoTaskStore } from '../services/tasks/MongoTaskStore.js';
import type { TaskStore, Task, TaskInput } from '../services/tasks/TaskStore.js';
import type { KafkaBridgeProducer } from '../kafka/KafkaProducer.js';
import { TOPICS, SCHEMA_VERSION } from '../kafka/events.js';
import type { TaskCreatedEvent, TaskClosedEvent } from '../kafka/events.js';

export class KafkaTaskStore implements TaskStore {
  private mongo: MongoTaskStore;

  constructor(
    private readonly producer: KafkaBridgeProducer,
    private readonly orgId: string,
    /** Optional: track which meeting is active so events carry meetingId */
    private readonly getMeetingId: () => string | undefined = () => undefined,
  ) {
    this.mongo = new MongoTaskStore();
  }

  async create(orgId: string, input: TaskInput): Promise<Task> {
    // 1. Write to MongoDB first — source of truth
    const task = await this.mongo.create(orgId, input);

    // 2. Publish Kafka event (non-blocking — never throws to caller)
    const event: TaskCreatedEvent = {
      schemaVersion: SCHEMA_VERSION,
      eventType:     'task.created',
      sourceSystem:  'scrum-master-ai',
      publishedAt:   Date.now(),
      taskId:        task.id,
      orgId:         task.orgId,
      title:         task.title,
      description:   task.description,
      assignee:      task.assignee,
      createdBy:     task.createdBy,
      sourceChannelId: task.sourceChannelId,
      meetingId:     this.getMeetingId(),
    };
    this.safePublish(TOPICS.TASK_EVENTS, event, `${orgId}:${task.sourceChannelId}`);

    return task;
  }

  async close(orgId: string, taskIdOrTitle: string): Promise<Task | null> {
    const task = await this.mongo.close(orgId, taskIdOrTitle);
    if (!task) return null;

    const event: TaskClosedEvent = {
      schemaVersion: SCHEMA_VERSION,
      eventType:     'task.closed',
      sourceSystem:  'scrum-master-ai',
      publishedAt:   Date.now(),
      taskId:        task.id,
      orgId:         task.orgId,
      title:         task.title,
      closedBy:      'voice-bot',       // voice bot has no caller context here
      closedAt:      task.closedAt ?? Date.now(),
      sourceChannelId: task.sourceChannelId,
      meetingId:     this.getMeetingId(),
    };
    this.safePublish(TOPICS.TASK_EVENTS, event, `${orgId}:${task.sourceChannelId}`);

    return task;
  }

  // list/get — pure read, no Kafka event needed
  async list(orgId: string, status?: 'open' | 'closed'): Promise<Task[]> {
    return this.mongo.list(orgId, status);
  }

  async get(orgId: string, id: string): Promise<Task | null> {
    return this.mongo.get(orgId, id);
  }

  private safePublish(topic: string, event: TaskCreatedEvent | TaskClosedEvent, key: string): void {
    this.producer.publish(topic, event, key).catch(err => {
      console.error('[KafkaTaskStore] Failed to publish event', event.eventType, err?.message);
    });
  }
}
