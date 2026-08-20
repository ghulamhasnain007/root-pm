import { generateSecureToken, hashToken } from '../crypto/secureToken.js'
import type { IRefreshTokenStore } from './RefreshTokenStore.js'

export class InMemoryRefreshTokenStore implements IRefreshTokenStore {
  private tokens = new Map<string, { userId: string; orgId: string; expiresAt: number }>()
  private byUser = new Map<string, Set<string>>()

  constructor(private ttlSeconds: number) {}

  async issue(userId: string, orgId: string): Promise<string> {
    const { plaintext, hash } = generateSecureToken()
    this.tokens.set(hash, { userId, orgId, expiresAt: Date.now() + this.ttlSeconds * 1000 })
    if (!this.byUser.has(userId)) this.byUser.set(userId, new Set())
    this.byUser.get(userId)!.add(hash)
    return plaintext
  }

  async verifyAndRotate(plaintextToken: string) {
    const hash = hashToken(plaintextToken)
    const entry = this.tokens.get(hash)
    if (!entry || entry.expiresAt < Date.now()) return null
    this.tokens.delete(hash)
    this.byUser.get(entry.userId)?.delete(hash)
    const newToken = await this.issue(entry.userId, entry.orgId)
    return { userId: entry.userId, orgId: entry.orgId, newToken }
  }

  async revoke(plaintextToken: string) {
    const hash = hashToken(plaintextToken)
    const entry = this.tokens.get(hash)
    if (entry) this.byUser.get(entry.userId)?.delete(hash)
    this.tokens.delete(hash)
  }

  async revokeAllForUser(userId: string) {
    const hashes = this.byUser.get(userId)
    if (hashes) for (const h of hashes) this.tokens.delete(h)
    this.byUser.delete(userId)
  }
}
