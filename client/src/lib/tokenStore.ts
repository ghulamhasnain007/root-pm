/**
 * lib/tokenStore.ts — Single source of truth for auth tokens, shared by
 * authApi.ts (auth-service calls) and voiceApi.ts (scrum-master-ai calls).
 *
 * Fixes a real cross-tab bug: previously, authApi.ts held its own
 * module-level `accessToken`/`refreshToken` variables, seeded ONCE from
 * localStorage when that tab's JS first loaded, and never updated again
 * except by that same tab's own login/logout/refresh calls. A tab that was
 * already open before another tab logged in (or before another tab's
 * background token refresh rotated the refresh token) never found out —
 * its in-memory copy just went stale, and once its own access token
 * expired, refreshing with its now-already-consumed refresh token would
 * fail and bounce it to the login screen, even though the user was validly
 * logged in via a different, already-open tab.
 *
 * Fix: every tab still keeps its own in-memory copy for fast synchronous
 * reads (React state shouldn't await localStorage on every render), but
 * now listens for the browser's `storage` event — fired automatically in
 * every OTHER tab (never the tab that made the write) whenever localStorage
 * changes — and refreshes its in-memory copy + notifies subscribers (see
 * AuthContext.tsx) immediately when that happens. A login, logout, or
 * token refresh in any tab now propagates to every other open tab live,
 * with no reload needed.
 */

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

let accessToken: string | null = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : null;
let refreshToken: string | null = typeof localStorage !== 'undefined' ? localStorage.getItem('refreshToken') : null;

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach(l => l());
}

/** Subscribe to any token change (this tab's own login/logout/refresh, or
 * another tab's, via the storage-event bridge below). Returns an unsubscribe
 * function — call it in a React effect's cleanup. */
export function subscribeToTokenChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

export function saveTokens(tokens: AuthTokens): void {
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken;
  localStorage.setItem('accessToken', tokens.accessToken);
  localStorage.setItem('refreshToken', tokens.refreshToken);
  notify();
}

export function clearTokens(): void {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  notify();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    // e.key === null means localStorage.clear() was called; otherwise only
    // react to the two keys we actually care about, so unrelated storage
    // writes elsewhere in the app don't trigger spurious auth re-checks.
    if (e.key === 'accessToken' || e.key === 'refreshToken' || e.key === null) {
      accessToken = localStorage.getItem('accessToken');
      refreshToken = localStorage.getItem('refreshToken');
      notify();
    }
  });
}

/**
 * Decodes a JWT payload. JWTs use base64url encoding (RFC 4648 §5) —
 * plain atob() on that is a bug (throws or misdecodes on `-`/`_`
 * characters); this converts base64url → base64 first.
 */
export function parseJwtPayload(token: string): Record<string, any> {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/').padEnd(base64Url.length + (4 - (base64Url.length % 4)) % 4, '=');
  return JSON.parse(atob(base64));
}

/**
 * True if there's no access token, it's malformed, or it's within
 * `bufferSeconds` of expiring (default 10s — small safety margin so a
 * request that starts just before expiry doesn't land just after it).
 * Access tokens intentionally carry no server-side revocation check on
 * this client side — this is just "is it worth trying," the real
 * authority is auth-service's own verification on every request.
 */
export function isAccessTokenExpired(bufferSeconds = 10): boolean {
  if (!accessToken) return true;
  try {
    const payload = parseJwtPayload(accessToken);
    if (!payload.exp) return false;
    return Date.now() / 1000 > payload.exp - bufferSeconds;
  } catch {
    return true;
  }
}
