import ReportTable from './ReportTable';
import { fmtQty, fmtMoney, fmtPct, basisOf, ORDER_TYPE_LABELS } from './reportUtils';

function imgSrc(raw) {
  if (!raw) return null;
  if (raw.startsWith('http') || raw.startsWith('/uploads/')) return raw;
  return `/uploads/${raw}`;
}

const LABEL = { 'order-type': 'Order Type', category: 'Category', product: 'Product' };

const displayName = (variant, row) =>
  variant === 'order-type' ? (ORDER_TYPE_LABELS[row.name] || row.name) : (row.name || '—');

/** Column config shared by the table and the CSV export. */
export function buildRankedColumns(variant, metric, grandTotal) {
  const basis = basisOf(metric);
  const share = (row) => (grandTotal ? (row[basis] / grandTotal) * 100 : 0);

  const cols = [
    { key: 'rank', label: '#', align: 'right', width: 42, render: (_r, i) => i + 1, csv: (_r, i) => i + 1 },
  ];

  if (variant === 'category') {
    cols.push({
      key: 'thumb', label: '', width: 46, csv: () => '',
      render: (row) => row.image_url
        ? <img src={imgSrc(row.image_url)} alt="" className="rp-thumb" />
        : <span className="rp-thumb-emoji">{row.icon || '▦'}</span>,
    });
  }

  cols.push({
    key: 'name', label: LABEL[variant],
    render: (row) => displayName(variant, row),
    csv: (row) => displayName(variant, row),
  });

  if (variant === 'product') {
    cols.push({ key: 'category_name', label: 'Category', render: (row) => row.category_name || '—' });
  }

  if (variant === 'order-type') {
    cols.push({
      key: 'orders', label: 'Orders', align: 'right', width: 90,
      render: (row) => fmtQty(row.orders),
      total: (t) => fmtQty(t.orders),
    });
  }

  if (metric !== 'amount') {
    cols.push({
      key: 'qty', label: 'Qty Sold', align: 'right', width: 110,
      emphasis: metric === 'qty',
      render: (row) => fmtQty(row.qty),
      total: (t) => fmtQty(t.qty),
      csv: (row) => row.qty,
    });
  }

  if (metric !== 'qty') {
    cols.push({
      key: 'amount', label: 'Amount Sold', align: 'right', width: 140,
      emphasis: metric === 'amount',
      render: (row) => fmtMoney(row.amount),
      total: (t) => fmtMoney(t.amount),
      csv: (row) => row.amount,
    });
  }

  cols.push({
    key: 'share', label: `Share · ${basis === 'qty' ? 'Qty' : 'Amount'}`, align: 'right', width: 150,
    render: (row) => (
      <div className="rp-share">
        <div className="rp-share-bar"><span style={{ width: `${Math.min(100, share(row))}%` }} /></div>
        <span className="rp-share-val">{fmtPct(share(row))}</span>
      </div>
    ),
    total: () => '100.0%',
    csv: (row) => share(row).toFixed(1),
  });

  return cols;
}

export function rankedTotals(rows) {
  return rows.reduce((t, r) => ({
    orders: t.orders + (r.orders || 0),
    qty: t.qty + (r.qty || 0),
    amount: t.amount + (r.amount || 0),
  }), { orders: 0, qty: 0, amount: 0 });
}

export function sortRanked(rows, metric) {
  const basis = basisOf(metric);
  return [...rows].sort((a, b) => (b[basis] || 0) - (a[basis] || 0));
}

export default function RankedSummary({ variant, rows, metric, onRowClick }) {
  const sorted = sortRanked(rows, metric);
  const totals = rankedTotals(sorted);
  const columns = buildRankedColumns(variant, metric, totals[basisOf(metric)]);

  return <ReportTable columns={columns} rows={sorted} totals={totals} onRowClick={onRowClick} />;
}
