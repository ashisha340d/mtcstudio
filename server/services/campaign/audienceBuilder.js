'use strict';
/**
 * Audience Builder — compiles a nested AND/OR/NOT filter tree into a single
 * parameterized SQL query over the existing `customers` table, enriched with
 * order aggregates from `pos_orders` / `pos_kot_items` and coupon history.
 *
 * Field access is whitelisted through FIELD_REGISTRY so a rule tree can never
 * inject SQL, and an unknown field compiles to a no-op (TRUE) — new segments
 * are added by extending the registry, never the compiler.
 */
const { dbAll, dbGet } = require('../../database/db');

// Order aggregates for a customer, joined by phone. status='CLOSED' = a real sale.
const ORDER_AGG = `
    LEFT JOIN (
        SELECT customer_phone AS phone,
               COUNT(*)              AS visit_count,
               COALESCE(SUM(total_amount),0)  AS total_spent,
               COALESCE(AVG(total_amount),0)  AS avg_ticket,
               MAX(created_at)       AS last_order_at,
               MIN(created_at)       AS first_order_at
        FROM   pos_orders
        WHERE  status = 'CLOSED' AND customer_phone IS NOT NULL AND customer_phone <> ''
        GROUP  BY customer_phone
    ) o ON o.phone = c.phone`;

// Scalar fields: a SQL expression compared with a standard operator.
const SCALAR = {
    phone:                 'c.phone',
    name:                  'c.name',
    email:                 'c.email',
    address:               'c.address',
    location:              'c.address',
    notes:                 'c.notes',
    tags:                  'c.notes',
    status:                'c.status',
    birthday:              'c.birthday',
    has_birthday:          '(c.birthday IS NOT NULL AND c.birthday <> "")',
    birthday_month:        'MONTH(c.birthday)',
    birthday_day:          'DAY(c.birthday)',
    loyalty_points:        'c.loyalty_points',
    rewards_tier:          'c.rewards_tier',
    membership:            'c.rewards_tier',
    tier:                  'c.rewards_tier',
    discount:              'c.discount',
    is_delivery_partner:   'c.is_delivery_partner',
    created_at:            'c.created_at',
    customer_age_days:     'DATEDIFF(CURDATE(), c.created_at)',
    visit_count:           'COALESCE(o.visit_count,0)',
    order_count:           'COALESCE(o.visit_count,0)',
    total_spent:           'COALESCE(o.total_spent,0)',
    lifetime_value:        'COALESCE(o.total_spent,0)',
    avg_ticket:            'COALESCE(o.avg_ticket,0)',
    last_order_at:         'o.last_order_at',
    first_order_at:        'o.first_order_at',
    days_since_last_order: 'DATEDIFF(CURDATE(), o.last_order_at)',
    days_since_first_order:'DATEDIFF(CURDATE(), o.first_order_at)',
};

// Existence fields: op+value produce an EXISTS(...) subquery. Extensible.
const EXISTS_FIELDS = {
    product_purchased: (op, value, push) => {
        const ids = Array.isArray(value) ? value : [value];
        const ph = ids.map(() => '?').join(',');
        ids.forEach(v => push(v));
        return `EXISTS (SELECT 1 FROM pos_orders po JOIN pos_kots k ON k.order_id=po.id
                        JOIN pos_kot_items ki ON ki.kot_id=k.id
                        WHERE po.customer_phone=c.phone AND ki.product_id IN (${ph}))`;
    },
    category_purchased: (op, value, push) => {
        const ids = Array.isArray(value) ? value : [value];
        const ph = ids.map(() => '?').join(',');
        ids.forEach(v => push(v));
        return `EXISTS (SELECT 1 FROM pos_orders po JOIN pos_kots k ON k.order_id=po.id
                        JOIN pos_kot_items ki ON ki.kot_id=k.id
                        JOIN products p ON p.id=ki.product_id
                        WHERE po.customer_phone=c.phone AND p.category_id IN (${ph}))`;
    },
    has_coupon: (op, value, push) => {
        return `EXISTS (SELECT 1 FROM campaign_coupon_codes cc
                        WHERE cc.customer_phone=c.phone)`;
    },
    redeemed_campaign: (op, value, push) => {
        push(value);
        return `EXISTS (SELECT 1 FROM campaign_coupon_redemptions cr
                        WHERE cr.customer_phone=c.phone AND cr.campaign_id = ?)`;
    },
    ordered_last_days: (op, value, push) => {
        push(Number(value) || 0);
        return `EXISTS (SELECT 1 FROM pos_orders po WHERE po.customer_phone=c.phone
                        AND po.status='CLOSED' AND po.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY))`;
    },
};

