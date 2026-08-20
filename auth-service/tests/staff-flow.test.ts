import { beforeAll, describe, expect, it } from 'vitest'
import { initKeys } from '../src/crypto/jwt.js'
import { buildTestApp } from './harness.js'

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
  return { orgId, ownerToken: login.json().accessToken as string }
}

describe('staff invites — the only way into an existing org', () => {
  it('there is no public join/signup path: staff only get in via an emailed invite', async () => {
    const { app } = buildTestApp()
    // No such thing as "register into an existing org" — /orgs/register
    // always creates a BRAND NEW org. Confirm two calls with different
    // owner emails but the same org name produce two distinct orgs, not
    // one org gaining a second member.
    const r1 = await app.inject({ method: 'POST', url: '/orgs/register', payload: { orgName: 'Shared Name Co', ownerEmail: 'a@x.test', ownerPassword: 'correct-horse-battery', ownerName: 'A' } })
    const r2 = await app.inject({ method: 'POST', url: '/orgs/register', payload: { orgName: 'Shared Name Co', ownerEmail: 'b@x.test', ownerPassword: 'correct-horse-battery', ownerName: 'B' } })
    expect(r1.json().org.id).not.toBe(r2.json().org.id)
  })

  it('owner can invite staff by email; invitee sets their own password via the emailed link', async () => {
    const { app, email } = buildTestApp()
    const { orgId, ownerToken } = await setupVerifiedOrg(app, email, 'Invite Co', 'owner@invite.test')

    const invite = await app.inject({
      method: 'POST', url: `/orgs/${orgId}/staff/invite`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: 'newstaff@invite.test', role: 'member' },
    })
    expect(invite.statusCode).toBe(201)

    const token = email.lastTokenFor('newstaff@invite.test')
    const accept = await app.inject({
      method: 'POST', url: '/auth/accept-invite',
      payload: { token, password: 'a-different-password', name: 'New Staff' },
    })
    expect(accept.statusCode).toBe(201)
    expect(accept.json().status).toBe('active') // no separate email verification needed

    // The new staff member can log in immediately (no verification step).
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'newstaff@invite.test', password: 'a-different-password' } })
    expect(login.statusCode).toBe(200)
    expect(login.json().user.role).toBe('member')
  })

  it('a member cannot invite anyone (role-gated to admin/owner)', async () => {
    const { app, email } = buildTestApp()
    const { orgId, ownerToken } = await setupVerifiedOrg(app, email, 'Gate Co', 'owner@gate.test')

    await app.inject({
      method: 'POST', url: `/orgs/${orgId}/staff/invite`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: 'member@gate.test', role: 'member' },
    })
    const memberToken = email.lastTokenFor('member@gate.test')
    await app.inject({ method: 'POST', url: '/auth/accept-invite', payload: { token: memberToken, password: 'correct-horse-battery', name: 'Member' } })
    const memberLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'member@gate.test', password: 'correct-horse-battery' } })
    const memberAccessToken = memberLogin.json().accessToken

    const attempt = await app.inject({
      method: 'POST', url: `/orgs/${orgId}/staff/invite`,
      headers: { authorization: `Bearer ${memberAccessToken}` },
      payload: { email: 'blocked@gate.test', role: 'member' },
    })
    expect(attempt.statusCode).toBe(403)
  })

  it('an admin cannot invite someone as owner (only an owner can mint another owner)', async () => {
    const { app, email } = buildTestApp()
    const { orgId, ownerToken } = await setupVerifiedOrg(app, email, 'Promote Co', 'owner@promote.test')

    await app.inject({
      method: 'POST', url: `/orgs/${orgId}/staff/invite`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: 'admin@promote.test', role: 'admin' },
    })
    const adminToken = email.lastTokenFor('admin@promote.test')
    await app.inject({ method: 'POST', url: '/auth/accept-invite', payload: { token: adminToken, password: 'correct-horse-battery', name: 'Admin' } })
    const adminLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin@promote.test', password: 'correct-horse-battery' } })
    const adminAccessToken = adminLogin.json().accessToken

    const attempt = await app.inject({
      method: 'POST', url: `/orgs/${orgId}/staff/invite`,
      headers: { authorization: `Bearer ${adminAccessToken}` },
      payload: { email: 'wannabeowner@promote.test', role: 'owner' },
    })
    expect(attempt.statusCode).toBe(403)
  })
})

