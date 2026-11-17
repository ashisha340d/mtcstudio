'use strict';
/**
 * HR / payroll access control.
 *
 * Resolution matches the campaign module (middleware/campaignAuth): a POS
 * session token in `x-session-id` wins, then DEV_MODE, then the trusted LAN
 * admin console. The admin desktop ships no session header — gating these
 * routes on requireSession would 401 every request from HR and Payroll.
 *
 * The resolved actor lands on `req.actor` and is written to created_by /
 * generated_by, so console-entered rows simply carry a NULL author.
 */
const { resolveRole } = require('./campaignAuth');

const HR_ROLES = ['MANAGER', 'ADMIN'];

async function requireHrRole(req, res, next) {
    try {
        const actor = await resolveRole(req);
        req.actor = actor;
        if (!HR_ROLES.includes(actor.role)) {
            return res.status(403).json({ error: `Requires ${HR_ROLES.join(' or ')} role` });
        }
        next();
    } catch (e) { next(e); }
}

/** Business-rule failures from the service layer are client errors, not 500s. */
function badRequest(next) {
    return (e) => { e.status = e.status || 400; next(e); };
}

module.exports = { requireHrRole, badRequest };
