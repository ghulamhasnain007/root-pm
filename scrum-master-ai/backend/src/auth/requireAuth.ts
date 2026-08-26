/**
 * auth/requireAuth.ts — Fastify preHandler that resolves the real,
 * authenticated org for a request.
 *
 * This replaces the `const ORG_ID = 'default'` constants that used to sit
 * at the top of every route file in integrations/routes/ and
 * integrations/discord/ambient/routes/ — every one of those had the same
 * comment: "later: derive ORG_ID from an authenticated session instead of
 * this." This is that later.
 *
 * Two modes, chosen once at boot from whether AUTH_SERVICE_URL is set —
 * same opt-in pattern already used elsewhere in this codebase
 * (CREDENTIALS_STORE_DRIVER=auth-service, see AuthServiceCredentialsStore):
 *
 *   - AUTH_SERVICE_URL set: real auth. A request with no token, an
 *     expired/invalid token, or a token that fails JWKS verification gets
 *     401'd. request.orgId/userId/role are the verified values from the
 *     token — never client-supplied, never guessable.
 *   - AUTH_SERVICE_URL unset: single-org fallback (request.orgId =
 *     'default', a fixed system userId, 'owner' role) so a developer
 *     running this service standalone, with no auth-service, doesn't hit a
 *     wall of 401s. Logged once at boot, not silently — this is a
 *     deliberate degraded mode, not an accident.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from './jwksVerifier.js';

export interface AuthedRequestFields {
  orgId: string;
  userId: string;
  role: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    orgId?: string;
    userId?: string;
    role?: string;
  }
}

const authServiceUrl = process.env.AUTH_SERVICE_URL || '';
let warnedOnce = false;

export function isAuthEnforced(): boolean {
  return !!authServiceUrl;
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!authServiceUrl) {
    if (!warnedOnce) {
      console.warn(
        '[auth] AUTH_SERVICE_URL not set — running in single-org fallback mode (orgId="default", ' +
        'no real authentication). Set AUTH_SERVICE_URL to require real login and scope data per org.'
      );
      warnedOnce = true;
    }
    request.orgId = 'default';
    request.userId = 'system';
    request.role = 'owner';
    return;
  }

  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    reply.code(401);
    throw new Error('Authentication required');
  }

  try {
    const verified = await verifyAccessToken(header.slice('Bearer '.length), authServiceUrl);
    request.orgId = verified.orgId;
    request.userId = verified.userId;
    request.role = verified.role;
  } catch {
    reply.code(401);
    throw new Error('Invalid or expired token');
  }
}
