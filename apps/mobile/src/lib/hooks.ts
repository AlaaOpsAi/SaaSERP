import { useQuery } from '@tanstack/react-query';
import { lookupLabel } from '../i18n';
import { api, type Lookup, type User, type Venue } from './api';

export const useLookups = () =>
  useQuery({ queryKey: ['lookups'], queryFn: () => api<Record<string, Lookup[]>>('/lookups'), staleTime: 5 * 60_000 });
export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users'), staleTime: 5 * 60_000 });
export const useVenues = () => useQuery({ queryKey: ['venues'], queryFn: () => api<Venue[]>('/venues'), staleTime: 5 * 60_000 });

export function useLabel(type: string) {
  const { data } = useLookups();
  return (code: string | null | undefined) => {
    if (!code) return '—';
    const l = data?.[type]?.find((x) => x.code === code);
    return l ? lookupLabel(l) : code;
  };
}
