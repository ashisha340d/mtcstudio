'use strict';
const { makeWebhookProvider } = require('./webhookProvider');
module.exports = makeWebhookProvider('push', ({ recipient, subject, message, cfg }) => ({
    channel: 'push',
    token: recipient,
    title: subject || cfg.default_title || 'MTC',
    body: message,
}));
