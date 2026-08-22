/**
 * store/AuthContext.tsx — React context for authentication state.
 * Manages JWT storage, user info, and org context.
 */
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { authApi } from '../lib/authApi';

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

/**
 * Decodes a JWT payload. JWTs use base64URL encoding (RFC 4648 §5: `-`/`_`
 * instead of `+`/`/`, no padding) — calling the browser's atob() directly on
 * that (as an earlier version of this file did, in two places) is a bug:
 * atob() decodes standard base64 only, and will throw or silently misdecode
 * on any payload containing the substituted characters. This converts
 * base64url → base64 first.
 */
function parseJwtPayload(token: string): { sub?: string; userId?: string; orgId?: string; role?: string; email?: string } {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/').padEnd(base64Url.length + (4 - (base64Url.length % 4)) % 4, '=');
  return JSON.parse(atob(base64));
}

function userFromToken(token: string): AuthUser {
  const payload = parseJwtPayload(token);
  return {
    userId: payload.sub || payload.userId || '',
    orgId: payload.orgId || '',
    role: payload.role || 'member',
    email: payload.email || '',
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = authApi.getAccessToken();
    if (token) {
      try {
        setUser(userFromToken(token));
      } catch {
        authApi.clearAuth();
      }
    }
    setIsLoading(false);
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
