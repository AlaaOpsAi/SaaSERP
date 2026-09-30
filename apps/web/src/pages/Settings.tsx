import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Role, type User } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Field, Modal, Tabs, useForm } from '../components/ui';
import { dateTime } from '../format';
import { useBusinessUnits, useLookups, useSave, useUsers, useVenues } from '../hooks';

type Tab = 'company' | 'team' | 'venues' | 'units' | 'lists' | 'import';

export function Settings() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('company');
  const tabs: [Tab, string][] = [['company', 'Company'], ['team', 'Team'], ['venues', 'Venues & rooms'], ['units', 'Business units'], ['lists', 'Pick-lists']];
  if (can('admin')) tabs.push(['import', 'Import from Excel']);
  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><p>Configure your workspace, team and sales pick-lists.</p></div></div>
      {!can('admin') && <div className="alert info" style={{ marginBottom: 16 }}>Only owners and admins can change most settings.</div>}
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'company' && <Company />}
      {tab === 'team' && <Team />}
      {tab === 'venues' && <Venues />}
      {tab === 'units' && <Units />}
      {tab === 'lists' && <Lists />}
      {tab === 'import' && <Import />}
    </>
  );
}

function Company() {
  const { me, can } = useAuth();
  const t = me!.tenant;
  const { form, bind, bindNum } = useForm({
    name: t.name, currency: t.currency, timezone: t.timezone,
    fixed_cost_pct: t.fixed_cost_pct * 100 as number | null, credit_facility_pct: t.credit_facility_pct * 100 as number | null,
  });
  const save = useSave(() => api('/tenant', { method: 'PATCH', body: {
    ...form, fixed_cost_pct: (form.fixed_cost_pct ?? 0) / 100, credit_facility_pct: (form.credit_facility_pct ?? 0) / 100,
  } }), [['me'], ['bookings'], ['booking'], ['dashboard']]);
  return (
    <form className="card stack" style={{ maxWidth: 760 }} onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
      <ErrorNote error={save.error} />
      {save.isSuccess && <div className="alert info">Saved.</div>}
      <fieldset disabled={!can('admin')} className="form-grid" style={{ border: 'none', padding: 0, margin: 0 }}>
        <Field label="Company name" className="span-2"><input required {...bind('name')} /></Field>
        <Field label="Workspace ID"><input value={t.slug} disabled /></Field>
        <Field label="Currency"><input maxLength={3} required {...bind('currency')} /></Field>
        <Field label="Time zone"><input required {...bind('timezone')} /></Field>
        <Field label="Plan"><input value={t.plan} disabled /></Field>
      </fieldset>
      <div>
        <h3>Profit model</h3>
        <p className="secondary small" style={{ margin: '4px 0 12px' }}>
          Net profit = gross margin − fixed cost − credit-facility cost. Both are charged as a percentage of gross margin, as in the daily report.
        </p>
        <fieldset disabled={!can('admin')} className="form-grid" style={{ border: 'none', padding: 0, margin: 0 }}>
          <Field label="Fixed cost, % of gross margin"><input min={0} max={100} {...bindNum('fixed_cost_pct')} /></Field>
          <Field label="Credit-facility cost, % of gross margin"><input min={0} max={100} {...bindNum('credit_facility_pct')} /></Field>
        </fieldset>
      </div>
      {can('admin') && <div><button className="primary" disabled={save.isPending}>Save</button></div>}
    </form>
  );
}

const ROLES: [Role, string][] = [
  ['owner', 'Owner'], ['admin', 'Admin'], ['manager', 'Sales manager'], ['sales', 'Sales / account manager'],
  ['finance', 'Finance'], ['viewer', 'Viewer'],
];

