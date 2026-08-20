/**
 * Domain types for auth-service.
 *
 * Deliberate scope note: staff roles are a fixed three-tier enum
 * (owner/admin/member) rather than a fully dynamic per-org roles collection.
 * This covers everything the plan actually needs ("authorized staff can add
 * other staff and assign them a role") without the extra CRUD surface a
 * dynamic roles system would add. If custom per-org role names are needed
 * later, `DashboardRole` is the one place that changes — `role` on `User`
 * would become a foreign key into a new `roles` collection instead of this
 * enum, and every `requireRole()` check keeps working unchanged since it
 * only ever compares against a role's *permission level*, not its name.
 *
 * This is intentionally a different concept from agent-bridge's
 * `RolePermission` (admin/write/read/none tiers assigned per Discord role,
 * per channel, governing what the AI agent may do). That system is
 * unchanged by this service — it governs bot behavior, not dashboard access.
 */

export type DashboardRole = 'owner' | 'admin' | 'member'

/** Permission ordering — owner > admin > member. Used by requireRole(). */
export const ROLE_RANK: Record<DashboardRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
}

export type UserStatus = 'pending_verification' | 'active' | 'disabled'

export interface Organization {
  id: string
  name: string
  slug: string
  createdAt: Date
  status: 'active' | 'suspended'
}

export interface User {
  id: string
  orgId: string
  email: string
  /** null for federated-identity users once SSO exists (not implemented yet) — see authProvider. */
  passwordHash: string | null
  /** Discriminator kept from day one so adding Google/GitHub login later is additive, not a migration. */
  authProvider: 'password'
  role: DashboardRole
  name: string
  status: UserStatus
  createdAt: Date
}

/** Single-use, expiring token for the org-registration email-verification flow. */
export interface EmailVerification {
  id: string
  userId: string
  tokenHash: string
  expiresAt: Date
  consumedAt: Date | null
  createdAt: Date
}

/** Single-use, expiring token for inviting a new staff member into an existing org. */
export interface Invite {
  id: string
  orgId: string
  email: string
  role: DashboardRole
  tokenHash: string
  invitedBy: string // userId
  expiresAt: Date
  consumedAt: Date | null
  createdAt: Date
}

export type AuditAction =
  | 'org.registered'
  | 'user.email_verified'
  | 'user.login'
  | 'user.logout'
  | 'staff.invited'
  | 'staff.invite_accepted'
  | 'staff.invite_revoked'
  | 'staff.role_changed'
  | 'staff.removed'

export interface AuditEntry {
  id: string
  orgId: string
  actorUserId: string | null
  action: AuditAction
  target: string | null
  metadata: Record<string, unknown>
  timestamp: Date
}
