import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Status } from '../api';
import { useAuth } from '../auth';
import { Delta, MonthTable, RankedBars, Sparkline, StackedColumns, TrendChart } from '../components/Charts';
import { StatusBadge } from '../components/ui';
import { date, greeting, longToday, money, monthNames, num, pct, statusLabel } from '../format';
import { useBusinessUnits, useLabel, useUsers } from '../hooks';
import { t } from '../i18n';

type K = Record<string, number | null>;
interface Month { month: number; total: number; definite: number; open: number; lost: number; revenue: number; gross_margin: number;
  net_profit: number; prev_total: number; prev_revenue: number; prev_gross_margin: number; prev_net_profit: number }
interface Group { key: string | null; label: string; code?: string | null; total: number; definite: number; lost: number; open?: number; revenue: number; net_profit: number }
interface DashboardData {
  kpis: K; previous: K; by_month: Month[];
  by_status: { status: Status; total: number; value: number }[];
  by_source: Group[]; by_owner: Group[]; by_event_type: Group[];
  lost_reasons: { code: string; reason: string; total: number }[];
  top_deals: { id: string; booking_no: string; name: string; status: Status; event_date: string | null; pax: number | null; revenue: number; gross_margin: number; margin_pct: number | null }[];
  upcoming: { id: string; booking_no: string; name: string; status: Status; event_date: string; pax: number | null; venue_name: string | null; revenue: number; outstanding: number; days_until: number }[];
  followups: { overdue: number; today: number; unscheduled: number };
}

type Metric = 'revenue' | 'gross_margin' | 'net_profit' | 'bookings';
const METRICS: [Metric, string][] = [['revenue', 'Revenue'], ['gross_margin', 'Gross margin'], ['net_profit', 'Net profit'], ['bookings', 'Bookings']];
const STATUS_COLOR: Record<Status, string> = {
  INQ: 'var(--muted)', TEN: 'var(--status-warning)', DEF: 'var(--status-good)', ACT: 'var(--series-1)',
  LOS: 'var(--status-critical)', CXL: 'var(--status-serious)',
};

