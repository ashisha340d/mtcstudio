'use strict';
/**
 * Helpers shared by the report modules. Nothing here touches Express or the
 * database — pure SQL fragments, query-string parsing and formatting.
 */
const { getNepalDayBoundsUTC, getNepalDateStr } = require('../../../utils/nepalDateTime');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** A day is balanced if it reconciles to within this many rupees. */
const BALANCE_TOLERANCE = 0.02;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Closed sales lines joined product → category. */
const SALES_JOIN = `
  FROM pos_kot_items ki
  JOIN pos_kots k ON k.id = ki.kot_id
  JOIN pos_orders o ON o.id = k.order_id
  LEFT JOIN products p ON p.id = ki.product_id
  LEFT JOIN categories c ON c.id = p.category_id`;

// A deleted product leaves ki.product_id dangling — fall back to the name
// snapshotted on the KOT line so the row still reports.
const PRODUCT_NAME = `COALESCE(p.name, ki.product_name, 'Unknown Product')`;
// Key rows by product id, falling back to the snapshot name for orphan lines.
const PRODUCT_KEY = `COALESCE(CAST(p.id AS CHAR), CONCAT('x:', COALESCE(ki.product_name, '?')))`;

/**
 * WALLET is stored as CARD with notes='WALLET' (POS checkout convention), so
 * every tender breakdown has to split it back out.
 */
const walletMethodExpr = (alias) =>
  `CASE WHEN ${alias}.method='CARD' AND ${alias}.notes='WALLET' THEN 'WALLET' ELSE ${alias}.method END`;

/** '3,7,12' → { clause, params } appended to a WHERE. Empty → no filter. */
function idListFilter(raw, column) {
  const ids = String(raw || '').split(',').map(s => Number(s.trim())).filter(Number.isFinite);
  if (!ids.length) return { clause: '', params: [] };
  return { clause: ` AND ${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

/** ?from=&to= → the UTC bounds of that inclusive Nepal date range. */
function rangeBounds(req) {
  const from = req.query.from || getNepalDateStr();
  const to = req.query.to || from;
  return { start: getNepalDayBoundsUTC(from).start, end: getNepalDayBoundsUTC(to).end };
}

/** 'YYYY-MM-DD HH:MM:SS' → 'HH:MM'. Already Nepal wall-clock (mysql2 dateStrings). */
const nepalTimeOf = (ts) => (String(ts).split(' ')[1] || '00:00:00').slice(0, 5);

module.exports = {
  round2,
  BALANCE_TOLERANCE,
  DATE_RE,
  SALES_JOIN,
  PRODUCT_NAME,
  PRODUCT_KEY,
  walletMethodExpr,
  idListFilter,
  rangeBounds,
  nepalTimeOf,
};
