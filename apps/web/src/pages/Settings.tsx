import { RotateCcw, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, download, LEVEL_NAMES, type ContractField, type DataRight, type Department, type Role, type User } from '../api';
import { useAuth } from '../auth';
import { TemplatesAdmin } from '../components/TemplatesAdmin';
import { ErrorNote, Field, Modal, Tabs, useForm } from '../components/ui';
import { date, dateTime } from '../format';
import { useBusinessUnits, useDepartments, useLookups, useSave, useUsers, useVenues } from '../hooks';
import { LANGUAGES, t } from '../i18n';

type Tab = 'company' | 'team' | 'departments' | 'permissions' | 'modules' | 'venues' | 'units' | 'lists' | 'templates' | 'fields' | 'deactivated' | 'import' | 'export' | 'it';

export function Settings() {
  const { can, me } = useAuth();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab | null) ?? 'company');
  // Links from notifications (e.g. a password request) open a given tab.
  useEffect(() => { const p = params.get('tab') as Tab | null; if (p) setTab(p); }, [params]);
  const tabs: [Tab, string][] = [['company', 'Company'], ['team', 'Team'], ['departments', 'Departments'], ['permissions', 'Permissions'], ['venues', 'Venues & rooms'], ['units', 'Business units'], ['lists', 'Pick-lists']];
  if (can('manage')) tabs.push(['templates', 'Templates'], ['deactivated', 'Deactivated records']);
  if (can('admin')) tabs.push(['modules', 'Modules'], ['fields', 'Contract fields'], ['import', 'Import from Excel'], ...(me?.rights.export ? [['export', 'Export'] as [Tab, string]] : []), ['it', 'IT']);
  return (
    <>
      <div className="page-head"><div><h1>{t("Admin & IT")}</h1><p>{t("Configure your workspace, team and sales pick-lists.")}</p></div></div>
      {!can('admin') && <div className="alert info" style={{ marginBottom: 16 }}>{t("Only owners and admins can change most settings.")}</div>}
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'company' && <Company />}
      {tab === 'team' && <Team />}
      {tab === 'departments' && <Departments />}
      {tab === 'permissions' && <Permissions />}
      {tab === 'modules' && <Modules />}
      {tab === 'venues' && <Venues />}
      {tab === 'units' && <Units />}
      {tab === 'lists' && <Lists />}
      {tab === 'templates' && <TemplatesAdmin />}
      {tab === 'fields' && <ContractFields />}
      {tab === 'deactivated' && <Deactivated />}
      {tab === 'it' && <ItStatus />}
      {tab === 'import' && <div className="stack"><Import /><CrmImport /></div>}
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
      <div>
        <h3>{t('Group logo')}</h3>
        <p className="secondary small" style={{ margin: '4px 0 12px' }}>{t('Shown in the top-left corner to everyone without a company (owners, admins), and to companies that have no logo of their own. Each company sets its own under Business units.')}</p>
        <LogoSlots owner="group" />
      </div>
    </form>
  );
}

/**
 * The two versions of a logo: the black one for the light theme, the white one for the dark
 * theme, each previewed on its own background. PNG, JPEG, WebP or SVG, up to 300 kB.
 */
function LogoSlots({ owner }: { owner: string }) {
  const { can } = useAuth();
  const { data } = useQuery({ queryKey: ['logos'], queryFn: () => api<{ group: Urls; units: Record<string, Urls> }>('/logos'), enabled: can('admin') });
  const urls = owner === 'group' ? data?.group : data?.units[owner];
  const inv: [string][] = [['logos'], ['me'], ['business-units']];
  const upload = useSave((v: { variant: 'light' | 'dark'; file: File }) => {
    const form = new FormData();
    form.append('file', v.file);
    return api(`/logos/${owner}/${v.variant}`, { method: 'PUT', form });
  }, inv);
  const remove = useSave((variant: 'light' | 'dark') => api(`/logos/${owner}/${variant}`, { method: 'DELETE' }), inv);
  const slot = (variant: 'light' | 'dark', label: string) => (
    <div className={`logo-slot ${variant}`}>
      <div className="logo-slot-preview">{urls?.[variant] ? <img src={urls[variant]!} alt={label} /> : <span className="small">{t('No logo')}</span>}</div>
      <div className="small secondary">{label}</div>
      {can('admin') && (
        <div className="row">
          <label className="btn sm">{urls?.[variant] ? t('Replace') : t('Upload')}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden
              onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) upload.mutate({ variant, file }); }} />
          </label>
          {urls?.[variant] && <button type="button" className="sm ghost danger" onClick={() => remove.mutate(variant)}>{t('Remove')}</button>}
        </div>
      )}
    </div>
  );
  return (
    <div className="stack" style={{ gap: 8 }}>
      <ErrorNote error={upload.error ?? remove.error} />
      <div className="logo-slots">
        {slot('light', t('Light theme (black logo)'))}
        {slot('dark', t('Dark theme (white logo)'))}
      </div>
    </div>
  );
}
type Urls = { light: string | null; dark: string | null };

