import ReportTable from './ReportTable';
import { fmtMoney, fmtQty, fmtDate, weekday } from './reportUtils';

const TENDERS = [
  { key: 'CASH', label: 'Cash' },
  { key: 'CARD', label: 'Card' },
  { key: 'WALLET', label: 'Wallet' },
  { key: 'QR', label: 'QR' },
  { key: 'LEDGER', label: 'Credit' },
];

export function paymentTotals(rows) {
  const base = { orders: 0, total: 0 };
  for (const t of TENDERS) base[t.key] = 0;
  return (rows || []).reduce((acc, r) => {
    acc.orders += r.orders || 0;
    acc.total += r.total || 0;
    for (const t of TENDERS) acc[t.key] += r[t.key] || 0;
    return acc;
  }, base);
}

export function buildPaymentColumns() {
  return [
    {
      key: 'date', label: 'Day', width: 200,
      render: (row) => (
        <span className="rp-day">
          {fmtDate(row.date)}
          <em>{weekday(row.date)}</em>
        </span>
      ),
      total: () => 'TOTAL',
      csv: (row) => `${fmtDate(row.date)} ${weekday(row.date)}`,
    },
    {
      key: 'orders', label: 'Orders', align: 'right', width: 80,
      render: (row) => fmtQty(row.orders),
      total: (t) => fmtQty(t.orders),
    },
    ...TENDERS.map(t => ({
      key: t.key, label: t.label, align: 'right', width: 120,
      render: (row) => (row[t.key] ? fmtMoney(row[t.key]) : <span className="rp-zero">–</span>),
      total: (tot) => fmtMoney(tot[t.key]),
      csv: (row) => row[t.key],
    })),
    {
      key: 'total', label: 'Total', align: 'right', width: 140, emphasis: true,
      render: (row) => fmtMoney(row.total),
      total: (t) => fmtMoney(t.total),
      csv: (row) => row.total,
    },
  ];
}

export default function PaymentRegister({ rows }) {
  return <ReportTable columns={buildPaymentColumns()} rows={rows} totals={paymentTotals(rows)} />;
}
