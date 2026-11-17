'use strict';
/**
 * Channel provider registry. Campaign logic never references a concrete
 * provider — it asks the registry for the provider bound to a channel row's
 * `provider` column and calls a uniform interface:
 *
 *   provider.send({ jobId, recipient, subject, message, payload }) =>
 *      { ok, ref?, externalJobId?, deferred?, reason? }
 *
 * Adding a channel (Telegram, Viber, AI Call, …) is a module + a
 * campaign_channels row — no change here and none in the engine/queue.
 */
const { dbAll } = require('../../../database/db');

const registry = new Map();

function register(provider) {
    if (!provider || !provider.key) throw new Error('provider must have a key');
    registry.set(provider.key, provider);
}

function get(key) { return registry.get(key); }

// Built-in providers.
register(require('./smsProvider'));
register(require('./whatsappProvider'));
register(require('./emailProvider'));
register(require('./pushProvider'));
register(require('./telegramProvider'));
register(require('./viberProvider'));
register(require('./aiCallProvider'));

/** Map of channel key -> { provider, is_enabled, config } from the DB. */
async function channelMap() {
    const rows = await dbAll(`SELECT * FROM campaign_channels`);
    const map = {};
    for (const r of rows) {
        map[r.key] = {
            provider: registry.get(r.provider),
            provider_key: r.provider,
            is_enabled: !!r.is_enabled,
            config: safe(r.config),
            label: r.label,
        };
    }
    return map;
}

function safe(v) { try { return typeof v === 'string' ? JSON.parse(v) : (v || {}); } catch { return {}; } }

/** Resolve the delivery recipient for a channel from a customer record. */
function recipientFor(channelKey, customer) {
    switch (channelKey) {
        case 'EMAIL':    return customer.email || null;
        case 'PUSH':     return customer.push_token || customer.phone || null;
        default:         return customer.phone || null;   // SMS / WhatsApp / Telegram / Viber / AI Call
    }
}

module.exports = { register, get, channelMap, recipientFor, registry };
