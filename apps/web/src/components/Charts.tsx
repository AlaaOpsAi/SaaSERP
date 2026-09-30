import { useState, type ReactNode } from 'react';
import { MONTHS } from '../format';

interface Series { key: string; label: string; color: string }

/**
 * Stacked monthly columns. Categorical slots come from the validated
 * palette (series-1..3), in fixed order; hover shows every value.
 */
export function MonthlyColumns({ data, series, format = String, empty }: {
  data: Record<string, number>[]; series: Series[]; format?: (v: number) => string; empty?: ReactNode;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((d) => series.reduce((s, x) => s + (d[x.key] ?? 0), 0));
  const max = Math.max(1, ...totals);
  if (totals.every((t) => t === 0)) return <div className="empty">{empty ?? 'No data for this period'}</div>;
  return (
    <div className="chart">
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
        </div>
      )}
      <div className="cols" role="img" aria-label={`Monthly ${series.map((s) => s.label).join(', ')}`}>
        {data.map((d, i) => (
          <div key={i} className="col" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {series.map((s) => {
              const v = d[s.key] ?? 0;
              return v > 0 ? <div key={s.key} className="seg" style={{ height: `${(v / max) * 100}%`, background: s.color }} /> : null;
            })}
          </div>
        ))}
        {hover !== null && (
          <div className="tooltip" style={{ left: `${((hover + 0.5) / 12) * 100}%`, top: 0 }}>
            <strong>{MONTHS[hover]}</strong>
            {series.map((s) => <div key={s.key}>{s.label}: {format(data[hover][s.key] ?? 0)}</div>)}
          </div>
        )}
      </div>
      <div className="col-labels">{MONTHS.map((m) => <span key={m}>{m}</span>)}</div>
    </div>
  );
}

/** Ranked horizontal bars for one measure; value labels are always visible. */
export function RankedBars({ rows, format = String, empty }: {
  rows: { label: ReactNode; value: number; title?: string }[]; format?: (v: number) => string; empty?: ReactNode;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="empty">{empty ?? 'No data yet'}</div>;
  return (
    <div>
      {rows.map((r, i) => (
        <div className="hbar" key={i} title={r.title}>
          <span className="secondary" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
          <div className="track"><div className="fill" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <span className="num">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}
