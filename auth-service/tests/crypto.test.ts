import { beforeAll, describe, expect, it } from 'vitest'
import { getJwks, initKeys, signAccessToken, verifyAccessToken } from '../src/crypto/jwt.js'
import { generateSecureToken, hashToken } from '../src/crypto/secureToken.js'
import { hashPassword, verifyPassword } from '../src/crypto/password.js'

beforeAll(async () => {
  await initKeys({})
})

describe('JWT sign/verify', () => {
  it('round-trips a signed token and rejects a tampered one', async () => {
    const token = await signAccessToken({ sub: 'user1', orgId: 'org1', role: 'owner', email: 'a@b.test' }, 900)
    const payload = await verifyAccessToken(token)
    expect(payload).toEqual({ sub: 'user1', orgId: 'org1', role: 'owner', email: 'a@b.test' })

    const tampered = token.slice(0, -2) + 'xx'
    await expect(verifyAccessToken(tampered)).rejects.toThrow()
  })

  it('exposes a JWKS with a matching kid', async () => {
    const jwks = getJwks()
    expect(jwks.keys).toHaveLength(1)
    expect(jwks.keys[0].kid).toBeTruthy()
    expect(jwks.keys[0].alg).toBe('RS256')
  })
})

describe('secure tokens (invites / email verification)', () => {
  it('hash is deterministic but does not reveal the plaintext', () => {
    const { plaintext, hash } = generateSecureToken()
    expect(hashToken(plaintext)).toBe(hash)
    expect(hash).not.toContain(plaintext)
  })

  it('two generated tokens never collide', () => {
    const a = generateSecureToken()
    const b = generateSecureToken()
    expect(a.plaintext).not.toBe(b.plaintext)
  })
})

describe('password hashing', () => {
  it('verifies correct password and rejects incorrect one', async () => {
    const hash = await hashPassword('correct-horse-battery')
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true)
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })
})
