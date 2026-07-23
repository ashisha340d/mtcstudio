import ReportTable from './ReportTable';
import { fmtMoney, fmtDate } from './reportUtils';

export function buildZeroSalesColumns() {
  return [
    { key: 'rank', label: '#', align: 'right', width: 42, render: (_r, i) => i + 1, csv: (_r, i) => i + 1 },
    { key: 'name', label: 'Product', render: (row) => row.name || '—' },
    { key: 'category_name', label: 'Category', render: (row) => row.category_name || '—' },
    { key: 'price', label: 'Price', align: 'right', width: 120, render: (row) => fmtMoney(row.price), csv: (row) => row.price },
    {
      key: 'last_sold', label: 'Last Sold', align: 'right', width: 140,
      render: (row) => row.last_sold
        ? fmtDate(row.last_sold)
        : <span className="rp-never">Never sold</span>,
      csv: (row) => row.last_sold || 'Never',
    },
  ];
}

export default function ZeroSales({ rows }) {
  return (
    <ReportTable
      columns={buildZeroSalesColumns()}
      rows={rows}
      emptyMessage="Every active item sold at least once in this period."
    />
  );
}
