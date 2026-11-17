'use strict';
const express = require('express');
const { requireHrRole, badRequest } = require('../middleware/hrAuth');
const svc = require('../services/payrollService');

const router = express.Router();
router.use(requireHrRole);

const actorId = (req) => req.actor?.id ?? null;

/* ── settings ────────────────────────────────────────────────── */

router.get('/settings', async (req, res, next) => {
    try { res.json(await svc.getPayrollSettings()); } catch (e) { badRequest(next)(e); }
});

router.put('/settings', async (req, res, next) => {
    try {
        const body = { ...req.body };
        if (body.salary_cutoff_day !== undefined) {
            const day = parseInt(body.salary_cutoff_day, 10);
            if (!Number.isInteger(day) || day < 1 || day > 31) {
                return res.status(400).json({ error: 'salary_cutoff_day must be 1..31' });
            }
            body.salary_cutoff_day = day;
        }
        if (body.days_basis && !['FIXED', 'CALENDAR'].includes(body.days_basis)) {
            return res.status(400).json({ error: 'days_basis must be FIXED or CALENDAR' });
        }
        if (body.fixed_days !== undefined) {
            const d = parseInt(body.fixed_days, 10);
            if (!Number.isInteger(d) || d < 1 || d > 31) return res.status(400).json({ error: 'fixed_days must be 1..31' });
            body.fixed_days = d;
        }
        if (body.half_day_factor !== undefined) {
            const f = parseFloat(body.half_day_factor);
            if (!(f >= 0 && f <= 1)) return res.status(400).json({ error: 'half_day_factor must be 0..1' });
            body.half_day_factor = f;
        }
        res.json(await svc.updatePayrollSettings(body));
    } catch (e) { badRequest(next)(e); }
});

/* ── runs ────────────────────────────────────────────────────── */

router.get('/runs', async (req, res, next) => {
    try { res.json(await svc.getPayrollRuns()); } catch (e) { badRequest(next)(e); }
});

router.get('/runs/:id', async (req, res, next) => {
    try {
        const row = await svc.getPayrollRun(req.params.id);
        if (!row) return res.status(404).json({ error: 'Payroll run not found' });
        res.json(row);
    } catch (e) { badRequest(next)(e); }
});

router.post('/runs', async (req, res, next) => {
    try {
        if (!req.body.period_start || !req.body.period_end) {
            return res.status(400).json({ error: 'period_start and period_end required' });
        }
        const run = await svc.createPayrollRun(
            svc.normalizeDate(req.body.period_start),
            svc.normalizeDate(req.body.period_end),
            actorId(req));
        res.status(201).json(run);
    } catch (e) { badRequest(next)(e); }
});

router.post('/runs/:id/recalc', async (req, res, next) => {
    try { res.json(await svc.recalcPayrollRun(req.params.id)); } catch (e) { badRequest(next)(e); }
});

router.post('/runs/:id/finalize', async (req, res, next) => {
    try { res.json(await svc.finalizePayrollRun(req.params.id)); } catch (e) { badRequest(next)(e); }
});

router.post('/runs/:id/reverse', async (req, res, next) => {
    try { res.json(await svc.reversePayrollRun(req.params.id)); } catch (e) { badRequest(next)(e); }
});

router.delete('/runs/:id', async (req, res, next) => {
    try {
        const row = await svc.deletePayrollRun(req.params.id);
        if (!row) return res.status(404).json({ error: 'Payroll run not found' });
        res.json(row);
    } catch (e) { badRequest(next)(e); }
});

router.get('/runs/:id/lines', async (req, res, next) => {
    try { res.json(await svc.getPayrollLines(req.params.id)); } catch (e) { badRequest(next)(e); }
});

router.post('/runs/lines/:lineId/settlement', async (req, res, next) => {
    try {
        const { settlement_status, settlement_note, drawer_movement_id } = req.body;
        if (!settlement_status) return res.status(400).json({ error: 'settlement_status required' });
        const row = await svc.updatePayrollLineSettlement(
            req.params.lineId, settlement_status, settlement_note, drawer_movement_id);
        if (!row) return res.status(404).json({ error: 'Payroll line not found' });
        res.json(row);
    } catch (e) { badRequest(next)(e); }
});

/* ── commission rules ────────────────────────────────────────── */

router.get('/commission-rules', async (req, res, next) => {
    try { res.json(await svc.getCommissionRules()); } catch (e) { badRequest(next)(e); }
});

router.post('/commission-rules', async (req, res, next) => {
    try {
        const { name, rule_type, criteria_json, rate_type, rate_value, active, effective_from } = req.body;
        if (!name || !rule_type || !rate_type || rate_value === undefined) {
            return res.status(400).json({ error: 'name, rule_type, rate_type, rate_value required' });
        }
        const row = await svc.createCommissionRule(
            name, rule_type, criteria_json, rate_type, parseFloat(rate_value),
            active === undefined ? true : Boolean(active),
            svc.normalizeDate(effective_from || new Date().toISOString()), actorId(req));
        res.status(201).json(row);
    } catch (e) { badRequest(next)(e); }
});

router.put('/commission-rules/:id', async (req, res, next) => {
    try {
        const row = await svc.updateCommissionRule(req.params.id, req.body);
        if (!row) return res.status(404).json({ error: 'Commission rule not found' });
        res.json(row);
    } catch (e) { badRequest(next)(e); }
});

router.delete('/commission-rules/:id', async (req, res, next) => {
    try { res.json(await svc.deleteCommissionRule(req.params.id)); } catch (e) { badRequest(next)(e); }
});

router.post('/commission-imports', async (req, res, next) => {
    try {
        const { payroll_run_id, source_type, source_id, customer_id, amount, description, unique_key } = req.body;
        if (!payroll_run_id || !source_type || !source_id || !customer_id || amount === undefined || !unique_key) {
            return res.status(400).json({ error: 'payroll_run_id, source_type, source_id, customer_id, amount, unique_key required' });
        }
        const row = await svc.importPayrollCommission(
            payroll_run_id, source_type, source_id, customer_id, parseFloat(amount), description, unique_key);
        res.status(201).json(row);
    } catch (e) { badRequest(next)(e); }
});

module.exports = router;
