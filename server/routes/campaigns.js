'use strict';
/**
 * Campaign Management REST API. Follows the project's route conventions:
 * thin handlers over the campaign services, dbAll/dbGet/dbRun for simple CRUD,
 * next(e) error propagation to the shared errorHandler.
 *
 * Permissions integrate with the existing POS auth via middleware/campaignAuth.
 */
const express = require('express');
const router  = express.Router();
const { dbAll, dbGet, dbRun } = require('../database/db');
const { requirePermission, attachUser } = require('../middleware/campaignAuth');

const engine    = require('../services/campaign/campaignEngine');
const audience  = require('../services/campaign/audienceBuilder');
const coupons   = require('../services/campaign/couponEngine');
const template  = require('../services/campaign/templateEngine');
const queue     = require('../services/campaign/queueProcessor');
const scheduler = require('../services/campaign/scheduler');
const trigger   = require('../services/campaign/triggerEngine');
const analytics = require('../services/campaign/analytics');

const j = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
const parse = (v, d = null) => { try { return v == null ? d : (typeof v === 'string' ? JSON.parse(v) : v); } catch { return d; } };

const CAMPAIGN_JSON = ['audience','trigger_config','conditions','actions','rewards','channels','schedule','config','branch_restrictions'];
const hydrateCampaign = (row) => {
    if (!row) return row;
    const out = { ...row };
    for (const k of CAMPAIGN_JSON) out[k] = parse(row[k], null);
    return out;
};

router.use(attachUser);

/* ════════════════ METADATA / REGISTRY ════════════════ */
router.get('/types', async (req, res, next) => {
    try {
        const rows = await dbAll(
            `SELECT * FROM campaign_types WHERE (? = '1' OR is_active=1) ORDER BY sort_order, label`,
            [req.query.all === '1' ? '1' : '0']);
        res.json(rows.map(r => ({
            ...r,
            default_trigger: parse(r.default_trigger, {}),
            default_channels: parse(r.default_channels, []),
            default_audience: parse(r.default_audience, {}),
            default_config: parse(r.default_config, {}),
        })));
    } catch (e) { next(e); }
});

router.post('/types', requirePermission('manage_settings'), async (req, res, next) => {
    try {
        const { key, label, category, description, icon, default_trigger, default_channels, default_audience, default_config } = req.body;
        if (!key || !label) return res.status(400).json({ error: 'key and label are required' });
        const r = await dbRun(
            'INSERT INTO campaign_types (`key`,label,category,description,icon,default_trigger,default_channels,default_audience,default_config,is_system) VALUES (?,?,?,?,?,?,?,?,?,0)',
            [key, label, category || 'general', description || null, icon || null,
             j(default_trigger), j(default_channels), j(default_audience), j(default_config)]);
        res.json({ success: true, id: r.insertId });
    } catch (e) { next(e); }
});

router.put('/types/:id', requirePermission('manage_settings'), async (req, res, next) => {
    try {
        const { label, category, description, icon, default_trigger, default_channels, default_audience, default_config, is_active } = req.body;
        await dbRun(
            `UPDATE campaign_types SET label=?, category=?, description=?, icon=?, default_trigger=?, default_channels=?,
             default_audience=?, default_config=?, is_active=? WHERE id=?`,
            [label, category || 'general', description || null, icon || null,
             j(default_trigger), j(default_channels), j(default_audience), j(default_config),
             is_active ? 1 : 0, req.params.id]);
        res.json({ success: true });
    } catch (e) { next(e); }
});

router.delete('/types/:id', requirePermission('manage_settings'), async (req, res, next) => {
    try { await dbRun(`UPDATE campaign_types SET is_active=0 WHERE id=? AND is_system=0`, [req.params.id]); res.json({ success: true }); }
    catch (e) { next(e); }
});

router.get('/channels', async (req, res, next) => {
    try {
        const rows = await dbAll(`SELECT * FROM campaign_channels ORDER BY sort_order, label`);
        res.json(rows.map(r => ({ ...r, config: parse(r.config, {}) })));
    } catch (e) { next(e); }
});

