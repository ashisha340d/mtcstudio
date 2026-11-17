'use strict';
// Orchestrates: image -> OCR -> Mero Kinmel parse -> product resolve -> DRAFT
// order. Modular so other platforms can reuse the same pipeline (swap parser).
// Business logic lives here, NOT in the OCR engine. Never discards an image.
const fs = require('fs');
const crypto = require('crypto');
const { dbGet, dbRun } = require('../../pos/db');
const cmsDb = require('../../database/db');
const socketServer = require('../../pos/socketServer');
const ocrEngine = require('./ocrEngine');
const meroKinmelParser = require('./meroKinmelParser');
const foodmanduParser = require('./foodmanduParser');
const orderResolver = require('./orderResolver');

// Read lazily — the env injector may not have populated process.env at module load.
function draftThreshold() {
  return Number((process.env && process.env.OCR_DRAFT_THRESHOLD) || 0.6);
}
// Mero Kinmel receipts carry no customer phone — all orders map to the platform's
// number. Payment is always on ledger. Override via env if it ever changes.
function mkDefaultPhone() {
  return (process.env && process.env.MK_DEFAULT_PHONE) || '9855046301';
}

// File Maintenance → Mero Kinmel settings (receipt_config). Read per import so a
// mode change takes effect without a restart. Defaults mirror settings.js.
const MERO_DEFAULTS = {
  mk_import_mode: 'DRAFT', mk_min_confidence: '0.6',
  mk_require_total_match: '1', mk_require_all_matched: '1',
};
async function meroConfig() {
  try {
    const rows = await cmsDb.dbAll("SELECT `key`, value FROM receipt_config WHERE `key` LIKE 'mk_%'");
    const cfg = { ...MERO_DEFAULTS };
    rows.forEach(r => { if (r.value != null && r.value !== '') cfg[r.key] = String(r.value); });
    return cfg;
  } catch { return { ...MERO_DEFAULTS }; }
}

function md5File(p) {
  return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
}

async function setStatus(id, status, extra = {}) {
  const fields = ['status = ?'];
  const vals = [status];
  for (const [k, v] of Object.entries(extra)) { fields.push(`${k} = ?`); vals.push(v); }
  vals.push(id);
  await dbRun(`UPDATE pos_ocr_imports SET ${fields.join(', ')} WHERE id = ?`, vals);
  socketServer.emitOcrImport({ importId: id, stage: status, ...publicExtra(extra) });
}
function publicExtra(e) {
  const { raw_text, parsed_json, ...rest } = e; // don't push blobs over socket
  return rest;
}

// Parsers registry — extend per platform.
const PARSERS = { 'Mero Kinmel': meroKinmelParser, 'Foodmandu': foodmanduParser };

