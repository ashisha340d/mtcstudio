'use strict';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => { const v = Number(n); return Number.isFinite(v) ? v : NaN; };

function validateSplitTender({ total_amount, discount_amount, cash, qr, wallet, ledger }) {
  const fail = (error) => ({ valid: false, error, paid_amount: 0, change: 0, balance_due: 0 });

  total_amount    = num(total_amount);
  discount_amount = num(discount_amount);
  cash   = num(cash);
  qr     = num(qr);
  wallet = num(wallet);
  ledger = num(ledger);

  if ([total_amount, discount_amount, cash, qr, wallet, ledger].some(Number.isNaN)) {
    return fail('Invalid numeric input');
  }
  if ([cash, qr, wallet, ledger, discount_amount].some((n) => n < 0)) {
    return fail('Amounts cannot be negative');
  }
  if (total_amount <= 0) {
    return fail('total_amount must be greater than zero');
  }
  if (discount_amount > total_amount) {
    return fail('discount_amount cannot exceed total_amount');
  }

  // Rule 1
  const payable = round2(total_amount - discount_amount);

  // Rule 2
  const non_cash = round2(qr + wallet + ledger);
  if (non_cash > payable) {
    return fail('QR + Wallet + Ledger cannot exceed payable amount');
  }

  // Rule 3
  const cash_needed = round2(payable - non_cash);

  // Rule 4
  if (cash < cash_needed) {
    return fail(`Cash short by ${round2(cash_needed - cash).toFixed(2)}`);
  }

  // Rule 5
  const change = round2(cash - cash_needed);

  // Rule 6 — ledger excluded
  const paid_amount = round2(cash + qr + wallet - change);

  // Rule 7
  const balance_due = round2(payable - paid_amount - ledger);

  return { valid: true, error: '', paid_amount, change, balance_due };
}

async function saveSplitTenderOrder(transaction, orderData, payments) {
  const { orderId, total_amount, discount_amount, cash, qr, wallet, ledger } = orderData;

  const result = validateSplitTender({ total_amount, discount_amount, cash, qr, wallet, ledger });
  if (!result.valid) {
    throw new Error(result.error);
  }

  const payable = round2(total_amount - discount_amount);

  const tenders = payments ?? [
    { method: 'CASH',   amount: cash },
    { method: 'QR',     amount: qr },
    { method: 'WALLET', amount: wallet },
    { method: 'LEDGER', amount: ledger },
  ];

  await transaction(async (tx) => {
    for (const t of tenders) {
      const amt = round2(t.amount);
      if (amt <= 0) continue;
      // pos_payments.method CHECK only allows CASH|CARD|QR|LEDGER — WALLET rides in CARD with a note
      const dbMethod = t.method === 'WALLET' ? 'CARD' : t.method;
      const notes = t.method === 'WALLET' ? 'WALLET' : (t.notes ?? null);
      await tx.dbRun(
        `INSERT INTO pos_payments (order_id, method, amount, reference, notes) VALUES (?, ?, ?, ?, ?)`,
        [orderId, dbMethod, amt, t.ref ?? null, notes]
      );
    }

    await tx.dbRun(
      `UPDATE pos_orders
       SET total_amount = ?, paid_amount = ?, discount_amount = ?, change_amount = ?, status = ?, closed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [payable, result.paid_amount, round2(discount_amount), result.change, result.balance_due > 0 ? 'OPEN' : 'CLOSED', orderId]
    );
  });

  return {
    ok: true,
    orderId,
    payable_amount: payable,
    paid_amount: result.paid_amount,
    change_amount: result.change,
    balance_due: result.balance_due,
  };
}

module.exports = { validateSplitTender, saveSplitTenderOrder };
