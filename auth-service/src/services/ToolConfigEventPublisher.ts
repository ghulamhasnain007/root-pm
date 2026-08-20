/**
 * Published whenever an org's tool credentials change, so agent-bridge and
 * scrum-master-ai can invalidate their short-TTL credential caches within
 * seconds instead of waiting for the cache to naturally expire or the
 * process to restart.
 *
 * NOT wired to real Kafka yet — that lands with Phase 4 (agent-bridge
 * consumer) since there's no consumer to test against until then, and
 * standing up a Kafka producer with nothing reading from it isn't
 * verifiable. `NoopEventPublisher` is what's actually used for now; this
 * interface is the seam so ToolConfigService doesn't change when the real
 * publisher is added later.
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
    // intentionally a no-op — see file header
  }
}
