/**
 * Creates a demo workspace ("demo" / owner@demo.test / demo12345) with venues,
 * function spaces, a sales team and bookings across the whole pipeline.
 * Goes through the HTTP API so every business rule applies.
 */
import { buildApp } from '../src/app.js';
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

let token: string;
try {
  ({ token } = await call('POST', '/auth/signup', null, {
    company_name: 'WEDX Events', slug: 'demo', name: 'Demo Owner', email: 'owner@demo.test',
    password: 'demo12345', business_unit_code: 'W',
  }));
} catch {
  console.log('Demo workspace already exists; nothing to do.');
  await app.close();
  await pool.end();
  process.exit(0);
}

await call('POST', '/business-units', token, { code: 'X', name: 'CONFX Group' });
const team = [
  ['Joumana', 'JOU', 'sales'], ['Lojain', 'LOJ', 'sales'], ['Melinda', 'MEL', 'manager'], ['Faisal', 'FTM', 'finance'],
] as const;
const users: Record<string, string> = {};
for (const [name, code, role] of team) {
  const u = await call('POST', '/users', token, {
    name, code, role, email: `${code.toLowerCase()}@demo.test`, password: 'demo12345',
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

console.log('Seeded workspace "demo". Log in with owner@demo.test / demo12345');
await app.close();
await pool.end();
