import {
  type Column, type ColumnDef, type ColumnFiltersState, type FilterFn, type SortingState, type VisibilityState,
  flexRender, getCoreRowModel, getFacetedRowModel, getFacetedUniqueValues, getFilteredRowModel, getSortedRowModel, useReactTable,
} from '@tanstack/react-table';
import { AlertTriangle, ArrowDown, ArrowDownAZ, ArrowUp, ArrowUpAZ, Filter, X } from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Booking, ContractField } from '../api';
import { date, money, monthNames, num, statusLabel } from '../format';
import { t } from '../i18n';
import { StatusBadge } from './ui';

/**
 * The contract list as an Excel-like grid (customer comment 8): a filter on every column
 * (tick-list or from / to), sorting, a column chooser and a pivot. Everything happens in the
 * browser over the contracts the server sent, so it only ever shows what the person may see.
 */

export type Kind = 'text' | 'number' | 'money' | 'date';
type Value = string | number | undefined;

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
}

const blank = (v: Value) => v === undefined || v === null || v === '';
const orUndef = (v: string | number | null | undefined): Value => (v === null || v === '' ? undefined : v);

/** Year-month of the event (or the enquiry when there is no event date yet), e.g. 2026-03. */
const monthKey = (b: Booking) => (b.event_date ?? b.inquiry_date)?.slice(0, 7);
const monthText = (v: Value) => {
  if (blank(v)) return '';
  const [y, m] = String(v).split('-');
  return `${monthNames()[Number(m) - 1]} ${y}`;
};

export function contractColumns(o: { eventLabel: (c: string | null) => string; sourceLabel: (c: string | null) => string; fin: boolean }): GridColumn[] {
  const moneyCol = (id: string, label: string, field: ContractField, get: (b: Booking) => number | null, standard = false): GridColumn =>
    ({ id, label, kind: 'money', field, get: (b) => orUndef(get(b)), standard });
  return [
    { id: 'booking_no', label: t('No.'), kind: 'text', get: (b) => b.booking_no, cell: (b) => <strong>{b.booking_no}</strong>, standard: true },
    {
      id: 'name', label: t('Booking / client'), kind: 'text', get: (b) => b.name, standard: true,
      cell: (b) => <>{b.name}<div className="small secondary">{[b.contact_name, b.contact_phone].filter(Boolean).join(' · ')}</div></>,
    },
    { id: 'client', label: t('Client'), kind: 'text', get: (b) => orUndef(b.contact_name ?? b.account_name) },
    { id: 'phone', label: t('Phone'), kind: 'text', get: (b) => orUndef(b.contact_phone) },
    {
      id: 'status', label: t('Status'), kind: 'text', get: (b) => b.status, fmt: (v) => (blank(v) ? '' : statusLabel(v as Booking['status'])), standard: true,
      cell: (b) => <><StatusBadge status={b.status} />{b.signed_missing && <div><span className="flag" title={t('Signed contract missing')}><AlertTriangle className="ico" aria-hidden /> {t('Not signed')}</span></div>}</>,
    },
    {
      id: 'event_date', label: t('Event date'), kind: 'date', get: (b) => orUndef(b.event_date), standard: true,
      cell: (b) => <>{date(b.event_date)}<div className="small secondary">{o.eventLabel(b.event_type)}</div></>,
    },
    { id: 'month', label: t('Month'), kind: 'text', get: (b) => monthKey(b), fmt: monthText },
    { id: 'year', label: t('Year'), kind: 'text', get: (b) => monthKey(b)?.slice(0, 4) },
    { id: 'event_type', label: t('Event type'), kind: 'text', field: 'event_type', get: (b) => orUndef(b.event_type), fmt: (v) => (blank(v) ? '' : o.eventLabel(String(v))) },
    {
      id: 'venue', label: t('Venue'), kind: 'text', get: (b) => orUndef(b.venue_name), standard: true,
      cell: (b) => <>{b.venue_name ?? '—'}<div className="small secondary">{b.space_name ?? b.hall_text ?? ''}</div></>,
    },
    { id: 'space', label: t('Hall'), kind: 'text', get: (b) => orUndef(b.space_name ?? b.hall_text) },
    { id: 'pax', label: t('Pax'), kind: 'number', field: 'pax', get: (b) => orUndef(b.pax), standard: true },
    { id: 'owner', label: t('AM'), kind: 'text', field: 'owner', get: (b) => orUndef(b.owner_code ?? b.owner_name), standard: true },
    { id: 'source', label: t('Source'), kind: 'text', field: 'source', get: (b) => orUndef(b.source), fmt: (v) => (blank(v) ? '' : o.sourceLabel(String(v))) },
    { id: 'business_unit', label: t('Business unit'), kind: 'text', field: 'business_unit', get: (b) => orUndef(b.business_unit_code) },
    { id: 'branch', label: t('Branch'), kind: 'text', field: 'branch', get: (b) => orUndef(b.branch) },
    { id: 'inquiry_date', label: t('Enquiry date'), kind: 'date', get: (b) => orUndef(b.inquiry_date) },
    { id: 'decision_due_date', label: t('Decision due'), kind: 'date', get: (b) => orUndef(b.decision_due_date) },
    { id: 'lost_reason', label: t('Lost reason'), kind: 'text', get: (b) => orUndef(b.lost_reason ?? b.cancel_reason) },
    moneyCol('contract_value', t('Contract value'), 'contract_value', (b) => b.contract_value, !o.fin),
    moneyCol('paid', t('Received'), 'money_received', (b) => b.paid, !o.fin),
    moneyCol('diff_ctrl', t('Difference'), 'contract_value', (b) => b.diff_ctrl, !o.fin),
    moneyCol('revenue', t('Revenue'), 'finance', (b) => b.revenue, o.fin),
    moneyCol('gross_margin', t('Margin'), 'finance', (b) => b.gross_margin, o.fin),
    moneyCol('net_profit', t('Net profit'), 'finance', (b) => b.net_profit),
    moneyCol('outstanding', t('Outstanding'), 'finance', (b) => b.outstanding, o.fin),
    { id: 'aging_days', label: t('Days outstanding'), kind: 'number', field: 'finance', get: (b) => orUndef(b.aging_days) },
    {
      id: 'next_followup_date', label: t('Next follow-up'), kind: 'date', standard: true,
      get: (b) => (b.status === 'INQ' || b.status === 'TEN' ? orUndef(b.next_followup_date) : undefined),
    },
    { id: 'signed_missing', label: t('Signed contract missing'), kind: 'text', get: (b) => (b.signed_missing ? t('Yes') : t('No')) },
  ];
}

