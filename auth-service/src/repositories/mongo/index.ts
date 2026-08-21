import mongoosePkg, { type HydratedDocument } from 'mongoose'
const { Schema, model, models, connect } = mongoosePkg
import type { AuditEntry, DashboardRole, EmailVerification, Invite, Organization, ToolCategory, ToolConfig, ToolStatus, User } from '../../domain/types.js'
import type {
  AuditRepository, EmailVerificationRepository, InviteRepository, OrgRepository, Repositories, ToolConfigRepository, UserRepository,
} from '../interfaces.js'

// ── Schemas ──────────────────────────────────────────────────────────────

const OrgSchema = new Schema<Organization>({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true, index: true },
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
}, { timestamps: { createdAt: true, updatedAt: false } })
const OrgModel = models.Organization ?? model<Organization>('Organization', OrgSchema)

const UserSchema = new Schema<User>({
  orgId: { type: String, required: true, index: true },
  email: { type: String, required: true, unique: true, index: true, lowercase: true },
  passwordHash: { type: String, default: null },
  authProvider: { type: String, enum: ['password'], default: 'password' },
  role: { type: String, enum: ['owner', 'admin', 'member'], required: true },
  name: { type: String, required: true },
  status: { type: String, enum: ['pending_verification', 'active', 'disabled'], default: 'pending_verification' },
}, { timestamps: { createdAt: true, updatedAt: false } })
const UserModel = models.User ?? model<User>('User', UserSchema)

const EmailVerificationSchema = new Schema<EmailVerification>({
  userId: { type: String, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, index: true },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } })
const EmailVerificationModel = models.EmailVerification ?? model<EmailVerification>('EmailVerification', EmailVerificationSchema)

const InviteSchema = new Schema<Invite>({
  orgId: { type: String, required: true, index: true },
  email: { type: String, required: true, lowercase: true },
  role: { type: String, enum: ['owner', 'admin', 'member'], required: true },
  tokenHash: { type: String, required: true, unique: true, index: true },
  invitedBy: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } })
const InviteModel = models.Invite ?? model<Invite>('Invite', InviteSchema)

const AuditSchema = new Schema<AuditEntry>({
  orgId: { type: String, required: true, index: true },
  actorUserId: { type: String, default: null },
  action: { type: String, required: true },
  target: { type: String, default: null },
  metadata: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: { createdAt: 'timestamp', updatedAt: false } })
const AuditModel = models.AuditEntry ?? model<AuditEntry>('AuditEntry', AuditSchema)

const ToolConfigSchema = new Schema<ToolConfig>({
  orgId: { type: String, required: true, index: true },
  category: { type: String, enum: ['communication', 'project_management', 'meeting_provider'], required: true },
  toolId: { type: String, required: true },
  encryptedPayload: { type: String, required: true },
  status: { type: String, enum: ['connected', 'error', 'disconnected'], default: 'connected' },
  configuredBy: { type: String, required: true },
}, { timestamps: true })
ToolConfigSchema.index({ orgId: 1, toolId: 1 }, { unique: true })
const ToolConfigModel = models.ToolConfig ?? model<ToolConfig>('ToolConfig', ToolConfigSchema)

// ── Doc → domain-type mapping ───────────────────────────────────────────
// Mongoose documents carry `_id` (ObjectId) plus Mongoose-internal fields;
// domain types use a plain `id: string`. Centralizing the mapping here
// keeps every repository method's return type an honest `Organization`/
// `User`/etc, so service-layer code never has to know Mongoose exists.

function toOrg(d: HydratedDocument<Organization>): Organization {
  return { id: d.id, name: d.name, slug: d.slug, createdAt: (d as any).createdAt, status: d.status }
}
function toUser(d: HydratedDocument<User>): User {
  return {
    id: d.id, orgId: d.orgId, email: d.email, passwordHash: d.passwordHash,
    authProvider: d.authProvider, role: d.role, name: d.name, status: d.status,
    createdAt: (d as any).createdAt,
  }
}
function toVerification(d: HydratedDocument<EmailVerification>): EmailVerification {
  return {
    id: d.id, userId: d.userId, tokenHash: d.tokenHash, expiresAt: d.expiresAt,
    consumedAt: d.consumedAt, createdAt: (d as any).createdAt,
  }
}
function toInvite(d: HydratedDocument<Invite>): Invite {
  return {
    id: d.id, orgId: d.orgId, email: d.email, role: d.role, tokenHash: d.tokenHash,
    invitedBy: d.invitedBy, expiresAt: d.expiresAt, consumedAt: d.consumedAt, createdAt: (d as any).createdAt,
  }
}
function toAudit(d: HydratedDocument<AuditEntry>): AuditEntry {
  return {
    id: d.id, orgId: d.orgId, actorUserId: d.actorUserId, action: d.action as any,
    target: d.target, metadata: d.metadata, timestamp: (d as any).timestamp,
  }
}
function toToolConfig(d: HydratedDocument<ToolConfig>): ToolConfig {
  return {
    id: d.id, orgId: d.orgId, category: d.category, toolId: d.toolId,
    encryptedPayload: d.encryptedPayload, status: d.status, configuredBy: d.configuredBy,
    createdAt: (d as any).createdAt, updatedAt: (d as any).updatedAt,
  }
}

