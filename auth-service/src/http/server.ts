import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import type { Repositories } from '../repositories/interfaces.js'
import type { IRefreshTokenStore } from '../services/RefreshTokenStore.js'
import type { EmailSender } from '../email/EmailSender.js'
import type { ToolCredentialCipher } from '../crypto/ToolCredentialCipher.js'
import type { ToolConfigEventPublisher } from '../services/ToolConfigEventPublisher.js'
import { OrgService } from '../services/OrgService.js'
import { AuthService } from '../services/AuthService.js'
import { StaffService } from '../services/StaffService.js'
import { ToolConfigService } from '../services/ToolConfigService.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerStaffRoutes } from './routes/staff.js'
import { registerJwksRoute, registerAuditRoutes } from './routes/misc.js'
import { registerToolRoutes } from './routes/tools.js'
import { AppError } from '../errors.js'

export interface BuildAppOptions {
  repos: Repositories
  refreshTokens: IRefreshTokenStore
  email: EmailSender
  cipher: ToolCredentialCipher
  toolConfigEvents: ToolConfigEventPublisher
  internalServiceKey: string
  clientBaseUrl: string
  accessTokenTtlSeconds: number
  emailVerificationTtlHours: number
  inviteTtlDays: number
  corsOrigin: string
}

export function buildApp(opts: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' })

  app.register(cors, { origin: opts.corsOrigin, credentials: true })

  const orgService = new OrgService(opts.repos, opts.email, opts.clientBaseUrl, opts.emailVerificationTtlHours)
  const authService = new AuthService(opts.repos, opts.refreshTokens, opts.accessTokenTtlSeconds)
  const staffService = new StaffService(opts.repos, opts.refreshTokens, opts.email, opts.clientBaseUrl, opts.inviteTtlDays)
  const toolConfigService = new ToolConfigService(opts.repos, opts.cipher, opts.toolConfigEvents)

  registerJwksRoute(app)
  registerAuthRoutes(app, { orgService, authService })
  registerStaffRoutes(app, { staffService, repos: opts.repos })
  registerAuditRoutes(app, { repos: opts.repos })
  registerToolRoutes(app, { toolConfigService, internalServiceKey: opts.internalServiceKey })

  app.get('/health', async () => ({ status: 'ok' }))

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ code: error.code, message: error.message, details: error.details })
    }
    // zod validation errors
    if ((error as any).issues) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', message: 'Invalid request', details: (error as any).issues })
    }
    app.log.error(error)
    return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Something went wrong' })
  })

  return app
}
