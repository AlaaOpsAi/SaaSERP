import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, hasToken, loadSession, setToken, setUnauthorizedHandler, type Me, type Role } from './api';
import { setTenantLocale } from './format';
import { setAppearance } from './theme';
import { deviceLanguage, setLanguage, storedLanguage } from '../i18n';

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

/** Language and look follow the signed-in user, then the company, then this phone. */
export function applyUserSettings(me: Me) {
  setAppearance(me.preferences?.theme, me.preferences?.accent ?? me.tenant.branding?.accent);
  return setLanguage(me.preferences?.locale ?? me.tenant.default_locale ?? deviceLanguage());
}

async function fetchMe() {
  if (!hasToken()) return null;
  const me = await api<Me>('/auth/me');
  setTenantLocale(me.tenant.currency, me.tenant.timezone);
  applyUserSettings(me);
  return me;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    Promise.all([loadSession(), storedLanguage().then((l) => setLanguage(l ?? deviceLanguage()))]).then(() => setLoaded(true));
    setUnauthorizedHandler(() => {
      qc.clear();
      qc.setQueryData(['me'], null);
    });
  }, [qc]);
  const { data: me, isLoading } = useQuery({ queryKey: ['me'], queryFn: fetchMe, enabled: loaded, retry: false, staleTime: 60_000 });

  const value: AuthState = {
    ready: loaded && !isLoading,
    me: me ?? null,
    signIn: async (token) => {
      await setToken(token);
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
