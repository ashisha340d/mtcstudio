'use strict';
/**
 * SMS channel provider — the one live provider today. Delegates to the
 * centralized SMS service (the single SMS engine); the campaign queue row
 * tracks the returned sms_queue job id as its external reference.
 */
const smsService = require('../../smsService');

module.exports = {
    key: 'sms',
    async send({ recipient, message, payload = {} }) {
        if (!recipient) return { ok: false, reason: 'no phone' };
        const jobId = await smsService.enqueue({
            phone: recipient,
            message,
            customerId: payload.customer_phone || null,
            priority: payload.priority || 5,
            templateId: payload.template_id ? String(payload.template_id) : null,
        });
        // Handed to the SMS engine; delivery is tracked out-of-band by sms_queue.
        return { ok: true, deferred: true, externalJobId: jobId };
    },
};
