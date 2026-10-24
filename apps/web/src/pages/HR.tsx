import { AlertTriangle, Eye, Printer, Trash2, Upload } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { DocumentViewer, type ViewTarget } from '../components/DocumentViewer';
import { confirmDiscard, Empty, ErrorNote, Field, Modal, SkeletonRows, Tabs } from '../components/ui';
import { date, dateTime, money } from '../format';
import { useDepartments, useSave } from '../hooks';
import { t } from '../i18n';

/**
 * HR module, phase 1. HR basic (every workspace): the employee directory and org chart.
 * HR full (subscription): employee records from the joining form and the register, documents
 * with expiry alerts, change requests, the import and the printed form. The server decides what
 * each person sees: HR and levels 1–3 everyone, managers their team (no pay), everyone their own.
 */

interface Contact { name: string | null; relation: string | null; address: string | null; phone: string | null }
export interface Employee {
  id: string; employee_no: string; user_id: string | null; user_name?: string | null;
  first_name: string; last_name: string | null; initials: string | null; company: string | null; branch: string | null;
  department_id: string | null; department: string | null; position: string | null; manager_id: string | null; manager_name: string | null;
  reports_to_text: string | null; employment_type: string | null; status: 'active' | 'inactive';
  joining_date: string | null; end_date: string | null; end_reason: string | null;
  nationality: string | null; civil_id: string | null; civil_id_expiry: string | null; sponsor: string | null; passport_no: string | null;
  passport_expiry: string | null; work_permit_expiry: string | null; iqama_transfer_date: string | null; iqama_cancel_date: string | null;
  gender: 'F' | 'M' | null; birth_date: string | null; birth_place: string | null; marital_status: string | null; religion: string | null;
  children: number | null; education: string | null; major: string | null; driving_license: string | null;
  chronic_illness: string | null; allergies: string | null; criminal_record: string | null;
  work_phone: string | null; work_email: string | null;
  address_kw: string | null; phone_kw: string | null; email_personal: string | null; address_home: string | null; phone_home: string | null; email_home: string | null;
  emergency_contacts: Contact[];
  salary: number | null; allowance_extra: number | null; allowance_housing: number | null; allowance_ticket: number | null; allowance_transport: number | null;
  notes: string | null;
}
interface EmployeeDoc { id: string; kind: string; number: string | null; expiry_date: string | null; file_name: string; uploaded_at: string; uploaded_by_name: string | null }
interface ChangeRequest { id: string; text: string; status: 'open' | 'done'; requested_at: string; resolved_at: string | null; requested_by_name: string | null; resolved_by_name: string | null }
interface Detail extends Employee {
  documents: EmployeeDoc[]; requests: ChangeRequest[];
  expiring: { what: string; expiry: string; days_left: number }[];
  access: { see: boolean; pay: boolean; sensitive: boolean; edit: boolean; own: boolean };
  tier: Tier;
}
type Tier = 'basic' | 'full';
interface ListRow {
  /** Org-chart node: the record id, or u:<user id> for a sign-in without an HR record. */
  key: string; parent_key: string | null; id: string | null; user_id: string | null; work_phone: string | null; work_email: string | null;
  employee_no: string | null; first_name: string; last_name: string | null; company: string | null; branch: string | null;
  department: string | null; position: string | null; manager_name: string | null; employment_type: string | null; status: string;
  joining_date: string | null; nationality: string | null; salary: number | null; expiring_in: number | null;
}
interface Expiry { employee_id: string; what: string; expiry: string; days_left: number; first_name: string; last_name: string | null; employee_no: string }

const DOC_KINDS: [string, string][] = [
  ['civil_id', 'Civil ID'], ['passport', 'Passport'], ['cv', 'CV'], ['work_permit', 'Work permit'], ['medical', 'Medical certificate'],
  ['criminal_record', 'Criminal record certificate'], ['iban', 'IBAN certificate'], ['contract', 'Employment contract'], ['other', 'Other'],
];
const docLabel = (k: string) => t(DOC_KINDS.find(([key]) => key === k)?.[1] ?? k);
const fullName = (e: { first_name: string; last_name: string | null }) => [e.first_name, e.last_name].filter(Boolean).join(' ');

function ExpiryFlag({ days }: { days: number | null }) {
  if (days === null || days === undefined) return null;
  return (
    <span className={`flag ${days < 0 ? 'bad' : ''}`} title={t('A document expires soon')}>
      <AlertTriangle className="ico" aria-hidden /> {days < 0 ? t('Expired') : days === 0 ? t('Today') : t('{n} days', { n: days })}
    </span>
  );
}

// ---- the list ------------------------------------------------------------------------

