const { dbAll, dbGet, dbRun } = require('../database/db');

// --- condition evaluation ---
function evalLeaf(node, ctx, typesByKey) {
    const type = typesByKey[node.type];
    if (!type) return false;
    const schema = type.value_schema || {};
    const field = schema.field;
    const actual = ctx[field];
    const val = node.value;
    switch (schema.op) {
        case 'eq': return actual == val;
        case 'in': return Array.isArray(val) && val.includes(actual);
        case 'contains': return Array.isArray(actual) ? actual.includes(val) : String(actual || '').includes(val);
        case 'gte': return Number(actual) >= Number(val);
        case 'lte': return Number(actual) <= Number(val);
        case 'gt': return Number(actual) > Number(val);
        case 'lt': return Number(actual) < Number(val);
        case 'between': return Array.isArray(val) && Number(actual) >= Number(val[0]) && Number(actual) <= Number(val[1]);
        default: return false;
    }
}

function evalNode(node, ctx, typesByKey) {
    if (!node) return true;
    if (node.and) return node.and.every(n => evalNode(n, ctx, typesByKey));
    if (node.or) return node.or.some(n => evalNode(n, ctx, typesByKey));
    return evalLeaf(node, ctx, typesByKey);
}

async function conditionTypesMap() {
    const rows = await dbAll(`SELECT * FROM automation_condition_types`);
    const map = {};
    for (const r of rows) map[r.key] = { ...r, value_schema: r.value_schema ? JSON.parse(r.value_schema) : null };
    return map;
}

// --- frequency cap checks (rule-level) ---
async function ruleCapOk(rule, cap, sessionId, customerId) {
    if (cap.max_shows_per_session) {
        const c = await dbGet(
            `SELECT COUNT(*) as n FROM automation_execution_log WHERE rule_id=? AND session_id=? AND fired=1`,
            [rule.id, sessionId]
        );
        if (c.n >= cap.max_shows_per_session) return false;
    }
    if (customerId && cap.max_shows_per_customer_per_day) {
        const c = await dbGet(
            `SELECT COUNT(*) as n FROM automation_execution_log
             WHERE rule_id=? AND customer_id=? AND fired=1 AND DATE(created_at)=CURDATE()`,
            [rule.id, customerId]
        );
        if (c.n >= cap.max_shows_per_customer_per_day) return false;
    }
    if (customerId && cap.max_shows_per_customer_lifetime) {
        const c = await dbGet(
            `SELECT COUNT(*) as n FROM automation_execution_log WHERE rule_id=? AND customer_id=? AND fired=1`,
            [rule.id, customerId]
        );
        if (c.n >= cap.max_shows_per_customer_lifetime) return false;
    }
    if (cap.cooldown_hours) {
        const last = await dbGet(
            `SELECT created_at FROM automation_execution_log
             WHERE rule_id=? AND (session_id=? OR customer_id=?) AND fired=1
             ORDER BY created_at DESC LIMIT 1`,
            [rule.id, sessionId, customerId || null]
        );
        if (last && (Date.now() - new Date(last.created_at).getTime()) < cap.cooldown_hours * 3600000) return false;
    }
    return true;
}

/**
 * Evaluate rules for a trigger. Applies frequency cap (rule + global per-channel)
 * and conflict resolution per spec sec 3/4: priority desc, score tiebreak,
 * stop_processing overrides global cap and halts lower-priority evaluation.
 */
async function evaluateRules({ scope, triggerType, sessionId, customerId, context = {}, score = 0 }) {
    const settings = await dbGet(`SELECT * FROM automation_settings WHERE scope=?`, [scope]);
    const globalCap = settings ? settings.global_session_cap : 3;
    const stopOverridesCap = settings ? !!settings.stop_overrides_cap : true;

    const rules = await dbAll(
        `SELECT * FROM automation_rules WHERE scope=? AND status='published' AND trigger_type=?
         ORDER BY priority DESC, id ASC`,
        [scope, triggerType]
    );
    const typesByKey = await conditionTypesMap();

    const alreadyFired = await dbGet(
        `SELECT COUNT(*) as n FROM automation_execution_log WHERE scope=? AND session_id=? AND fired=1`,
        [scope, sessionId]
    );
    let slots = globalCap - (alreadyFired ? alreadyFired.n : 0);

    const fired = [];
    const suppressed = [];

    for (const rule of rules) {
        const conditions = rule.conditions ? JSON.parse(rule.conditions) : null;
        if (!evalNode(conditions, context, typesByKey)) continue;

        const cap = rule.frequency_cap ? JSON.parse(rule.frequency_cap) : {};
        const capOk = await ruleCapOk(rule, cap, sessionId, customerId);
        if (!capOk) {
            suppressed.push(rule.id);
            continue;
        }

        const canFire = rule.stop_processing && stopOverridesCap ? true : slots > 0;
        if (!canFire) {
            suppressed.push(rule.id);
            await logExecution(rule, scope, sessionId, customerId, 0);
            continue;
        }

        fired.push({ rule_id: rule.id, actions: rule.actions ? JSON.parse(rule.actions) : [], priority: rule.priority, score });
        await logExecution(rule, scope, sessionId, customerId, 1);
        slots -= 1;

        if (rule.stop_processing) break;
    }

    return { fired, suppressed };
}

async function logExecution(rule, scope, sessionId, customerId, firedFlag) {
    const actionKey = rule.actions ? (JSON.parse(rule.actions)[0] || {}).type || null : null;
    await dbRun(
        `INSERT INTO automation_execution_log (rule_id, scope, session_id, customer_id, action_key, fired)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [rule.id, scope, sessionId, customerId || null, actionKey, firedFlag]
    );
}

module.exports = { evaluateRules, evalNode, conditionTypesMap };
