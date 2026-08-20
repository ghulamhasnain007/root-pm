import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/http/server.js'
import { createMemoryRepositories } from '../src/repositories/memory/index.js'
import { InMemoryRefreshTokenStore } from '../src/services/InMemoryRefreshTokenStore.js'
import { ToolCredentialCipher } from '../src/crypto/ToolCredentialCipher.js'
import { NoopEventPublisher } from '../src/services/ToolConfigEventPublisher.js'
import type { EmailMessage, EmailSender } from '../src/email/EmailSender.js'
import { randomBytes } from 'node:crypto'

export class SpyEmailSender implements EmailSender {
  sent: EmailMessage[] = []
  async send(msg: EmailMessage): Promise<void> {
    this.sent.push(msg)
  }
  /** Pulls the token out of a link like ".../verify-email?token=XYZ" or
   * ".../accept-invite?token=XYZ" in the most recent matching email. */
  lastTokenFor(to: string): string {
    const msg = [...this.sent].reverse().find(m => m.to === to)
    if (!msg) throw new Error(`No email sent to ${to}`)
    const match = msg.text.match(/token=([^\s&]+)/)
    if (!match) throw new Error(`No token found in email to ${to}`)
    return match[1]
  }
}

export const TEST_INTERNAL_SERVICE_KEY = 'test-internal-key-do-not-use-in-prod'

export function buildTestApp(): { app: FastifyInstance; email: SpyEmailSender } {
  const email = new SpyEmailSender()
  const app = buildApp({
    repos: createMemoryRepositories(),
    refreshTokens: new InMemoryRefreshTokenStore(30 * 24 * 3600),
    email,
    cipher: new ToolCredentialCipher(randomBytes(32).toString('base64')),
    toolConfigEvents: new NoopEventPublisher(),
    internalServiceKey: TEST_INTERNAL_SERVICE_KEY,
    clientBaseUrl: 'http://localhost:5173',
    accessTokenTtlSeconds: 900,
    emailVerificationTtlHours: 24,
    inviteTtlDays: 7,
    corsOrigin: 'http://localhost:5173',
  })
  return { app, email }
}
