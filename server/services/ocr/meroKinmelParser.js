'use strict';
// Deterministic parser for Mero Kinmel order images. OCR text -> structured order.
// Real layout:
//   Order No   : 2026178410987J0DL
//   Address    : Milanchok-9, Chitwan
//   Payment    : Cash On Delivery
//   <Vendor Name>        Qty  Rate  Amt
//   Single Smash Burger   1    180   180
//   ...
//   Order Amount :  779.00
// Customer name / phone are not always printed — left null when absent.

function pickLabel(lines, label) {
  // Eat the label then any run of separators/OCR noise (": . _ -" and spaces),
  // e.g. "Address _ : Biryani..." -> "Biryani...".
  const re = new RegExp(`^${label}\\b[\\s:._\\-]*(.+)$`, 'i');
  for (const l of lines) {
    const m = l.match(re);
    if (m) {
      const v = m[1].replace(/^[\s:._\-]+/, '').replace(/\s{2,}/g, ' ').trim();
      if (v) return v;
    }
  }
  return null;
}

function parseAmount(s) {
  if (!s) return 0;
  return parseFloat(String(s).replace(/[^\d.]/g, '')) || 0;
}

// name  qty  rate  amt   (amt optional). Numbers are the trailing columns;
// name is the leading text. Long names may leave only one space before qty, so
// match on the numeric tail (qty small, rate/amt >=2 digits) rather than gaps.
function parseItemLine(line) {
  // 3 columns: qty rate amt
  let m = line.match(/^([A-Za-z].*?)\s+(\d{1,3})\s+([\d,]{2,})\s+([\d,]{2,})\s*$/);
  if (!m) {
    // 2 columns: qty rate (amt = qty*rate)
    m = line.match(/^([A-Za-z].*?)\s+(\d{1,3})\s+([\d,]{2,})\s*$/);
  }
  if (!m) return null;
  const name = m[1].replace(/\s{2,}/g, ' ').replace(/\.{2,}$/, '').trim();
  if (name.length < 3) return null;
  let qty = parseInt(m[2], 10);
  const unitPrice = parseInt(m[3].replace(/[,.]/g, ''), 10);
  const amount = m[4] ? parseInt(m[4].replace(/[,.]/g, ''), 10) : qty * unitPrice;
  // Amount is printed bold and reliable; the small qty digit is often misread.
  // If amount is a clean multiple of the rate, trust amount÷rate for qty.
  if (m[4] && unitPrice > 0 && amount % unitPrice === 0) {
    const dq = amount / unitPrice;
    if (dq >= 1 && dq <= 99) qty = dq;
  }
  return { name, qty, unitPrice, amount };
}

function parse(rawText) {
  const lines = (rawText || '').split('\n').map(l => l.trim()).filter(Boolean);

  const orderNumber = pickLabel(lines, 'Order\\s*No');
  const address = pickLabel(lines, 'Address');
  const payment = pickLabel(lines, 'Payment');
  const phoneRaw = pickLabel(lines, 'Phone') || pickLabel(lines, 'Contact');
  const customerName = pickLabel(lines, 'Customer') || pickLabel(lines, 'Name');
  const phone = phoneRaw ? (phoneRaw.match(/\d[\d\s-]{6,}\d/)?.[0]?.replace(/\D/g, '') ?? null) : null;

  // Vendor sits on the column-header line ("<Vendor>  Qty  Rate  Amt"), or the
  // line just above it. Strip the column labels to isolate the name.
  const headerIdx = lines.findIndex(l => /Qty\s+Rate\s+Amt/i.test(l));
  let vendor = null;
  if (headerIdx >= 0) {
    const inline = lines[headerIdx].replace(/Qty\s+Rate\s+Amt.*$/i, '').replace(/\s{2,}/g, ' ').trim();
    vendor = inline || (headerIdx > 0 ? lines[headerIdx - 1].replace(/\s{2,}/g, ' ').trim() : null);
  }

  // Body = the item rows only: between the column header and the total line.
  // We keep just NAME + QTY per row — rate/price comes from product matching.
  const footerIdx = lines.findIndex((l, i) =>
    i > headerIdx && /Order\s*Amount|Grand\s*Total|Sub\s*Total|^Total\b/i.test(l));
  const bodyStart = headerIdx >= 0 ? headerIdx + 1 : 0;
  const bodyEnd = footerIdx >= 0 ? footerIdx : lines.length;

  const items = [];
  for (const line of lines.slice(bodyStart, bodyEnd)) {
    const it = parseItemLine(line);
    if (it) items.push({ name: it.name, qty: it.qty });   // only Name + Qty
  }

  const totalLabel = pickLabel(lines, 'Order\\s*Amount') || pickLabel(lines, 'Grand\\s*Total') || pickLabel(lines, 'Total');
  const printedTotal = parseAmount(totalLabel);

  // ── Confidence (name+qty focus) ────────────────────────────
  let confidence = 0;
  if (orderNumber) confidence += 0.4;
  if (items.length > 0) confidence += 0.6;
  confidence = Math.min(1, Number(confidence.toFixed(2)));

  return {
    orderNumber,
    vendor,
    customerName,
    phone,
    address,
    payment,
    items,               // [{ name, qty }]
    notes: null,
    deliveryInfo: address,
    printedTotal,
    confidence,
  };
}

module.exports = { parse };
