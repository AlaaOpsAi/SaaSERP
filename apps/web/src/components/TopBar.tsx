import { Settings, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api, type Me } from '../api';
import { useAuth } from '../auth';
import { greeting, longToday } from '../format';
import { LANGUAGES, lang, t } from '../i18n';
import { MODULES, ordered } from '../modules';
import { Bell } from './Bell';

/**
 * The bar on every page (customer request): the company logo and the user's full name on
 * the left, Home · ☰ Menu · EN | AR on the right. It never mirrors: in Arabic only the page
 * below switches to right-to-left. The menu replaces the old sidebar.
 */
export function TopBar() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const { data: bell } = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ unread: number }>('/notifications'), refetchInterval: 60_000 });
  useEffect(() => setOpen(false), [location.pathname]);
  if (!me) return null;
  const unread = bell?.unread ?? 0;
  return (
    <>
      <header className="topbar" dir="ltr">
        <Link to="/" className="topbar-brand" aria-label={t('Home')}>
          <LogoBox me={me} />
          {/* The greeting and today's date live in the bar, so pages start with their content. */}
          <span className="topbar-greeting">
            <span className="topbar-name" dir="auto">{greeting()}, {me.name}</span>
            <span className="topbar-sub" dir="auto">{longToday()} · {me.tenant.name}{' '}{t('· figures in')}{' '}{me.tenant.currency}</span>
          </span>
        </Link>
        <div className="topbar-actions">
          <button className={`top-btn ${location.pathname === '/' ? 'on' : ''}`} onClick={() => navigate('/')} aria-label={t('Home')} title={t('Home')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
          </button>
          <button className="top-btn" onClick={() => setOpen(true)} aria-label={unread ? t('Menu, {n} new notifications', { n: unread }) : t('Menu')} aria-expanded={open} title={t('Menu')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            {unread > 0 && <span className="top-dot" />}
          </button>
          <LanguageToggle />
        </div>
      </header>
      {open && <MenuPanel onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The company logo in a box framed by a thin line in the logo's own colour: the black logo
 * on the light theme, the white one on the dark theme (CSS picks one). Until a logo is
 * uploaded, the company's name stands in for it.
 */
export function LogoBox({ me }: { me: Me }) {
  const label = me.company?.name ?? me.tenant.name;
  if (!me.logo.light && !me.logo.dark) return <span className="logo-box text" title={label}>{me.company?.code ?? label}</span>;
  return (
    <span className="logo-box" title={label}>
      <img className="logo-light" src={me.logo.light ?? me.logo.dark!} alt={label} />
      <img className="logo-dark" src={me.logo.dark ?? me.logo.light!} alt="" aria-hidden="true" />
    </span>
  );
}

/** EN | AR: switches the language straight away and remembers it on the account. */
export function LanguageToggle() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const current = lang().code;
  const choose = (code: string) => {
    if (code === current || !me) return;
    qc.setQueryData<Me>(['me'], (m) => (m ? { ...m, preferences: { ...m.preferences, locale: code } } : m));
    api('/me/preferences', { method: 'PATCH', body: { locale: code } }).catch(() => undefined);
  };
  return (
    <div className="lang-toggle" role="group" aria-label={t('Language')} dir="ltr">
      {LANGUAGES.map((l) => (
        <button key={l.code} className={current === l.code ? 'on' : ''} aria-pressed={current === l.code} lang={l.code}
          onClick={() => choose(l.code)} title={l.name}>{l.code.toUpperCase()}</button>
      ))}
    </div>
  );
}

function MenuPanel({ onClose }: { onClose: () => void }) {
  const { me, can, signOut } = useAuth();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (!me) return null;
  const modules = ordered(me.tenant.home_order).filter((m) => m.area === 'all' || can(m.area));
  const live = modules.filter((m) => m.to);
  const planned = modules.filter((m) => !m.to);
  // Name card (customer request): job title and employee ID; the permission level shows only in Admin & IT.
  const card = [me.job_title?.toUpperCase(), me.employee_no].filter(Boolean).join(' - ');
  const item = (to: string, label: string, icon: React.ReactNode, colors?: [string, string]) => (
    <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `menu-item ${isActive ? 'active' : ''}`} onClick={onClose}>
      <span className="menu-icon" style={colors ? { background: `linear-gradient(180deg, ${colors[0]}, ${colors[1]})` } : undefined}>{icon}</span>
      {label}
    </NavLink>
  );
  const calendarGlyph = (
    <svg viewBox="0 0 48 48" fill="none" stroke="#e5383b" strokeWidth="3"><rect x="9" y="11" width="30" height="28" rx="4" /><path d="M9 20h30M17 7v8M31 7v8" /></svg>
  );
  return (
    <div className="menu-layer" onClick={onClose}>
      <aside className="menu-panel" role="dialog" aria-label={t('Menu')} onClick={(e) => e.stopPropagation()}>
        <div className="menu-head">
          <span className="avatar">{(me.code ?? me.name).slice(0, 3)}</span>
          <div className="grow">
            <strong>{me.name}</strong>
            {card && <div className="small muted name-card" dir="auto">{card}</div>}
          </div>
          <Bell />
          <button className="top-btn" onClick={onClose} aria-label={t('Close')}><X className="ico" aria-hidden /></button>
        </div>
        <nav className="menu-list">
          {item('/', t('Home'), <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>, ['#4f8cff', '#1d4ed8'])}
          {live.map((m) => item(m.to!, t(m.label), m.key === 'calendar' ? calendarGlyph : m.glyph, m.key === 'calendar' ? ['#ffffff', '#f2f2f2'] : m.colors))}
          {item('/delegations', t('Cover & delegation'), MODULES.find((m) => m.key === 'crm')!.glyph, ['#a78bfa', '#7c3aed'])}
          {planned.length > 0 && (
            <div className="menu-item planned">
              <span className="menu-icon" style={{ background: '#cbd5e1' }}>{planned[0].glyph}</span>
              <span className="grow">{planned.map((m) => t(m.label)).join(' · ')}</span>
              <span className="tag">{t('Soon')}</span>
            </div>
          )}
        </nav>
        <div className="menu-foot">
          <NavLink to="/preferences" className="menu-item" onClick={onClose}><Settings className="ico" aria-hidden /> {t('Preferences')}</NavLink>
          <button className="menu-item danger-text" onClick={signOut}>⎋ {t('Sign out')}</button>
          <div className="small muted" style={{ padding: '6px 10px' }}>{me.tenant.slug} · {me.tenant.plan}</div>
        </div>
      </aside>
    </div>
  );
}
