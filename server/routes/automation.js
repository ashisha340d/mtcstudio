const express = require('express');
const router  = express.Router();
const { dbAll, dbGet, dbRun } = require('../database/db');
const { evaluateRules, evalNode, conditionTypesMap } = require('../services/automationEngine');
const { pushCompiledRules } = require('../services/websiteSync');

const j = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
const parseRow = (row) => row && ({
    ...row,
    conditions: row.conditions ? JSON.parse(row.conditions) : null,
    actions: row.actions ? JSON.parse(row.actions) : null,
    schedule: row.schedule ? JSON.parse(row.schedule) : null,
    frequency_cap: row.frequency_cap ? JSON.parse(row.frequency_cap) : null,
});

// METADATA REGISTRY (condition/action types, category mapping)
router.get('/condition-types', async (req, res, next) => {
    try {
        const rows = await dbAll(`SELECT * FROM automation_condition_types WHERE is_active = 1 ORDER BY category, label`);
        res.json(rows.map(r => ({ ...r, value_schema: r.value_schema ? JSON.parse(r.value_schema) : null })));
    } catch (e) { next(e); }
});

router.get('/action-types', async (req, res, next) => {
    try {
        const rows = await dbAll(`SELECT * FROM automation_action_types WHERE is_active = 1 ORDER BY category, label`);
        res.json(rows.map(r => ({ ...r, value_schema: r.value_schema ? JSON.parse(r.value_schema) : null })));
    } catch (e) { next(e); }
});

router.get('/category-actions', async (req, res, next) => {
    try {
        const rows = await dbAll(`SELECT * FROM automation_category_actions ORDER BY category, action_key`);
        res.json(rows);
    } catch (e) { next(e); }
});

// SETTINGS (per-scope global cap / conflict strategy)
router.get('/settings', async (req, res, next) => {
    try {
        const rows = await dbAll(`SELECT * FROM automation_settings`);
        res.json(rows);
    } catch (e) { next(e); }
});

router.put('/settings/:scope', async (req, res, next) => {
    try {
        const { global_session_cap, conflict_strategy, stop_overrides_cap } = req.body;
        await dbRun(
            `UPDATE automation_settings SET global_session_cap=?, conflict_strategy=?, stop_overrides_cap=?
             WHERE scope=?`,
            [global_session_cap ?? 3, conflict_strategy || 'priority_then_score', stop_overrides_cap ? 1 : 0, req.params.scope]
        );
        res.json({ success: true });
    } catch (e) { next(e); }
});

// EVALUATE (live firing — frequency cap + conflict resolution, writes execution log)
router.post('/evaluate', async (req, res, next) => {
    try {
        const { scope, trigger_type, session_id, customer_id, context, score } = req.body;
        if (!scope || !trigger_type || !session_id) return res.status(400).json({ error: 'scope, trigger_type and session_id are required' });
        const result = await evaluateRules({ scope, triggerType: trigger_type, sessionId: session_id, customerId: customer_id || null, context: context || {}, score: score || 0 });
        res.json(result);
    } catch (e) { next(e); }
});

// TEST / SIMULATION (sandbox dry-run, spec sec 7 — no execution_log write, no customer impact)
router.post('/rules/:id/test', async (req, res, next) => {
    try {
        const rule = await dbGet(`SELECT * FROM automation_rules WHERE id=?`, [req.params.id]);
        if (!rule) return res.status(404).json({ error: 'Not found' });
        const sample = req.body.sample_payload || {};
        const conditions = rule.conditions ? JSON.parse(rule.conditions) : null;
        const typesByKey = await conditionTypesMap();
        const matched = evalNode(conditions, sample, typesByKey);
        const result = { matched, actions: matched ? (rule.actions ? JSON.parse(rule.actions) : []) : [] };
        await dbRun(
            `INSERT INTO automation_test_runs (rule_id, sample_payload, result) VALUES (?, ?, ?)`,
            [rule.id, JSON.stringify(sample), JSON.stringify(result)]
        );
        res.json(result);
    } catch (e) { next(e); }
});

router.get('/rules/:id/test-runs', async (req, res, next) => {
    try {
        const rows = await dbAll(`SELECT * FROM automation_test_runs WHERE rule_id=? ORDER BY created_at DESC LIMIT 50`, [req.params.id]);
        res.json(rows.map(r => ({ ...r, sample_payload: JSON.parse(r.sample_payload), result: JSON.parse(r.result) })));
    } catch (e) { next(e); }
});

// MANUAL SYNC — admin-triggered push to the website, full-replace per scope.
// Bypasses AUTOMATION_SYNC_ENABLED; still needs AUTOMATION_SYNC_URL configured.
router.post('/sync-now', async (req, res, next) => {
    try {
        const { scope, ruleIds } = req.body;
        if (!scope) return res.status(400).json({ error: 'scope is required' });
        const result = await pushCompiledRules(scope, { ruleIds: ruleIds || null, force: true });
        res.json({ success: true, result });
    } catch (e) { res.status(502).json({ error: e.message }); }
});

// COMPILED (public read — what the website/POS/kiosk consumes; publish output only, no admin fields)
router.get('/compiled', async (req, res, next) => {
    try {
        const { scope } = req.query;
        if (!scope) return res.status(400).json({ error: 'scope is required' });
        const rows = await dbAll(
            `SELECT id, name, priority, trigger_type, conditions, actions, schedule, frequency_cap, stop_processing
             FROM automation_rules WHERE scope=? AND status='published' ORDER BY priority DESC`,
            [scope]
        );
        const settings = await dbGet(`SELECT global_session_cap, conflict_strategy, stop_overrides_cap FROM automation_settings WHERE scope=?`, [scope]);
        res.json({
            scope,
            settings,
            rules: rows.map(parseRow),
        });
    } catch (e) { next(e); }
});

