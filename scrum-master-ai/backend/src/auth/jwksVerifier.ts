/**
 * auth/jwksVerifier.ts — Verifies access tokens issued by auth-service.
 *
 * Mirrors the producer side (auth-service/src/crypto/jwt.ts: RS256, JWKS
 * published at /.well-known/jwks.json) from the consumer side. Uses jose's
 * createRemoteJWKSet, which fetches and caches the JWKS automatically
 * (including re-fetching if a token references a kid it doesn't have
 * cached yet — e.g. after auth-service rotates its signing key) — no need
 * to hand-roll caching/refresh logic here.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface VerifiedAuth {
  userId: string;
  orgId: string;
  role: string;
  email: string;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksUrl = '';

function getJwks(authServiceUrl: string) {
  if (!jwks || jwksUrl !== authServiceUrl) {
    jwksUrl = authServiceUrl;
    jwks = createRemoteJWKSet(new URL(`${authServiceUrl}/.well-known/jwks.json`));
  }
  return jwks;
}

export async function verifyAccessToken(token: string, authServiceUrl: string): Promise<VerifiedAuth> {
  const { payload } = await jwtVerify(token, getJwks(authServiceUrl), { issuer: 'auth-service' });
  return {
    userId: payload.sub as string,
    orgId: payload.orgId as string,
    role: payload.role as string,
    email: payload.email as string,
  };
}
