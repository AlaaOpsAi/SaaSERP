import type { Column, Table } from '@tanstack/react-table';
import { CalendarDays, ChevronDown, ChevronRight, X } from 'lucide-react';
import { useRef } from 'react';
import type { Booking } from '../api';
import { t } from '../i18n';
import { compareKeys, metaOf, type Range, showValue } from './ContractGrid';

/**
 * The filter boxes of the contract list (customer comment 9), named as in the daily report:
 *   quick line   UPCOMING EVENTS | MEETINGS | FOLLOWUP  (from – to)
 *   second line  CO | BRANCH | STATUS | PERIOD | LOC | PAYMENT | ENQ DT | AM | SOURCE
 * They set the same column filters as the funnels in the table, so saved views and chips include
 * them. A box with a value is framed in the highlight colour. The whole section folds away.
 */

const QUICK: [string, string][] = [['upcoming', 'UPCOMING EVENTS'], ['meetings', 'MEETINGS'], ['followups', 'FOLLOWUP']];
const BOXES: [string, string][] = [
  ['co', 'CO'], ['branch', 'BRANCH'], ['status', 'STATUS'], ['event_date', 'PERIOD'], ['venue', 'LOC'], ['payment', 'PAYMENT'],
  ['inquiry_date', 'ENQ DT'], ['owner', 'AM'], ['source', 'SOURCE'],
];

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();

/** Y | M | D cells → a date: missing parts widen it to the whole year or month (start, or end for "to"). */
function toIso(parts: string[] | undefined, end: boolean) {
  const [y, m, d] = (parts ?? []).map((x) => (x ? Number(x) : 0));
  if (!y) return undefined;
  const mm = m || (end ? 12 : 1);
  const dd = d || (end ? lastDay(y, mm) : 1);
  return `${y}-${pad(mm)}-${pad(Math.min(dd, lastDay(y, mm)))}`;
}

/** One date as three number cells (Y | M | D, months as numbers) plus a calendar to pick it. */
function YmdCells({ value, onChange, label }: { value: string[] | undefined; onChange: (v: string[]) => void; label: string }) {
  const [y = '', m = '', d = ''] = value ?? [];
  const picker = useRef<HTMLInputElement>(null);
  const year = new Date().getFullYear();
  const set = (i: number, v: string) => { const next = [y, m, d]; next[i] = v; onChange(next); };
  return (
    <span className="ymd" role="group" aria-label={label}>
      <select value={y} onChange={(e) => set(0, e.target.value)} aria-label={`${label} Y`}>
        <option value="">Y</option>
        {Array.from({ length: 12 }, (_, i) => year + 2 - i).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <select value={m} onChange={(e) => set(1, e.target.value)} aria-label={`${label} M`}>
        <option value="">M</option>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <select value={d} onChange={(e) => set(2, e.target.value)} aria-label={`${label} D`}>
        <option value="">D</option>
        {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <button type="button" className="sm ghost ymd-cal" aria-label={t('Pick on a calendar')} onClick={() => picker.current?.showPicker?.()}>
        <CalendarDays className="ico" aria-hidden />
      </button>
      <input ref={picker} type="date" className="ymd-picker" tabIndex={-1} aria-hidden
        value={y && m && d ? `${y}-${pad(Number(m))}-${pad(Number(d))}` : ''}
        onChange={(e) => { const [py, pm, pd] = e.target.value.split('-'); onChange(e.target.value ? [py, String(Number(pm)), String(Number(pd))] : ['', '', '']); }} />
    </span>
  );
}

/** FROM – TO in Y | M | D cells; sets the column's range filter. */
export function DateRange({ column, label }: { column: Column<Booking, unknown>; label: string }) {
  const r = (column.getFilterValue() as Range | undefined) ?? {};
  const set = (from: string[] | undefined, to: string[] | undefined) => {
    const min = toIso(from, false);
    const max = toIso(to, true);
    column.setFilterValue(min || max ? { min, max, from, to } : undefined);
  };
  const on = column.getIsFiltered();
  return (
    <div className={`fbox fbox-range ${on ? 'on' : ''}`}>
      <span className="fbox-name">{label}</span>
      <span className="small muted">{t('From')}</span>
      <YmdCells label={`${label} ${t('From')}`} value={r.from ?? (r.min?.split('-').map((x) => String(Number(x))))} onChange={(v) => set(v, r.to)} />
      <span className="small muted">{t('To')}</span>
      <YmdCells label={`${label} ${t('To')}`} value={r.to ?? (r.max?.split('-').map((x) => String(Number(x))))} onChange={(v) => set(r.from, v)} />
      {on && <button type="button" className="sm ghost" aria-label={t('Clear {name}', { name: label })} onClick={() => column.setFilterValue(undefined)}><X className="ico" aria-hidden /></button>}
    </div>
  );
}

/** A box named like the Excel column; choosing a value filters on it. */
function PickBox({ column, label }: { column: Column<Booking, unknown>; label: string }) {
  const meta = metaOf(column);
  const picked = (column.getFilterValue() as string[] | undefined) ?? [];
  const facets = column.getFacetedUniqueValues();
  const keys = [...new Set([...[...facets.keys()].map((k) => String(k ?? '')), ...picked])].filter((k) => k !== '')
    .sort((a, b) => compareKeys(meta, a, b, showValue(meta, a), showValue(meta, b)));
  const value = picked.length === 1 ? picked[0] : picked.length > 1 ? '*' : '';
  return (
    <label className={`fbox ${picked.length ? 'on' : ''}`}>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => column.setFilterValue(e.target.value ? [e.target.value] : undefined)} aria-label={label}>
        <option value="">{label}</option>
        {value === '*' && <option value="*" disabled>{label}: {t('{n} values', { n: picked.length })}</option>}
        {keys.map((k) => <option key={k} value={k}>{showValue(meta, k)}</option>)}
      </select>
    </label>
  );
}

export function ContractFilters({ table, open, onToggle, active, children }: {
  table: Table<Booking>; open: boolean; onToggle: () => void; active: number; children?: React.ReactNode;
}) {
  const col = (id: string) => table.getAllLeafColumns().find((c) => c.id === id);
  return (
    <section className="filter-panel">
      <button type="button" className="filter-toggle" aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronDown className="ico" aria-hidden /> : <ChevronRight className="ico" aria-hidden />}
        <strong>FILTERS</strong>{active > 0 && <span className="filter-count">{active}</span>}
      </button>
      {children}
      {open && (
        <div className="filter-lines">
          <div className="filter-line">
            {QUICK.map(([id, label]) => { const c = col(id); return c && <DateRange key={id} column={c} label={label} />; })}
          </div>
          <div className="filter-line">
            {BOXES.map(([id, label]) => {
              const c = col(id);
              if (!c) return null;
              return metaOf(c).kind === 'date' ? <DateRange key={id} column={c} label={label} /> : <PickBox key={id} column={c} label={label} />;
            })}
          </div>
        </div>
      )}
    </section>
  );
}
