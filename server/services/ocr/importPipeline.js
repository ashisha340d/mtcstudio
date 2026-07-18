'use strict';
// Orchestrates: image -> OCR -> Mero Kinmel parse -> product resolve -> DRAFT
// order. Modular so other platforms can reuse the same pipeline (swap parser).
// Business logic lives here, NOT in the OCR engine. Never discards an image.
const fs = require('fs');
const crypto = require('crypto');
const { dbGet, dbRun } = require('../../pos/db');
const socketServer = require('../../pos/socketServer');
const ocrEngine = require('./ocrEngine');
const meroKinmelParser = require('./meroKinmelParser');
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
const PARSERS = { 'Mero Kinmel': meroKinmelParser };

async function process({ imagePath, filename, source = 'WhatsApp Business', platform = 'Mero Kinmel', notificationTs = null }) {
  const hash = md5File(imagePath);

  // Duplicate image already handled → ignore (return existing record).
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
    // ── OCR ──
    await setStatus(importId, 'OCR');
    const { text, ms } = await ocrEngine.extractText(imagePath);

    // ── Parse ──
    const parser = PARSERS[platform] || meroKinmelParser;
    const parsed = parser.parse(text);
    await setStatus(importId, 'PARSED', {
      ocr_ms: ms, raw_text: text, parsed_json: JSON.stringify(parsed),
      parser_confidence: parsed.confidence,
    });

    // ── Resolve products ──
    const { cart, unresolved, matchConfidence } = await orderResolver.resolve(parsed.items || []);
    const overall = Number((0.6 * parsed.confidence + 0.4 * matchConfidence).toFixed(2));
    const clean = overall >= draftThreshold() && cart.length > 0 && unresolved.length === 0;

    // ── Always create a DRAFT (never discard). Flag review when unclean. ──
    // Mero Kinmel: no date/phone/payment on the slip. Order date = received time,
    // phone = platform number, payment = LEDGER, order number saved in the memo.
    // Total from matched DB prices (rate comes from the product, not the slip).
    // The slip's own total is kept in the memo for the cashier's reference.
    const total = cart.reduce((s, i) => s + (Number(i.unit_price) || 0) * (Number(i.quantity) || 0), 0);
    const notesParts = [
      parsed.orderNumber ? `MK Order #${parsed.orderNumber}` : null,
      parsed.address ? `Addr: ${parsed.address}` : null,
      'Pay: LEDGER',
      parsed.printedTotal ? `Slip total: Rs ${parsed.printedTotal}` : null,
      unresolved.length ? `Unmatched: ${unresolved.join('; ')}` : null,
    ].filter(Boolean);

    const draft = await dbRun(
      `INSERT INTO pos_scheduled_orders
         (kind, order_type, customer_name, customer_phone, order_notes, order_caption, items_json, total_amount, created_by)
       VALUES ('DRAFT','DELIVERY',?,?,?,?,?,?,NULL)`,
      [parsed.customerName || 'Mero Kinmel', parsed.phone || mkDefaultPhone(),
       notesParts.join(' | ') || null,
       clean ? 'MK' : 'MK-REVIEW', JSON.stringify(cart), total]
    );
    const scheduledOrderId = draft.insertId;

    const finalStatus = clean ? 'DRAFTED' : 'MANUAL_REVIEW';
    await setStatus(importId, finalStatus, {
      parser_confidence: overall, scheduled_order_id: scheduledOrderId,
    });

    // Draft is live in pos_scheduled_orders — tell POS to load its cards now.
    socketServer.emitScheduledChanged({
      scheduledOrderId, kind: 'DRAFT',
      caption: clean ? 'MK' : 'MK-REVIEW', review: !clean,
      customerName: parsed.customerName || 'Mero Kinmel',
      total, orderNumber: parsed.orderNumber || null,
    });

    return {
      importId, status: finalStatus, scheduledOrderId,
      confidence: overall, parserConfidence: parsed.confidence, matchConfidence,
      itemCount: cart.length, unresolved, ocrMs: ms, orderNumber: parsed.orderNumber,
    };
  } catch (err) {
    await setStatus(importId, 'FAILED', { error: String(err.message || err) });
    return { importId, status: 'FAILED', error: String(err.message || err) };
  }
}

module.exports = { process };
