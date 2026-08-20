import { randomBytes, createHash } from 'node:crypto'

/**
 * Single-use tokens (email verification, staff invites) follow the standard
 * pattern: generate a random secret, email/return the *plaintext* to the
 * user, but persist only its SHA-256 hash. If the database is ever read
 * (backup leak, insider access, etc.), stored hashes are useless without
 * the original random value — same principle as password hashing, applied
 * to bearer tokens instead of passwords.
 */

export function generateSecureToken(): { plaintext: string; hash: string } {
  const plaintext = randomBytes(32).toString('base64url')
  return { plaintext, hash: hashToken(plaintext) }
}

export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}
