import {
  type Column, type ColumnDef, type ColumnFiltersState, type FilterFn, type SortingState, type VisibilityState,
  flexRender, getCoreRowModel, getFacetedRowModel, getFacetedUniqueValues, getFilteredRowModel, getSortedRowModel, useReactTable,
} from '@tanstack/react-table';
import { AlertTriangle, ArrowDown, ArrowDownAZ, ArrowUp, ArrowUpAZ, Filter, X } from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Booking, ContractField } from '../api';
import { money, num } from '../format';
import { t } from '../i18n';
import { StatusBadge } from './ui';

/**
 * The contract list as an Excel-like grid (customer comment 8): a filter on every column
 * (tick-list or from / to), sorting, a column chooser and a pivot. Everything happens in the
 * browser over the contracts the server sent, so it only ever shows what the person may see.
 * Column names and the standard columns follow the SYSTEM sheet of the daily report (comment 9).
 */

export type Kind = 'text' | 'number' | 'money' | 'date' | 'dates';
type Value = string | number | string[] | undefined;

export interface GridColumn {
  id: string;
  label: string;
  kind: Kind;
  /** The contract field that hides this column (Admin → Contract fields). */
  field?: ContractField;
  get: (b: Booking) => Value;
  /** How a value reads in the filter list and the pivot (defaults to the value itself). */
  fmt?: (v: Value) => string;
  cell?: (b: Booking) => ReactNode;
  /** Shown before the person picks their own columns. */
  standard?: boolean;
  /** Used only by the filter boxes, never shown as a column. */
  internal?: boolean;
}

const blank = (v: Value) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
const orUndef = (v: string | number | null | undefined): Value => (v === null || v === '' ? undefined : v);

