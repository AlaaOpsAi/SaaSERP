import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MONTHS } from '../format';

/* Chart building blocks. Colours come from CSS tokens (validated palette):
 * series-1 = the current period, --muted = the comparison / de-emphasised series.
 * Every chart is hoverable, keyboard-focusable and clickable for drill-down. */

export interface Series { key: string; label: string; color: string }

/** Clean axis ticks: 0, step, 2·step … with step in {1, 2, 5}·10^n. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// ---- figures ----------------------------------------------------------------

/** 12-point trend in the de-emphasis hue, current point in the accent. */
export function Sparkline({ values, upTo }: { values: number[]; upTo?: number }) {
  const w = 120;
  const h = 32;
  const last = upTo ?? values.length - 1;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 8) + 4, h - 4 - (v / max) * (h - 8)] as const);
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={pts.slice(0, last + 1).map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--muted)" strokeWidth={2} vectorEffect="non-scaling-stroke"
        strokeLinejoin="round" strokeLinecap="round" />
      {pts[last] && <circle cx={pts[last][0]} cy={pts[last][1]} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/** Signed change vs a named period; colour = direction × whether up is good, plus an arrow so colour never stands alone. */
export function Delta({ current, previous, label, upIsGood = true, asPoints = false }: {
  current: number | null | undefined; previous: number | null | undefined; label: string; upIsGood?: boolean; asPoints?: boolean;
}) {
  if (current === null || current === undefined || previous === null || previous === undefined) return <span className="delta">—</span>;
  let text: string;
  let diff: number;
  if (asPoints) {
    diff = current - previous;
    text = `${diff >= 0 ? '+' : '−'}${Math.abs(diff * 100).toFixed(1)} pts`;
  } else {
    if (previous === 0) return <span className="delta">{current === 0 ? `no change vs ${label}` : `new vs ${label}`}</span>;
    diff = (current - previous) / Math.abs(previous);
    text = `${diff >= 0 ? '+' : '−'}${Math.abs(diff * 100).toFixed(diff !== 0 && Math.abs(diff) < 0.1 ? 1 : 0)}%`;
  }
  const flat = Math.abs(diff) < 0.0005;
  const good = flat ? null : (diff > 0) === upIsGood;
  return (
    <span className={`delta ${good === null ? '' : good ? 'up' : 'down'}`}>
      <span aria-hidden>{flat ? '→' : diff > 0 ? '▲' : '▼'}</span> {text} <span className="muted">vs {label}</span>
    </span>
  );
}

// ---- trend (line) chart -------------------------------------------------------

/**
 * Current vs previous period by month. A crosshair snaps to the nearest month and
 * one tooltip lists both series. Arrow keys move it; Enter / click drills down.
 */
export function TrendChart({ current, previous, currentLabel, previousLabel, format, onSelect, height = 240, until = 11 }: {
  current: number[]; previous?: number[]; currentLabel: string; previousLabel?: string;
  format: (v: number) => string; onSelect?: (monthIndex: number) => void; height?: number;
  /** Last month of `current` to draw (later months are in the future). */
  until?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 52, r: 16, t: 12, b: 26 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const ticks = niceTicks(Math.max(...current, ...(previous ?? [0]), 0));
  const top = ticks[ticks.length - 1] || 1;
  const x = (i: number) => pad.l + (i / 11) * iw;
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const drawn = current.slice(0, until + 1);
  const area = `${path(drawn)} L${x(drawn.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;

  const pick = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    const i = Math.round(((clientX - r.left - pad.l) / iw) * 11);
    setHover(Math.min(11, Math.max(0, i)));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') setHover((h) => Math.min(11, (h ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? 12) - 1));
    else if ((e.key === 'Enter' || e.key === ' ') && hover !== null && onSelect) onSelect(hover);
    else return;
    e.preventDefault();
  };

  return (
    <div className="chart" ref={ref}>
      <div className="legend">
        <span><i className="line-key" style={{ background: 'var(--series-1)' }} />{currentLabel}</span>
        {previous && previousLabel && <span><i className="line-key" style={{ background: 'var(--muted)' }} />{previousLabel}</span>}
      </div>
      <svg width={width} height={height} role="img" aria-label={`${currentLabel} by month`} tabIndex={0} onKeyDown={onKey}
        onFocus={() => setHover((h) => h ?? new Date().getMonth())} onBlur={() => setHover(null)}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)} onPointerLeave={() => setHover(null)}
        onClick={() => hover !== null && onSelect?.(hover)} style={{ cursor: onSelect ? 'pointer' : 'default', display: 'block' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="axis-text">{format(t)}</text>
          </g>
        ))}
        {MONTHS.map((m, i) => <text key={m} x={x(i)} y={height - 6} textAnchor="middle" className="axis-text">{m}</text>)}
        <path d={area} fill="var(--series-1)" opacity={0.1} className="draw-in" />
        {previous && <path d={path(previous)} fill="none" stroke="var(--muted)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        <path d={path(drawn)} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="draw-line" />
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--text-2)" strokeWidth={1} />
            {previous && <circle cx={x(hover)} cy={y(previous[hover])} r={4} fill="var(--muted)" stroke="var(--surface)" strokeWidth={2} />}
            {hover <= until && <circle cx={x(hover)} cy={y(current[hover])} r={5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: Math.min(Math.max(x(hover), 90), width - 90), top: Math.max(y(current[hover]), 40) }}>
          <div className="tt-title">{MONTHS[hover]}</div>
          <div className="tt-row"><i className="line-key" style={{ background: 'var(--series-1)' }} /><strong>{hover <= until ? format(current[hover]) : '—'}</strong> {currentLabel}</div>
          {previous && <div className="tt-row"><i className="line-key" style={{ background: 'var(--muted)' }} /><strong>{format(previous[hover])}</strong> {previousLabel}</div>}
          {onSelect && <div className="tt-hint">Click to see bookings</div>}
        </div>
      )}
    </div>
  );
}

// ---- stacked columns ----------------------------------------------------------

/** Stacked monthly columns (≤24px wide, 2px gaps). Each column is a button that drills down. */
export function StackedColumns({ data, series, onSelect, format = String }: {
  data: Record<string, number>[]; series: Series[]; onSelect?: (monthIndex: number) => void; format?: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((d) => series.reduce((s, x) => s + (d[x.key] ?? 0), 0));
  const ticks = niceTicks(Math.max(0, ...totals), 3);
  const top = ticks[ticks.length - 1] || 1;
  return (
    <div className="chart">
      <div className="legend">{series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div>
      <div className="col-plot">
        <div className="col-axis" aria-hidden>{[...ticks].reverse().map((t) => <span key={t}>{format(t)}</span>)}</div>
        <div className="cols" role="group" aria-label="Bookings by month">
          {ticks.map((t) => <div key={t} className="gridline" style={{ bottom: `${(t / top) * 100}%` }} />)}
          {data.map((d, i) => (
            <button key={i} className="col" type="button" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)} onBlur={() => setHover(null)} onClick={() => onSelect?.(i)}
              aria-label={`${MONTHS[i]}: ${series.map((s) => `${s.label} ${format(d[s.key] ?? 0)}`).join(', ')}`}>
              <span className="col-stack" style={{ height: `${(totals[i] / top) * 100}%` }}>
                {series.map((s) => (d[s.key] ?? 0) > 0 && (
                  <span key={s.key} className="seg" style={{ flexGrow: d[s.key], background: s.color }} />
                ))}
              </span>
            </button>
          ))}
          {hover !== null && (
            <div className="tooltip inside" style={{ left: `${Math.min(88, Math.max(12, ((hover + 0.5) / 12) * 100))}%` }}>
              <div className="tt-title">{MONTHS[hover]} · {format(totals[hover])} total</div>
              {series.map((s) => (
                <div key={s.key} className="tt-row"><i className="line-key" style={{ background: s.color }} /><strong>{format(data[hover][s.key] ?? 0)}</strong> {s.label}</div>
              ))}
              {onSelect && <div className="tt-hint">Click to see bookings</div>}
            </div>
          )}
        </div>
      </div>
      <div className="col-labels">{MONTHS.map((m) => <span key={m}>{m}</span>)}</div>
    </div>
  );
}

// ---- ranked bars --------------------------------------------------------------

export interface RankedRow { key: string; label: ReactNode; value: number; note?: ReactNode; marker?: string }

/** Horizontal bars, largest first, value at the tip. Rows are buttons when `onSelect` is given. */
export function RankedBars({ rows, format = String, empty, onSelect, limit = 8 }: {
  rows: RankedRow[]; format?: (v: number) => string; empty?: ReactNode; onSelect?: (key: string) => void; limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, limit);
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="empty">{empty ?? 'No data yet'}</div>;
  return (
    <div className="ranked">
      {shown.map((r) => {
        const content = (
          <>
            <span className="ranked-label">{r.marker && <i className="dot-key" style={{ background: r.marker }} />}{r.label}</span>
            <span className="track"><span className="fill" style={{ width: `${(r.value / max) * 100}%` }} /></span>
            <span className="num ranked-value">{format(r.value)}{r.note && <span className="muted small"> {r.note}</span>}</span>
          </>
        );
        return onSelect
          ? <button key={r.key} type="button" className="hbar clickable" onClick={() => onSelect(r.key)}>{content}</button>
          : <div key={r.key} className="hbar">{content}</div>;
      })}
      {rows.length > limit && (
        <button type="button" className="ghost sm" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

/** Plain table twin of a monthly chart, so no value is hover-only. */
export function MonthTable({ columns, rows }: { columns: { key: string; label: string; format: (v: number) => string }[]; rows: Record<string, number>[] }) {
  const totals = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, rows.reduce((s, r) => s + (r[c.key] ?? 0), 0)])), [columns, rows]);
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Month</th>{columns.map((c) => <th key={c.key} className="num">{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}><td>{MONTHS[i]}</td>{columns.map((c) => <td key={c.key} className="num">{c.format(r[c.key] ?? 0)}</td>)}</tr>)}</tbody>
        <tfoot><tr><td>Total</td>{columns.map((c) => <td key={c.key} className="num">{c.format(totals[c.key])}</td>)}</tr></tfoot>
      </table>
    </div>
  );
}