const ROLES: [Role, string][] = [
  ['owner', 'Owner'], ['admin', 'Admin'], ['manager', 'Sales manager'], ['sales', 'Sales / account manager'],
  ['marketing', 'Marketing'], ['finance', 'Finance'], ['viewer', 'Viewer'],
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
  const { data: units } = useBusinessUnits();
  const { data: departments } = useDepartments();
  const [editing, setEditing] = useState<Partial<User> | null>(null);
  // ?user=<id> (from a "forgot their password" notification) opens that person's form.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = params.get('user');
    const found = id && users?.find((u) => u.id === id);
    if (!found) return;
    setEditing(found);
    const next = new URLSearchParams(params);
    next.delete('user');
    setParams(next, { replace: true });
  }, [params, users, setParams]);
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
          <span className="muted small">{[departments?.find((d) => d.id === u.department_id)?.name, u.level ? `${t('Level')} ${u.level}` : null].filter(Boolean).join(' · ')}</span>
          {canTransfer(u) && u.is_active && <button className="sm ghost" onClick={() => setTransferring(u)}>{t("Transfer…")}</button>}
          {can('admin') && <button className="sm ghost" onClick={() => setEditing(u)}>{t("Edit")}</button>}
        </div>
        {(kids.get(u.id) ?? []).length > 0 && (
          <ul>{kids.get(u.id)!.map((k) => <Node key={k.id} u={k} depth={depth + 1} />)}</ul>
        )}
      </li>
    );
  };

  // Totals (customer request): people who can sign in, disabled ones, and active people without a login.
  const activeUsers = users?.filter((u) => u.is_active && u.email).length ?? 0;
  const disabledUsers = users?.filter((u) => !u.is_active).length ?? 0;
  const noLogin = users?.filter((u) => u.is_active && !u.email).length ?? 0;

  return (
    <div className="stack">
    <div className="kpis user-totals" role="group" aria-label={t('Users')}>
      <div className="kpi"><div className="kpi-label">{t('Active users')}</div><div className="kpi-value">{activeUsers}</div><div className="kpi-sub">{t('can sign in')}</div></div>
      <div className="kpi"><div className="kpi-label">{t('Disabled users')}</div><div className="kpi-value">{disabledUsers}</div><div className="kpi-sub">{t('cannot sign in')}</div></div>
      <div className="kpi"><div className="kpi-label">{t('Without a login')}</div><div className="kpi-value">{noLogin}</div><div className="kpi-sub">{t('e.g. imported account managers')}</div></div>
    </div>
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
            <thead><tr><th>{t("Name")}</th><th>{t("Department")}</th><th>{t("Level")}</th><th>{t("Company")}</th><th>{t("Employee ID")}</th><th>{t("Code")}</th><th>{t("Email")}</th><th>{t("Role")}</th><th>{t("Reports to")}</th><th>{t("Can see")}</th><th>{t("Status")}</th><th>{t("Last login")}</th><th /></tr></thead>
            <tbody>
              {users?.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}{u.job_title && <div className="small muted">{u.job_title}</div>}</td>
                  <td>{departments?.find((d) => d.id === u.department_id)?.name ?? '—'}</td>
                  <td>{u.level ? <span title={t(LEVEL_NAMES[u.level])}>{u.level} · {t(LEVEL_NAMES[u.level])}</span> : '—'}</td>
                  <td>{units?.find((b) => b.id === u.business_unit_id)?.name ?? t('Group')}</td>
                  <td className="small">{u.employee_no ?? '—'}{u.hired_on && <div className="muted">{t('since')} {date(u.hired_on)}</div>}</td>
                  <td><span className="tag">{u.code ?? '—'}</span></td><td>{u.email ?? '—'}</td>
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
    manager_id: user.manager_id ?? null, data_scope: user.data_scope ?? 'team', hired_on: user.hired_on?.slice(0, 10) ?? null,
    job_title: user.job_title ?? null, business_unit_id: user.business_unit_id ?? null,
    department_id: user.department_id ?? null, level: user.level ?? null,
    permission_overrides: (user.permission_overrides ?? {}) as Partial<Record<DataRight, boolean>>,
  });
  const { data: units } = useBusinessUnits();
  const { data: departments } = useDepartments();
  const { data: perms } = useQuery({ queryKey: ['permissions'], queryFn: () => api<PermissionsData>('/permissions') });
  const levelRights = form.level ? perms?.rights[form.level] : undefined;
  const setOverride = (r: DataRight, v: string) => {
    const next = { ...form.permission_overrides };
    if (v === '') delete next[r]; else next[r] = v === 'yes';
    set('permission_overrides')(next);
  };
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
          <Field label={user.employee_no ? `${t("Hiring date")} · ${user.employee_no}` : t("Hiring date (sets the employee ID year)")}>
            <input type="date" value={form.hired_on ?? ''} onChange={(e) => set('hired_on')(e.target.value || null)} />
          </Field>
          <Field label={t("Job title (shown under the name)")}><input maxLength={60} {...bind('job_title')} placeholder={t('e.g. Owner')} /></Field>
          <Field label={t("Company (logo and colour)")}>
            <select value={form.business_unit_id ?? ''} onChange={(e) => set('business_unit_id')(e.target.value || null)}>
              <option value="">{t('— the group —')}</option>
              {units?.filter((b) => b.is_active || b.id === form.business_unit_id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label={t("Department")}>
            <select value={form.department_id ?? ''} onChange={(e) => set('department_id')(e.target.value || null)}>
              <option value="">{t('— none —')}</option>
              {departments?.filter((d) => d.is_active || d.id === form.department_id).map((d) => <option key={d.id} value={d.id}>{t(d.name)}</option>)}
            </select>
          </Field>
          <Field label={t("Level (what they may do with data)")}>
            <select value={form.level ?? ''} onChange={(e) => set('level')(e.target.value ? Number(e.target.value) : null)} disabled={user.id === me?.id && me?.role !== 'owner'}>
              <option value="">{t('— from the role —')}</option>
              {Object.entries(LEVEL_NAMES).map(([n, name]) => <option key={n} value={n}>{n} · {t(name)}</option>)}
            </select>
          </Field>
          <div className="span-all exceptions">
            <div className="small secondary">{t('Personal exceptions (e.g. a junior on probation): leave "As level" to follow the level.')}</div>
            <div className="row">
              {RIGHTS.map(([r, label]) => (
                <Field key={r} label={t(label)}>
                  <select value={form.permission_overrides[r] === undefined ? '' : form.permission_overrides[r] ? 'yes' : 'no'}
                    onChange={(e) => setOverride(r, e.target.value)} disabled={user.id === me?.id && me?.role !== 'owner'}>
                    <option value="">{t('As level')}{levelRights ? ` (${levelRights[r] ? t('yes') : t('no')})` : ''}</option>
                    <option value="yes">{t('Yes')}</option>
                    <option value="no">{t('No')}</option>
                  </select>
                </Field>
              ))}
            </div>
          </div>
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

type PermissionsData = { levels: Record<string, string>; rights: Record<number, Record<DataRight, boolean>>; defaults: Record<number, Record<DataRight, boolean>> };
const RIGHTS: [DataRight, string][] = [['export', 'Export Excel'], ['download', 'Download documents & files'], ['print', 'Print documents'], ['hr', 'Manage employee records (HR)']];

/** Departments for the org chart. */
function Departments() {
  const { can } = useAuth();
  const { data } = useDepartments();
  const [name, setName] = useState('');
  const inv: [string][] = [['departments']];
  const add = useSave(() => api('/departments', { body: { name, sort_order: (data?.length ?? 0) + 1 } }), inv);
  const update = useSave((v: { id: string; body: Partial<Department> }) => api(`/departments/${v.id}`, { method: 'PATCH', body: v.body }), inv);
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <p className="secondary" style={{ margin: 0 }}>{t('Departments group people in the org chart. Set each person\'s department under Team.')}</p>
      <ErrorNote error={add.error ?? update.error} />
      <div className="card flush">
        <table>
          <thead><tr><th>{t('Department')}</th><th>{t('Status')}</th><th /></tr></thead>
          <tbody>
            {data?.map((d) => (
              <tr key={d.id} style={{ opacity: d.is_active ? 1 : 0.55 }}>
                <td>{can('admin')
                  ? <input defaultValue={d.name} aria-label={t('Department')} onBlur={(e) => e.target.value.trim() && e.target.value !== d.name && update.mutate({ id: d.id, body: { name: e.target.value.trim() } })} />
                  : t(d.name)}</td>
                <td>{d.is_active ? t('Active') : t('Inactive')}</td>
                <td className="num">{can('admin') && <button className="sm ghost" onClick={() => update.mutate({ id: d.id, body: { is_active: !d.is_active } })}>{d.is_active ? t('Deactivate') : t('Activate')}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {can('admin') && (
        <form className="card row" onSubmit={(e) => { e.preventDefault(); add.mutate(undefined, { onSuccess: () => setName('') }); }}>
          <Field label={t('New department')}><input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <div style={{ alignSelf: 'end' }}><button className="primary">{t('Add')}</button></div>
        </form>
      )}
    </div>
  );
}

/** What each level may do with data: export Excel, download and print documents. */
function Permissions() {
  const { can } = useAuth();
  const { data } = useQuery({ queryKey: ['permissions'], queryFn: () => api<PermissionsData>('/permissions') });
  const [draft, setDraft] = useState<Record<number, Record<DataRight, boolean>> | null>(null);
  const rights = draft ?? data?.rights;
  const save = useSave(() => api('/permissions', { method: 'PUT', body: draft }), [['permissions'], ['me']]);
  const toggle = (level: number, r: DataRight) => rights && setDraft({ ...rights, [level]: { ...rights[level], [r]: !rights[level][r] } });
  return (
    <div className="stack permissions-tab">
      <p className="secondary" style={{ margin: 0 }}>
        {t('What each level may do with data. People without "Download" view documents on screen only, with their name on every page. Personal exceptions are set per person under Team. Owners can always do everything.')}
      </p>
      <ErrorNote error={save.error} />
      <div className="card flush table-wrap">
        <table>
          <thead><tr><th>{t('Right')}</th>{Object.entries(LEVEL_NAMES).map(([n, name]) => <th key={n} className="num">{n}<div className="small muted">{t(name)}</div></th>)}</tr></thead>
          <tbody>
            {RIGHTS.map(([r, label]) => (
              <tr key={r}>
                <td>{t(label)}</td>
                {Object.keys(LEVEL_NAMES).map(Number).map((n) => (
                  <td key={n} className="num">
                    <input type="checkbox" aria-label={`${t(label)} · ${t(LEVEL_NAMES[n])}`} checked={rights?.[n]?.[r] ?? false}
                      disabled={!can('admin')} onChange={() => toggle(n, r)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {can('admin') && (
        <div className="row">
          <button className="primary" disabled={!draft || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => setDraft(null) })}>{t('Save')}</button>
          {draft && <button className="ghost" onClick={() => setDraft(null)}>{t('Cancel')}</button>}
          {save.isSuccess && !draft && <span className="small muted">{t('Saved.')}</span>}
        </div>
      )}
    </div>
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
                            onClick={() => toggle.mutate({ id: sp.id, is_active: !sp.is_active, kind: 'function-spaces' })}>{sp.is_active ? <X className="ico" aria-hidden /> : <RotateCcw className="ico" aria-hidden />}</button>}
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

/** A company's colour and logo (customer comment 6). */
function UnitIdentity({ unit }: { unit: import('../api').BusinessUnit }) {
  const { can } = useAuth();
  const [accent, setAccent] = useState(unit.accent ?? '');
  const save = useSave((v: string | null) => api(`/business-units/${unit.id}`, { method: 'PATCH', body: { accent: v } }), [['business-units'], ['me']]);
  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="spread">
        <div className="row"><span className="tag">{unit.code}</span><strong>{unit.name}</strong></div>
        <div className="row">
          <span className="small secondary">{t('Colour')}</span>
          <input type="color" value={accent || '#2a78d6'} disabled={!can('admin')} aria-label={t('Colour')}
            onChange={(e) => setAccent(e.target.value)} onBlur={() => accent !== (unit.accent ?? '') && save.mutate(accent || null)} />
          <input value={accent} placeholder="#E6007E" maxLength={7} disabled={!can('admin')} style={{ width: 96 }} aria-label={t('Colour code')}
            onChange={(e) => setAccent(e.target.value)} onBlur={() => /^#[0-9a-fA-F]{6}$|^$/.test(accent) && accent !== (unit.accent ?? '') && save.mutate(accent || null)} />
          {save.isSuccess && <span className="small muted">{t('Saved.')}</span>}
        </div>
      </div>
      <ErrorNote error={save.error} />
      <LogoSlots owner={unit.id} />
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
      <p className="secondary" style={{ margin: 0 }}>{t("Companies inside your group. The code prefixes booking numbers, e.g.")}{' '}<strong>W</strong>2026001.</p>
      <p className="secondary small" style={{ margin: 0 }}>{t("Each company's colour is used for highlights (the selected menu item, buttons, links) by the people who work for it, and its logo shows in their top-left corner.")}</p>
      {data?.map((u) => <UnitIdentity key={u.id} unit={u} />)}
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
  ['branch', 'Branches'], ['event_type', 'Event types'], ['design', 'Designs'], ['source', 'Lead sources'], ['lost_reason', 'Lost reasons'], ['item_category', 'Line categories'],
  ['setup_style', 'Setup styles'], ['payment_method', 'Payment methods'], ['bank_account', 'Bank accounts'], ['business_type', 'Business types'],
  // CRM (customer workbook, sheet PAR)
  ['relation', 'Relationships'], ['relation_old', 'Relationships (earlier list)'], ['segment', 'Segments'], ['industry', 'Industries'],
  ['title', 'Titles'], ['contact_mode', 'Contact modes'], ['education', 'Education levels'],
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

interface CrmReport {
  rows: number; people_created: number; companies_created: number; merged: number; relationships: number; applicants: number;
  cleaned_names: string[]; unknown_users: string[]; unknown_contracts: string[]; skipped: string[];
}

/** The CRM workbook (DB_CRM_Segm, sheet DB): customers, relationships and applicant profiles. */
function CrmImport() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const run = useSave(async () => {
    const form = new FormData();
    form.append('file', file!);
    const result = await api<CrmReport>('/import/crm', { form });
    await qc.invalidateQueries();
    return result;
  });
  const r = run.data;
  const list = (title: string, items: string[]) => items.length > 0 && (
    <div><strong>{title}</strong> ({items.length})<ul style={{ margin: '4px 0 0' }}>{items.slice(0, 30).map((x) => <li key={x}>{x}</li>)}</ul></div>
  );
  return (
    <div className="card stack" style={{ maxWidth: 760 }}>
      <div>
        <h3>{t('Import the CRM workbook')}</h3>
        <p className="secondary" style={{ margin: '4px 0 0' }}>
          {t('Upload the CRM workbook (sheet DB, headers in row 2, columns in their usual order). Rows with the same email or mobile become one customer with several relationships; customers already in the CRM get the new relationships. Re-importing adds nothing twice.')}
        </p>
      </div>
      <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <div><button className="primary" disabled={!file || run.isPending} onClick={() => run.mutate(undefined)}>{run.isPending ? t('Importing…') : t('Import')}</button></div>
      <ErrorNote error={run.error} />
      {r && (
        <div className="stack">
          <div className="alert info">
            {t('{rows} rows: {people} new people, {companies} new companies, {merged} added to existing customers, {rel} relationships, {app} applicant profiles.',
              { rows: r.rows, people: r.people_created, companies: r.companies_created, merged: r.merged, rel: r.relationships, app: r.applicants })}
          </div>
          {list(t('Names joined (check them)'), r.cleaned_names)}
          {list(t('Users not found (kept in the comments)'), r.unknown_users)}
          {list(t('Contract IDs not found (kept in the comments)'), r.unknown_contracts)}
          {list(t('Rows skipped'), r.skipped)}
        </div>
      )}
    </div>
  );
}

/** Which contract fields each role sees. Hidden fields are removed by the server, not just on screen. */
const FIELD_GROUPS: [ContractField, string, string][] = [
  ['finance', 'Finance figures', 'Revenue, cost, margin, fixed and CF cost, net profit, commission, shares, outstanding, aging'],
  ['contract_value', 'Total contract value', ''],
  ['money_received', 'Money received (DP)', 'Down payments and receipts'],
  ['source', 'Source', ''],
  ['owner', 'Account manager', ''],
  ['business_unit', 'Company', ''],
  ['branch', 'Branch', ''],
  ['design', 'Design', ''],
  ['event_type', 'Event type', ''],
  ['pax', 'Pax / units', ''],
  ['rate', 'Rate and term days', ''],
  ['credit_facility', 'Credit facility', ''],
];
const FIELD_ROLES = ['manager', 'sales', 'marketing', 'finance', 'viewer'] as const;

function ContractFields() {
  const { me } = useAuth();
  const [vis, setVis] = useState<Partial<Record<Role, ContractField[]>>>(me!.tenant.field_visibility ?? {});
  const save = useSave(() => api('/tenant', { method: 'PATCH', body: { field_visibility: vis } }), [['me'], ['bookings'], ['booking']]);
  const isHidden = (role: Role, f: ContractField) => (vis[role] ?? []).includes(f);
  const toggle = (role: Role, f: ContractField) => setVis((v) => {
    const list = v[role] ?? [];
    return { ...v, [role]: list.includes(f) ? list.filter((x) => x !== f) : [...list, f] };
  });
  return (
    <form className="card stack" style={{ maxWidth: 860 }} onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
      <div>
        <h3 style={{ margin: 0 }}>{t('Who sees which contract fields')}</h3>
        <p className="secondary small" style={{ margin: '4px 0 0' }}>
          {t('Untick a field to hide it from a role on screens, lists, exports and the API. Owners and admins always see everything.')}
        </p>
      </div>
      <ErrorNote error={save.error} />
      <div className="table-wrap">
        <table className="field-matrix">
          <thead><tr><th>{t('Field')}</th>{FIELD_ROLES.map((r) => <th key={r} className="num">{ROLE_LABEL[r]}</th>)}</tr></thead>
          <tbody>
            {FIELD_GROUPS.map(([f, label, hint]) => (
              <tr key={f}>
                <td>{t(label)}{hint && <div className="small muted">{t(hint)}</div>}</td>
                {FIELD_ROLES.map((r) => (
                  <td key={r} className="num">
                    <input type="checkbox" checked={!isHidden(r, f)} onChange={() => toggle(r, f)}
                      aria-label={t('{role} sees {field}', { role: ROLE_LABEL[r], field: t(label) })} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button className="primary" disabled={save.isPending}>{t('Save')}</button>
        {save.isSuccess && <span className="small good">{t('Saved.')}</span>}
      </div>
    </form>
  );
}

/** Admin → Deactivated records: things entered by mistake. Managers restore; admins delete for good. */
type DeactivatedRow = { id: string; code: string; name: string; deactivated_at: string; deactivate_reason: string; deactivated_by_name: string | null };
const DEACTIVATED_KINDS: [string, string][] = [['bookings', 'Contracts'], ['contacts', 'Customers'], ['accounts', 'Companies'], ['activities', 'Activities'], ['booking-files', 'Contract files']];

function Deactivated() {
  const { can } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['deactivated'], queryFn: () => api<Record<string, DeactivatedRow[]>>('/deactivated') });
  const inv = [['deactivated'], ['bookings'], ['contacts'], ['accounts'], ['activities'], ['dashboard']];
  const restore = useSave((v: { kind: string; id: string }) => api(`/${v.kind}/${v.id}/restore`, { body: {} }), inv);
  const remove = useSave((v: { kind: string; id: string }) => api(`/${v.kind}/${v.id}`, { method: 'DELETE' }), inv);
  return (
    <div className="stack" style={{ maxWidth: 960 }}>
      <p className="secondary" style={{ margin: 0 }}>
        {t('Records deactivated because they were entered by mistake. They are hidden from every screen, list, report and export. Restore one to bring it back; admins can delete it for good.')}
      </p>
      <ErrorNote error={restore.error ?? remove.error} />
      {isLoading && <div className="empty">{t('Loading…')}</div>}
      {DEACTIVATED_KINDS.map(([kind, label]) => (
        <div key={kind} className="card flush">
          <div className="card-head"><h2>{t(label)} <span className="muted small">({data?.[kind]?.length ?? 0})</span></h2></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t('ID')}</th><th>{t('Name')}</th><th>{t('Reason')}</th><th>{t('Deactivated by')}</th><th>{t('When')}</th><th /></tr></thead>
              <tbody>
                {!data?.[kind]?.length && <tr><td colSpan={6} className="empty">{t('Nothing deactivated.')}</td></tr>}
                {data?.[kind]?.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.code}</strong></td><td>{r.name}</td><td>{r.deactivate_reason}</td>
                    <td>{r.deactivated_by_name ?? '—'}</td><td>{dateTime(r.deactivated_at)}</td>
                    <td className="num">
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="sm" onClick={() => restore.mutate({ kind, id: r.id })}>{t('Restore')}</button>
                        {can('admin') && (
                          <button className="sm danger" onClick={() => confirm(t('Delete {name} for good? This cannot be undone.', { name: r.code ?? r.name })) && remove.mutate({ kind, id: r.id })}>
                            {t('Delete for good')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Admin → IT: version, database, backups, and who signed in or exported data. */
interface ItStatusData {
  version: string; started_at: string; node: string;
  database: { size: string; server: string; migration: string };
  counts: { active_users: number; contracts: number; customers: number; activities: number };
  backups: { configured: boolean; count: number; last: { file: string; at: string; bytes: number } | null };
  access_log: { created_at: string; action: string; detail: string | null; ip: string | null; user_name: string | null; role: string | null }[];
}

/** Access-log entries under Admin → IT. */
const ACCESS_ACTIONS: Record<string, string> = {
  sign_in: 'Signed in', export: 'Exported', password_change: 'Changed own password', password_reset: 'Password reset on the server',
  password_request: 'Asked for a new password (forgot it)',
  view_document: 'Viewed a document',
  view_employee: 'Viewed an employee record',
};

function ItStatus() {
  const { data, isLoading } = useQuery({ queryKey: ['it-status'], queryFn: () => api<ItStatusData>('/it/status') });
  if (isLoading || !data) return <div className="empty">{t('Loading…')}</div>;
  const ageHours = data.backups.last ? (Date.now() - new Date(data.backups.last.at).getTime()) / 3_600_000 : null;
  const stale = ageHours === null || ageHours > 36;
  return (
    <div className="stack" style={{ maxWidth: 960 }}>
      <div className="grid-3">
        <div className="card stack" style={{ gap: 6 }}>
          <h3 style={{ margin: 0 }}>{t('System')}</h3>
          <dl className="kv">
            <dt>{t('Version')}</dt><dd>{data.version}</dd>
            <dt>{t('Running since')}</dt><dd>{dateTime(data.started_at)}</dd>
            <dt>{t('Database')}</dt><dd>{data.database.server} · {data.database.size}</dd>
            <dt>{t('Schema')}</dt><dd className="small">{data.database.migration}</dd>
          </dl>
        </div>
        <div className={`card stack ${stale ? 'warn-card' : ''}`} style={{ gap: 6 }}>
          <h3 style={{ margin: 0 }}>{t('Backups')}</h3>
          {data.backups.last ? (
            <dl className="kv">
              <dt>{t('Last backup')}</dt><dd>{dateTime(data.backups.last.at)}</dd>
              <dt>{t('Size')}</dt><dd>{(data.backups.last.bytes / 1_048_576).toFixed(1)} MB</dd>
              <dt>{t('Kept')}</dt><dd>{t('{n} backups', { n: data.backups.count })}</dd>
            </dl>
          ) : <p className="small" style={{ margin: 0 }}>{data.backups.configured ? t('No backup found yet.') : t('Backups are not visible to the app on this server.')}</p>}
          {stale && <p className="small" style={{ margin: 0, color: 'var(--danger)' }}>{t('No backup in the last 36 hours. Check the backup service.')}</p>}
        </div>
        <div className="card stack" style={{ gap: 6 }}>
          <h3 style={{ margin: 0 }}>{t('Data')}</h3>
          <dl className="kv">
            <dt>{t('Active users')}</dt><dd>{data.counts.active_users}</dd>
            <dt>{t('Contracts')}</dt><dd>{data.counts.contracts}</dd>
            <dt>{t('Customers')}</dt><dd>{data.counts.customers}</dd>
            <dt>{t('Activities')}</dt><dd>{data.counts.activities}</dd>
          </dl>
        </div>
      </div>
      <div className="card flush">
        <div className="card-head"><h2>{t('Sign-ins and exports')}</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t('When')}</th><th>{t('Who')}</th><th>{t('What')}</th><th>{t('From')}</th></tr></thead>
            <tbody>
              {data.access_log.length === 0 && <tr><td colSpan={4} className="empty">{t('Nothing yet.')}</td></tr>}
              {data.access_log.map((l, i) => (
                <tr key={i}>
                  <td>{dateTime(l.created_at)}</td>
                  <td>{l.user_name ?? '—'}{l.role && <span className="muted small"> · {ROLE_LABEL[l.role as Role] ?? l.role}</span>}</td>
                  <td>{t(ACCESS_ACTIONS[l.action] ?? l.action)}{l.detail ? <span className="muted"> · {l.detail}</span> : null}</td>
                  <td className="small muted">{l.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface ModuleInfo { key: string; name: string; available: boolean; always: boolean; active: boolean; requested: boolean }

/** Modules the workspace subscribes to, and asking the SaaSERP team for more. */
function Modules() {
  const { data } = useQuery({ queryKey: ['modules'], queryFn: () => api<{ modules: ModuleInfo[]; requests: { module: string; status: string; requested_at: string; requested_by_name: string | null }[] }>('/modules') });
  const request = useSave((key: string) => api(`/modules/${key}/request`, { body: {} }), [['modules']]);
  const about: Record<string, string> = {
    sales: 'Contracts, CRM, activities, the function diary, dashboard and reports.',
    hr: 'Employee records, documents with expiry alerts, change requests from employees.',
    finance: 'Invoices, payments and accounts. Planned.',
  };
  return (
    <div className="stack">
      <p className="secondary" style={{ margin: 0 }}>
        {t('SaaSERP is made of modules. Each module works with the others; without one, the others keep working with less (for example, without HR people keep their Employee ID, department and level).')}
      </p>
      <ErrorNote error={request.error} />
      <div className="card flush table-wrap">
        <table>
          <thead><tr><th>{t('Module')}</th><th>{t('What it does')}</th><th>{t('Status')}</th></tr></thead>
          <tbody>
            {data?.modules.map((m) => (
              <tr key={m.key}>
                <td><strong>{t(m.name)}</strong></td>
                <td className="secondary">{t(about[m.key] ?? '')}</td>
                <td>
                  {m.active ? <span className="badge DEF"><span className="dot" aria-hidden />{m.always ? t('Included') : t('Active')}</span>
                    : !m.available ? <span className="muted">{t('Coming soon')}</span>
                      : m.requested ? <span className="badge TEN"><span className="dot" aria-hidden />{t('Requested')}</span>
                        : <button className="sm primary" disabled={request.isPending} onClick={() => request.mutate(m.key)}>{t('Request subscription')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!!data?.requests.length && (
        <div className="small secondary">
          {data.requests.map((r, i) => (
            <div key={i}>{dateTime(r.requested_at)} · {t(data.modules.find((m) => m.key === r.module)?.name ?? r.module)} · {t(r.status === 'pending' ? 'Requested' : r.status === 'granted' ? 'Active' : 'Declined')}{r.requested_by_name ? ` · ${r.requested_by_name}` : ''}</div>
          ))}
        </div>
      )}
    </div>
  );
}
