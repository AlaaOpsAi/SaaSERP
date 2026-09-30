import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type BusinessUnit, type Lookup, type User, type Venue } from './api';

export function useLookups() {
  return useQuery({ queryKey: ['lookups'], queryFn: () => api<Record<string, Lookup[]>>('/lookups'), staleTime: 60_000 });
}
export function useUsers() {
  return useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users'), staleTime: 60_000 });
}
export function useVenues() {
  return useQuery({ queryKey: ['venues'], queryFn: () => api<Venue[]>('/venues'), staleTime: 60_000 });
}
export function useBusinessUnits() {
  return useQuery({ queryKey: ['business-units'], queryFn: () => api<BusinessUnit[]>('/business-units'), staleTime: 60_000 });
}

/** Label for a lookup code, falling back to the raw code. */
export function useLabel(type: string) {
  const { data } = useLookups();
  return (code: string | null | undefined) => (code ? data?.[type]?.find((l) => l.code === code)?.label ?? code : '—');
}

/** A mutation that invalidates the given query keys when it succeeds. */
export function useSave<TVars, TResult = any>(fn: (v: TVars) => Promise<TResult>, invalidate: unknown[][] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((key) => qc.invalidateQueries({ queryKey: key }))),
  });
}
