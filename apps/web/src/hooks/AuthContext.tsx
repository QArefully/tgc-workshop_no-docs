import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PublicUser } from '@shop/contracts/auth';
import type { Country } from '@shop/contracts/country';
import { getMe, login as loginApi, signup as signupApi, logout as logoutApi } from '@/api/auth';

interface AuthState {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string, country: Country) => Promise<PublicUser>;
  signup: (
    email: string,
    password: string,
    displayName: string,
    country: Country,
  ) => Promise<PublicUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  login: () => {
    throw new Error('AuthProvider not mounted');
  },
  signup: () => {
    throw new Error('AuthProvider not mounted');
  },
  logout: () => {
    throw new Error('AuthProvider not mounted');
  },
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

/**
 * AuthProvider — manages authentication state.
 * Refreshes the session on mount by calling GET /me.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Refresh session on mount
  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const me = await getMe();
        if (!cancelled) {
          setUser(me ?? null);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void refresh();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string, country: Country): Promise<PublicUser> => {
      const result = await loginApi({ email, password, country });
      setUser(result);
      return result;
    },
    [],
  );

  const signup = useCallback(
    async (
      email: string,
      password: string,
      displayName: string,
      country: Country,
    ): Promise<PublicUser> => {
      const result = await signupApi({ email, password, displayName, country });
      setUser(result);
      return result;
    },
    [],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await logoutApi();
    } finally {
      setUser(null);
    }
  }, []);

  const value: AuthState = { user, loading, login, signup, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
