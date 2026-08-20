import { beforeAll, describe, expect, it } from 'vitest'
import { initKeys } from '../src/crypto/jwt.js'
import { buildTestApp, TEST_INTERNAL_SERVICE_KEY } from './harness.js'

beforeAll(async () => {
  await initKeys({})
})

async function setupVerifiedOrg(app: ReturnType<typeof buildTestApp>['app'], email: ReturnType<typeof buildTestApp>['email'], orgName: string, ownerEmail: string) {
  const register = await app.inject({
    method: 'POST', url: '/orgs/register',
    payload: { orgName, ownerEmail, ownerPassword: 'correct-horse-battery', ownerName: 'Owner' },
  })
  const orgId = register.json().org.id
  await app.inject({ method: 'GET', url: `/auth/verify-email?token=${email.lastTokenFor(ownerEmail)}` })
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: ownerEmail, password: 'correct-horse-battery' } })
  return { orgId, ownerToken: login.json().accessToken as string, ownerId: login.json().user.id as string }
}

describe('tool configuration', () => {
  it('an org can configure a Discord bot token and a Taiga account independently — different orgs, different tools', async () => {
    const { app, email } = buildTestApp()
    const orgA = await setupVerifiedOrg(app, email, 'Org With Discord', 'a@tools.test')
    const orgB = await setupVerifiedOrg(app, email, 'Org With Taiga Only', 'b@tools.test')

    const setDiscord = await app.inject({
      method: 'PUT', url: `/orgs/${orgA.orgId}/tools/discord`,
      headers: { authorization: `Bearer ${orgA.ownerToken}` },
      payload: { category: 'communication', credentials: { botToken: 'org-a-discord-token', applicationId: '12345' } },
    })
    expect(setDiscord.statusCode).toBe(200)
    expect(setDiscord.json().status).toBe('connected')

    const setTaiga = await app.inject({
      method: 'PUT', url: `/orgs/${orgB.orgId}/tools/taiga`,
      headers: { authorization: `Bearer ${orgB.ownerToken}` },
      payload: { category: 'project_management', credentials: { url: 'https://taiga.example', username: 'bot', password: 'secret' } },
    })
    expect(setTaiga.statusCode).toBe(200)

    // Org A only sees its own Discord config, not Org B's Taiga config.
    const listA = await app.inject({ method: 'GET', url: `/orgs/${orgA.orgId}/tools`, headers: { authorization: `Bearer ${orgA.ownerToken}` } })
    expect(listA.json()).toHaveLength(1)
    expect(listA.json()[0].toolId).toBe('discord')
  })

  it('the dashboard listing never includes credentials, even encrypted', async () => {
    const { app, email } = buildTestApp()
    const { orgId, ownerToken } = await setupVerifiedOrg(app, email, 'Secret Co', 'secret@tools.test')

    await app.inject({
      method: 'PUT', url: `/orgs/${orgId}/tools/discord`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { category: 'communication', credentials: { botToken: 'super-secret-token' } },
    })

    const list = await app.inject({ method: 'GET', url: `/orgs/${orgId}/tools`, headers: { authorization: `Bearer ${ownerToken}` } })
    const body = JSON.stringify(list.json())
    expect(body).not.toContain('super-secret-token')
    expect(body).not.toContain('encryptedPayload')
  })

  it('a member cannot configure tools (role-gated to admin/owner)', async () => {
    const { app, email } = buildTestApp()
    const { orgId, ownerToken } = await setupVerifiedOrg(app, email, 'Locked Co', 'owner@locked.test')

    await app.inject({
      method: 'POST', url: `/orgs/${orgId}/staff/invite`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: 'member@locked.test', role: 'member' },
    })
    const inviteToken = email.lastTokenFor('member@locked.test')
    await app.inject({ method: 'POST', url: '/auth/accept-invite', payload: { token: inviteToken, password: 'correct-horse-battery', name: 'Member' } })
    const memberLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'member@locked.test', password: 'correct-horse-battery' } })
    const memberToken = memberLogin.json().accessToken

    const attempt = await app.inject({
      method: 'PUT', url: `/orgs/${orgId}/tools/discord`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { category: 'communication', credentials: { botToken: 'x' } },
    })
    expect(attempt.statusCode).toBe(403)
  })

  it('an org cannot configure or view another org\'s tools', async () => {
    const { app, email } = buildTestApp()
    const orgA = await setupVerifiedOrg(app, email, 'Org A Tools', 'a@cross.test')
    const orgB = await setupVerifiedOrg(app, email, 'Org B Tools', 'b@cross.test')

    const crossWrite = await app.inject({
      method: 'PUT', url: `/orgs/${orgB.orgId}/tools/discord`,
      headers: { authorization: `Bearer ${orgA.ownerToken}` },
      payload: { category: 'communication', credentials: { botToken: 'x' } },
    })
    expect(crossWrite.statusCode).toBe(403)
  })

  it('removing a tool config deletes it', async () => {
    const { app, email } = buildTestApp()
    const { orgId, ownerToken } = await setupVerifiedOrg(app, email, 'Remove Co', 'owner@remove.test')

    await app.inject({
      method: 'PUT', url: `/orgs/${orgId}/tools/discord`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { category: 'communication', credentials: { botToken: 'x' } },
    })
    const del = await app.inject({ method: 'DELETE', url: `/orgs/${orgId}/tools/discord`, headers: { authorization: `Bearer ${ownerToken}` } })
    expect(del.statusCode).toBe(204)

    const list = await app.inject({ method: 'GET', url: `/orgs/${orgId}/tools`, headers: { authorization: `Bearer ${ownerToken}` } })
    expect(list.json()).toHaveLength(0)
  })
})

