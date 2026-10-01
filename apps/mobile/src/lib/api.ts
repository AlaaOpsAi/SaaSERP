import Constants from 'expo-constants';
import { getItem, setItem } from './storage';

/* The app talks to the same API as the web app: <server>/api/... */

const SERVER_KEY = 'saaserp.server';
const TOKEN_KEY = 'saaserp.token';

let server: string = (Constants.expoConfig?.extra?.defaultServer as string | undefined) ?? 'http://localhost:4000';
let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export async function loadSession() {
  server = (await getItem(SERVER_KEY)) ?? server;
  token = await getItem(TOKEN_KEY);
  return { server, token };
}

export const getServer = () => server;
export async function setServer(url: string) {
  server = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(server)) server = `http://${server}`;
  await setItem(SERVER_KEY, server);
}
export async function setToken(t: string | null) {
  token = t;
  await setItem(TOKEN_KEY, t);
}
export const hasToken = () => Boolean(token);
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${server}/api${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, `Cannot reach ${server}. Check the server address and that your phone is on the same network.`);
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    // Session over, or the workspace was suspended while signed in.
    if (token && path !== '/auth/login' && (res.status === 401 || (res.status === 403 && data?.details?.tenant_status))) {
      await setToken(null);
      onUnauthorized?.();
    }
    let message = data?.error ?? `Request failed (${res.status})`;
    const fields = data?.details?.fieldErrors;
    if (fields) {
      const first = Object.entries(fields)[0] as [string, string[]] | undefined;
      if (first) message = `${first[0].replace(/_/g, ' ')}: ${first[1][0]}`;
    }
    throw new ApiError(res.status, message, data?.details);
  }
  return data as T;
}

// ---- types shared with the web app -------------------------------------------

export type Status = 'INQ' | 'TEN' | 'DEF' | 'ACT' | 'LOS' | 'CXL';
export type Role = 'owner' | 'admin' | 'manager' | 'sales' | 'finance' | 'viewer';

export interface Me {
  id: string; name: string; email: string; code: string; role: Role; sees_all: boolean; team_ids: string[];
  covering: { id: string; delegator_name: string; access: 'view' | 'act'; ends_on: string | null }[];
  covered_by: { id: string; delegate_name: string; ends_on: string | null }[];
  tenant: { id: string; slug: string; name: string; currency: string; timezone: string };
}

export interface Lookup { id: string; code: string; label: string; is_active: boolean }
export interface User { id: string; name: string; code: string | null; is_active: boolean; in_my_team: boolean }
export interface Venue { id: string; name: string; is_active: boolean; spaces: { id: string; name: string; capacity: number | null }[] }

export interface Booking {
  id: string; booking_no: string; name: string; status: Status; event_type: string | null; source: string | null;
  owner_id: string | null; owner_name: string | null; owner_code: string | null; created_by: string | null;
  contact_name: string | null; contact_phone: string | null; contact_email: string | null;
  venue_name: string | null; space_name: string | null; hall_text: string | null;
  event_date: string | null; pax: number | null; inquiry_date: string; next_followup_date: string | null;
  description: string | null; lost_reason: string | null;
  revenue: number; gross_margin: number; margin_pct: number | null; net_profit: number; paid: number; outstanding: number;
  contract_value: number | null;
}

export interface Activity {
  id: string; type: string; subject: string; due_at: string; location: string | null; notes: string | null; outcome: string | null;
  completed_at: string | null; owner_id: string | null; owner_name: string | null; booking_id: string | null; booking_no?: string;
  booking_name?: string; contact_name?: string; contact_phone?: string; not_mine?: boolean;
  completed_by_name?: string | null; completed_on_behalf_of_name?: string | null;
}

export interface BookingDetail extends Booking {
  can_edit: boolean;
  events: { id: string; name: string; start_at: string; end_at: string; space_name: string | null; venue_name: string | null; expected_pax: number | null }[];
  activities: Activity[];
  log: { id: string; action: string; created_at: string; actor_name: string | null; on_behalf_of_name: string | null }[];
  history: { id: string; from_status: Status | null; to_status: Status; changed_by_name: string | null; on_behalf_of_name: string | null; changed_at: string; reason: string | null }[];
  conflicts: { booking_name: string; space_name: string }[];
}
