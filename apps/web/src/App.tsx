import { useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { date } from './format';
import { TopBar } from './components/TopBar';
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
import { Home } from './pages/Home';
import { Preferences } from './pages/Preferences';
import { Settings } from './pages/Settings';
import { lang, t } from './i18n';

export function App() {
  const { me, loading } = useAuth();
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
      <TopBar />
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
          <Route path="/" element={<Home />} />
          <Route path="/dashboard" element={<Dashboard />} />
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
