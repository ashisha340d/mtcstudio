/* Date maths, series building and formatting for the Sales Calendar.
   All dates are plain 'YYYY-MM-DD' strings in Nepal wall-clock — the server
   already returns Nepal-local buckets, so nothing here converts time zones. */

import { MONTHS, fmtMoney, fmtQty } from '../reportUtils';

export const WEEKDAYS_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const WEEKDAYS_MIN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const VIEWS = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
];

/* ── Date helpers ─────────────────────────────────────────── */

export const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const parseYmd = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (iso, n) => {
  const d = parseYmd(iso);
  d.setDate(d.getDate() + n);
  return ymd(d);
};

export const addMonths = (iso, n) => {
  const d = parseYmd(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return ymd(d);
};

export const startOfWeek = (iso) => addDays(iso, -parseYmd(iso).getDay());
export const startOfMonth = (iso) => `${iso.slice(0, 7)}-01`;
export const endOfMonth = (iso) => {
  const d = parseYmd(iso);
  return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
};

export const dayOfWeek = (iso) => parseYmd(iso).getDay();
export const monthOf = (iso) => Number(iso.slice(5, 7)) - 1;
export const dayNum = (iso) => Number(iso.slice(8, 10));

const range = (from, to) => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

/**
 * Everything a view needs to fetch and render.
 * `days` is the full list of cells the view paints (month view includes the
 * leading/trailing days of the neighbouring months, exactly like Google's).
 */
export function viewRange(view, anchor) {
  if (view === 'day') {
    return { from: anchor, to: anchor, bucket: 'hour', days: [anchor] };
  }
  if (view === 'week') {
    const from = startOfWeek(anchor);
    const to = addDays(from, 6);
    return { from, to, bucket: 'hour', days: range(from, to) };
  }
  if (view === 'month') {
    const from = startOfWeek(startOfMonth(anchor));
    const last = endOfMonth(anchor);
    const to = addDays(startOfWeek(last), 6);
    return { from, to, bucket: 'hour', days: range(from, to) };
  }
  const y = anchor.slice(0, 4);
  return { from: `${y}-01-01`, to: `${y}-12-31`, bucket: 'day', days: range(`${y}-01-01`, `${y}-12-31`) };
}

export function periodTitle(view, anchor) {
  if (view === 'year') return anchor.slice(0, 4);
  if (view === 'month') return `${MONTHS_LONG[monthOf(anchor)]} ${anchor.slice(0, 4)}`;
  if (view === 'day') return `${MONTHS_LONG[monthOf(anchor)]} ${dayNum(anchor)}, ${anchor.slice(0, 4)}`;
  const from = startOfWeek(anchor);
  const to = addDays(from, 6);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return sameMonth
    ? `${MONTHS[monthOf(from)]} ${dayNum(from)} – ${dayNum(to)}, ${from.slice(0, 4)}`
    : `${MONTHS[monthOf(from)]} ${dayNum(from)} – ${MONTHS[monthOf(to)]} ${dayNum(to)}, ${to.slice(0, 4)}`;
}

export const shiftAnchor = (view, anchor, dir) => {
  if (view === 'day') return addDays(anchor, dir);
  if (view === 'week') return addDays(anchor, 7 * dir);
  if (view === 'month') return addMonths(anchor, dir);
  return addMonths(anchor, 12 * dir);
};

/* ── Formatting ───────────────────────────────────────────── */

const COMPACT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export const fmtValue = (v, unit) =>
  unit === 'qty' ? fmtQty(Math.round(v * 100) / 100) : COMPACT.format(Math.round(v));
export const fmtExact = (v, unit) => (unit === 'qty' ? fmtQty(v) : fmtMoney(v));

/** 0 → '12 AM', 13 → '1 PM' */
export const hourLabel = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;
/** 15 → '3:00pm' — the compact form Google prints inside a chip. */
export const hourChipLabel = (h) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;

export const dateLabel = (iso) =>
  `${WEEKDAYS_SHORT[dayOfWeek(iso)]}, ${MONTHS[monthOf(iso)]} ${dayNum(iso)}`;

/* ── Series ───────────────────────────────────────────────── */

export const PAYMENT_SERIES = [
  { code: 'TOTAL', label: 'Total Sales', color: '#4285f4' },
  { code: 'CASH', label: 'Cash', color: '#0b8043' },
  { code: 'QR', label: 'QR', color: '#8e24aa' },
  { code: 'CARD', label: 'Credit / Card', color: '#f6bf26' },
  { code: 'WALLET', label: 'Wallet', color: '#009688' },
  { code: 'LEDGER', label: 'Ledger', color: '#e67c73' },
];

const PALETTE = [
  '#3f51b5', '#e67c73', '#33b679', '#f4511e', '#039be5', '#7986cb',
  '#616161', '#d81b60', '#795548', '#0097a7', '#c0ca33', '#ab47bc',
];
export const paletteColor = (i) => PALETTE[i % PALETTE.length];

function pushPoint(days, t, value) {
  if (!value) return;
  const date = t.slice(0, 10);
  let cell = days.get(date);
  if (!cell) {
    cell = { total: 0, hours: new Array(24).fill(0) };
    days.set(date, cell);
  }
  cell.total += value;
  if (t.length > 10) cell.hours[Number(t.slice(11, 13))] += value;
}

const emptySeries = (id, label, color, unit, group) =>
  ({ id, label, color, unit, group, days: new Map(), total: 0 });

/**
 * Raw API payload + the user's plot selection → renderable series.
 * selection: { payments:[code], categoryIds:[id], categoryMeasure, productIds:[id], productMeasure }
 */
export function buildSeries(data, selection) {
  const out = [];
  if (!data) return out;

  const payCodes = selection.payments || [];
  if (payCodes.length && data.payments?.length) {
    const map = new Map();
    for (const def of PAYMENT_SERIES) {
      if (payCodes.includes(def.code)) {
        map.set(def.code, emptySeries(`pay:${def.code}`, def.label, def.color, 'money', 'Payments'));
      }
    }
    for (const row of data.payments) {
      const amount = Number(row.amount) || 0;
      const target = map.get(row.method);
      if (target) pushPoint(target.days, row.t, amount);
      const total = map.get('TOTAL');
      if (total) pushPoint(total.days, row.t, amount);
    }
    for (const def of PAYMENT_SERIES) {
      const s = map.get(def.code);
      if (s) out.push(s);
    }
  }

  const addMeasured = (rows, ids, measure, group, prefix, colorAt, useRowColor = false) => {
    if (!rows?.length || !ids.length) return;
    const wanted = new Set(ids.map(String));
    const measures = measure === 'both' ? ['qty', 'amount'] : [measure];
    const map = new Map();
    for (const row of rows) {
      if (!wanted.has(String(row.id))) continue;
      for (const m of measures) {
        const key = `${row.id}:${m}`;
        let s = map.get(key);
        if (!s) {
          const idx = ids.findIndex(x => String(x) === String(row.id));
          const suffix = measures.length > 1 ? (m === 'qty' ? ' · Qty' : ' · Amt') : '';
          // A station carries its own colour from POS setup — keep it recognisable.
          const color = (useRowColor && row.color) || colorAt(idx < 0 ? 0 : idx, m);
          s = emptySeries(
            `${prefix}:${key}`, `${row.name}${suffix}`,
            color, m === 'qty' ? 'qty' : 'money', group
          );
          map.set(key, s);
        }
        pushPoint(s.days, row.t, Number(row[m]) || 0);
      }
    }
    out.push(...map.values());
  };

  addMeasured(
    data.categories, selection.categoryIds || [], selection.categoryMeasure || 'amount',
    'Categories', 'cat', (i, m) => (m === 'qty' ? paletteColor(i + 6) : paletteColor(i))
  );
  addMeasured(
    data.products, selection.productIds || [], selection.productMeasure || 'amount',
    'Items', 'prod', (i, m) => (m === 'qty' ? paletteColor(i + 7) : paletteColor(i + 3))
  );
  addMeasured(
    data.stations, selection.stationIds || [], selection.stationMeasure || 'amount',
    'Stations', 'stn', (i, m) => (m === 'qty' ? paletteColor(i + 9) : paletteColor(i + 2)), true
  );
  addMeasured(
    data.badges, selection.badges || [], selection.badgeMeasure || 'qty',
    'Badges', 'badge', (i, m) => (m === 'qty' ? paletteColor(i + 4) : paletteColor(i + 10))
  );

  for (const s of out) {
    let total = 0;
    for (const cell of s.days.values()) total += cell.total;
    s.total = total;
  }
  return out;
}

/** Sum of one series over a list of dates. */
export const sumDays = (series, dates) =>
  dates.reduce((acc, d) => acc + (series.days.get(d)?.total || 0), 0);

/** Sum of one series over the same hour across several dates. */
export const sumHour = (series, dates, hour) =>
  dates.reduce((acc, d) => acc + (series.days.get(d)?.hours[hour] || 0), 0);

/** Hours (0-23) that carry a value in any selected series over `dates`. */
export function activeHours(series, dates) {
  const hits = new Set();
  for (const s of series) {
    for (const d of dates) {
      const cell = s.days.get(d);
      if (!cell) continue;
      for (let h = 0; h < 24; h++) if (cell.hours[h]) hits.add(h);
    }
  }
  return [...hits].sort((a, b) => a - b);
}

/** Map of 'YYYY-MM-DD' → [holiday titles], expanded over multi-day entries. */
export function holidayIndex(holidays) {
  const map = new Map();
  for (const h of holidays || []) {
    const last = h.end || h.date;
    let d = h.date;
    for (let i = 0; d <= last && i < 60; i++, d = addDays(d, 1)) {   // guard a malformed feed
      const list = map.get(d) || [];
      list.push(h.title);
      map.set(d, list);
    }
  }
  return map;
}