export function Dashboard() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [unit, setUnit] = useState('');
  const [owner, setOwner] = useState('');
  const [metric, setMetric] = useState<Metric>('revenue');
  const [asTable, setAsTable] = useState(false);
  const { data: units } = useBusinessUnits();
  const sourceLabel = useLabel('source');
  const lostLabel = useLabel('lost_reason');
  const { data: users } = useUsers();

  const qs = new URLSearchParams({ year: String(year), ...(unit && { business_unit_id: unit }), ...(owner && { owner_id: owner }) }).toString();
  const { data, isFetching, isPlaceholderData } = useQuery({
    queryKey: ['dashboard', qs],
    queryFn: () => api<DashboardData>(`/reports/dashboard?${qs}`),
    placeholderData: keepPreviousData,
  });

  /** Drill-down: open the bookings list with the dashboard's scope plus extra filters. */
  const drill = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ year: String(year), sort: '-revenue', ...(unit && { business_unit_id: unit }), ...(owner && { owner_id: owner }), ...extra });
    navigate(`/bookings?${p}`);
  };

  const k = data?.kpis ?? {};
  const prev = data?.previous ?? {};
  const prevLabel = String(year - 1);
  const months = data?.by_month ?? [];
  const upTo = year === thisYear ? new Date().getMonth() : 11;
  const series = (key: keyof Month) => months.map((m) => Number(m[key]));
  const compact = (v: number) => money(v, { compact: true });

  return (
    <>
      <div className="page-head dash-head">
        <div>
          <h1>{greeting()}, {me?.name.split(' ')[0]}</h1>
          <p>{longToday()} · {me?.tenant.name}{' '}{t("· figures in")}{' '}{me?.tenant.currency}</p>
        </div>
      </div>

      <div className="filters dash-filters" role="group" aria-label={t("Dashboard filters")}>
        <div className="stepper">
          <button onClick={() => setYear((y) => y - 1)} aria-label={t("Previous year")}>‹</button>
          <span>{year}</span>
          <button onClick={() => setYear((y) => y + 1)} aria-label={t("Next year")} disabled={year >= thisYear + 2}>›</button>
        </div>
        {(units?.length ?? 0) > 1 && (
          <select value={unit} onChange={(e) => setUnit(e.target.value)} aria-label={t("Business unit")}>
            <option value="">{t("All business units")}</option>
            {units!.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
          </select>
        )}
        <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label={t("Account manager")}>
          <option value="">{me?.sees_all ? t("Whole company") : t("My whole team")}</option>
          {users?.filter((u) => u.in_my_team).map((u) => <option key={u.id} value={u.id}>{u.name}{u.code ? ` (${u.code})` : ''}</option>)}
        </select>
        {(unit || owner || year !== thisYear) && (
          <button className="ghost" onClick={() => { setYear(thisYear); setUnit(''); setOwner(''); }}>{t("Reset")}</button>
        )}
        {isFetching && <span className="muted small">{t("Updating…")}</span>}
      </div>

      {!data ? <div className="empty">{t("Loading…")}</div> : (
        <div className={`dash ${isFetching && isPlaceholderData ? 'refreshing' : ''}`}>
          {/* ---- hero + attention ---------------------------------------- */}
          <div className="dash-top">
            <div className="card hero">
              <div className="hero-label">{t("Definite revenue ·")}{' '}{year}</div>
              <div className="hero-value">{money(k.revenue)}</div>
              <Delta current={k.revenue} previous={prev.revenue} label={prevLabel} />
              <div className="hero-meta">
                <span><strong>{num(k.definite)}</strong>{' '}{t("definite")}</span>
                <span><strong>{money(k.avg_deal, { compact: true })}</strong>{' '}{t("avg deal")}</span>
                <span><strong>{k.avg_lead_days ?? '—'}</strong>{' '}{t("days avg lead time")}</span>
                <span><strong>{num(k.pax)}</strong>{' '}{t("guests")}</span>
              </div>
              <div className="hero-spark">
                <div className="small muted" style={{ marginBottom: 4 }}>{t("Cumulative definite revenue by event month, including future events already confirmed")}</div>
                <TrendChart current={cumulative(series('revenue'))} previous={cumulative(series('prev_revenue'))} currentLabel={t('{year} booked', { year })}
                  previousLabel={prevLabel} format={compact} height={150} onSelect={(i) => drill({ month: String(i + 1), status: 'DEF,ACT' })} />
              </div>
            </div>
            <div className="attention">
              <Link to="/bookings?followup_due=true&status=INQ,TEN" className={`card attn ${data.followups.overdue ? 'warn' : ''}`}>
                <span className="attn-icon" aria-hidden>{data.followups.overdue ? '⚠' : '✓'}</span>
                <div>
                  <div className="attn-value">{num(data.followups.overdue)}</div>
                  <div className="attn-label">{t("follow-ups overdue")}</div>
                  <div className="small muted">{num(data.followups.today)}{' '}{t("due today ·")}{' '}{num(data.followups.unscheduled)}{' '}{t("open leads with no follow-up")}</div>
                </div>
              </Link>
              <Link to="/finance" className="card attn">
                <span className="attn-icon" aria-hidden>¤</span>
                <div>
                  <div className="attn-value">{money(k.outstanding, { compact: true })}</div>
                  <div className="attn-label">{t("client outstanding")}</div>
                  <div className="small muted">{t("Open receivables and aging →")}</div>
                </div>
              </Link>
              <button type="button" className="card attn" onClick={() => drill({ status: 'INQ,TEN' })}>
                <span className="attn-icon" aria-hidden>◎</span>
                <div>
                  <div className="attn-value">{money(k.pipeline_value, { compact: true })}</div>
                  <div className="attn-label">{t("open pipeline")}</div>
                  <div className="small muted">{num(k.open)}{' '}{t("enquiries & tentative holds →")}</div>
                </div>
              </button>
            </div>
          </div>

          {/* ---- KPI tiles -------------------------------------------------- */}
          <div className="kpis kpi-tiles">
            <Tile label={t("Bookings")} value={num(k.total)} spark={series('total')} upTo={upTo} onClick={() => drill({})}
              delta={<Delta current={k.total} previous={prev.total} label={prevLabel} />} />
            <Tile label={t("Conversion")} value={pct(k.conversion_rate)} sub={t("definite ÷ all bookings")} onClick={() => drill({ status: 'DEF,ACT' })}
              delta={<Delta current={k.conversion_rate} previous={prev.conversion_rate} label={prevLabel} asPoints />} />
            <Tile label={t("Win rate")} value={pct(k.win_rate)} sub={t("definite ÷ decided")} onClick={() => drill({ status: 'LOS' })}
              delta={<Delta current={k.win_rate} previous={prev.win_rate} label={prevLabel} asPoints />} />
            <Tile label={t("Gross margin")} value={money(k.gross_margin, { compact: true })} sub={t('{pct} of revenue', { pct: pct(k.margin_pct) })} spark={series('gross_margin')} upTo={upTo}
              delta={<Delta current={k.gross_margin} previous={prev.gross_margin} label={prevLabel} />} />
            <Tile label={t("Net profit")} value={money(k.net_profit, { compact: true })} sub={t("after fixed & credit costs")} spark={series('net_profit')} upTo={upTo}
              delta={<Delta current={k.net_profit} previous={prev.net_profit} label={prevLabel} />} />
            <Tile label={t("Lost")} value={num(k.lost)} sub={t('{n} cancelled', { n: num(k.cancelled) })} onClick={() => drill({ status: 'LOS' })}
              delta={<Delta current={k.lost} previous={prev.lost} label={prevLabel} upIsGood={false} />} />
          </div>

          {/* ---- monthly performance --------------------------------------- */}
          <div className="card">
            <div className="card-head">
              <div>
                <h2>{t("Monthly performance")}</h2>
                <span className="muted small">{year}{' '}{t("vs")}{' '}{prevLabel}{' '}{t("· click a month to open its bookings")}</span>
              </div>
              <div className="row">
                <div className="segmented" role="tablist" aria-label={t("Metric")}>
                  {METRICS.map(([key, label]) => (
                    <button key={key} role="tab" aria-selected={metric === key} className={metric === key ? 'on' : ''} onClick={() => setMetric(key)}>{t(label)}</button>
                  ))}
                </div>
                <button className="sm ghost" onClick={() => setAsTable((v) => !v)}>{asTable ? t("Chart") : t("Table")}</button>
              </div>
            </div>
            {asTable ? (
              metric === 'bookings'
                ? <MonthTable rows={months as unknown as Record<string, number>[]} columns={[
                    { key: 'definite', label: t('Definite'), format: num }, { key: 'open', label: t('Open'), format: num },
                    { key: 'lost', label: t('Lost / cancelled'), format: num }, { key: 'total', label: t('Total'), format: num },
                    { key: 'prev_total', label: t('Total {year}', { year: prevLabel }), format: num }]} />
                : <MonthTable rows={months as unknown as Record<string, number>[]} columns={[
                    { key: metric, label: `${year}`, format: (v) => money(v) }, { key: `prev_${metric}`, label: prevLabel, format: (v) => money(v) }]} />
            ) : metric === 'bookings' ? (
              <StackedColumns data={months as unknown as Record<string, number>[]} format={num}
                onSelect={(i) => drill({ month: String(i + 1) })}
                series={[
                  { key: 'definite', label: t('Definite'), color: 'var(--series-1)' },
                  { key: 'open', label: t('Open (INQ/TEN)'), color: 'var(--series-2)' },
                  { key: 'lost', label: t('Lost / cancelled'), color: 'var(--muted)' },
                ]} />
            ) : (
              <TrendChart current={series(metric)} previous={series(`prev_${metric}` as keyof Month)} currentLabel={String(year)} previousLabel={prevLabel}
                format={compact} onSelect={(i) => drill({ month: String(i + 1), status: 'DEF,ACT' })} />
            )}
          </div>

          {/* ---- breakdowns ---------------------------------------------------- */}
          <div className="grid-3">
            <div className="card">
              <div className="card-head"><h2>{t("Pipeline by stage")}</h2><span className="muted small">{t("bookings · value")}</span></div>
              <RankedBars onSelect={(s) => drill({ status: s })} format={num}
                rows={data.by_status.filter((s) => s.total > 0).map((s) => ({
                  key: s.status, label: statusLabel(s.status), value: s.total, marker: STATUS_COLOR[s.status],
                  note: s.value ? `· ${money(s.value, { compact: true })}` : undefined,
                }))} />
            </div>
            <div className="card">
              <div className="card-head"><h2>{t("Lead sources")}</h2><span className="muted small">{t("bookings · % won")}</span></div>
              <RankedBars onSelect={(src) => drill(src === '∅' ? {} : { source: src })} format={num}
                rows={data.by_source.map((s) => ({
                  key: s.key ?? '∅', label: s.key ? sourceLabel(s.key) : t('Unknown'), value: s.total, note: `· ${pct(s.total ? s.definite / s.total : null, 0)}`,
                }))} />
            </div>
            <div className="card">
              <div className="card-head"><h2>{t("Why we lose")}</h2><span className="muted small">{t("lost bookings")}</span></div>
              <RankedBars onSelect={(code) => drill({ status: 'LOS', lost_reason: code })} format={num} empty={t("No lost bookings 🎉")}
                rows={data.lost_reasons.map((r) => ({ key: r.code, label: lostLabel(r.code), value: r.total }))} />
            </div>
          </div>

          <div className="grid-2 dash-bottom">
            <div className="card flush">
              <div className="card-head"><h2>{t("Team leaderboard")}</h2><span className="muted small">{t("click a name to see their bookings")}</span></div>
              <div className="table-wrap">
                <table className="leaderboard">
                  <thead><tr><th>{t("Account manager")}</th><th className="num">{t("Leads")}</th><th>{t("Conversion")}</th><th className="num">{t("Revenue")}</th><th className="num">{t("Net profit")}</th></tr></thead>
                  <tbody>
                    {data.by_owner.length === 0 && <tr><td colSpan={6} className="empty">{t("No bookings in this period.")}</td></tr>}
                    {data.by_owner.map((o, i) => {
                      const conv = o.total ? o.definite / o.total : 0;
                      const maxRev = Math.max(1, ...data.by_owner.map((x) => x.revenue));
                      return (
                        <tr key={o.key ?? 'none'} className="clickable" onClick={() => o.key && setOwner(o.key)} title={o.key ? t("Filter the dashboard to this person") : undefined}>
                          <td><span className="muted">{i + 1}.</span> <strong>{o.label}</strong> {o.code && <span className="tag">{o.code}</span>}<div className="small muted">{o.open ?? 0}{' '}{t("open ·")}{' '}{o.lost}{' '}{t("lost")}</div></td>
                          <td className="num">{o.total}</td>
                          <td style={{ minWidth: 120 }}>
                            <div className="meter" aria-hidden><span style={{ width: `${conv * 100}%` }} /></div>
                            <span className="small">{pct(conv, 0)} · {o.definite}{' '}{t("won")}</span>
                          </td>
                          <td className="num">
                            {money(o.revenue, { compact: true })}
                            <div className="mini-bar" aria-hidden><span style={{ width: `${(o.revenue / maxRev) * 100}%` }} /></div>
                          </td>
                          <td className="num">{money(o.net_profit, { compact: true })}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="stack">
              <div className="card">
                <div className="card-head"><h2>{t("Coming up")}</h2><Link to="/diary" className="small">{t("Function diary →")}</Link></div>
                {data.upcoming.length === 0 ? <div className="empty">{t("No events in the next 30 days.")}</div> : (
                  <ol className="timeline">
                    {data.upcoming.map((u) => (
                      <li key={u.id}>
                        <span className={`when ${u.days_until <= 7 ? 'soon' : ''}`}>
                          {u.days_until === 0 ? t("Today") : u.days_until === 1 ? t("Tomorrow") : t('in {n} d', { n: u.days_until })}
                        </span>
                        <div className="grow">
                          <Link to={`/bookings/${u.id}`}><strong>{u.name}</strong></Link>
                          <div className="small muted">{date(u.event_date)} · {u.booking_no}{u.venue_name ? ` · ${u.venue_name}` : ''}{u.pax ? ` · ${u.pax} pax` : ''}</div>
                        </div>
                        <div className="num">
                          <StatusBadge status={u.status} />
                          {u.outstanding > 0 && <div className="small muted">{money(u.outstanding, { compact: true })}{' '}{t("due")}</div>}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <div className="card">
                <div className="card-head"><h2>{t("Top deals")}</h2><span className="muted small">{t("definite, by revenue")}</span></div>
                {data.top_deals.length === 0 ? <div className="empty">{t("No priced definite bookings yet.")}</div> : (
                  <RankedBars format={(v) => money(v, { compact: true })} onSelect={(id) => navigate(`/bookings/${id}`)}
                    rows={data.top_deals.map((d) => ({ key: d.id, label: `${d.booking_no} · ${d.name}`, value: d.revenue,
                      note: d.margin_pct !== null ? `· ${t('{pct} margin', { pct: pct(d.margin_pct, 0) })}` : undefined }))} />
                )}
              </div>
            </div>
          </div>
          <p className="muted small" style={{ marginTop: 16 }}>{t("Bookings are counted in the month of their event date (or enquiry date while no date is set).")}{' '}{monthNames()[upTo]} {year === thisYear ? t("is the current month.") : ''}
          </p>
        </div>
      )}
    </>
  );
}

/** Running total by month. */
function cumulative(values: number[]) {
  let sum = 0;
  return values.map((v) => (sum += v));
}

function Tile({ label, value, sub, delta, spark, upTo, onClick }: {
  label: string; value: string; sub?: string; delta: ReactNode; spark?: number[]; upTo?: number; onClick?: () => void;
}) {
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      <div className="tile-row">
        <div className="kpi-value">{value}</div>
        {spark && <Sparkline values={spark} upTo={upTo} />}
      </div>
      <div className="kpi-sub">{delta}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </>
  );
  return onClick
    ? <button type="button" className="kpi kpi-button" onClick={onClick}>{body}</button>
    : <div className="kpi">{body}</div>;
}