/** The text shown for a value: in cells without their own look, in filter lists, pivots and exports. */
export function showValue(c: GridColumn, v: Value): string {
  if (blank(v)) return '';
  if (c.fmt) return c.fmt(v);
  if (c.kind === 'money') return money(v as number);
  if (c.kind === 'number') return num(v as number);
  if (c.kind === 'date') return date(String(v));
  return String(v);
}

/** Order of values in filter lists and pivots: statuses in workflow order, months and years in time order, the rest A → Z. */
const STATUS_ORDER = ['INQ', 'TEN', 'DEF', 'ACT', 'LOS', 'CXL'];
export function compareKeys(c: GridColumn, a: string, b: string, aLabel: string, bLabel: string) {
  if ((a === '') !== (b === '')) return a === '' ? 1 : -1;
  if (c.id === 'status') return STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b);
  if (c.id === 'month' || c.id === 'year') return a.localeCompare(b);
  return aLabel.localeCompare(bLabel);
}

export type Range = { min?: string; max?: string };

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

export interface GridState {
  order: string[];
  visible: VisibilityState;
  sorting: SortingState;
  filters: ColumnFiltersState;
}

export function useContractTable(rows: Booking[], columns: GridColumn[], state: GridState, set: (s: Partial<GridState>) => void) {
  const defs = useMemo<ColumnDef<Booking, Value>[]>(() => columns.map((c) => ({
    id: c.id,
    accessorFn: c.get,
    header: c.label,
    meta: c,
    filterFn: c.kind === 'text' ? inList : inRange,
    sortUndefined: 'last',
    sortingFn: c.kind === 'text' ? 'alphanumeric' : 'basic',
    cell: (ctx) => (c.cell ? c.cell(ctx.row.original) : showValue(c, ctx.getValue()) || '—'),
  })), [columns]);

  return useReactTable({
    data: rows,
    columns: defs,
    state: { columnOrder: state.order, columnVisibility: state.visible, sorting: state.sorting, columnFilters: state.filters },
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
  const f = (x?: string) => (x ? showValue(c, c.kind === 'date' ? x : Number(x)) : '');
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
  return { order: columns.map((c) => c.id), visible: Object.fromEntries(columns.map((c) => [c.id, !!c.standard])) };
}

export { flexRender };