router.put('/channels/:key', requirePermission('manage_settings'), async (req, res, next) => {
    try {
        const { is_enabled, config, label, provider } = req.body;
        await dbRun(
            `UPDATE campaign_channels SET is_enabled=?, config=COALESCE(?,config),
             label=COALESCE(?,label), provider=COALESCE(?,provider) WHERE \`key\`=?`,
            [is_enabled ? 1 : 0, config !== undefined ? j(config) : null, label || null, provider || null, req.params.key]);
        res.json({ success: true });
    } catch (e) { next(e); }
});

router.get('/permissions', async (req, res, next) => {
    try {
        const rows = await dbAll(`SELECT role, permission FROM campaign_role_permissions ORDER BY role, permission`);
        const map = {};
        for (const r of rows) (map[r.role] ||= []).push(r.permission);
        res.json({ roles: map, me: { role: req.campaignUser.role, permissions: map[req.campaignUser.role] || [] } });
    } catch (e) { next(e); }
});

router.get('/audience-fields', (req, res) => res.json(audience.fieldCatalogue()));

/* ════════════════ DASHBOARD / ANALYTICS ════════════════ */
router.get('/dashboard', async (req, res, next) => {
    try {
        const [overview, leaderboard, growth] = await Promise.all([
            analytics.overview({}),
            analytics.leaderboard(8),
            analytics.customerGrowth(12),
        ]);
        res.json({ overview, leaderboard, growth });
    } catch (e) { next(e); }
});

router.get('/analytics/overview', async (req, res, next) => {
    try { res.json(await analytics.overview({ from: req.query.from, to: req.query.to })); } catch (e) { next(e); }
});
router.get('/analytics/leaderboard', async (req, res, next) => {
    try { res.json(await analytics.leaderboard(req.query.limit)); } catch (e) { next(e); }
});
router.get('/analytics/customer-growth', async (req, res, next) => {
    try { res.json(await analytics.customerGrowth(req.query.months)); } catch (e) { next(e); }
});
router.get('/analytics/revenue-timeline', async (req, res, next) => {
    try { res.json(await analytics.revenueTimeline(req.query.campaign_id || null, req.query.days)); } catch (e) { next(e); }
});

/* ════════════════ TEMPLATES ════════════════ */
router.get('/templates', async (req, res, next) => {
    try {
        const { channel, type_key } = req.query;
        const rows = await dbAll(
            `SELECT * FROM campaign_templates
             WHERE (? IS NULL OR channel=?) AND (? IS NULL OR type_key=?)
             ORDER BY name`,
            [channel || null, channel || null, type_key || null, type_key || null]);
        res.json(rows.map(r => ({ ...r, variables: parse(r.variables, []) })));
    } catch (e) { next(e); }
});
router.post('/templates', requirePermission('edit'), async (req, res, next) => {
    try {
        const { name, channel, type_key, subject, body, variables } = req.body;
        if (!name || !channel || !body) return res.status(400).json({ error: 'name, channel and body are required' });
        const r = await dbRun(
            `INSERT INTO campaign_templates (name,channel,type_key,subject,body,variables,created_by) VALUES (?,?,?,?,?,?,?)`,
            [name, channel, type_key || null, subject || null, body, j(variables), req.campaignUser.id]);
        res.json({ success: true, id: r.insertId });
    } catch (e) { next(e); }
});
router.put('/templates/:id', requirePermission('edit'), async (req, res, next) => {
    try {
        const { name, channel, type_key, subject, body, variables, is_active } = req.body;
        await dbRun(
            `UPDATE campaign_templates SET name=?,channel=?,type_key=?,subject=?,body=?,variables=?,is_active=? WHERE id=?`,
            [name, channel, type_key || null, subject || null, body, j(variables), is_active ? 1 : 0, req.params.id]);
        res.json({ success: true });
    } catch (e) { next(e); }
});
router.delete('/templates/:id', requirePermission('edit'), async (req, res, next) => {
    try { await dbRun(`DELETE FROM campaign_templates WHERE id=?`, [req.params.id]); res.json({ success: true }); }
    catch (e) { next(e); }
});
router.post('/templates/render', async (req, res, next) => {
    try {
        const { body, subject, context } = req.body;
        res.json({ subject: template.render(subject, context || {}), body: template.render(body, context || {}) });
    } catch (e) { next(e); }
});

