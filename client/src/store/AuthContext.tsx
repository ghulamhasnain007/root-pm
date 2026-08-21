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
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if we have a stored token and try to decode user info
    const token = authApi.getAccessToken();
    if (token) {
      try {
        // Decode JWT payload (base64url)
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUser({
          userId: payload.sub || payload.userId || '',
          orgId: payload.orgId || 'default',
          role: payload.role || 'member',
          email: payload.email || '',
        });
      } catch {
        authApi.clearAuth();
      }
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await authApi.login(email, password);
    // Decode the access token to get user info
    try {
      const payload = JSON.parse(atob(data.accessToken.split('.')[1]));
      setUser({
        userId: payload.sub || payload.userId || '',
        orgId: payload.orgId || 'default',
        role: payload.role || 'member',
        email: payload.email || '',
      });
    } catch {
      // Token decode failed — user will be null
    }
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
