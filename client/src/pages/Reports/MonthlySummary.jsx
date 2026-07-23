import ReportTable from './ReportTable';
import { MONTHS, fmtQty, fmtMoney, basisOf } from './reportUtils';

const emptyMonths = () => Array.from({ length: 12 }, () => ({ qty: 0, amount: 0 }));

/** Flat {id,name,month,qty,amount} rows → one row per product with 12 month buckets. */
export function pivotMonthly(rows, metric) {
  const basis = basisOf(metric);
  const map = new Map();

  for (const r of rows || []) {
    // Orphan lines can arrive without a usable id — fall back to the name so
    // distinct products never collapse into a single null-keyed bucket.
    const key = r.id ?? r.productId ?? `name:${r.name ?? '?'}`;
    if (!map.has(key)) {
      map.set(key, { id: String(key), name: r.name || 'Unknown Product', months: emptyMonths(), total: 0, totalQty: 0, totalAmount: 0 });
    }
    const month = Number(r.month);
    if (!Number.isFinite(month) || month < 1 || month > 12) continue;
    const bucket = map.get(key).months[month - 1];
    bucket.qty += Number(r.qty) || 0;
    bucket.amount += Number(r.amount) || 0;
  }

  const out = [...map.values()];
  for (const p of out) {
    p.totalQty = p.months.reduce((s, m) => s + m.qty, 0);
    p.totalAmount = p.months.reduce((s, m) => s + m.amount, 0);
    p.total = p.months.reduce((s, m) => s + m[basis], 0);
  }
  return out.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

export function monthlyTotals(pivoted) {
  const months = Array.from({ length: 12 }, (_, i) => ({
    qty: pivoted.reduce((s, p) => s + p.months[i].qty, 0),
    amount: pivoted.reduce((s, p) => s + p.months[i].amount, 0),
  }));
  return {
    months,
    qty: months.reduce((s, m) => s + m.qty, 0),
    amount: months.reduce((s, m) => s + m.amount, 0),
  };
}

/** One month cell — one line per selected measure. */
function MeasureCell({ bucket, metric }) {
  const showQty = metric !== 'amount';
  const showAmt = metric !== 'qty';
  if (!bucket.qty && !bucket.amount) return <span className="rp-zero">–</span>;
  return (
    <span className="rp-stack">
      {showQty && <span className="rp-stack-qty">{fmtQty(bucket.qty)}</span>}
      {showAmt && <span className="rp-stack-amt">{fmtMoney(bucket.amount)}</span>}
    </span>
  );
}

export function buildMonthlyColumns(metric, totals) {
  const showQty = metric !== 'amount';
  const showAmt = metric !== 'qty';

  return [
    { key: 'rank', label: '#', align: 'right', width: 42, render: (_r, i) => i + 1, csv: (_r, i) => i + 1 },
    { key: 'name', label: 'Product', render: (row) => row.name },
    ...MONTHS.map((label, i) => ({
      key: `m${i}`, label, align: 'right',
      render: (row) => <MeasureCell bucket={row.months[i]} metric={metric} />,
      total: () => <MeasureCell bucket={totals.months[i]} metric={metric} />,
      csv: (row) => (metric === 'amount' ? row.months[i].amount : row.months[i].qty),
    })),
    {
      key: 'total', label: 'Total', align: 'right', emphasis: true,
      render: (row) => (
        <span className="rp-stack">
          {showQty && <span className="rp-stack-qty">{fmtQty(row.totalQty)}</span>}
          {showAmt && <span className="rp-stack-amt">{fmtMoney(row.totalAmount)}</span>}
        </span>
      ),
      total: () => (
        <span className="rp-stack">
          {showQty && <span className="rp-stack-qty">{fmtQty(totals.qty)}</span>}
          {showAmt && <span className="rp-stack-amt">{fmtMoney(totals.amount)}</span>}
        </span>
      ),
      csv: (row) => (metric === 'amount' ? row.totalAmount : row.totalQty),
    },
  ];
}

export default function MonthlySummary({ rows, metric }) {
  const pivoted = pivotMonthly(rows, metric);
  const totals = monthlyTotals(pivoted);
  const columns = buildMonthlyColumns(metric, totals);

  return <ReportTable columns={columns} rows={pivoted} totals={totals} />;
}
