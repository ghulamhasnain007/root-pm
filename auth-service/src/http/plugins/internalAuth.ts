import type { FastifyReply, FastifyRequest } from 'fastify'
import { Errors } from '../../errors.js'
import { timingSafeEqual } from 'node:crypto'

/**
 * Gates the internal credential-fetch route that agent-bridge and
 * scrum-master-ai use to actually retrieve decrypted tool credentials at
 * runtime. This is deliberately NOT the same auth as the dashboard
 * (`authenticate` in plugins/auth.ts) — that's a per-user JWT representing
 * "this human is logged in and has this role." This is a per-service shared
 * secret representing "this request came from another trusted backend in
 * our own deployment," which is a different trust boundary — no human user
 * session is involved when agent-bridge fetches an org's Taiga credentials
 * to make an API call on that org's behalf.
 *
 * A single shared key across all internal callers is a deliberate v1
 * simplification — see the constructor comment on what to change if
 * per-service keys are needed later (e.g. to revoke one compromised
 * service's access without rotating everyone's).
 */
export function requireInternalKey(expectedKey: string) {
  return async function (request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const provided = request.headers['x-internal-key']
    if (typeof provided !== 'string' || !expectedKey) throw Errors.unauthorized()

    // Constant-time comparison — a naive `===` leaks timing information
    // proportional to how many leading characters match, which is a real
    // (if slow) attack vector against any secret comparison.
    const a = Buffer.from(provided)
    const b = Buffer.from(expectedKey)
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw Errors.unauthorized()
  }
}
