import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, download, type Role, type User } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Field, Modal, Tabs, useForm } from '../components/ui';
import { dateTime } from '../format';
import { useBusinessUnits, useLookups, useSave, useUsers, useVenues } from '../hooks';
import { LANGUAGES, t } from '../i18n';

type Tab = 'company' | 'team' | 'venues' | 'units' | 'lists' | 'import' | 'export';

export function Settings() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('company');
  const tabs: [Tab, string][] = [['company', 'Company'], ['team', 'Team'], ['venues', 'Venues & rooms'], ['units', 'Business units'], ['lists', 'Pick-lists']];
  if (can('admin')) tabs.push(['import', 'Import from Excel'], ['export', 'Export']);
  return (
    <>
      <div className="page-head"><div><h1>{t("Settings")}</h1><p>{t("Configure your workspace, team and sales pick-lists.")}</p></div></div>
      {!can('admin') && <div className="alert info" style={{ marginBottom: 16 }}>{t("Only owners and admins can change most settings.")}</div>}
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'company' && <Company />}
      {tab === 'team' && <Team />}
      {tab === 'venues' && <Venues />}
      {tab === 'units' && <Units />}
      {tab === 'lists' && <Lists />}
      {tab === 'import' && <Import />}
      {tab === 'export' && <Export />}
    </>
  );
}

function Company() {
  const { me, can } = useAuth();
  const ten = me!.tenant;
  const { form, set, bind, bindNum } = useForm({
    name: ten.name, currency: ten.currency, timezone: ten.timezone,
    fixed_cost_pct: ten.fixed_cost_pct * 100 as number | null, credit_facility_pct: ten.credit_facility_pct * 100 as number | null,
    default_locale: ten.default_locale ?? 'en', brand: ten.branding?.accent ?? '',
  });
  const save = useSave(() => {
    const { brand, ...rest } = form;
    return api('/tenant', { method: 'PATCH', body: {
      ...rest, fixed_cost_pct: (form.fixed_cost_pct ?? 0) / 100, credit_facility_pct: (form.credit_facility_pct ?? 0) / 100,
      branding: { accent: brand || null },
    } });
  }, [['me'], ['bookings'], ['booking'], ['dashboard']]);
  return (
    <form className="card stack" style={{ maxWidth: 760 }} onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
      <ErrorNote error={save.error} />
      {save.isSuccess && <div className="alert info">{t("Saved.")}</div>}
      <fieldset disabled={!can('admin')} className="form-grid" style={{ border: 'none', padding: 0, margin: 0 }}>
        <Field label={t("Company name")} className="span-2"><input required {...bind('name')} /></Field>
        <Field label={t("Workspace ID")}><input value={ten.slug} disabled /></Field>
        <Field label={t("Currency")}><input maxLength={3} required {...bind('currency')} /></Field>
        <Field label={t("Time zone")}><input required {...bind('timezone')} /></Field>
        <Field label={t("Plan")}><input value={ten.plan} disabled /></Field>
        <Field label={t('Default language')}>
          <select {...bind('default_locale')}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </Field>
        <Field label={t('Brand colour (everyone\'s default accent)')}>
          <div className="row">
            <input type="color" value={form.brand || '#2a78d6'} onChange={(e) => set('brand')(e.target.value)} aria-label={t('Brand colour')} />
            {form.brand && <button type="button" className="sm ghost" onClick={() => set('brand')('')}>{t('Reset')}</button>}
          </div>
        </Field>
      </fieldset>
      <div>
        <h3>{t("Profit model")}</h3>
        <p className="secondary small" style={{ margin: '4px 0 12px' }}>{t("Net profit = gross margin − fixed cost − credit-facility cost. Both are charged as a percentage of gross margin, as in the daily report.")}</p>
        <fieldset disabled={!can('admin')} className="form-grid" style={{ border: 'none', padding: 0, margin: 0 }}>
          <Field label={t("Fixed cost, % of gross margin")}><input min={0} max={100} {...bindNum('fixed_cost_pct')} /></Field>
          <Field label={t("Credit-facility cost, % of gross margin")}><input min={0} max={100} {...bindNum('credit_facility_pct')} /></Field>
        </fieldset>
      </div>
      {can('admin') && <div><button className="primary" disabled={save.isPending}>{t("Save")}</button></div>}
    </form>
  );
}

