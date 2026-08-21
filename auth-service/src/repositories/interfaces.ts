import type { AuditEntry, EmailVerification, Invite, Organization, ToolCategory, ToolConfig, ToolStatus, User } from '../domain/types.js'

/**
 * Repository interfaces, mirroring the abstraction pattern already used in
 * agent-bridge (`MemoryStore`) and scrum-master-ai (`IntegrationStore`) —
 * business logic in src/services/ is written against these interfaces only,
 * never against Mongoose directly. That's what lets tests run against
 * src/repositories/memory/* (fast, no DB needed) while production runs
 * against src/repositories/mongo/* with identical service-layer behavior.
 */

export interface OrgRepository {
  create(org: Omit<Organization, 'id' | 'createdAt'>): Promise<Organization>
  findById(id: string): Promise<Organization | null>
  findBySlug(slug: string): Promise<Organization | null>
}

export interface UserRepository {
  create(user: Omit<User, 'id' | 'createdAt'>): Promise<User>
  findById(id: string): Promise<User | null>
  findByEmail(email: string): Promise<User | null>
  findByOrg(orgId: string): Promise<User[]>
  update(id: string, patch: Partial<Pick<User, 'passwordHash' | 'role' | 'status' | 'name'>>): Promise<User | null>
  delete(id: string): Promise<void>
  countByOrgAndRole(orgId: string, role: User['role']): Promise<number>
}

export interface EmailVerificationRepository {
  create(v: Omit<EmailVerification, 'id' | 'createdAt' | 'consumedAt'>): Promise<EmailVerification>
  findByTokenHash(tokenHash: string): Promise<EmailVerification | null>
  findLatestPendingForUser(userId: string): Promise<EmailVerification | null>
  consume(id: string): Promise<void>
}

export interface InviteRepository {
  create(i: Omit<Invite, 'id' | 'createdAt' | 'consumedAt'>): Promise<Invite>
  findByTokenHash(tokenHash: string): Promise<Invite | null>
  findById(id: string): Promise<Invite | null>
  findPendingByOrg(orgId: string): Promise<Invite[]>
  consume(id: string): Promise<void>
  revoke(id: string): Promise<void>
}

export interface AuditRepository {
  append(e: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void>
  listByOrg(orgId: string, limit?: number): Promise<AuditEntry[]>
}

export interface ToolConfigRepository {
  upsert(orgId: string, category: ToolCategory, toolId: string, patch: { encryptedPayload: string; status: ToolStatus; configuredBy: string }): Promise<ToolConfig>
  findByOrgAndTool(orgId: string, toolId: string): Promise<ToolConfig | null>
  findAllByOrg(orgId: string): Promise<ToolConfig[]>
  findAllByTool(toolId: string): Promise<ToolConfig[]>
  delete(orgId: string, toolId: string): Promise<void>
}

export interface Repositories {
  orgs: OrgRepository
  users: UserRepository
  emailVerifications: EmailVerificationRepository
  invites: InviteRepository
  audit: AuditRepository
  toolConfigs: ToolConfigRepository
}