function opToSql(expr, op, value, push) {
    switch (op) {
        case 'eq':          push(value); return `${expr} = ?`;
        case 'neq':         push(value); return `${expr} <> ?`;
        case 'gt':          push(value); return `${expr} > ?`;
        case 'gte':         push(value); return `${expr} >= ?`;
        case 'lt':          push(value); return `${expr} < ?`;
        case 'lte':         push(value); return `${expr} <= ?`;
        case 'between':     push(value?.[0]); push(value?.[1]); return `${expr} BETWEEN ? AND ?`;
        case 'in': {
            const arr = Array.isArray(value) ? value : [value];
            if (!arr.length) return '0';
            arr.forEach(v => push(v));
            return `${expr} IN (${arr.map(() => '?').join(',')})`;
        }
        case 'not_in': {
            const arr = Array.isArray(value) ? value : [value];
            if (!arr.length) return '1';
            arr.forEach(v => push(v));
            return `${expr} NOT IN (${arr.map(() => '?').join(',')})`;
        }
        case 'contains':     push(`%${value}%`); return `${expr} LIKE ?`;
        case 'not_contains': push(`%${value}%`); return `${expr} NOT LIKE ?`;
        case 'starts_with':  push(`${value}%`);  return `${expr} LIKE ?`;
        case 'ends_with':    push(`%${value}`);  return `${expr} LIKE ?`;
        case 'exists':       return `(${expr} IS NOT NULL AND ${expr} <> '')`;
        case 'not_exists':   return `(${expr} IS NULL OR ${expr} = '')`;
        case 'is_true':      return `${expr} = 1`;
        case 'is_false':     return `(${expr} = 0 OR ${expr} IS NULL)`;
        default:             return '1';
    }
}

function compileLeaf(node, push) {
    if (EXISTS_FIELDS[node.field]) {
        const frag = EXISTS_FIELDS[node.field](node.op, node.value, push);
        return node.op === 'not_exists' || node.op === 'is_false' ? `NOT (${frag})` : frag;
    }
    const expr = SCALAR[node.field];
    if (!expr) return '1';                    // unknown field — ignored, not injected
    return opToSql(expr, node.op || 'eq', node.value, push);
}

function compileNode(node, push) {
    if (!node || typeof node !== 'object') return '1';
    if (Array.isArray(node)) return node.length ? `(${node.map(n => compileNode(n, push)).join(' AND ')})` : '1';
    if (Array.isArray(node.and)) return node.and.length ? `(${node.and.map(n => compileNode(n, push)).join(' AND ')})` : '1';
    if (Array.isArray(node.or))  return node.or.length ? `(${node.or.map(n => compileNode(n, push)).join(' OR ')})` : '1';
    if (node.not) return `NOT (${compileNode(node.not, push)})`;
    if ('field' in node) return compileLeaf(node, push);
    const parts = Object.values(node).filter(v => v && typeof v === 'object');
    return parts.length ? `(${parts.map(n => compileNode(n, push)).join(' AND ')})` : '1';
}

/** Build the WHERE clause + params for an audience tree (excludes inactive customers). */
function compile(tree) {
    const params = [];
    const where = compileNode(tree, v => params.push(v));
    return { where, params };
}

/** Return matching customer rows (with aggregates). limit caps the result set. */
async function resolve(tree, { limit = null, status = 'active' } = {}) {
    const { where, params } = compile(tree);
    const statusClause = status === 'all' ? '1' : 'c.status = ?';
    const p = status === 'all' ? params : [status, ...params];
    const sql = `
        SELECT c.phone, c.name, c.email, c.birthday, c.loyalty_points, c.rewards_tier,
               c.discount, COALESCE(o.visit_count,0) AS visit_count,
               COALESCE(o.total_spent,0) AS total_spent, COALESCE(o.avg_ticket,0) AS avg_ticket,
               o.last_order_at, o.first_order_at,
               DATEDIFF(CURDATE(), o.last_order_at) AS days_since_last_order
        FROM   customers c ${ORDER_AGG}
        WHERE  ${statusClause} AND (${where})
        ORDER  BY c.name
        ${limit ? 'LIMIT ' + Number(limit) : ''}`;
    return dbAll(sql, p);
}

/** Count only — used by the builder preview and run sizing. */
async function count(tree, { status = 'active' } = {}) {
    const { where, params } = compile(tree);
    const statusClause = status === 'all' ? '1' : 'c.status = ?';
    const p = status === 'all' ? params : [status, ...params];
    const row = await dbGet(
        `SELECT COUNT(*) AS n FROM customers c ${ORDER_AGG} WHERE ${statusClause} AND (${where})`, p
    );
    return row ? Number(row.n) : 0;
}

/** Field catalogue for the Audience Builder UI. */
function fieldCatalogue() {
    return {
        scalar: Object.keys(SCALAR),
        existence: Object.keys(EXISTS_FIELDS),
    };
}

module.exports = { compile, resolve, count, fieldCatalogue, SCALAR, EXISTS_FIELDS };
