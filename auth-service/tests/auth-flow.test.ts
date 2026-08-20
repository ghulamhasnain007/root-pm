import { beforeAll, describe, expect, it } from 'vitest'
import { initKeys } from '../src/crypto/jwt.js'
import { buildTestApp } from './harness.js'

beforeAll(async () => {
  await initKeys({})
})

describe('org registration + email verification', () => {
  it('creates an org + pending owner, and rejects login until verified', async () => {
    const { app, email } = buildTestApp()

    const register = await app.inject({
      method: 'POST', url: '/orgs/register',
      payload: { orgName: 'Acme Inc', ownerEmail: 'owner@acme.test', ownerPassword: 'correct-horse-battery', ownerName: 'Ada' },
    })
    expect(register.statusCode).toBe(201)
    const body = register.json()
    expect(body.user.status).toBe('pending_verification')

    // Login must be rejected with a specific, distinguishable error code —
    // not a generic 401 — so the client can show "verify your email" UI.
    const loginBeforeVerify = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'owner@acme.test', password: 'correct-horse-battery' },
    })
    expect(loginBeforeVerify.statusCode).toBe(403)
    expect(loginBeforeVerify.json().code).toBe('EMAIL_NOT_VERIFIED')

    const token = email.lastTokenFor('owner@acme.test')
    const verify = await app.inject({ method: 'GET', url: `/auth/verify-email?token=${token}` })
    expect(verify.statusCode).toBe(200)

    const loginAfterVerify = await app.inject({
      method: 'POST', url: '/auth/login',
      payload: { email: 'owner@acme.test', password: 'correct-horse-battery' },
    })
    expect(loginAfterVerify.statusCode).toBe(200)
    expect(loginAfterVerify.json().accessToken).toBeTruthy()
    expect(loginAfterVerify.json().refreshToken).toBeTruthy()
  })

  it('rejects a second registration with the same email', async () => {
    const { app } = buildTestApp()
    const payload = { orgName: 'Acme', ownerEmail: 'dup@acme.test', ownerPassword: 'correct-horse-battery', ownerName: 'Ada' }
    await app.inject({ method: 'POST', url: '/orgs/register', payload })
    const second = await app.inject({ method: 'POST', url: '/orgs/register', payload: { ...payload, orgName: 'Acme Two' } })
    expect(second.statusCode).toBe(409)
    expect(second.json().code).toBe('EMAIL_ALREADY_REGISTERED')
  })

  it('rejects wrong password with the same error as a nonexistent user (no enumeration)', async () => {
    const { app, email } = buildTestApp()
    await app.inject({
      method: 'POST', url: '/orgs/register',
      payload: { orgName: 'Acme', ownerEmail: 'enum@acme.test', ownerPassword: 'correct-horse-battery', ownerName: 'Ada' },
    })
    await app.inject({ method: 'GET', url: `/auth/verify-email?token=${email.lastTokenFor('enum@acme.test')}` })

    const wrongPassword = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'enum@acme.test', password: 'wrong' } })
    const noSuchUser = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'nobody@acme.test', password: 'wrong' } })
    expect(wrongPassword.statusCode).toBe(401)
    expect(noSuchUser.statusCode).toBe(401)
    expect(wrongPassword.json().code).toBe(noSuchUser.json().code)
  })

  it('resend-verification is silent about whether the email exists', async () => {
    const { app } = buildTestApp()
    const known = await app.inject({ method: 'POST', url: '/auth/resend-verification', payload: { email: 'ghost@acme.test' } })
    expect(known.statusCode).toBe(200) // no 404, no leak
  })
})

describe('refresh token rotation', () => {
  async function registerAndVerifyAndLogin(app: ReturnType<typeof buildTestApp>['app'], email: ReturnType<typeof buildTestApp>['email']) {
    await app.inject({
      method: 'POST', url: '/orgs/register',
      payload: { orgName: 'Rotate Co', ownerEmail: 'rot@acme.test', ownerPassword: 'correct-horse-battery', ownerName: 'Ada' },
    })
    await app.inject({ method: 'GET', url: `/auth/verify-email?token=${email.lastTokenFor('rot@acme.test')}` })
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'rot@acme.test', password: 'correct-horse-battery' } })
    return login.json()
  }

  it('rotates the refresh token and invalidates the old one', async () => {
    const { app, email } = buildTestApp()
    const { refreshToken } = await registerAndVerifyAndLogin(app, email)

    const refresh1 = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } })
    expect(refresh1.statusCode).toBe(200)
    const { refreshToken: rotated } = refresh1.json()
    expect(rotated).not.toBe(refreshToken)

    // Using the OLD (already-rotated) token must now fail.
    const reuseOld = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } })
    expect(reuseOld.statusCode).toBe(401)

    // The NEW token still works.
    const refresh2 = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: rotated } })
    expect(refresh2.statusCode).toBe(200)
  })

  it('logout revokes the refresh token', async () => {
    const { app, email } = buildTestApp()
    const { refreshToken, accessToken } = await registerAndVerifyAndLogin(app, email)

    const logout = await app.inject({
      method: 'POST', url: '/auth/logout',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { refreshToken },
    })
    expect(logout.statusCode).toBe(200)

    const afterLogout = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } })
    expect(afterLogout.statusCode).toBe(401)
  })
})

describe('access token auth', () => {
  it('rejects requests with no token, and accepts /auth/me with a valid one', async () => {
    const { app, email } = buildTestApp()
    await app.inject({
      method: 'POST', url: '/orgs/register',
      payload: { orgName: 'Whoami Co', ownerEmail: 'me@acme.test', ownerPassword: 'correct-horse-battery', ownerName: 'Ada' },
    })
    await app.inject({ method: 'GET', url: `/auth/verify-email?token=${email.lastTokenFor('me@acme.test')}` })
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'me@acme.test', password: 'correct-horse-battery' } })
    const { accessToken } = login.json()

    const noAuth = await app.inject({ method: 'GET', url: '/auth/me' })
    expect(noAuth.statusCode).toBe(401)

    const withAuth = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${accessToken}` } })
    expect(withAuth.statusCode).toBe(200)
    expect(withAuth.json().email).toBe('me@acme.test')
    expect(withAuth.json().role).toBe('owner')
  })
})
