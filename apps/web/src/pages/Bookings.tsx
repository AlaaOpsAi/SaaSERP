import { Columns3, Save, Table2, Trash2, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, download, type Booking, type Conflict } from '../api';
import { useAuth, useHidden } from '../auth';
import { BookingForm, bookingPayload, clientPayload, type BookingFormValues } from '../components/BookingForm';
import {
  ColumnChooser, ColumnFilter, contractColumns, describeFilter, flexRender, type GridColumn, type GridState, metaOf, showValue,
  standardLayout, useContractTable,
} from '../components/ContractGrid';
import { ContractPivot, PIVOT_DIMS, type PivotConfig, buildPivot, pivotSheet, pivotValues } from '../components/ContractPivot';
import { confirmDiscard, ErrorNote, Modal, SkeletonRows } from '../components/ui';
import { FormActions } from '../components/FormActions';
import { money, monthNames, num, STATUS_LABEL, statusLabel } from '../format';
import { useLabel, useLookups, useSave, useUsers } from '../hooks';
import { lookupLabel, t } from '../i18n';

type Mode = 'list' | 'pivot';
interface Layout extends Omit<GridState, 'filters'> { mode: Mode; pivot: PivotConfig }
interface SavedView extends Layout { name: string; filters: GridState['filters'] }
interface Stored { layout?: Partial<Layout>; views?: SavedView[] }

const PIVOT_DEFAULT: PivotConfig = { rows: 'owner', cols: '', value: 'count' };
/** Filters the server applies (links from the dashboard use them), shown as chips. */
const SERVER_CHIPS = ['status', 'owner_id', 'source', 'month', 'lost_reason', 'event_type', 'business_unit_id', 'venue_id', 'from', 'to'];
const PAGE = 300;
const NEWEST = [{ id: 'inquiry_date', desc: true }];

