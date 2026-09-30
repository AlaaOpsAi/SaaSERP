import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Status } from '../api';
import { useAuth } from '../auth';
import { MonthlyColumns, RankedBars } from '../components/Charts';
import { Kpi, StatusBadge } from '../components/ui';
import { date, money, num, pct } from '../format';

interface Group { key: string; label: string; total: number; definite: number; lost: number; revenue: number; net_profit: number }
interface DashboardData {
  kpis: Record<string, number | null>;
  by_month: { month: number; total: number; definite: number; open: number; lost: number; revenue: number; gross_margin: number }[];
  by_source: Group[]; by_owner: Group[]; by_event_type: Group[];
  lost_reasons: { reason: string; total: number }[];
  upcoming: { id: string; booking_no: string; name: string; status: Status; event_date: string; pax: number | null; venue_name: string | null; revenue: number; outstanding: number }[];
  followups: { overdue: number; today: number; unscheduled: number };
}

export function Dashboard() {
  const { me } = useAuth();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', year],
    queryFn: () => api<DashboardData>(`/reports/dashboard?year=${year}`),
  });
  const k = data?.kpis ?? {};
  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() + 1 - i);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sales dashboard</h1>
          <p>Pipeline, conversion and profitability by event date · {me?.tenant.currency}</p>
        </div>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 'auto' }} aria-label="Year">
          {years.map((y) => <option key={y}>{y}</option>)}
        </select>
      </div>

      {isLoading || !data ? <div className="empty">Loading…</div> : (
        <>
          <div className="kpis">
            <Kpi label="Bookings" value={num(k.total)} sub={`${num(k.open)} open · ${num(k.lost)} lost`} />
            <Kpi label="Conversion (DEF ÷ all)" value={pct(k.conversion_rate)} sub={`Win rate of decided: ${pct(k.win_rate)}`} />
            <Kpi label="Definite revenue" value={money(k.revenue, { compact: true })} sub={`${num(k.definite)} definite · ${num(k.pax)} pax`} />
            <Kpi label="Gross margin" value={money(k.gross_margin, { compact: true })} sub={`Margin ${pct(k.margin_pct)}`} />
            <Kpi label="Net profit" value={money(k.net_profit, { compact: true })} sub={`After fixed & credit costs`} />
            <Kpi label="Open pipeline" value={money(k.pipeline_value, { compact: true })} sub="INQ + TEN value" />
            <Kpi label="Client outstanding" value={money(k.outstanding, { compact: true })} sub={<Link to="/finance">Receivables →</Link>} />
            <Kpi label="Follow-ups overdue" value={num(data.followups.overdue)} sub={`${num(data.followups.today)} due today · ${num(data.followups.unscheduled)} unscheduled`} />
          </div>

          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-head"><h2>Bookings by month</h2></div>
              <MonthlyColumns
                data={data.by_month}
                series={[
                  { key: 'definite', label: 'Definite', color: 'var(--series-1)' },
                  { key: 'open', label: 'Open (INQ/TEN)', color: 'var(--series-2)' },
                  { key: 'lost', label: 'Lost / cancelled', color: 'var(--muted)' },
                ]}
              />
            </div>
            <div className="card">
              <div className="card-head"><h2>Definite revenue by month</h2></div>
              <MonthlyColumns
                data={data.by_month}
                series={[{ key: 'revenue', label: 'Revenue', color: 'var(--series-1)' }]}
                format={(v) => money(v)}
                empty="No definite revenue yet. Add revenue lines or manual revenue to definite bookings."
              />
            </div>
          </div>

          <div className="grid-3" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="card-head"><h2>Lead sources</h2><span className="muted small">bookings</span></div>
              <RankedBars rows={data.by_source.slice(0, 8).map((s) => ({ label: s.label, value: s.total, title: `${s.definite} definite` }))} />
            </div>
            <div className="card">
              <div className="card-head"><h2>Why we lose</h2><span className="muted small">lost bookings</span></div>
              <RankedBars rows={data.lost_reasons.map((r) => ({ label: r.reason, value: r.total }))} empty="No lost bookings" />
            </div>
            <div className="card">
              <div className="card-head"><h2>Event types</h2><span className="muted small">bookings</span></div>
              <RankedBars rows={data.by_event_type.map((s) => ({ label: s.label, value: s.total }))} />
            </div>
          </div>

          <div className="grid-2">
            <div className="card flush">
              <div className="card-head"><h2>Account managers</h2></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>AM</th><th className="num">Leads</th><th className="num">Definite</th><th className="num">Conv.</th><th className="num">Revenue</th><th className="num">Net profit</th></tr></thead>
                  <tbody>
                    {data.by_owner.map((o) => (
                      <tr key={o.key}>
                        <td>{o.label} {o.key !== o.label && <span className="tag">{o.key}</span>}</td>
                        <td className="num">{o.total}</td>
                        <td className="num">{o.definite}</td>
                        <td className="num">{pct(o.total ? o.definite / o.total : null, 0)}</td>
                        <td className="num">{money(o.revenue)}</td>
                        <td className="num">{money(o.net_profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card flush">
              <div className="card-head"><h2>Next 30 days</h2><Link to="/diary" className="small">Open diary →</Link></div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Date</th><th>Booking</th><th>Status</th><th className="num">Pax</th><th className="num">Due</th></tr></thead>
                  <tbody>
                    {data.upcoming.length === 0 && <tr><td colSpan={5} className="empty">Nothing scheduled</td></tr>}
                    {data.upcoming.map((u) => (
                      <tr key={u.id}>
                        <td>{date(u.event_date)}</td>
                        <td><Link to={`/bookings/${u.id}`}>{u.booking_no}</Link><div className="small secondary">{u.name}{u.venue_name ? ` · ${u.venue_name}` : ''}</div></td>
                        <td><StatusBadge status={u.status} /></td>
                        <td className="num">{num(u.pax)}</td>
                        <td className="num">{money(u.outstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
