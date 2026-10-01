import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, getPlatformToken, setPlatformToken } from '../api';
import { ErrorNote, Field, Modal } from '../components/ui';
import { dateTime } from '../format';
import { useSave } from '../hooks';

type TenantStatus = 'pending' | 'active' | 'rejected' | 'suspended';
interface Workspace {
  id: string; slug: string; name: string; status: TenantStatus; status_reason: string | null; plan: string; max_users: number;
  currency: string; contact_phone: string | null; signup_note: string | null; created_at: string; reviewed_at: string | null;
  reviewed_by: string | null; owner_name: string | null; owner_email: string | null; users: number; bookings: number;
  last_booking_at: string | null;
}
type Action = 'approve' | 'reject' | 'suspend' | 'reactivate';

const STATUS_LABEL: Record<TenantStatus, string> = { pending: 'Pending', active: 'Active', rejected: 'Rejected', suspended: 'Suspended' };
const PLANS = ['trial', 'starter', 'pro', 'enterprise'];
const PLAN_USERS: Record<string, number> = { trial: 5, starter: 10, pro: 25, enterprise: 200 };

function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
}

export function PlatformLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { token } = await api<{ token: string }>('/platform/login', { body: { email, password }, platform: true });
      setPlatformToken(token);
      navigate('/platform');
    } catch (err) {
      setError(err);
    }
  }
  return (
    <div className="auth-page">
      <form className="card auth-card stack" onSubmit={submit}>
        <div>
          <span className="tag">Operator</span>
          <h1 style={{ marginTop: 8 }}>Platform console</h1>
          <p className="secondary" style={{ margin: 0 }}>Review workspace requests and manage customers.</p>
        </div>
        <ErrorNote error={error} />
        <Field label="Email"><input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <button className="primary">Sign in</button>
      </form>
    </div>
  );
}

