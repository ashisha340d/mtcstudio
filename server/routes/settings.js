'use strict';
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { dbAll, dbGet, dbRun } = require('../database/db');
const { buildEscPos } = require('../services/escposBuilder');
const { listUsbPrinters, printRawUsingConfig } = require('../services/usbPrinter');
const { uploadAudio, uploadsDir } = require('../middleware/upload');

// ── Receipt Config ────────────────────────────────────────────

// GET all config as flat object { key: value }
router.get('/receipt', async (req, res, next) => {
    try {
        const rows = await dbAll(`SELECT \`key\`, \`value\` FROM receipt_config`);
        const cfg = {};
        rows.forEach(r => cfg[r.key] = r.value);
        res.json(cfg);
    } catch (e) { next(e); }
});

// POST bulk upsert — body: { key: value, ... }
router.post('/receipt', async (req, res, next) => {
    try {
        const VALID_KEYS = [
            'org_name', 'org_tagline', 'org_address', 'org_phone', 'org_email',
            'org_gstin', 'org_pan', 'receipt_footer', 'show_logo', 'logo_text',
            'show_customer_phone', 'show_order_type', 'show_table',
            'show_kot_breakdown', 'paper_width_mm', 'font_size_px', 'copies',
            'custom_header_line', 'custom_footer_line',
        ];
        const errors = {};
        const body = req.body;

        // Validation
        if (body.org_name !== undefined && !String(body.org_name).trim())
            errors.org_name = 'Organisation name is required';
        if (body.org_name !== undefined && String(body.org_name).length > 50)
            errors.org_name = 'Max 50 characters';
        if (body.org_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.org_email))
            errors.org_email = 'Invalid email format';
        if (body.org_phone && !/^[+\d\s\-()]{7,20}$/.test(body.org_phone))
            errors.org_phone = 'Invalid phone number';
        if (body.paper_width_mm && !['58', '80'].includes(String(body.paper_width_mm)))
            errors.paper_width_mm = 'Must be 58 or 80';
        if (body.font_size_px) {
            const fs = Number(body.font_size_px);
            if (isNaN(fs) || fs < 10 || fs > 16) errors.font_size_px = 'Must be 10–16';
        }
        if (body.copies) {
            const c = Number(body.copies);
            if (isNaN(c) || c < 1 || c > 5) errors.copies = 'Must be 1–5';
        }
        if (body.logo_text && String(body.logo_text).split('\n').some(l => l.length > 42))
            errors.logo_text = 'Each line max 42 characters (80mm paper limit)';

        if (Object.keys(errors).length) return res.status(422).json({ errors });

        for (const key of VALID_KEYS) {
            if (body[key] === undefined) continue;
            await dbRun(
                `INSERT INTO receipt_config (\`key\`, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
                 ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = CURRENT_TIMESTAMP`,
                [key, String(body[key])]
            );
        }
        res.json({ success: true });
    } catch (e) { next(e); }
});

// ── Cake Slip Config ──────────────────────────────────────────

const CAKE_SLIP_KEYS = [
    'cake_slip_shop_name', 'cake_slip_header_line', 'cake_slip_footer',
    'cake_slip_show_phone', 'cake_slip_show_flavour', 'cake_slip_show_size',
    'cake_slip_show_qty', 'cake_slip_show_cream', 'cake_slip_show_sponge',
    'cake_slip_show_shape', 'cake_slip_show_theme', 'cake_slip_show_message',
    'cake_slip_show_accessories', 'cake_slip_show_allergies', 'cake_slip_show_notes',
    'cake_slip_show_status', 'cake_slip_show_qr', 'cake_slip_show_pricing',
];

router.get('/cake-slip', async (req, res, next) => {
    try {
        const rows = await dbAll(`SELECT \`key\`, value FROM receipt_config WHERE \`key\` LIKE 'cake_slip_%'`);
        const cfg = {};
        rows.forEach(r => cfg[r.key] = r.value);
        res.json(cfg);
    } catch (e) { next(e); }
});

