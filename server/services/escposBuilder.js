'use strict';

// ── ESC/POS byte constants ────────────────────────────────────────
const ESC = 0x1B;
const GS = 0x1D;

const CMD = {
  INIT: Buffer.from([ESC, 0x40]),
  ALIGN_LEFT: Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER: Buffer.from([ESC, 0x61, 0x01]),
  ALIGN_RIGHT: Buffer.from([ESC, 0x61, 0x02]),
  BOLD_ON: Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF: Buffer.from([ESC, 0x45, 0x00]),
  SIZE_NORMAL: Buffer.from([GS, 0x21, 0x00]),
  SIZE_TALL: Buffer.from([GS, 0x21, 0x01]),   // double height
  SIZE_LARGE: Buffer.from([GS, 0x21, 0x11]),   // double h + w
  FEED3: Buffer.from([ESC, 0x64, 0x03]),   // feed 3 lines before cut
  CUT: Buffer.from([GS, 0x56, 0x42, 0x00]), // partial cut
};

// ── Helpers ───────────────────────────────────────────────────────
function padEnd(str, len) {
  const s = String(str ?? '').substring(0, len);
  return s + ' '.repeat(len - s.length);
}
function padStart(str, len) {
  const s = String(str ?? '').substring(0, len);
  return ' '.repeat(len - s.length) + s;
}
function center(str, width) {
  const s = String(str ?? '');
  if (s.length >= width) return s.substring(0, width);
  const l = Math.floor((width - s.length) / 2);
  return ' '.repeat(l) + s;
}
function kv(label, value, width) {
  const l = String(label ?? '');
  const v = String(value ?? '');
  const sp = width - l.length - v.length;
  return sp > 0 ? l + ' '.repeat(sp) + v : (l + v).substring(0, width);
}
function money(n) { return String(Math.round(Number(n || 0))); }
function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kathmandu', hour12: false,
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(iso ?? ''); }
}

