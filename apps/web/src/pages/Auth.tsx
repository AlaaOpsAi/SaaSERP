import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { ErrorNote, Field } from '../components/ui';

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [workspaces, setWorkspaces] = useState<{ slug: string; name: string }[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await api<{ token: string }>('/auth/login', {
        body: { email, password, workspace: workspace || undefined },
      });
      await signIn(token);
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError && err.details?.workspaces) setWorkspaces(err.details.workspaces);
      else setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card stack" onSubmit={submit}>
        <div>
          <h1>Sign in</h1>
          <p className="secondary" style={{ margin: 0 }}>Events & catering sales, bookings and function diary.</p>
        </div>
        <ErrorNote error={error} />
        <Field label="Email"><input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {workspaces && (
          <Field label="Workspace">
            <select required value={workspace} onChange={(e) => setWorkspace(e.target.value)}>
              <option value="">Choose a workspace…</option>
              {workspaces.map((w) => <option key={w.slug} value={w.slug}>{w.name} ({w.slug})</option>)}
            </select>
          </Field>
        )}
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="small secondary" style={{ margin: 0 }}>New company? <Link to="/signup">Create a workspace</Link></p>
      </form>
    </div>
  );
}

export function Signup() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ company_name: '', slug: '', name: '', email: '', password: '', business_unit_code: '', currency: 'KWD' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await api<{ token: string }>('/auth/signup', {
        body: { ...f, business_unit_code: f.business_unit_code || undefined },
      });
      await signIn(token);
      navigate('/settings');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card stack" onSubmit={submit}>
        <div>
          <h1>Create your workspace</h1>
          <p className="secondary" style={{ margin: 0 }}>Free trial · up to 5 users.</p>
        </div>
        <ErrorNote error={error} />
        <Field label="Company name">
          <input required value={f.company_name} onChange={(e) => {
            const v = e.target.value;
            setF((s) => ({ ...s, company_name: v, slug: s.slug || v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }));
          }} />
        </Field>
        <div className="grid-2">
          <Field label="Workspace ID"><input required pattern="[a-z0-9][a-z0-9-]{1,40}" value={f.slug} onChange={set('slug')} /></Field>
          <Field label="Booking prefix"><input maxLength={4} placeholder="e.g. W" value={f.business_unit_code} onChange={set('business_unit_code')} /></Field>
        </div>
        <Field label="Your name"><input required value={f.name} onChange={set('name')} /></Field>
        <Field label="Email"><input type="email" required value={f.email} onChange={set('email')} /></Field>
        <div className="grid-2">
          <Field label="Password (8+ characters)"><input type="password" minLength={8} required value={f.password} onChange={set('password')} /></Field>
          <Field label="Currency">
            <select value={f.currency} onChange={set('currency')}>
              {['KWD', 'SAR', 'AED', 'QAR', 'BHD', 'OMR', 'USD', 'EUR'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create workspace'}</button>
        <p className="small secondary" style={{ margin: 0 }}>Already have one? <Link to="/login">Sign in</Link></p>
      </form>
    </div>
  );
}
