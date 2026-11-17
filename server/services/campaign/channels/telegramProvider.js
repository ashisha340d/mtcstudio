'use strict';
const { makeWebhookProvider } = require('./webhookProvider');
module.exports = makeWebhookProvider('telegram', ({ recipient, message, cfg }) => ({
    channel: 'telegram',
    chat_id: recipient,
    text: message,
    parse_mode: cfg.parse_mode || 'HTML',
}));
