/**
 * Typed errors with a stable `code` field, separate from the human message.
 * The client needs to distinguish "wrong password" from "email not verified"
 * to show a resend-verification button instead of a generic auth failure —
 * a generic 401 can't carry that distinction.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const Errors = {
  invalidCredentials: () => new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password'),
  emailNotVerified: () => new AppError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email before logging in'),
  accountDisabled: () => new AppError(403, 'ACCOUNT_DISABLED', 'This account has been disabled'),
  emailAlreadyRegistered: () => new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists'),
  orgSlugTaken: () => new AppError(409, 'ORG_SLUG_TAKEN', 'An organization with this name already exists'),
  invalidOrExpiredToken: (kind: string) => new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', `This ${kind} link is invalid or has expired`),
  invalidRefreshToken: () => new AppError(401, 'INVALID_REFRESH_TOKEN', 'Session expired, please log in again'),
  forbidden: (reason = 'You do not have permission to do this') => new AppError(403, 'FORBIDDEN', reason),
  unauthorized: () => new AppError(401, 'UNAUTHORIZED', 'Authentication required'),
  notFound: (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`),
  rateLimited: () => new AppError(429, 'RATE_LIMITED', 'Too many attempts — please wait before trying again'),
  validation: (message: string, details?: Record<string, unknown>) => new AppError(400, 'VALIDATION_ERROR', message, details),
  lastOwner: () => new AppError(400, 'LAST_OWNER', 'An organization must always have at least one Owner'),
}