export function Bookings() {
  const { can, me } = useAuth();
  const hidden = useHidden();
  const fin = !hidden('finance');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [naming, setNaming] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const { data: lookups } = useLookups();
  const { data: users } = useUsers();
  const eventLabel = useLabel('event_type');
  const sourceLabel = useLabel('source');

  const filter = (k: string) => params.get(k) ?? '';
  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const year = new Date().getFullYear();

  // The server picks the year and the person's contracts; the rest is filtered in the browser.
  const serverQuery = useMemo(() => {
    const q = new URLSearchParams(params);
    q.delete('sort');
    if (!q.get('year')) q.set('year', String(year));
    if (q.get('year') === 'all') q.delete('year');
    q.set('limit', '5000');
    return q.toString();
  }, [params, year]);
  const { data, isLoading, error } = useQuery({
    queryKey: ['bookings', serverQuery],
    queryFn: () => api<{ rows: Booking[]; totals: Record<string, number> }>(`/bookings?${serverQuery}`),
  });

  const [search, setSearch] = useState(filter('q'));
  useEffect(() => {
    const id = setTimeout(() => search !== filter('q') && setFilter('q', search), 350);
    return () => clearTimeout(id);
  });

  // Columns the person may see (hidden contract fields never show, not even as an option).
  const columns = useMemo<GridColumn[]>(
    () => contractColumns({ eventLabel, sourceLabel, fin }).filter((c) => !c.field || !hidden(c.field)),
    [lookups, fin, me?.hidden_fields],
  );
  const values = useMemo(() => pivotValues().filter((v) => !v.field || !hidden(v.field)), [me?.hidden_fields]);
  const dims = PIVOT_DIMS.map((id) => columns.find((c) => c.id === id)).filter(Boolean) as GridColumn[];

  // Layout and saved views: the person's own, kept with their preferences.
  const stored = useRef<Stored>((me?.preferences?.contract_list as Stored | undefined) ?? {});
  const initial = (): Layout & { filters: GridState['filters'] } => {
    const l = stored.current.layout ?? {};
    const sort = params.get('sort');
    return {
      ...standardLayout(columns), sorting: NEWEST, mode: 'list', pivot: PIVOT_DEFAULT, ...l, filters: [],
      ...(sort && { sorting: [{ id: sort.replace(/^-/, ''), desc: sort.startsWith('-') }] }),
    };
  };
  const [state, setState] = useState(initial);
  const [views, setViews] = useState<SavedView[]>(stored.current.views ?? []);
  const [viewName, setViewName] = useState('');
  const set = (s: Partial<typeof state>) => setState((prev) => ({ ...prev, ...s }));

  const persist = (layout: Layout, list: SavedView[]) => {
    const value: Stored = { layout, views: list };
    stored.current = value;
    if (me) me.preferences = { ...me.preferences, contract_list: value as Record<string, unknown> };
    api('/me/preferences', { method: 'PATCH', body: { contract_list: value } }).catch(() => undefined);
  };
  const { order, visible, sorting, mode, pivot } = state;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const id = setTimeout(() => persist({ order, visible, sorting, mode, pivot }, views), 800);
    return () => clearTimeout(id);
  }, [order, visible, sorting, mode, pivot]);

  const table = useContractTable(data?.rows ?? [], columns, state, set);
  useEffect(() => setShown(PAGE), [state.filters, serverQuery]);
  const filtered = table.getFilteredRowModel().rows.map((r) => r.original);
  const rows = table.getRowModel().rows;
  const leaf = table.getVisibleLeafColumns();

  const applyView = (name: string) => {
    setViewName(name);
    const v = views.find((x) => x.name === name);
    if (!v) { setState({ ...standardLayout(columns), sorting: NEWEST, mode: 'list', pivot: PIVOT_DEFAULT, filters: [] }); return; }
    const { name: _n, ...rest } = v;
    setState({ ...standardLayout(columns), ...rest });
  };
  const saveView = (name: string) => {
    const v: SavedView = { name, order, visible, sorting, mode, pivot, filters: state.filters };
    const list = [...views.filter((x) => x.name !== name), v].sort((a, b) => a.name.localeCompare(b.name));
    setViews(list); setViewName(name); persist({ order, visible, sorting, mode, pivot }, list);
  };
  const deleteView = () => {
    if (!confirm(t('Delete the view “{name}”?', { name: viewName }))) return;
    const list = views.filter((x) => x.name !== viewName);
    setViews(list); setViewName(''); persist({ order, visible, sorting, mode, pivot }, list);
  };

  const rowDim = dims.find((d) => d.id === pivot.rows) ?? dims[0];
  const colDim = dims.find((d) => d.id === pivot.cols && d.id !== rowDim?.id);
  const value = values.find((v) => v.id === pivot.value) ?? values[0];
  const openFromPivot = (f: Record<string, string>) => {
    const keep = state.filters.filter((x) => !(x.id in f));
    set({ mode: 'list', filters: [...keep, ...Object.entries(f).map(([id, v]) => ({ id, value: [v] }))] });
  };

  const exportView = () => {
    const title = `${t('Contracts')} ${filter('year') || year}`;
    if (mode === 'pivot' && rowDim && value) {
      const sheet = pivotSheet(buildPivot(filtered, rowDim, colDim, value), rowDim, value);
      return download('/reports/table.xlsx', `${title} pivot.xlsx`, { title: t('Pivot'), ...sheet });
    }
    const cols = leaf.map(metaOf);
    return download('/reports/table.xlsx', `${title}.xlsx`, {
      title: t('Contracts'),
      header: cols.map((c) => c.label),
      rows: rows.map((r) => cols.map((c) => {
        const v = c.get(r.original);
        return v === undefined ? null : c.kind === 'money' || c.kind === 'number' ? Number(v) : showValue(c, v);
      })),
    });
  };

  const userName = (id: string) => users?.find((u) => u.id === id)?.code ?? users?.find((u) => u.id === id)?.name ?? t('One account manager');
  const serverChip = (k: string) => {
    const v = filter(k);
    switch (k) {
      case 'status': return `${t('Status')}: ${v.split(',').map((s) => (s in STATUS_LABEL ? statusLabel(s as Booking['status']) : s)).join(', ')}`;
      case 'owner_id': return `${t('AM')}: ${userName(v)}`;
      case 'source': return `${t('Source')}: ${sourceLabel(v)}`;
      case 'month': return `${t('Month')}: ${monthNames()[Number(v) - 1]}`;
      case 'lost_reason': return `${t('Lost reason')}: ${lookupLabel(lookups?.lost_reason?.find((l) => l.code === v), v)}`;
      case 'event_type': return `${t('Event type')}: ${eventLabel(v)}`;
      case 'business_unit_id': return t('One business unit');
      case 'venue_id': return t('One venue');
      case 'from': return `${t('From')} ${v}`;
      default: return `${t('To')} ${v}`;
    }
  };
  const chips: { key: string; label: string; clear: () => void }[] = [
    ...SERVER_CHIPS.filter((k) => filter(k)).map((k) => ({ key: `s-${k}`, label: serverChip(k), clear: () => setFilter(k, '') })),
    ...state.filters.flatMap((f) => {
      const col = columns.find((c) => c.id === f.id);
      return col ? [{ key: `c-${f.id}`, label: describeFilter(col, f.value), clear: () => set({ filters: state.filters.filter((x) => x.id !== f.id) }) }] : [];
    }),
  ];
  const clearAll = () => {
    set({ filters: [] });
    const next = new URLSearchParams(params);
    for (const k of [...SERVER_CHIPS, 'followup_due', 'signed_missing', 'q']) next.delete(k);
    setSearch('');
    setParams(next, { replace: true });
  };

  const sum = (c: GridColumn) => filtered.reduce((n, b) => n + Number(c.get(b) ?? 0), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Contracts")}</h1>
          <p>{t("Every enquiry, from first contact to a paid event.")}</p>
        </div>
        <div className="row">
          {me?.rights.export && <button onClick={exportView}>{mode === 'pivot' ? t('Export pivot') : t('Export this view')}</button>}
          {me?.rights.export && mode === 'list' && <button className="ghost" onClick={() => download(`/reports/contracts.xlsx?year=${filter('year') || year}`, `contracts-${filter('year') || year}.xlsx`)}>{t("Full year workbook")}</button>}
          {can('sell') && <button className="primary" onClick={() => setCreating(true)}>{t("New contract")}</button>}
        </div>
      </div>

      <div className="filters">
        <input type="search" placeholder={t("Search no., name, client, phone…")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={filter('year') || String(year)} onChange={(e) => setFilter('year', e.target.value === String(year) ? '' : e.target.value)} aria-label={t("Year")}>
          {Array.from({ length: 6 }, (_, i) => year + 1 - i).map((y) => <option key={y}>{y}</option>)}
          <option value="all">{t("All years")}</option>
        </select>
        <label className="check"><input type="checkbox" checked={filter('followup_due') === 'true'} onChange={(e) => setFilter('followup_due', e.target.checked ? 'true' : '')} />{t("Follow-up due")}</label>
        <label className="check"><input type="checkbox" checked={filter('signed_missing') === 'true'} onChange={(e) => setFilter('signed_missing', e.target.checked ? 'true' : '')} />{t("Signed contract missing")}</label>
        <span className="grow" />
        <div className="segmented" role="group" aria-label={t('Show as')}>
          <button type="button" className={mode === 'list' ? 'on' : ''} aria-pressed={mode === 'list'} onClick={() => set({ mode: 'list' })}><Table2 className="ico" aria-hidden /> {t('List')}</button>
          <button type="button" className={mode === 'pivot' ? 'on' : ''} aria-pressed={mode === 'pivot'} onClick={() => set({ mode: 'pivot' })}><Columns3 className="ico" aria-hidden /> {t('Pivot')}</button>
        </div>
        {mode === 'list' && <button type="button" onClick={() => setChoosing(true)}><Columns3 className="ico" aria-hidden /> {t('Columns')}</button>}
        <select value={viewName} onChange={(e) => applyView(e.target.value)} aria-label={t('Saved views')}>
          <option value="">{views.length ? t('My views…') : t('Standard view')}</option>
          {views.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
        </select>
        <button type="button" onClick={() => setNaming(true)} title={t('Save these filters and columns as a view')}><Save className="ico" aria-hidden /> {t('Save view')}</button>
        {viewName && <button type="button" className="ghost" onClick={deleteView} aria-label={t('Delete this view')}><Trash2 className="ico" aria-hidden /></button>}
      </div>

      {mode === 'pivot' && rowDim && value && (
        <div className="filters pivot-setup">
          <label>{t('Rows')}
            <select value={rowDim.id} onChange={(e) => set({ pivot: { ...pivot, rows: e.target.value } })}>
              {dims.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </label>
          <label>{t('Columns')}
            <select value={colDim?.id ?? ''} onChange={(e) => set({ pivot: { ...pivot, cols: e.target.value } })}>
              <option value="">{t('None')}</option>
              {dims.filter((d) => d.id !== rowDim.id).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </label>
          <label>{t('Values')}
            <select value={value.id} onChange={(e) => set({ pivot: { ...pivot, value: e.target.value } })}>
              {values.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </label>
        </div>
      )}

      {chips.length > 0 && (
        <div className="row" style={{ marginBottom: 12 }}>
          {chips.map((c) => (
            <button key={c.key} className="sm chip" onClick={c.clear} aria-label={t('Remove filter {f}', { f: c.label })}>{c.label} <X className="ico" aria-hidden /></button>
          ))}
          <button className="sm ghost" onClick={clearAll}>{t('Clear all')}</button>
        </div>
      )}

      <ErrorNote error={error} />
      <div className="card flush">
        {mode === 'pivot' && rowDim && value
          ? (isLoading ? <div className="table-wrap"><table><tbody><SkeletonRows cols={6} /></tbody></table></div>
            : <ContractPivot rows={filtered} rowDim={rowDim} colDim={colDim} value={value} onOpen={openFromPivot} />)
          : (
          <div className="table-wrap">
            <table className="grid">
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => {
                      const m = metaOf(h.column);
                      const sorted = h.column.getIsSorted();
                      return (
                        <th key={h.id} className={m.kind === 'money' || m.kind === 'number' ? 'num' : ''}
                          aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : undefined}>
                          <span className="grid-th">
                            <button type="button" className="th-sort" onClick={h.column.getToggleSortingHandler()}>
                              {flexRender(h.column.columnDef.header, h.getContext())}{sorted ? (sorted === 'asc' ? ' ↑' : ' ↓') : ''}
                            </button>
                            <ColumnFilter column={h.column} />
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {isLoading && <SkeletonRows cols={leaf.length || 8} />}
                {data && rows.length === 0 && <tr><td colSpan={leaf.length} className="empty">{t("No bookings match these filters.")}</td></tr>}
                {rows.slice(0, shown).map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => navigate(`/bookings/${r.original.id}`)}>
                    {r.getVisibleCells().map((cell) => {
                      const k = metaOf(cell.column).kind;
                      return <td key={cell.id} className={k === 'money' || k === 'number' ? 'num' : ''}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>;
                    })}
                  </tr>
                ))}
                {rows.length > shown && (
                  <tr><td colSpan={leaf.length} className="empty">
                    <button type="button" onClick={() => setShown((n) => n + PAGE * 3)}>{t('Show {n} more', { n: Math.min(PAGE * 3, rows.length - shown) })}</button>
                  </td></tr>
                )}
              </tbody>
              {data && rows.length > 0 && (
                <tfoot>
                  <tr>
                    {leaf.map((c, i) => {
                      const m = metaOf(c);
                      if (i === 0) return <td key={c.id}>{t('{n} of {total}', { n: num(rows.length), total: num(data.rows.length) })}</td>;
                      return <td key={c.id} className="num">{m.kind === 'money' ? money(sum(m)) : m.id === 'pax' ? num(sum(m)) : ''}</td>;
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>
      {data && data.rows.length >= 5000 && <p className="small muted">{t('Showing the first 5,000 contracts: pick a year to see them all.')}</p>}

      {choosing && (
        <Modal title={t('Columns')} onClose={() => setChoosing(false)} footer={<button className="primary" onClick={() => setChoosing(false)}>{t('Done')}</button>}>
          <ColumnChooser columns={columns} state={state} set={set} onReset={() => set(standardLayout(columns))} />
        </Modal>
      )}
      {naming && <NameView initial={viewName} taken={views.map((v) => v.name)} onClose={() => setNaming(false)} onSave={(n) => { saveView(n); setNaming(false); }} />}
      {creating && <NewBooking onClose={() => setCreating(false)} onCreated={(id) => navigate(`/bookings/${id}`)} />}
    </>
  );
}

function NameView({ initial, taken, onClose, onSave }: { initial: string; taken: string[]; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(initial);
  const clean = name.trim();
  return (
    <Modal title={t('Save view')} onClose={onClose}
      footer={<><button onClick={onClose}>{t('Cancel')}</button><button className="primary" form="name-view" disabled={!clean}>{t('Save')}</button></>}>
      <form id="name-view" className="stack" onSubmit={(e) => { e.preventDefault(); if (clean) onSave(clean.slice(0, 60)); }}>
        <label>{t('Name')}<input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} placeholder={t('e.g. My open enquiries')} /></label>
        <p className="small secondary">
          {taken.includes(clean) ? t('This replaces your view with the same name.') : t('Keeps the filters, columns, sorting and pivot. Only you see your views.')}
        </p>
      </form>
    </Modal>
  );
}

function NewBooking({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { can } = useAuth();
  const [pending, setPending] = useState<BookingFormValues | null>(null);
  const [dirty, setDirty] = useState(false);
  const save = useSave((v: { values: BookingFormValues; force?: boolean }) =>
    api<Booking>('/bookings', { body: { ...bookingPayload(v.values), contact: clientPayload(v.values.contact), force: v.force } }),
    [['bookings'], ['dashboard']]);
  const conflicts: Conflict[] | undefined = (save.error as { details?: { conflicts?: Conflict[] } } | null)?.details?.conflicts;

  const submit = (values: BookingFormValues, force = false) => {
    setPending(values);
    save.mutate({ values, force }, { onSuccess: (b) => onCreated(b.id) });
  };

  return (
    <Modal
      title={t("New contract")}
      onClose={onClose}
      dirty={dirty}
      footer={<FormActions formId="new-booking" saving={save.isPending} onCancel={confirmDiscard(dirty, onClose)} saveLabel={t("Create contract")}
        remove={conflicts && can('manage') && pending && (
          <button type="button" className="danger" onClick={() => submit(pending, true)}>{t("Override & book")}</button>
        )} />}
    >
      <div className="stack">
        <ErrorNote error={save.error} />
        {conflicts && (
          <div className="small secondary">{t("Clashes with")}{' '}{conflicts.map((c) => c.booking_id ? `${c.booking_no} (${c.booking_name}, ${statusLabel(c.status)})` : `${c.booking_name} (${statusLabel(c.status)})`).join(', ')}.
          </div>
        )}
        <BookingForm id="new-booking" isNew onDirty={setDirty} onSubmit={(v) => submit(v)} />
      </div>
    </Modal>
  );
}