async function process({ imagePath = null, filename = null, rawText = null, source = 'WhatsApp Business', platform = 'Mero Kinmel', notificationTs = null }) {
  const parser = PARSERS[platform] || meroKinmelParser;
  const preParsed = rawText == null ? null : parser.parse(rawText);
  const hash = rawText == null ? md5File(imagePath) : crypto.createHash('md5')
    .update(preParsed?.orderNumber ? `${platform}:${preParsed.orderNumber}` : rawText).digest('hex');
  const isFoodmandu = platform === 'Foodmandu';

  // Duplicate image or Foodmandu order already handled → ignore (return existing record).
  const dup = await dbGet(`SELECT id, status, scheduled_order_id FROM pos_ocr_imports WHERE image_hash = ?`, [hash]);
  if (dup) return { duplicate: true, importId: dup.id, status: dup.status, scheduledOrderId: dup.scheduled_order_id };

  // Date is always NOW — no date parsing/filtering on the slip.
  const ins = await dbRun(
    `INSERT INTO pos_ocr_imports (source, platform, image_filename, image_hash, notification_ts, status)
     VALUES (?,?,?,?, NOW(), 'RECEIVED')`,
    [source, platform, filename, hash]
  );
  const importId = ins.insertId;
  socketServer.emitOcrImport({ importId, stage: 'RECEIVED', platform, filename });

  try {
    let text = rawText;
    let ms = 0;
    if (text == null) {
      await setStatus(importId, 'OCR');
      const extracted = await ocrEngine.extractText(imagePath);
      text = extracted.text;
      ms = extracted.ms;
    }

    // ── Parse ──
    const parsed = preParsed || parser.parse(text);
    await setStatus(importId, 'PARSED', {
      ocr_ms: ms, raw_text: text, parsed_json: JSON.stringify(parsed),
      parser_confidence: parsed.confidence,
    });

    // ── Resolve products ──
    const { cart, unresolved, matchConfidence } = await orderResolver.resolve(parsed.items || []);
    const overall = Number((0.6 * parsed.confidence + 0.4 * matchConfidence).toFixed(2));

    // ── Trustworthiness gate (File Maintenance → Mero Kinmel) ──
    // Confidence alone is NOT sufficient: it scores name similarity only, and
    // sits at 1.0 even when qty/price are wrong. The slip total is the real
    // correctness proof — prices come from our DB, so a matching total means
    // qty and price both reconcile. Anything untrusted becomes MK-REVIEW.
    const cfg = await meroConfig();
    const importMode = isFoodmandu ? (globalThis.process.env.FOODMANDU_IMPORT_MODE || 'ORDER') : cfg.mk_import_mode;
    const computedTotal = cart.reduce((s, i) => s + (Number(i.unit_price) || 0) * (Number(i.quantity) || 0), 0);
    const slipTotal = parsed.printedTotal != null ? Number(parsed.printedTotal) : null;
    const totalMatches = slipTotal != null && Math.abs(computedTotal - slipTotal) < 0.5;

    const distrust = [];
    if (overall < Number(cfg.mk_min_confidence)) distrust.push(`confidence ${overall} < ${cfg.mk_min_confidence}`);
    if (!cart.length) distrust.push('no items parsed');
    if (cfg.mk_require_all_matched === '1' && unresolved.length) distrust.push(`${unresolved.length} unmatched item(s)`);
    if (cfg.mk_require_total_match === '1') {
      if (slipTotal == null) distrust.push('slip total missing');
      else if (!totalMatches) distrust.push(`total Rs ${computedTotal} != slip Rs ${slipTotal}`);
    }
    const trustworthy = distrust.length === 0;
    const clean = trustworthy;

    // ── Always create a DRAFT (never discard). Flag review when unclean. ──
    // Mero Kinmel: no date/phone/payment on the slip. Order date = received time,
    // phone = platform number, payment = LEDGER, order number saved in the memo.
    // Total from matched DB prices (rate comes from the product, not the slip).
    // The slip's own total is kept in the memo for the cashier's reference.
    const total = cart.reduce((s, i) => s + (Number(i.unit_price) || 0) * (Number(i.quantity) || 0), 0);
    const customerName = parsed.customerName || (isFoodmandu ? 'Foodmandu' : 'Mero Kinmel');
    const caption = isFoodmandu ? 'FM' : 'MK';
    const notesParts = [
      parsed.orderNumber ? `${isFoodmandu ? 'Foodmandu' : 'MK'} Order #${parsed.orderNumber}` : null,
      parsed.address ? `Addr: ${parsed.address}` : null,
      parsed.rider ? `Rider: ${parsed.rider}` : null,
      'Pay: LEDGER',
      parsed.printedTotal ? `Slip total: Rs ${parsed.printedTotal}` : null,
      unresolved.length ? `Unmatched: ${unresolved.join('; ')}` : null,
      distrust.length ? `Review: ${distrust.join('; ')}` : null,
    ].filter(Boolean);

    const draft = await dbRun(
      `INSERT INTO pos_scheduled_orders
         (kind, order_type, customer_name, customer_phone, order_notes, order_caption, items_json, total_amount, created_by)
       VALUES ('DRAFT','DELIVERY',?,?,?,?,?,?,NULL)`,
      [customerName, parsed.phone || (isFoodmandu ? (globalThis.process.env.FOODMANDU_DEFAULT_PHONE || null) : mkDefaultPhone()),
       notesParts.join(' | ') || null,
       clean ? caption : `${caption}-REVIEW`, JSON.stringify(cart), total]
    );
    const scheduledOrderId = draft.insertId;

    // ── ORDER mode: trustworthy imports go straight to the kitchen ──
    // Untrustworthy always stays a draft, whatever the mode is set to.
    let order = null;
    if (importMode === 'ORDER' && trustworthy) {
      try {
        const { convertRow } = require('../../routes/pos/scheduled');   // lazy — avoids require cycle
        const row = await dbGet(`SELECT * FROM pos_scheduled_orders WHERE id = ?`, [scheduledOrderId]);
        order = await convertRow(row, null);
      } catch (e) {
        // Conversion failed (e.g. no open business day) — leave it as a draft.
        console.warn(`[ocr] auto-order for draft #${scheduledOrderId} failed:`, e.message);
      }
    }

    const finalStatus = clean ? 'DRAFTED' : 'MANUAL_REVIEW';
    await setStatus(importId, finalStatus, {
      parser_confidence: parsed.confidence,
      match_confidence: matchConfidence,
      overall_confidence: overall,
      scheduled_order_id: scheduledOrderId,
    });

    // Draft is live in pos_scheduled_orders — tell POS to load its cards now.
    socketServer.emitScheduledChanged({
      scheduledOrderId, kind: 'DRAFT',
      caption: clean ? caption : `${caption}-REVIEW`, review: !clean,
      customerName,
      total, orderNumber: parsed.orderNumber || null,
      orderId: order ? order.id : null,
    });

    return {
      importId, status: finalStatus, scheduledOrderId,
      orderId: order ? order.id : null, mode: importMode,
      confidence: overall, parserConfidence: parsed.confidence, matchConfidence,
      trustworthy, distrust,
      itemCount: cart.length, unresolved, ocrMs: ms, orderNumber: parsed.orderNumber,
    };
  } catch (err) {
    await setStatus(importId, 'FAILED', { error: String(err.message || err) });
    return { importId, status: 'FAILED', error: String(err.message || err) };
  }
}

module.exports = { process };