/* ════════════════ AUDIENCES (saved segments) ════════════════ */
router.get('/audiences', async (req, res, next) => {
    try {
        const rows = await dbAll(`SELECT * FROM campaign_audiences ORDER BY name`);
        res.json(rows.map(r => ({ ...r, rules: parse(r.rules, null) })));
    } catch (e) { next(e); }
});
router.post('/audiences', requirePermission('create'), async (req, res, next) => {
    try {
        const { name, description, rules } = req.body;
        if (!name) return res.status(400).json({ error: 'name is required' });
        const r = await dbRun(
            `INSERT INTO campaign_audiences (name,description,rules,created_by) VALUES (?,?,?,?)`,
            [name, description || null, j(rules), req.campaignUser.id]);
        res.json({ success: true, id: r.insertId });
    } catch (e) { next(e); }
});
router.put('/audiences/:id', requirePermission('edit'), async (req, res, next) => {
    try {
        const { name, description, rules, is_active } = req.body;
        await dbRun(`UPDATE campaign_audiences SET name=?,description=?,rules=?,is_active=? WHERE id=?`,
            [name, description || null, j(rules), is_active ? 1 : 0, req.params.id]);
        res.json({ success: true });
    } catch (e) { next(e); }
});
router.delete('/audiences/:id', requirePermission('delete'), async (req, res, next) => {
    try { await dbRun(`DELETE FROM campaign_audiences WHERE id=?`, [req.params.id]); res.json({ success: true }); }
    catch (e) { next(e); }
});
router.post('/audiences/preview', async (req, res, next) => {
    try {
        const rules = req.body.rules ?? null;
        const status = req.body.status || 'active';
        const [total, sample] = await Promise.all([
            audience.count(rules, { status }),
            audience.resolve(rules, { status, limit: 25 }),
        ]);
        res.json({ total, sample });
    } catch (e) { next(e); }
});
router.post('/audiences/count', async (req, res, next) => {
    try { res.json({ total: await audience.count(req.body.rules ?? null, { status: req.body.status || 'active' }) }); }
    catch (e) { next(e); }
});

/* ════════════════ COUPONS ════════════════ */
router.get('/coupons', async (req, res, next) => {
    try {
        const rows = await coupons.listCoupons(req.query.campaign_id || null);
        res.json(rows.map(r => ({ ...r, branch_restrictions: parse(r.branch_restrictions, null), config: parse(r.config, null) })));
    } catch (e) { next(e); }
});
router.post('/coupons', requirePermission('manage_coupons'), async (req, res, next) => {
    try {
        if (!req.body.name) return res.status(400).json({ error: 'name is required' });
        const id = await coupons.createCoupon(req.body);
        res.json({ success: true, id });
    } catch (e) { next(e); }
});
router.put('/coupons/:id', requirePermission('manage_coupons'), async (req, res, next) => {
    try {
        const b = req.body;
        await dbRun(
            `UPDATE campaign_coupons SET name=?,code=?,code_prefix=?,discount_type=?,value=?,free_product_id=?,
             max_discount=?,min_order_amount=?,unique_per_customer=?,usage_limit_total=?,usage_limit_per_customer=?,
             per_campaign_limit=?,branch_restrictions=?,valid_from=?,valid_until=?,config=?,status=? WHERE id=?`,
            [b.name, b.code || null, b.code_prefix || null, b.discount_type || 'percentage', b.value || 0,
             b.free_product_id || null, b.max_discount ?? null, b.min_order_amount || 0, b.unique_per_customer ? 1 : 0,
             b.usage_limit_total ?? null, b.usage_limit_per_customer ?? 1, b.per_campaign_limit ?? null,
             j(b.branch_restrictions), b.valid_from || null, b.valid_until || null, j(b.config), b.status || 'active',
             req.params.id]);
        res.json({ success: true });
    } catch (e) { next(e); }
});
router.delete('/coupons/:id', requirePermission('manage_coupons'), async (req, res, next) => {
    try { await dbRun(`UPDATE campaign_coupons SET status='disabled' WHERE id=?`, [req.params.id]); res.json({ success: true }); }
    catch (e) { next(e); }
});
router.get('/coupons/:id/codes', async (req, res, next) => {
    try { res.json(await dbAll(`SELECT * FROM campaign_coupon_codes WHERE coupon_id=? ORDER BY id DESC LIMIT 500`, [req.params.id])); }
    catch (e) { next(e); }
});
router.post('/coupons/:id/issue', requirePermission('manage_coupons'), async (req, res, next) => {
    try {
        const code = await coupons.issueCode(req.params.id, {
            customerPhone: req.body.customer_phone || null, campaignId: req.body.campaign_id || null });
        res.json({ success: true, code });
    } catch (e) { next(e); }
});
router.post('/coupons/validate', async (req, res, next) => {
    try {
        const { code, order_amount, customer_phone, branch } = req.body;
        res.json(await coupons.validate(code, { orderAmount: Number(order_amount) || 0, customerPhone: customer_phone || null, branch: branch || null }));
    } catch (e) { next(e); }
});
router.post('/coupons/redeem', requirePermission('execute'), async (req, res, next) => {
    try {
        const { code, order_amount, customer_phone, order_id, branch } = req.body;
        res.json(await coupons.redeem(code, {
            orderAmount: Number(order_amount) || 0, customerPhone: customer_phone || null,
            orderId: order_id || null, branch: branch || null }));
    } catch (e) { next(e); }
});

