'use strict';
const { makeWebhookProvider } = require('./webhookProvider');
module.exports = makeWebhookProvider('aicall', ({ recipient, message, cfg }) => ({
    channel: 'ai_call',
    to: recipient,
    script: message,
    voice: cfg.voice || 'default',
    language: cfg.language || 'en',
}));
