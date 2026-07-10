'use strict';
const express = require('express');
const { dbAll, dbGet, dbRun, transaction } = require('../../pos/db');
const { requireSession } = require('../../middleware/posAuth');
const { audit } = require('../../middleware/posAudit');
const { dbAll: cmsDbAll, dbGet: cmsDbGet } = require('../../database/db');
const { printRawUsingConfig } = require('../../services/usbPrinter');
const path = require('path');
const fs = require('fs');
const socketServer = require('../../pos/socketServer');

const router = express.Router();
router.use(requireSession);

// ── Multer ────────────────────────────────────────────────────
let upload;
try {
  const multer = require('multer');
  const DIR = path.join(__dirname, '../../uploads/cake');
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  upload = multer({
    storage: multer.diskStorage({
      destination: DIR,
      filename: (_, f, cb) => cb(null, `cake_${Date.now()}_${f.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
  });
} catch { upload = null; }

// ═══════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════

async function todayLocal() {
  return (await dbGet(`SELECT CURDATE() AS d`)).d;
}

async function nextOrderNumber() {
  const yr = new Date().getFullYear();
  const r = await dbGet(
    `SELECT COALESCE(MAX(CAST(SUBSTR(order_number,-4) AS INTEGER)),0)+1 AS seq
     FROM cake_orders WHERE order_number LIKE ?`,
    [`CAKE-${yr}-%`]
  );
  return `CAKE-${yr}-${String(r.seq).padStart(4, '0')}`;
}

async function computeModTotal(tx, shapeId, creamId, spongeId, themeId, dietaryId) {
  const ids = [shapeId, creamId, spongeId, themeId, dietaryId].filter(Boolean);
  if (!ids.length) return 0;
  const ph = ids.map(() => '?').join(',');
  const row = await tx.dbGet(`SELECT COALESCE(SUM(extra_charge),0) AS t FROM lookup_master WHERE id IN (${ph})`, ids);
  return row.t || 0;
}

async function recalc(tx, orderId) {
  const o = await tx.dbGet(`SELECT shape_id,cream_type_id,sponge_type_id,theme_id,dietary_type_id,discount,advance_paid FROM cake_orders WHERE id=?`, [orderId]);
  if (!o) return;
  const cakeTotal = (await tx.dbGet(`SELECT COALESCE(SUM(amount),0) AS t FROM cake_order_items WHERE cake_order_id=?`, [orderId])).t;
  const accTotal = (await tx.dbGet(`SELECT COALESCE(SUM(amount),0) AS t FROM cake_order_accessories WHERE cake_order_id=?`, [orderId])).t;
  const modTotal = await computeModTotal(tx, o.shape_id, o.cream_type_id, o.sponge_type_id, o.theme_id, o.dietary_type_id);
  const grand = Math.max(0, cakeTotal + accTotal + modTotal - (o.discount || 0));
  const balance = Math.max(0, grand - (o.advance_paid || 0));
  await tx.dbRun(`UPDATE cake_orders SET cake_total=?,modifier_total=?,accessory_total=?,grand_total=?,balance_due=? WHERE id=?`,
    [cakeTotal, modTotal, accTotal, grand, balance, orderId]);
}

async function getFull(id) {
  const row = await dbGet(
    `SELECT co.*, u.name AS created_by_name,
            sh.name AS shape_name,   sh.extra_charge AS shape_charge,
            cr.name AS cream_name,   cr.extra_charge AS cream_charge,
            sp.name AS sponge_name,  sp.extra_charge AS sponge_charge,
            th.name AS theme_name,   th.extra_charge AS theme_charge,
            di.name AS dietary_name, di.extra_charge AS dietary_charge
     FROM   cake_orders co
     LEFT JOIN pos_users    u  ON u.id  = co.created_by
     LEFT JOIN lookup_master sh ON sh.id = co.shape_id
     LEFT JOIN lookup_master cr ON cr.id = co.cream_type_id
     LEFT JOIN lookup_master sp ON sp.id = co.sponge_type_id
     LEFT JOIN lookup_master th ON th.id = co.theme_id
     LEFT JOIN lookup_master di ON di.id = co.dietary_type_id
     WHERE co.id=? AND co.deleted_at IS NULL`,
    [id]
  );
  if (!row) return null;
  const items = await dbAll(`SELECT * FROM cake_order_items       WHERE cake_order_id=? ORDER BY sort_order,id`, [id]);
  const accessories = await dbAll(`SELECT * FROM cake_order_accessories  WHERE cake_order_id=? ORDER BY sort_order,id`, [id]);
  const images = await dbAll(`SELECT * FROM cake_order_images       WHERE cake_order_id=? ORDER BY created_at`, [id]);
  const history = await dbAll(
    `SELECT h.*,u.name AS changed_by_name
     FROM cake_order_status_history h LEFT JOIN pos_users u ON u.id=h.changed_by
     WHERE h.cake_order_id=? ORDER BY h.changed_at`,
    [id]
  );
  const payments = await dbAll(
    `SELECT id, payment_type,
            CASE WHEN method='CARD' AND notes='WALLET' THEN 'WALLET' ELSE method END AS method,
            amount, reference, notes, created_at
     FROM pos_payments WHERE cake_order_id=? ORDER BY created_at, id`,
    [id]
  );
  return { ...row, items, accessories, images, statusHistory: history, payments };
}

async function saveLines(tx, orderId, items, accessories) {
  await tx.dbRun(`DELETE FROM cake_order_items       WHERE cake_order_id=?`, [orderId]);
  await tx.dbRun(`DELETE FROM cake_order_accessories WHERE cake_order_id=?`, [orderId]);
  for (const [i, it] of (items || []).entries()) {
    const amt = (parseFloat(it.rate) || 0) * (parseInt(it.qty) || 1);
    await tx.dbRun(
      `INSERT INTO cake_order_items (cake_order_id,product_id,variant_id,product_name,variant_name,size,unit,qty,rate,amount,sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [orderId, it.product_id || null, it.variant_id || null, it.product_name || 'Cake',
       it.variant_name || null, it.size || null, it.unit || 'PCS', parseInt(it.qty) || 1, parseFloat(it.rate) || 0, amt, i]
    );
  }
  for (const [i, ac] of (accessories || []).entries()) {
    const amt = (parseFloat(ac.rate) || 0) * (parseInt(ac.qty) || 1);
    await tx.dbRun(
      `INSERT INTO cake_order_accessories (cake_order_id,product_id,variant_id,product_name,variant_name,unit,qty,rate,amount,sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [orderId, ac.product_id || null, ac.variant_id || null, ac.product_name || 'Item',
       ac.variant_name || null, ac.unit || 'PCS', parseInt(ac.qty) || 1, parseFloat(ac.rate) || 0, amt, i]
    );
  }
}

// ═══════════════════════════════════════════════════════════════
//  Meta & lookups
// ═══════════════════════════════════════════════════════════════

router.get('/meta', async (_, res) => {
  const rows = await dbAll(
    `SELECT id,lookup_type,name,extra_charge,sort_order FROM lookup_master WHERE is_active=1 ORDER BY lookup_type,sort_order,name`
  );
  const lookups = {};
  rows.forEach(r => { (lookups[r.lookup_type] = lookups[r.lookup_type] || []).push(r); });
  res.json({ nextOrderNumber: await nextOrderNumber(), today: new Date().toISOString().slice(0, 10), lookups });
});

router.post('/lookup', async (req, res) => {
  const { lookup_type, name, extra_charge, description } = req.body;
  if (!lookup_type || !name?.trim()) return res.status(400).json({ error: 'lookup_type and name required' });
  try {
    const result = await dbRun(
      `INSERT INTO lookup_master (lookup_type,name,extra_charge,description) VALUES (?,?,?,?)`,
      [lookup_type, name.trim(), parseFloat(extra_charge) || 0, description?.trim() || null]
    );
    const r = await dbGet(`SELECT * FROM lookup_master WHERE id=?`, [result.lastInsertRowid]);
    res.status(201).json(r);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Already exists' });
    throw e;
  }
});

// ═══════════════════════════════════════════════════════════════
//  Products (from CMS db) — for cake flavour & accessory picker
// ═══════════════════════════════════════════════════════════════

// ?type=base      → products/variants tagged CAKE_BASE
// ?type=accessory → products/variants tagged CAKE_ACCESSORY (checks BOTH product AND variant level)
// Falls back to all active products when nothing is tagged yet (graceful cold start)
router.get('/products', async (req, res) => {
  try {
    const typeMap = { base: 'CAKE_BASE', accessory: 'CAKE_ACCESSORY' };
    const cakeType = typeMap[req.query.type];

    let where = `p.status = 'active' AND pv.status = 'active'`;
    if (cakeType) {
      // Count at product level OR variant level
      const taggedProd = (await cmsDbGet(`SELECT COUNT(*) AS n FROM products WHERE cake_type=?`, [cakeType])).n;
      const taggedVar = (await cmsDbGet(`SELECT COUNT(*) AS n FROM product_variants WHERE cake_type=?`, [cakeType])).n;
      if (taggedProd + taggedVar > 0) {
        // Include row if product is tagged OR the specific variant is tagged
        where += ` AND (p.cake_type = '${cakeType}' OR pv.cake_type = '${cakeType}')`;
      }
      // else: nothing tagged yet — fall through and return all (so picker is never empty)
    }

    const rows = await cmsDbAll(
      `SELECT p.id AS product_id, p.name AS product_name,
              p.cake_type AS product_cake_type,
              pv.id AS variant_id, pv.name AS variant_name,
              pv.cake_type AS variant_cake_type,
              pv.selling_price AS rate, pv.unit
       FROM   products p
       JOIN   product_variants pv ON pv.product_id = p.id
       WHERE  ${where}
       ORDER  BY p.name, pv.sort_order`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════
//  Photo upload
// ═══════════════════════════════════════════════════════════════

router.post('/upload', (req, res, next) => {
  if (!upload) return res.status(501).json({ error: 'multer not installed' });
  upload.array('photos', 10)(req, res, err => {
    if (err) return next(err);
    if (!req.files?.length) return res.status(400).json({ error: 'No files' });
    res.json({ urls: req.files.map(f => ({ url: `/uploads/cake/${f.filename}`, name: f.originalname })) });
  });
});

// ═══════════════════════════════════════════════════════════════
//  List
// ═══════════════════════════════════════════════════════════════

router.get('/', async (req, res) => {
  const { filter, status, q } = req.query;
  const today = new Date().toISOString().slice(0, 10);
  let where = 'co.deleted_at IS NULL';
  const params = [];
  if (filter === 'today') { where += ` AND co.order_date=?`; params.push(today); }
  else if (filter === 'delivery_today') { where += ` AND co.delivery_date=?`; params.push(today); }
  if (status) { where += ` AND co.status=?`; params.push(status); }
  if (q) {
    where += ` AND (co.customer_name LIKE ? OR co.phone LIKE ? OR co.order_number LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const orders = await dbAll(
    `SELECT co.id,co.order_number,co.customer_name,co.phone,co.delivery_date,co.delivery_time,
            co.status,co.grand_total,co.advance_paid,co.balance_due,co.created_at
     FROM   cake_orders co WHERE ${where} ORDER BY co.created_at DESC`,
    params
  );
  for (const o of orders) {
    o.first_item = (await dbGet(`SELECT product_name,size,qty FROM cake_order_items WHERE cake_order_id=? ORDER BY sort_order LIMIT 1`, [o.id])) || null;
  }
  res.json(orders);
});

// ═══════════════════════════════════════════════════════════════
//  Create
// ═══════════════════════════════════════════════════════════════

router.post('/', async (req, res) => {
  const b = req.body;
  if (!b.customer_name?.trim()) return res.status(400).json({ error: 'customer_name required' });
  const order_number = await nextOrderNumber();
  const today = new Date().toISOString().slice(0, 10);
  const advTenders = normalizeTenders(b.advance_payments, b.advance_method, b.advance_paid);
  const advTotal = tendersTotal(advTenders);
  let orderId;
  await transaction(async (tx) => {
    const result = await tx.dbRun(`
      INSERT INTO cake_orders (
        order_number, crm_customer_id, phone, customer_name,
        order_date, delivery_date, delivery_time,
        shape_id, cream_type_id, sponge_type_id, theme_id, dietary_type_id,
        message_on_cake, design_notes, dietary_notes, allergy_notes, internal_notes, assigned_baker,
        discount, advance_paid, advance_method, status, created_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      order_number, b.crm_customer_id || null, b.phone?.trim() || null, b.customer_name.trim(),
      today, b.delivery_date || null, b.delivery_time || null,
      b.shape_id || null, b.cream_type_id || null, b.sponge_type_id || null, b.theme_id || null, b.dietary_type_id || null,
      b.message_on_cake?.trim() || null, b.design_notes?.trim() || null, b.dietary_notes?.trim() || null,
      b.allergy_notes?.trim() || null, b.internal_notes?.trim() || null, b.assigned_baker?.trim() || null,
      parseFloat(b.discount) || 0, advTotal, advanceMethodLabel(advTenders), 'PENDING', req.posUser.id,
    ]);
    orderId = result.lastInsertRowid;
    await saveLines(tx, orderId, b.items, b.accessories);
    for (const img of (b.images || [])) {
      await tx.dbRun(`INSERT INTO cake_order_images (cake_order_id,image_url,image_name) VALUES (?,?,?)`, [orderId, img.url, img.name || null]);
    }
    await recalc(tx, orderId);
    await tx.dbRun(`INSERT INTO cake_order_status_history (cake_order_id,old_status,new_status,changed_by) VALUES (?,?,?,?)`, [orderId, null, 'PENDING', req.posUser.id]);
    // Record advance tenders in pos_payments if provided
    if (advTenders.length) {
      await insertCakePayments(tx, orderId, advTenders, 'ADVANCE', 'Advance Payment');
    }
  });
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'CAKE_ORDER', entityId: orderId, action: 'CREATE', delta: { order_number } });
  res.status(201).json(await getFull(orderId));
});

// ═══════════════════════════════════════════════════════════════
//  Get single
// ═══════════════════════════════════════════════════════════════

router.get('/:id', async (req, res) => {
  const row = await getFull(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// ═══════════════════════════════════════════════════════════════
//  WhatsApp message — builds a stage-specific customer update message.
//  Only defined for CONFIRMED orders (the whole New→Ready pipeline lives
//  under POS status CONFIRMED; production_status carries the sub-stage).
// ═══════════════════════════════════════════════════════════════

function toWhatsAppNumber(phone) {
  let p = String(phone || '').replace(/\D/g, '');

  if (!p) return null;

  // +97798XXXXXXXX or 97798XXXXXXXX
  if (/^9779[678]\d{8}$/.test(p)) {
    return p;
  }

  // 98XXXXXXXX
  if (/^9[678]\d{8}$/.test(p)) {
    return '977' + p;
  }

  // 09XXXXXXXX
  if (/^09[678]\d{8}$/.test(p)) {
    return '977' + p.slice(1);
  }

  // Any other valid international number
  if (/^[1-9]\d{7,14}$/.test(p)) {
    return p;
  }

  return null;
}

// Nepali mobile numbers only (SMS gateway is Nepal-only) — 977 9[678]XXXXXXXX
function toNepaliSmsNumber(phone) {
  let p = String(phone || '').replace(/\D/g, '');
  if (!p) return null;
  if (/^9779[678]\d{8}$/.test(p)) return '+' + p;
  if (/^9[678]\d{8}$/.test(p)) return '+977' + p;
  if (/^09[678]\d{8}$/.test(p)) return '+977' + p.slice(1);
  return null;
}

async function buildOrderMessage(full) {
  const orderInfo = (full.items || [])
    .map(it => `${it.product_name}${it.variant_name ? ' - ' + it.variant_name : ''}${it.size ? ' ' + it.size : ''} x${it.qty}`)
    .join('\n') || 'Cake order';
  const modLine = [full.dietary_name, full.cream_name, [full.sponge_name, full.theme_name].filter(Boolean).join(' & ')]
    .filter(Boolean).join(' | ');
  const balanceLine = Number(full.balance_due) > 0 ? `Balance Due: Rs. ${Number(full.balance_due).toFixed(2)}` : 'Balance: Paid in full';

  const ps = full.production_status;
  let message;

  if (ps === 'In Production') {
    const template = await dbAll(`SELECT item_key,label FROM cake_production_checklist_template ORDER BY sort_order`);
    const stateRow = await dbGet(`SELECT checklist_json FROM cake_production_state WHERE cake_order_id=?`, [full.id]);
    const doneMap = new Map((stateRow ? JSON.parse(stateRow.checklist_json || '[]') : []).map(c => [c.item_key, c.done]));
    const checklistLines = template.map(t => `${doneMap.get(t.item_key) ? '✅' : '⬜'} ${t.label}`).join('\n');
    message = [
      `Hi ${full.customer_name}, your cake is now in production! 👩‍🍳`,
      full.message_on_cake ? `Message on cake: "${full.message_on_cake}"` : '',
      '',
      `Order No: ${full.order_number}`,
      orderInfo,
      modLine,
      '',
      'Progress:',
      checklistLines,
      '',
      balanceLine,
    ].filter(Boolean).join('\n');
  } else if (ps === 'Ready for Delivery') {
    const template = await dbAll(`SELECT item_key,label FROM cake_production_checklist_template ORDER BY sort_order`);
    const stateRow = await dbGet(`SELECT checklist_json FROM cake_production_state WHERE cake_order_id=?`, [full.id]);
    const doneMap = new Map((stateRow ? JSON.parse(stateRow.checklist_json || '[]') : []).map(c => [c.item_key, c.done]));
    const checklistLines = template.map(t => `${doneMap.get(t.item_key) ? '✅' : '⬜'} ${t.label}`).join('\n');
    const photos = await dbAll(`SELECT image_url FROM cake_production_photos WHERE cake_order_id=? ORDER BY slot_number`, [full.id]);
    message = [
      `Hi ${full.customer_name}, your cake is Ready! 🎉`,
      '',
      `Order No: ${full.order_number}`,
      orderInfo,
      modLine,
      '',
      'Progress:',
      checklistLines,
      full.production_notes ? `Notes: ${full.production_notes}` : '',
      '',
      balanceLine,
      photos.length ? `Photos:\n${photos.map(p => p.image_url).join('\n')}` : '',
    ].filter(Boolean).join('\n');
  } else {
    // New / Acknowledged / unset — order just confirmed
    message = [
      `Hi ${full.customer_name}, your cake order is CONFIRMED!🍰`,
      '',
      `Order No: ${full.order_number}`,
      orderInfo,
      modLine,
      '',
      'Thank you for ordering with Munch Time Cafe!',
      balanceLine,
    ].filter(Boolean).join('\n');
  }

  return message;
}

router.get('/:id/whatsapp-message', async (req, res) => {
  const full = await getFull(req.params.id);
  if (!full) return res.status(404).json({ error: 'Not found' });
  const waNumber = toWhatsAppNumber(full.phone);
  if (!waNumber) return res.status(400).json({ error: 'No phone number on file' });
  if (full.status !== 'CONFIRMED') return res.status(400).json({ error: 'No WhatsApp message available at this stage' });
  res.json({ phone: waNumber, message: await buildOrderMessage(full) });
});

// ═══════════════════════════════════════════════════════════════
//  SMS (TextBee) — Nepal numbers only, same content as WhatsApp
// ═══════════════════════════════════════════════════════════════

async function sendTextBeeSms(phone, message) {
  const apiKey = process.env.TEXTBEE_API_KEY;
  const deviceId = process.env.TEXTBEE_DEVICE_ID;
  if (!apiKey || !deviceId) throw new Error('TextBee not configured — set TEXTBEE_API_KEY and TEXTBEE_DEVICE_ID in server/.env');

  const r = await fetch(`https://api.textbee.dev/api/v1/gateway/devices/${deviceId}/send-sms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ recipients: [phone], message }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || d.message || `TextBee request failed (${r.status})`);
  return d;
}

router.post('/:id/send-sms', async (req, res) => {
  const full = await getFull(req.params.id);
  if (!full) return res.status(404).json({ error: 'Not found' });
  const smsNumber = toNepaliSmsNumber(full.phone);
  if (!smsNumber) return res.status(400).json({ error: 'SMS is only available for Nepalese numbers' });
  if (full.status !== 'CONFIRMED') return res.status(400).json({ error: 'No SMS available at this stage' });

  const message = await buildOrderMessage(full);
  try {
    await sendTextBeeSms(smsNumber, message);
    res.json({ success: true, phone: smsNumber });
  } catch (e) {
    res.status(500).json({ error: e.message || 'SMS send failed' });
  }
});

// ═══════════════════════════════════════════════════════════════
//  Update
// ═══════════════════════════════════════════════════════════════

router.put('/:id', async (req, res) => {
  const existing = await dbGet(`SELECT id,order_number,production_status,advance_paid FROM cake_orders WHERE id=? AND deleted_at IS NULL`, [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.production_status && existing.production_status !== 'New')
    return res.status(400).json({ error: 'Order can no longer be edited — production has already started' });
  const b = req.body;
  if (!b.customer_name?.trim()) return res.status(400).json({ error: 'customer_name required' });
  const newAdvance = parseFloat(b.advance_paid) || 0;

  await transaction(async (tx) => {
    // Advance tenders are restated on edit; follow-up (REGULAR) rows stay untouched.
    const followup = await followupTotal(tx, existing.id);
    const advTenders = Array.isArray(b.advance_payments)
      ? normalizeTenders(b.advance_payments)
      : normalizeTenders(null, b.advance_method, Math.max(0, newAdvance - followup));
    const totalPaid = round2(tendersTotal(advTenders) + followup);
    await tx.dbRun(`
      UPDATE cake_orders SET
        crm_customer_id=?, phone=?, customer_name=?,
        delivery_date=?, delivery_time=?,
        shape_id=?, cream_type_id=?, sponge_type_id=?, theme_id=?, dietary_type_id=?,
        message_on_cake=?, design_notes=?, dietary_notes=?, allergy_notes=?, internal_notes=?, assigned_baker=?,
        discount=?, advance_paid=?, advance_method=?
      WHERE id=?
    `, [
      b.crm_customer_id || null, b.phone?.trim() || null, b.customer_name.trim(),
      b.delivery_date || null, b.delivery_time || null,
      b.shape_id || null, b.cream_type_id || null, b.sponge_type_id || null, b.theme_id || null, b.dietary_type_id || null,
      b.message_on_cake?.trim() || null, b.design_notes?.trim() || null, b.dietary_notes?.trim() || null,
      b.allergy_notes?.trim() || null, b.internal_notes?.trim() || null, b.assigned_baker?.trim() || null,
      parseFloat(b.discount) || 0, totalPaid, advanceMethodLabel(advTenders),
      existing.id,
    ]);
    await saveLines(tx, existing.id, b.items, b.accessories);
    if (Array.isArray(b.images)) {
      await tx.dbRun(`DELETE FROM cake_order_images WHERE cake_order_id=?`, [existing.id]);
      for (const img of b.images) {
        await tx.dbRun(`INSERT INTO cake_order_images (cake_order_id,image_url,image_name) VALUES (?,?,?)`, [existing.id, img.url, img.name || null]);
      }
    }
    await recalc(tx, existing.id);
    // Restate advance payment rows to match the submitted breakdown —
    // debit the till for the rows being replaced so the net effect is new − old
    const oldAdv = await tx.dbAll(`SELECT method, amount FROM pos_payments WHERE cake_order_id=? AND payment_type='ADVANCE'`, [existing.id]);
    const o = tenderSums(oldAdv);
    await creditTill(tx, -o.cash, -o.card, -o.qr);
    await tx.dbRun(`DELETE FROM pos_payments WHERE cake_order_id=? AND payment_type='ADVANCE'`, [existing.id]);
    await insertCakePayments(tx, existing.id, advTenders, 'ADVANCE', 'Advance Payment');
  });
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'CAKE_ORDER', entityId: existing.id, action: 'UPDATE' });
  res.json(await getFull(existing.id));
});

// ═══════════════════════════════════════════════════════════════
//  Status transition
// ═══════════════════════════════════════════════════════════════

const TRANSITIONS = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CANCELLED', 'DELIVERED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

router.patch('/:id/status', async (req, res) => {
  const existing = await dbGet(`SELECT id,status,production_status,delivery_date FROM cake_orders WHERE id=? AND deleted_at IS NULL`, [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { status } = req.body;
  if (!(TRANSITIONS[existing.status] || []).includes(status))
    return res.status(400).json({ error: `Cannot transition ${existing.status} → ${status}` });

  if (status === 'DELIVERED') {
    if (existing.production_status !== 'Ready for Delivery')
      return res.status(400).json({ error: 'Cake is not marked Ready for Delivery yet' });
    if (existing.delivery_date !== await todayLocal())
      return res.status(400).json({ error: `Delivery date (${existing.delivery_date || 'not set'}) does not match today — cannot mark delivered` });
  }

  await transaction(async (tx) => {
    if (status === 'CONFIRMED') {
      await tx.dbRun(`UPDATE cake_orders SET status=?,production_status='New' WHERE id=?`, [status, existing.id]);
    } else {
      await tx.dbRun(`UPDATE cake_orders SET status=? WHERE id=?`, [status, existing.id]);
    }
    await tx.dbRun(`INSERT INTO cake_order_status_history (cake_order_id,old_status,new_status,changed_by) VALUES (?,?,?,?)`, [existing.id, existing.status, status, req.posUser.id]);
  });
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'CAKE_ORDER', entityId: existing.id, action: 'STATUS', delta: { from: existing.status, to: status } });
  socketServer.emitCakeProductionChanged({ cake_order_id: existing.id, kind: 'status' });
  // web-origin cake orders: push the lifecycle change back to the website (no-op otherwise)
  if (status === 'DELIVERED' || status === 'CANCELLED')
    require('../../services/webOrderBridge').notifyCakeOrderEvent(existing.id, status);
  res.json(await getFull(existing.id));
});

// ═══════════════════════════════════════════════════════════════
//  Payment
// ═══════════════════════════════════════════════════════════════

const METHOD_MAP = { Cash: 'CASH', Card: 'CARD', 'QR / UPI': 'QR', QR: 'QR', CASH: 'CASH', CARD: 'CARD', WALLET: 'WALLET', Wallet: 'WALLET', LEDGER: 'LEDGER' };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Accepts split tenders [{method,amount,ref}] or a legacy single method+amount.
// pos_payments.method CHECK only allows CASH|CARD|QR|LEDGER — WALLET rides in CARD with a note (same convention as POS checkout).
function normalizeTenders(payments, legacyMethod, legacyAmount) {
  const list = Array.isArray(payments) && payments.length
    ? payments
    : ((parseFloat(legacyAmount) || 0) > 0 ? [{ method: legacyMethod || 'Cash', amount: legacyAmount }] : []);
  const tenders = [];
  for (const p of list) {
    const amount = round2(p.amount);
    if (amount <= 0) continue;
    const m = METHOD_MAP[p.method] || 'CASH';
    tenders.push({ method: m === 'WALLET' ? 'CARD' : m, amount, ref: p.ref || null, note: m === 'WALLET' ? 'WALLET' : null });
  }
  return tenders;
}

const tendersTotal = (tenders) => round2(tenders.reduce((s, t) => s + t.amount, 0));
const advanceMethodLabel = (tenders) =>
  !tenders.length ? 'CASH' : tenders.length > 1 ? 'SPLIT' : (tenders[0].note === 'WALLET' ? 'WALLET' : tenders[0].method);

function tenderSums(tenders) {
  let cash = 0, card = 0, qr = 0;
  for (const t of tenders) {
    if (t.method === 'CASH') cash += Number(t.amount) || 0;
    if (t.method === 'CARD') card += Number(t.amount) || 0;
    if (t.method === 'QR')   qr   += Number(t.amount) || 0;
  }
  return { cash, card, qr };
}

async function creditTill(tx, cash, card, qr) {
  if (!cash && !card && !qr) return;
  const till = await tx.dbGet(`SELECT id FROM pos_till_sessions WHERE status='OPEN' ORDER BY id DESC LIMIT 1`);
  if (till) await tx.dbRun(`UPDATE pos_till_sessions SET cash_sales=cash_sales+?,card_sales=card_sales+?,qr_sales=qr_sales+? WHERE id=?`, [cash, card, qr, till.id]);
}

async function insertCakePayments(tx, cakeOrderId, tenders, paymentType, label) {
  for (const t of tenders) {
    await tx.dbRun(
      `INSERT INTO pos_payments (cake_order_id, method, amount, payment_type, reference, notes) VALUES (?,?,?,?,?,?)`,
      [cakeOrderId, t.method, t.amount, paymentType, t.ref, t.note || label]
    );
  }
  // Cake money lands in the same drawer — keep till counters in sync
  // (reverts already debit them via transactions.js creditTill)
  const s = tenderSums(tenders);
  await creditTill(tx, s.cash, s.card, s.qr);
}

// Sum of follow-up (REGULAR) payments — includes negative revert rows
async function followupTotal(tx, cakeOrderId) {
  const row = await tx.dbGet(`SELECT COALESCE(SUM(amount),0) AS t FROM pos_payments WHERE cake_order_id=? AND payment_type='REGULAR'`, [cakeOrderId]);
  return row.t || 0;
}

// Payment history for one cake order (WALLET decoded back from CARD+note)
router.get('/:id/payments', async (req, res) => {
  res.json(await dbAll(
    `SELECT id, payment_type,
            CASE WHEN method='CARD' AND notes='WALLET' THEN 'WALLET' ELSE method END AS method,
            amount, reference, notes, created_at
     FROM pos_payments WHERE cake_order_id=? ORDER BY created_at, id`,
    [req.params.id]
  ));
});

// Follow-up payment(s) — split tender, any time after booking until balance cleared
router.patch('/:id/payment', async (req, res) => {
  const row = await dbGet(
    `SELECT id,advance_paid,grand_total,balance_due,customer_name,order_number FROM cake_orders WHERE id=? AND deleted_at IS NULL`,
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  const tenders = normalizeTenders(req.body.payments, req.body.method, req.body.amount);
  const total = tendersTotal(tenders);
  if (total <= 0) return res.status(400).json({ error: 'amount must be > 0' });
  if (total > Number(row.balance_due) + 0.005)
    return res.status(400).json({ error: `Amount exceeds balance due (${Number(row.balance_due).toFixed(2)})` });
  const newAdv = round2(Number(row.advance_paid) + total);
  const newBal = Math.max(0, round2(Number(row.grand_total) - newAdv));
  await transaction(async (tx) => {
    await tx.dbRun(`UPDATE cake_orders SET advance_paid=?,balance_due=? WHERE id=?`, [newAdv, newBal, row.id]);
    await insertCakePayments(tx, row.id, tenders, 'REGULAR', `Follow-up — ${row.order_number} · ${row.customer_name}`);
  });
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'CAKE_ORDER', entityId: row.id, action: 'PAYMENT', delta: { tenders, total, newAdv, newBal } });
  res.json(await getFull(row.id));
});

// ═══════════════════════════════════════════════════════════════
//  Soft delete
// ═══════════════════════════════════════════════════════════════

router.delete('/:id', async (req, res) => {
  const row = await dbGet(`SELECT id FROM cake_orders WHERE id=? AND deleted_at IS NULL`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await dbRun(`UPDATE cake_orders SET deleted_at=CURRENT_TIMESTAMP WHERE id=?`, [row.id]);
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'CAKE_ORDER', entityId: row.id, action: 'DELETE' });
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════
//  ESC/POS Print
// ═══════════════════════════════════════════════════════════════

router.post('/:id/print', async (req, res) => {
  const full = await getFull(req.params.id);
  if (!full) return res.status(404).json({ error: 'Not found' });
  let pcfg;
  try { const { dbGet } = require('../../database/db'); pcfg = await dbGet(`SELECT printer_name,vendor_id,product_id,paper_width FROM printer_config WHERE id=1`); } catch { pcfg = null; }
  if (!pcfg?.vendor_id || !pcfg?.product_id) return res.status(400).json({ error: 'No printer configured.' });

  const W = (pcfg.paper_width >= 80) ? 48 : 32;
  const DIV = '='.repeat(W);
  const div = '-'.repeat(W);
  const lf = '\n';
  const B = s => `\x1B\x45\x01${s}\x1B\x45\x00`;
  const ctr = s => { const sp = Math.max(0, Math.floor((W - s.length) / 2)); return ' '.repeat(sp) + s; };
  const Rs = n => 'Rs.' + Number(n || 0).toFixed(2);
  const o = full;
  const BIG_ON = '\x1D\x21\x11'; // 2x width + 2x height
  const BIG_OFF = '\x1D\x21\x00';


  //const itemLines = (o.items || []).map(it => `${it.product_name}${it.size ? ' ' + it.size : ''} x${it.qty} @ ${Rs(it.rate)} = ${Rs(it.amount)}`).join(lf);
  //const itemLines = (o.items || []).map(it => `${it.product_name}${it.size ? ' ' + it.size : ''}`).join(lf);

  // const itemLines = (o.items || [])
  //   .map(it => `${BIG_ON}${it.product_name}${it.size ? ' ' + it.size : ''}${BIG_OFF}`)
  //   .join(lf);

  // const itemLines = (o.items || []).map(it =>`${BIG_ON}${it.product_name}${it.variant_name ? ' ' + it.variant_name : ''}${it.size ? ' ' + it.size : ''}${BIG_OFF}`).join(lf);

  const itemLines = (o.items || [])
    .map(it => [it.variant_name, it.size].filter(Boolean).join(' '))
    .join(lf);



  // const accLines = (o.accessories || []).map(a => `${a.product_name} x${a.qty} = ${Rs(a.amount)}`).join(lf);
  const accLines = (o.accessories || [])
    .map(a => `${a.variant_name || a.product_name} x${a.qty} = ${Rs(a.amount)}`)
    .join(lf);


  const modParts = [
    o.dietary_name && ` ${o.dietary_name}`,
    o.theme_name && ` ${o.theme_name}`,
    o.cream_name && ` ${o.cream_name}`,
    o.shape_name && ` ${o.shape_name}`,
    o.sponge_name && ` ${o.sponge_name}`
  ].filter(Boolean);

  modParts.length ? modParts.join(lf) + lf : ''


  const text = [
    '\x1B\x40',
    ctr(B('CAKE PRODUCTION ORDER')), lf,
    ctr(DIV), lf, ctr(`ORDER: ${o.order_number}`), lf, ctr(DIV), lf, lf,
    B(o.customer_name || ''), lf,
    o.phone ? `Tel: ${o.phone}${lf}` : '',
    `Delivery: ${o.delivery_date || '—'} ${o.delivery_time || ''}`, lf,
    div, lf,
    itemLines ? itemLines + lf + lf : '',
    modParts.length ? modParts.join(' | ') + lf : '',
    div, lf,
    accLines ? `Accessories:${lf}${accLines}${lf}${lf}` : '',
    o.message_on_cake ? `${BIG_ON}${B(o.message_on_cake)}${BIG_OFF}${lf}` : '', o.design_notes ? `Design Notes: ${o.design_notes}${lf}` : '',
    o.allergy_notes ? `Allergies: ${o.allergy_notes}${lf}` : '',
    div, lf,
    o.modifier_total ? `Modifier Charges : ${Rs(o.modifier_total)}${lf}` : '',
    o.accessory_total ? `Accessories      : ${Rs(o.accessory_total)}${lf}` : '',
    o.discount ? `Discount         : -${Rs(o.discount)}${lf}` : '',
    B(`Grand Total      : ${Rs(o.grand_total)}`), lf,
    `Advance Paid     : ${Rs(o.advance_paid)}`, lf,
    B(`Balance Due      : ${Rs(o.balance_due)}`), lf,
    DIV, lf, ctr(`QR: ${o.order_number}`), lf,
    lf, lf, '\x1D\x56\x00',
  ].join('');

  try {
    await printRawUsingConfig(Buffer.from(text, 'latin1'), 1);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Print failed' });
  }
});

module.exports = router;
