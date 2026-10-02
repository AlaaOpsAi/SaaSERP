import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Status } from '../api';
import { useAuth } from '../auth';
import { Kpi, StatusBadge, Tabs } from '../components/ui';
import { date, money, pct } from '../format';
import { useSave } from '../hooks';
import { t } from '../i18n';

interface Receivables {
  rows: { id: string; booking_no: string; name: string; status: Status; event_date: string | null; contact_name: string | null;
          contact_phone: string | null; owner_code: string | null; revenue: number; contract_value: number | null; paid: number;
          outstanding: number; aging_days: number; last_paid_on: string | null }[];
  buckets: { current: number; d30: number; d60: number; d90: number; over90: number };
  total: number;
}
interface PayoutRow { id: string; kind: string; payee_name: string; pct: number; amount: number; status: 'pending' | 'paid'; paid_on: string | null;
  booking_id: string; booking_no: string; booking_name: string; event_date: string | null; fully_paid_date: string | null }

export function Finance() {
  const [tab, setTab] = useState<'receivables' | 'payouts'>('receivables');
  return (
    <>
      <div className="page-head"><div><h1>{t("Finance")}</h1><p>{t("What clients owe us, and what we owe in commission and partner shares.")}</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[['receivables', 'Client receivables'], ['payouts', 'Commission & shares']]} />
      {tab === 'receivables' ? <ReceivablesView /> : <PayoutsView />}
    </>
  );
}

function ReceivablesView() {
  const { data } = useQuery({ queryKey: ['receivables'], queryFn: () => api<Receivables>('/reports/receivables') });
  if (!data) return <div className="empty">{t("Loading…")}</div>;
  const b = data.buckets;
  return (
    <>
      <div className="kpis">
        <Kpi label={t("Total outstanding")} value={money(data.total, { compact: true })} sub={t('{n} bookings', { n: data.rows.length })} />
        <Kpi label={t("Not yet due")} value={money(b.current, { compact: true })} sub={t("Event in the future")} />
        <Kpi label={t("1–30 days")} value={money(b.d30, { compact: true })} />
        <Kpi label={t("31–60 days")} value={money(b.d60, { compact: true })} />
        <Kpi label={t("61–90 days")} value={money(b.d90, { compact: true })} />
        <Kpi label={t("Over 90 days")} value={money(b.over90, { compact: true })} sub={b.over90 > 0 ? t("⚠ Chase now") : undefined} />
      </div>
      <div className="card flush">
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t("Booking")}</th><th>{t("Client")}</th><th>{t("Event")}</th><th>{t("AM")}</th><th className="num">{t("Billable")}</th><th className="num">{t("Paid")}</th><th className="num">{t("Outstanding")}</th><th className="num">{t("Aging")}</th></tr></thead>
            <tbody>
              {data.rows.length === 0 && <tr><td colSpan={8} className="empty">{t("Every definite booking is fully paid.")}</td></tr>}
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/bookings/${r.id}`}>{r.booking_no}</Link> <StatusBadge status={r.status} /><div className="small secondary">{r.name}</div></td>
                  <td>{r.contact_name ?? '—'}<div className="small secondary">{r.contact_phone}</div></td>
                  <td>{date(r.event_date)}</td>
                  <td>{r.owner_code ?? '—'}</td>
                  <td className="num">{money(r.contract_value ?? r.revenue)}</td>
                  <td className="num">{money(r.paid)}</td>
                  <td className="num"><strong>{money(r.outstanding)}</strong></td>
                  <td className="num" style={{ color: r.aging_days > 60 ? 'var(--danger)' : undefined }}>{r.aging_days ? `${r.aging_days} d` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function PayoutsView() {
  const { can } = useAuth();
  const { data } = useQuery({ queryKey: ['payouts'], queryFn: () => api<PayoutRow[]>('/reports/payouts') });
  const pay = useSave((id: string) => api(`/booking-payouts/${id}`, { method: 'PATCH', body: { status: 'paid' } }), [['payouts']]);
  if (!data) return <div className="empty">{t("Loading…")}</div>;
  const pending = data.filter((p) => p.status === 'pending');
  return (
    <>
      <div className="kpis">
        <Kpi label={t("To pay")} value={money(pending.reduce((s, p) => s + p.amount, 0), { compact: true })} sub={t('{n} payouts', { n: pending.length })} />
        <Kpi label={t("Ready (client fully paid)")} value={money(pending.filter((p) => p.fully_paid_date).reduce((s, p) => s + p.amount, 0), { compact: true })} />
        <Kpi label={t("Paid")} value={money(data.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0), { compact: true })} />
      </div>
      <div className="card flush">
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t("Booking")}</th><th>{t("Type")}</th><th>{t("Payee")}</th><th className="num">%</th><th className="num">{t("Amount")}</th><th>{t("Client paid")}</th><th>{t("Status")}</th><th /></tr></thead>
            <tbody>
              {data.length === 0 && <tr><td colSpan={8} className="empty">{t("No commission or shares on definite bookings.")}</td></tr>}
              {data.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/bookings/${p.booking_id}`}>{p.booking_no}</Link><div className="small secondary">{p.booking_name} · {date(p.event_date)}</div></td>
                  <td>{p.kind === 'commission' ? t("Commission") : t("Share")}</td>
                  <td>{p.payee_name}</td>
                  <td className="num">{pct(p.pct, 0)}</td>
                  <td className="num">{money(p.amount)}</td>
                  <td>{p.fully_paid_date ? `✓ ${date(p.fully_paid_date)}` : <span className="muted">{t("Not yet")}</span>}</td>
                  <td>{p.status === 'paid' ? `✓ ${t('Paid')} ${date(p.paid_on)}` : t("To pay")}</td>
                  <td className="num">{p.status === 'pending' && can('finance') && <button className="sm" onClick={() => pay.mutate(p.id)}>{t("Mark paid")}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
