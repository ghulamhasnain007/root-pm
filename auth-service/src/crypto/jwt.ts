import { generateKeyPair, exportJWK, SignJWT, jwtVerify, type JWK, type KeyLike } from 'jose'
import { createHash } from 'node:crypto'
import { importPKCS8, importSPKI } from 'jose'

/**
 * Access tokens are short-lived (default 15 min) RS256 JWTs. RS256
 * (asymmetric) rather than HS256 (shared-secret HMAC) is what makes the
 * `/.well-known/jwks.json` endpoint possible — agent-bridge and
 * scrum-master-ai can verify a token's signature using only the *public*
 * key fetched from that endpoint, with no shared secret to distribute or
 * rotate across three separately-deployed services.
 *
 * Refresh tokens are NOT JWTs — they're opaque random strings whose hash is
 * looked up in Redis (see src/services/AuthService.ts). That's what makes
 * them revocable: deleting the Redis entry invalidates it immediately,
 * unlike a JWT which stays valid until it expires no matter what.
 */

export interface AccessTokenPayload {
  sub: string // userId
  orgId: string
  role: string
  email: string
}

let signingKey: KeyLike
let verificationKey: KeyLike
let publicJwk: JWK
let kid: string

export async function initKeys(opts: { privateKeyPem?: string; publicKeyPem?: string }): Promise<void> {
  if (opts.privateKeyPem && opts.publicKeyPem) {
    signingKey = await importPKCS8(opts.privateKeyPem, 'RS256')
    verificationKey = await importSPKI(opts.publicKeyPem, 'RS256')
  } else {
    // Dev/test convenience only — an ephemeral key pair means every
    // restart invalidates all outstanding access tokens (refresh tokens
    // still work since they're just Redis lookups, so a re-login isn't
    // needed, just a token refresh). Production deployments should set
    // AUTH_JWT_PRIVATE_KEY / AUTH_JWT_PUBLIC_KEY (PEM) so restarts don't
    // disrupt active sessions.
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true })
    signingKey = privateKey
    verificationKey = publicKey
  }
  publicJwk = await exportJWK(verificationKey)
  kid = createHash('sha256').update(JSON.stringify(publicJwk)).digest('hex').slice(0, 16)
  publicJwk.kid = kid
  publicJwk.use = 'sig'
  publicJwk.alg = 'RS256'
}

export async function signAccessToken(payload: AccessTokenPayload, ttlSeconds: number): Promise<string> {
  return new SignJWT({ orgId: payload.orgId, role: payload.role, email: payload.email })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .setIssuer('auth-service')
    .sign(signingKey)
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, verificationKey, { issuer: 'auth-service' })
  return {
    sub: payload.sub as string,
    orgId: payload.orgId as string,
    role: payload.role as string,
    email: payload.email as string,
  }
}

export function getJwks(): { keys: JWK[] } {
  return { keys: [publicJwk] }
}
