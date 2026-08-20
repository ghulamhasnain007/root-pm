import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { StaffService } from '../../services/StaffService.js'
import type { Repositories } from '../../repositories/interfaces.js'
import { authenticate, requireOwnOrg, requireRole } from '../plugins/auth.js'
import { Errors } from '../../errors.js'

const InviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'admin', 'member']),
})

const AcceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(10).max(200),
  name: z.string().min(1).max(100),
})

const ChangeRoleSchema = z.object({ role: z.enum(['owner', 'admin', 'member']) })

function publicUser(u: { id: string; email: string; name: string; role: string; status: string }) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, status: u.status }
}

export function registerStaffRoutes(app: FastifyInstance, deps: { staffService: StaffService; repos: Repositories }) {
  const { staffService, repos } = deps

  app.get('/orgs/:orgId/staff', {
    preHandler: [authenticate, requireOwnOrg],
  }, async (request) => {
    const { orgId } = request.params as { orgId: string }
    const staff = await staffService.listStaff(orgId)
    return staff.map(publicUser)
  })

  app.post('/orgs/:orgId/staff/invite', {
    preHandler: [authenticate, requireOwnOrg, requireRole('admin')],
  }, async (request, reply) => {
    const { orgId } = request.params as { orgId: string }
    const body = InviteSchema.parse(request.body)
    if (!request.auth) throw Errors.unauthorized()

    // Only an Owner can invite someone in as another Owner — an Admin
    // shouldn't be able to mint peers with higher standing than themselves.
    if (body.role === 'owner' && request.auth.role !== 'owner') throw Errors.forbidden('Only an Owner can invite another Owner')

    const org = await repos.orgs.findById(orgId)
    if (!org) throw Errors.notFound('Organization')
    const inviter = await repos.users.findById(request.auth.userId)
    if (!inviter) throw Errors.unauthorized()

    const invite = await staffService.invite({
      orgId, email: body.email, role: body.role,
      invitedById: inviter.id, invitedByName: inviter.name, orgName: org.name,
    })
    reply.code(201)
    return { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt }
  })

  app.get('/orgs/:orgId/invites', {
    preHandler: [authenticate, requireOwnOrg, requireRole('admin')],
  }, async (request) => {
    const { orgId } = request.params as { orgId: string }
    const invites = await staffService.listPendingInvites(orgId)
    return invites.map(i => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt, invitedBy: i.invitedBy }))
  })

  app.delete('/orgs/:orgId/invites/:inviteId', {
    preHandler: [authenticate, requireOwnOrg, requireRole('admin')],
  }, async (request, reply) => {
    const { orgId, inviteId } = request.params as { orgId: string; inviteId: string }
    if (!request.auth) throw Errors.unauthorized()
    await staffService.revokeInvite(orgId, inviteId, request.auth.userId)
    reply.code(204)
    return null
  })

  // Public — the invite token itself is the credential, no session required.
  app.post('/auth/accept-invite', async (request, reply) => {
    const body = AcceptInviteSchema.parse(request.body)
    const user = await staffService.acceptInvite(body)
    reply.code(201)
    return publicUser(user)
  })

  app.patch('/orgs/:orgId/staff/:userId', {
    preHandler: [authenticate, requireOwnOrg, requireRole('admin')],
  }, async (request) => {
    const { orgId, userId } = request.params as { orgId: string; userId: string }
    const body = ChangeRoleSchema.parse(request.body)
    if (!request.auth) throw Errors.unauthorized()

    if (body.role === 'owner' && request.auth.role !== 'owner') throw Errors.forbidden('Only an Owner can promote someone to Owner')

    const updated = await staffService.changeRole(orgId, userId, body.role, request.auth.userId)
    return publicUser(updated)
  })

  app.delete('/orgs/:orgId/staff/:userId', {
    preHandler: [authenticate, requireOwnOrg, requireRole('admin')],
  }, async (request, reply) => {
    const { orgId, userId } = request.params as { orgId: string; userId: string }
    if (!request.auth) throw Errors.unauthorized()
    if (userId === request.auth.userId) throw Errors.forbidden('Cannot remove your own account here — use another Owner/Admin')

    await staffService.remove(orgId, userId, request.auth.userId)
    reply.code(204)
    return null
  })
}