describe('internal service-to-service credential fetch', () => {
  it('rejects requests without the internal key', async () => {
    const { app, email } = buildTestApp()
    const { orgId, ownerToken } = await setupVerifiedOrg(app, email, 'Internal Co', 'owner@internal.test')
    await app.inject({
      method: 'PUT', url: `/orgs/${orgId}/tools/discord`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { category: 'communication', credentials: { botToken: 'the-real-token' } },
    })

    const noKey = await app.inject({ method: 'GET', url: `/internal/orgs/${orgId}/tools/discord/credentials` })
    expect(noKey.statusCode).toBe(401)

    const wrongKey = await app.inject({
      method: 'GET', url: `/internal/orgs/${orgId}/tools/discord/credentials`,
      headers: { 'x-internal-key': 'wrong-key' },
    })
    expect(wrongKey.statusCode).toBe(401)
  })

  it('a user JWT (even Owner) cannot use the internal route — different trust boundary', async () => {
    const { app, email } = buildTestApp()
    const { orgId, ownerToken } = await setupVerifiedOrg(app, email, 'Boundary Co', 'owner@boundary.test')

    const attempt = await app.inject({
      method: 'GET', url: `/internal/orgs/${orgId}/tools/discord/credentials`,
      headers: { authorization: `Bearer ${ownerToken}` }, // user JWT, not the internal key
    })
    expect(attempt.statusCode).toBe(401)
  })

  it('returns decrypted credentials with the correct internal key', async () => {
    const { app, email } = buildTestApp()
    const { orgId, ownerToken } = await setupVerifiedOrg(app, email, 'Decrypt Co', 'owner@decrypt.test')
    await app.inject({
      method: 'PUT', url: `/orgs/${orgId}/tools/discord`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { category: 'communication', credentials: { botToken: 'the-real-token', applicationId: '999' } },
    })

    const fetch = await app.inject({
      method: 'GET', url: `/internal/orgs/${orgId}/tools/discord/credentials`,
      headers: { 'x-internal-key': TEST_INTERNAL_SERVICE_KEY },
    })
    expect(fetch.statusCode).toBe(200)
    expect(fetch.json().credentials).toEqual({ botToken: 'the-real-token', applicationId: '999' })
  })

  it('returns 404 for an unconfigured tool', async () => {
    const { app, email } = buildTestApp()
    const { orgId } = await setupVerifiedOrg(app, email, 'Empty Co', 'owner@empty.test')

    const fetch = await app.inject({
      method: 'GET', url: `/internal/orgs/${orgId}/tools/taiga/credentials`,
      headers: { 'x-internal-key': TEST_INTERNAL_SERVICE_KEY },
    })
    expect(fetch.statusCode).toBe(404)
  })
})
