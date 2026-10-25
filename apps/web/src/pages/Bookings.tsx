import { ChevronDown, Columns3, Save, Trash2, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, download, type Booking, type Conflict, type Me } from '../api';
import { useAuth, useHidden } from '../auth';
import { BookingForm, bookingPayload, clientPayload, type BookingFormValues } from '../components/BookingForm';
import {
  ColumnChooser, ColumnFilter, contractColumns, describeFilter, flexRender, type GridColumn, type GridState, metaOf, showValue,
  standardLayout, useContractTable,
} from '../components/ContractGrid';
import { confirmDiscard, ErrorNote, Modal, SkeletonRows } from '../components/ui';
import { FormActions } from '../components/FormActions';
import { money, num, statusLabel } from '../format';
import { useLabel, useLookups, useSave, useUsers } from '../hooks';
import { lookupLabel, t } from '../i18n';

interface SavedView extends Omit<GridState, 'search'> { name: string }
/**
 * Views are the company's (user request 2026-10-25): admins save them for everyone and pick the
 * standard one everybody starts with. Others can pick a view and change columns or filters for
 * the moment, but cannot save.
 */
interface CompanyViews { standard: string | null; views: SavedView[] }

/** Filters the server applies (links from the dashboard use them), shown as chips. */
const SERVER_CHIPS = ['status', 'owner_id', 'source', 'month', 'lost_reason', 'event_type', 'business_unit_id', 'venue_id', 'from', 'to', 'followup_due', 'signed_missing', 'q'];
const PAGE = 300;
/** In the order they were registered, like the Excel sheet; the list opens at the latest ones. */
const REGISTERED = [{ id: 'inquiry_date', desc: false }, { id: 'booking_no', desc: false }];

