import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, hasToken, loadSession, setToken, setUnauthorizedHandler, type Me, type Role } from './api';
import { setTenantLocale } from './format';

interface AuthState {
  ready: boolean;
  me: Me | null;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  can: (area: 'sell' | 'finance' | 'manage') => boolean;
}

const AREAS: Record<string, Role[]> = {
  sell: ['owner', 'admin', 'manager', 'sales'],
  finance: ['owner', 'admin', 'manager', 'finance'],
  manage: ['owner', 'admin', 'manager'],
};

const Ctx = createContext<AuthState | null>(null);

async function fetchMe() {
  if (!hasToken()) return null;
  const me = await api<Me>('/auth/me');
  setTenantLocale(me.tenant.currency, me.tenant.timezone);
  return me;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    loadSession().then(() => setLoaded(true));
    setUnauthorizedHandler(() => {
      qc.clear();
      qc.setQueryData(['me'], null);
    });
  }, [qc]);
  const { data: me, isLoading } = useQuery({ queryKey: ['me'], queryFn: fetchMe, enabled: loaded, retry: false, staleTime: 60_000 });

  const value: AuthState = {
    ready: loaded && !isLoading,
    me: me ?? null,
    signIn: async (t) => {
      await setToken(t);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      qc.setQueryData(['me'], await fetchMe());
    },
    signOut: async () => {
      await setToken(null);
      qc.clear();
      qc.setQueryData(['me'], null);
    },
    can: (area) => Boolean(me && AREAS[area].includes(me.role)),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