router.post('/cake-slip', async (req, res, next) => {
    try {
        const body = req.body;
        for (const key of CAKE_SLIP_KEYS) {
            if (body[key] === undefined) continue;
            await dbRun(
                `INSERT INTO receipt_config (\`key\`, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
                 ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = CURRENT_TIMESTAMP`,
                [key, String(body[key])]
            );
        }
        res.json({ success: true });
    } catch (e) { next(e); }
});

// ── Mero Kinmel OCR Import Config ─────────────────────────────
// Controls what an incoming Mero Kinmel slip becomes: a DRAFT the cashier
// confirms, or a live ORDER fired straight to the kitchen. Auto-ordering only
// happens when the import is trustworthy — otherwise it always lands as an
// MK-REVIEW draft, never as an order.

const MERO_KEYS = [
    'mk_import_mode',          // 'DRAFT' | 'ORDER'
    'mk_min_confidence',       // 0..1
    'mk_require_total_match',  // '1' | '0' — computed total must equal slip total
    'mk_require_all_matched',  // '1' | '0' — no unmatched items allowed
];
const MERO_DEFAULTS = {
    mk_import_mode: 'DRAFT',
    mk_min_confidence: '0.6',
    mk_require_total_match: '1',
    mk_require_all_matched: '1',
};

router.get('/mero-kinmel', async (req, res, next) => {
    try {
        const rows = await dbAll(`SELECT \`key\`, value FROM receipt_config WHERE \`key\` LIKE 'mk_%'`);
        const cfg = { ...MERO_DEFAULTS };
        rows.forEach(r => cfg[r.key] = r.value);
        res.json(cfg);
    } catch (e) { next(e); }
});

router.post('/mero-kinmel', async (req, res, next) => {
    try {
        const body = req.body;
        if (body.mk_import_mode !== undefined &&
            !['DRAFT', 'ORDER'].includes(String(body.mk_import_mode))) {
            return res.status(400).json({ error: 'mk_import_mode must be DRAFT or ORDER' });
        }
        if (body.mk_min_confidence !== undefined) {
            const n = Number(body.mk_min_confidence);
            if (!(n >= 0 && n <= 1)) return res.status(400).json({ error: 'mk_min_confidence must be 0..1' });
        }
        for (const key of MERO_KEYS) {
            if (body[key] === undefined) continue;
            await dbRun(
                `INSERT INTO receipt_config (\`key\`, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
                 ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = CURRENT_TIMESTAMP`,
                [key, String(body[key])]
            );
        }
        res.json({ success: true });
    } catch (e) { next(e); }
});

// ── KDS Sound Config ──────────────────────────────────────────
// Centrally configured alert sounds for KDS, Waiter App & POS — replaces the
// old per-browser localStorage upload so every screen plays the same sound.

const KDS_SOUND_TYPES = ['new_order', 'warning', 'critical', 'waiter_ready', 'pos_ready', 'waiter_new_order', 'web_order'];

router.get('/kds-sound', async (req, res, next) => {
    try {
        const rows = await dbAll(`SELECT \`key\`, value FROM receipt_config WHERE \`key\` LIKE 'kds_sound_%'`);
        const cfg = {};
        KDS_SOUND_TYPES.forEach(t => cfg[t] = null);
        rows.forEach(r => cfg[r.key.replace('kds_sound_', '')] = r.value);
        res.json(cfg);
    } catch (e) { next(e); }
});

