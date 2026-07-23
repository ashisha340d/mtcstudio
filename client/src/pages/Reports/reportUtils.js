// Shared formatting + period helpers for the Reports module.

const NUM = new Intl.NumberFormat('en-IN');
const MONEY = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtQty = (n) => NUM.format(Number(n) || 0);
export const fmtMoney = (n) => MONEY.format(Number(n) || 0);
export const fmtPct = (n) => `${(Number(n) || 0).toFixed(1)}%`;

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function todayNepal() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 'YYYY-MM-DD' → '22 Jul 2026' */
export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

/** 'YYYY-MM-DD' → 'Monday' (parsed as a local calendar date, no TZ shift) */
export function weekday(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

/** Measure can be 'qty' | 'amount' | 'both'; 'both' ranks and shares by amount. */
export const basisOf = (metric) => (metric === 'both' ? 'amount' : metric);
export const measureLabel = (metric) =>
  metric === 'qty' ? 'Quantity' : metric === 'amount' ? 'Amount' : 'Quantity & Amount';

export function fmtStamp(dt) {
  return dt.toLocaleString('en-GB', {
    timeZone: 'Asia/Kathmandu', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

/** Resolve a criteria object into { from, to } ISO dates. */
export function resolveRange({ mode, date, from, to, month, year }) {
  if (mode === 'day') return { from: date, to: date };
  if (mode === 'range') return { from, to };
  if (mode === 'month') {
    const [y, m] = month.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
  }
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** Human period label for the report header. */
export function periodLabel(criteria) {
  const { from, to } = resolveRange(criteria);
  if (criteria.mode === 'year') return `Year ${criteria.year}`;
  if (from === to) return fmtDate(from);
  return `${fmtDate(from)} — ${fmtDate(to)}`;
}

export const ORDER_TYPE_LABELS = {
  DINE_IN: 'Dine In',
  TAKEAWAY: 'Takeaway',
  DELIVERY: 'Delivery',
  CAKE_ORDER: 'Cake Order',
  QUICK_SALE: 'Quick Sale',
};

/** Flat CSV download from the same column config the table renders. */
export function downloadCSV(filename, columns, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map(c => esc(c.label)).join(',');
  const body = rows
    .map((r, i) => columns.map(c => esc(c.csv ? c.csv(r, i) : r[c.key])).join(','))
    .join('\n');
  const blob = new Blob([`${head}\n${body}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