export function PlatformConsole() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<TenantStatus | 'all'>('pending');
  const [q, setQ] = useState('');
  const [acting, setActing] = useState<{ ws: Workspace; action: Action } | null>(null);
  const me = useQuery({ queryKey: ['platform-me'], queryFn: () => api<{ name: string; email: string }>('/platform/me', { platform: true }), enabled: Boolean(getPlatformToken()) });
  const { data } = useQuery({
    queryKey: ['platform-tenants'],
    queryFn: () => api<{ tenants: Workspace[]; counts: Record<TenantStatus, number> }>('/platform/tenants', { platform: true }),
    enabled: Boolean(getPlatformToken()),
    refetchInterval: 60_000,
  });
  if (!getPlatformToken()) return <Navigate to="/platform/login" replace />;

  const needle = q.trim().toLowerCase();
  const rows = (data?.tenants ?? []).filter((t) =>
    (filter === 'all' || t.status === filter) &&
    (!needle || [t.name, t.slug, t.owner_name, t.owner_email, t.contact_phone].some((v) => v?.toLowerCase().includes(needle))));
  const c = data?.counts ?? { pending: 0, active: 0, rejected: 0, suspended: 0 };

  return (
    <div className="main platform" style={{ maxWidth: 1280, margin: '0 auto' }}>
      <div className="page-head">
        <div>
          <span className="tag">Operator</span>
          <h1 style={{ marginTop: 6 }}>Workspace approvals</h1>
          <p>New companies wait here until you approve them. Suspending a workspace signs its users out immediately.</p>
        </div>
        <div className="row">
          <span className="secondary small">{me.data?.name}</span>
          <button onClick={() => { setPlatformToken(null); qc.clear(); window.location.assign('/platform/login'); }}>Sign out</button>
        </div>
      </div>

      <div className="kpis">
        {(['pending', 'active', 'suspended', 'rejected'] as TenantStatus[]).map((s) => (
          <button key={s} className={`kpi kpi-button ${filter === s ? 'selected' : ''}`} onClick={() => setFilter(s)} aria-pressed={filter === s}>
            <div className="kpi-label"><span className={`badge ws-${s}`}><span className="dot" />{STATUS_LABEL[s]}</span></div>
            <div className="kpi-value">{c[s]}</div>
            <div className="kpi-sub">{s === 'pending' ? (c.pending ? 'Waiting for your review' : 'Queue is clear') : 'workspaces'}</div>
          </button>
        ))}
      </div>

      <div className="filters">
        <input type="search" placeholder="Search company, owner, email, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as TenantStatus | 'all')} aria-label="Status">
          <option value="all">All statuses</option>
          {(Object.keys(STATUS_LABEL) as TenantStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>

      <div className="card flush">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Workspace</th><th>Owner</th><th>About</th><th>Requested</th><th>Status</th><th>Plan</th><th className="num">Usage</th><th /></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={8} className="empty">{filter === 'pending' ? 'No workspaces waiting. 🎉' : 'Nothing here.'}</td></tr>}
              {rows.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.name}</strong><div className="small muted">{t.slug} · {t.currency}</div></td>
                  <td>{t.owner_name ?? '—'}<div className="small secondary">{t.owner_email}</div>{t.contact_phone && <div className="small secondary">{t.contact_phone}</div>}</td>
                  <td style={{ maxWidth: 280 }}><span className="small secondary">{t.signup_note ?? '—'}</span></td>
                  <td title={dateTime(t.created_at)}>{ago(t.created_at)}</td>
                  <td>
                    <span className={`badge ws-${t.status}`}><span className="dot" />{STATUS_LABEL[t.status]}</span>
                    {t.status_reason && <div className="small secondary" style={{ marginTop: 4 }}>{t.status_reason}</div>}
                    {t.reviewed_by && <div className="small muted">by {t.reviewed_by}</div>}
                  </td>
                  <td>{t.plan}<div className="small muted">{t.max_users} users</div></td>
                  <td className="num">{t.users} users<div className="small muted">{t.bookings} bookings</div></td>
                  <td className="num">
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      {(t.status === 'pending' || t.status === 'rejected') && <button className="sm primary" onClick={() => setActing({ ws: t, action: 'approve' })}>Approve</button>}
                      {t.status === 'pending' && <button className="sm danger" onClick={() => setActing({ ws: t, action: 'reject' })}>Reject</button>}
                      {t.status === 'active' && <button className="sm" onClick={() => setActing({ ws: t, action: 'approve' })} title="Change plan">Plan</button>}
                      {t.status === 'active' && <button className="sm danger" onClick={() => setActing({ ws: t, action: 'suspend' })}>Suspend</button>}
                      {t.status === 'suspended' && <button className="sm primary" onClick={() => setActing({ ws: t, action: 'reactivate' })}>Reactivate</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {acting && <ActionModal {...acting} onClose={() => setActing(null)} />}
    </div>
  );
}

function ActionModal({ ws, action, onClose }: { ws: Workspace; action: Action; onClose: () => void }) {
  const editPlan = action === 'approve' && ws.status === 'active';
  const [plan, setPlan] = useState(ws.plan === 'trial' && !editPlan ? 'starter' : ws.plan);
  const [maxUsers, setMaxUsers] = useState(ws.status === 'active' ? ws.max_users : PLAN_USERS[plan] ?? ws.max_users);
  const [reason, setReason] = useState('');
  const save = useSave(() => editPlan
    ? api(`/platform/tenants/${ws.id}`, { method: 'PATCH', body: { plan, max_users: maxUsers }, platform: true })
    : api(`/platform/tenants/${ws.id}/${action}`, {
        body: { reason: reason || undefined, ...(action === 'approve' ? { plan, max_users: maxUsers } : {}) }, platform: true,
      }), [['platform-tenants']]);
  const title = editPlan ? `Plan for ${ws.name}` : { approve: `Approve ${ws.name}`, reject: `Reject ${ws.name}`,
    suspend: `Suspend ${ws.name}`, reactivate: `Reactivate ${ws.name}` }[action];
  const needsReason = action === 'reject' || action === 'suspend';

  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button onClick={onClose}>Cancel</button>
      <button className={needsReason ? 'danger' : 'primary'} disabled={save.isPending || (needsReason && !reason.trim())}
        onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
        {editPlan ? 'Save plan' : action === 'approve' ? 'Approve & activate' : action === 'reject' ? 'Reject request' : action === 'suspend' ? 'Suspend workspace' : 'Reactivate'}
      </button>
    </>}>
      <div className="stack">
        <ErrorNote error={save.error} />
        <dl className="kv">
          <dt>Owner</dt><dd>{ws.owner_name} · {ws.owner_email}{ws.contact_phone ? ` · ${ws.contact_phone}` : ''}</dd>
          {ws.signup_note && <><dt>About</dt><dd>{ws.signup_note}</dd></>}
        </dl>
        {action === 'approve' && (
          <div className="form-grid">
            <Field label="Plan">
              <select value={plan} onChange={(e) => { setPlan(e.target.value); setMaxUsers(PLAN_USERS[e.target.value]); }}>
                {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Max login users"><input type="number" min={1} value={maxUsers} onChange={(e) => setMaxUsers(Number(e.target.value))} /></Field>
          </div>
        )}
        {needsReason && (
          <Field label="Reason (shown to the customer when they sign in)">
            <textarea required value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={action === 'reject' ? 'e.g. We could not verify the company details' : 'e.g. Subscription unpaid since 1 Oct'} />
          </Field>
        )}
        {action === 'suspend' && <div className="alert">All of this workspace's users are signed out immediately. Their data is kept.</div>}
      </div>
    </Modal>
  );
}
