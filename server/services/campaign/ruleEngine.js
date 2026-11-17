'use strict';
/**
 * Reusable rule engine — nested AND / OR / NOT of unlimited depth.
 *
 * A rule node is one of:
 *   { and: [ node, ... ] }
 *   { or:  [ node, ... ] }
 *   { not: node }
 *   { field, op, value }        (a leaf comparison against the context object)
 *
 * Operators live in a registry, so a new operator (or a whole new rule family)
 * is a one-line `registerOperator` call — never a change to the traversal.
 * The same engine powers campaign per-recipient conditions and, via
 * audienceBuilder, the SQL compilation of audience filters.
 */

const OPERATORS = {
    eq:        (a, b) => a == b,                                   // loose on purpose (string/number from JSON)
    neq:       (a, b) => a != b,
    gt:        (a, b) => Number(a) > Number(b),
    gte:       (a, b) => Number(a) >= Number(b),
    lt:        (a, b) => Number(a) < Number(b),
    lte:       (a, b) => Number(a) <= Number(b),
    between:   (a, b) => Array.isArray(b) && Number(a) >= Number(b[0]) && Number(a) <= Number(b[1]),
    in:        (a, b) => Array.isArray(b) && b.map(String).includes(String(a)),
    not_in:    (a, b) => Array.isArray(b) && !b.map(String).includes(String(a)),
    contains:  (a, b) => Array.isArray(a)
                            ? a.map(String).includes(String(b))
                            : String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase()),
    not_contains: (a, b) => !OPERATORS.contains(a, b),
    starts_with: (a, b) => String(a ?? '').toLowerCase().startsWith(String(b ?? '').toLowerCase()),
    ends_with:   (a, b) => String(a ?? '').toLowerCase().endsWith(String(b ?? '').toLowerCase()),
    exists:    (a) => a !== undefined && a !== null && a !== '',
    not_exists:(a) => a === undefined || a === null || a === '',
    is_true:   (a) => a === true || a === 1 || a === '1' || a === 'true',
    is_false:  (a) => a === false || a === 0 || a === '0' || a === 'false' || a === null || a === undefined,
};

function registerOperator(name, fn) {
    OPERATORS[name] = fn;
}

function evalLeaf(node, ctx) {
    const op = OPERATORS[node.op];
    if (!op) return false;
    return !!op(ctx[node.field], node.value, ctx);
}

/** Evaluate a rule tree against a context object. Empty/absent tree matches all. */
function evaluate(node, ctx = {}) {
    if (node === undefined || node === null) return true;
    if (Array.isArray(node)) return node.every(n => evaluate(n, ctx));   // bare array => AND
    if (typeof node !== 'object') return true;

    if (Array.isArray(node.and)) return node.and.every(n => evaluate(n, ctx));
    if (Array.isArray(node.or))  return node.or.some(n => evaluate(n, ctx));
    if (node.not !== undefined)  return !evaluate(node.not, ctx);
    if ('field' in node && 'op' in node) return evalLeaf(node, ctx);

    // An object with only nested groups but no combinator — treat as AND of values.
    const parts = Object.values(node).filter(v => v && typeof v === 'object');
    if (parts.length) return parts.every(n => evaluate(n, ctx));
    return true;
}

/** Flatten every leaf `field` referenced in a tree (used for validation/UX). */
function fields(node, acc = new Set()) {
    if (!node || typeof node !== 'object') return acc;
    if (Array.isArray(node)) { node.forEach(n => fields(n, acc)); return acc; }
    if (Array.isArray(node.and)) node.and.forEach(n => fields(n, acc));
    if (Array.isArray(node.or))  node.or.forEach(n => fields(n, acc));
    if (node.not) fields(node.not, acc);
    if (node.field) acc.add(node.field);
    return acc;
}

module.exports = { evaluate, fields, registerOperator, OPERATORS };
