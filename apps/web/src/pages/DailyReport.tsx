import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download } from '../api';
import { useAuth } from '../auth';
import { activityType } from '../components/CompleteActivity';
import { ErrorNote } from '../components/ui';
import { dateTime, time, today } from '../format';
import { useUsers } from '../hooks';
import { intlLocale, t } from '../i18n';

interface DailyItem {
  id: string; type: string; subject: string; at: string; completed_at: string | null; location: string | null; outcome: string | null;
  notes: string | null; booking_id: string | null; booking_no: string | null; booking_name: string | null; contact_name: string | null;
  state: 'done' | 'planned' | 'overdue';
}
interface DailyPerson {
  user_id: string; name: string; code: string | null; calls: number; meetings: number; followups: number; marketing: number; done: number;
  planned: number; overdue: number; new_contracts: number; won: number; lost: number; items: DailyItem[];
}

const lastDay = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };

/** True while the browser prints, so every person's details are included on paper. */
function usePrinting() {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const on = () => setPrinting(true);
    const off = () => setPrinting(false);
    window.addEventListener('beforeprint', on);
    window.addEventListener('afterprint', off);
    return () => { window.removeEventListener('beforeprint', on); window.removeEventListener('afterprint', off); };
  }, []);
  return printing;
}

const shift = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Daily activity report: for one day, what each salesperson did, with every meeting's
 * outcome. Managers see their whole team; a salesperson sees their own day.
 */
