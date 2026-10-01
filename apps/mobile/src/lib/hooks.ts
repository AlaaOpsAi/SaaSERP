import { useQuery } from '@tanstack/react-query';
import { api, type Lookup, type User, type Venue } from './api';

export const useLookups = () =>
  useQuery({ queryKey: ['lookups'], queryFn: () => api<Record<string, Lookup[]>>('/lookups'), staleTime: 5 * 60_000 });
export const useUsers = () => useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users'), staleTime: 5 * 60_000 });
export const useVenues = () => useQuery({ queryKey: ['venues'], queryFn: () => api<Venue[]>('/venues'), staleTime: 5 * 60_000 });

export function useLabel(type: string) {
  const { data } = useLookups();
  return (code: string | null | undefined) => (code ? data?.[type]?.find((l) => l.code === code)?.label ?? code : '—');
}