export function HrPage() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'employees') as 'employees' | 'org' | 'expiring' | 'requests' | 'import';
  const setTab = (v: string) => setParams(v === 'employees' ? {} : { tab: v }, { replace: true });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [creating, setCreating] = useState<Partial<Employee> | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['hr', 'employees'], queryFn: () => api<{ tier: Tier; can_edit: boolean; employees: ListRow[] }>('/hr/employees') });
  const isHr = Boolean(data?.can_edit);
  const full = data?.tier === 'full';

  // Someone who may only see their own record goes straight to it.
  useEffect(() => {
    if (data && !isHr && (me?.level ?? 6) > 3 && data.employees.length === 1 && data.employees[0].id === me?.employee_id) {
      navigate(`/hr/${data.employees[0].id}`, { replace: true });
    }
  }, [data, isHr, me, navigate]);

  const tabs: [string, string][] = [['employees', full ? 'Employees' : 'Directory'], ['org', 'Org chart']];
  if (full) tabs.push(['expiring', 'Expiring soon']);
  if (full && isHr) tabs.push(['requests', 'Change requests'], ['import', 'Import from Excel']);
  const open = (e: ListRow) => {
    if (e.id) navigate(`/hr/${e.id}`);
    else if (isHr) setCreating({ user_id: e.user_id, first_name: e.first_name, employee_no: e.employee_no ?? undefined, position: e.position, status: 'active' });
  };
  const showPay = data?.employees.some((e) => e.salary !== null);
  const rows = (data?.employees ?? []).filter((e) => (!status || e.status === status)
    && `${e.employee_no} ${fullName(e)} ${e.position ?? ''} ${e.department ?? ''} ${e.company ?? ''} ${e.branch ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('HR')}</h1>
          <p>{full ? t('Employee records, documents and expiry dates.') : t('Employee directory and org chart.')}</p>
        </div>
        <div className="row">
          {me?.employee_id && <button onClick={() => navigate(`/hr/${me.employee_id}`)}>{t('My record')}</button>}
          {isHr && <button className="primary" onClick={() => setCreating({ status: 'active' })}>{t('New employee')}</button>}
        </div>
      </div>
      <ErrorNote error={error} />
      {data && !full && <BasicNote />}
      <Tabs value={tab} onChange={setTab} tabs={tabs as [typeof tab, string][]} />

      {tab === 'employees' && (
        <>
          <div className="filters">
            <input type="search" placeholder={t('Search name, employee ID, position…')} value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('Status')}>
              <option value="active">{t('Active')}</option>
              <option value="inactive">{t('Inactive')}</option>
              <option value="">{t('All')}</option>
            </select>
          </div>
          <div className="card flush">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('Employee ID')}</th><th>{t('Name')}</th><th>{t('Position')}</th><th>{t('Department')}</th><th>{t('Reports to')}</th>
                    <th>{t('Company / branch')}</th><th>{t('Work contact')}</th>
                    {full && <><th>{t('Joined')}</th>{showPay && <th className="num">{t('Salary')}</th>}<th>{t('Expiry')}</th></>}
                  </tr>
                </thead>
                <tbody>
                  {isLoading && <SkeletonRows cols={8} />}
                  {data && rows.length === 0 && <tr><td colSpan={9} className="empty">{t('No employees here yet.')}</td></tr>}
                  {rows.map((e) => (
                    <tr key={e.key} className={e.id || isHr ? 'clickable' : ''} onClick={() => open(e)}>
                      <td><strong>{e.employee_no ?? '—'}</strong></td>
                      <td>{fullName(e)}{e.status === 'inactive' && <div className="small muted">{t('Inactive')}</div>}
                        {!e.id && isHr && <div className="small muted">{t('No HR record yet: click to add')}</div>}</td>
                      <td>{e.position ?? '—'}<div className="small secondary">{e.employment_type ?? ''}</div></td>
                      <td>{e.department ?? '—'}</td>
                      <td>{e.manager_name ?? '—'}</td>
                      <td>{[e.company, e.branch].filter(Boolean).join(' · ') || '—'}</td>
                      <td>{[e.work_phone, e.work_email].filter(Boolean).join(' · ') || '—'}</td>
                      {full && <>
                        <td>{date(e.joining_date)}</td>
                        {showPay && <td className="num">{e.salary === null ? '—' : money(e.salary)}</td>}
                        <td><ExpiryFlag days={e.expiring_in} /></td>
                      </>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {tab === 'org' && data && <OrgChart rows={data.employees.filter((e) => e.status === 'active')} onOpen={open} />}
      {tab === 'expiring' && full && <Expiring />}
      {tab === 'requests' && isHr && <Requests />}
      {tab === 'import' && isHr && <Import />}
      {creating && <EmployeeForm full={full} initial={creating} onClose={() => setCreating(null)} onSaved={(id) => navigate(`/hr/${id}`)} />}
    </>
  );
}

/** HR without the subscription: what's here, and how to get the rest. */
function BasicNote() {
  const { can } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="alert info" style={{ marginBottom: 12 }}>
      {t('HR basic: the employee directory and org chart. The full HR module adds personal records, pay, documents with expiry alerts, change requests and the Excel import.')}{' '}
      {can('admin') ? <button type="button" className="link" onClick={() => navigate('/settings?tab=modules')}>{t('Request full HR')}</button>
        : t('Ask an owner to request it.')}
    </div>
  );
}

/** Who reports to whom, from the directory. */
function OrgChart({ rows, onOpen }: { rows: ListRow[]; onOpen: (e: ListRow) => void }) {
  const keys = new Set(rows.map((r) => r.key));
  const children = new Map<string | null, ListRow[]>();
  for (const r of rows) {
    const parent = r.parent_key && keys.has(r.parent_key) && r.parent_key !== r.key ? r.parent_key : null;
    children.set(parent, [...(children.get(parent) ?? []), r]);
  }
  const seen = new Set<string>();
  const node = (r: ListRow): ReactNode => {
    if (seen.has(r.key)) return null;
    seen.add(r.key);
    const kids = children.get(r.key) ?? [];
    return (
      <li key={r.key}>
        <button type="button" className="org-node" onClick={() => onOpen(r)}>
          <strong>{fullName(r)}</strong><span className="small secondary">{[r.position, r.department].filter(Boolean).join(' · ')}</span>
        </button>
        {kids.length > 0 && <ul>{kids.map(node)}</ul>}
      </li>
    );
  };
  if (!rows.length) return <Empty>{t('No employees here yet.')}</Empty>;
  return <div className="card org-tree"><ul>{(children.get(null) ?? []).map(node)}</ul></div>;
}

function Expiring() {
  const navigate = useNavigate();
  const [days, setDays] = useState(60);
  const { data, isLoading } = useQuery({ queryKey: ['hr', 'expiring', days], queryFn: () => api<Expiry[]>(`/hr/expiring?days=${days}`) });
  return (
    <div className="stack">
      <div className="filters">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={t('Within')}>
          {[30, 60, 90, 180].map((d) => <option key={d} value={d}>{t('Next {n} days', { n: d })}</option>)}
        </select>
        <span className="small muted">{t('HR and the employee\'s manager get a notification 60 and 30 days before, and on the day.')}</span>
      </div>
      <div className="card flush table-wrap">
        <table>
          <thead><tr><th>{t('Employee')}</th><th>{t('Document')}</th><th>{t('Expiry')}</th><th>{t('Days left')}</th></tr></thead>
          <tbody>
            {isLoading && <SkeletonRows cols={4} />}
            {data?.length === 0 && <tr><td colSpan={4} className="empty">{t('Nothing expires in this period.')}</td></tr>}
            {data?.map((x, i) => (
              <tr key={i} className="clickable" onClick={() => navigate(`/hr/${x.employee_id}`)}>
                <td><strong>{x.employee_no}</strong> {fullName(x)}</td>
                <td>{t(x.what)}</td>
                <td>{date(x.expiry)}</td>
                <td><ExpiryFlag days={x.days_left} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Requests() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['hr', 'requests'],
    queryFn: () => api<(ChangeRequest & { employee_id: string; employee_name: string; employee_no: string })[]>('/hr/requests'),
  });
  const done = useSave((id: string) => api(`/hr/requests/${id}`, { method: 'PATCH', body: { status: 'done' } }), [['hr']]);
  return (
    <div className="card flush table-wrap">
      <table>
        <thead><tr><th>{t('Employee')}</th><th>{t('Request')}</th><th>{t('Asked by')}</th><th>{t('When')}</th><th /></tr></thead>
        <tbody>
          {isLoading && <SkeletonRows cols={5} />}
          {data?.length === 0 && <tr><td colSpan={5} className="empty">{t('No open requests.')}</td></tr>}
          {data?.map((r) => (
            <tr key={r.id}>
              <td><button type="button" className="link" onClick={() => navigate(`/hr/${r.employee_id}`)}>{r.employee_no} {r.employee_name}</button></td>
              <td style={{ whiteSpace: 'pre-wrap' }}>{r.text}</td>
              <td>{r.requested_by_name ?? '—'}</td>
              <td>{dateTime(r.requested_at)}</td>
              <td className="num"><button className="sm" disabled={done.isPending} onClick={() => done.mutate(r.id)}>{t('Mark done')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Import() {
  const [file, setFile] = useState<File | null>(null);
  const run = useSave(() => {
    const form = new FormData();
    form.append('file', file!);
    return api<{ created: number; updated: number; skipped: number }>('/hr/import', { form });
  }, [['hr']]);
  return (
    <div className="card stack" style={{ maxWidth: 640 }}>
      <p className="secondary" style={{ margin: 0 }}>
        {t('Load the employee register (EMPLOYEE_DB.xlsx, sheet DB, headers in row 1). Records are matched on the employee ID, so you can load it again to update them. Sign-ins with the same employee ID are linked, and "Report to" is matched to the employee with that position.')}
      </p>
      <ErrorNote error={run.error} />
      <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <div className="row">
        <button className="primary" disabled={!file || run.isPending} onClick={() => run.mutate(undefined)}>
          <Upload className="ico" aria-hidden /> {run.isPending ? t('Importing…') : t('Import')}
        </button>
        {run.data && <span className="small">{t('{c} added, {u} updated, {s} rows skipped', { c: run.data.created, u: run.data.updated, s: run.data.skipped })}</span>}
      </div>
    </div>
  );
}

// ---- one employee ------------------------------------------------------------------

function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v]) => <Fragment key={k}><dt>{t(k)}</dt><dd>{v === null || v === undefined || v === '' ? '—' : v}</dd></Fragment>)}
    </dl>
  );
}

export function EmployeePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: e, error, isLoading } = useQuery({ queryKey: ['hr', 'employee', id], queryFn: () => api<Detail>(`/hr/employees/${id}`) });
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState<ViewTarget | null>(null);
  const [printing, setPrinting] = useState(false);
  const remove = useSave((docId: string) => api(`/hr/employee-documents/${docId}`, { method: 'DELETE' }), [['hr']]);
  const done = useSave((reqId: string) => api(`/hr/requests/${reqId}`, { method: 'PATCH', body: { status: 'done' } }), [['hr']]);

  if (isLoading) return <div className="card flush"><table><tbody><SkeletonRows cols={2} /></tbody></table></div>;
  if (error || !e) return <ErrorNote error={error ?? new Error(t('Employee not found'))} />;
  const a = e.access;
  const full = e.tier === 'full';
  const pay = (v: number | null) => (v === null ? null : money(v));

  return (
    <>
      <div className="crumbs small"><button type="button" className="link" onClick={() => navigate('/hr')}>{t('HR')}</button> / {e.employee_no}</div>
      <div className="page-head">
        <div>
          <h1>{fullName(e)} {e.status === 'inactive' && <span className="badge LOS"><span className="dot" aria-hidden />{t('Inactive')}</span>}</h1>
          <p>{[e.employee_no, e.position, e.department, e.company].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="row">
          {full && a.own && !a.edit && <button onClick={() => setAsking(true)}>{t('Ask HR to update')}</button>}
          {full && a.edit && <button onClick={() => setPrinting(true)}><Printer className="ico" aria-hidden /> {t('Print form')}</button>}
          {a.edit && <button className="primary" onClick={() => setEditing(true)}>{t('Edit')}</button>}
        </div>
      </div>

      {e.expiring.map((x) => (
        <div key={`${x.what}${x.expiry}`} className={`alert ${x.days_left < 0 ? 'bad' : 'warn'}`} style={{ marginBottom: 8 }}>
          <AlertTriangle className="ico" aria-hidden /> {x.days_left < 0
            ? t('{what} expired on {date}.', { what: t(x.what), date: date(x.expiry) })
            : t('{what} expires on {date} (in {n} days).', { what: t(x.what), date: date(x.expiry), n: x.days_left })}
        </div>
      ))}
      {!full && <BasicNote />}
      {full && a.own && !a.edit && <p className="small muted">{t('This is your record as HR keeps it. To change anything, use "Ask HR to update".')}</p>}

      <div className="grid-2 hr-grid">
        <section className="card detail-group">
          <h3>{t('Job')}</h3>
          <KV items={[
            ['Employee ID', <strong>{e.employee_no}</strong>], ['Initials', e.initials], ['Position', e.position], ['Department', e.department],
            ['Reports to', e.manager_name ?? e.reports_to_text], ['Company', e.company], ['Branch', e.branch], ['Employment type', e.employment_type],
            ['Joined', date(e.joining_date)], ...(e.end_date ? [['Left', date(e.end_date)], ['Reason', e.end_reason]] as [string, ReactNode][] : []),
            ['Sign-in', e.user_name ?? t('No sign-in')], ['Work phone', e.work_phone], ['Work email', e.work_email],
          ]} />
        </section>
        {full && <>
        <section className="card detail-group">
          <h3>{t('Identity & residency')}</h3>
          <KV items={[
            ['Nationality', e.nationality], ['Civil ID / iqama', e.civil_id], ['Civil ID expiry', date(e.civil_id_expiry)], ['Sponsor', e.sponsor],
            ['Passport', e.passport_no], ['Passport expiry', date(e.passport_expiry)], ['Work permit expiry', date(e.work_permit_expiry)],
            ['Iqama transfer', date(e.iqama_transfer_date)], ['Iqama cancelled', date(e.iqama_cancel_date)],
          ]} />
        </section>
        <section className="card detail-group">
          <h3>{t('Personal')}</h3>
          <KV items={[
            ['Gender', e.gender === 'F' ? t('Female') : e.gender === 'M' ? t('Male') : null], ['Birth date', date(e.birth_date)], ['Birth place', e.birth_place],
            ['Marital status', e.marital_status], ['Religion', e.religion], ['Children', e.children], ['Education', e.education], ['Major', e.major],
            ['Driving licence', e.driving_license],
            ...(a.sensitive ? [['Chronic illness', e.chronic_illness], ['Allergies', e.allergies], ['Criminal record', e.criminal_record]] as [string, ReactNode][] : []),
          ]} />
        </section>
        <section className="card detail-group">
          <h3>{t('Contact')}</h3>
          <KV items={[
            ['Address (Kuwait)', e.address_kw], ['Phone (Kuwait)', e.phone_kw], ['Personal email', e.email_personal],
            ['Address (home country)', e.address_home], ['Phone (home country)', e.phone_home], ['Email (home country)', e.email_home],
          ]} />
          <h3 style={{ marginTop: 16 }}>{t('Emergency contacts')}</h3>
          {e.emergency_contacts.length === 0 ? <Empty>{t('None recorded.')}</Empty> : e.emergency_contacts.map((c, i) => (
            <KV key={i} items={[[`#${i + 1}`, <strong>{c.name}</strong>], ['Relation', c.relation], ['Address', c.address], ['Phone', c.phone]]} />
          ))}
        </section>
        {a.pay && (
          <section className="card detail-group">
            <h3>{t('Pay')}</h3>
            <KV items={[
              ['Salary', pay(e.salary)], ['Extra', pay(e.allowance_extra)], ['Housing', pay(e.allowance_housing)],
              ['Ticket', pay(e.allowance_ticket)], ['Transport', pay(e.allowance_transport)],
              ['Total', <strong>{money([e.salary, e.allowance_extra, e.allowance_housing, e.allowance_ticket, e.allowance_transport].reduce<number>((s, v) => s + (v ?? 0), 0))}</strong>],
            ]} />
          </section>
        )}
        <section className="card detail-group">
          <div className="spread">
            <h3>{t('Documents')}</h3>
            {a.edit && <button className="sm" onClick={() => setUploading(true)}><Upload className="ico" aria-hidden /> {t('Upload')}</button>}
          </div>
          <ErrorNote error={remove.error} />
          {e.documents.length === 0 ? <Empty>{t('No documents yet.')}</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t('Document')}</th><th>{t('Number')}</th><th>{t('Expiry')}</th><th /></tr></thead>
                <tbody>
                  {e.documents.map((d) => (
                    <tr key={d.id}>
                      <td>{docLabel(d.kind)}<div className="small muted">{d.file_name}</div></td>
                      <td>{d.number ?? '—'}</td>
                      <td>{date(d.expiry_date)}</td>
                      <td className="num">
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <button className="sm" onClick={() => setViewing({ kind: 'employee', id: d.id })}><Eye className="ico" aria-hidden /> {t('View')}</button>
                          {a.edit && <button className="sm ghost" aria-label={t('Delete')} onClick={() => confirm(t('Delete {name}?', { name: d.file_name })) && remove.mutate(d.id)}><Trash2 className="ico" aria-hidden /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {(e.notes && a.edit) && (
          <section className="card detail-group"><h3>{t('Notes')}</h3><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{e.notes}</p></section>
        )}
        </>}
        {full && (a.edit || a.own) && (
          <section className="card detail-group">
            <h3>{t('Change requests')}</h3>
            {e.requests.length === 0 ? <Empty>{t('None yet.')}</Empty> : e.requests.map((r) => (
              <div key={r.id} className="spread" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{r.text}</div>
                  <div className="small muted">{dateTime(r.requested_at)}{r.requested_by_name ? ` · ${r.requested_by_name}` : ''}
                    {r.status === 'done' && ` · ${t('Done')}${r.resolved_by_name ? ` (${r.resolved_by_name})` : ''}`}</div>
                </div>
                {a.edit && r.status === 'open' && <button className="sm" onClick={() => done.mutate(r.id)}>{t('Mark done')}</button>}
              </div>
            ))}
          </section>
        )}
      </div>

      {editing && <EmployeeForm full={full} employee={e} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      {asking && <AskHr employeeId={e.id} onClose={() => setAsking(false)} />}
      {uploading && <UploadDocument employeeId={e.id} onClose={() => setUploading(false)} />}
      {viewing && <DocumentViewer target={viewing} onClose={() => setViewing(null)} />}
      {printing && <PrintForm e={e} onDone={() => setPrinting(false)} />}
    </>
  );
}

function AskHr({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const send = useSave(() => api(`/hr/employees/${employeeId}/requests`, { body: { text } }), [['hr']]);
  return (
    <Modal title={t('Ask HR to update')} onClose={onClose} dirty={Boolean(text)}
      footer={<><button onClick={onClose}>{t('Cancel')}</button><button className="primary" form="ask-hr" disabled={text.trim().length < 3 || send.isPending}>{t('Send to HR')}</button></>}>
      <form id="ask-hr" className="stack" onSubmit={(ev) => { ev.preventDefault(); send.mutate(undefined, { onSuccess: onClose }); }}>
        <ErrorNote error={send.error} />
        <Field label={t('What should change?')}>
          <textarea rows={5} value={text} onChange={(ev) => setText(ev.target.value)} autoFocus placeholder={t('e.g. My new phone number is …')} />
        </Field>
        <p className="small muted">{t('HR gets a notification and updates your record.')}</p>
      </form>
    </Modal>
  );
}

function UploadDocument({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const [kind, setKind] = useState('civil_id');
  const [file, setFile] = useState<File | null>(null);
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const save = useSave(() => {
    const form = new FormData();
    form.append('file', file!);
    const qs = new URLSearchParams({ kind, ...(number && { number }), ...(expiry && { expiry_date: expiry }) });
    return api(`/hr/employees/${employeeId}/documents?${qs}`, { form });
  }, [['hr']]);
  return (
    <Modal title={t('Upload document')} onClose={onClose}
      footer={<><button onClick={onClose}>{t('Cancel')}</button><button className="primary" form="hr-upload" disabled={!file || save.isPending}>{save.isPending ? t('Uploading…') : t('Upload')}</button></>}>
      <form id="hr-upload" className="stack" onSubmit={(ev) => { ev.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }}>
        <ErrorNote error={save.error} />
        <Field label={t('Kind')}>
          <select value={kind} onChange={(ev) => setKind(ev.target.value)}>{DOC_KINDS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select>
        </Field>
        <div className="grid-2">
          <Field label={t('Number')}><input value={number} onChange={(ev) => setNumber(ev.target.value)} /></Field>
          <Field label={t('Expiry date')}><input type="date" value={expiry} onChange={(ev) => setExpiry(ev.target.value)} /></Field>
        </div>
        <Field label={t('File (photo or PDF)')}><input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(ev) => setFile(ev.target.files?.[0] ?? null)} /></Field>
        <p className="small muted">{t('With an expiry date, HR and the manager are reminded 60 and 30 days before.')}</p>
      </form>
    </Modal>
  );
}

// ---- add / edit ---------------------------------------------------------------------

type FieldKind = 'text' | 'date' | 'money' | 'number' | 'textarea';
const SECTIONS: [string, [keyof Employee, string, FieldKind?][]][] = [
  ['Job', [['first_name', 'First name'], ['last_name', 'Last name'], ['initials', 'Initials'], ['employee_no', 'Employee ID'], ['position', 'Position'],
    ['company', 'Company'], ['branch', 'Branch'], ['employment_type', 'Employment type'], ['joining_date', 'Joined', 'date'],
    ['end_date', 'Left', 'date'], ['end_reason', 'Reason for leaving']]],
  ['Identity & residency', [['nationality', 'Nationality'], ['civil_id', 'Civil ID / iqama'], ['civil_id_expiry', 'Civil ID expiry', 'date'],
    ['sponsor', 'Sponsor'], ['passport_no', 'Passport'], ['passport_expiry', 'Passport expiry', 'date'], ['work_permit_expiry', 'Work permit expiry', 'date'],
    ['iqama_transfer_date', 'Iqama transfer', 'date'], ['iqama_cancel_date', 'Iqama cancelled', 'date']]],
  ['Personal', [['birth_date', 'Birth date', 'date'], ['birth_place', 'Birth place'], ['marital_status', 'Marital status'], ['religion', 'Religion'],
    ['children', 'Children', 'number'], ['education', 'Highest education'], ['major', 'Major'], ['driving_license', 'Driving licence'],
    ['chronic_illness', 'Chronic illness'], ['allergies', 'Allergies'], ['criminal_record', 'Criminal record']]],
  ['Contact', [['work_phone', 'Work phone'], ['work_email', 'Work email'], ['address_kw', 'Address (Kuwait)'], ['phone_kw', 'Phone (Kuwait)'], ['email_personal', 'Personal email'],
    ['address_home', 'Address (home country)'], ['phone_home', 'Phone (home country)'], ['email_home', 'Email (home country)']]],
  ['Pay', [['salary', 'Salary', 'money'], ['allowance_extra', 'Extra', 'money'], ['allowance_housing', 'Housing', 'money'],
    ['allowance_ticket', 'Ticket', 'money'], ['allowance_transport', 'Transport', 'money']]],
  ['Notes', [['notes', 'Notes (HR only)', 'textarea']]],
];

/** HR basic edits only the directory fields. */
const BASIC_SECTIONS: typeof SECTIONS = [
  ['Job', [['first_name', 'First name'], ['last_name', 'Last name'], ['initials', 'Initials'], ['employee_no', 'Employee ID'], ['position', 'Position'],
    ['company', 'Company'], ['branch', 'Branch'], ['employment_type', 'Employment type'], ['joining_date', 'Joined', 'date'], ['end_date', 'Left', 'date']]],
  ['Work contact', [['work_phone', 'Work phone'], ['work_email', 'Work email']]],
];

function EmployeeForm({ employee, initial, full, onClose, onSaved }: { employee?: Detail; initial?: Partial<Employee>; full: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const { data: depts } = useDepartments();
  const { data: options } = useQuery({
    queryKey: ['hr', 'options'],
    queryFn: () => api<{ users: { id: string; name: string; employee_no: string | null }[]; managers: { id: string; name: string; employee_no: string; position: string | null }[] }>('/hr/options'),
  });
  const [form, setForm] = useState<Partial<Employee>>(() => employee
    ? Object.fromEntries(Object.entries(employee).filter(([k]) => !['documents', 'requests', 'expiring', 'access', 'department', 'manager_name', 'user_name', 'user_email', 'manager_user_id', 'id', 'tenant_id', 'created_at', 'updated_at', 'created_by', 'reports_to_text'].includes(k)))
    : { status: 'active', ...(full ? { emergency_contacts: [] } : {}), ...initial });
  const [dirty, setDirty] = useState(false);
  const set = (k: keyof Employee, v: unknown) => { setDirty(true); setForm((f) => ({ ...f, [k]: v })); };
  const contacts: Contact[] = [0, 1].map((i) => form.emergency_contacts?.[i] ?? { name: null, relation: null, address: null, phone: null });
  const setContact = (i: number, k: keyof Contact, v: string) => {
    const next = contacts.map((c, j) => (j === i ? { ...c, [k]: v || null } : c));
    set('emergency_contacts', next.filter((c) => c.name || c.phone || c.relation || c.address));
  };
  const save = useSave(() => (employee
    ? api(`/hr/employees/${employee.id}`, { method: 'PATCH', body: form }).then(() => ({ id: employee.id }))
    : api<{ id: string }>('/hr/employees', { body: form })), [['hr']]);

  const input = (k: keyof Employee, kind: FieldKind = 'text') => {
    const v = form[k] as string | number | null | undefined;
    if (kind === 'textarea') return <textarea rows={3} value={(v as string) ?? ''} onChange={(ev) => set(k, ev.target.value || null)} />;
    if (kind === 'money' || kind === 'number') {
      return <input type="number" step="any" min={0} value={v ?? ''} onChange={(ev) => set(k, ev.target.value === '' ? null : Number(ev.target.value))} />;
    }
    return <input type={kind === 'date' ? 'date' : 'text'} value={(v as string) ?? ''} onChange={(ev) => set(k, ev.target.value || null)} />;
  };

  return (
    <Modal wide title={employee ? t('Edit {name}', { name: fullName(employee) }) : t('New employee')} onClose={onClose} dirty={dirty}
      footer={<><button onClick={confirmDiscard(dirty, onClose)}>{t('Cancel')}</button>
        <button className="primary" form="employee-form" disabled={!form.first_name || save.isPending}>{save.isPending ? t('Saving…') : t('Save')}</button></>}>
      <form id="employee-form" className="stack" onSubmit={(ev) => { ev.preventDefault(); save.mutate(undefined, { onSuccess: (r) => onSaved(r.id) }); }}>
        <ErrorNote error={save.error} />
        <div className="form-grid">
          <Field label={t('Sign-in (optional)')}>
            <select value={form.user_id ?? ''} onChange={(ev) => set('user_id', ev.target.value || null)}>
              <option value="">{t('No sign-in')}</option>
              {employee?.user_id && <option value={employee.user_id}>{employee.user_name}</option>}
              {options?.users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.employee_no ? ` · ${u.employee_no}` : ''}</option>)}
            </select>
          </Field>
          <Field label={t('Department')}>
            <select value={form.department_id ?? ''} onChange={(ev) => set('department_id', ev.target.value || null)}>
              <option value="">—</option>
              {depts?.filter((d) => d.is_active || d.id === form.department_id).map((d) => <option key={d.id} value={d.id}>{t(d.name)}</option>)}
            </select>
          </Field>
          <Field label={t('Reports to')}>
            <select value={form.manager_id ?? ''} onChange={(ev) => set('manager_id', ev.target.value || null)}>
              <option value="">—</option>
              {options?.managers.filter((m) => m.id !== employee?.id).map((m) => <option key={m.id} value={m.id}>{m.name}{m.position ? ` · ${m.position}` : ''}</option>)}
            </select>
          </Field>
          <Field label={t('Status')}>
            <select value={form.status ?? 'active'} onChange={(ev) => set('status', ev.target.value)}>
              <option value="active">{t('Active')}</option><option value="inactive">{t('Inactive')}</option>
            </select>
          </Field>
          {full && <Field label={t('Gender')}>
            <select value={form.gender ?? ''} onChange={(ev) => set('gender', ev.target.value || null)}>
              <option value="">—</option><option value="F">{t('Female')}</option><option value="M">{t('Male')}</option>
            </select>
          </Field>}
        </div>
        {!employee && <p className="small muted">{t('Leave the employee ID empty to use the sign-in\'s ID, or the next free one for the joining year.')}</p>}
        {(full ? SECTIONS : BASIC_SECTIONS).map(([title, fields]) => (
          <fieldset key={title} className="hr-fieldset">
            <legend>{t(title)}</legend>
            <div className="form-grid">
              {fields.map(([k, label, kind]) => (
                <Field key={k} label={t(label)} className={kind === 'textarea' ? 'span-all' : undefined}>{input(k, kind)}</Field>
              ))}
            </div>
          </fieldset>
        ))}
        {full && <fieldset className="hr-fieldset">
          <legend>{t('Emergency contacts')}</legend>
          {contacts.map((c, i) => (
            <div key={i} className="form-grid" style={{ marginBottom: 8 }}>
              <Field label={`#${i + 1} ${t('Full name')}`}><input value={c.name ?? ''} onChange={(ev) => setContact(i, 'name', ev.target.value)} /></Field>
              <Field label={t('Relation')}><input value={c.relation ?? ''} onChange={(ev) => setContact(i, 'relation', ev.target.value)} /></Field>
              <Field label={t('Address')}><input value={c.address ?? ''} onChange={(ev) => setContact(i, 'address', ev.target.value)} /></Field>
              <Field label={t('Phone')}><input value={c.phone ?? ''} onChange={(ev) => setContact(i, 'phone', ev.target.value)} /></Field>
            </div>
          ))}
        </fieldset>}
      </form>
    </Modal>
  );
}

// ---- the joining form, printed ---------------------------------------------------------

/** The employee information form filled in, for printing or saving as PDF and signing. */
function PrintForm({ e, onDone }: { e: Detail; onDone: () => void }) {
  useEffect(() => {
    document.body.classList.add('printing-form');
    const after = () => onDone();
    window.addEventListener('afterprint', after);
    const id = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(id); window.removeEventListener('afterprint', after); document.body.classList.remove('printing-form'); };
  }, [onDone]);
  const row = (label: string, value: ReactNode) => <tr><th>{t(label)}</th><td>{value === null || value === undefined || value === '' ? '' : value}</td></tr>;
  const docs = new Set(e.documents.map((d) => d.kind));
  return createPortal(
    <div className="print-form">
      <h1>{t('Employee information form')}</h1>
      <table>
        <tbody>
          {row('Name', fullName(e))}{row('Employee ID', e.employee_no)}{row('Job title', e.position)}{row('Department', e.department)}
          {row('Joined', date(e.joining_date))}{row('Employment type', e.employment_type)}
        </tbody>
      </table>
      <h2>{t('Personal information')}</h2>
      <table>
        <tbody>
          {row('Nationality', e.nationality)}{row('Civil ID / iqama', e.civil_id)}{row('Sponsor', e.sponsor)}
          {row('Gender', e.gender === 'F' ? t('Female') : e.gender === 'M' ? t('Male') : '')}{row('Birth date', date(e.birth_date))}{row('Birth place', e.birth_place)}
          {row('Marital status', e.marital_status)}{row('Religion', e.religion)}{row('Children', e.children)}
          {row('Address (Kuwait)', e.address_kw)}{row('Phone (Kuwait)', e.phone_kw)}{row('Personal email', e.email_personal)}
          {row('Address (home country)', e.address_home)}{row('Phone (home country)', e.phone_home)}{row('Email (home country)', e.email_home)}
          {row('Highest education', e.education)}{row('Major', e.major)}{row('Chronic illness', e.chronic_illness)}{row('Allergies', e.allergies)}
          {row('Criminal record', e.criminal_record)}{row('Driving licence', e.driving_license)}
        </tbody>
      </table>
      <h2>{t('Emergency contacts')}</h2>
      <table>
        <tbody>
          {[0, 1].map((i) => {
            const c = e.emergency_contacts[i];
            return <tr key={i}><th>#{i + 1}</th><td>{c ? [c.name, c.relation, c.address, c.phone].filter(Boolean).join(' · ') : ''}</td></tr>;
          })}
        </tbody>
      </table>
      <h2>{t('Required documents')}</h2>
      <ul className="print-checks">
        {DOC_KINDS.filter(([k]) => k !== 'contract' && k !== 'other').map(([k, l]) => <li key={k}>{docs.has(k) ? '☑' : '☐'} {t(l)}</li>)}
      </ul>
      <p className="small">{t('I, the undersigned, declare that the information above is true and complete, and I am aware of my liability if it is not.')}</p>
      <div className="print-sign"><span>{t('Date')}: ____________________</span><span>{t('Name')}: ____________________</span><span>{t('Signature')}: ____________________</span></div>
    </div>,
    document.body,
  );
}
