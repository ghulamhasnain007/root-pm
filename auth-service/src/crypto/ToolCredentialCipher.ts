import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const ALGO = 'aes-256-gcm'

/**
 * AES-256-GCM at-rest encryption for org tool credentials (Discord bot
 * tokens, Taiga passwords, any future tool's secrets). Deliberately the
 * same algorithm/format as scrum-master-ai's TokenCipher
 * (integrations/crypto/TokenCipher.ts), which already encrypts OAuth
 * tokens for Zoom/Google Meet/Teams — one encryption scheme across the
 * whole system rather than two, even though this is a separate service.
 *
 * Key must be a base64-encoded 32-byte value, e.g.:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * Rotate by re-encrypting stored payloads with a new key — this class
 * doesn't handle key rotation.
 */
export class ToolCredentialCipher {
  private key: Buffer

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64')
    if (key.length !== 32) {
      throw new Error('TOOL_CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded AES-256 key)')
    }
    this.key = key
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv(ALGO, this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [iv, tag, ciphertext].map((b) => b.toString('base64')).join('.')
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, dataB64] = payload.split('.')
    if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted credential payload')
    const iv = Buffer.from(ivB64, 'base64')
    const tag = Buffer.from(tagB64, 'base64')
    const data = Buffer.from(dataB64, 'base64')
    const decipher = createDecipheriv(ALGO, this.key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  }
}