describe('last-owner protection', () => {
  it('cannot demote the only owner', async () => {
    const { app, email } = buildTestApp()
    const { orgId, ownerToken } = await setupVerifiedOrg(app, email, 'Lonely Co', 'owner@lonely.test')
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@lonely.test', password: 'correct-horse-battery' } })
    const ownerId = login.json().user.id

    const attempt = await app.inject({
      method: 'PATCH', url: `/orgs/${orgId}/staff/${ownerId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { role: 'admin' },
    })
    expect(attempt.statusCode).toBe(400)
    expect(attempt.json().code).toBe('LAST_OWNER')
  })

  it('cannot remove the only owner', async () => {
    const { app, email } = buildTestApp()
    const { orgId, ownerToken } = await setupVerifiedOrg(app, email, 'Solo Co', 'owner@solo.test')
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@solo.test', password: 'correct-horse-battery' } })
    const ownerId = login.json().user.id

    const attempt = await app.inject({
      method: 'DELETE', url: `/orgs/${orgId}/staff/${ownerId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    })
    // Also blocked separately by "can't remove your own account here" —
    // either way this must not succeed.
    expect(attempt.statusCode).not.toBe(204)
  })

  it('demoting one of two owners succeeds', async () => {
    const { app, email } = buildTestApp()
    const { orgId, ownerToken } = await setupVerifiedOrg(app, email, 'Duo Co', 'owner1@duo.test')

    await app.inject({
      method: 'POST', url: `/orgs/${orgId}/staff/invite`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: 'owner2@duo.test', role: 'owner' },
    })
    const token = email.lastTokenFor('owner2@duo.test')
    const accepted = await app.inject({ method: 'POST', url: '/auth/accept-invite', payload: { token, password: 'correct-horse-battery', name: 'Owner Two' } })
    const secondOwnerId = accepted.json().id

    const demote = await app.inject({
      method: 'PATCH', url: `/orgs/${orgId}/staff/${secondOwnerId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { role: 'admin' },
    })
    expect(demote.statusCode).toBe(200)
    expect(demote.json().role).toBe('admin')
  })
})

describe('role change forces re-auth', () => {
  it('revokes the demoted user\'s existing session', async () => {
    const { app, email } = buildTestApp()
    const { orgId, ownerToken } = await setupVerifiedOrg(app, email, 'Revoke Co', 'owner@revoke.test')

    await app.inject({
      method: 'POST', url: `/orgs/${orgId}/staff/invite`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: 'admin@revoke.test', role: 'admin' },
    })
    const inviteToken = email.lastTokenFor('admin@revoke.test')
    const accepted = await app.inject({ method: 'POST', url: '/auth/accept-invite', payload: { token: inviteToken, password: 'correct-horse-battery', name: 'Admin' } })
    const adminId = accepted.json().id
    const adminLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin@revoke.test', password: 'correct-horse-battery' } })
    const adminRefreshToken = adminLogin.json().refreshToken

    await app.inject({
      method: 'PATCH', url: `/orgs/${orgId}/staff/${adminId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { role: 'member' },
    })

    // The admin's OLD refresh token (issued before the demotion) must no
    // longer work — otherwise they could keep refreshing an access token
    // that still claims the old, higher role for up to its lifetime.
    const refreshAttempt = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: adminRefreshToken } })
    expect(refreshAttempt.statusCode).toBe(401)
  })
})

describe('cross-org isolation', () => {
  it('staff of org A cannot list staff of org B, even with a valid token', async () => {
    const { app, email } = buildTestApp()
    const orgA = await setupVerifiedOrg(app, email, 'Org A', 'owner@a.test')
    const orgB = await setupVerifiedOrg(app, email, 'Org B', 'owner@b.test')

    const crossAttempt = await app.inject({
      method: 'GET', url: `/orgs/${orgB.orgId}/staff`,
      headers: { authorization: `Bearer ${orgA.ownerToken}` },
    })
    expect(crossAttempt.statusCode).toBe(403)

    const ownOrg = await app.inject({
      method: 'GET', url: `/orgs/${orgA.orgId}/staff`,
      headers: { authorization: `Bearer ${orgA.ownerToken}` },
    })
    expect(ownOrg.statusCode).toBe(200)
    expect(ownOrg.json()).toHaveLength(1)
  })
})