export function DailyReport() {
  const { me, can } = useAuth();
  const { data: users } = useUsers();
  const [period, setPeriod] = useState<'day' | 'month'>('day');
  const [day, setDay] = useState(today());
  const [month, setMonth] = useState(today().slice(0, 7));
  const [person, setPerson] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const range = period === 'day' ? { from: day, to: day } : { from: `${month}-01`, to: lastDay(month) };
  const qs = `from=${range.from}&to=${range.to}${person ? `&owner_id=${person}` : ''}`;
  const { data, isLoading } = useQuery({
    queryKey: ['daily-activity', qs],
    queryFn: () => api<{ date: string; people: DailyPerson[] }>(`/reports/daily-activity?${qs}`),
  });
  const people = data?.people ?? [];
  const printing = usePrinting();
  const total = (k: keyof DailyPerson) => people.reduce((s, p) => s + Number(p[k] ?? 0), 0);
  const label = period === 'day'
    ? new Date(`${day}T12:00:00`).toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : new Date(`${month}-15T12:00:00`).toLocaleDateString(intlLocale(), { month: 'long', year: 'numeric' });
  const single = people.length === 1;

  return (
    <div className="stack">
      <div className="filters no-print" style={{ marginBottom: 0 }}>
        <div className="segmented" role="radiogroup" aria-label={t('Period')}>
          {(['day', 'month'] as const).map((p) => (
            <button key={p} role="radio" aria-checked={period === p} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>
              {p === 'day' ? t('Daily') : t('Monthly')}
            </button>
          ))}
        </div>
        {period === 'day' ? (
          <>
            <div className="stepper">
              <button onClick={() => setDay((d) => shift(d, -1))} aria-label={t('Previous day')}>‹</button>
              <span>{label}</span>
              <button onClick={() => setDay((d) => shift(d, 1))} aria-label={t('Next day')} disabled={day >= today()}>›</button>
            </div>
            <input type="date" value={day} max={today()} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label={t('Date')} />
          </>
        ) : (
          <input type="month" value={month} max={today().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label={t('Month')} />
        )}
        {(can('manage') || people.length > 1) && (
          <select value={person} onChange={(e) => setPerson(e.target.value)} aria-label={t('Salesperson')}>
            <option value="">{me?.sees_all ? t('Whole company') : t('My whole team')}</option>
            {users?.filter((u) => u.in_my_team && u.is_active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        <button onClick={() => window.print()}>{t('Print')}</button>
        <button onClick={() => { setError(null); download(`/reports/daily-activity?${qs}&format=xlsx`, `activity-${range.from}${period === 'month' ? `_${range.to}` : ''}.xlsx`).catch(setError); }}>
          {t('Download Excel')}
        </button>
      </div>
      <div className="print-only print-head">
        <h2>{period === 'day' ? t('Daily activity report') : t('Monthly activity report')}</h2>
        <div>{me?.tenant.name} · {label}{person ? ` · ${people[0]?.name ?? ''}` : ''}</div>
      </div>
      <ErrorNote error={error} />

      <div className="card flush">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('Salesperson')}</th><th className="num">{t('Calls')}</th><th className="num">{t('Meetings')}</th>
                <th className="num">{t('Follow-ups')}</th><th className="num">{t('Marketing')}</th><th className="num">{t('Done')}</th><th className="num">{t('Still planned')}</th>
                <th className="num">{t('Overdue')}</th><th className="num">{t('New contracts')}</th><th className="num">{t('Won')}</th>
                <th className="num">{t('Lost / cancelled')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={11} className="empty">{t('Loading…')}</td></tr>}
              {!isLoading && people.length === 0 && <tr><td colSpan={11} className="empty">{t('No salespeople in your view.')}</td></tr>}
              {people.map((p) => (
                <tr key={p.user_id} className="clickable" onClick={() => setOpen(open === p.user_id ? null : p.user_id)} aria-expanded={open === p.user_id || single}>
                  <td><strong>{p.name}</strong> {p.code && <span className="tag">{p.code}</span>}</td>
                  <td className="num">{p.calls || '—'}</td><td className="num">{p.meetings || '—'}</td><td className="num">{p.followups || '—'}</td><td className="num">{p.marketing || '—'}</td>
                  <td className="num"><strong>{p.done || '—'}</strong></td><td className="num">{p.planned || '—'}</td>
                  <td className="num" style={{ color: p.overdue ? 'var(--danger)' : undefined }}>{p.overdue || '—'}</td>
                  <td className="num">{p.new_contracts || '—'}</td><td className="num">{p.won || '—'}</td><td className="num">{p.lost || '—'}</td>
                </tr>
              ))}
            </tbody>
            {people.length > 1 && (
              <tfoot>
                <tr>
                  <td>{t('Team total')}</td>
                  {(['calls', 'meetings', 'followups', 'marketing', 'done', 'planned', 'overdue', 'new_contracts', 'won', 'lost'] as const).map((k) => <td key={k} className="num">{total(k)}</td>)}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {people.filter((p) => printing ? p.items.length > 0 : single || open === p.user_id || (open === null && p.items.length > 0 && people.length <= 3)).map((p) => (
        <div key={p.user_id} className="card stack">
          <h3 style={{ margin: 0 }}>{p.user_id === me?.id && period === 'day' ? t('My day') : p.name}</h3>
          {p.items.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t('Nothing recorded for this day.')}</p> : (
            <ol className="timeline">
              {p.items.map((a) => (
                <li key={a.id} className={`tl-${a.state}`}>
                  <div className="tl-time">{a.state === 'overdue' ? t('Overdue') : period === 'day' ? time(a.completed_at ?? a.at) : dateTime(a.completed_at ?? a.at)}</div>
                  <div className="tl-body">
                    <div><span className="tag">{activityType(a.type)}</span> <strong>{a.subject}</strong>
                      {a.booking_id && <> · <Link to={`/bookings/${a.booking_id}`}>{a.booking_no}</Link> {a.booking_name}</>}</div>
                    {(a.contact_name || a.location) && <div className="small secondary">{[a.contact_name, a.location].filter(Boolean).join(' · ')}</div>}
                    {a.outcome && <div className="tl-outcome">{a.outcome}</div>}
                    {a.state === 'planned' && <div className="small muted">{t('Not done yet')}</div>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
      {!single && open === null && people.length > 3 && <p className="small muted" style={{ margin: 0 }}>{t('Click a salesperson to see their meetings, outcomes and follow-ups.')}</p>}
    </div>
  );
}
