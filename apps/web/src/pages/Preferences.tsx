import { Check } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, companyAccent, type Me } from '../api';
import { ACCENTS, applyAppearance, type Preferences as Prefs } from '../appearance';
import { useAuth } from '../auth';
import { ErrorNote, Field, StatusBadge } from '../components/ui';
import { LANGUAGES, t } from '../i18n';

/** Personal language & look; every change applies immediately and is saved to your account. */
export function Preferences() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const prefs: Prefs = me?.preferences ?? {};
  const company = me ? companyAccent(me) : null;

  async function save(change: Partial<Record<keyof Prefs, unknown>>) {
    setError(null);
    const next = { ...prefs, ...change } as Prefs;
    for (const k of Object.keys(next) as (keyof Prefs)[]) if (next[k] === null) delete next[k];
    applyAppearance(next, company); // instant preview
    qc.setQueryData<Me>(['me'], (m) => (m ? { ...m, preferences: next } : m));
    try {
      const stored = await api<Prefs>('/me/preferences', { method: 'PATCH', body: change });
      qc.setQueryData<Me>(['me'], (m) => (m ? { ...m, preferences: stored } : m));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err);
    }
  }

  const accent = prefs.accent ?? null;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('Preferences')}</h1>
          <p>{t('Your language and how the app looks. Changes apply straight away and follow you to any device.')}</p>
        </div>
        {saved && <span className="tag">{t('Saved.')}</span>}
      </div>
      <ErrorNote error={error} />
      <div className="stack" style={{ maxWidth: 760 }}>
        <section className="card stack">
          <h2>{t('Language')}</h2>
          <div className="row">
            {LANGUAGES.map((l) => (
              <button key={l.code} className={prefs.locale === l.code || (!prefs.locale && me?.tenant.default_locale === l.code) ? 'primary' : ''}
                onClick={() => save({ locale: l.code })} lang={l.code}>{l.name}</button>
            ))}
            {prefs.locale && <button className="ghost sm" onClick={() => save({ locale: null })}>{t('Use company default')}</button>}
          </div>
        </section>

        <section className="card stack">
          <h2>{t('Theme')}</h2>
          <div className="segmented" role="radiogroup" aria-label={t('Theme')}>
            {(['system', 'light', 'dark'] as const).map((m) => (
              <button key={m} role="radio" aria-checked={(prefs.theme ?? 'system') === m} className={(prefs.theme ?? 'system') === m ? 'on' : ''}
                onClick={() => save({ theme: m === 'system' ? null : m })}>
                {t(m === 'system' ? 'Match my device' : m === 'light' ? 'Light' : 'Dark')}
              </button>
            ))}
          </div>
        </section>

        <section className="card stack">
          <h2>{t('Accent colour')}</h2>
          <p className="secondary small" style={{ margin: 0 }}>{t('Used for buttons, links and highlights. Chart colours stay fixed so figures always read the same.')}</p>
          <div className="swatches">
            <button className={`swatch ${!accent ? 'on' : ''}`} style={{ background: company ?? '#2a78d6' }} title={t('Company default')}
              aria-label={t('Company default')} onClick={() => save({ accent: null })}>{!accent && <Check className="ico" aria-hidden />}</button>
            {ACCENTS.map((a) => (
              <button key={a.hex} className={`swatch ${accent === a.hex ? 'on' : ''}`} style={{ background: a.hex }} title={t(a.name)}
                aria-label={t(a.name)} onClick={() => save({ accent: a.hex })}>{accent === a.hex && <Check className="ico" aria-hidden />}</button>
            ))}
            <label className="check">
              <input type="color" value={accent ?? company ?? '#2a78d6'} onChange={(e) => save({ accent: e.target.value })} aria-label={t('Custom colour')} />
              {t('Custom')}
            </label>
          </div>
          <div className="pref-preview">
            <button className="primary">{t('New contract')}</button>
            <a href="#preview" onClick={(e) => e.preventDefault()}>{t('A link')}</a>
            <span className="badge"><span className="dot" style={{ background: 'var(--accent)' }} />{t('Highlight')}</span>
            <StatusBadge status="DEF" />
          </div>
        </section>

        <section className="card stack">
          <h2>{t('Density and text size')}</h2>
          <div className="segmented" role="radiogroup" aria-label={t('Density')}>
            {(['comfortable', 'compact'] as const).map((d) => (
              <button key={d} role="radio" aria-checked={(prefs.density ?? 'comfortable') === d} className={(prefs.density ?? 'comfortable') === d ? 'on' : ''}
                onClick={() => save({ density: d === 'comfortable' ? null : d })}>{t(d === 'compact' ? 'Compact' : 'Comfortable')}</button>
            ))}
          </div>
          <label className="row">
            <span className="secondary small">{t('Text size')}</span>
            <input type="range" min={0.9} max={1.25} step={0.05} value={prefs.fontScale ?? 1}
              onChange={(e) => save({ fontScale: Number(e.target.value) === 1 ? null : Number(e.target.value) })} />
            <span className="small">{Math.round((prefs.fontScale ?? 1) * 100)}%</span>
          </label>
        </section>

        <ChangePassword />
      </div>
    </>
  );
}

/** Change your own password (the current one is asked for first). */
function ChangePassword() {
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => { setDone(false); setForm({ ...form, [k]: e.target.value }); };
  const mismatch = form.repeat !== '' && form.next !== form.repeat;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setError(null);
    setBusy(true);
    try {
      await api('/me/password', { method: 'POST', body: { current_password: form.current, new_password: form.next } });
      setForm({ current: '', next: '', repeat: '' });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <h2>{t('Password')}</h2>
      <p className="secondary small" style={{ margin: 0 }}>{t('Change the password you sign in with. Forgot it? Ask an admin to set a new one under Admin & IT → Team.')}</p>
      <ErrorNote error={error} />
      {done && <div className="alert info" role="status">{t('Password changed. Use the new one next time you sign in.')}</div>}
      <form className="form-grid" onSubmit={submit}>
        <Field label={t('Current password')} className="span-2">
          <input type="password" autoComplete="current-password" required value={form.current} onChange={set('current')} />
        </Field>
        <Field label={t('New password (8+ characters)')}>
          <input type="password" autoComplete="new-password" minLength={8} required value={form.next} onChange={set('next')} />
        </Field>
        <Field label={t('Repeat the new password')}>
          <input type="password" autoComplete="new-password" minLength={8} required value={form.repeat} onChange={set('repeat')}
            aria-invalid={mismatch} />
        </Field>
        {mismatch && <p className="small danger-text span-all" style={{ margin: 0 }}>{t('The two new passwords are not the same.')}</p>}
        <div className="span-all"><button className="primary" disabled={busy || mismatch}>{t('Change password')}</button></div>
      </form>
    </section>
  );
}
