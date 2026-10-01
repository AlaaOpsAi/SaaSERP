import type { Status } from './api';

let currency = 'KWD';
let timeZone: string | undefined;

/** Money and times follow the workspace, not the phone. */
export function setTenantLocale(c: string, tz: string) {
  currency = c;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    timeZone = tz;
  } catch {
    timeZone = undefined;
  }
}

const decimals = () => (['KWD', 'BHD', 'OMR', 'JOD'].includes(currency) ? 3 : 2);

export function money(v: number | null | undefined, compact = false): string {
  if (v === null || v === undefined) return '—';
  if (compact) {
    const a = Math.abs(v);
    const s = a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0);
    return s.replace('.0', '');
  }
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals(), maximumFractionDigits: decimals() });
}

export const currencyCode = () => currency;
export const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(d)}%`);

function parts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { y: p.year, m: p.month, d: p.day, h: p.hour, min: p.minute };
}

/** YYYY-MM-DD in the workspace time zone. */
export function dayOf(v: string | Date): string {
  const z = parts(new Date(v));
  return `${z.y}-${z.m}-${z.d}`;
}
export const today = () => dayOf(new Date());
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function date(v: string | null | undefined): string {
  if (!v) return '—';
  const d = v.length === 10 ? new Date(`${v}T12:00:00Z`) : new Date(v);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: v.length === 10 ? 'UTC' : timeZone });
}
export function time(v: string): string {
  return new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone });
}
export function dateTime(v: string): string {
  return new Date(v).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone });
}
/** Workspace wall-clock time -> ISO instant (e.g. "tomorrow 10:00" in Kuwait). */
export function zonedIso(day: string, hhmm: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  const z = parts(new Date(guess));
  const offset = Date.UTC(+z.y, +z.m - 1, +z.d, +z.h, +z.min) - guess;
  return new Date(guess - offset).toISOString();
}
export function greeting(): string {
  const h = Number(parts(new Date()).h);
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export const STATUS_LABEL: Record<Status, string> = {
  INQ: 'Inquiry', TEN: 'Tentative', DEF: 'Definite', ACT: 'Actualised', LOS: 'Lost', CXL: 'Cancelled',
};
export const TRANSITIONS: Record<Status, Status[]> = {
  INQ: ['TEN', 'DEF', 'LOS', 'CXL'], TEN: ['INQ', 'DEF', 'LOS', 'CXL'], DEF: ['TEN', 'ACT', 'CXL'],
  ACT: ['DEF'], LOS: ['INQ', 'TEN'], CXL: ['TEN'],
};
