import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Activity } from '../api';
import { useAuth } from '../auth';
import { ActivityDialog } from '../components/ActivityForm';
import { activityType, CompleteButton } from '../components/CompleteActivity';
import { StatusBadge, Tabs } from '../components/ui';
import { dateTime } from '../format';
import { t } from '../i18n';
import { DailyReport } from './DailyReport';
import { WeekPlan } from './WeekPlan';

type View = 'list' | 'plan' | 'report';

/**
 * Activities (customer's module plan): today's and open follow-ups, next week's plan,
 * logging what was done, and the daily / monthly report per person.
 */
export function Activities() {
  const { can } = useAuth();
  const [view, setView] = useState<View>('list');
  const [dialog, setDialog] = useState<{ mode: 'plan' | 'log' | 'edit'; activity?: Activity } | null>(null);
  const writer = can('activity');

  return (
    <>
      <div className="page-head">
        <div><h1>{t("Activities")}</h1><p>{t("Daily activity, follow-ups and meeting outcomes for each salesperson.")}</p></div>
        {writer && (
          <div className="row">
            <button onClick={() => setDialog({ mode: 'plan' })}>{t("Plan activity")}</button>
            <button className="primary" onClick={() => setDialog({ mode: 'log' })}>{t("Log activity")}</button>
          </div>
        )}
      </div>
      <Tabs value={view} onChange={setView} tabs={[['list', 'Follow-ups'], ['plan', 'Plan'], ['report', 'Report']]} />
      {view === 'list' && <FollowUps onEdit={(a) => setDialog({ mode: 'edit', activity: a })} />}
      {view === 'plan' && <WeekPlan />}
      {view === 'report' && <DailyReport />}
      {dialog && <ActivityDialog mode={dialog.mode} activity={dialog.activity} onClose={() => setDialog(null)} />}
    </>
  );
}

function FollowUps({ onEdit }: { onEdit: (a: Activity) => void }) {
  const { can } = useAuth();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [state, setState] = useState('open');
  const { data, isLoading } = useQuery({
    queryKey: ['activities', scope, state],
    queryFn: () => api<Activity[]>(`/activities?scope=${scope}&state=${state}`),
  });
  const now = Date.now();
  const writer = can('activity');
  const unlinked = (data ?? []).filter((a) => !a.booking_id && !a.contact_id && !a.account_id && !a.completed_at && !a.type.match(/campaign|social_post|exhibition|advertisement|content/));
  return (
    <>
      <div className="filters">
        <select value={scope} onChange={(e) => setScope(e.target.value as 'mine' | 'all')} aria-label={t("Scope")}>
          <option value="mine">{t("My activities")}</option><option value="all">{t("Whole team")}</option>
        </select>
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label={t("State")}>
          <option value="open">{t("Open")}</option><option value="overdue">{t("Overdue")}</option><option value="today">{t("Due today")}</option>
          <option value="done">{t("Completed")}</option><option value="all">{t("All")}</option>
        </select>
      </div>
      {unlinked.length > 0 && (
        <div className="alert info" style={{ marginBottom: 12 }}>
          {t('{n} older activities are not linked to a contract or customer yet. Open one to link it.', { n: unlinked.length })}
        </div>
      )}
      <div className="card flush">
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t("Due")}</th><th>{t("Activity")}</th><th>{t("Contract / customer")}</th><th>{t("Client")}</th><th>{t("Owner")}</th><th /></tr></thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="empty">{t("Loading…")}</td></tr>}
              {data?.length === 0 && <tr><td colSpan={6} className="empty">{t("Nothing here. 🎉")}</td></tr>}
              {data?.map((a) => {
                const overdue = !a.completed_at && new Date(a.due_at).getTime() < now;
                const linked = a.booking_id || a.contact_id || a.account_id;
                return (
                  <tr key={a.id} className={writer ? 'clickable' : ''} onClick={() => writer && onEdit(a)}>
                    <td style={{ color: overdue ? 'var(--danger)' : undefined }}>{overdue && '⚠ '}{dateTime(a.due_at)}</td>
                    <td><span className="tag">{activityType(a.type)}</span> {a.subject}
                      {a.not_mine && scope === 'mine' && <span className="tag cover-tag">{t("covering ·")}{' '}{a.owner_name}</span>}
                      {(a.location || a.notes) && <div className="small secondary">{[a.location, a.notes].filter(Boolean).join(' · ')}</div>}
                      {a.outcome && <div className="small secondary">✓ {a.outcome}</div>}
                      {a.completed_by_name && a.completed_on_behalf_of_name && <div className="small muted">{t("done by")}{' '}{a.completed_by_name}{' '}{t("for")}{' '}{a.completed_on_behalf_of_name}</div>}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {a.booking_id ? <><Link to={`/bookings/${a.booking_id}`}>{a.booking_no}</Link> {a.booking_status && <StatusBadge status={a.booking_status} />}<div className="small secondary">{a.booking_name}</div></>
                        : a.customer_no ? <><span className="tag">{a.customer_no}</span><div className="small secondary">{a.account_name ?? a.contact_name}</div></>
                        : !linked && !a.completed_at ? <span className="small" style={{ color: 'var(--danger)' }}>{t('Not linked')}</span> : '—'}
                    </td>
                    <td>{a.contact_name ?? '—'}<div className="small secondary">{a.contact_phone}</div></td>
                    <td>{a.owner_name ?? '—'}</td>
                    <td className="num" onClick={(e) => e.stopPropagation()}>{!a.completed_at && writer && <CompleteButton activity={a} invalidate={[]} />}</td>
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
