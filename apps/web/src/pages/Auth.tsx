import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Field } from '../components/ui';
import { LANGUAGES, lang, markPicked, setLanguage, storeLanguage } from '../i18n';
import { t } from '../i18n';

/** Language picker shown before sign-in. */
export function LanguageSwitch({ onChange }: { onChange?: (code: string) => void }) {
  return (
    <div className="lang-switch" role="group" aria-label="Language">
      {LANGUAGES.map((l) => (
        <button key={l.code} type="button" lang={l.code} className={`sm ${lang().code === l.code ? 'on' : ''}`}
          onClick={() => { setLanguage(l.code); storeLanguage(l.code); markPicked(l.code); onChange?.(l.code); }}>{l.name}</button>
      ))}
    </div>
  );
}

const INACTIVE: Record<string, string> = {
  pending: 'Your workspace is waiting for approval. We will let you know as soon as it is activated.',
  rejected: 'Your workspace request was not approved.',
  suspended: 'This workspace has been suspended. Please contact support.',
};

export function Login({ onLanguage }: { onLanguage?: (code: string) => void }) {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [workspaces, setWorkspaces] = useState<{ slug: string; name: string }[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [inactive, setInactive] = useState<{ status: string; reason?: string | null } | null>(
    params.get('inactive') ? { status: params.get('inactive')! } : null,
  );
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInactive(null);
    try {
      const { token } = await api<{ token: string }>('/auth/login', {
        body: { email, password, workspace: workspace || undefined },
      });
      await signIn(token);
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError && err.details?.workspaces) setWorkspaces(err.details.workspaces);
      else if (err instanceof ApiError && err.details?.tenant_status) {
        setInactive({ status: err.details.tenant_status, reason: err.details.reason });
      } else setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card stack" onSubmit={submit}>
        <LanguageSwitch onChange={onLanguage} />
        <div>
          <h1>{t("Sign in")}</h1>
          <p className="secondary" style={{ margin: 0 }}>{t("Events & catering sales, bookings and function diary.")}</p>
        </div>
        {inactive && (
          <div className={`alert ${inactive.status === 'pending' ? 'info' : ''}`}>
            {t(INACTIVE[inactive.status] ?? "This workspace is not active.")}
            {inactive.reason && <div style={{ marginTop: 4 }}><strong>{t("Reason:")}</strong> {inactive.reason}</div>}
          </div>
        )}
        <ErrorNote error={error} />
        <Field label={t("Email")}><input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={t("Password")}><input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {workspaces && (
          <Field label={t("Workspace")}>
            <select required value={workspace} onChange={(e) => setWorkspace(e.target.value)}>
              <option value="">{t("Choose a workspace…")}</option>
              {workspaces.map((w) => <option key={w.slug} value={w.slug}>{w.name} ({w.slug})</option>)}
            </select>
          </Field>
        )}
        <button className="primary" disabled={busy}>{busy ? t("Signing in…") : t("Sign in")}</button>
        <p className="small secondary" style={{ margin: 0 }}>{t("New company?")}{' '}<Link to="/signup">{t("Request a workspace")}</Link></p>
      </form>
    </div>
  );
}

export function Signup({ onLanguage }: { onLanguage?: (code: string) => void }) {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({
    company_name: '', slug: '', name: '', email: '', password: '', business_unit_code: '', currency: 'KWD', phone: '', note: '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ status: 'pending' | 'active'; token?: string }>('/auth/signup', {
        body: { ...f, business_unit_code: f.business_unit_code || undefined, phone: f.phone || undefined, note: f.note || undefined },
      });
      if (res.status === 'active' && res.token) {
        await signIn(res.token);
        navigate('/settings');
      } else setPending(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <div className="auth-page">
        <div className="card auth-card stack" style={{ textAlign: 'center' }}>
          <div className="pending-mark" aria-hidden>⏳</div>
          <h1>{t("Request received")}</h1>
          <p className="secondary" style={{ margin: 0 }}>{t("Thanks,")}{' '}{f.name.split(' ')[0]}. <strong>{f.company_name}</strong>{' '}{t("is now waiting for approval. We review new workspaces within one business day and will contact you at")}{' '}<strong>{f.email}</strong>.
          </p>
          <p className="small muted" style={{ margin: 0 }}>{t("Workspace ID:")}{' '}{f.slug}</p>
          <Link to="/login" className="btn">{t("Back to sign in")}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="card auth-card stack" onSubmit={submit}>
        <LanguageSwitch onChange={onLanguage} />
        <div>
          <h1>{t("Request your workspace")}</h1>
          <p className="secondary" style={{ margin: 0 }}>{t("Every new workspace is reviewed before activation, usually within one business day.")}</p>
        </div>
        <ErrorNote error={error} />
        <Field label={t("Company name")}>
          <input required value={f.company_name} onChange={(e) => {
            const v = e.target.value;
            setF((s) => ({ ...s, company_name: v, slug: s.slug || v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }));
          }} />
        </Field>
        <div className="grid-2">
          <Field label={t("Workspace ID")}><input required pattern="[a-z0-9][a-z0-9-]{1,40}" value={f.slug} onChange={set('slug')} /></Field>
          <Field label={t("Booking prefix")}><input maxLength={4} placeholder="e.g. W" value={f.business_unit_code} onChange={set('business_unit_code')} /></Field>
        </div>
        <div className="grid-2">
          <Field label={t("Your name")}><input required value={f.name} onChange={set('name')} /></Field>
          <Field label={t("Phone")}><input type="tel" value={f.phone} onChange={set('phone')} placeholder="+965 …" /></Field>
        </div>
        <Field label={t("Work email")}><input type="email" required value={f.email} onChange={set('email')} /></Field>
        <div className="grid-2">
          <Field label={t("Password (8+ characters)")}><input type="password" minLength={8} required value={f.password} onChange={set('password')} /></Field>
          <Field label={t("Currency")}>
            <select value={f.currency} onChange={set('currency')}>
              {['KWD', 'SAR', 'AED', 'QAR', 'BHD', 'OMR', 'USD', 'EUR'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t("Tell us about your business (optional)")}>
          <textarea maxLength={1000} value={f.note} onChange={set('note')} placeholder={t("e.g. Wedding planner, 6 sales staff, ~300 events a year")} />
        </Field>
        <button className="primary" disabled={busy}>{busy ? t("Sending…") : t("Request workspace")}</button>
        <p className="small secondary" style={{ margin: 0 }}>{t("Already approved?")}{' '}<Link to="/login">{t("Sign in")}</Link></p>
      </form>
    </div>
  );
}
