import type { FastifyReply, FastifyRequest } from 'fastify'
import { verifyAccessToken } from '../../crypto/jwt.js'
import { Errors } from '../../errors.js'
import { ROLE_RANK, type DashboardRole } from '../../domain/types.js'

export interface AuthContext {
  userId: string
  orgId: string
  role: DashboardRole
  email: string
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext
  }
}

/** preHandler: verifies the Bearer JWT and attaches `request.auth`. Every
 * route that isn't public (register/login/refresh/verify-email/accept-invite/
 * jwks) should use this. */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) throw Errors.unauthorized()

  try {
    const payload = await verifyAccessToken(header.slice('Bearer '.length))
    request.auth = { userId: payload.sub, orgId: payload.orgId, role: payload.role as DashboardRole, email: payload.email }
  } catch {
    throw Errors.unauthorized()
  }
}

/** preHandler factory: requires `authenticate` to have already run, and that
 * the caller's role meets or exceeds `minRole` (owner > admin > member). */
export function requireRole(minRole: DashboardRole) {
  return async function (request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (!request.auth) throw Errors.unauthorized()
    if (ROLE_RANK[request.auth.role] < ROLE_RANK[minRole]) throw Errors.forbidden()
  }
}

/** A route param like `/orgs/:orgId/staff` must match the caller's own org —
 * dashboard roles never grant cross-org access, regardless of rank. */
export async function requireOwnOrg(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.auth) throw Errors.unauthorized()
  const { orgId } = request.params as { orgId: string }
  if (request.auth.orgId !== orgId) throw Errors.forbidden('Cannot access another organization')
}
