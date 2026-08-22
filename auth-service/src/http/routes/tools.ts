import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { ToolConfigService } from '../../services/ToolConfigService.js'
import { authenticate, requireOwnOrg, requireRole } from '../plugins/auth.js'
import { requireInternalKey } from '../plugins/internalAuth.js'

const SetToolSchema = z.object({
  category: z.enum(['communication', 'project_management', 'meeting_provider']),
  credentials: z.record(z.string()),
})

export function registerToolRoutes(app: FastifyInstance, deps: { toolConfigService: ToolConfigService; internalServiceKey: string }) {
  const { toolConfigService, internalServiceKey } = deps

  // ── Dashboard-facing: metadata only, never secrets ──────────────────────
  app.get('/orgs/:orgId/tools', {
    preHandler: [authenticate, requireOwnOrg],
  }, async (request) => {
    const { orgId } = request.params as { orgId: string }
    return toolConfigService.listTools(orgId)
  })

  app.put('/orgs/:orgId/tools/:toolId', {
    preHandler: [authenticate, requireOwnOrg, requireRole('admin')],
  }, async (request) => {
    const { orgId, toolId } = request.params as { orgId: string; toolId: string }
    const body = SetToolSchema.parse(request.body)
    return toolConfigService.setTool({
      orgId, toolId, category: body.category, credentials: body.credentials,
      configuredBy: request.auth!.userId,
    })
  })

  app.delete('/orgs/:orgId/tools/:toolId', {
    preHandler: [authenticate, requireOwnOrg, requireRole('admin')],
  }, async (request, reply) => {
    const { orgId, toolId } = request.params as { orgId: string; toolId: string }
    await toolConfigService.removeTool(orgId, toolId, request.auth!.userId)
    reply.code(204)
    return null
  })

  // ── Internal service-to-service only: decrypted credentials ─────────────
  // Called by agent-bridge/scrum-master-ai, never by the dashboard client.
  app.get('/internal/orgs/:orgId/tools/:toolId/credentials', {
    preHandler: requireInternalKey(internalServiceKey),
  }, async (request, reply) => {
    const { orgId, toolId } = request.params as { orgId: string; toolId: string }
    const credentials = await toolConfigService.getDecryptedCredentials(orgId, toolId)
    if (!credentials) {
      reply.code(404)
      return { code: 'NOT_FOUND', message: 'No credentials configured for this tool' }
    }
    return { credentials }
  })

  // ── Internal: list orgs that have a given tool configured ───────────────
  // Used by bot managers at startup to discover which orgs to connect.
  // Returns 200 + [] when nothing is configured, not 404 — this is a list
  // endpoint, and "no results" isn't an error condition, consistent with
  // every other list endpoint in this service (GET /orgs/:orgId/tools,
  // GET /orgs/:orgId/invites, etc. all return an empty array, not a 404).
  app.get('/internal/tools/:toolId/orgs', {
    preHandler: requireInternalKey(internalServiceKey),
  }, async (request) => {
    const { toolId } = request.params as { toolId: string }
    const orgs = await toolConfigService.listOrgsForTool(toolId)
    return { orgs }
  })
}
