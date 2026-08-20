import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { initKeys } from '../src/crypto/jwt.js'
import { ToolCredentialCipher } from '../src/crypto/ToolCredentialCipher.js'
import { createMemoryRepositories } from '../src/repositories/memory/index.js'
import { seedDefaultOrg } from '../src/migration/seedDefaultOrg.js'
import { verifyPassword } from '../src/crypto/password.js'
import type { Env } from '../src/config.js'

beforeAll(async () => {
  await initKeys({})
})

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    SEED_ADMIN_EMAIL: 'seed-admin@migrated.test',
    SEED_ADMIN_PASSWORD: 'correct-horse-battery',
    SEED_ADMIN_NAME: 'Seed Admin',
    SEED_ORG_NAME: 'Migrated Co',
    ...overrides,
  } as Env
}

describe('seedDefaultOrg (migration script)', () => {
  it('creates an active (unverified-skip) org + owner from env vars', async () => {
    const repos = createMemoryRepositories()
    const cipher = new ToolCredentialCipher(randomBytes(32).toString('base64'))

    await seedDefaultOrg(repos, cipher, baseEnv())

    const org = await repos.orgs.findBySlug('migrated-co')
    expect(org).toBeTruthy()
    const owner = await repos.users.findByEmail('seed-admin@migrated.test')
    expect(owner?.status).toBe('active') // no verification gate for migration seeding
    expect(owner?.role).toBe('owner')
    expect(await verifyPassword('correct-horse-battery', owner!.passwordHash!)).toBe(true)
  })

  it('seeds Taiga and Discord tool configs when legacy env vars are present', async () => {
    const repos = createMemoryRepositories()
    const cipher = new ToolCredentialCipher(randomBytes(32).toString('base64'))

    await seedDefaultOrg(repos, cipher, baseEnv({
      SEED_TAIGA_URL: 'https://taiga.example', SEED_TAIGA_USER: 'bot', SEED_TAIGA_PASS: 'secret',
      SEED_DISCORD_BOT_TOKEN: 'legacy-bot-token',
    }))

    const org = await repos.orgs.findBySlug('migrated-co')
    const tools = await repos.toolConfigs.findAllByOrg(org!.id)
    expect(tools.map(t => t.toolId).sort()).toEqual(['discord', 'taiga'])

    const taiga = tools.find(t => t.toolId === 'taiga')!
    const decrypted = JSON.parse(cipher.decrypt(taiga.encryptedPayload))
    expect(decrypted).toEqual({ url: 'https://taiga.example', username: 'bot', password: 'secret' })
  })

  it('skips tool seeding when legacy env vars are absent', async () => {
    const repos = createMemoryRepositories()
    const cipher = new ToolCredentialCipher(randomBytes(32).toString('base64'))

    await seedDefaultOrg(repos, cipher, baseEnv())

    const org = await repos.orgs.findBySlug('migrated-co')
    const tools = await repos.toolConfigs.findAllByOrg(org!.id)
    expect(tools).toHaveLength(0)
  })

  it('is idempotent — running twice does not create a second org', async () => {
    const repos = createMemoryRepositories()
    const cipher = new ToolCredentialCipher(randomBytes(32).toString('base64'))

    await seedDefaultOrg(repos, cipher, baseEnv())
    await seedDefaultOrg(repos, cipher, baseEnv())

    const staff = await repos.users.findByOrg((await repos.orgs.findBySlug('migrated-co'))!.id)
    expect(staff).toHaveLength(1)
  })

  it('skips entirely (no throw) if admin credentials are not provided', async () => {
    const repos = createMemoryRepositories()
    const cipher = new ToolCredentialCipher(randomBytes(32).toString('base64'))

    await seedDefaultOrg(repos, cipher, baseEnv({ SEED_ADMIN_EMAIL: undefined, SEED_ADMIN_PASSWORD: undefined }))

    const org = await repos.orgs.findBySlug('migrated-co')
    expect(org).toBeNull()
  })
})
