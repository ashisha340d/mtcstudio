'use strict';

function money(value) {
  const m = String(value || '').match(/^Rs\.?\s*([\d,]+(?:\.\d+)?)\s*$/i);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

function parse(rawText) {
  const lines = String(rawText || '').split('\n').map(l => l.trim()).filter(Boolean);
  const orderLine = lines.find(l => /#?\d{2}(?:-\d+){2,}/.test(l));
  const orderNumber = orderLine?.match(/#?(\d{2}(?:-\d+){2,})/)?.[1] || null;
  const itemsStart = lines.findIndex(l => /^Order Items$/i.test(l));
  const subtotalAt = lines.findIndex((l, i) => i > itemsStart && /^Sub\s*Total$/i.test(l));
  const bodyEnd = subtotalAt >= 0 ? subtotalAt : lines.length;
  const items = [];

  for (let i = itemsStart + 1; itemsStart >= 0 && i < bodyEnd; i++) {
    const unitPrice = money(lines[i]);
    const qty = lines[i + 1]?.match(/^x\s*(\d{1,3})$/i)?.[1];
    const name = lines[i - 1]?.trim();
    if (unitPrice == null || !qty || !name || /^(Order Items|Special Items)$/i.test(name)) continue;
    const amount = money(lines[i + 2]);
    items.push({ name, qty: Number(qty), unitPrice, amount: amount ?? unitPrice * Number(qty) });
    if (amount != null) i += 2;
    else i += 1;
  }

  const printedTotal = subtotalAt >= 0 ? money(lines[subtotalAt + 1]) : null;
  const riderAt = lines.findIndex(l => /^Rider Details$/i.test(l));
  const rider = riderAt >= 0 ? lines[riderAt + 1] || null : null;
  let confidence = 0;
  if (orderNumber) confidence += 0.4;
  if (items.length) confidence += 0.5;
  if (printedTotal != null) confidence += 0.1;

  return {
    orderNumber,
    vendor: 'Foodmandu',
    customerName: null,
    phone: null,
    address: null,
    payment: 'LEDGER',
    items,
    notes: null,
    deliveryInfo: null,
    printedTotal,
    rider,
    confidence: Number(confidence.toFixed(2)),
  };
}

module.exports = { parse };
