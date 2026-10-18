/**
 * Demo data: venues, function spaces, a 4-level sales team and ~100 contracts across the
 * whole pipeline (18 months, so the dashboard has trends). Goes through the HTTP API so
 * every business rule applies. All names and numbers are made up.
 *
 * Two ways to run it:
 *
 *  1. Local demo (default):  npm run seed
 *     Creates the "demo" workspace (owner@demo.test / demo12345), a pending sign-up and a
 *     platform operator (admin@platform.test / platform12345). Those passwords are published
 *     in the README, so this mode refuses to run on a production server.
 *
 *  2. Fill an existing workspace (safe on a live server):
 *       SEED_WORKSPACE=<workspace id> SEED_OWNER_EMAIL=<owner email> SEED_OWNER_PASSWORD=<…> \
 *       SEED_USER_PASSWORD=<password for the demo staff> node dist/scripts/seed.js
 *     Create and approve the workspace first (sign-up + operator console). The script signs in
 *     as its owner and adds the demo data. It creates no operator and no other sign-up, and it
 *     stops if the workspace already has contracts, so it never mixes into real data.
 */
import { buildApp } from '../src/app.js';
import { createPlatformAdmin } from './create-platform-admin.js';
import { pool } from '../src/db.js';

const app = await buildApp();

