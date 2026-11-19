import { CalendarDays } from 'lucide-react';
import { useRef } from 'react';
import { t } from '../i18n';
import type { Range } from './ContractGrid';

/**
 * The date filter of the customer's sketch (customer comment 13):
 *   FROM  [Y ▾] [M ▾] [D ▾]
 *   TO    [Y ▾] [M ▾] [D ▾]
 * Months as numbers. Only a year, or a year and a month, are enough: FROM 2024 TO 2025 is
 * 1 Jan 2024 – 31 Dec 2025; FROM 2025 / 3 TO 2025 / 6 is 1 March – 30 June. A calendar button
 * picks an exact day. Used by the filter of every date column (the ▾ in its header).
 */

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();

/** Y | M | D cells → a date; missing parts widen it to the whole year or month (start, or end for TO). */
function toIso(parts: string[] | undefined, end: boolean) {
  const [y, m, d] = (parts ?? []).map((x) => (x ? Number(x) : 0));
  if (!y) return undefined;
  const mm = m || (end ? 12 : 1);
  const dd = d || (end ? lastDay(y, mm) : 1);
  return `${y}-${pad(mm)}-${pad(Math.min(dd, lastDay(y, mm)))}`;
}
const cellsOf = (iso?: string) => (iso ? iso.split('-').map((x) => String(Number(x))) : undefined);

function YmdRow({ label, value, onChange }: { label: string; value: string[] | undefined; onChange: (v: string[]) => void }) {
  const [y = '', m = '', d = ''] = value ?? [];
  const picker = useRef<HTMLInputElement>(null);
  const year = new Date().getFullYear();
  const set = (i: number, v: string) => { const next = [y, m, d]; next[i] = v; onChange(next); };
  return (
    <div className="ymd-row" role="group" aria-label={label}>
      <span className="ymd-label">{label}</span>
      <select value={y} onChange={(e) => set(0, e.target.value)} aria-label={`${label} Y`}>
        <option value="">Y</option>
        {Array.from({ length: 12 }, (_, i) => year + 2 - i).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <select value={m} onChange={(e) => set(1, e.target.value)} aria-label={`${label} M`} disabled={!y}>
        <option value="">M</option>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <select value={d} onChange={(e) => set(2, e.target.value)} aria-label={`${label} D`} disabled={!m}>
        <option value="">D</option>
        {Array.from({ length: y && m ? lastDay(Number(y), Number(m)) : 31 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <button type="button" className="sm ghost ymd-cal" aria-label={t('Pick on a calendar')} onClick={() => picker.current?.showPicker?.()}>
        <CalendarDays className="ico" aria-hidden />
      </button>
      <input ref={picker} type="date" className="ymd-picker" tabIndex={-1} aria-hidden
        value={y && m && d ? `${y}-${pad(Number(m))}-${pad(Number(d))}` : ''}
        onChange={(e) => onChange(e.target.value ? cellsOf(e.target.value)! : ['', '', ''])} />
    </div>
  );
}

/** FROM / TO rows; the value is a range filter with the cells as typed. */
export function YmdRange({ value, onChange }: { value: Range | undefined; onChange: (r: Range | undefined) => void }) {
  const r = value ?? {};
  const set = (from: string[] | undefined, to: string[] | undefined) => {
    const min = toIso(from, false);
    const max = toIso(to, true);
    onChange(min || max ? { min, max, from, to } : undefined);
  };
  return (
    <div className="ymd-range">
      <YmdRow label={t('FROM')} value={r.from ?? cellsOf(r.min)} onChange={(v) => set(v, r.to ?? cellsOf(r.max))} />
      <YmdRow label={t('TO')} value={r.to ?? cellsOf(r.max)} onChange={(v) => set(r.from ?? cellsOf(r.min), v)} />
    </div>
  );
}
