'use strict';
/**
 * Shared base for providers that deliver by POSTing a JSON envelope to a
 * configured endpoint (bot API, gateway, internal microservice). A concrete
 * provider supplies only its key + the envelope shape. When no endpoint is
 * configured the send is a no-op failure with a clear reason, so an enabled
 * but unconfigured channel surfaces the misconfiguration instead of silently
 * dropping — never a hardcoded gateway.
 */
function makeWebhookProvider(key, buildBody) {
    return {
        key,
        async send({ recipient, subject, message, payload = {} }) {
            const cfg = payload.config || {};
            const url = cfg.endpoint || cfg.webhook_url || cfg.url;
            if (!recipient) return { ok: false, reason: 'no recipient' };
            if (!url) return { ok: false, reason: `${key} endpoint not configured` };
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(cfg.headers || {}) },
                    body: JSON.stringify(buildBody({ recipient, subject, message, cfg, payload })),
                });
                if (!res.ok) return { ok: false, reason: `${key} http ${res.status}` };
                let ref = null;
                try { const j = await res.json(); ref = j.id || j.message_id || j.ref || null; } catch { /* non-JSON ok */ }
                return { ok: true, ref };
            } catch (e) {
                return { ok: false, reason: `${key}: ${e.message}` };
            }
        },
    };
}

module.exports = { makeWebhookProvider };