// RULES CRUD
router.get('/rules', async (req, res, next) => {
    try {
        const { scope, status } = req.query;
        const rows = await dbAll(
            `SELECT * FROM automation_rules
             WHERE (? IS NULL OR scope = ?) AND (? IS NULL OR status = ?)
             ORDER BY priority DESC, updated_at DESC`,
            [scope || null, scope || null, status || null, status || null]
        );
        res.json(rows.map(parseRow));
    } catch (e) { next(e); }
});

router.get('/rules/:id', async (req, res, next) => {
    try {
        const row = await dbGet(`SELECT * FROM automation_rules WHERE id = ?`, [req.params.id]);
        if (!row) return res.status(404).json({ error: 'Not found' });
        res.json(parseRow(row));
    } catch (e) { next(e); }
});

router.post('/rules', async (req, res, next) => {
    try {
        const { name, description, priority, scope, trigger_type, conditions, actions, schedule, frequency_cap, stop_processing } = req.body;
        if (!name || !scope || !trigger_type) return res.status(400).json({ error: 'name, scope and trigger_type are required' });
        const result = await dbRun(
            `INSERT INTO automation_rules (name, description, priority, status, scope, trigger_type, conditions, actions, schedule, frequency_cap, stop_processing)
             VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
            [name, description || null, priority ?? 50, scope, trigger_type, j(conditions), j(actions), j(schedule), j(frequency_cap), stop_processing ? 1 : 0]
        );
        res.json({ success: true, id: result.insertId });
    } catch (e) { next(e); }
});

router.put('/rules/:id', async (req, res, next) => {
    try {
        const { name, description, priority, scope, trigger_type, conditions, actions, schedule, frequency_cap, stop_processing } = req.body;
        if (!name || !scope || !trigger_type) return res.status(400).json({ error: 'name, scope and trigger_type are required' });
        await dbRun(
            `UPDATE automation_rules SET name=?, description=?, priority=?, scope=?, trigger_type=?,
             conditions=?, actions=?, schedule=?, frequency_cap=?, stop_processing=?, version=version+1
             WHERE id=?`,
            [name, description || null, priority ?? 50, scope, trigger_type, j(conditions), j(actions), j(schedule), j(frequency_cap), stop_processing ? 1 : 0, req.params.id]
        );
        res.json({ success: true });
    } catch (e) { next(e); }
});

// PUBLISH: snapshot current row into automation_rule_versions, flip status
router.post('/rules/:id/publish', async (req, res, next) => {
    try {
        const row = await dbGet(`SELECT * FROM automation_rules WHERE id = ?`, [req.params.id]);
        if (!row) return res.status(404).json({ error: 'Not found' });
        await dbRun(
            `INSERT INTO automation_rule_versions (rule_id, version, snapshot, published_by) VALUES (?, ?, ?, ?)`,
            [row.id, row.version, JSON.stringify(row), req.body.published_by || null]
        );
        await dbRun(`UPDATE automation_rules SET status='published' WHERE id=?`, [row.id]);
        pushCompiledRules(row.scope).catch(e => console.error('[automation] website sync failed:', e.message));
        res.json({ success: true });
    } catch (e) { next(e); }
});

router.get('/rules/:id/versions', async (req, res, next) => {
    try {
        const rows = await dbAll(`SELECT id, version, published_by, created_at FROM automation_rule_versions WHERE rule_id=? ORDER BY version DESC`, [req.params.id]);
        res.json(rows);
    } catch (e) { next(e); }
});

// ROLLBACK: restore rule fields from a prior version snapshot
router.post('/rules/:id/rollback/:versionRowId', async (req, res, next) => {
    try {
        const ver = await dbGet(`SELECT * FROM automation_rule_versions WHERE id=? AND rule_id=?`, [req.params.versionRowId, req.params.id]);
        if (!ver) return res.status(404).json({ error: 'Version not found' });
        const snap = JSON.parse(ver.snapshot);
        await dbRun(
            `UPDATE automation_rules SET name=?, description=?, priority=?, scope=?, trigger_type=?,
             conditions=?, actions=?, schedule=?, frequency_cap=?, stop_processing=?, status='draft', version=version+1
             WHERE id=?`,
            [snap.name, snap.description, snap.priority, snap.scope, snap.trigger_type,
             snap.conditions, snap.actions, snap.schedule, snap.frequency_cap, snap.stop_processing, req.params.id]
        );
        pushCompiledRules(snap.scope).catch(e => console.error('[automation] website sync failed:', e.message));
        res.json({ success: true });
    } catch (e) { next(e); }
});

router.delete('/rules/:id', async (req, res, next) => {
    try {
        const row = await dbGet(`SELECT scope FROM automation_rules WHERE id=?`, [req.params.id]);
        await dbRun(`UPDATE automation_rules SET status='disabled' WHERE id=?`, [req.params.id]);
        if (row) pushCompiledRules(row.scope).catch(e => console.error('[automation] website sync failed:', e.message));
        res.json({ success: true });
    } catch (e) { next(e); }
});

router.delete('/rules/:id/purge', async (req, res, next) => {
    try {
        const row = await dbGet(`SELECT scope FROM automation_rules WHERE id=?`, [req.params.id]);
        await dbRun(`DELETE FROM automation_rule_versions WHERE rule_id=?`, [req.params.id]);
        await dbRun(`DELETE FROM automation_rules WHERE id=?`, [req.params.id]);
        if (row) pushCompiledRules(row.scope).catch(e => console.error('[automation] website sync failed:', e.message));
        res.json({ success: true });
    } catch (e) { next(e); }
});

module.exports = router;
