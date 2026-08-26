/**
 * lib/authApi.ts — API client for auth-service.
 * Handles login, register, logout, token refresh, email verification,
 * invite acceptance, staff management, and tool config CRUD.
 *
 * Token storage and refresh mechanics live in tokenStore.ts/authFetch.ts,
 * shared with voiceApi.ts — see those files for why (cross-tab sync,
 * de-duped refresh, single source of truth for tokens across every service
 * this client talks to).
 */
import { AUTH_BASE } from './authBase.js';
import { authFetch } from './authFetch.js';
import { getAccessToken, getRefreshToken, saveTokens, clearTokens, type AuthTokens } from './tokenStore.js';

const request = (path: string, opts: RequestInit = {}) => authFetch(AUTH_BASE, path, opts);

export const authApi = {
  login: (email: string, password: string) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      .then((data: AuthTokens) => { saveTokens(data); return data; }),

  /** Creates a brand-new org + pending-verification Owner account. This is
   * the ONLY self-serve entry point in the system — there is no "join an
   * existing org" registration; staff join via acceptInvite() only. Does
   * NOT log the user in: the real endpoint returns no tokens (the account
   * can't log in until verifyEmail() succeeds), unlike login()/acceptInvite(). */
  register: (orgName: string, ownerEmail: string, ownerPassword: string, ownerName: string) =>
    request('/orgs/register', {
      method: 'POST',
      body: JSON.stringify({ orgName, ownerEmail, ownerPassword, ownerName }),
    }),

  logout: () =>
    request('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: getRefreshToken() }) }).finally(clearTokens),

  verifyEmail: (token: string) =>
    request(`/auth/verify-email?token=${encodeURIComponent(token)}`),

  resendVerification: (email: string) =>
    request('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) }),

  /** Creates the invited staff account and returns it (no tokens — the real
   * endpoint doesn't issue a session directly, since accepting an invite
   * and logging in are different concerns). Chains an explicit login()
   * using the email from the created account + the password just
   * submitted, so the caller still ends up authenticated in one call. */
  acceptInvite: (token: string, password: string, name: string) =>
    request('/auth/accept-invite', { method: 'POST', body: JSON.stringify({ token, password, name }) })
      .then((user: { email: string }) => authApi.login(user.email, password)),

  // ── Staff management ──────────────────────────────────────────────────

  listStaff: (orgId: string) =>
    request(`/orgs/${orgId}/staff`),

  inviteStaff: (orgId: string, email: string, role: string) =>
    request(`/orgs/${orgId}/staff/invite`, { method: 'POST', body: JSON.stringify({ email, role }) }),

  changeRole: (orgId: string, userId: string, role: string) =>
    request(`/orgs/${orgId}/staff/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),

  removeStaff: (orgId: string, userId: string) =>
    request(`/orgs/${orgId}/staff/${userId}`, { method: 'DELETE' }),

  // ── Tool config ───────────────────────────────────────────────────────

  listTools: (orgId: string) =>
    request(`/orgs/${orgId}/tools`),

  setTool: (orgId: string, toolId: string, category: string, credentials: Record<string, string>) =>
    request(`/orgs/${orgId}/tools/${toolId}`, {
      method: 'PUT',
      body: JSON.stringify({ category, credentials }),
    }),

  removeTool: (orgId: string, toolId: string) =>
    request(`/orgs/${orgId}/tools/${toolId}`, { method: 'DELETE' }),

  // ── Helpers ───────────────────────────────────────────────────────────

  isAuthenticated: () => !!getAccessToken(),
  getAccessToken,
  getRefreshToken,
  clearAuth: clearTokens,
};
