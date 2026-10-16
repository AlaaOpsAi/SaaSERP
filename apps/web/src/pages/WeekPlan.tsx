import { Check } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Activity } from '../api';
import { useAuth } from '../auth';
import { ActivityDialog } from '../components/ActivityForm';
import { activityType } from '../components/CompleteActivity';
import { ErrorNote } from '../components/ui';
import { dayOf, time, today } from '../format';
import { useUsers } from '../hooks';
import { intlLocale, t } from '../i18n';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s: string, n: number) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + n); return iso(d); };
/** Weeks run Sunday to Saturday (the working week in Kuwait starts on Sunday). */
const weekStart = (s: string) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() - d.getDay()); return iso(d); };

/**
 * Future activities: next week's plan for one person, day by day. Every client action
 * is linked to a contract or a customer; anything not done can be moved to the next week.
 */
export function WeekPlan() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const { data: users } = useUsers();
  const [start, setStart] = useState(() => addDays(weekStart(today()), 7));
  const [owner, setOwner] = useState(me?.id ?? '');
  const [adding, setAdding] = useState<string | null>(null);
  const [editing, setEditing] = useState<Activity | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [moved, setMoved] = useState<number | null>(null);
  const end = addDays(start, 7);
  const { data } = useQuery({
    queryKey: ['activities', 'plan', start, owner],
    queryFn: () => api<Activity[]>(`/activities?scope=all&state=all&limit=1000&owner_id=${owner}` +
      `&from=${encodeURIComponent(new Date(`${start}T00:00:00`).toISOString())}&to=${encodeURIComponent(new Date(`${end}T00:00:00`).toISOString())}`),
    enabled: Boolean(owner),
  });
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const byDay = new Map<string, Activity[]>();
  for (const a of data ?? []) byDay.set(dayOf(a.due_at), [...(byDay.get(dayOf(a.due_at)) ?? []), a]);
  const open = (data ?? []).filter((a) => !a.completed_at).length;
  const label = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00`).toLocaleDateString(intlLocale(), opts);
  const thisWeek = weekStart(today());

  async function carryOver() {
    setError(null);
    try {
      const r = await api<{ moved: number }>('/activities/carry-over', { body: { from: start, to: addDays(start, 6), owner_id: owner } });
      setMoved(r.moved);
      await qc.invalidateQueries({ queryKey: ['activities'] });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="stack">
      <div className="filters no-print" style={{ marginBottom: 0 }}>
        <div className="stepper">
          <button onClick={() => { setStart(addDays(start, -7)); setMoved(null); }} aria-label={t('Previous week')}>‹</button>
          <span>{label(start, { day: 'numeric', month: 'short' })} – {label(addDays(start, 6), { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          <button onClick={() => { setStart(addDays(start, 7)); setMoved(null); }} aria-label={t('Next week')}>›</button>
        </div>
        <button className={start === thisWeek ? 'on' : ''} onClick={() => setStart(thisWeek)}>{t('This week')}</button>
        <button className={start === addDays(thisWeek, 7) ? 'on' : ''} onClick={() => setStart(addDays(thisWeek, 7))}>{t('Next week')}</button>
        {can('manage') && (
          <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label={t('Salesperson')}>
            {users?.filter((u) => u.is_active && u.in_my_team).map((u) => <option key={u.id} value={u.id}>{u.name}{u.code ? ` (${u.code})` : ''}</option>)}
          </select>
        )}
        {open > 0 && can('activity') && (
          <button onClick={carryOver} title={t('Moves every unfinished activity of this week to the same day next week')}>
            {t('Move {n} unfinished to the next week', { n: open })}
          </button>
        )}
        <button onClick={() => window.print()}>{t('Print')}</button>
      </div>
      <ErrorNote error={error} />
      {moved !== null && <div className="alert info no-print">{t('{n} activities moved to the next week.', { n: moved })}</div>}
      <h2 className="print-only">{t('Weekly plan')} · {users?.find((u) => u.id === owner)?.name} · {label(start, { day: 'numeric', month: 'long' })} – {label(addDays(start, 6), { day: 'numeric', month: 'long', year: 'numeric' })}</h2>

      <div className="week-grid plan-grid">
        {days.map((d) => (
          <div key={d} className={`week-day ${d === today() ? 'today' : ''}`}>
            <div className="week-day-head">
              <span>{label(d, { weekday: 'short' })}</span>
              <strong>{new Date(`${d}T12:00:00`).getDate()}</strong>
              <span className="muted">{label(d, { month: 'short' })}</span>
            </div>
            {(byDay.get(d) ?? []).sort((x, y) => x.due_at.localeCompare(y.due_at)).map((a) => (
              <button key={a.id} className={`meeting plan-item ${a.completed_at ? 'done' : new Date(a.due_at) < new Date() ? 'late' : ''}`}
                onClick={() => setEditing(a)}>
                <div className="meeting-top"><strong>{time(a.due_at)}</strong><span className="tag">{activityType(a.type)}</span></div>
                <div className="meeting-subject">{a.subject}</div>
                {(a.booking_no || a.customer_no) && <div className="small secondary">{a.booking_no ?? a.customer_no} · {a.booking_name ?? a.account_name ?? a.contact_name}</div>}
                {a.completed_at && <div className="small meeting-outcome"><Check className="ico" aria-hidden /> {a.outcome ?? t('Done')}</div>}
              </button>
            ))}
            {can('activity') && <button className="sm ghost no-print add-day" onClick={() => setAdding(d)}>+ {t('Add')}</button>}
          </div>
        ))}
      </div>
      {adding && <ActivityDialog mode="plan" day={adding} onClose={() => setAdding(null)} />}
      {editing && <ActivityDialog mode="edit" activity={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