/* ════════════════ QUEUE ════════════════ */
router.get('/queue', async (req, res, next) => {
    try {
        const { campaign_id, run_id, status, channel } = req.query;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const where = [], p = [];
        if (campaign_id) { where.push('campaign_id=?'); p.push(campaign_id); }
        if (run_id)      { where.push('run_id=?'); p.push(run_id); }
        if (status)      { where.push('status=?'); p.push(status); }
        if (channel)     { where.push('channel=?'); p.push(channel); }
        const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
        const total = await dbGet(`SELECT COUNT(*) AS n FROM campaign_queue ${w}`, p);
        const rows = await dbAll(
            `SELECT * FROM campaign_queue ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, [...p, limit, (page - 1) * limit]);
        // Per-status counts scoped by every filter except status, so the queue
        // status tabs show live totals regardless of which tab is selected.
        const cWhere = [], cp = [];
        if (campaign_id) { cWhere.push('campaign_id=?'); cp.push(campaign_id); }
        if (run_id)      { cWhere.push('run_id=?'); cp.push(run_id); }
        if (channel)     { cWhere.push('channel=?'); cp.push(channel); }
        const cw = cWhere.length ? 'WHERE ' + cWhere.join(' AND ') : '';
        const countRows = await dbAll(`SELECT status, COUNT(*) AS n FROM campaign_queue ${cw} GROUP BY status`, cp);
        const counts = countRows.reduce((a, r) => (a[r.status] = Number(r.n), a), {});
        res.json({ rows, total: total.n, page, limit, counts });
    } catch (e) { next(e); }
});

// Resolve the target queue ids for a bulk request: an explicit id list, or
// (when `all`) every row matching the queue filter (status/campaign/run/channel)
// — shared by /queue/bulk and /queue/delete so "select all in tab" works for both.
async function resolveQueueIds({ ids, all, filter }) {
    if (!all) return Array.isArray(ids) ? ids : [];
    const f = filter || {};
    const where = [], p = [];
    if (f.status)      { where.push('status=?'); p.push(f.status); }
    if (f.campaign_id) { where.push('campaign_id=?'); p.push(f.campaign_id); }
    if (f.run_id)      { where.push('run_id=?'); p.push(f.run_id); }
    if (f.channel)     { where.push('channel=?'); p.push(f.channel); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await dbAll(`SELECT id FROM campaign_queue ${w}`, p);
    return rows.map((r) => r.id);
}

const queueAction = (fn, perm) => [requirePermission(perm), async (req, res, next) => {
    try { res.json(await fn(req.body.ids)); } catch (e) { next(e); }
}];
router.post('/queue/approve', ...queueAction(queue.approve, 'approve'));
router.post('/queue/reject',  ...queueAction(queue.reject, 'approve'));
router.post('/queue/pause',   ...queueAction(queue.pause, 'execute'));
router.post('/queue/resume',  ...queueAction(queue.resume, 'execute'));
router.post('/queue/cancel',  ...queueAction(queue.cancel, 'execute'));
router.post('/queue/retry',   ...queueAction(queue.retry, 'execute'));

// Edit a queued message's subject/body before it sends (blocked mid-send).
router.put('/queue/:id', requirePermission('edit'), async (req, res, next) => {
    try {
        const { subject, message } = req.body;
        if (!message) return res.status(400).json({ error: 'message is required' });
        const out = await queue.updateMessage(req.params.id, { subject, message });
        if (!out.changed) return res.status(409).json({ error: 'Row is mid-send or not found' });
        res.json({ success: true });
    } catch (e) { next(e); }
});

// Permanent bulk removal — separate from /queue/bulk's reversible status
// transitions and gated on 'delete' (not 'execute'), matching campaign delete.
router.post('/queue/delete', requirePermission('delete'), async (req, res, next) => {
    try {
        const targetIds = await resolveQueueIds(req.body);
        if (!targetIds.length) return res.json({ affected: 0 });
        const out = await queue.hardDelete(targetIds);
        res.json({ affected: out.changed });
    } catch (e) { next(e); }
});

router.post('/queue/bulk', requirePermission('execute'), async (req, res, next) => {
    try {
        const { action } = req.body;
        const map = { approve: queue.approve, reject: queue.reject, pause: queue.pause, resume: queue.resume, cancel: queue.cancel, retry: queue.retry };
        if (!map[action]) return res.status(400).json({ error: 'unknown action' });
        const targetIds = await resolveQueueIds(req.body);
        if (!targetIds.length) return res.json({ affected: 0 });
        res.json(await map[action](targetIds));
    } catch (e) { next(e); }
});

/* ════════════════ RUNS / HISTORY ════════════════ */
router.get('/runs', async (req, res, next) => {
    try {
        const rows = await dbAll(
            `SELECT r.*, c.name AS campaign_name, c.type_key
             FROM campaign_runs r JOIN campaigns c ON c.id=r.campaign_id
             ${req.query.campaign_id ? 'WHERE r.campaign_id=?' : ''}
             ORDER BY r.id DESC LIMIT 200`,
            req.query.campaign_id ? [req.query.campaign_id] : []);
        res.json(rows.map(r => ({ ...r, meta: parse(r.meta, null) })));
    } catch (e) { next(e); }
});
router.get('/runs/:runId/queue', async (req, res, next) => {
    try { res.json(await dbAll(`SELECT * FROM campaign_queue WHERE run_id=? ORDER BY id DESC`, [req.params.runId])); }
    catch (e) { next(e); }
});
router.post('/runs/:runId/approve', requirePermission('approve'), async (req, res, next) => {
    try { await queue.approveRun(req.params.runId); res.json({ success: true }); } catch (e) { next(e); }
});
router.post('/runs/:runId/reject', requirePermission('approve'), async (req, res, next) => {
    try { await queue.rejectRun(req.params.runId); res.json({ success: true }); } catch (e) { next(e); }
});

/* ════════════════ TRIGGERS ════════════════ */
router.post('/events', requirePermission('execute'), async (req, res, next) => {
    try {
        const { event_type, customer_phone, payload } = req.body;
        if (!event_type) return res.status(400).json({ error: 'event_type is required' });
        res.json(await trigger.emitEvent(event_type, { customer_phone, payload, source: 'api', createdBy: req.campaignUser.id }));
    } catch (e) { next(e); }
});
// External webhook ingress — records the event; the scheduler drains it.
router.post('/webhook/:eventType', async (req, res, next) => {
    try {
        const out = await trigger.emitEvent(req.params.eventType, {
            customer_phone: req.body.customer_phone || req.query.customer_phone || null,
            payload: req.body, source: 'webhook' });
        res.json({ success: true, ...out });
    } catch (e) { next(e); }
});

/* ════════════════ CAMPAIGN CRUD ════════════════ */
router.get('/', async (req, res, next) => {
    try {
        const { status, type_key } = req.query;
        const rows = await dbAll(
            `SELECT c.*, t.label AS type_label, t.icon AS type_icon
             FROM campaigns c LEFT JOIN campaign_types t ON t.\`key\`=c.type_key
             WHERE (? IS NULL OR c.status=?) AND (? IS NULL OR c.type_key=?)
             ORDER BY c.updated_at DESC`,
            [status || null, status || null, type_key || null, type_key || null]);
        res.json(rows.map(hydrateCampaign));
    } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
    try {
        const row = await dbGet(`SELECT * FROM campaigns WHERE id=?`, [req.params.id]);
        if (!row) return res.status(404).json({ error: 'Not found' });
        res.json(hydrateCampaign(row));
    } catch (e) { next(e); }
});

