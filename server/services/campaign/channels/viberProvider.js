'use strict';
const { makeWebhookProvider } = require('./webhookProvider');
module.exports = makeWebhookProvider('viber', ({ recipient, message, cfg }) => ({
    channel: 'viber',
    receiver: recipient,
    type: 'text',
    text: message,
    sender: cfg.sender || undefined,
}));
