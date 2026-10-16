import { lazy, Suspense, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { date } from './format';
import { PageTransition } from './components/motion';
import { TopBar } from './components/TopBar';
import { SkeletonPage } from './components/ui';
import { Login, Signup } from './pages/Auth';
import { PlatformConsole, PlatformLogin } from './pages/Platform';
import { Home } from './pages/Home';
import { lang, t } from './i18n';

// Pages load when first opened, so the first screen (and the phone) downloads less.
const Activities = lazy(() => import('./pages/Activities').then((m) => ({ default: m.Activities })));
const Delegations = lazy(() => import('./pages/Delegations').then((m) => ({ default: m.Delegations })));
const BookingDetailPage = lazy(() => import('./pages/BookingDetail').then((m) => ({ default: m.BookingDetailPage })));
const Bookings = lazy(() => import('./pages/Bookings').then((m) => ({ default: m.Bookings })));
const Clients = lazy(() => import('./pages/Clients').then((m) => ({ default: m.Clients })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Diary = lazy(() => import('./pages/Diary').then((m) => ({ default: m.Diary })));
const Finance = lazy(() => import('./pages/Finance').then((m) => ({ default: m.Finance })));
const Preferences = lazy(() => import('./pages/Preferences').then((m) => ({ default: m.Preferences })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));

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
        <PageTransition id={location.pathname}>
          <Suspense fallback={<SkeletonPage />}>
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
          </Suspense>
        </PageTransition>
      </main>
    </div>
  );
}