router.post('/', requirePermission('create'), async (req, res, next) => {
    try {
        const b = req.body;
        if (!b.name || !b.type_key) return res.status(400).json({ error: 'name and type_key are required' });
        const r = await dbRun(
            `INSERT INTO campaigns
               (name,description,type_key,priority,audience_id,audience,trigger_config,conditions,actions,
                rewards,channels,schedule,config,approval_required,branch_restrictions,created_by,status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft')`,
            [b.name, b.description || null, b.type_key, b.priority ?? 50, b.audience_id || null,
             j(b.audience), j(b.trigger_config), j(b.conditions), j(b.actions), j(b.rewards),
             j(b.channels), j(b.schedule), j(b.config), b.approval_required ? 1 : 0,
             j(b.branch_restrictions), req.campaignUser.id]);
        res.json({ success: true, id: r.insertId });
    } catch (e) { next(e); }
});

router.put('/:id', requirePermission('edit'), async (req, res, next) => {
    try {
        const b = req.body;
        if (!b.name || !b.type_key) return res.status(400).json({ error: 'name and type_key are required' });
        await dbRun(
            `UPDATE campaigns SET name=?,description=?,type_key=?,priority=?,audience_id=?,audience=?,trigger_config=?,
             conditions=?,actions=?,rewards=?,channels=?,schedule=?,config=?,approval_required=?,branch_restrictions=?,
             version=version+1 WHERE id=?`,
            [b.name, b.description || null, b.type_key, b.priority ?? 50, b.audience_id || null,
             j(b.audience), j(b.trigger_config), j(b.conditions), j(b.actions), j(b.rewards),
             j(b.channels), j(b.schedule), j(b.config), b.approval_required ? 1 : 0,
             j(b.branch_restrictions), req.params.id]);
        await scheduler.reschedule(req.params.id);
        res.json({ success: true });
    } catch (e) { next(e); }
});