async function call<T = any>(method: string, url: string, token: string | null, payload?: unknown): Promise<T> {
  const res = await app.inject({
    method: method as 'GET',
    url: `/api${url}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: payload as object,
  });
  if (res.statusCode >= 400) throw new Error(`${method} ${url} -> ${res.statusCode} ${res.body}`);
  return res.json() as T;
}

async function stop(message: string, code = 0): Promise<never> {
  console.log(message);
  await app.close();
  await pool.end();
  process.exit(code);
}

const existing = process.env.SEED_OWNER_EMAIL;
/** Password of the demo staff (Melinda, Lojain, …). */
const USER_PASSWORD = existing ? process.env.SEED_USER_PASSWORD ?? '' : 'demo12345';
let token: string;

if (existing) {
  // ---- 2. fill an existing, approved workspace ------------------------------------
  const workspace = process.env.SEED_WORKSPACE;
  const password = process.env.SEED_OWNER_PASSWORD;
  if (!workspace || !password) await stop('Set SEED_WORKSPACE and SEED_OWNER_PASSWORD as well.', 1);
  if (USER_PASSWORD.length < 8) await stop('Set SEED_USER_PASSWORD (at least 8 characters) for the demo staff.', 1);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: existing, password, workspace } });
  if (login.statusCode !== 200) await stop(`Could not sign in to workspace "${workspace}": ${login.body}`, 1);
  token = login.json().token;
  const me = await call<{ role: string }>('GET', '/auth/me', token);
  if (me.role !== 'owner' && me.role !== 'admin') await stop('Sign in as the workspace owner or an admin.', 1);
  const { totals } = await call<{ totals: { count: string | number } }>('GET', '/bookings?limit=1', token);
  if (Number(totals.count) > 0) await stop(`Workspace "${workspace}" already has contracts; demo data is only added to an empty workspace.`, 1);
} else {
  // ---- 1. local demo ----------------------------------------------------------------
  if (process.env.NODE_ENV === 'production') {
    await stop('Not on a production server: this mode creates accounts with published passwords. Use SEED_OWNER_EMAIL (see the top of this file).', 1);
  }
  // A platform operator for the demo, so the approval console can be tried too.
  await createPlatformAdmin('admin@platform.test', 'platform12345', 'Platform Admin');
  const signup = await app.inject({
    method: 'POST', url: '/api/auth/signup',
    payload: { company_name: 'WEDX Events', slug: 'demo', name: 'Demo Owner', email: 'owner@demo.test',
               password: 'demo12345', business_unit_code: 'W', phone: '+965 2222 0000', note: 'Demo workspace' },
  });
  if (signup.statusCode !== 200) await stop('Demo workspace already exists; nothing to do.');
  // Approve it as the operator would.
  const ops = (await call<{ token: string }>('POST', '/platform/login', null, { email: 'admin@platform.test', password: 'platform12345' })).token;
  const { tenants } = await call<{ tenants: { id: string; slug: string }[] }>('GET', '/platform/tenants', ops);
  await call('POST', `/platform/tenants/${tenants.find((t) => t.slug === 'demo')!.id}/approve`, ops, { plan: 'pro', max_users: 25 });
  token = (await call<{ token: string }>('POST', '/auth/login', null, { email: 'owner@demo.test', password: 'demo12345' })).token;

  // A second sign-up left pending, to show the approval queue.
  await app.inject({
    method: 'POST', url: '/api/auth/signup',
    payload: { company_name: 'Gulf Catering Co', slug: 'gulf-catering', name: 'Sara Al-Mutairi', email: 'sara@gulfcatering.test',
               password: 'demo12345', business_unit_code: 'G', phone: '+965 6000 1234',
               note: 'Corporate catering, 12 sales staff, moving off spreadsheets' },
  });
}

const units = await call<{ code: string }[]>('GET', '/business-units', token);
if (!units.some((u) => u.code === 'X')) await call('POST', '/business-units', token, { code: 'X', name: 'CONFX Group' });
// A 4-level sales team plus a second branch, so team visibility can be tried:
// Owner > Melinda (sales manager) > Lojain (team lead) > Joumana (account manager)
//       > Ahmad (sales manager) > Ghada (account manager)
// Faisal (finance) sees the whole company.
const ownerId = (await call<{ id: string }>('GET', '/auth/me', token)).id;
const team = [
  ['Melinda', 'MEL', 'manager', null], ['Lojain', 'LOJ', 'manager', 'MEL'], ['Joumana', 'JOU', 'sales', 'LOJ'],
  ['Ahmad', 'AHD', 'manager', null], ['Ghada', 'GHA', 'sales', 'AHD'], ['Faisal', 'FTM', 'finance', null],
] as const;
const users: Record<string, string> = {};
for (const [name, code, role, manager] of team) {
  const u = await call('POST', '/users', token, {
    name, code, role, email: `${code.toLowerCase()}@demo.test`, password: USER_PASSWORD,
    manager_id: manager ? users[manager] : role === 'finance' ? null : ownerId,
  });
  users[code] = u.id;
}

const venues: Record<string, { id: string; spaces: Record<string, string> }> = {};
const venueDefs: [string, string, [string, number][]][] = [
  ['FOUR SEASONS', 'hotel', [['MIRQAB Ballroom', 400], ['DASMAN', 120]]],
  ['RADISSON', 'hotel', [['LAILATI Ballroom', 350], ['Sky Lounge', 80]]],
  ['JUMEIRAH', 'hotel', [['Grand Ballroom', 600]]],
  ['GOV. HALL', 'hall', [['MESSILA Ballroom', 250]]],
  ['HOME', 'client_location', [['Client location', 0]]],
];
for (const [name, kind, spaces] of venueDefs) {
  const v = await call('POST', '/venues', token, { name, kind });
  venues[name] = { id: v.id, spaces: {} };
  for (const [space, capacity] of spaces) {
    const s = await call('POST', '/function-spaces', token, {
      venue_id: v.id, name: space, capacity: capacity || null, allow_overlap: kind === 'client_location',
    });
    venues[name].spaces[space] = s.id;
  }
}

const year = new Date().getFullYear();
const d = (m: number, day: number) => `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const samples = [
  { name: 'Latifa wedding', contact: { name: 'Latifa', phone: '66230001', nationality: 'KUWAIT' }, status: 'DEF', event_type: 'W', source: 'INSTA', owner: 'JOU', venue: ['FOUR SEASONS', 'MIRQAB Ballroom'], date: d(11, 12), pax: 250, lines: [['F&B', 'Buffet dinner', 250, 18, 11], ['DECOR', 'Kosha & stage flowers', 1, 3200, 1900]], pay: 4000, cf: false },
  { name: 'Ministry annual conference', contact: { name: 'Hessa Ruqaibi', phone: '97970002' }, status: 'DEF', event_type: 'C', source: 'MINISTRY', owner: 'LOJ', venue: ['JUMEIRAH', 'Grand Ballroom'], date: d(10, 20), pax: 400, lines: [['F&B', 'Coffee breaks & lunch', 400, 12, 7.5], ['AV', 'Stage, LED & sound', 1, 5500, 3900]], pay: 0, cf: true },
  { name: 'Sara engagement at home', contact: { name: 'Sara', phone: '55490003' }, status: 'TEN', event_type: 'E', source: 'SNAPCHAT', owner: 'JOU', venue: ['HOME', 'Client location'], date: d(12, 5), pax: 60, lines: [['DECOR', 'Bride sofa & flowers', 1, 950, 520]] },
  { name: 'Graduation party', contact: { name: 'Al Shareef', phone: '97960004' }, status: 'INQ', event_type: 'G', source: 'TIKTOK', owner: 'LOJ', venue: ['RADISSON', 'Sky Lounge'], date: d(12, 18), pax: 70 },
  { name: 'Wedding – shopping around', contact: { name: 'Noura', phone: '99020005' }, status: 'LOS', lost: 'BUDGET', event_type: 'W', source: 'INSTA', owner: 'LOJ', venue: ['RADISSON', 'LAILATI Ballroom'], date: d(9, 3), pax: 200 },
  { name: 'Corporate gala dinner', contact: { name: 'Bader', phone: '66000006' }, status: 'DEF', event_type: 'D', source: 'CALL', owner: 'MEL', venue: ['GOV. HALL', 'MESSILA Ballroom'], date: d(6, 14), pax: 180, lines: [['F&B', 'Set menu dinner', 180, 22, 13]], pay: 3960, cf: false },
] as const;

for (const s of samples) {
  const [venueName, spaceName] = s.venue;
  const b = await call('POST', '/bookings', token, {
    name: s.name, contact: s.contact, event_type: s.event_type, source: s.source, owner_id: users[s.owner],
    function_space_id: venues[venueName].spaces[spaceName], event_date: s.date, pax: s.pax,
    inquiry_date: d(1, 10), status: s.status === 'LOS' ? 'INQ' : s.status,
    credit_facility: 'cf' in s ? s.cf : false,
  });
  if (s.status === 'LOS') await call('POST', `/bookings/${b.id}/status`, token, { status: 'LOS', reason: 'lost' in s ? s.lost : 'OTHER' });
  for (const [category, description, quantity, unit_price, unit_cost] of 'lines' in s ? s.lines : []) {
    await call('POST', `/bookings/${b.id}/items`, token, { category, description, quantity, unit_price, unit_cost });
  }
  if (s.status === 'DEF') {
    await call('POST', `/bookings/${b.id}/payouts`, token, { kind: 'commission', payee_name: s.owner, user_id: users[s.owner], pct: 0.1 });
    await call('POST', `/bookings/${b.id}/payouts`, token, { kind: 'share', payee_name: 'Partner', pct: 0.5 });
  }
  if ('pay' in s && s.pay) {
    await call('POST', `/bookings/${b.id}/payments`, token, { paid_on: d(2, 1), amount: s.pay, method: 'BANK' });
  }
  await call('POST', '/activities', token, {
    booking_id: b.id, owner_id: users[s.owner], type: 'followup', subject: 'Follow up with client',
    due_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
}

// ~18 months of history so the dashboard has trends and a previous year to compare with.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const sources = ['INSTA', 'INSTA', 'INSTA', 'SNAPCHAT', 'TIKTOK', 'CALL', 'WEBSITE', 'REFERRAL', 'HOTEL'];
const types = ['W', 'W', 'W', 'E', 'C', 'D', 'G'];
const reasons = ['FOLLOWUP', 'BUDGET', 'BUDGET', 'PRICE', 'COMPETITOR', 'NO_ANSWER', 'SHOPPING'];
const names = ['Fatma', 'Noor', 'Dana', 'Hessa', 'Maryam', 'Abdullah', 'Yousef', 'Reem', 'Shahad', 'Lulwa', 'Khaled', 'Mona'];
const venueList = Object.values(venues);
const now = new Date();
for (let n = 0; n < 90; n++) {
  const monthsBack = Math.floor(rand() * 18) - 3; // a few events in the next quarter too
  const ev = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1 + Math.floor(rand() * 27));
  const enq = new Date(ev.getTime() - (20 + rand() * 120) * 86_400_000);
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const past = ev < now;
  const roll = rand();
  const status = past ? (roll < 0.38 ? 'DEF' : roll < 0.9 ? 'LOS' : 'CXL') : (roll < 0.3 ? 'DEF' : roll < 0.65 ? 'TEN' : 'INQ');
  const type = pick(types);
  const pax = 40 + Math.floor(rand() * 260);
  const owner = pick(['JOU', 'JOU', 'LOJ', 'LOJ', 'MEL', 'AHD', 'GHA', 'GHA']);
  const who = pick(names);
  const b = await call('POST', '/bookings', token, {
    name: `${who} ${type === 'W' ? 'wedding' : type === 'C' ? 'conference' : type === 'G' ? 'graduation' : type === 'D' ? 'dinner' : 'reception'}`,
    contact: { name: who, phone: `9${String(1000000 + Math.floor(rand() * 8999999))}` },
    event_type: type, source: pick(sources), owner_id: users[owner], venue_id: pick(venueList).id,
    event_date: iso(ev), inquiry_date: iso(enq), pax, status: status === 'LOS' || status === 'CXL' ? 'INQ' : status,
    credit_facility: rand() < 0.2,
  });
  if (status === 'DEF' || status === 'TEN' || status === 'INQ') {
    const price = 9 + Math.floor(rand() * 16);
    await call('POST', `/bookings/${b.id}/items`, token, { category: 'F&B', description: 'Dinner per guest', quantity: pax, unit_price: price, unit_cost: Math.round(price * (0.5 + rand() * 0.2) * 10) / 10 });
    if (rand() < 0.6) {
      const decor = 600 + Math.floor(rand() * 4000);
      await call('POST', `/bookings/${b.id}/items`, token, { category: 'DECOR', description: 'Stage & flowers', quantity: 1, unit_price: decor, unit_cost: Math.round(decor * 0.55) });
    }
  }
  if (status === 'DEF') {
    await call('POST', `/bookings/${b.id}/payouts`, token, { kind: 'commission', payee_name: owner, user_id: users[owner], pct: 0.1 });
    if (past && rand() < 0.8) {
      const detail = await call('GET', `/bookings/${b.id}`, token);
      await call('POST', `/bookings/${b.id}/payments`, token, { paid_on: iso(enq), amount: Math.round(detail.revenue * (rand() < 0.6 ? 1 : 0.5)) });
    }
  }
  if (status === 'LOS') await call('POST', `/bookings/${b.id}/status`, token, { status: 'LOS', reason: pick(reasons) });
  if (status === 'CXL') {
    await call('POST', `/bookings/${b.id}/status`, token, { status: 'TEN' });
    await call('POST', `/bookings/${b.id}/status`, token, { status: 'CXL', reason: 'Client postponed indefinitely' });
  }
}

if (existing) {
  console.log(`Added demo data to workspace "${process.env.SEED_WORKSPACE}". Demo staff sign in as mel@demo.test, loj@demo.test, jou@demo.test, ahd@demo.test, gha@demo.test, ftm@demo.test with SEED_USER_PASSWORD.`);
} else {
  console.log('Seeded workspace "demo" (owner@demo.test / demo12345) and a pending sign-up.');
  console.log('Platform console: /platform with admin@platform.test / platform12345');
}
await app.close();
await pool.end();
