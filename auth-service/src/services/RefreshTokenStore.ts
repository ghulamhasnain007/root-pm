import { Redis } from 'ioredis'
import { generateSecureToken, hashToken } from '../crypto/secureToken.js'

export interface IRefreshTokenStore {
  issue(userId: string, orgId: string): Promise<string>
  verifyAndRotate(plaintextToken: string): Promise<{ userId: string; orgId: string; newToken: string } | null>
  revoke(plaintextToken: string): Promise<void>
  revokeAllForUser(userId: string): Promise<void>
}

/**
 * Refresh tokens live in Redis, not Mongo — they're short-lived,
 * high-frequency-write session state, not durable business data (same
 * reasoning agent-bridge already applies to conversation history). Storing
 * only the *hash* (never the plaintext) means a Redis data leak doesn't
 * hand out usable session tokens, same principle as password hashing.
 *
 * Rotation: every successful refresh deletes the old token and issues a
 * new one (`verifyAndRotate`). This limits how long a stolen refresh token
 * stays useful — if the legitimate client and an attacker both try to use
 * the same (now-consumed) token, the second one to arrive fails, which is
 * a detectable signal of token theft even though this service doesn't act
 * on that signal yet (logging it is a natural follow-up).
 */
export class RefreshTokenStore implements IRefreshTokenStore {
  constructor(private redis: Redis, private ttlSeconds: number) {}

  private tokenKey(hash: string) { return `auth:refresh:${hash}` }
  private userSetKey(userId: string) { return `auth:refresh:user:${userId}` }

  async issue(userId: string, orgId: string): Promise<string> {
    const { plaintext, hash } = generateSecureToken()
    await this.redis
      .multi()
      .set(this.tokenKey(hash), JSON.stringify({ userId, orgId }), 'EX', this.ttlSeconds)
      .sadd(this.userSetKey(userId), hash)
      .expire(this.userSetKey(userId), this.ttlSeconds)
      .exec()
    return plaintext
  }

  async verifyAndRotate(plaintextToken: string): Promise<{ userId: string; orgId: string; newToken: string } | null> {
    const hash = hashToken(plaintextToken)
    const raw = await this.redis.get(this.tokenKey(hash))
    if (!raw) return null
    const { userId, orgId } = JSON.parse(raw) as { userId: string; orgId: string }

    await this.redis.del(this.tokenKey(hash))
    await this.redis.srem(this.userSetKey(userId), hash)
    const newToken = await this.issue(userId, orgId)
    return { userId, orgId, newToken }
  }

  async revoke(plaintextToken: string): Promise<void> {
    const hash = hashToken(plaintextToken)
    const raw = await this.redis.get(this.tokenKey(hash))
    if (raw) {
      const { userId } = JSON.parse(raw) as { userId: string }
      await this.redis.srem(this.userSetKey(userId), hash)
    }
    await this.redis.del(this.tokenKey(hash))
  }

  /** Revoke every active session for a user — used when staff are removed or disabled. */
  async revokeAllForUser(userId: string): Promise<void> {
    const hashes = await this.redis.smembers(this.userSetKey(userId))
    if (hashes.length) {
      await this.redis.del(...hashes.map((h: string) => this.tokenKey(h)))
    }
    await this.redis.del(this.userSetKey(userId))
  }
}