router.delete('/:id', requirePermission('delete'), async (req, res, next) => {
    try { await dbRun(`UPDATE campaigns SET status='archived', next_run_at=NULL WHERE id=?`, [req.params.id]); res.json({ success: true }); }
    catch (e) { next(e); }
});

router.post('/:id/duplicate', requirePermission('create'), async (req, res, next) => {
    try {
        const c = await dbGet(`SELECT * FROM campaigns WHERE id=?`, [req.params.id]);
        if (!c) return res.status(404).json({ error: 'Not found' });
        const r = await dbRun(
            `INSERT INTO campaigns
               (name,description,type_key,priority,audience_id,audience,trigger_config,conditions,actions,
                rewards,channels,schedule,config,approval_required,branch_restrictions,created_by,status)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft')`,
            [c.name + ' (copy)', c.description, c.type_key, c.priority, c.audience_id, c.audience, c.trigger_config,
             c.conditions, c.actions, c.rewards, c.channels, c.schedule, c.config, c.approval_required,
             c.branch_restrictions, req.campaignUser.id]);
        res.json({ success: true, id: r.insertId });
    } catch (e) { next(e); }
});

// Lifecycle status transitions: draft→active/scheduled/paused/completed/archived.
router.post('/:id/status', requirePermission('edit'), async (req, res, next) => {
    try {
        const status = req.body.status;
        const allowed = ['draft','active','scheduled','paused','completed','archived'];
        if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
        await dbRun(`UPDATE campaigns SET status=? WHERE id=?`, [status, req.params.id]);
        if (status === 'active' || status === 'scheduled') await scheduler.reschedule(req.params.id);
        else if (status !== 'draft') await dbRun(`UPDATE campaigns SET next_run_at=NULL WHERE id=?`, [req.params.id]);
        res.json({ success: true });
    } catch (e) { next(e); }
});

