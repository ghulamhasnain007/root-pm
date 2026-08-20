import { hashPassword } from '../crypto/password.js'
import type { ToolCredentialCipher } from '../crypto/ToolCredentialCipher.js'
import type { Repositories } from '../repositories/interfaces.js'
import { slugify } from '../services/OrgService.js'
import type { Env } from '../config.js'

/**
 * Migration path for an existing single-tenant deployment (see the
 * multi-tenancy plan, Phase 2 migration step): seeds exactly one org from
 * SEED_ORG_NAME (default "Default Organization"), with an Owner account
 * from SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD, and — if the legacy
 * single-tenant env vars are present — pre-populates that org's tool
 * configs from them, so agent-bridge/scrum-master-ai keep working
 * unchanged once they're switched over to fetching credentials from this
 * service instead of their own local env/JSON config (Phases 3–4).
 *
 * Idempotent: safe to run (or leave SEED_DEFAULT_ORG=true) on every boot —
 * if an org with the seeded slug already exists, this is a no-op.
 *
 * Deliberately bypasses OrgService.register()'s pending_verification +
 * email flow: this is an operator running a migration, not a public
 * self-serve signup, so making them click an email link to themselves
 * would be pure friction with no security benefit.
 */
export async function seedDefaultOrg(repos: Repositories, cipher: ToolCredentialCipher, env: Env): Promise<void> {
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    console.warn('[auth-service] SEED_DEFAULT_ORG=true but SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD are unset — skipping seed.')
    return
  }

  const slug = slugify(env.SEED_ORG_NAME)
  const existing = await repos.orgs.findBySlug(slug)
  if (existing) {
    console.log(`[auth-service] Seed org "${slug}" already exists — skipping seed (idempotent).`)
    return
  }

  const org = await repos.orgs.create({ name: env.SEED_ORG_NAME, status: 'active', slug })

  const passwordHash = await hashPassword(env.SEED_ADMIN_PASSWORD)
  const owner = await repos.users.create({
    orgId: org.id,
    email: env.SEED_ADMIN_EMAIL.toLowerCase(),
    passwordHash,
    authProvider: 'password',
    role: 'owner',
    name: env.SEED_ADMIN_NAME,
    status: 'active', // no verification step for a migration-seeded account
  })

  await repos.audit.append({
    orgId: org.id, actorUserId: null, action: 'org.registered', target: org.id,
    metadata: { seeded: true, slug },
  })

  let seededTools = 0
  if (env.SEED_TAIGA_URL && env.SEED_TAIGA_USER && env.SEED_TAIGA_PASS) {
    const payload = { url: env.SEED_TAIGA_URL, username: env.SEED_TAIGA_USER, password: env.SEED_TAIGA_PASS }
    await repos.toolConfigs.upsert(org.id, 'project_management', 'taiga', {
      encryptedPayload: cipher.encrypt(JSON.stringify(payload)), status: 'connected', configuredBy: owner.id,
    })
    seededTools += 1
  }
  if (env.SEED_DISCORD_BOT_TOKEN) {
    await repos.toolConfigs.upsert(org.id, 'communication', 'discord', {
      encryptedPayload: cipher.encrypt(JSON.stringify({ botToken: env.SEED_DISCORD_BOT_TOKEN })),
      status: 'connected', configuredBy: owner.id,
    })
    seededTools += 1
  }

  console.log(`[auth-service] Seeded org "${org.name}" (${org.id}) with Owner ${owner.email} and ${seededTools} tool config(s).`)
}