// ── Repositories ─────────────────────────────────────────────────────────

export class MongoOrgRepository implements OrgRepository {
  async create(org: Omit<Organization, 'id' | 'createdAt'>) { return toOrg(await OrgModel.create(org)) }
  async findById(id: string) {
    const d = await OrgModel.findById(id)
    return d ? toOrg(d) : null
  }
  async findBySlug(slug: string) {
    const d = await OrgModel.findOne({ slug })
    return d ? toOrg(d) : null
  }
}

export class MongoUserRepository implements UserRepository {
  async create(user: Omit<User, 'id' | 'createdAt'>) { return toUser(await UserModel.create(user)) }
  async findById(id: string) {
    const d = await UserModel.findById(id)
    return d ? toUser(d) : null
  }
  async findByEmail(email: string) {
    const d = await UserModel.findOne({ email: email.toLowerCase() })
    return d ? toUser(d) : null
  }
  async findByOrg(orgId: string) {
    return (await UserModel.find({ orgId })).map(toUser)
  }
  async update(id: string, patch: Partial<Pick<User, 'passwordHash' | 'role' | 'status' | 'name'>>) {
    const d = await UserModel.findByIdAndUpdate(id, patch, { new: true })
    return d ? toUser(d) : null
  }
  async delete(id: string) { await UserModel.findByIdAndDelete(id) }
  async countByOrgAndRole(orgId: string, role: DashboardRole) {
    return UserModel.countDocuments({ orgId, role, status: { $ne: 'disabled' } })
  }
}

export class MongoEmailVerificationRepository implements EmailVerificationRepository {
  async create(v: Omit<EmailVerification, 'id' | 'createdAt' | 'consumedAt'>) {
    return toVerification(await EmailVerificationModel.create(v))
  }
  async findByTokenHash(tokenHash: string) {
    const d = await EmailVerificationModel.findOne({ tokenHash, consumedAt: null })
    return d ? toVerification(d) : null
  }
  async findLatestPendingForUser(userId: string) {
    const d = await EmailVerificationModel.findOne({ userId, consumedAt: null }).sort({ createdAt: -1 })
    return d ? toVerification(d) : null
  }
  async consume(id: string) { await EmailVerificationModel.findByIdAndUpdate(id, { consumedAt: new Date() }) }
}

export class MongoInviteRepository implements InviteRepository {
  async create(i: Omit<Invite, 'id' | 'createdAt' | 'consumedAt'>) { return toInvite(await InviteModel.create(i)) }
  async findByTokenHash(tokenHash: string) {
    const d = await InviteModel.findOne({ tokenHash, consumedAt: null })
    return d ? toInvite(d) : null
  }
  async findById(id: string) {
    const d = await InviteModel.findById(id)
    return d ? toInvite(d) : null
  }
  async findPendingByOrg(orgId: string) {
    return (await InviteModel.find({ orgId, consumedAt: null })).map(toInvite)
  }
  async consume(id: string) { await InviteModel.findByIdAndUpdate(id, { consumedAt: new Date() }) }
  async revoke(id: string) { await InviteModel.findByIdAndDelete(id) }
}

export class MongoAuditRepository implements AuditRepository {
  async append(e: Omit<AuditEntry, 'id' | 'timestamp'>) { await AuditModel.create(e) }
  async listByOrg(orgId: string, limit = 100) {
    return (await AuditModel.find({ orgId }).sort({ timestamp: -1 }).limit(limit)).map(toAudit)
  }
}

export class MongoToolConfigRepository implements ToolConfigRepository {
  async upsert(orgId: string, category: ToolCategory, toolId: string, patch: { encryptedPayload: string; status: ToolStatus; configuredBy: string }) {
    const d = await ToolConfigModel.findOneAndUpdate(
      { orgId, toolId },
      { $set: { category, ...patch }, $setOnInsert: { orgId, toolId } },
      { new: true, upsert: true }
    )
    return toToolConfig(d!)
  }
  async findByOrgAndTool(orgId: string, toolId: string) {
    const d = await ToolConfigModel.findOne({ orgId, toolId })
    return d ? toToolConfig(d) : null
  }
  async findAllByOrg(orgId: string) {
    return (await ToolConfigModel.find({ orgId })).map(toToolConfig)
  }
  async findAllByTool(toolId: string) {
    return (await ToolConfigModel.find({ toolId })).map(toToolConfig)
  }
  async delete(orgId: string, toolId: string) {
    await ToolConfigModel.deleteOne({ orgId, toolId })
  }
}

export async function connectMongo(uri: string): Promise<void> {
  await connect(uri)
}

export function createMongoRepositories(): Repositories {
  return {
    orgs: new MongoOrgRepository(),
    users: new MongoUserRepository(),
    emailVerifications: new MongoEmailVerificationRepository(),
    invites: new MongoInviteRepository(),
    audit: new MongoAuditRepository(),
    toolConfigs: new MongoToolConfigRepository(),
  }
}