/* ── Approval workflow ── */
router.post('/:id/submit', requirePermission('create'), async (req, res, next) => {
    try {
        await dbRun(`UPDATE campaigns SET status='pending_approval' WHERE id=?`, [req.params.id]);
        await logApproval(req.params.id, null, 'submit', req.campaignUser, req.body.note);
        res.json({ success: true });
    } catch (e) { next(e); }
});
router.post('/:id/approve', requirePermission('approve'), async (req, res, next) => {
    try {
        await dbRun(`UPDATE campaigns SET status='approved', approved_by=?, approved_at=CURRENT_TIMESTAMP WHERE id=?`,
            [req.campaignUser.id, req.params.id]);
        await logApproval(req.params.id, null, 'approve', req.campaignUser, req.body.note);
        res.json({ success: true });
    } catch (e) { next(e); }
});
router.post('/:id/reject', requirePermission('approve'), async (req, res, next) => {
    try {
        await dbRun(`UPDATE campaigns SET status='rejected' WHERE id=?`, [req.params.id]);
        await logApproval(req.params.id, null, 'reject', req.campaignUser, req.body.note);
        res.json({ success: true });
    } catch (e) { next(e); }
});
router.get('/:id/approvals', async (req, res, next) => {
    try { res.json(await dbAll(`SELECT * FROM campaign_approvals WHERE campaign_id=? ORDER BY id DESC`, [req.params.id])); }
    catch (e) { next(e); }
});

async function logApproval(campaignId, runId, action, user, note) {
    await dbRun(
        `INSERT INTO campaign_approvals (campaign_id, run_id, action, actor_id, actor_role, note) VALUES (?,?,?,?,?,?)`,
        [campaignId, runId, action, user?.id || null, user?.role || null, note || null]);
}

/* ── Preview & manual run ── */
router.post('/:id/preview', async (req, res, next) => {
    try {
        const campaign = await engine.getCampaign(req.params.id);
        if (!campaign) return res.status(404).json({ error: 'Not found' });
        const tree = await engine.resolveAudienceTree(campaign);
        const total = await audience.count(tree, { status: 'active' });
        const sample = await audience.resolve(tree, { status: 'active', limit: 5 });
        const chans = engine.normalizeChannels(campaign);
        const previews = sample.map(customer => {
            const ctx = template.buildContext({ customer, campaign, extra: { message: campaign.config?.message || '' } });
            return {
                customer: { phone: customer.phone, name: customer.name },
                messages: chans.map(c => ({ channel: c.channel, body: template.render(campaign.config?.message || '{{message}}', ctx) })),
            };
        });
        res.json({ audience_total: total, channels: chans.map(c => c.channel), previews });
    } catch (e) { next(e); }
});

router.post('/:id/run', requirePermission('execute'), async (req, res, next) => {
    try {
        const result = await engine.buildRun(req.params.id, {
            triggerType: 'manual', createdBy: req.campaignUser.id,
            targetCustomer: req.body.customer_phone ? await trigger.loadCustomer(req.body.customer_phone) : null });
        res.json({ success: true, ...result });
    } catch (e) { next(e); }
});

router.get('/:id/analytics', async (req, res, next) => {
    try {
        const [performance, retention, branches, timeline] = await Promise.all([
            analytics.campaignPerformance(req.params.id),
            analytics.retention(req.params.id),
            analytics.branchComparison(req.params.id),
            analytics.revenueTimeline(req.params.id, 30),
        ]);
        if (!performance) return res.status(404).json({ error: 'Not found' });
        res.json({ performance, retention, branches, timeline });
    } catch (e) { next(e); }
});

module.exports = router;
