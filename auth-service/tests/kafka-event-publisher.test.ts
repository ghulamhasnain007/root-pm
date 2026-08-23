import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock the underlying producer module so these tests never attempt a real
// Kafka connection — only KafkaEventPublisher's own error-handling contract
// (never throw) is under test here.
vi.mock('../src/kafka/producer.js', () => ({
  connectProducer: vi.fn(),
  publishToolConfigEvent: vi.fn(),
}))

describe('KafkaEventPublisher', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('connect() does not throw when the broker is unreachable — a Kafka outage must not crash auth-service startup', async () => {
    const producerModule = await import('../src/kafka/producer.js')
    vi.mocked(producerModule.connectProducer).mockRejectedValue(new Error('ECONNREFUSED'))

    const { KafkaEventPublisher } = await import('../src/services/ToolConfigEventPublisher.js')
    const publisher = new KafkaEventPublisher()

    await expect(publisher.connect(['kafka:9092'])).resolves.toBeUndefined()
  })

  it('publish() is a silent no-op after a failed connect (never attempts to send)', async () => {
    const producerModule = await import('../src/kafka/producer.js')
    vi.mocked(producerModule.connectProducer).mockRejectedValue(new Error('ECONNREFUSED'))

    const { KafkaEventPublisher } = await import('../src/services/ToolConfigEventPublisher.js')
    const publisher = new KafkaEventPublisher()
    await publisher.connect(['kafka:9092'])

    await expect(publisher.publish({ orgId: 'org1', toolId: 'discord', action: 'updated' })).resolves.toBeUndefined()
    expect(producerModule.publishToolConfigEvent).not.toHaveBeenCalled()
  })

  it('publish() does not throw even after a successful connect, if the send itself fails — a transient broker blip must not fail a tool-config save that already succeeded in Mongo', async () => {
    const producerModule = await import('../src/kafka/producer.js')
    vi.mocked(producerModule.connectProducer).mockResolvedValue(undefined)
    vi.mocked(producerModule.publishToolConfigEvent).mockRejectedValue(new Error('broker restarted'))

    const { KafkaEventPublisher } = await import('../src/services/ToolConfigEventPublisher.js')
    const publisher = new KafkaEventPublisher()
    await publisher.connect(['kafka:9092'])

    await expect(publisher.publish({ orgId: 'org1', toolId: 'discord', action: 'updated' })).resolves.toBeUndefined()
  })

  it('publish() actually sends when connected and healthy', async () => {
    const producerModule = await import('../src/kafka/producer.js')
    vi.mocked(producerModule.connectProducer).mockResolvedValue(undefined)
    vi.mocked(producerModule.publishToolConfigEvent).mockResolvedValue(undefined)

    const { KafkaEventPublisher } = await import('../src/services/ToolConfigEventPublisher.js')
    const publisher = new KafkaEventPublisher()
    await publisher.connect(['kafka:9092'])
    await publisher.publish({ orgId: 'org1', toolId: 'discord', action: 'updated' })

    expect(producerModule.publishToolConfigEvent).toHaveBeenCalledWith({
      orgId: 'org1', toolId: 'discord', action: 'updated',
    })
  })
})
