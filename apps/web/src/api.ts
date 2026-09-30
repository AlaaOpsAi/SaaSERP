const TOKEN_KEY = 'saaserp.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: session lasts until reload */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await fetch(`/api${path}`, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body });
  if (res.status === 401 && token && path !== '/auth/login') {
    setToken(null);
    window.location.assign('/login');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
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

export async function download(path: string, filename: string) {
  const res = await fetch(`/api${path}`, { headers: { authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- shared types ------------------------------------------------------

export type Status = 'INQ' | 'TEN' | 'DEF' | 'ACT' | 'LOS' | 'CXL';
export type Role = 'owner' | 'admin' | 'manager' | 'sales' | 'finance' | 'viewer';

export interface Me {
  id: string;
  email: string;
  name: string;
  code: string;
  role: Role;
  tenant: {
    id: string; slug: string; name: string; plan: string; currency: string; timezone: string;
    fixed_cost_pct: number; credit_facility_pct: number;
  };
}

export interface Lookup { id: string; type: string; code: string; label: string; is_active: boolean; sort_order: number }
export interface User { id: string; name: string; email: string | null; code: string | null; role: Role; is_active: boolean; last_login_at: string | null }
export interface Space { id: string; venue_id: string; name: string; capacity: number | null; allow_overlap: boolean; is_active: boolean }
export interface Venue { id: string; name: string; kind: string; address: string | null; is_active: boolean; spaces: Space[] }
export interface BusinessUnit { id: string; code: string; name: string; is_active: boolean }

export interface Booking {
  id: string; booking_no: string; name: string; status: Status; business_unit_id: string; business_unit_code: string;
  event_type: string | null; source: string | null; owner_id: string | null; owner_name: string | null; owner_code: string | null;
  account_id: string | null; account_name: string | null; contact_id: string | null; contact_name: string | null;
  contact_phone: string | null; contact_email: string | null; venue_id: string | null; venue_name: string | null;
  function_space_id: string | null; space_name: string | null; hall_text: string | null;
  event_date: string | null; end_date: string | null; pax: number | null; rate: number | null; term_days: number | null;
  inquiry_date: string; decision_due_date: string | null; last_followup_date: string | null; next_followup_date: string | null;
  followup_notes: string | null; description: string | null; lost_reason: string | null; cancel_reason: string | null;
  manual_revenue: number | null; manual_cost: number | null; contract_value: number | null; credit_facility: boolean;
  fully_paid_date: string | null; currency: string;
  revenue: number; cost: number; gross_margin: number; margin_pct: number | null; diff: number | null;
  fixed_cost: number; cf_cost: number; net_profit: number; commission: number; shares: number;
  paid: number; outstanding: number; aging_days: number;
}

export interface BookingEvent {
  id: string; name: string; function_space_id: string | null; space_name: string | null; venue_name: string | null;
  setup_style: string | null; start_at: string; end_at: string; expected_pax: number | null; guaranteed_pax: number | null; notes: string | null;
}
export interface Item { id: string; category: string; description: string; quantity: number; unit_price: number; unit_cost: number }
export interface Activity {
  id: string; type: string; subject: string; due_at: string; location: string | null; notes: string | null; outcome: string | null;
  completed_at: string | null; owner_id: string | null; owner_name: string | null; booking_id: string | null;
  booking_no?: string; booking_name?: string; booking_status?: Status; contact_name?: string; contact_phone?: string;
}
export interface Payment { id: string; paid_on: string; amount: number; method: string; bank_account: string | null; reference: string | null }
export interface Payout { id: string; kind: 'commission' | 'share'; payee_name: string; pct: number; amount: number; status: 'pending' | 'paid'; paid_on: string | null }
export interface Conflict { booking_id: string; booking_no: string; booking_name: string; status: Status; space_name: string; start_at: string; end_at: string }

export interface BookingDetail extends Booking {
  events: BookingEvent[]; items: Item[]; activities: Activity[]; payments: Payment[]; payouts: Payout[];
  history: { id: string; from_status: Status | null; to_status: Status; reason: string | null; changed_by_name: string | null; changed_at: string }[];
  conflicts: Conflict[];
}