export function Bookings() {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const isAdmin = can('admin');
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
  const wrap = useRef<HTMLDivElement>(null);

  const filter = (k: string) => params.get(k) ?? '';
  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  // Every contract the person may see (no date chosen = everything); the filters work in the browser.
  const serverQuery = useMemo(() => {
    const q = new URLSearchParams(params);
    q.delete('sort');
    q.set('limit', '5000');
    return q.toString();
  }, [params]);
  const { data, isLoading, error } = useQuery({
    queryKey: ['bookings', serverQuery],
    queryFn: () => api<{ rows: Booking[]; totals: Record<string, number> }>(`/bookings?${serverQuery}`),
  });

  // Columns the person may see (hidden contract fields never show, not even as an option).
  const columns = useMemo<GridColumn[]>(
    () => contractColumns({ eventLabel, sourceLabel, fin }).filter((c) => !c.field || !hidden(c.field)),
    [lookups, fin, me?.hidden_fields],
  );

  // Views: the company's, saved by admins; everyone starts with the standard one.
  const company: CompanyViews = (me?.tenant.contract_views as CompanyViews | undefined) ?? { standard: null, views: [] };
  const views = company.views;
  const builtIn = (): GridState => ({ ...standardLayout(columns), sorting: REGISTERED, filters: [], search: '' });
  const fromView = (v: SavedView | undefined): GridState => (v
    ? { ...standardLayout(columns), order: v.order, visible: v.visible, sorting: v.sorting, filters: v.filters ?? [], search: '' }
    : builtIn());
  const initial = (): GridState => {
    const sort = params.get('sort');
    const base = fromView(views.find((v) => v.name === company.standard));
    return sort ? { ...base, sorting: [{ id: sort.replace(/^-/, ''), desc: sort.startsWith('-') }] } : base;
  };
  const [state, setState] = useState(initial);
  const [viewName, setViewName] = useState(company.standard ?? '');
  const set = (s: Partial<typeof state>) => setState((prev) => ({ ...prev, ...s }));

  /** Admins only: store the company's views (the server refuses everyone else). */
  const saveCompany = useSave((next: CompanyViews) => api('/tenant', { method: 'PATCH', body: { contract_views: next } }), []);
  const storeViews = (next: CompanyViews) => saveCompany.mutate(next, {
    onSuccess: () => qc.setQueryData<Me>(['me'], (m) => (m ? { ...m, tenant: { ...m.tenant, contract_views: next } } : m)),
  });

  const table = useContractTable(data?.rows ?? [], columns, state, set);
  useEffect(() => setShown(PAGE), [state.filters, state.search, serverQuery]);
  const filtered = table.getFilteredRowModel().rows.map((r) => r.original);
  const rows = table.getRowModel().rows;
  const leaf = table.getVisibleLeafColumns();
  // The latest rows are at the bottom: show the last ones, and open the list scrolled down to them.
  const start = Math.max(0, rows.length - shown);
  const visibleRows = rows.slice(start);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    const id = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(id);
  }, [data, state.filters, state.search, state.sorting]);

  const applyView = (name: string) => {
    setViewName(name);
    setState(fromView(views.find((x) => x.name === name)));
  };
  const saveView = (name: string, standard: boolean) => {
    const v: SavedView = { name, order: state.order, visible: state.visible, sorting: state.sorting, filters: state.filters };
    const list = [...views.filter((x) => x.name !== name), v].sort((a, b) => a.name.localeCompare(b.name));
    storeViews({ views: list, standard: standard ? name : company.standard === name ? null : company.standard });
    setViewName(name);
  };
  const deleteView = () => {
    if (!confirm(t('Delete the view “{name}” for everyone?', { name: viewName }))) return;
    storeViews({ views: views.filter((x) => x.name !== viewName), standard: company.standard === viewName ? null : company.standard });
    setViewName('');
  };

  const exportView = () => {
    const title = t('CONTRACTS');
    const cols = leaf.map(metaOf);
    return download('/reports/table.xlsx', `${title}.xlsx`, {
      title,
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
      case 'status': return `STATUS: ${v}`;
      case 'owner_id': return `AM: ${userName(v)}`;
      case 'source': return `SOURCE: ${v}`;
      case 'month': return `M: ${v}`;
      case 'lost_reason': return `LOST REASON: ${lookupLabel(lookups?.lost_reason?.find((l) => l.code === v), v)}`;
      case 'event_type': return `CONTRACT TYPE: ${eventLabel(v)}`;
      case 'business_unit_id': return t('One business unit');
      case 'venue_id': return t('One venue');
      case 'followup_due': return t('Follow-up due');
      case 'signed_missing': return t('Signed contract missing');
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
  if (state.search) chips.push({ key: 'search', label: `${t('Search')}: ${state.search}`, clear: () => set({ search: '' }) });
  const clearAll = () => {
    set({ filters: [], search: '' });
    const next = new URLSearchParams(params);
    for (const k of SERVER_CHIPS) next.delete(k);
    setParams(next, { replace: true });
  };

  const sum = (c: GridColumn) => filtered.reduce((n, b) => n + Number(c.get(b) ?? 0), 0);

  return (
    <>
      <div className="page-head contracts-head">
        <h1 className="contracts-title">{t('CONTRACTS')}</h1>
        <div className="row">
          <input type="search" className="contracts-search" placeholder={t('Search anything in the list…')} value={state.search ?? ''}
            onChange={(e) => set({ search: e.target.value })} aria-label={t('Search')} title={t('Every word must appear somewhere in the contract, in any column')} />
          {me?.rights.export && (
            <span className="export-group">
              <button onClick={exportView} title={t('Export this list to Excel')}>EXPORT</button>
              <details className="export-more">
                  <summary aria-label={t('More export options')}><ChevronDown className="ico" aria-hidden /></summary>
                  <div className="export-menu">
                    <button className="sm ghost" onClick={() => { const y = new Date().getFullYear(); void download(`/reports/contracts.xlsx?year=${y}`, `contracts-${y}.xlsx`); }}>{t('Full year workbook')}</button>
                  </div>
              </details>
            </span>
          )}
          {can('sell') && <button className="primary" onClick={() => setCreating(true)}>{t("New contract")}</button>}
        </div>
      </div>

      <div className="contracts-toolbar">
        <button type="button" className="sm" onClick={() => setChoosing(true)}><Columns3 className="ico" aria-hidden /> {t('Columns')}</button>
        {(views.length > 0 || isAdmin) && (
          <select value={viewName} onChange={(e) => applyView(e.target.value)} aria-label={t('Views')}>
            <option value="">{t('Basic columns')}</option>
            {views.map((v) => <option key={v.name} value={v.name}>{v.name}{v.name === company.standard ? ` · ${t('standard')}` : ''}</option>)}
          </select>
        )}
        {isAdmin && <button type="button" className="sm" onClick={() => setNaming(true)} title={t('Save these columns, order, sorting and filters as a view for everyone')}><Save className="ico" aria-hidden /> {t('Save view')}</button>}
        {isAdmin && viewName && <button type="button" className="sm ghost" onClick={deleteView} aria-label={t('Delete this view')}><Trash2 className="ico" aria-hidden /></button>}
      </div>

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
        <div className="table-wrap grid-wrap" ref={wrap}>
            <table className="contract-grid">
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
                {start > 0 && (
                  <tr><td colSpan={leaf.length} className="empty">
                    <button type="button" onClick={() => setShown((n) => n + PAGE * 3)}>{t('Show {n} earlier', { n: Math.min(PAGE * 3, start) })}</button>
                  </td></tr>
                )}
                {isLoading && <SkeletonRows cols={leaf.length || 8} />}
                {data && rows.length === 0 && <tr><td colSpan={leaf.length} className="empty">{t("No bookings match these filters.")}</td></tr>}
                {visibleRows.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => navigate(`/bookings/${r.original.id}`)}>
                    {r.getVisibleCells().map((cell) => {
                      const k = metaOf(cell.column).kind;
                      return <td key={cell.id} className={k === 'money' || k === 'number' ? 'num' : ''}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>;
                    })}
                  </tr>
                ))}
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
      </div>
      {data && data.rows.length >= 5000 && <p className="small muted">{t('Showing the first 5,000 contracts.')}</p>}

      {choosing && (
        <Modal title={t('Columns')} onClose={() => setChoosing(false)} footer={<button className="primary" onClick={() => setChoosing(false)}>{t('Done')}</button>}>
          <ColumnChooser columns={columns} state={state} set={set} onReset={() => set(standardLayout(columns))} />
        </Modal>
      )}
      <ErrorNote error={saveCompany.error} />
      {naming && <NameView initial={viewName} standard={!viewName || viewName === company.standard} taken={views.map((v) => v.name)}
        onClose={() => setNaming(false)} onSave={(n, std) => { saveView(n, std); setNaming(false); }} />}
      {creating && <NewBooking onClose={() => setCreating(false)} onCreated={(id) => navigate(`/bookings/${id}`)} />}
    </>
  );
}

function NameView({ initial, standard: initialStandard, taken, onClose, onSave }: {
  initial: string; standard: boolean; taken: string[]; onClose: () => void; onSave: (name: string, standard: boolean) => void;
}) {
  const [name, setName] = useState(initial);
  const [standard, setStandard] = useState(initialStandard);
  const clean = name.trim();
  return (
    <Modal title={t('Save view for everyone')} onClose={onClose}
      footer={<><button onClick={onClose}>{t('Cancel')}</button><button className="primary" form="name-view" disabled={!clean}>{t('Save')}</button></>}>
      <form id="name-view" className="stack" onSubmit={(e) => { e.preventDefault(); if (clean) onSave(clean.slice(0, 60), standard); }}>
        <label>{t('Name')}<input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} placeholder={t('e.g. Sales standard')} /></label>
        <label className="check"><input type="checkbox" checked={standard} onChange={(e) => setStandard(e.target.checked)} />{t('Standard view: everyone opens the contract list with it')}</label>
        <p className="small secondary">
          {taken.includes(clean) ? t('This replaces the view with the same name, for everyone.') : t('Keeps the columns, their order, the sorting and the filters. Everyone can pick it; only admins save or delete views.')}
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
