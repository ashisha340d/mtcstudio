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
    if (item.discount_amount > 0) {
      const gross = (item.unit_price ?? 0) * (item.quantity ?? 1);
      const pct = gross > 0 ? Math.round((item.discount_amount / gross) * 100) : 0;
      const label = pct >= 100 ? 'FOC' : pct + '%';
      parts.push(Buffer.from(
        '  -Rs.' + money(item.discount_amount) + ' ' + (item.discount_type || '') + ' @ ' + label + '\n',
        'latin1'
      ));
    }
  }

  ln(EQ);

  // ── Discount & Total ─────────────────────────────────────────
  const orderDiscount = Number(order.discount_amount || 0);
  const netTotal = (order.total_amount ?? 0) - orderDiscount;
  if (orderDiscount > 0) {
    ln(kv('Discount:', '-Rs.' + money(orderDiscount), W));
  }
  b(CMD.BOLD_ON); b(CMD.SIZE_TALL);
  ln(kv('TOTAL:', 'Rs.' + money(netTotal), W));
  b(CMD.SIZE_NORMAL); b(CMD.BOLD_OFF);

  // ── Payments ──────────────────────────────────────────────────
  if (payments && payments.length) {
    ln(DASH);
    for (const p of payments) {
      ln(kv((p.method || 'CASH') + ':', 'Rs.' + money(p.amount), W));
    }
    const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const due = netTotal;
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

// ── Daily Cash Closing report ─────────────────────────────────────
function money2(n) {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtTime12(ts) {
  if (!ts) return '—';
  try {
    return new Date(String(ts).replace(' ', 'T') + (String(ts).includes('Z') ? '' : '+05:45'))
      .toLocaleTimeString('en-IN', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit', hour12: true });
  } catch { return String(ts); }
}

function buildCashClosingEscPos(d = {}, config = {}) {
  const W = Number(config.paper_width) === 58 || Number(config.paper_width_mm) === 58 ? 32 : 48;
  const DASH = '-'.repeat(W);
  const EQ = '='.repeat(W);

  const parts = [];
  const b = (buf) => parts.push(buf);
  const ln = (str) => parts.push(Buffer.from(String(str ?? '') + '\n', 'latin1'));
  const npr = (n) => 'NPR ' + money2(n);

  b(CMD.INIT);
  b(CMD.ALIGN_CENTER); b(CMD.BOLD_ON); b(CMD.SIZE_TALL);
  ln(config.org_name || 'MUNCH TIME CAFE');
  b(CMD.SIZE_NORMAL);
  ln('DAILY CASH CLOSING');
  b(CMD.BOLD_OFF); b(CMD.ALIGN_LEFT);
  ln(EQ);
  ln(kv('Business Date :', d.business_date ?? '—', W));
  ln(kv('Terminal :', d.terminal || 'POS-01', W));
  ln(DASH);
  ln('OPENING');
  ln(DASH);
  ln(kv('Time :', fmtTime12(d.opened_at), W));
  ln(kv('Opened By :', d.opened_by_name || '—', W));
  ln(kv('Opening Cash :', npr(d.opening_float), W));
  ln(DASH);
  ln('CASH ACTIVITY');
  ln(DASH);
  ln(kv('Cash Sales :', npr(d.cash_sales), W));
  ln(kv('Cash In :', npr(d.cash_in), W));
  for (const m of d.cash_in_list || []) {
    ln('  + ' + padEnd((m.reason || m.type || '').replace(/_/g, ' '), W - 16) + padStart(money2(m.amount), 12));
  }
  ln(kv('Cash Out :', npr(d.cash_out), W));
  for (const m of d.cash_out_list || []) {
    ln('  - ' + padEnd((m.reason || m.type || '').replace(/_/g, ' '), W - 16) + padStart(money2(m.amount), 12));
  }
  ln(DASH);
  ln('EXPECTED CASH');
  ln(DASH);
  ln(kv('Opening Cash :', npr(d.opening_float), W));
  ln(kv('Cash Sales :', npr(d.cash_sales), W));
  ln(kv('Cash In :', npr(d.cash_in), W));
  ln(kv('Cash Out :', 'NPR -' + money2(d.cash_out), W));
  ln(DASH);
  b(CMD.BOLD_ON);
  ln(kv('Expected Cash :', npr(d.expected), W));
  b(CMD.BOLD_OFF);
  ln(DASH);
  ln('DENOMINATION COUNT');
  ln(DASH);
  for (const row of d.denominations || []) {
    if (!row.qty) continue;
    ln(padStart(String(row.denom), 5) + ' x ' + padStart(String(row.qty), 4) + ' = ' + padStart('NPR ' + money2(row.denom * row.qty), W - 15));
  }
  ln(DASH);
  b(CMD.BOLD_ON);
  ln(kv('Counted Cash :', npr(d.counted), W));
  ln(kv('Variance :', (Number(d.variance) < 0 ? 'NPR -' : 'NPR ') + money2(Math.abs(d.variance)), W));
  b(CMD.BOLD_OFF);
  if (d.cash_taken != null) {
    ln(kv('Cash Taken :', 'NPR -' + money2(d.cash_taken), W));
    b(CMD.BOLD_ON);
    ln(kv('Closing Balance :', npr(d.closing_balance), W));
    b(CMD.BOLD_OFF);
  }
  if (d.closing_note) { ln(DASH); ln('Note: ' + String(d.closing_note).substring(0, W * 3)); }
  ln(DASH);
  ln('CLOSED');
  ln(DASH);
  ln(kv('Time :', fmtTime12(d.closed_at), W));
  ln(kv('Closed By :', d.closed_by_name || '—', W));
  ln(EQ);
  b(CMD.ALIGN_CENTER);
  ln('END OF REPORT');
  b(CMD.ALIGN_LEFT);
  ln(EQ);
  b(CMD.FEED3);
  b(CMD.CUT);
  return Buffer.concat(parts);
}

module.exports = { buildEscPos, buildCashClosingEscPos };
