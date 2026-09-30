import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Status } from '../api';
import { dayOf, STATUS_LABEL, time, today } from '../format';
import { useVenues } from '../hooks';

interface DiaryData {
  spaces: { id: string; name: string; capacity: number | null; venue_id: string; venue_name: string }[];
  events: { id: string; name: string; function_space_id: string; start_at: string; end_at: string; expected_pax: number | null;
            booking_id: string; booking_no: string; booking_name: string; status: Status; owner_code: string | null; overlaps: boolean }[];
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function addDays(s: string, n: number) {
  const d = new Date(`${s}T00:00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
}
function startOfWeek(s: string) {
  const d = new Date(`${s}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 1) % 7)); // weeks start on Saturday
  return iso(d);
}

export function Diary() {
  const [from, setFrom] = useState(startOfWeek(today()));
  const [span, setSpan] = useState(14);
  const [venueId, setVenueId] = useState('');
  const [showLost, setShowLost] = useState(false);
  const [inUse, setInUse] = useState(false);
  const to = addDays(from, span - 1);
  const { data: venues } = useVenues();
  const { data } = useQuery({
    queryKey: ['diary', from, to, venueId, showLost],
    queryFn: () => api<DiaryData>(`/diary?from=${from}&to=${to}${venueId ? `&venue_id=${venueId}` : ''}${showLost ? '&include_lost=true' : ''}`),
  });
  const days = Array.from({ length: span }, (_, i) => addDays(from, i));
  const byCell = new Map<string, DiaryData['events']>();
  for (const e of data?.events ?? []) {
    const k = `${e.function_space_id}|${dayOf(e.start_at)}`;
    byCell.set(k, [...(byCell.get(k) ?? []), e]);
  }
  const t = today();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Function diary</h1>
          <p>Space availability across venues. Red outline = overlapping holds on an exclusive room.</p>
        </div>
      </div>
      <div className="filters">
        <button onClick={() => setFrom(addDays(from, -span))}>←</button>
        <button onClick={() => setFrom(startOfWeek(today()))}>Today</button>
        <button onClick={() => setFrom(addDays(from, span))}>→</button>
        <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="From" />
        <select value={span} onChange={(e) => setSpan(Number(e.target.value))} aria-label="Range">
          <option value={7}>1 week</option><option value={14}>2 weeks</option><option value={28}>4 weeks</option>
        </select>
        <select value={venueId} onChange={(e) => setVenueId(e.target.value)} aria-label="Venue">
          <option value="">All venues</option>
          {venues?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={inUse} onChange={(e) => setInUse(e.target.checked)} />Only rooms in use</label>
        <label className="check"><input type="checkbox" checked={showLost} onChange={(e) => setShowLost(e.target.checked)} />Show lost & cancelled</label>
      </div>
      <div className="legend" style={{ marginBottom: 12 }}>
        {(['TEN', 'DEF', 'ACT'] as Status[]).map((s) => (
          <span key={s}><i style={{ background: `var(--${s === 'TEN' ? 'status-warning' : s === 'DEF' ? 'status-good' : 'series-1'})` }} />{STATUS_LABEL[s]}</span>
        ))}
      </div>

      {data && data.spaces.length === 0 ? (
        <div className="card empty">No function spaces yet. Add venues and rooms under <Link to="/settings">Settings</Link>.</div>
      ) : (
        <div className="diary" style={{ gridTemplateColumns: `180px repeat(${span}, minmax(${span > 14 ? 90 : 120}px, 1fr))` }}>
          <div className="diary-cell diary-head diary-space">Space</div>
          {days.map((d) => {
            const dt = new Date(`${d}T00:00:00`);
            return (
              <div key={d} className={`diary-cell diary-head ${d === t ? 'today' : ''}`}>
                {dt.toLocaleDateString(undefined, { weekday: 'short' })}<br />{dt.getDate()} {dt.toLocaleDateString(undefined, { month: 'short' })}
              </div>
            );
          })}
          {data?.spaces.filter((s) => !inUse || days.some((d) => byCell.has(`${s.id}|${d}`))).map((s) => (
            <Row key={s.id} space={s} days={days} byCell={byCell} />
          ))}
        </div>
      )}
    </>
  );
}

function Row({ space, days, byCell }: { space: DiaryData['spaces'][number]; days: string[]; byCell: Map<string, DiaryData['events']> }) {
  return (
    <>
      <div className="diary-cell diary-space">
        {space.name}
        <small>{space.venue_name}{space.capacity ? ` · ${space.capacity}` : ''}</small>
      </div>
      {days.map((d) => (
        <div key={d} className="diary-cell">
          {(byCell.get(`${space.id}|${d}`) ?? []).map((e) => (
            <Link key={e.id} to={`/bookings/${e.booking_id}`} className={`diary-ev ${e.status} ${e.overlaps ? 'clash' : ''}`}
              title={`${e.booking_no} · ${e.booking_name} · ${STATUS_LABEL[e.status]}${e.overlaps ? ' · CLASH' : ''}`}>
              <strong>{time(e.start_at)}</strong> {e.booking_no}
              <div className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.booking_name}{e.expected_pax ? ` · ${e.expected_pax} pax` : ''}
              </div>
            </Link>
          ))}
        </div>
      ))}
    </>
  );
}
