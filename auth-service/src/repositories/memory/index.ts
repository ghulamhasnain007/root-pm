import { randomUUID } from 'node:crypto'
import type { AuditEntry, EmailVerification, Invite, Organization, ToolCategory, ToolConfig, ToolStatus, User } from '../../domain/types.js'
import type {
  AuditRepository, EmailVerificationRepository, InviteRepository, OrgRepository, Repositories, ToolConfigRepository, UserRepository,
} from '../interfaces.js'

export class MemoryOrgRepository implements OrgRepository {
  private byId = new Map<string, Organization>()

  async create(org: Omit<Organization, 'id' | 'createdAt'>): Promise<Organization> {
    const full: Organization = { ...org, id: randomUUID(), createdAt: new Date() }
    this.byId.set(full.id, full)
    return full
  }
  async findById(id: string) { return this.byId.get(id) ?? null }
  async findBySlug(slug: string) {
    return [...this.byId.values()].find(o => o.slug === slug) ?? null
  }
}

export class MemoryUserRepository implements UserRepository {
  private byId = new Map<string, User>()

  async create(user: Omit<User, 'id' | 'createdAt'>): Promise<User> {
    const full: User = { ...user, id: randomUUID(), createdAt: new Date() }
    this.byId.set(full.id, full)
    return full
  }
  async findById(id: string) { return this.byId.get(id) ?? null }
  async findByEmail(email: string) {
    return [...this.byId.values()].find(u => u.email === email.toLowerCase()) ?? null
  }
  async findByOrg(orgId: string) {
    return [...this.byId.values()].filter(u => u.orgId === orgId)
  }
  async update(id: string, patch: Partial<Pick<User, 'passwordHash' | 'role' | 'status' | 'name'>>) {
    const existing = this.byId.get(id)
    if (!existing) return null
    const updated = { ...existing, ...patch }
    this.byId.set(id, updated)
    return updated
  }
  async delete(id: string) { this.byId.delete(id) }
  async countByOrgAndRole(orgId: string, role: User['role']) {
    return [...this.byId.values()].filter(u => u.orgId === orgId && u.role === role && u.status !== 'disabled').length
  }
}

export class MemoryEmailVerificationRepository implements EmailVerificationRepository {
  private byId = new Map<string, EmailVerification>()

  async create(v: Omit<EmailVerification, 'id' | 'createdAt' | 'consumedAt'>) {
    const full: EmailVerification = { ...v, id: randomUUID(), createdAt: new Date(), consumedAt: null }
    this.byId.set(full.id, full)
    return full
  }
  async findByTokenHash(tokenHash: string) {
    return [...this.byId.values()].find(v => v.tokenHash === tokenHash && !v.consumedAt) ?? null
  }
  async findLatestPendingForUser(userId: string) {
    const pending = [...this.byId.values()]
      .filter(v => v.userId === userId && !v.consumedAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return pending[0] ?? null
  }
  async consume(id: string) {
    const v = this.byId.get(id)
    if (v) v.consumedAt = new Date()
  }
}

export class MemoryInviteRepository implements InviteRepository {
  private byId = new Map<string, Invite>()

  async create(i: Omit<Invite, 'id' | 'createdAt' | 'consumedAt'>) {
    const full: Invite = { ...i, id: randomUUID(), createdAt: new Date(), consumedAt: null }
    this.byId.set(full.id, full)
    return full
  }
  async findByTokenHash(tokenHash: string) {
    return [...this.byId.values()].find(i => i.tokenHash === tokenHash && !i.consumedAt) ?? null
  }
  async findById(id: string) { return this.byId.get(id) ?? null }
  async findPendingByOrg(orgId: string) {
    return [...this.byId.values()].filter(i => i.orgId === orgId && !i.consumedAt)
  }
  async consume(id: string) {
    const i = this.byId.get(id)
    if (i) i.consumedAt = new Date()
  }
  async revoke(id: string) { this.byId.delete(id) }
}

export class MemoryAuditRepository implements AuditRepository {
  private entries: AuditEntry[] = []

  async append(e: Omit<AuditEntry, 'id' | 'timestamp'>) {
    this.entries.push({ ...e, id: randomUUID(), timestamp: new Date() })
  }
  async listByOrg(orgId: string, limit = 100) {
    return this.entries
      .filter(e => e.orgId === orgId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit)
  }
}

export class MemoryToolConfigRepository implements ToolConfigRepository {
  private byKey = new Map<string, ToolConfig>() // key: `${orgId}:${toolId}`
  private key(orgId: string, toolId: string) { return `${orgId}:${toolId}` }

  async upsert(orgId: string, category: ToolCategory, toolId: string, patch: { encryptedPayload: string; status: ToolStatus; configuredBy: string }) {
    const k = this.key(orgId, toolId)
    const existing = this.byKey.get(k)
    const now = new Date()
    const full: ToolConfig = {
      id: existing?.id ?? randomUUID(),
      orgId, category, toolId,
      encryptedPayload: patch.encryptedPayload,
      status: patch.status,
      configuredBy: patch.configuredBy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    this.byKey.set(k, full)
    return full
  }
  async findByOrgAndTool(orgId: string, toolId: string) {
    return this.byKey.get(this.key(orgId, toolId)) ?? null
  }
  async findAllByOrg(orgId: string) {
    return [...this.byKey.values()].filter(t => t.orgId === orgId)
  }
  async findAllByTool(toolId: string) {
    return [...this.byKey.values()].filter(t => t.toolId === toolId)
  }
  async delete(orgId: string, toolId: string) {
    this.byKey.delete(this.key(orgId, toolId))
  }
}

export function createMemoryRepositories(): Repositories {
  return {
    orgs: new MemoryOrgRepository(),
    users: new MemoryUserRepository(),
    emailVerifications: new MemoryEmailVerificationRepository(),
    invites: new MemoryInviteRepository(),
    audit: new MemoryAuditRepository(),
    toolConfigs: new MemoryToolConfigRepository(),
  }
}
