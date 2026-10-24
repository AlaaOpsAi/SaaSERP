import { useMemo } from 'react';
import type { Booking, ContractField } from '../api';
import { money, num } from '../format';
import { t } from '../i18n';
import { compareKeys, type GridColumn, showValue } from './ContractGrid';

/** What the pivot can group by: columns of the grid, so a click filters the list the same way. */
export const PIVOT_DIMS = ['owner', 'month', 'year', 'venue', 'event_type', 'source', 'business_unit', 'status'] as const;

export interface PivotValue { id: string; label: string; field?: ContractField; get?: (b: Booking) => number | null }

export function pivotValues(): PivotValue[] {
  return [
    { id: 'count', label: t('Number of contracts') },
    { id: 'contract_value', label: t('Contract value'), field: 'contract_value', get: (b) => b.contract_value },
    { id: 'revenue', label: t('Revenue'), field: 'finance', get: (b) => b.revenue },
    { id: 'gross_margin', label: t('Margin'), field: 'finance', get: (b) => b.gross_margin },
    { id: 'net_profit', label: t('Net profit'), field: 'finance', get: (b) => b.net_profit },
    { id: 'paid', label: t('Money received'), field: 'money_received', get: (b) => b.paid },
    { id: 'outstanding', label: t('Outstanding'), field: 'finance', get: (b) => b.outstanding },
    { id: 'pax', label: t('Pax'), field: 'pax', get: (b) => b.pax },
  ];
}

export interface PivotConfig { rows: string; cols: string; value: string }

export interface PivotTable {
  rowKeys: string[]; colKeys: string[];
  rowLabel: (k: string) => string; colLabel: (k: string) => string;
  cell: (r: string, c: string) => number; rowTotal: (r: string) => number; colTotal: (c: string) => number; total: number;
  format: (n: number) => string;
}

const TOTAL = '\u0000all';

export function buildPivot(rows: Booking[], rowDim: GridColumn, colDim: GridColumn | undefined, value: PivotValue): PivotTable {
  const sums = new Map<string, number>();
  const add = (k: string, n: number) => sums.set(k, (sums.get(k) ?? 0) + n);
  const rk = new Set<string>(), ck = new Set<string>();
  for (const b of rows) {
    const r = String(rowDim.get(b) ?? '');
    const c = colDim ? String(colDim.get(b) ?? '') : TOTAL;
    const n = value.get ? Number(value.get(b) ?? 0) : 1;
    rk.add(r); ck.add(c);
    add(`${r}|${c}`, n); add(`${r}|${TOTAL}`, n); add(`${TOTAL}|${c}`, n); add(`${TOTAL}|${TOTAL}`, n);
  }
  const labeler = (d: GridColumn) => (k: string) => showValue(d, k === '' ? undefined : k) || t('(blank)');
  const ordered = (d: GridColumn, keys: Set<string>) => {
    const label = labeler(d);
    return [...keys].sort((a, b) => compareKeys(d, a, b, label(a), label(b)));
  };
  return {
    rowKeys: ordered(rowDim, rk),
    colKeys: colDim ? ordered(colDim, ck) : [],
    rowLabel: labeler(rowDim),
    colLabel: colDim ? labeler(colDim) : () => '',
    cell: (r, c) => sums.get(`${r}|${c}`) ?? 0,
    rowTotal: (r) => sums.get(`${r}|${TOTAL}`) ?? 0,
    colTotal: (c) => sums.get(`${TOTAL}|${c}`) ?? 0,
    total: sums.get(`${TOTAL}|${TOTAL}`) ?? 0,
    format: value.id === 'count' || value.id === 'pax' ? num : (n) => money(n),
  };
}

/** The pivot as rows of plain values, for Excel. */
export function pivotSheet(p: PivotTable, rowDim: GridColumn, value: PivotValue) {
  const header = [rowDim.label, ...p.colKeys.map(p.colLabel), p.colKeys.length ? t('Total') : value.label];
  const rows: (string | number)[][] = p.rowKeys.map((r) => [p.rowLabel(r), ...p.colKeys.map((c) => p.cell(r, c)), p.rowTotal(r)]);
  rows.push([t('Total'), ...p.colKeys.map((c) => p.colTotal(c)), p.total]);
  return { header, rows, bold: [rows.length - 1] };
}

/**
 * An Excel-style pivot over the filtered contracts: rows, optional columns, one value, with totals.
 * Clicking a number opens the list filtered to the contracts behind it.
 */
export function ContractPivot({ rows, rowDim, colDim, value, onOpen }: {
  rows: Booking[]; rowDim: GridColumn; colDim?: GridColumn; value: PivotValue;
  onOpen: (filter: Record<string, string>) => void;
}) {
  const p = useMemo(() => buildPivot(rows, rowDim, colDim, value), [rows, rowDim, colDim, value]);
  const open = (r?: string, c?: string) => onOpen({
    ...(r !== undefined ? { [rowDim.id]: r } : {}),
    ...(c !== undefined && colDim ? { [colDim.id]: c } : {}),
  });
  const Cell = ({ n, r, c, strong }: { n: number; r?: string; c?: string; strong?: boolean }) => (
    <td className="num">
      {n ? <button type="button" className="pivot-cell" onClick={() => open(r, c)}
        title={t('Show these contracts')}>{strong ? <strong>{p.format(n)}</strong> : p.format(n)}</button> : <span className="muted">—</span>}
    </td>
  );

  if (!rows.length) return <div className="empty">{t('No bookings match these filters.')}</div>;
  return (
    <div className="table-wrap">
      <table className="pivot">
        <thead>
          <tr>
            <th>{rowDim.label}{colDim && <span className="muted"> / {colDim.label}</span>}</th>
            {p.colKeys.map((c) => <th key={c} className="num">{p.colLabel(c)}</th>)}
            <th className="num">{p.colKeys.length ? t('Total') : value.label}</th>
          </tr>
        </thead>
        <tbody>
          {p.rowKeys.map((r) => (
            <tr key={r}>
              <th scope="row">{p.rowLabel(r)}</th>
              {p.colKeys.map((c) => <Cell key={c} n={p.cell(r, c)} r={r} c={c} />)}
              <Cell n={p.rowTotal(r)} r={r} strong />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{t('Total')}</th>
            {p.colKeys.map((c) => <Cell key={c} n={p.colTotal(c)} c={c} strong />)}
            <Cell n={p.total} strong />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
