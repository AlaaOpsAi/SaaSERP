import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Activity } from '../api';
import { useAuth } from '../auth';
import { StatusBadge } from '../components/ui';
import { dateTime } from '../format';
import { useSave } from '../hooks';
import { ActivityForm } from './BookingDetail';
import { t } from '../i18n';

export function Activities() {
  const { can } = useAuth();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [state, setState] = useState('open');
  const [adding, setAdding] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['activities', scope, state],
    queryFn: () => api<Activity[]>(`/activities?scope=${scope}&state=${state}`),
  });
  const complete = useSave((v: { id: string; outcome: string | null }) =>
    api(`/activities/${v.id}/complete`, { body: { outcome: v.outcome } }), [['activities'], ['dashboard']]);
  const now = Date.now();

  return (
    <>
      <div className="page-head">
        <div><h1>{t("Activities")}</h1><p>{t("Meetings, calls and follow-ups. Completing one updates the booking's last follow-up.")}</p></div>
        {can('sell') && <button className="primary" onClick={() => setAdding((a) => !a)}>{adding ? t("Close") : t("New activity")}</button>}
      </div>
      {adding && <div className="card" style={{ marginBottom: 16 }}><ActivityForm onDone={() => setAdding(false)} /></div>}
      <div className="filters">
        <select value={scope} onChange={(e) => setScope(e.target.value as 'mine' | 'all')} aria-label={t("Scope")}>
          <option value="mine">{t("My activities")}</option><option value="all">{t("Whole team")}</option>
        </select>
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label={t("State")}>
          <option value="open">{t("Open")}</option><option value="overdue">{t("Overdue")}</option><option value="today">{t("Due today")}</option>
          <option value="done">{t("Completed")}</option><option value="all">{t("All")}</option>
        </select>
      </div>
      <div className="card flush">
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t("Due")}</th><th>{t("Activity")}</th><th>{t("Booking")}</th><th>{t("Client")}</th><th>{t("Owner")}</th><th /></tr></thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="empty">{t("Loading…")}</td></tr>}
              {data?.length === 0 && <tr><td colSpan={6} className="empty">{t("Nothing here. 🎉")}</td></tr>}
              {data?.map((a) => {
                const overdue = !a.completed_at && new Date(a.due_at).getTime() < now;
                return (
                  <tr key={a.id}>
                    <td style={{ color: overdue ? 'var(--danger)' : undefined }}>{overdue && '⚠ '}{dateTime(a.due_at)}</td>
                    <td><span className="tag">{a.type.replace('_', ' ')}</span> {a.subject}
                      {a.not_mine && scope === 'mine' && <span className="tag cover-tag">{t("covering ·")}{' '}{a.owner_name}</span>}
                      {(a.location || a.notes) && <div className="small secondary">{[a.location, a.notes].filter(Boolean).join(' · ')}</div>}
                      {a.outcome && <div className="small secondary">✓ {a.outcome}</div>}
                      {a.completed_by_name && a.completed_on_behalf_of_name && <div className="small muted">{t("done by")}{' '}{a.completed_by_name}{' '}{t("for")}{' '}{a.completed_on_behalf_of_name}</div>}</td>
                    <td>{a.booking_id ? <><Link to={`/bookings/${a.booking_id}`}>{a.booking_no}</Link> {a.booking_status && <StatusBadge status={a.booking_status} />}<div className="small secondary">{a.booking_name}</div></> : '—'}</td>
                    <td>{a.contact_name ?? '—'}<div className="small secondary">{a.contact_phone}</div></td>
                    <td>{a.owner_name ?? '—'}</td>
                    <td className="num">{!a.completed_at && can('sell') && (
                      <button className="sm" onClick={() => complete.mutate({ id: a.id, outcome: prompt(t('Outcome / client feedback (optional)')) })}>{t("Complete")}</button>
                    )}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
