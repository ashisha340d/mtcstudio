'use strict';
const { makeWebhookProvider } = require('./webhookProvider');
module.exports = makeWebhookProvider('email', ({ recipient, subject, message, cfg }) => ({
    channel: 'email',
    to: recipient,
    from: cfg.from || undefined,
    subject: subject || cfg.default_subject || 'MTC',
    html: message,
    text: message,
}));
