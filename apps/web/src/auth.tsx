import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { api, getToken, setToken, type Me, type Role } from './api';
import { applyAppearance } from './appearance';
import { setTenantLocale } from './format';
import { setLanguage, storedLanguage, storeLanguage } from './i18n';

interface AuthState {
  me: Me | null;
  loading: boolean;
  signIn: (token: string) => Promise<void>;
  signOut: () => void;
  can: (area: 'sell' | 'finance' | 'manage' | 'admin') => boolean;
}

const AREAS: Record<string, Role[]> = {
  sell: ['owner', 'admin', 'manager', 'sales'],
  finance: ['owner', 'admin', 'manager', 'finance'],
  manage: ['owner', 'admin', 'manager'],
  admin: ['owner', 'admin'],
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data: me, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      if (!getToken()) return null;
      const me = await api<Me>('/auth/me');
      setTenantLocale(me.tenant.currency, me.tenant.timezone);
      return me;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Language and look follow the signed-in user (falling back to the company defaults).
  if (me) {
    const lang = setLanguage(me.preferences?.locale ?? me.tenant.default_locale ?? storedLanguage());
    storeLanguage(lang.code);
    applyAppearance(me.preferences ?? {}, me.tenant.branding?.accent);
  }

  const value: AuthState = {
    me: me ?? null,
    loading: isLoading,
    signIn: async (token) => {
      setToken(token);
      // Drop the previous session's data but keep the observed 'me' query attached.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      const me = await api<Me>('/auth/me');
      setTenantLocale(me.tenant.currency, me.tenant.timezone);
      qc.setQueryData(['me'], me);
    },
    signOut: () => {
      setToken(null);
      qc.clear();
      window.location.assign('/login');
    },
    can: (area) => Boolean(me && AREAS[area].includes(me.role)),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
