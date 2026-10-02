import { useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { date } from './format';
import { Icon } from './components/ui';
import { Bell } from './components/Bell';
import { Activities } from './pages/Activities';
import { Delegations } from './pages/Delegations';
import { BookingDetailPage } from './pages/BookingDetail';
import { Bookings } from './pages/Bookings';
import { Clients } from './pages/Clients';
import { Dashboard } from './pages/Dashboard';
import { Diary } from './pages/Diary';
import { Finance } from './pages/Finance';
import { Login, Signup } from './pages/Auth';
import { PlatformConsole, PlatformLogin } from './pages/Platform';
import { Preferences } from './pages/Preferences';
import { Settings } from './pages/Settings';
import { lang, t } from './i18n';

const ROLE_NAMES: Record<string, string> = {
  owner: 'Owner', admin: 'Admin', manager: 'Sales manager', sales: 'Sales / account manager', finance: 'Finance', viewer: 'Viewer',
};

const NAV = [
  ['/', 'Dashboard', Icon.dashboard],
  ['/bookings', 'Bookings', Icon.bookings],
  ['/diary', 'Function diary', Icon.diary],
  ['/activities', 'Activities', Icon.activities],
  ['/clients', 'Clients', Icon.clients],
  ['/delegations', 'Cover & delegation', Icon.cover],
  ['/finance', 'Finance', Icon.finance],
  ['/settings', 'Settings', Icon.settings],
] as const;

export function App() {
  const { me, loading, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  // Re-render everything when the language changes (before sign-in it is chosen on the login page).
  const [, setPreLang] = useState(lang().code);

  // The operator console has its own login and never uses a workspace session.
  if (location.pathname.startsWith('/platform')) {
    return (
      <Routes>
        <Route path="/platform/login" element={<PlatformLogin />} />
        <Route path="/platform/*" element={<PlatformConsole />} />
      </Routes>
    );
  }
  if (loading) return <div className="empty">{t("Loading…")}</div>;
  if (!me) {
    return (
      <Routes key={lang().code}>
        <Route path="/signup" element={<Signup onLanguage={setPreLang} />} />
        <Route path="*" element={location.pathname === '/login' ? <Login onLanguage={setPreLang} /> : <Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <div className="shell" key={lang().code}>
      <div className="mobile-bar">
        <button className="ghost" onClick={() => setMenuOpen((o) => !o)} aria-label={t("Menu")}>☰</button>
        <strong>{me.tenant.name}</strong>
      </div>
      <nav className={`sidebar ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)}>
        <div className="brand">
          <div className="brand-mark">{me.tenant.name.slice(0, 2).toUpperCase()}</div>
          <div className="grow">
            {me.tenant.name}
            <small>{t("Sales & Event Management")}</small>
          </div>
          <Bell />
        </div>
        {NAV.map(([to, label, icon]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            {icon}
            {t(label)}
          </NavLink>
        ))}
        <div className="sidebar-foot">
          <div><strong>{me.name}</strong> <span className="tag">{me.code}</span></div>
          <div className="muted" style={{ margin: '2px 0 8px' }}>
            {t(ROLE_NAMES[me.role])} · {me.tenant.slug} · {me.tenant.plan}
            <div>{me.sees_all ? t("Sees the whole company") : me.team_ids.length > 1 ? t('Sees own + {n} in team', { n: me.team_ids.length - 1 }) : t("Sees own records")}</div>
          </div>
          <div className="row">
            <NavLink to="/preferences" className="btn sm">{t('Preferences')}</NavLink>
            <button className="sm" onClick={signOut}>{t("Sign out")}</button>
          </div>
        </div>
      </nav>
      <main className="main">
        {(me.covering ?? []).length > 0 && (
          <div className="cover-banner">{t("You are covering for")}{' '}<strong>{me.covering.map((c) => c.delegator_name).join(', ')}</strong>
            {me.covering[0].ends_on ? ` ${t('until {date}', { date: date(me.covering[0].ends_on) })}` : ''}.
            {' '}{t("Their bookings appear in your lists")}{me.covering.some((c) => c.access === 'view') ? t(" (some view only)") : ''}. <NavLink to="/delegations">{t("Details")}</NavLink>
          </div>
        )}
        {(me.covered_by ?? []).length > 0 && (
          <div className="cover-banner subtle">
            <strong>{me.covered_by.map((c) => c.delegate_name).join(', ')}</strong> {me.covered_by.length > 1 ? t("are") : t("is")}{' '}{t("covering for you.")}{' '}<NavLink to="/delegations">{t("Manage")}</NavLink>
          </div>
        )}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/bookings" element={<Bookings />} />
          <Route path="/bookings/:id" element={<BookingDetailPage />} />
          <Route path="/diary" element={<Diary />} />
          <Route path="/activities" element={<Activities />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/delegations" element={<Delegations />} />
          <Route path="/finance" element={<Finance />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/preferences" element={<Preferences />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
