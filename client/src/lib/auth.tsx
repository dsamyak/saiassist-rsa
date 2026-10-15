import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshAccessToken, setAccessToken, setSessionExpiredHandler } from './api';
import type { Session } from './types';

interface AuthValue {
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Session>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  can: (permission: string) => boolean;
  /** Route prefix for the signed-in role: /admin for Super Admins, /app for dealer users. */
  base: '/admin' | '/app';
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const loadSession = useCallback(async () => {
    const me = await api<Session>('/api/auth/me');
    setSession(me);
    return me;
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setAccessToken(null);
      setSession(null);
      qc.clear();
    });
    (async () => {
      try {
        if (await refreshAccessToken()) await loadSession();
      } catch {
        setSession(null);
      } finally {
        setLoading(false);
      }
    })();
    return () => setSessionExpiredHandler(null);
  }, [loadSession, qc]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api<{ accessToken: string }>('/api/auth/login', { method: 'POST', body: { email, password } });
      setAccessToken(res.accessToken);
      qc.clear();
      return loadSession();
    },
    [loadSession, qc],
  );

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      /* already signed out */
    }
    setAccessToken(null);
    setSession(null);
    qc.clear();
  }, [qc]);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      loading,
      login,
      logout,
      reload: async () => {
        await loadSession();
      },
      can: (p) => !!session?.user.permissions.includes(p),
      base: session?.user.role === 'SUPER_ADMIN' ? '/admin' : '/app',
    }),
    [session, loading, login, logout, loadSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
