'use strict';
// Reusable message builders — one per MTC Studio module. Modules never hand-write
// SMS text: they call smsService.enqueueTemplate('<id>', data) and the same
// rendering lives here. Add future modules as new keys; nothing else changes.
const rs = (n) => `Rs.${Number(n || 0).toLocaleString('en-IN')}`;

module.exports = {
  order_confirmation:    (d) => `Hi ${d.name || 'there'}, your MTC order #${d.orderId} is confirmed. Total ${rs(d.amount)}. Thank you!`,
  otp:                   (d) => `${d.code} is your MTC verification code. Valid 5 minutes. Do not share it with anyone.`,
  customer_verification: (d) => `${d.code} is your MTC verification code to confirm your number.`,
  delivery_notification: (d) => `Your MTC order #${d.orderId} is out for delivery${d.eta ? ` (ETA ${d.eta})` : ''}.`,
  payment_reminder:      (d) => `Reminder: ${rs(d.amount)} is due on your MTC account. Please clear at your convenience.`,
  cake_ready:            (d) => `Good news ${d.name || ''}! Your cake order ${d.orderNumber} is ready for pickup at MTC.`,
  reservation_reminder:  (d) => `Reminder: your MTC reservation is on ${d.date}${d.time ? ` at ${d.time}` : ''}. See you soon!`,
  marketing_broadcast:   (d) => d.message,
  birthday_wishes:       (d) => `Happy Birthday ${d.name || ''}! 🎂 Enjoy a treat on us at MTC today.`,
  promotion:             (d) => d.message,
  custom:                (d) => d.message,
};
