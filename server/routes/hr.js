'use strict';
const express = require('express');
const { requireHrRole, badRequest } = require('../middleware/hrAuth');
const svc = require('../services/payrollService');

const router = express.Router();
router.use(requireHrRole);

const actorId = (req) => req.actor?.id ?? null;

/* ── dashboard ───────────────────────────────────────────────── */

router.get('/summary', async (req, res, next) => {
    try { res.json(await svc.getHrSummary()); } catch (e) { badRequest(next)(e); }
});

/* ── employees ───────────────────────────────────────────────── */

router.get('/employees', async (req, res, next) => {
    try { res.json(await svc.getEmployeeProfiles()); } catch (e) { badRequest(next)(e); }
});

/** Customers not already on staff — source list for the add-employee picker. */
router.get('/candidates', async (req, res, next) => {
    try { res.json(await svc.searchCandidates(req.query.q)); } catch (e) { badRequest(next)(e); }
});

/** Distinct departments / designations plus the server's date ceiling. */
router.get('/taxonomy', async (req, res, next) => {
    try { res.json({ ...await svc.getTaxonomy(), today: svc.todayIso() }); } catch (e) { badRequest(next)(e); }
});

router.get('/employees/:customerId', async (req, res, next) => {
    try {
        const row = await svc.getEmployeeProfile(req.params.customerId);
        if (!row) return res.status(404).json({ error: 'Employee not found' });
        res.json(row);
    } catch (e) { badRequest(next)(e); }
});

router.post('/employees', async (req, res, next) => {
    try {
        const { customer_id, employee_number, join_date } = req.body;
        if (!customer_id || !employee_number || !join_date) {
            return res.status(400).json({ error: 'customer_id, employee_number and join_date required' });
        }
        const row = await svc.createEmployeeProfile(customer_id, {
            ...req.body, join_date: svc.normalizeDate(join_date),
        }, actorId(req));
        res.status(201).json(row);
    } catch (e) { badRequest(next)(e); }
});

router.put('/employees/:customerId', async (req, res, next) => {
    try {
        const body = { ...req.body };
        if (body.join_date) body.join_date = svc.normalizeDate(body.join_date);
        const row = await svc.updateEmployeeProfile(req.params.customerId, body);
        if (!row) return res.status(404).json({ error: 'Employee not found' });
        res.json(row);
    } catch (e) { badRequest(next)(e); }
});

router.delete('/employees/:customerId', async (req, res, next) => {
    try { res.json(await svc.deleteEmployeeProfile(req.params.customerId)); } catch (e) { badRequest(next)(e); }
});

/* ── salary ──────────────────────────────────────────────────── */

router.get('/employees/:customerId/salary-history', async (req, res, next) => {
    try { res.json(await svc.getSalaryHistory(req.params.customerId)); } catch (e) { badRequest(next)(e); }
});

router.post('/employees/:customerId/salary-history', async (req, res, next) => {
    try {
        const { effective_from, salary, notes } = req.body;
        if (!effective_from || salary === undefined) {
            return res.status(400).json({ error: 'effective_from and salary required' });
        }
        const row = await svc.createSalaryHistory(
            req.params.customerId, svc.normalizeDate(effective_from), parseFloat(salary), notes);
        res.status(201).json(row);
    } catch (e) { badRequest(next)(e); }
});

router.delete('/salary-history/:id', async (req, res, next) => {
    try { res.json(await svc.deleteSalaryHistory(req.params.id)); } catch (e) { badRequest(next)(e); }
});

/* ── attendance ──────────────────────────────────────────────── */

/** Whole-team grid for a window — one request per month view. */
router.get('/attendance', async (req, res, next) => {
    try {
        const { from, to } = req.query;
        if (!from || !to) return res.status(400).json({ error: 'from and to required' });
        res.json(await svc.getAttendanceMatrix(svc.normalizeDate(from), svc.normalizeDate(to)));
    } catch (e) { badRequest(next)(e); }
});

router.post('/attendance/bulk', async (req, res, next) => {
    try {
        const cells = Array.isArray(req.body.cells) ? req.body.cells : [];
        if (!cells.length) return res.status(400).json({ error: 'cells required' });
        res.json(await svc.bulkSaveAttendance(cells, actorId(req)));
    } catch (e) { badRequest(next)(e); }
});

router.get('/employees/:customerId/attendance', async (req, res, next) => {
    try {
        const { from, to } = req.query;
        if (!from || !to) return res.status(400).json({ error: 'from and to required' });
        res.json(await svc.getAttendance(req.params.customerId, svc.normalizeDate(from), svc.normalizeDate(to)));
    } catch (e) { badRequest(next)(e); }
});

router.post('/employees/:customerId/attendance', async (req, res, next) => {
    try {
        const { attendance_date, attendance_code, notes } = req.body;
        if (!attendance_date || !attendance_code) {
            return res.status(400).json({ error: 'attendance_date and attendance_code required' });
        }
        const row = await svc.persistAttendance(
            req.params.customerId, svc.normalizeDate(attendance_date), attendance_code, notes, actorId(req));
        res.status(201).json(row);
    } catch (e) { badRequest(next)(e); }
});

router.put('/employees/:customerId/attendance/:id', async (req, res, next) => {
    try {
        const { attendance_code, notes } = req.body;
        if (!attendance_code && notes === undefined) {
            return res.status(400).json({ error: 'attendance_code or notes required' });
        }
        const row = await svc.updateAttendance(req.params.id, attendance_code, notes);
        if (!row) return res.status(404).json({ error: 'Attendance row not found' });
        res.json(row);
    } catch (e) { badRequest(next)(e); }
});

/* ── adjustments (bonus / penalty / advance) ─────────────────── */

router.get('/adjustments', async (req, res, next) => {
    try {
        res.json(await svc.getAdjustments({
            customerId: req.query.customer_id,
            from: req.query.from,
            to: req.query.to,
            pendingOnly: req.query.pending === '1',
        }));
    } catch (e) { badRequest(next)(e); }
});

router.post('/adjustments', async (req, res, next) => {
    try {
        const { customer_id, kind, amount, adj_date, note } = req.body;
        if (!customer_id || !kind || amount === undefined) {
            return res.status(400).json({ error: 'customer_id, kind and amount required' });
        }
        const row = await svc.createAdjustment(
            customer_id, kind, parseFloat(amount),
            svc.normalizeDate(adj_date || new Date().toISOString()), note, actorId(req));
        res.status(201).json(row);
    } catch (e) { badRequest(next)(e); }
});

router.delete('/adjustments/:id', async (req, res, next) => {
    try {
        const row = await svc.deleteAdjustment(req.params.id);
        if (!row) return res.status(404).json({ error: 'Adjustment not found' });
        res.json(row);
    } catch (e) { badRequest(next)(e); }
});

module.exports = router;
