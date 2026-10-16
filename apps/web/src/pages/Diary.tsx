import { Check } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Activity, type Status } from '../api';
import { useAuth } from '../auth';
import { SkeletonPage } from '../components/ui';
import { dayOf, statusLabel, time, today } from '../format';
import { useUsers, useVenues } from '../hooks';
import { intlLocale, t } from '../i18n';

interface DiaryData {
  spaces: { id: string; name: string; capacity: number | null; venue_id: string; venue_name: string }[];
  events: { id: string; name: string; function_space_id: string; start_at: string; end_at: string; expected_pax: number | null;
            booking_id: string | null; booking_no: string; booking_name: string; status: Status; owner_code: string | null; overlaps: boolean }[];
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
  const [view, setView] = useState<'rooms' | 'meetings'>('rooms');
  const [from, setFrom] = useState(startOfWeek(today()));
  const [span, setSpan] = useState(14);
  const [venueId, setVenueId] = useState('');
  const [showLost, setShowLost] = useState(false);
  const [inUse, setInUse] = useState(false);
  const [owner, setOwner] = useState('');
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
  const todayIso = today();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t("Event calendar")}</h1>
          <p>{view === 'rooms' ? t("Space availability across venues. Red outline = overlapping holds on an exclusive room.")
            : t("Everyone's client meetings and site visits, with their outcomes.")}</p>
        </div>
        <div className="segmented" role="radiogroup" aria-label={t('Show')}>
          {(['rooms', 'meetings'] as const).map((v) => (
            <button key={v} role="radio" aria-checked={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {v === 'rooms' ? t('Rooms & events') : t('Meetings')}
            </button>
          ))}
        </div>
      </div>
      <div className="filters">
        <button onClick={() => setFrom(addDays(from, -span))}>←</button>
        <button onClick={() => setFrom(startOfWeek(today()))}>{t("Today")}</button>
        <button onClick={() => setFrom(addDays(from, span))}>→</button>
        <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label={t("From")} />
        <select value={span} onChange={(e) => setSpan(Number(e.target.value))} aria-label={t("Range")}>
          <option value={7}>{t("1 week")}</option><option value={14}>{t("2 weeks")}</option><option value={28}>{t("4 weeks")}</option>
        </select>
        {view === 'meetings' && <MeetingOwner value={owner} onChange={setOwner} />}
        {view === 'rooms' && <>
        <select value={venueId} onChange={(e) => setVenueId(e.target.value)} aria-label={t("Venue")}>
          <option value="">{t("All venues")}</option>
          {venues?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={inUse} onChange={(e) => setInUse(e.target.checked)} />{t("Only rooms in use")}</label>
        <label className="check"><input type="checkbox" checked={showLost} onChange={(e) => setShowLost(e.target.checked)} />{t("Show lost & cancelled")}</label>
        </>}
      </div>
      {view === 'meetings' ? <Meetings from={from} span={span} owner={owner} /> : <>
      <div className="legend" style={{ marginBottom: 12 }}>
        {(['TEN', 'DEF', 'ACT'] as Status[]).map((s) => (
          <span key={s}><i style={{ background: `var(--${s === 'TEN' ? 'status-warning' : s === 'DEF' ? 'status-good' : 'series-1'})` }} />{statusLabel(s)}</span>
        ))}
      </div>

      {data && data.spaces.length === 0 ? (
        <div className="card empty">{t("No function spaces yet. Add venues and rooms under")}{' '}<Link to="/settings">{t("Admin")}</Link>.</div>
      ) : (
        <div className="diary" style={{ gridTemplateColumns: `180px repeat(${span}, minmax(${span > 14 ? 90 : 120}px, 1fr))` }}>
          <div className="diary-cell diary-head diary-space">{t("Space")}</div>
          {days.map((d) => {
            const dt = new Date(`${d}T00:00:00`);
            return (
              <div key={d} className={`diary-cell diary-head ${d === todayIso ? 'today' : ''}`}>
                {dt.toLocaleDateString(intlLocale(), { weekday: 'short' })}<br />{dt.getDate()} {dt.toLocaleDateString(intlLocale(), { month: 'short' })}
              </div>
            );
          })}
          {data?.spaces.filter((s) => !inUse || days.some((d) => byCell.has(`${s.id}|${d}`))).map((s) => (
            <Row key={s.id} space={s} days={days} byCell={byCell} />
          ))}
        </div>
      )}
      </>}
    </>
  );
}