const ROLES: [Role, string][] = [
  ['owner', 'Owner'], ['admin', 'Admin'], ['manager', 'Sales manager'], ['sales', 'Sales / account manager'],
  ['finance', 'Finance'], ['viewer', 'Viewer'],
];

const ROLE_LABEL = new Proxy(Object.fromEntries(ROLES) as Record<Role, string>, { get: (o, k: string) => t(o[k as Role]) });

/** Children of each manager id ('' = top level), so the org chart can be drawn as a tree. */
function byManager(users: User[]) {
  const ids = new Set(users.map((u) => u.id));
  const map = new Map<string, User[]>();
  for (const u of users) {
    const key = u.manager_id && ids.has(u.manager_id) ? u.manager_id : '';
    map.set(key, [...(map.get(key) ?? []), u]);
  }
  return map;
}

function countBelow(id: string, kids: Map<string, User[]>): number {
  return (kids.get(id) ?? []).reduce((n, k) => n + 1 + countBelow(k.id, kids), 0);
}

function Team() {
  const { can, me } = useAuth();
  const { data: users } = useUsers();
  const [editing, setEditing] = useState<Partial<User> | null>(null);
  const [transferring, setTransferring] = useState<User | null>(null);
  // Managers can hand over the work of people in their team; admins anyone's (but never their own).
  const canTransfer = (u: User) => can('manage') && u.id !== me?.id && (me?.sees_all || me?.team_ids.includes(u.id));
  const [view, setView] = useState<'chart' | 'list'>('chart');
  const kids = byManager(users ?? []);
  const nameOf = (id: string | null) => users?.find((u) => u.id === id)?.name ?? '—';

  const Node = ({ u, depth }: { u: User; depth: number }) => {
    const below = countBelow(u.id, kids);
    return (
      <li>
        <div className={`org-node ${u.is_active ? '' : 'inactive'}`}>
          <span className="org-avatar" aria-hidden>{(u.code ?? u.name).slice(0, 3).toUpperCase()}</span>
          <div className="grow">
            <strong>{u.name}</strong> {u.code && <span className="tag">{u.code}</span>}
            <div className="small secondary">
              {ROLE_LABEL[u.role]} · {u.role === 'owner' || u.role === 'admin' || u.data_scope === 'all' ? t("sees whole company") : below ? t('sees own + {n} below', { n: below }) : t("sees own records")}
              {!u.email && t(" · no login")}{!u.is_active && u.email ? t(" · inactive") : ''}
            </div>
          </div>
          {depth > 0 && <span className="muted small">{t("level")}{' '}{depth + 1}</span>}
          {canTransfer(u) && u.is_active && <button className="sm ghost" onClick={() => setTransferring(u)}>{t("Transfer…")}</button>}
          {can('admin') && <button className="sm ghost" onClick={() => setEditing(u)}>{t("Edit")}</button>}
        </div>
        {(kids.get(u.id) ?? []).length > 0 && (
          <ul>{kids.get(u.id)!.map((k) => <Node key={k.id} u={k} depth={depth + 1} />)}</ul>
        )}
      </li>
    );
  };

  return (
    <div className="card flush">
      <div className="card-head" style={{ padding: '14px 16px 0' }}>
        <span className="secondary small" style={{ maxWidth: 620 }}>{t("Set who reports to whom. A manager sees their own bookings plus everything owned by anyone below them, at every level. Owners, admins and anyone set to “whole company” see everything.")}</span>
        <div className="row">
          <div className="segmented" role="tablist" aria-label={t("View")}>
            <button role="tab" aria-selected={view === 'chart'} className={view === 'chart' ? 'on' : ''} onClick={() => setView('chart')}>{t("Org chart")}</button>
            <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>{t("List")}</button>
          </div>
          {can('admin') && <button className="primary sm" onClick={() => setEditing({ role: 'sales', is_active: true, data_scope: 'team' })}>{t("Add user")}</button>}
        </div>
      </div>
      {view === 'chart' ? (
        <ul className="org">{(kids.get('') ?? []).map((u) => <Node key={u.id} u={u} depth={0} />)}</ul>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t("Name")}</th><th>{t("Code")}</th><th>{t("Email")}</th><th>{t("Role")}</th><th>{t("Reports to")}</th><th>{t("Can see")}</th><th>{t("Status")}</th><th>{t("Last login")}</th><th /></tr></thead>
            <tbody>
              {users?.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td><td><span className="tag">{u.code ?? '—'}</span></td><td>{u.email ?? '—'}</td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td>{nameOf(u.manager_id)}</td>
                  <td>{u.role === 'owner' || u.role === 'admin' || u.data_scope === 'all' ? t("Whole company") : t("Their team")}</td>
                  <td>{u.is_active ? (u.email ? t("Active") : t("No login")) : t("Inactive")}</td>
                  <td>{dateTime(u.last_login_at)}</td>
                  <td className="num">
                    {canTransfer(u) && u.is_active && <button className="sm ghost" onClick={() => setTransferring(u)}>{t("Transfer…")}</button>}
                    {can('admin') && <button className="sm ghost" onClick={() => setEditing(u)}>{t("Edit")}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <UserModal user={editing} onClose={() => setEditing(null)} />}
      {transferring && <TransferModal user={transferring} onClose={() => setTransferring(null)} />}
    </div>
  );
}

/** Someone is leaving (or changing role): move their work to a colleague in one go. */
function TransferModal({ user, onClose }: { user: User; onClose: () => void }) {
  const { me } = useAuth();
  const { data: users } = useUsers();
  const [f, setF] = useState({ to_user_id: '', bookings: 'open', activities: true, clients: true, reports: true, deactivate: true });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const targets = (users ?? []).filter((u) => u.id !== user.id && u.is_active && (me?.sees_all || me?.team_ids.includes(u.id)));
  const hasReports = (users ?? []).some((u) => u.manager_id === user.id);
  const save = useSave(() => api<{ moved: Record<string, number> }>(`/users/${user.id}/transfer`, { body: f }),
    [['users'], ['bookings'], ['dashboard'], ['activities'], ['delegations']]);
  const done = save.data?.moved;
  return (
    <Modal title={t("Transfer {name}'s work", { name: user.name })} onClose={onClose} footer={done ? <button className="primary" onClick={onClose}>{t("Done")}</button> : <>
      <button onClick={onClose}>{t("Cancel")}</button>
      <button className="danger" form="transfer-form" disabled={save.isPending || !f.to_user_id}>Transfer{f.deactivate ? ' & deactivate' : ''}</button>
    </>}>
      {done ? (
        <div className="alert info">{t("Moved")}{' '}{done.bookings}{' '}{t("bookings,")}{' '}{done.activities}{' '}{t("follow-ups and")}{' '}{done.clients}{' '}{t("clients")}{done.reports ? `, and ${done.reports} people now report to the new owner` : ''}.
          {f.deactivate && ` ${t('{name} can no longer sign in.', { name: user.name })}`}
        </div>
      ) : (
        <form id="transfer-form" className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
          <ErrorNote error={save.error} />
          <p className="secondary" style={{ margin: 0 }}>{t("Use this when")}{' '}{user.name}{' '}{t("leaves or changes role. History stays, and commissions already earned stay with")}{' '}{user.name}{t(". For a temporary absence, use")}{' '}<strong>{t("Cover & delegation")}</strong>{' '}{t("instead.")}</p>
          <Field label={t("Hand over to")}>
            <select required value={f.to_user_id} onChange={(e) => set('to_user_id', e.target.value)}>
              <option value="">{t("Choose a colleague…")}</option>
              {targets.map((u) => <option key={u.id} value={u.id}>{u.name}{u.code ? ` (${u.code})` : ''}</option>)}
            </select>
          </Field>
          <Field label={t("Bookings")}>
            <select value={f.bookings} onChange={(e) => set('bookings', e.target.value)}>
              <option value="open">{t("Open ones: inquiry, tentative, definite (closed history stays with")}{' '}{user.name})</option>
              <option value="all">{t("All bookings, including actualised, lost and cancelled")}</option>
              <option value="none">{t("None")}</option>
            </select>
          </Field>
          <label className="check"><input type="checkbox" checked={f.activities} onChange={(e) => set('activities', e.target.checked)} />{t("Open follow-ups and tasks")}</label>
          <label className="check"><input type="checkbox" checked={f.clients} onChange={(e) => set('clients', e.target.checked)} />{t("Companies they own")}</label>
          {hasReports && <label className="check"><input type="checkbox" checked={f.reports} onChange={(e) => set('reports', e.target.checked)} />{t("People who report to")}{' '}{user.name}{' '}{t("now report to the new owner")}</label>}
          <label className="check"><input type="checkbox" checked={f.deactivate} onChange={(e) => set('deactivate', e.target.checked)} />{t("Deactivate")}{' '}{user.name}{' '}{t("(signs them out, ends any cover)")}</label>
        </form>
      )}
    </Modal>
  );
}

function UserModal({ user, onClose }: { user: Partial<User>; onClose: () => void }) {
  const { me } = useAuth();
  const { data: users } = useUsers();
  const { form, set, bind } = useForm({
    name: user.name ?? '', email: user.email ?? null, code: user.code ?? null, role: user.role ?? 'sales',
    is_active: user.is_active ?? true, password: null as string | null,
    manager_id: user.manager_id ?? null, data_scope: user.data_scope ?? 'team',
  });
  // Who this user may report to: anyone except themselves and the people below them.
  const below = new Set<string>();
  if (user.id && users) {
    const kids = byManager(users);
    const walk = (id: string) => (kids.get(id) ?? []).forEach((k) => { below.add(k.id); walk(k.id); });
    walk(user.id);
  }
  const seesAllByRole = form.role === 'owner' || form.role === 'admin';
  const [mergeTarget, setMergeTarget] = useState('');
  const save = useSave(() => {
    const body = { ...form, password: form.password || undefined };
    return user.id ? api(`/users/${user.id}`, { method: 'PATCH', body }) : api('/users', { body });
  }, [['users']]);
  const merge = useSave((v: { source: string; target: string }) => api(`/users/${v.source}/merge-into/${v.target}`, { method: 'POST' }),
    [['users'], ['bookings'], ['dashboard'], ['booking']]);

  // The save clashed with another user's email or initials: offer to merge the duplicate.
  const existing = (save.error as { details?: { existing_user?: User } } | null)?.details?.existing_user;
  // Keep whichever of the two can sign in (and never merge away your own account).
  const keepExisting = existing && user.id && (existing.id === me?.id || (Boolean(existing.email) && user.id !== me?.id));
  const hasLogin = Boolean(user.is_active && user.email);
  const givingLogin = form.is_active && Boolean(form.email) && !hasLogin;

  return (
    <Modal title={user.id ? t('Edit {name}', { name: user.name }) : t("Add user")} onClose={onClose}
      footer={<><button onClick={onClose}>{t("Cancel")}</button><button className="primary" form="user-form" disabled={save.isPending}>{t("Save")}</button></>}>
      <form id="user-form" className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }}>
        <ErrorNote error={save.error ?? merge.error} />
        {existing && user.id && (
          <div className="alert info stack" style={{ gap: 8 }}>
            <span>
              {keepExisting
                ? <>{t("Merging moves")}{' '}{user.name}{t("'s bookings, activities and payouts to")}{' '}<strong>{existing.name}</strong>{t(", then removes")}{' '}{user.name}.</>
                : <>{t("Merging moves")}{' '}<strong>{existing.name}</strong>{t("'s bookings, activities and payouts to")}{' '}{user.name}{t(", then removes")}{' '}{existing.name}{t(". Then save again.")}</>}
            </span>
            <div>
              <button type="button" className="sm primary" disabled={merge.isPending}
                onClick={() => merge.mutate(
                  keepExisting ? { source: user.id!, target: existing.id } : { source: existing.id, target: user.id! },
                  { onSuccess: () => { if (keepExisting) onClose(); else save.reset(); } },
                )}>
                {keepExisting ? t('Merge {a} into {b}', { a: user.name, b: existing.name }) : t('Merge {a} into {b}', { a: existing.name, b: user.name })}
              </button>
            </div>
          </div>
        )}
        <div className="form-grid">
          <Field label={t("Name")}><input required {...bind('name')} /></Field>
          <Field label={t("Initials code (AM)")}><input maxLength={6} {...bind('code')} placeholder={t("e.g. JOU")} /></Field>
          <Field label={t("Email (for login)")}><input type="email" {...bind('email')} /></Field>
          <Field label={t("Role")}>
            <select value={form.role} onChange={(e) => set('role')(e.target.value as Role)}>
              {ROLES.map(([r, l]) => <option key={r} value={r}>{t(l)}</option>)}
            </select>
          </Field>
          <Field label={!user.id || givingLogin ? t("Password (needed to sign in)") : t("New password (optional)")}>
            <input type="password" minLength={8} required={givingLogin && !user.id} {...bind('password')} />
          </Field>
          <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}>
            <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active')(e.target.checked)} />{t("Can sign in")}</label>
          <Field label={t("Reports to")}>
            <select value={form.manager_id ?? ''} onChange={(e) => set('manager_id')(e.target.value || null)}>
              <option value="">{t("— nobody (top level) —")}</option>
              {users?.filter((u) => u.id !== user.id && !below.has(u.id)).map((u) => (
                <option key={u.id} value={u.id}>{u.name}{u.code ? ` (${u.code})` : ''}</option>
              ))}
            </select>
          </Field>
          <Field label={t("Can see")}>
            <select value={seesAllByRole ? 'all' : form.data_scope} disabled={seesAllByRole}
              onChange={(e) => set('data_scope')(e.target.value as 'all' | 'team')}>
              <option value="team">{t("Their team (own + everyone below)")}</option>
              <option value="all">{t("Whole company")}</option>
            </select>
          </Field>
        </div>
        {seesAllByRole && <p className="small muted" style={{ margin: 0 }}>{t("Owners and admins always see the whole company.")}</p>}
        {user.id && user.id !== me?.id && (
          <details className="merge-box">
            <summary>{t("Duplicate of another user? Merge…")}</summary>
            <p className="small secondary">{t("Moves")}{' '}{user.name}{t("'s bookings, activities, clients and payouts to the user you choose, then removes")}{' '}{user.name}{t(". Use it when the Excel import created an account manager who already has a login.")}</p>
            <div className="row">
              <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} aria-label={t("Merge into")} style={{ width: 'auto' }}>
                <option value="">{t("Merge into…")}</option>
                {users?.filter((u) => u.id !== user.id).map((u) => <option key={u.id} value={u.id}>{u.name}{u.code ? ` (${u.code})` : ''}{u.email ? ` · ${u.email}` : ''}</option>)}
              </select>
              <button type="button" className="sm danger" disabled={!mergeTarget || merge.isPending}
                onClick={() => confirm(t('Merge {a} into {b}? This cannot be undone.', { a: user.name, b: users?.find((u) => u.id === mergeTarget)?.name }))
                  && merge.mutate({ source: user.id!, target: mergeTarget }, { onSuccess: onClose })}>{t("Merge")}</button>
            </div>
          </details>
        )}
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
            <h3 className="span-all">{t("Add venue / location")}</h3>
            <Field label={t("Name")}><input required {...v.bind('name')} placeholder={t("e.g. FOUR SEASONS")} /></Field>
            <Field label={t("Kind")}>
              <select {...v.bind('kind')}>
                <option value="hotel">{t("Hotel")}</option><option value="hall">{t("Hall")}</option><option value="own">{t("Own venue")}</option>
                <option value="client_location">{t("Client location (home)")}</option><option value="other">{t("Other")}</option>
              </select>
            </Field>
            <div><button className="primary" disabled={addVenue.isPending}>{t("Add venue")}</button></div>
            <div className="span-all"><ErrorNote error={addVenue.error} /></div>
          </form>
          <form className="card form-grid" onSubmit={(e) => { e.preventDefault(); addSpace.mutate(undefined, { onSuccess: () => s.setForm((f) => ({ ...f, name: '', capacity: null })) }); }}>
            <h3 className="span-all">{t("Add function space / room")}</h3>
            <Field label={t("Venue")}>
              <select required {...s.bind('venue_id')}>
                <option value="">{t("Choose…")}</option>{venues?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
            <Field label={t("Room name")}><input required {...s.bind('name')} placeholder={t("e.g. MIRQAB Ballroom")} /></Field>
            <Field label={t("Capacity")}><input {...s.bindNum('capacity')} /></Field>
            <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}>
              <input type="checkbox" checked={s.form.allow_overlap} onChange={(e) => s.set('allow_overlap')(e.target.checked)} />{t("Shareable (no clash checks)")}</label>
            <div><button className="primary" disabled={addSpace.isPending}>{t("Add room")}</button></div>
            <div className="span-all"><ErrorNote error={addSpace.error} /></div>
          </form>
        </div>
      )}
      <div className="card flush">
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t("Venue")}</th><th>{t("Kind")}</th><th>{t("Rooms")}</th><th /></tr></thead>
            <tbody>
              {venues?.length === 0 && <tr><td colSpan={4} className="empty">{t("No venues yet.")}</td></tr>}
              {venues?.map((x) => (
                <tr key={x.id} style={{ opacity: x.is_active ? 1 : 0.5 }}>
                  <td><strong>{x.name}</strong></td>
                  <td>{x.kind.replace('_', ' ')}</td>
                  <td>
                    <div className="row">
                      {x.spaces.map((sp) => (
                        <span key={sp.id} className="tag" style={{ opacity: sp.is_active ? 1 : 0.5 }}>
                          {sp.name}{sp.capacity ? ` · ${sp.capacity}` : ''}{sp.allow_overlap ? t(" · shared") : ''}
                          {can('manage') && <button className="sm ghost" style={{ padding: '0 4px' }} title={sp.is_active ? t("Deactivate") : t("Activate")}
                            onClick={() => toggle.mutate({ id: sp.id, is_active: !sp.is_active, kind: 'function-spaces' })}>{sp.is_active ? '✕' : '↺'}</button>}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="num">{can('manage') && <button className="sm ghost" onClick={() => toggle.mutate({ id: x.id, is_active: !x.is_active, kind: 'venues' })}>{x.is_active ? t("Deactivate") : t("Activate")}</button>}</td>
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
      <p className="secondary" style={{ margin: 0 }}>{t("Brands or companies inside your workspace. The code prefixes booking numbers, e.g.")}{' '}<strong>W</strong>2026001.</p>
      <div className="card flush">
        <table>
          <thead><tr><th>{t("Code")}</th><th>{t("Name")}</th></tr></thead>
          <tbody>{data?.map((u) => <tr key={u.id}><td><span className="tag">{u.code}</span></td><td>{u.name}</td></tr>)}</tbody>
        </table>
      </div>
      {can('admin') && (
        <form className="card form-grid" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined, { onSuccess: () => setForm({ code: '', name: '' }) }); }}>
          <Field label={t("Code")}><input required maxLength={4} {...bind('code')} /></Field>
          <Field label={t("Name")}><input required {...bind('name')} /></Field>
          <div style={{ alignSelf: 'end' }}><button className="primary">{t("Add unit")}</button></div>
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

/** Languages other than English get a translation column in the pick-lists. */
const OTHER_LANGS = LANGUAGES.filter((l) => l.code !== 'en');

function Lists() {
  const { can } = useAuth();
  const { data } = useLookups();
  const [type, setType] = useState('event_type');
  const { form, setForm, bind } = useForm({ code: '', label: '' });
  const add = useSave(() => api('/lookups', { body: { ...form, type, sort_order: (data?.[type]?.length ?? 0) + 1 } }), [['lookups']]);
  const toggle = useSave((x: { id: string; is_active: boolean }) => api(`/lookups/${x.id}`, { method: 'PATCH', body: { is_active: x.is_active } }), [['lookups']]);
  const translate = useSave((x: { id: string; translations: Record<string, string> }) =>
    api(`/lookups/${x.id}`, { method: 'PATCH', body: { translations: x.translations } }), [['lookups']]);
  return (
    <div className="grid-2" style={{ gridTemplateColumns: '220px 1fr' }}>
      <div className="card" style={{ padding: 8 }}>
        {LIST_TYPES.map(([k, l]) => (
          <button key={k} className={`ghost ${type === k ? 'active' : ''}`} style={{ width: '100%', justifyContent: 'space-between', color: type === k ? 'var(--accent)' : undefined }} onClick={() => setType(k)}>
            {t(l)}<span className="muted small">{data?.[k]?.length ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="stack">
        <div className="card flush">
          <table>
            <thead><tr><th>{t("Code")}</th><th>{t("Label")}</th>{OTHER_LANGS.map((l) => <th key={l.code}>{l.name}</th>)}<th /></tr></thead>
            <tbody>
              {(data?.[type] ?? []).map((l) => (
                <tr key={l.id} style={{ opacity: l.is_active ? 1 : 0.5 }}>
                  <td><span className="tag">{l.code}</span></td><td>{l.label}</td>
                  {OTHER_LANGS.map((lng) => (
                    <td key={lng.code}>
                      <input lang={lng.code} dir={lng.dir} defaultValue={l.translations?.[lng.code] ?? ''} disabled={!can('admin')} placeholder="—"
                        aria-label={`${l.label} · ${lng.name}`}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v === (l.translations?.[lng.code] ?? '')) return;
                          const next = { ...(l.translations ?? {}), [lng.code]: v };
                          if (!v) delete next[lng.code];
                          translate.mutate({ id: l.id, translations: next });
                        }} />
                    </td>
                  ))}
                  <td className="num">{can('admin') && <button className="sm ghost" onClick={() => toggle.mutate({ id: l.id, is_active: !l.is_active })}>{l.is_active ? t("Hide") : t("Show")}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {can('admin') && (
          <form className="card form-grid" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined, { onSuccess: () => setForm({ code: '', label: '' }) }); }}>
            <Field label={t("Code")}><input required maxLength={40} {...bind('code')} /></Field>
            <Field label={t("Label")}><input required {...bind('label')} /></Field>
            <div style={{ alignSelf: 'end' }}><button className="primary">{t("Add")}</button></div>
            <div className="span-all"><ErrorNote error={add.error} /></div>
          </form>
        )}
      </div>
    </div>
  );
}

/** Full workspace export (admins): every table, users and permissions; never passwords. */
function Export() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const year = new Date().getFullYear();
  async function get(path: string, name: string) {
    setBusy(name);
    setError(null);
    try {
      await download(path, name);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <ErrorNote error={error} />
      <div className="card stack">
        <h3>{t('Full workspace export')}</h3>
        <p className="secondary" style={{ margin: 0 }}>
          {t('Everything in this workspace: bookings with their finance figures, events, lines, payments, commissions, follow-ups, history and audit log, clients, venues and rooms, pick-lists with translations, business units, users with their roles, reporting lines and what they can see, cover arrangements, and a permissions matrix. Passwords are never included. Workspace owners are notified of every export.')}
        </p>
        <div className="row">
          <button className="primary" disabled={!!busy} onClick={() => get('/export/workspace?format=xlsx', `workspace-export-${year}.xlsx`)}>
            {busy?.endsWith('.xlsx') ? t('Preparing…') : t('Download Excel (one sheet per table)')}
          </button>
          <button disabled={!!busy} onClick={() => get('/export/workspace?format=json', `workspace-export-${year}.json`)}>
            {busy?.endsWith('.json') ? t('Preparing…') : t('Download JSON (for other systems)')}
          </button>
        </div>
      </div>
      <div className="card stack">
        <h3>{t('Contracts sheet')}</h3>
        <p className="secondary" style={{ margin: 0 }}>{t('Bookings laid out like the CONTRACTS sheet of the daily report, for one year.')}</p>
        <div><button disabled={!!busy} onClick={() => get(`/reports/contracts.xlsx?year=${year}`, `contracts-${year}.xlsx`)}>{t('Download {year}', { year })}</button></div>
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
        <h3>{t("Import your daily report workbook")}</h3>
        <p className="secondary" style={{ margin: '4px 0 0' }}>{t("Upload the")}{' '}<strong>{t(".xlsx")}</strong>{' '}{t("with a")}{' '}<strong>{t("CONTRACTS")}</strong>{' '}{t("sheet (headers in row 2, data from row 3 until “end”) and optionally the")}<strong>{' '}{t("PAR")}</strong>{' '}{t("sheet. Bookings are matched on CONTRACT ID, so re-importing updates them instead of duplicating. Clients are matched on phone number; venues, rooms, account managers, sources and event types are created as needed.")}</p>
      </div>
      <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <div><button className="primary" disabled={!file || run.isPending} onClick={() => run.mutate(undefined)}>{run.isPending ? t("Importing…") : t("Import")}</button></div>
      <ErrorNote error={run.error} />
      {r && (
        <div className="stack">
          <div className="alert info">{t("Imported:")}{' '}{r.bookings_created}{' '}{t("new and")}{' '}{r.bookings_updated}{' '}{t("updated bookings,")}{' '}{r.contacts_created}{' '}{t("clients,")}{' '}{r.venues_created}{' '}{t("venues,")}{' '}{r.users_created}{' '}{t("account managers,")}{' '}{r.activities_created}{' '}{t("meetings.")}</div>
          {r.errors.length > 0 && (
            <div className="alert">
              {r.errors.length}{' '}{t("rows failed:")}<ul>{r.errors.slice(0, 20).map((e) => <li key={e.row}>{t("Row")}{' '}{e.row} {e.booking_no}: {e.message}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
