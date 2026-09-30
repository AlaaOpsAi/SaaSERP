import type { Status } from './api';

let currency = 'KWD';
let timeZone: string | undefined;

/** Money and times follow the workspace, not the viewer's browser. */
export function setTenantLocale(c: string, tz: string) {
  currency = c;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    timeZone = tz;
  } catch {
    timeZone = undefined;
  }
}

/** Wall-clock parts of an instant in the workspace time zone. */
function zoned(d: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  return { y: parts.year, m: parts.month, d: parts.day, h: parts.hour, min: parts.minute };
}

const decimals = () => (['KWD', 'BHD', 'OMR', 'JOD'].includes(currency) ? 3 : 2);

export function money(v: number | null | undefined, opts: { compact?: boolean; code?: boolean } = {}): string {
  if (v === null || v === undefined) return '—';
  const n = new Intl.NumberFormat(undefined, opts.compact
    ? { notation: 'compact', maximumFractionDigits: 1 }
    : { minimumFractionDigits: decimals(), maximumFractionDigits: decimals() }).format(v);
  return opts.code ? `${n} ${currency}` : n;
}

export function num(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : new Intl.NumberFormat().format(v);
}

export function pct(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`;
}

export function date(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function dateTime(v: string | null | undefined): string {
  if (!v) return '—';
  return new Date(v).toLocaleString(undefined, { timeZone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function time(v: string): string {
  return new Date(v).toLocaleTimeString(undefined, { timeZone, hour: '2-digit', minute: '2-digit' });
}

/** Calendar day (YYYY-MM-DD) of an instant in the workspace time zone. */
export function dayOf(v: string | Date): string {
  const z = zoned(new Date(v));
  return `${z.y}-${z.m}-${z.d}`;
}

export function today(): string {
  return dayOf(new Date());
}

/** 'YYYY-MM-DDTHH:mm' in the workspace zone, for <input type="datetime-local">. */
export function toLocalInput(iso: string): string {
  const z = zoned(new Date(iso));
  return `${z.y}-${z.m}-${z.d}T${z.h}:${z.min}`;
}

/** Inverse of toLocalInput: workspace wall-clock time -> ISO instant. */
export function fromLocalInput(local: string): string {
  const [datePart, timePart = '00:00'] = local.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [h, min] = timePart.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  const z = zoned(new Date(guess));
  const offset = Date.UTC(+z.y, +z.m - 1, +z.d, +z.h, +z.min) - guess;
  return new Date(guess - offset).toISOString();
}

export const STATUS_LABEL: Record<Status, string> = {
  INQ: 'Inquiry', TEN: 'Tentative', DEF: 'Definite', ACT: 'Actualised', LOS: 'Lost', CXL: 'Cancelled',
};

export const TRANSITIONS: Record<Status, Status[]> = {
  INQ: ['TEN', 'DEF', 'LOS', 'CXL'],
  TEN: ['INQ', 'DEF', 'LOS', 'CXL'],
  DEF: ['TEN', 'ACT', 'CXL'],
  ACT: ['DEF'],
  LOS: ['INQ', 'TEN'],
  CXL: ['TEN'],
};

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
