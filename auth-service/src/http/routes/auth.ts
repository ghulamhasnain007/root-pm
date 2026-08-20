import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { OrgService } from '../../services/OrgService.js'
import type { AuthService } from '../../services/AuthService.js'
import { authenticate } from '../plugins/auth.js'
import { Errors } from '../../errors.js'

const RegisterSchema = z.object({
  orgName: z.string().min(2).max(100),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(10).max(200),
  ownerName: z.string().min(1).max(100),
})

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const RefreshSchema = z.object({ refreshToken: z.string().min(1) })
const VerifyEmailSchema = z.object({ token: z.string().min(1) })
const ResendVerificationSchema = z.object({ email: z.string().email() })

export function registerAuthRoutes(app: FastifyInstance, deps: { orgService: OrgService; authService: AuthService }) {
  const { orgService, authService } = deps

  app.post('/orgs/register', async (request, reply) => {
    const body = RegisterSchema.parse(request.body)
    const { org, user } = await orgService.register(body)
    reply.code(201)
    return {
      org: { id: org.id, name: org.name, slug: org.slug },
      user: { id: user.id, email: user.email, status: user.status },
      message: 'Check your email to verify your account before logging in.',
    }
  })

  app.get('/auth/verify-email', async (request) => {
    const { token } = VerifyEmailSchema.parse(request.query)
    await orgService.verifyEmail(token)
    return { verified: true }
  })

  app.post('/auth/resend-verification', async (request) => {
    const { email } = ResendVerificationSchema.parse(request.body)
    await orgService.resendVerification(email)
    // Always 200, regardless of whether the email matched anything — see
    // OrgService.resendVerification's comment on enumeration.
    return { message: 'If that email has a pending account, a new verification link has been sent.' }
  })

  app.post('/auth/login', async (request) => {
    const { email, password } = LoginSchema.parse(request.body)
    const result = await authService.login(email, password)
    return result
  })

  app.post('/auth/refresh', async (request) => {
    const { refreshToken } = RefreshSchema.parse(request.body)
    return authService.refresh(refreshToken)
  })

  app.post('/auth/logout', { preHandler: authenticate }, async (request) => {
    const { refreshToken } = RefreshSchema.parse(request.body)
    if (!request.auth) throw Errors.unauthorized()
    await authService.logout(refreshToken, request.auth.userId, request.auth.orgId)
    return { loggedOut: true }
  })

  app.get('/auth/me', { preHandler: authenticate }, async (request) => {
    return request.auth
  })
}