/** Year-month of the event (or the enquiry when there is no event date yet), e.g. 2026-03: months as numbers. */
const monthKey = (b: Booking) => (b.event_date ?? b.inquiry_date)?.slice(0, 7);
/** Dates as numbers, year first like the Y | M | D columns of the daily report: 2026-12-13. */
export const ymd = (v: string | null | undefined) => (v ? v.slice(0, 10) : '');
const localDay = (iso: string | null) => {
  if (!iso) return undefined;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** DETAILS: nationality - client name - phone, then the description (CLIENT when there is no name). */
function details(b: Booking) {
  const name = [b.contact_first_name, b.contact_family_name].filter(Boolean).join(' ') || b.contact_name || b.account_name || t('CLIENT');
  return { line: [b.contact_nationality, name, b.contact_phone].filter(Boolean).join(' - '), text: b.description ?? '' };
}

export function contractColumns(o: { eventLabel: (c: string | null) => string; sourceLabel: (c: string | null) => string; fin: boolean }): GridColumn[] {
  const moneyCol = (id: string, label: string, field: ContractField, get: (b: Booking) => number | null, standard = false): GridColumn =>
    ({ id, label, kind: 'money', field, get: (b) => orUndef(get(b)), standard });
  const dateCol = (id: string, label: string, get: (b: Booking) => string | null | undefined, standard = false): GridColumn =>
    ({ id, label, kind: 'date', get: (b) => orUndef(ymd(get(b))), cell: (b) => ymd(get(b)) || '—', standard });
  return [
    { id: 'booking_no', label: 'CONTRACT ID', kind: 'text', get: (b) => b.booking_no, cell: (b) => <strong>{b.booking_no}</strong>, standard: true },
    { id: 'co', label: 'CO', kind: 'text', field: 'business_unit', get: (b) => orUndef(b.business_unit_code), standard: true },
    { id: 'branch', label: 'BRANCH', kind: 'text', field: 'branch', get: (b) => orUndef(b.branch), standard: true },
    {
      id: 'status', label: 'STATUS', kind: 'text', get: (b) => b.status, standard: true,
      cell: (b) => <><StatusBadge status={b.status} />{b.signed_missing && <div><span className="flag" title={t('Signed contract missing')}><AlertTriangle className="ico" aria-hidden /> {t('No signed copy')}</span></div>}</>,
    },
    dateCol('event_date', 'EVENT Y | M | D', (b) => b.event_date, true),
    { id: 'year', label: 'Y', kind: 'text', get: (b) => monthKey(b)?.slice(0, 4) },
    { id: 'month', label: 'Y | M', kind: 'text', get: (b) => monthKey(b) },
    { id: 'venue', label: 'HOTEL LOC', kind: 'text', get: (b) => orUndef(b.venue_name), standard: true },
    { id: 'space', label: 'HALL AREA', kind: 'text', get: (b) => orUndef(b.space_name ?? b.hall_text), standard: true },
    { id: 'pax', label: 'PAX UNITS', kind: 'number', field: 'pax', get: (b) => orUndef(b.pax), standard: true },
    { id: 'rate', label: 'RATE PP | PU', kind: 'money', field: 'rate', get: (b) => orUndef(b.rate), standard: true },
    { id: 'term_days', label: 'TERM DAYS RN', kind: 'number', field: 'rate', get: (b) => orUndef(b.term_days), standard: true },
    moneyCol('contract_value', 'TOTAL CONTRACT VALUE', 'contract_value', (b) => b.contract_value, true),
    moneyCol('paid', 'MONEY RECEIVED DP', 'money_received', (b) => b.paid, true),
    moneyCol('to_collect', 'CASH TO COLLECT', 'contract_value', (b) => b.diff_ctrl, true),
    { id: 'payment', label: 'PAYMENT', kind: 'text', field: 'money_received', get: (b) => orUndef(b.payment), standard: true },
    { id: 'source', label: 'SOURCE', kind: 'text', field: 'source', get: (b) => orUndef(b.source), standard: true },
    { id: 'owner', label: 'AM', kind: 'text', field: 'owner', get: (b) => orUndef(b.owner_code ?? b.owner_name), standard: true },
    {
      id: 'details', label: 'DETAILS', kind: 'text', standard: true,
      get: (b) => { const d = details(b); return `${d.line} ${d.text}`.trim(); },
      cell: (b) => { const d = details(b); return <div className="details-cell">{d.line}{d.text && <div className="small secondary">{d.text}</div>}</div>; },
    },
    dateCol('inquiry_date', 'ENQUIRY DATE', (b) => b.inquiry_date, true),
    dateCol('last_followup', 'LAST FOLLOWUP', (b) => localDay(b.last_followup_at) ?? b.last_followup_date, true),
    { id: 'followup_text', label: 'FOLLOWUP CLIENT FEEDBACK', kind: 'text', get: (b) => orUndef(b.last_followup_text), standard: true },
    dateCol('next_meeting', 'NEXT MEETING', (b) => localDay(b.next_meeting_at), true),
    { id: 'event_type', label: 'CONTRACT TYPE', kind: 'text', field: 'event_type', get: (b) => orUndef(b.event_type), fmt: (v) => (blank(v) ? '' : o.eventLabel(String(v))) },
    { id: 'nationality', label: 'COUNTRY NATIONALITY', kind: 'text', get: (b) => orUndef(b.contact_nationality ?? null) },
    { id: 'client', label: 'CLIENT', kind: 'text', get: (b) => orUndef(b.contact_name ?? b.account_name) },
    { id: 'phone', label: 'CLIENT PHONE', kind: 'text', get: (b) => orUndef(b.contact_phone) },
    { id: 'email', label: 'CLIENT EMAIL', kind: 'text', get: (b) => orUndef(b.contact_email) },
    { id: 'name', label: 'CONTRACT NAME', kind: 'text', get: (b) => b.name },
    { id: 'lost_reason', label: 'LOST REASON', kind: 'text', get: (b) => orUndef(b.lost_reason ?? b.cancel_reason) },
    dateCol('decision_due_date', 'DECISION DUE', (b) => b.decision_due_date),
    dateCol('fully_paid_date', 'FULLY PAID', (b) => b.fully_paid_date),
    moneyCol('revenue', 'REV', 'finance', (b) => b.revenue),
    moneyCol('cost', 'COST', 'finance', (b) => b.cost),
    moneyCol('gross_margin', 'GROSS MARGIN', 'finance', (b) => b.gross_margin),
    moneyCol('net_profit', 'NET PROFIT', 'finance', (b) => b.net_profit),
    moneyCol('outstanding', 'CLIENT OUTSTAND.', 'finance', (b) => b.outstanding),
    { id: 'aging_days', label: 'AGING DAYS', kind: 'number', field: 'finance', get: (b) => orUndef(b.aging_days) },
  ];
}

/** The text shown for a value: in cells without their own look, in filter lists, pivots and exports. */
export function showValue(c: GridColumn, v: Value): string {
  if (blank(v)) return '';
  if (c.fmt) return c.fmt(v);
  if (c.kind === 'money') return money(v as number);
  if (c.kind === 'number') return num(v as number);
  if (c.kind === 'date') return ymd(String(v));
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

/** Order of values in filter lists and pivots: statuses in workflow order, months and years in time order, the rest A → Z. */
const STATUS_ORDER = ['ENQ', 'TEN', 'DEF', 'LOS', 'CXL'];
export function compareKeys(c: GridColumn, a: string, b: string, aLabel: string, bLabel: string) {
  if ((a === '') !== (b === '')) return a === '' ? 1 : -1;
  if (c.id === 'status') return STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b);
  if (c.id === 'month' || c.id === 'year') return a.localeCompare(b);
  return aLabel.localeCompare(bLabel);
}

export type Range = { min?: string; max?: string; /** The Y | M | D cells as typed, for the date boxes. */ from?: string[]; to?: string[] };

const inList: FilterFn<Booking> = (row, id, picked: string[]) => picked.includes(String(row.getValue(id) ?? ''));
inList.autoRemove = (v) => !Array.isArray(v) || v.length === 0;
const inRange: FilterFn<Booking> = (row, id, r: Range) => {
  const v = row.getValue<Value>(id);
  if (blank(v)) return false;
  // Numbers compare as numbers, dates as yyyy-mm-dd text.
  const over = (x: string) => (typeof v === 'number' ? v >= Number(x) : String(v) >= x);
  const under = (x: string) => (typeof v === 'number' ? v <= Number(x) : String(v).slice(0, 10) <= x);
  return (!r.min || over(r.min)) && (!r.max || under(r.max));
};
inRange.autoRemove = (v: Range | undefined) => !v || ((v.min ?? '') === '' && (v.max ?? '') === '');
/** A list of dates (meetings, follow-ups): any of them in the range. */
const anyInRange: FilterFn<Booking> = (row, id, r: Range) =>
  (row.getValue<string[]>(id) ?? []).some((d) => (!r.min || d >= r.min) && (!r.max || d <= r.max));
anyInRange.autoRemove = inRange.autoRemove;

export interface GridState {
  order: string[];
  visible: VisibilityState;
  sorting: SortingState;
  filters: ColumnFiltersState;
  /** Free-text search over every column, shown or not. */
  search?: string;
}

/**
 * Free-text search: each word typed must appear somewhere in the contract, in any column
 * (shown or hidden), as the list displays it: "jou def radisson 2026-12" narrows step by step.
 */
function searchText(columns: GridColumn[]) {
  const cache = new WeakMap<Booking, string>();
  return (b: Booking) => {
    let text = cache.get(b);
    if (text === undefined) {
      text = columns.filter((c) => c.kind !== 'dates').map((c) => {
        const v = c.get(b);
        return `${v ?? ''} ${showValue(c, v)}`;
      }).join(' ').toLowerCase();
      cache.set(b, text);
    }
    return text;
  };
}

export function useContractTable(rows: Booking[], columns: GridColumn[], state: GridState, set: (s: Partial<GridState>) => void) {
  const text = useMemo(() => searchText(columns), [columns]);
  const globalFilterFn: FilterFn<Booking> = (row, _id, q: string) => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const all = text(row.original);
    return words.every((w) => all.includes(w));
  };
  const defs = useMemo<ColumnDef<Booking, Value>[]>(() => columns.map((c) => ({
    id: c.id,
    accessorFn: c.get,
    header: c.label,
    meta: c,
    filterFn: c.kind === 'text' ? inList : c.kind === 'dates' ? anyInRange : inRange,
    sortUndefined: 'last',
    sortingFn: c.kind === 'text' ? 'alphanumeric' : 'basic',
    cell: (ctx) => (c.cell ? c.cell(ctx.row.original) : showValue(c, ctx.getValue()) || '—'),
  })), [columns]);

  return useReactTable({
    data: rows,
    columns: defs,
    state: { columnOrder: state.order, columnVisibility: state.visible, sorting: state.sorting, columnFilters: state.filters, globalFilter: state.search ?? '' },
    globalFilterFn,
    getColumnCanGlobalFilter: () => true,
    onColumnOrderChange: (u) => set({ order: typeof u === 'function' ? u(state.order) : u }),
    onColumnVisibilityChange: (u) => set({ visible: typeof u === 'function' ? u(state.visible) : u }),
    onSortingChange: (u) => set({ sorting: typeof u === 'function' ? u(state.sorting) : u }),
    onColumnFiltersChange: (u) => set({ filters: typeof u === 'function' ? u(state.filters) : u }),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getRowId: (b) => b.id,
  });
}

