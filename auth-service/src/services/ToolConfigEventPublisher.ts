/**
 * Published whenever an org's tool credentials change, so agent-bridge and
 * scrum-master-ai can react to config changes in real-time via Kafka.
 *
 * KafkaEventPublisher publishes to the agent-bridge.config-events topic.
 * NoopEventPublisher is retained as a fallback when Kafka is not configured.
 */
export interface ToolConfigEvent {
  orgId: string
  toolId: string
  action: 'updated' | 'removed'
}

export interface ToolConfigEventPublisher {
  publish(event: ToolConfigEvent): Promise<void>
}

export class NoopEventPublisher implements ToolConfigEventPublisher {
  async publish(_event: ToolConfigEvent): Promise<void> {
    // intentionally a no-op — used when Kafka is not configured
  }
}

export class KafkaEventPublisher implements ToolConfigEventPublisher {
  private connected = false;

  async connect(brokers: string[]): Promise<void> {
    const { connectProducer } = await import('../kafka/producer.js')
    await connectProducer(brokers)
    this.connected = true
  }

  async publish(event: ToolConfigEvent): Promise<void> {
    if (!this.connected) return
    const { publishToolConfigEvent } = await import('../kafka/producer.js')
    await publishToolConfigEvent({
      orgId: event.orgId,
      toolId: event.toolId,
      action: event.action,
    })
  }
}
