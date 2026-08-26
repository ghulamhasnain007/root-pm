/**
 * lib/authFetch.ts — Authenticated fetch with automatic refresh-on-401,
 * shared by authApi.ts (talks to auth-service) and voiceApi.ts (talks to
 * scrum-master-ai). Refresh always goes to auth-service regardless of
 * which service the original request targeted — access tokens are only
 * ever minted there.
 */
import { AUTH_BASE } from './authBase.js';
import { getAccessToken, getRefreshToken, saveTokens, clearTokens, type AuthTokens } from './tokenStore.js';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

// De-dupes concurrent refresh attempts — if two API calls both 401 at
// nearly the same moment (e.g. two widgets loading in parallel right as
// the access token expires), they should share one refresh instead of each
// independently consuming/rotating the single-use refresh token, where the
// second one to arrive would fail against an already-rotated token.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const rt = getRefreshToken();
  if (!rt) return false;

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const resp = await fetch(`${AUTH_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: rt }),
        });
        if (!resp.ok) return false;
        const data = (await resp.json()) as AuthTokens;
        saveTokens(data);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export async function authFetch(baseUrl: string, path: string, init: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  };
  const token = getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let resp = await fetch(`${baseUrl}${path}`, { ...init, headers });

  if (resp.status === 401 && getRefreshToken()) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${getAccessToken()}`;
      resp = await fetch(`${baseUrl}${path}`, { ...init, headers });
    } else {
      clearTokens();
      window.location.href = '/login';
      throw new ApiError('Session expired', 401);
    }
  }

  if (!resp.ok) {
    const error = await resp.json().catch(() => ({ message: resp.statusText }));
    throw new ApiError(error.message || error.error || `HTTP ${resp.status}`, resp.status);
  }
  if (resp.status === 204) return null;
  return resp.json();
}