export const metaOf = (c: Column<Booking, unknown>) => c.columnDef.meta as GridColumn;

/** Words for an active filter, for the chips above the table. */
export function describeFilter(c: GridColumn, v: unknown): string {
  if (Array.isArray(v)) {
    const names = v.map((x) => showValue(c, x === '' ? undefined : x) || t('(blank)'));
    return `${c.label}: ${names.length > 3 ? t('{n} values', { n: names.length }) : names.join(', ')}`;
  }
  const r = v as Range;
  const f = (x?: string) => (x ? (c.kind === 'date' || c.kind === 'dates' ? x : showValue(c, Number(x))) : '');
  if (r.min && r.max) return `${c.label}: ${f(r.min)} – ${f(r.max)}`;
  return r.min ? `${c.label} ≥ ${f(r.min)}` : `${c.label} ≤ ${f(r.max)}`;
}

/** The Excel-style drop-down under a column header: sort, then a tick-list or from / to. */
export function ColumnFilter({ column }: { column: Column<Booking, unknown> }) {
  const meta = metaOf(column);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [at, setAt] = useState({ top: 0, left: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const active = column.getIsFiltered();

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const width = 280;
    setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const scroll = (e: Event) => { if (!pop.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', scroll, true); };
  }, [open]);

  return (
    <>
      <button ref={btn} type="button" className={`sm ghost col-filter ${active ? 'on' : ''}`} aria-label={t('Filter {col}', { col: meta.label })}
        aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
        <Filter className="ico" aria-hidden />
      </button>
      {open && createPortal(
        <div ref={pop} className="filter-pop" role="dialog" aria-label={t('Filter {col}', { col: meta.label })} style={at}>
          <div className="row">
            <button type="button" className="sm grow" onClick={() => column.toggleSorting(false)}>
              <ArrowDownAZ className="ico" aria-hidden /> {meta.kind === 'text' ? t('A → Z') : t('Smallest first')}
            </button>
            <button type="button" className="sm grow" onClick={() => column.toggleSorting(true)}>
              <ArrowUpAZ className="ico" aria-hidden /> {meta.kind === 'text' ? t('Z → A') : t('Largest first')}
            </button>
          </div>
          {meta.kind === 'text'
            ? <ValueList column={column} meta={meta} search={search} setSearch={setSearch} />
            : <RangeFilter column={column} meta={meta} />}
          <div className="spread">
            <button type="button" className="sm ghost" disabled={!active} onClick={() => column.setFilterValue(undefined)}>{t('Clear filter')}</button>
            <button type="button" className="sm" onClick={() => setOpen(false)}>{t('Done')}</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function ValueList({ column, meta, search, setSearch }: { column: Column<Booking, unknown>; meta: GridColumn; search: string; setSearch: (s: string) => void }) {
  const facets = column.getFacetedUniqueValues();
  // Every value the other filters leave, plus any already picked, A → Z as shown.
  const values = useMemo(() => {
    const keys = new Set<string>([...facets.keys()].map((k) => String(k ?? '')));
    for (const v of (column.getFilterValue() as string[] | undefined) ?? []) keys.add(v);
    return [...keys].map((k) => ({ key: k, label: showValue(meta, k === '' ? undefined : k) || t('(blank)'), count: facets.get(k === '' ? undefined : k) ?? 0 }))
      .sort((a, b) => compareKeys(meta, a.key, b.key, a.label, b.label));
  }, [facets, column, meta]);
  const picked = column.getFilterValue() as string[] | undefined;
  const isOn = (k: string) => !picked || picked.includes(k);
  const shown = values.filter((v) => v.label.toLowerCase().includes(search.toLowerCase()));
  const setPicked = (next: string[]) => column.setFilterValue(next.length === values.length ? undefined : next.length ? next : ['\u0000none']);
  const toggle = (k: string) => setPicked(isOn(k) ? values.map((v) => v.key).filter((x) => isOn(x) && x !== k) : [...values.map((v) => v.key).filter(isOn), k]);
  const allShown = shown.every((v) => isOn(v.key));

  return (
    <>
      <input type="search" placeholder={t('Search…')} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
      <label className="check facet-all">
        <input type="checkbox" checked={allShown} onChange={() => {
          const keys = new Set(shown.map((v) => v.key));
          setPicked(allShown ? values.map((v) => v.key).filter((k) => isOn(k) && !keys.has(k)) : [...new Set([...values.map((v) => v.key).filter(isOn), ...keys])]);
        }} />
        {search ? t('All matching') : t('Select all')}
      </label>
      <div className="facet-list">
        {shown.slice(0, 400).map((v) => (
          <label key={v.key} className="check">
            <input type="checkbox" checked={isOn(v.key)} onChange={() => toggle(v.key)} />
            <span className="grow">{v.label}</span><span className="small muted">{v.count}</span>
          </label>
        ))}
        {shown.length === 0 && <div className="small muted">{t('No values')}</div>}
        {shown.length > 400 && <div className="small muted">{t('Type to find more…')}</div>}
      </div>
    </>
  );
}

function RangeFilter({ column, meta }: { column: Column<Booking, unknown>; meta: GridColumn }) {
  const r = (column.getFilterValue() as Range | undefined) ?? {};
  const type = meta.kind === 'date' ? 'date' : 'number';
  const set = (k: keyof Range, v: string) => column.setFilterValue({ ...r, [k]: v });
  return (
    <div className="range-filter">
      <label>{t('From')}<input type={type} value={r.min ?? ''} onChange={(e) => set('min', e.target.value)} autoFocus /></label>
      <label>{t('To')}<input type={type} value={r.max ?? ''} onChange={(e) => set('max', e.target.value)} /></label>
    </div>
  );
}

/** Show / hide and reorder the columns. */
export function ColumnChooser({ columns, state, set, onReset }: { columns: GridColumn[]; state: GridState; set: (s: Partial<GridState>) => void; onReset: () => void }) {
  columns = columns.filter((c) => !c.internal);
  const byId = new Map(columns.map((c) => [c.id, c]));
  const order = [...state.order.filter((id) => byId.has(id)), ...columns.map((c) => c.id).filter((id) => !state.order.includes(id))];
  const move = (i: number, d: number) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    set({ order: next });
  };
  return (
    <div className="stack">
      <p className="small secondary">{t('Tick the columns to show; the arrows change their order. Your layout is kept for next time.')}</p>
      <div className="chooser-list">
        {order.map((id, i) => (
          <div key={id} className="chooser-row">
            <label className="check grow">
              <input type="checkbox" checked={state.visible[id] !== false} onChange={(e) => set({ visible: { ...state.visible, [id]: e.target.checked } })} />
              {byId.get(id)!.label}
            </label>
            <button type="button" className="sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('Move up')}><ArrowUp className="ico" aria-hidden /></button>
            <button type="button" className="sm ghost" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={t('Move down')}><ArrowDown className="ico" aria-hidden /></button>
          </div>
        ))}
      </div>
      <div><button type="button" className="sm ghost" onClick={onReset}><X className="ico" aria-hidden /> {t('Back to the standard columns')}</button></div>
    </div>
  );
}

/** Columns shown before the person chooses: the standard set, in the standard order. */
export function standardLayout(columns: GridColumn[]): Pick<GridState, 'order' | 'visible'> {
  return { order: columns.map((c) => c.id), visible: Object.fromEntries(columns.map((c) => [c.id, !!c.standard && !c.internal])) };
}

export { flexRender };
