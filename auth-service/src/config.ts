import { z } from 'zod'
import 'dotenv/config'

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),

  // Storage backend: 'memory' (no external deps, non-durable — dev/test
  // only) or 'mongo' (production). Mirrors the same escape hatch
  // agent-bridge/scrum-master-ai already offer for their own stores.
  STORAGE: z.enum(['memory', 'mongo']).default('memory'),
  MONGO_URI: z.string().default('mongodb://localhost:27017/auth-service'),
  REDIS_URL: z.string().default('redis://localhost:6379/1'),
  SESSION_STORE: z.enum(['memory', 'redis']).default('memory'),

  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(15 * 60),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().default(30 * 24 * 3600),
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().default(24),
  INVITE_TTL_DAYS: z.coerce.number().default(7),

  // AES-256-GCM key (base64, 32 bytes) for encrypting org tool credentials
  // at rest. Generate with:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  // If unset, an ephemeral key is generated at boot — fine for dev/test,
  // NOT for production (every restart makes existing stored credentials
  // undecryptable, since the key that encrypted them is gone).
  TOOL_CREDENTIAL_ENCRYPTION_KEY: z.string().optional(),

  // Shared secret for service-to-service credential fetches (agent-bridge,
  // scrum-master-ai). If unset, an ephemeral one is generated at boot and
  // logged once — fine for a single-process dev setup where you can copy
  // it, NOT for production (other services need a stable, out-of-band
  // configured value).
  INTERNAL_SERVICE_KEY: z.string().optional(),

  // Org registration seeding for migrating an existing single-tenant
  // deployment (see src/migration/seedDefaultOrg.ts). Off by default.
  SEED_DEFAULT_ORG: z.coerce.boolean().default(false),
  SEED_ADMIN_EMAIL: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  SEED_ADMIN_NAME: z.string().default('Admin'),
  SEED_ORG_NAME: z.string().default('Default Organization'),
  // Legacy single-tenant env vars, read only by the seed script to
  // populate the seeded org's tool configs — same variable names
  // agent-bridge/scrum-master-ai already use.
  SEED_TAIGA_URL: z.string().optional(),
  SEED_TAIGA_USER: z.string().optional(),
  SEED_TAIGA_PASS: z.string().optional(),
  SEED_DISCORD_BOT_TOKEN: z.string().optional(),

  // RS256 key pair (PEM). If unset, an ephemeral pair is generated at boot
  // — fine for dev/test, NOT for production (see src/crypto/jwt.ts).
  AUTH_JWT_PRIVATE_KEY: z.string().optional(),
  AUTH_JWT_PUBLIC_KEY: z.string().optional(),

  // Base URL of the client app — used to build verification/invite links.
  CLIENT_BASE_URL: z.string().default('http://localhost:5173'),

  EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('Root-PM <no-reply@root-pm.local>'),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // Kafka — when set, tool-config events are published to agent-bridge.config-events
  KAFKA_BROKERS: z.string().optional(),
})

export const env = EnvSchema.parse(process.env)
export type Env = typeof env