/** Salesperson filter of the meetings view (own team; everyone for whole-company users). */
function MeetingOwner({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { me } = useAuth();
  const { data: users } = useUsers();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={t('Salesperson')}>
      <option value="">{me?.sees_all ? t('Whole company') : t('My whole team')}</option>
      {users?.filter((u) => u.in_my_team && u.is_active).map((u) => <option key={u.id} value={u.id}>{u.name}{u.code ? ` (${u.code})` : ''}</option>)}
    </select>
  );
}

/** Meeting calendar: client meetings and site visits per day, with who, where and the outcome. */
function Meetings({ from, span, owner }: { from: string; span: number; owner: string }) {
  const end = addDays(from, span);
  const { data, isLoading } = useQuery({
    queryKey: ['meetings', from, span, owner],
    queryFn: () => api<Activity[]>(`/activities?scope=all&state=all&type=meeting,site_visit&limit=1000` +
      `&from=${encodeURIComponent(new Date(`${from}T00:00:00`).toISOString())}&to=${encodeURIComponent(new Date(`${end}T00:00:00`).toISOString())}` +
      (owner ? `&owner_id=${owner}` : '')),
  });
  const days = Array.from({ length: span }, (_, i) => addDays(from, i));
  const byDay = new Map<string, Activity[]>();
  for (const a of data ?? []) byDay.set(dayOf(a.due_at), [...(byDay.get(dayOf(a.due_at)) ?? []), a]);
  const todayIso = today();
  if (isLoading) return <SkeletonPage />;
  return (
    <div className="week-grid">
      {days.map((d) => {
        const dt = new Date(`${d}T00:00:00`);
        const list = (byDay.get(d) ?? []).sort((x, y) => x.due_at.localeCompare(y.due_at));
        return (
          <div key={d} className={`week-day ${d === todayIso ? 'today' : ''}`}>
            <div className="week-day-head">
              <span>{dt.toLocaleDateString(intlLocale(), { weekday: 'short' })}</span>
              <strong>{dt.getDate()}</strong>
              <span className="muted">{dt.toLocaleDateString(intlLocale(), { month: 'short' })}</span>
            </div>
            {list.length === 0 && <div className="week-empty">—</div>}
            {list.map((a) => (
              <div key={a.id} className={`meeting ${a.completed_at ? 'done' : new Date(a.due_at) < new Date() ? 'late' : ''}`}>
                <div className="meeting-top">
                  <strong>{time(a.due_at)}</strong>
                  <span className="tag">{a.owner_code ?? a.owner_name ?? '—'}</span>
                </div>
                <div className="meeting-subject">{a.type === 'site_visit' ? `${t('Site visit')} · ` : ''}{a.subject}</div>
                {(a.contact_name || a.location) && <div className="small secondary">{[a.contact_name, a.location].filter(Boolean).join(' · ')}</div>}
                {a.booking_id && <Link className="small" to={`/bookings/${a.booking_id}`}>{a.booking_no}</Link>}
                {a.completed_at
                  ? <div className="small meeting-outcome"><Check className="ico" aria-hidden /> {a.outcome ?? t('Done')}</div>
                  : new Date(a.due_at) < new Date() && <div className="small" style={{ color: 'var(--danger)' }}>{t('Outcome not recorded')}</div>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
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
          {(byCell.get(`${space.id}|${d}`) ?? []).map((e) => !e.booking_id ? (
            <span key={e.id} className={`diary-ev other ${e.overlaps ? 'clash' : ''}`} title={t("Booked by another team")}>
              <strong>{time(e.start_at)}</strong>{' '}{t("Booked")}<div className="muted">{t("Another team ·")}{' '}{statusLabel(e.status)}</div>
            </span>
          ) : (
            <Link key={e.id} to={`/bookings/${e.booking_id}`} className={`diary-ev ${e.status} ${e.overlaps ? 'clash' : ''}`}
              title={`${e.booking_no} · ${e.booking_name} · ${statusLabel(e.status)}${e.overlaps ? ' · CLASH' : ''}`}>
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
