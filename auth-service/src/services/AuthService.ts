import type { Repositories } from '../repositories/interfaces.js'
import type { IRefreshTokenStore } from './RefreshTokenStore.js'
import { verifyPassword } from '../crypto/password.js'
import { signAccessToken } from '../crypto/jwt.js'
import { Errors } from '../errors.js'
import type { User } from '../domain/types.js'

export interface LoginResult {
  accessToken: string
  refreshToken: string
  user: Pick<User, 'id' | 'orgId' | 'email' | 'name' | 'role'>
}

export class AuthService {
  constructor(
    private repos: Repositories,
    private refreshTokens: IRefreshTokenStore,
    private accessTokenTtlSeconds: number
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.repos.users.findByEmail(email.toLowerCase().trim())
    // Same error for "no such user" and "wrong password" — distinguishing
    // them lets an attacker enumerate registered emails one guess at a time.
    if (!user || !user.passwordHash) throw Errors.invalidCredentials()

    const ok = await verifyPassword(password, user.passwordHash)
    if (!ok) throw Errors.invalidCredentials()

    if (user.status === 'pending_verification') throw Errors.emailNotVerified()
    if (user.status === 'disabled') throw Errors.accountDisabled()

    const accessToken = await signAccessToken(
      { sub: user.id, orgId: user.orgId, role: user.role, email: user.email },
      this.accessTokenTtlSeconds
    )
    const refreshToken = await this.refreshTokens.issue(user.id, user.orgId)

    await this.repos.audit.append({ orgId: user.orgId, actorUserId: user.id, action: 'user.login', target: user.id, metadata: {} })

    return { accessToken, refreshToken, user: { id: user.id, orgId: user.orgId, email: user.email, name: user.name, role: user.role } }
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const rotated = await this.refreshTokens.verifyAndRotate(refreshToken)
    if (!rotated) throw Errors.invalidRefreshToken()

    const user = await this.repos.users.findById(rotated.userId)
    if (!user || user.status !== 'active') {
      // User was removed/disabled since this refresh token was issued —
      // don't hand out a fresh access token for a session that should be dead.
      await this.refreshTokens.revoke(rotated.newToken)
      throw Errors.invalidRefreshToken()
    }

    const accessToken = await signAccessToken(
      { sub: user.id, orgId: user.orgId, role: user.role, email: user.email },
      this.accessTokenTtlSeconds
    )
    return { accessToken, refreshToken: rotated.newToken }
  }

  async logout(refreshToken: string, actorUserId: string, orgId: string): Promise<void> {
    await this.refreshTokens.revoke(refreshToken)
    await this.repos.audit.append({ orgId, actorUserId, action: 'user.logout', target: actorUserId, metadata: {} })
  }
}
