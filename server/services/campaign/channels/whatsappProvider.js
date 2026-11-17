'use strict';
const { makeWebhookProvider } = require('./webhookProvider');
module.exports = makeWebhookProvider('whatsapp', ({ recipient, message, cfg }) => ({
    channel: 'whatsapp',
    to: recipient,
    type: 'text',
    text: { body: message },
    from: cfg.from || undefined,
}));