// ── Main builder ──────────────────────────────────────────────────
function buildEscPos({ order = {}, items = [], payments = [], isReprint = false }, config = {}) {


  const W = Number(config.paper_width_mm) === 58 ? 32 : 48;
  console.log('config=', config);
  const DASH = '-'.repeat(W);
  const EQ = '='.repeat(W);

  const parts = [];
  const b = (buf) => parts.push(buf);
  const ln = (str) => parts.push(Buffer.from(String(str ?? '') + '\n', 'latin1'));
  const lnc = (...cmds) => { cmds.forEach(c => b(c)); };

  // ── Init ────────────────────────────────────────────────────
  b(CMD.INIT);

  // ── Logo ASCII ──────────────────────────────────────────────
  if (String(config.show_logo) === '1' && config.logo_text) {
    b(CMD.ALIGN_CENTER);
    String(config.logo_text).split('\n').forEach(l => ln(l));
  }

  // ── Org Name (large centered bold) ──────────────────────────
  b(CMD.ALIGN_CENTER); b(CMD.BOLD_ON); b(CMD.SIZE_LARGE);
  ln(config.org_name || 'MTC STUDIO');
  b(CMD.SIZE_NORMAL); b(CMD.BOLD_OFF);

  if (config.custom_header_line) { b(CMD.ALIGN_CENTER); ln(config.custom_header_line); }
  if (config.org_address) { b(CMD.ALIGN_CENTER); ln(config.org_address); }
  if (config.org_phone) { b(CMD.ALIGN_CENTER); ln('Tel: ' + config.org_phone); }
  if (config.org_email) { b(CMD.ALIGN_CENTER); ln(config.org_email); }
  if (config.org_gstin) { b(CMD.ALIGN_CENTER); ln('GSTIN: ' + config.org_gstin); }
  if (config.org_pan) { b(CMD.ALIGN_CENTER); ln('PAN: ' + config.org_pan); }

  b(CMD.ALIGN_LEFT);
  ln(DASH);

  // ── Reprint flag ─────────────────────────────────────────────
  if (isReprint) {
    b(CMD.ALIGN_CENTER); b(CMD.BOLD_ON);
    ln('*** REPRINT ***');
    b(CMD.BOLD_OFF); b(CMD.ALIGN_LEFT);
  }

  // ── Order meta ───────────────────────────────────────────────
  ln(kv('Receipt #:', String(order.id ?? '-'), W));
  ln(kv('Date/Time:', fmtDate(order.created_at), W));
  if (String(config.show_order_type) !== '0') {
    ln(kv('Type:', (order.order_type || '').replace(/_/g, ' '), W));
  }
  if (String(config.show_table) !== '0' && order.table_name) {
    ln(kv('Table:', order.table_name, W));
  }

  ln(DASH);

  ln(kv('Customer:', order.customer_name || 'Walk-in', W));
  if (String(config.show_customer_phone) !== '0' && order.customer_phone) {
    ln(kv('Phone:', order.customer_phone, W));
  }

  ln(DASH);

  // ── Items table ───────────────────────────────────────────────
  // Columns: name | qty | rate | amt
  const C = W === 32
    ? { name: 16, qty: 3, rate: 7, amt: 6 }
    : { name: 22, qty: 4, rate: 11, amt: 11 };

  b(CMD.BOLD_ON);
  parts.push(Buffer.from(
    padEnd('Item', C.name) + padStart('Qty', C.qty) + padStart('Rate', C.rate) + padStart('Amt', C.amt) + '\n',
    'latin1'
  ));
  b(CMD.BOLD_OFF);
  ln(DASH);

  for (const item of items) {
    if (item.status === 'CANCELLED') continue;
    const name = String(item.product_name || '');
    const qty = String(item.quantity ?? 1);
    const rate = money(item.unit_price);
    const amt = money((item.unit_price ?? 0) * (item.quantity ?? 1));

    if (name.length <= C.name) {
      parts.push(Buffer.from(
        padEnd(name, C.name) + padStart(qty, C.qty) + padStart(rate, C.rate) + padStart(amt, C.amt) + '\n',
        'latin1'
      ));
    } else {
      // Wrap: first chunk on its own line, rest + numbers on next
      parts.push(Buffer.from(name.substring(0, C.name) + '\n', 'latin1'));
      parts.push(Buffer.from(
        padEnd(name.substring(C.name), C.name) + padStart(qty, C.qty) + padStart(rate, C.rate) + padStart(amt, C.amt) + '\n',
        'latin1'
      ));
    }
    if (item.notes) {
      parts.push(Buffer.from('  > ' + String(item.notes).substring(0, W - 4) + '\n', 'latin1'));
    }
  }

  ln(EQ);

  // ── Total ─────────────────────────────────────────────────────
  b(CMD.BOLD_ON); b(CMD.SIZE_TALL);
  ln(kv('TOTAL:', 'Rs.' + money(order.total_amount ?? 0), W));
  b(CMD.SIZE_NORMAL); b(CMD.BOLD_OFF);

  // ── Payments ──────────────────────────────────────────────────
  if (payments && payments.length) {
    ln(DASH);
    for (const p of payments) {
      ln(kv((p.method || 'CASH') + ':', 'Rs.' + money(p.amount), W));
    }
    const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const due = Number(order.total_amount ?? 0);
    if (due - paid > 0.005) {
      b(CMD.BOLD_ON);
      ln(kv('BALANCE DUE:', 'Rs.' + money(due - paid), W));
      b(CMD.BOLD_OFF);
    }
    if (paid - due > 0.005) {
      ln(kv('CHANGE:', 'Rs.' + money(paid - due), W));
    }
  }

  ln(DASH);

  // ── Footer ────────────────────────────────────────────────────
  b(CMD.ALIGN_CENTER);
  if (config.custom_footer_line) ln(config.custom_footer_line);
  b(CMD.BOLD_ON);
  ln(config.org_tagline || 'Thank You! Visit Again');
  b(CMD.BOLD_OFF);
  if (config.receipt_footer) ln(config.receipt_footer);
  ln('Printed: ' + fmtDate(new Date().toISOString()));

  // ── Feed & Cut ────────────────────────────────────────────────
  b(CMD.FEED3);
  b(CMD.CUT);

  return Buffer.concat(parts);
}

module.exports = { buildEscPos };
