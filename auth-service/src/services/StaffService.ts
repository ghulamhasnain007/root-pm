import type { Repositories } from '../repositories/interfaces.js'
import type { EmailSender } from '../email/EmailSender.js'
import { inviteEmail } from '../email/templates.js'
import { hashPassword } from '../crypto/password.js'
import { generateSecureToken, hashToken } from '../crypto/secureToken.js'
import type { IRefreshTokenStore } from './RefreshTokenStore.js'
import { Errors } from '../errors.js'
import type { DashboardRole, Invite, User } from '../domain/types.js'

export class StaffService {
  constructor(
    private repos: Repositories,
    private refreshTokens: IRefreshTokenStore,
    private email: EmailSender,
    private clientBaseUrl: string,
    private inviteTtlDays: number
  ) {}

  /** orgId/inviterName/inviterId come from the authenticated session at the
   * route layer, never from the request body — a caller can only ever
   * invite people into their own org. */
  async invite(opts: { orgId: string; email: string; role: DashboardRole; invitedById: string; invitedByName: string; orgName: string }): Promise<Invite> {
    const email = opts.email.toLowerCase().trim()

    const existingUser = await this.repos.users.findByEmail(email)
    if (existingUser) throw Errors.emailAlreadyRegistered()

    const { plaintext, hash } = generateSecureToken()
    const expiresAt = new Date(Date.now() + this.inviteTtlDays * 86_400_000)

    const invite = await this.repos.invites.create({
      orgId: opts.orgId, email, role: opts.role, tokenHash: hash, invitedBy: opts.invitedById, expiresAt,
    })

    const acceptUrl = `${this.clientBaseUrl}/accept-invite?token=${plaintext}`
    await this.email.send(inviteEmail({ to: email, orgName: opts.orgName, inviterName: opts.invitedByName, role: opts.role, acceptUrl }))

    await this.repos.audit.append({
      orgId: opts.orgId, actorUserId: opts.invitedById, action: 'staff.invited', target: email, metadata: { role: opts.role },
    })

    return invite
  }

  async listPendingInvites(orgId: string): Promise<Invite[]> {
    return this.repos.invites.findPendingByOrg(orgId)
  }

  async revokeInvite(orgId: string, inviteId: string, actorUserId: string): Promise<void> {
    const invite = await this.repos.invites.findById(inviteId)
    if (!invite || invite.orgId !== orgId) throw Errors.notFound('Invite')
    await this.repos.invites.revoke(inviteId)
    await this.repos.audit.append({ orgId, actorUserId, action: 'staff.invite_revoked', target: invite.email, metadata: {} })
  }

  /** Invited staff skip email verification entirely — clicking the emailed
   * invite link (which only the invitee received) IS the verification. */
  async acceptInvite(opts: { token: string; password: string; name: string }): Promise<User> {
    const hash = hashToken(opts.token)
    const invite = await this.repos.invites.findByTokenHash(hash)
    if (!invite || invite.expiresAt < new Date()) throw Errors.invalidOrExpiredToken('invite')

    const existingUser = await this.repos.users.findByEmail(invite.email)
    if (existingUser) throw Errors.emailAlreadyRegistered()

    const passwordHash = await hashPassword(opts.password)
    const user = await this.repos.users.create({
      orgId: invite.orgId,
      email: invite.email,
      passwordHash,
      authProvider: 'password',
      role: invite.role,
      name: opts.name,
      status: 'active',
    })

    await this.repos.invites.consume(invite.id)
    await this.repos.audit.append({ orgId: invite.orgId, actorUserId: user.id, action: 'staff.invite_accepted', target: user.id, metadata: { role: invite.role } })

    return user
  }

  async listStaff(orgId: string): Promise<User[]> {
    return this.repos.users.findByOrg(orgId)
  }

  async changeRole(orgId: string, targetUserId: string, newRole: DashboardRole, actorUserId: string): Promise<User> {
    const target = await this.repos.users.findById(targetUserId)
    if (!target || target.orgId !== orgId) throw Errors.notFound('Staff member')

    if (target.role === 'owner' && newRole !== 'owner') {
      const ownerCount = await this.repos.users.countByOrgAndRole(orgId, 'owner')
      if (ownerCount <= 1) throw Errors.lastOwner()
    }

    const updated = await this.repos.users.update(targetUserId, { role: newRole })
    if (!updated) throw Errors.notFound('Staff member')

    await this.repos.audit.append({
      orgId, actorUserId, action: 'staff.role_changed', target: targetUserId, metadata: { from: target.role, to: newRole },
    })
    // Role changed — force re-auth with a fresh token reflecting the new
    // role rather than letting a stale access token (up to 15 min) keep
    // granting the old permission level.
    await this.refreshTokens.revokeAllForUser(targetUserId)

    return updated
  }

  async remove(orgId: string, targetUserId: string, actorUserId: string): Promise<void> {
    const target = await this.repos.users.findById(targetUserId)
    if (!target || target.orgId !== orgId) throw Errors.notFound('Staff member')

    if (target.role === 'owner') {
      const ownerCount = await this.repos.users.countByOrgAndRole(orgId, 'owner')
      if (ownerCount <= 1) throw Errors.lastOwner()
    }

    await this.repos.users.update(targetUserId, { status: 'disabled' })
    await this.refreshTokens.revokeAllForUser(targetUserId)

    await this.repos.audit.append({ orgId, actorUserId, action: 'staff.removed', target: targetUserId, metadata: {} })
  }
}
