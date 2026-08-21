/**
 * lib/authApi.ts — API client for auth-service.
 * Handles login, register, logout, token refresh, email verification,
 * invite acceptance, staff management, and tool config CRUD.
 */

const AUTH_BASE = import.meta.env.VITE_AUTH_API || 'http://localhost:4000';

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

let accessToken: string | null = localStorage.getItem('accessToken');
let refreshToken: string | null = localStorage.getItem('refreshToken');

function saveTokens(tokens: AuthTokens) {
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken;
  localStorage.setItem('accessToken', tokens.accessToken);
  localStorage.setItem('refreshToken', tokens.refreshToken);
}

function clearTokens() {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

async function request(path: string, opts: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((opts.headers as Record<string, string>) || {}),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let resp = await fetch(`${AUTH_BASE}${path}`, { ...opts, headers });

  // If 401 and we have a refresh token, try refreshing
  if (resp.status === 401 && refreshToken) {
    const refreshResp = await fetch(`${AUTH_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (refreshResp.ok) {
      const data = await refreshResp.json();
      saveTokens(data);
      headers['Authorization'] = `Bearer ${data.accessToken}`;
      resp = await fetch(`${AUTH_BASE}${path}`, { ...opts, headers });
    } else {
      clearTokens();
      window.location.href = '/login';
      throw new Error('Session expired');
    }
  }

  if (!resp.ok) {
    const error = await resp.json().catch(() => ({ message: resp.statusText }));
    throw new Error(error.message || error.error || `HTTP ${resp.status}`);
  }

  if (resp.status === 204) return null;
  return resp.json();
}

// ── Auth endpoints ──────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      .then((data: AuthTokens) => { saveTokens(data); return data; }),

  register: (email: string, password: string, name: string, inviteToken: string) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name, inviteToken }) })
      .then((data: AuthTokens) => { saveTokens(data); return data; }),

  logout: () =>
    request('/auth/logout', { method: 'POST' }).finally(clearTokens),

  verifyEmail: (token: string) =>
    request('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),

  acceptInvite: (token: string, email: string, password: string, name: string) =>
    request('/auth/invites/accept', { method: 'POST', body: JSON.stringify({ token, email, password, name }) })
      .then((data: AuthTokens) => { saveTokens(data); return data; }),

  // ── Staff management ──────────────────────────────────────────────────

  listStaff: (orgId: string) =>
    request(`/orgs/${orgId}/staff`),

  inviteStaff: (orgId: string, email: string, role: string) =>
    request(`/orgs/${orgId}/staff/invite`, { method: 'POST', body: JSON.stringify({ email, role }) }),

  changeRole: (orgId: string, userId: string, role: string) =>
    request(`/orgs/${orgId}/staff/${userId}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),

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

  isAuthenticated: () => !!accessToken,
  getAccessToken: () => accessToken,
  getRefreshToken: () => refreshToken,
  clearAuth: clearTokens,
};
