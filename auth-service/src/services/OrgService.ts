import type { Repositories } from '../repositories/interfaces.js'
import type { EmailSender } from '../email/EmailSender.js'
import { verificationEmail } from '../email/templates.js'
import { hashPassword } from '../crypto/password.js'
import { generateSecureToken, hashToken } from '../crypto/secureToken.js'
import { Errors } from '../errors.js'
import type { Organization, User } from '../domain/types.js'

export function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'org'
}

export class OrgService {
  constructor(
    private repos: Repositories,
    private email: EmailSender,
    private clientBaseUrl: string,
    private verificationTtlHours: number
  ) {}

  /**
   * The ONLY self-serve entry point in the whole system — creates a brand
   * new org and its first (Owner) user in one step. Every other account is
   * created exclusively via StaffService.acceptInvite(), which requires an
   * existing Owner/Admin to have sent an invite first. There is no
   * "request to join an existing org" flow anywhere.
   */
  async register(input: { orgName: string; ownerEmail: string; ownerPassword: string; ownerName: string }): Promise<{ org: Organization; user: User }> {
    const email = input.ownerEmail.toLowerCase().trim()

    const existing = await this.repos.users.findByEmail(email)
    if (existing) throw Errors.emailAlreadyRegistered()

    let slug = slugify(input.orgName)
    let attempt = 0
    while (await this.repos.orgs.findBySlug(slug)) {
      attempt += 1
      slug = `${slugify(input.orgName)}-${attempt}`
      if (attempt > 20) throw Errors.orgSlugTaken()
    }

    const org = await this.repos.orgs.create({ name: input.orgName, slug, status: 'active' })

    const passwordHash = await hashPassword(input.ownerPassword)
    const user = await this.repos.users.create({
      orgId: org.id,
      email,
      passwordHash,
      authProvider: 'password',
      role: 'owner',
      name: input.ownerName,
      status: 'pending_verification',
    })

    await this.repos.audit.append({ orgId: org.id, actorUserId: user.id, action: 'org.registered', target: org.id, metadata: { slug } })

    await this.sendVerificationEmail(user, org)

    return { org, user }
  }

  async sendVerificationEmail(user: User, org: Organization): Promise<void> {
    const { plaintext, hash } = generateSecureToken()
    const expiresAt = new Date(Date.now() + this.verificationTtlHours * 3600_000)
    await this.repos.emailVerifications.create({ userId: user.id, tokenHash: hash, expiresAt })

    const verifyUrl = `${this.clientBaseUrl}/verify-email?token=${plaintext}`
    await this.email.send(verificationEmail({ to: user.email, orgName: org.name, verifyUrl }))
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.repos.users.findByEmail(email.toLowerCase().trim())
    // Deliberately silent on "user not found" / "already verified" — this
    // endpoint must not leak which emails have accounts (a classic
    // enumeration vector on any "resend" or "forgot password" flow).
    if (!user || user.status !== 'pending_verification') return
    const org = await this.repos.orgs.findById(user.orgId)
    if (!org) return
    await this.sendVerificationEmail(user, org)
  }

  async verifyEmail(plaintextToken: string): Promise<void> {
    const hash = hashToken(plaintextToken)
    const record = await this.repos.emailVerifications.findByTokenHash(hash)
    if (!record || record.expiresAt < new Date()) throw Errors.invalidOrExpiredToken('verification')

    await this.repos.emailVerifications.consume(record.id)
    const user = await this.repos.users.findById(record.userId)
    if (!user) throw Errors.notFound('User')

    await this.repos.users.update(user.id, { status: 'active' })
    await this.repos.audit.append({ orgId: user.orgId, actorUserId: user.id, action: 'user.email_verified', target: user.id, metadata: {} })
  }
}
