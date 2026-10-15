import type { ReactNode } from 'react';

/**
 * The ERP modules shown as icons on the home screen (the customer's module plan).
 * Built modules open their screen; planned ones show as "Coming soon".
 * Admins can rearrange the icons for the whole company (tenants.home_order).
 */
export type Area = 'all' | 'sell' | 'activity' | 'finance' | 'manage' | 'admin';

export interface Module {
  key: string;
  label: string;
  /** Screen it opens; absent while the module is still planned. */
  to?: string;
  /** Who sees the icon. */
  area: Area;
  /** Icon background: two colours of a top-to-bottom gradient. */
  colors: [string, string];
  glyph: ReactNode;
}

const g = (children: ReactNode) => (
  <svg viewBox="0 0 48 48" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const MODULES: Module[] = [
  {
    key: 'dashboard', label: 'Dashboard', to: '/dashboard', area: 'all', colors: ['#4f8cff', '#1d4ed8'],
    glyph: g(<><path d="M9 37h30" /><rect x="12" y="24" width="5" height="10" rx="1.5" fill="#fff" stroke="none" /><rect x="21.5" y="16" width="5" height="18" rx="1.5" fill="#fff" stroke="none" /><rect x="31" y="11" width="5" height="23" rx="1.5" fill="#fff" stroke="none" opacity=".75" /></>),
  },
  {
    key: 'contracts', label: 'Contracts', to: '/bookings', area: 'all', colors: ['#ff9f43', '#e8590c'],
    glyph: g(<><path d="M15 8h13l8 8v22a3 3 0 0 1-3 3H15a3 3 0 0 1-3-3V11a3 3 0 0 1 3-3z" /><path d="M28 8v8h8" /><path d="M18 25h12M18 31h8" /><path d="M29 35l2.5 2.5L37 32" strokeWidth="2.4" /></>),
  },
  { key: 'calendar', label: 'Event calendar', to: '/diary', area: 'all', colors: ['#ffffff', '#f2f2f2'], glyph: null },
  {
    key: 'activities', label: 'Activities', to: '/activities', area: 'all', colors: ['#34d399', '#059669'],
    glyph: g(<><circle cx="24" cy="24" r="14" /><path d="M24 15v9l6 4" /><path d="M10 10l4 4M38 10l-4 4" /></>),
  },
  {
    key: 'crm', label: 'CRM', to: '/clients', area: 'all', colors: ['#2dd4bf', '#0e7490'],
    glyph: g(<><circle cx="19" cy="18" r="6" /><path d="M8 37c0-6 5-10 11-10s11 4 11 10" /><path d="M31 13a6 6 0 0 1 0 11M34 28c4 1.5 6 4.6 6 9" /></>),
  },
  {
    key: 'operations', label: 'Operations', area: 'manage', colors: ['#94a3b8', '#475569'],
    glyph: g(<><path d="M10 33h28" /><path d="M13 33c0-6.5 5-11.5 11-11.5S35 26.5 35 33" /><path d="M24 21.5V18" /><circle cx="24" cy="16" r="2" fill="#fff" stroke="none" /><path d="M9 38h30" /></>),
  },
  {
    key: 'finance', label: 'Finance', to: '/finance', area: 'finance', colors: ['#22c55e', '#166534'],
    glyph: g(<><rect x="8" y="13" width="32" height="22" rx="4" /><circle cx="24" cy="24" r="5" /><path d="M13 19h.01M35 29h.01" strokeWidth="3.4" /></>),
  },
  {
    key: 'inventory', label: 'Inventory', area: 'manage', colors: ['#fbbf24', '#b45309'],
    glyph: g(<><path d="M24 8l14 7v18l-14 7-14-7V15z" /><path d="M10 15l14 7 14-7M24 22v18" /><path d="M17 11.5l14 7" /></>),
  },
  {
    key: 'admin', label: 'Admin & IT', to: '/settings', area: 'manage', colors: ['#9ca3af', '#4b5563'],
    glyph: g(<><circle cx="24" cy="24" r="5.5" /><path d="M24 8v5M24 35v5M8 24h5M35 24h5M12.7 12.7l3.6 3.6M31.7 31.7l3.6 3.6M12.7 35.3l3.6-3.6M31.7 16.3l3.6-3.6" /></>),
  },
  {
    key: 'marketing', label: 'Marketing', area: 'manage', colors: ['#f472b6', '#be185d'],
    glyph: g(<><path d="M10 21v6a2 2 0 0 0 2 2h4l12 7V12l-12 7h-4a2 2 0 0 0-2 2z" /><path d="M16 29l2 8h4l-1.5-6" /><path d="M33 19c2 1.5 2 8.5 0 10M37 15c4 3.5 4 14.5 0 18" /></>),
  },
  {
    key: 'procurement', label: 'Procurement', area: 'manage', colors: ['#818cf8', '#4338ca'],
    glyph: g(<><path d="M7 10h5l4 20h20l4-14H14" /><circle cx="19" cy="37" r="2.6" /><circle cx="33" cy="37" r="2.6" /></>),
  },
  {
    key: 'hr', label: 'HR', area: 'manage', colors: ['#38bdf8', '#0369a1'],
    glyph: g(<><rect x="9" y="12" width="30" height="24" rx="4" /><circle cx="19" cy="22" r="4" /><path d="M12.5 32c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5" /><path d="M29 20h6M29 26h6" /></>),
  },
];

/** Icons in the company's order; modules missing from a saved order keep their default place at the end. */
export function ordered(order: string[] | null | undefined): Module[] {
  if (!order?.length) return MODULES;
  const byKey = new Map(MODULES.map((m) => [m.key, m]));
  const known = order.map((k) => byKey.get(k)).filter((m): m is Module => Boolean(m));
  return [...known, ...MODULES.filter((m) => !order.includes(m.key))];
}
