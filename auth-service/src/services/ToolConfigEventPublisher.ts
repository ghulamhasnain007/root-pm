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

  /**
   * Deliberately never throws — a Kafka outage at boot must not prevent
   * auth-service from starting. Org registration, staff management, and
   * tool credential storage (the actual source of truth, written to Mongo)
   * all work fine with no Kafka at all; event publishing exists purely to
   * let agent-bridge/scrum-master-ai invalidate their credential caches a
   * few seconds faster than they otherwise would (their caches already
   * expire on their own TTL — see AuthServiceClient's cache_ttl_seconds on
   * both sides). Losing that fast path on a Kafka hiccup is fine; crashing
   * the whole service over it is not, and would contradict every other
   * "degrade gracefully instead of hard-failing on missing infra" choice
   * already made throughout this codebase (Redis-less, Mongo-less, and
   * SMTP-less fallbacks all just warn and continue — Kafka is no different).
   */
  async connect(brokers: string[]): Promise<void> {
    try {
      const { connectProducer } = await import('../kafka/producer.js')
      await connectProducer(brokers)
      this.connected = true
      console.log(`[auth-service] Kafka event publisher connected (${brokers.join(',')})`)
    } catch (err: any) {
      console.warn(
        `[auth-service] Kafka connection failed (${err.message}) — tool config events will not be ` +
        'published. This is non-fatal: org/staff/tool operations are unaffected, other services will ' +
        'simply rely on their existing cache TTL instead of near-instant invalidation.'
      )
      this.connected = false
    }
  }

  /** Also never throws, for the same reason as connect() — a transient
   * publish failure after a previously-successful connect (broker
   * restart, network blip) must not fail the tool-config write that
   * already succeeded in Mongo by the time this runs (see
   * ToolConfigService.setTool/removeTool, which await this without their
   * own try/catch, relying on this contract). */
  async publish(event: ToolConfigEvent): Promise<void> {
    if (!this.connected) return
    try {
      const { publishToolConfigEvent } = await import('../kafka/producer.js')
      await publishToolConfigEvent({
        orgId: event.orgId,
        toolId: event.toolId,
        action: event.action,
      })
    } catch (err: any) {
      console.warn(`[auth-service] Failed to publish tool-config event for org ${event.orgId} (${err.message}) — non-fatal.`)
    }
  }
}
