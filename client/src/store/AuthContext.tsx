/**
 * store/AuthContext.tsx — React context for authentication state.
 *
 * Two fixes over an earlier version, both about multi-tab correctness:
 *
 * 1. Subscribes to tokenStore's cross-tab change events (see
 *    tokenStore.ts's file header for the full explanation) — a login,
 *    logout, or token refresh in ANY open tab now updates this tab's
 *    `user` state immediately, without needing a reload. Previously each
 *    tab's auth state was set once on mount and never revisited.
 *
 * 2. On mount, if the stored access token is already expired, proactively
 *    attempts a refresh (using the stored refresh token) BEFORE deciding
 *    whether the user is authenticated — rather than optimistically
 *    decoding and trusting a token whose signature/expiry this client
 *    never actually validates. A tab opened after the access token's
 *    15-minute TTL has quietly elapsed since the last activity now
 *    silently refreshes instead of flashing into a "not authenticated"
 *    state (or worse, briefly *appearing* authenticated on stale decoded
 *    data, then failing on the first real API call).
 */
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { authApi } from '../lib/authApi';
import {
  getAccessToken, isAccessTokenExpired, parseJwtPayload, saveTokens, subscribeToTokenChanges,
} from '../lib/tokenStore';
import { AUTH_BASE } from '../lib/authBase';

interface AuthUser {
  userId: string;
  orgId: string;
  role: string;
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  acceptInvite: (token: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => {},
  acceptInvite: async () => {},
  logout: async () => {},
});

function userFromToken(token: string): AuthUser {
  const payload = parseJwtPayload(token);
  return {
    userId: payload.sub || payload.userId || '',
    orgId: payload.orgId || '',
    role: payload.role || 'member',
    email: payload.email || '',
  };
}

/** Re-reads tokenStore's current access token and updates React state
 * accordingly — the single function both the mount effect and the
 * cross-tab subscription call, so there's one code path for "sync my
 * state to whatever tokenStore currently has," not two that could drift. */
function syncFromStore(setUser: (u: AuthUser | null) => void) {
  const token = getAccessToken();
  if (!token) {
    setUser(null);
    return;
  }
  try {
    setUser(userFromToken(token));
  } catch {
    authApi.clearAuth();
    setUser(null);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (getAccessToken() && isAccessTokenExpired()) {
        // Try to get a fresh access token before deciding auth state —
        // see file header, point 2.
        try {
          const rt = localStorage.getItem('refreshToken');
          if (rt) {
            const resp = await fetch(`${AUTH_BASE}/auth/refresh`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken: rt }),
            });
            if (resp.ok) {
              const data = await resp.json();
              saveTokens(data);
            } else {
              authApi.clearAuth();
            }
          }
        } catch {
          // Network error, auth-service unreachable, etc. — fall through
          // and let syncFromStore below decide based on whatever's left.
        }
      }
      if (!cancelled) {
        syncFromStore(setUser);
        setIsLoading(false);
      }
    })();

    // Cross-tab: another tab's login/logout/refresh updates this tab's
    // state immediately, no reload needed.
    const unsubscribe = subscribeToTokenChanges(() => syncFromStore(setUser));

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await authApi.login(email, password);
    setUser(userFromToken(data.accessToken));
  }, []);

  // Separate from login() because AcceptInvitePage deliberately doesn't
  // collect an email (the invite is already tied to one server-side) — it
  // has no email to call login() with directly. authApi.acceptInvite
  // chains through authApi.login internally (using the email from the
  // newly-created account) and returns the same {accessToken,
  // refreshToken} shape, so this mirrors login() exactly once that
  // resolves — updating React's `user` state is what login() alone
  // wouldn't do if called from outside this context (tokens would land in
  // localStorage via authApi, but `user` would stay null until a reload,
  // and any route guard checking isAuthenticated would incorrectly bounce
  // a just-onboarded user back to the login page).
  const acceptInvite = useCallback(async (token: string, password: string, name: string) => {
    const data = await authApi.acceptInvite(token, password, name);
    setUser(userFromToken(data.accessToken));
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, acceptInvite, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
