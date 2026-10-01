import { useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Icon } from './components/ui';
import { Activities } from './pages/Activities';
import { BookingDetailPage } from './pages/BookingDetail';
import { Bookings } from './pages/Bookings';
import { Clients } from './pages/Clients';
import { Dashboard } from './pages/Dashboard';
import { Diary } from './pages/Diary';
import { Finance } from './pages/Finance';
import { Login, Signup } from './pages/Auth';
import { PlatformConsole, PlatformLogin } from './pages/Platform';
import { Settings } from './pages/Settings';

const NAV = [
  ['/', 'Dashboard', Icon.dashboard],
  ['/bookings', 'Bookings', Icon.bookings],
  ['/diary', 'Function diary', Icon.diary],
  ['/activities', 'Activities', Icon.activities],
  ['/clients', 'Clients', Icon.clients],
  ['/finance', 'Finance', Icon.finance],
  ['/settings', 'Settings', Icon.settings],
] as const;

export function App() {
  const { me, loading, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // The operator console has its own login and never uses a workspace session.
  if (location.pathname.startsWith('/platform')) {
    return (
      <Routes>
        <Route path="/platform/login" element={<PlatformLogin />} />
        <Route path="/platform/*" element={<PlatformConsole />} />
      </Routes>
    );
  }
  if (loading) return <div className="empty">Loading…</div>;
  if (!me) {
    return (
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="*" element={location.pathname === '/login' ? <Login /> : <Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <div className="shell">
      <div className="mobile-bar">
        <button className="ghost" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu">☰</button>
        <strong>{me.tenant.name}</strong>
      </div>
      <nav className={`sidebar ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)}>
        <div className="brand">
          <div className="brand-mark">{me.tenant.name.slice(0, 2).toUpperCase()}</div>
          <div>
            {me.tenant.name}
            <small>Sales & Event Management</small>
          </div>
        </div>
        {NAV.map(([to, label, icon]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            {icon}
            {label}
          </NavLink>
        ))}
        <div className="sidebar-foot">
          <div><strong>{me.name}</strong> <span className="tag">{me.code}</span></div>
          <div className="muted" style={{ margin: '2px 0 8px' }}>{me.role} · {me.tenant.slug} · {me.tenant.plan}</div>
          <button className="sm" onClick={signOut}>Sign out</button>
        </div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/bookings" element={<Bookings />} />
          <Route path="/bookings/:id" element={<BookingDetailPage />} />
          <Route path="/diary" element={<Diary />} />
          <Route path="/activities" element={<Activities />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/finance" element={<Finance />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
