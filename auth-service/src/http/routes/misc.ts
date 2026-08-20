import type { FastifyInstance } from 'fastify'
import { getJwks } from '../../crypto/jwt.js'
import type { Repositories } from '../../repositories/interfaces.js'
import { authenticate, requireOwnOrg, requireRole } from '../plugins/auth.js'

/** Public — this is how agent-bridge and scrum-master-ai verify access
 * tokens without any shared secret. Standard OIDC-style discovery path. */
export function registerJwksRoute(app: FastifyInstance) {
  app.get('/.well-known/jwks.json', async () => getJwks())
}

export function registerAuditRoutes(app: FastifyInstance, deps: { repos: Repositories }) {
  app.get('/orgs/:orgId/audit-log', {
    preHandler: [authenticate, requireOwnOrg, requireRole('admin')],
  }, async (request) => {
    const { orgId } = request.params as { orgId: string }
    return deps.repos.audit.listByOrg(orgId)
  })
}
