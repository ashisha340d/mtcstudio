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

/** Closed sales lines joined product → variant → category. */
const SALES_JOIN = `
  FROM pos_kot_items ki
  JOIN pos_kots k ON k.id = ki.kot_id
  JOIN pos_orders o ON o.id = k.order_id
  LEFT JOIN products p ON p.id = ki.product_id
  LEFT JOIN product_variants v ON v.id = ki.variant_id
  LEFT JOIN categories c ON c.id = p.category_id`;

// A real variant only — v.name straight off product_variants, joined on
// ki.variant_id. Never the KOT line's free-text snapshot: that string can
// carry modifier/topping add-ons baked in at checkout ("+ Extra Cheese",
// "+ Smoked Chicken"), which are not variants and must not split a row.
// 'Regular'/name-matching variants are suppressed, same rule the cart already
// applies when it first builds that snapshot (posShared.cleanVariantName).
const PRODUCT_NAME = `
  CASE
    WHEN v.name IS NOT NULL
         AND LOWER(TRIM(v.name)) <> 'regular'
         AND LOWER(TRIM(v.name)) <> LOWER(TRIM(COALESCE(p.name, '')))
      THEN CONCAT(COALESCE(p.name, ki.product_name, 'Unknown Product'), ' (', TRIM(v.name), ')')
    ELSE COALESCE(p.name, ki.product_name, 'Unknown Product')
  END
`;
// product_id + variant_id — never the line's free-text snapshot, so two
// lines that are the same variant with different add-ons stay one row.
const PRODUCT_KEY = `COALESCE(
  CONCAT(CAST(p.id AS CHAR), '-', COALESCE(CAST(ki.variant_id AS CHAR), '0')),
  CONCAT('x:', COALESCE(ki.product_name, '?'))
)`;

/**
 * WALLET is stored as CARD with notes='WALLET' (POS checkout convention), so
 * every tender breakdown has to split it back out.
 */
const walletMethodExpr = (alias) =>
  `CASE WHEN ${alias}.method='CARD' AND ${alias}.notes='WALLET' THEN 'WALLET' ELSE ${alias}.method END`;

/** '3,7,12' → { clause, params } appended to a WHERE. Empty → no filter. */
function idListFilter(raw, column) {
  const ids = String(raw || '').split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
  if (!ids.length) return { clause: '', params: [] };
  return { clause: ` AND ${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

/** 'DINE_IN,TAKEAWAY' → { clause, params }. Same shape as idListFilter, string-keyed. */
function stringListFilter(raw, column) {
  const vals = String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!vals.length) return { clause: '', params: [] };
  return { clause: ` AND ${column} IN (${vals.map(() => '?').join(',')})`, params: vals };
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
  stringListFilter,
  rangeBounds,
  nepalTimeOf,
};