router.post('/kds-sound/upload/:type', uploadAudio.single('sound'), async (req, res, next) => {
    try {
        const { type } = req.params;
        if (!KDS_SOUND_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid sound type' });
        if (!req.file) return res.status(400).json({ error: 'Invalid or missing audio file' });

        const key = `kds_sound_${type}`;
        const url = `/uploads/${req.file.filename}`;

        const old = await dbGet(`SELECT value FROM receipt_config WHERE \`key\` = ?`, [key]);
        await dbRun(
            `INSERT INTO receipt_config (\`key\`, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
             ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = CURRENT_TIMESTAMP`,
            [key, url]
        );
        if (old?.value) {
            const oldPath = path.join(uploadsDir, path.basename(old.value));
            fs.unlink(oldPath, () => {});
        }

        res.json({ success: true, url });
    } catch (e) { next(e); }
});

router.post('/kds-sound/clear/:type', async (req, res, next) => {
    try {
        const { type } = req.params;
        if (!KDS_SOUND_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid sound type' });

        const key = `kds_sound_${type}`;
        const old = await dbGet(`SELECT value FROM receipt_config WHERE \`key\` = ?`, [key]);
        await dbRun(`DELETE FROM receipt_config WHERE \`key\` = ?`, [key]);
        if (old?.value) {
            const oldPath = path.join(uploadsDir, path.basename(old.value));
            fs.unlink(oldPath, () => {});
        }

        res.json({ success: true });
    } catch (e) { next(e); }
});

// ── Printer Config ────────────────────────────────────────────

// GET saved printer
router.get('/printer', async (req, res, next) => {
    try {
        const row = await dbGet(`SELECT printer_name, vendor_id, product_id, paper_width FROM printer_config WHERE id = 1`);
        res.json(row ?? { printer_name: null, vendor_id: null, product_id: null, paper_width: 80 });
    } catch (e) { next(e); }
});

// POST save selected USB printer (vendor_id/product_id identify the physical device)
router.post('/printer', async (req, res, next) => {
    try {
        const { printer_name, vendor_id, product_id, paper_width } = req.body;
        if (!vendor_id || !product_id)
            return res.status(400).json({ error: 'vendor_id and product_id are required' });
        await dbRun(
            `UPDATE printer_config SET printer_name = ?, vendor_id = ?, product_id = ?, paper_width = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
            [printer_name ? String(printer_name).trim() : null, String(vendor_id), String(product_id), paper_width || 58]
        );
        res.json({ success: true });
    } catch (e) { next(e); }
});

// ── ESC/POS Raw Print (direct USB) ─────────────────────────────────

// POST /print — build ESC/POS bytes and send straight to the configured USB printer
router.post('/print', async (req, res, next) => {
    try {
        const pcfg = await dbGet(`SELECT printer_name, vendor_id, product_id, paper_width FROM printer_config WHERE id = 1`);
        if (!pcfg?.vendor_id || !pcfg?.product_id) {
            return res.status(400).json({ error: 'No printer configured. Set one in File Maintenance → Receipt & Printer.' });
        }

        // Load receipt config
        const rows = await dbAll(`SELECT \`key\`, value FROM receipt_config`);
        const rcfg = {};
        rows.forEach(r => rcfg[r.key] = r.value);
        rcfg.paper_width = pcfg.paper_width || 80;

        const { order, items, payments, isReprint, copies: reqCopies } = req.body;
        const copies = Math.max(1, Math.min(5, Number(rcfg.copies || reqCopies || 1)));

        const bytes = buildEscPos({ order, items, payments, isReprint }, rcfg);
        await printRawUsingConfig(bytes, copies);

        // Reprints feed the day-end operational log — attribute via session if possible
        if (isReprint && Number(order?.id)) {
            try {
                const posDb = require('../pos/db');
                const token = req.headers['x-session-id'];
                let userId = null, sessionId = null;
                if (token) {
                    const s = await posDb.dbGet(
                        `SELECT id, user_id FROM pos_sessions WHERE token = ? AND ended_at IS NULL`, [token]);
                    if (s) { userId = s.user_id; sessionId = s.id; }
                }
                if (!userId) {
                    const dev = await posDb.dbGet(`SELECT id FROM pos_users WHERE employee_id = 'DEV01'`);
                    userId = dev?.id ?? null;
                }
                if (userId) {
                    const { audit } = require('../middleware/posAudit');
                    await audit({ userId, sessionId, entityType: 'ORDER', entityId: Number(order.id), action: 'REPRINT', delta: { copies } });
                }
            } catch { /* best-effort — printing already succeeded */ }
        }

        res.json({ ok: true, copies });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Print failed' });
    }
});

// GET list of connected USB ESC/POS printers
router.get('/printers', (req, res) => {
    try {
        const printers = listUsbPrinters();
        res.json({ printers });
    } catch (e) {
        res.json({ printers: [], error: e.message || 'Could not scan USB printers' });
    }
});

module.exports = router;
