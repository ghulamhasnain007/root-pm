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
})

export const env = EnvSchema.parse(process.env)
export type Env = typeof env
