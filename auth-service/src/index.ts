import { randomBytes } from 'node:crypto'
import { env } from './config.js'
import { initKeys } from './crypto/jwt.js'
import { ToolCredentialCipher } from './crypto/ToolCredentialCipher.js'
import { NoopEventPublisher, KafkaEventPublisher } from './services/ToolConfigEventPublisher.js'
import type { ToolConfigEventPublisher } from './services/ToolConfigEventPublisher.js'
import { buildApp } from './http/server.js'
import { createMemoryRepositories } from './repositories/memory/index.js'
import { connectMongo, createMongoRepositories } from './repositories/mongo/index.js'
import { connectRedis } from './db/redis.js'
import { RefreshTokenStore, type IRefreshTokenStore } from './services/RefreshTokenStore.js'
import { InMemoryRefreshTokenStore } from './services/InMemoryRefreshTokenStore.js'
import { ConsoleEmailSender } from './email/EmailSender.js'
import { SmtpEmailSender } from './email/SmtpEmailSender.js'
import type { EmailSender } from './email/EmailSender.js'
import type { Repositories } from './repositories/interfaces.js'
import { seedDefaultOrg } from './migration/seedDefaultOrg.js'

async function main() {
  await initKeys({ privateKeyPem: env.AUTH_JWT_PRIVATE_KEY, publicKeyPem: env.AUTH_JWT_PUBLIC_KEY })
  if (!env.AUTH_JWT_PRIVATE_KEY) {
    console.warn(
      '[auth-service] AUTH_JWT_PRIVATE_KEY/PUBLIC_KEY not set — using an ephemeral key pair. ' +
      'All active sessions will be invalidated on every restart. Set persistent keys before production use.'
    )
  }

  let repos: Repositories
  if (env.STORAGE === 'mongo') {
    await connectMongo(env.MONGO_URI)
    repos = createMongoRepositories()
    console.log(`[auth-service] Connected to MongoDB (${env.MONGO_URI})`)
  } else {
    repos = createMemoryRepositories()
    console.warn('[auth-service] STORAGE=memory — data is NOT persisted across restarts. Set STORAGE=mongo for production.')
  }

  let refreshTokens: IRefreshTokenStore
  if (env.SESSION_STORE === 'redis') {
    const redis = connectRedis(env.REDIS_URL)
    refreshTokens = new RefreshTokenStore(redis, env.REFRESH_TOKEN_TTL_SECONDS)
    console.log(`[auth-service] Connected to Redis (${env.REDIS_URL})`)
  } else {
    refreshTokens = new InMemoryRefreshTokenStore(env.REFRESH_TOKEN_TTL_SECONDS)
    console.warn('[auth-service] SESSION_STORE=memory — sessions are NOT shared across instances. Set SESSION_STORE=redis for production.')
  }

  let email: EmailSender
  if (env.EMAIL_PROVIDER === 'smtp') {
    if (!env.SMTP_HOST) throw new Error('EMAIL_PROVIDER=smtp requires SMTP_HOST to be set')
    email = new SmtpEmailSender({
      host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE,
      user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.EMAIL_FROM,
    })
  } else {
    email = new ConsoleEmailSender()
    console.warn('[auth-service] EMAIL_PROVIDER=console — verification/invite emails are logged, not sent. Set EMAIL_PROVIDER=smtp for production.')
  }

  const cipherKey = env.TOOL_CREDENTIAL_ENCRYPTION_KEY ?? randomBytes(32).toString('base64')
  if (!env.TOOL_CREDENTIAL_ENCRYPTION_KEY) {
    console.warn(
      '[auth-service] TOOL_CREDENTIAL_ENCRYPTION_KEY not set — using an ephemeral key. ' +
      'Every restart makes previously-stored tool credentials undecryptable. Set a persistent key before production use.'
    )
  }
  const cipher = new ToolCredentialCipher(cipherKey)

  const internalServiceKey = env.INTERNAL_SERVICE_KEY ?? randomBytes(32).toString('base64url')
  if (!env.INTERNAL_SERVICE_KEY) {
    console.warn(
      `[auth-service] INTERNAL_SERVICE_KEY not set — generated an ephemeral one for this run: ${internalServiceKey}\n` +
      '  Other services (agent-bridge, scrum-master-ai) need this exact value to fetch tool ' +
      'credentials. Set INTERNAL_SERVICE_KEY explicitly and share it with those services before production use.'
    )
  }

  if (env.SEED_DEFAULT_ORG) {
    await seedDefaultOrg(repos, cipher, env)
  }

  // Wire tool config event publisher — Kafka when brokers are available, noop otherwise
  let toolConfigEvents: ToolConfigEventPublisher
  const kafkaBrokers = env.KAFKA_BROKERS
  if (kafkaBrokers) {
    const publisher = new KafkaEventPublisher()
    await publisher.connect(kafkaBrokers.split(',').map(b => b.trim()))
    toolConfigEvents = publisher
    // No success/failure log here — connect() logs its own outcome (it
    // never throws, by design, so this call site can't tell success from
    // failure just from whether the await resolved).
  } else {
    toolConfigEvents = new NoopEventPublisher()
    console.warn('[auth-service] KAFKA_BROKERS not set — tool config events will NOT be published')
  }

  const app = buildApp({
    repos,
    refreshTokens,
    email,
    cipher,
    toolConfigEvents,
    internalServiceKey,
    clientBaseUrl: env.CLIENT_BASE_URL,
    accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
    emailVerificationTtlHours: env.EMAIL_VERIFICATION_TTL_HOURS,
    inviteTtlDays: env.INVITE_TTL_DAYS,
    corsOrigin: env.CORS_ORIGIN,
  })

  await app.listen({ port: env.PORT, host: env.HOST })
}

main().catch((err) => {
  console.error('[auth-service] Fatal startup error:', err)
  process.exit(1)
})