function Team() {
  const { can } = useAuth();
  const { data: users } = useUsers();
  const [editing, setEditing] = useState<Partial<User> | null>(null);
  return (
    <div className="card flush">
      <div className="card-head" style={{ padding: '14px 16px 0' }}>
        <span className="secondary small">Users without a login (inactive) can still be account managers on bookings.</span>
        {can('admin') && <button className="primary sm" onClick={() => setEditing({ role: 'sales', is_active: true })}>Add user</button>}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Code</th><th>Email</th><th>Role</th><th>Status</th><th>Last login</th><th /></tr></thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td><td><span className="tag">{u.code ?? '—'}</span></td><td>{u.email ?? '—'}</td>
                <td>{ROLES.find(([r]) => r === u.role)?.[1]}</td>
                <td>{u.is_active ? (u.email ? 'Active' : 'No login') : 'Inactive'}</td>
                <td>{dateTime(u.last_login_at)}</td>
                <td className="num">{can('admin') && <button className="sm ghost" onClick={() => setEditing(u)}>Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <UserModal user={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function UserModal({ user, onClose }: { user: Partial<User>; onClose: () => void }) {
  const { form, set, bind } = useForm({
    name: user.name ?? '', email: user.email ?? null, code: user.code ?? null, role: user.role ?? 'sales',
    is_active: user.is_active ?? true, password: null as string | null,
  });
  const save = useSave(() => {
    const body = { ...form, password: form.password || undefined };
    return user.id ? api(`/users/${user.id}`, { method: 'PATCH', body }) : api('/users', { body });
  }, [['users']]);
  return (
    <Modal title={user.id ? `Edit ${user.name}` : 'Add user'} onClose={onClose}
      footer={<><button onClick={onClose}>Cancel</button><button className="primary" form="user-form" disabled={save.isPending}>Save</button></>}>
      <form id="user-form" className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }}>
        <ErrorNote error={save.error} />
        <div className="form-grid">
          <Field label="Name"><input required {...bind('name')} /></Field>
          <Field label="Initials code (AM)"><input maxLength={6} {...bind('code')} placeholder="e.g. JOU" /></Field>
          <Field label="Email (for login)"><input type="email" {...bind('email')} /></Field>
          <Field label="Role">
            <select value={form.role} onChange={(e) => set('role')(e.target.value as Role)}>
              {ROLES.map(([r, l]) => <option key={r} value={r}>{l}</option>)}
            </select>
          </Field>
          <Field label={user.id ? 'New password (optional)' : 'Password'}><input type="password" minLength={8} {...bind('password')} /></Field>
          <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active')(e.target.checked)} />Can sign in
          </label>
        </div>
      </form>
    </Modal>
  );
}

function Venues() {
  const { can } = useAuth();
  const { data: venues } = useVenues();
  const v = useForm({ name: '', kind: 'hotel' });
  const addVenue = useSave(() => api('/venues', { body: v.form }), [['venues']]);
  const s = useForm({ venue_id: '', name: '', capacity: null as number | null, allow_overlap: false });
  const addSpace = useSave(() => api('/function-spaces', { body: s.form }), [['venues']]);
  const toggle = useSave((x: { id: string; is_active: boolean; kind: 'venues' | 'function-spaces' }) =>
    api(`/${x.kind}/${x.id}`, { method: 'PATCH', body: { is_active: x.is_active } }), [['venues']]);
  return (
    <div className="stack">
      {can('manage') && (
        <div className="grid-2">
          <form className="card form-grid" onSubmit={(e) => { e.preventDefault(); addVenue.mutate(undefined, { onSuccess: () => v.setForm({ name: '', kind: 'hotel' }) }); }}>
            <h3 className="span-all">Add venue / location</h3>
            <Field label="Name"><input required {...v.bind('name')} placeholder="e.g. FOUR SEASONS" /></Field>
            <Field label="Kind">
              <select {...v.bind('kind')}>
                <option value="hotel">Hotel</option><option value="hall">Hall</option><option value="own">Own venue</option>
                <option value="client_location">Client location (home)</option><option value="other">Other</option>
              </select>
            </Field>
            <div><button className="primary" disabled={addVenue.isPending}>Add venue</button></div>
            <div className="span-all"><ErrorNote error={addVenue.error} /></div>
          </form>
          <form className="card form-grid" onSubmit={(e) => { e.preventDefault(); addSpace.mutate(undefined, { onSuccess: () => s.setForm((f) => ({ ...f, name: '', capacity: null })) }); }}>
            <h3 className="span-all">Add function space / room</h3>
            <Field label="Venue">
              <select required {...s.bind('venue_id')}>
                <option value="">Choose…</option>{venues?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
            <Field label="Room name"><input required {...s.bind('name')} placeholder="e.g. MIRQAB Ballroom" /></Field>
            <Field label="Capacity"><input {...s.bindNum('capacity')} /></Field>
            <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}>
              <input type="checkbox" checked={s.form.allow_overlap} onChange={(e) => s.set('allow_overlap')(e.target.checked)} />Shareable (no clash checks)
            </label>
            <div><button className="primary" disabled={addSpace.isPending}>Add room</button></div>
            <div className="span-all"><ErrorNote error={addSpace.error} /></div>
          </form>
        </div>
      )}
      <div className="card flush">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Venue</th><th>Kind</th><th>Rooms</th><th /></tr></thead>
            <tbody>
              {venues?.length === 0 && <tr><td colSpan={4} className="empty">No venues yet.</td></tr>}
              {venues?.map((x) => (
                <tr key={x.id} style={{ opacity: x.is_active ? 1 : 0.5 }}>
                  <td><strong>{x.name}</strong></td>
                  <td>{x.kind.replace('_', ' ')}</td>
                  <td>
                    <div className="row">
                      {x.spaces.map((sp) => (
                        <span key={sp.id} className="tag" style={{ opacity: sp.is_active ? 1 : 0.5 }}>
                          {sp.name}{sp.capacity ? ` · ${sp.capacity}` : ''}{sp.allow_overlap ? ' · shared' : ''}
                          {can('manage') && <button className="sm ghost" style={{ padding: '0 4px' }} title={sp.is_active ? 'Deactivate' : 'Activate'}
                            onClick={() => toggle.mutate({ id: sp.id, is_active: !sp.is_active, kind: 'function-spaces' })}>{sp.is_active ? '✕' : '↺'}</button>}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="num">{can('manage') && <button className="sm ghost" onClick={() => toggle.mutate({ id: x.id, is_active: !x.is_active, kind: 'venues' })}>{x.is_active ? 'Deactivate' : 'Activate'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Units() {
  const { can } = useAuth();
  const { data } = useBusinessUnits();
  const { form, setForm, bind } = useForm({ code: '', name: '' });
  const add = useSave(() => api('/business-units', { body: form }), [['business-units']]);
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <p className="secondary" style={{ margin: 0 }}>Brands or companies inside your workspace. The code prefixes booking numbers, e.g. <strong>W</strong>2026001.</p>
      <div className="card flush">
        <table>
          <thead><tr><th>Code</th><th>Name</th></tr></thead>
          <tbody>{data?.map((u) => <tr key={u.id}><td><span className="tag">{u.code}</span></td><td>{u.name}</td></tr>)}</tbody>
        </table>
      </div>
      {can('admin') && (
        <form className="card form-grid" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined, { onSuccess: () => setForm({ code: '', name: '' }) }); }}>
          <Field label="Code"><input required maxLength={4} {...bind('code')} /></Field>
          <Field label="Name"><input required {...bind('name')} /></Field>
          <div style={{ alignSelf: 'end' }}><button className="primary">Add unit</button></div>
          <div className="span-all"><ErrorNote error={add.error} /></div>
        </form>
      )}
    </div>
  );
}

const LIST_TYPES: [string, string][] = [
  ['event_type', 'Event types'], ['source', 'Lead sources'], ['lost_reason', 'Lost reasons'], ['item_category', 'Line categories'],
  ['setup_style', 'Setup styles'], ['payment_method', 'Payment methods'], ['bank_account', 'Bank accounts'], ['business_type', 'Business types'],
];

function Lists() {
  const { can } = useAuth();
  const { data } = useLookups();
  const [type, setType] = useState('event_type');
  const { form, setForm, bind } = useForm({ code: '', label: '' });
  const add = useSave(() => api('/lookups', { body: { ...form, type, sort_order: (data?.[type]?.length ?? 0) + 1 } }), [['lookups']]);
  const toggle = useSave((x: { id: string; is_active: boolean }) => api(`/lookups/${x.id}`, { method: 'PATCH', body: { is_active: x.is_active } }), [['lookups']]);
  return (
    <div className="grid-2" style={{ gridTemplateColumns: '220px 1fr' }}>
      <div className="card" style={{ padding: 8 }}>
        {LIST_TYPES.map(([k, l]) => (
          <button key={k} className={`ghost ${type === k ? 'active' : ''}`} style={{ width: '100%', justifyContent: 'space-between', color: type === k ? 'var(--accent)' : undefined }} onClick={() => setType(k)}>
            {l}<span className="muted small">{data?.[k]?.length ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="stack">
        <div className="card flush">
          <table>
            <thead><tr><th>Code</th><th>Label</th><th /></tr></thead>
            <tbody>
              {(data?.[type] ?? []).map((l) => (
                <tr key={l.id} style={{ opacity: l.is_active ? 1 : 0.5 }}>
                  <td><span className="tag">{l.code}</span></td><td>{l.label}</td>
                  <td className="num">{can('admin') && <button className="sm ghost" onClick={() => toggle.mutate({ id: l.id, is_active: !l.is_active })}>{l.is_active ? 'Hide' : 'Show'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {can('admin') && (
          <form className="card form-grid" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined, { onSuccess: () => setForm({ code: '', label: '' }) }); }}>
            <Field label="Code"><input required maxLength={40} {...bind('code')} /></Field>
            <Field label="Label"><input required {...bind('label')} /></Field>
            <div style={{ alignSelf: 'end' }}><button className="primary">Add</button></div>
            <div className="span-all"><ErrorNote error={add.error} /></div>
          </form>
        )}
      </div>
    </div>
  );
}

function Import() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const run = useSave(async () => {
    const form = new FormData();
    form.append('file', file!);
    const result = await api<Record<string, number | unknown[]>>('/import/workbook', { form });
    await qc.invalidateQueries();
    return result;
  });
  const r = run.data as undefined | { errors: { row: number; booking_no?: string; message: string }[] } & Record<string, number>;
  return (
    <div className="card stack" style={{ maxWidth: 760 }}>
      <div>
        <h3>Import your daily report workbook</h3>
        <p className="secondary" style={{ margin: '4px 0 0' }}>
          Upload the <strong>.xlsx</strong> with a <strong>CONTRACTS</strong> sheet (headers in row 2, data from row 3 until “end”) and optionally the
          <strong> PAR</strong> sheet. Bookings are matched on CONTRACT ID, so re-importing updates them instead of duplicating.
          Clients are matched on phone number; venues, rooms, account managers, sources and event types are created as needed.
        </p>
      </div>
      <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <div><button className="primary" disabled={!file || run.isPending} onClick={() => run.mutate(undefined)}>{run.isPending ? 'Importing…' : 'Import'}</button></div>
      <ErrorNote error={run.error} />
      {r && (
        <div className="stack">
          <div className="alert info">
            Imported: {r.bookings_created} new and {r.bookings_updated} updated bookings, {r.contacts_created} clients, {r.venues_created} venues,
            {' '}{r.users_created} account managers, {r.activities_created} meetings.
          </div>
          {r.errors.length > 0 && (
            <div className="alert">
              {r.errors.length} rows failed:
              <ul>{r.errors.slice(0, 20).map((e) => <li key={e.row}>Row {e.row} {e.booking_no}: {e.message}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
