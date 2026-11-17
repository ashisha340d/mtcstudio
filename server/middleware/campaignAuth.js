'use strict';
/**
 * Campaign permission middleware — integrates with the existing POS auth
 * (pos_sessions / pos_users / pos_roles) and the campaign_role_permissions map.
 *
 * Resolution order for the acting user's role:
 *   1. a valid POS session token in `x-session-id`  (same scheme as posAuth),
 *   2. DEV_MODE dev user,
 *   3. no token → the trusted LAN admin console (the CMS runs unauthenticated,
 *      like the CRM/Automation modules) → treated as ADMIN.
 *
 * Permission checks are data-driven: a role passes if campaign_role_permissions
 * holds (role, permission). Editing permissions is a DB change, never code.
 */
const { dbGet } = require('../pos/db');

const DEV_MODE = process.env.DEV_MODE === 'true';

async function resolveRole(req) {
    const token = req.headers['x-session-id'];
    if (token && token !== 'dev-session') {
        const session = await dbGet(
            `SELECT u.id AS uid, u.name AS uname, u.employee_id, r.name AS role
             FROM   pos_sessions s
             JOIN   pos_users u ON u.id = s.user_id
             JOIN   pos_roles r ON r.id = u.role_id
             WHERE  s.token = ? AND s.ended_at IS NULL AND u.is_active = 1`, [token]);
        if (session) return { id: session.uid, name: session.uname, employee_id: session.employee_id, role: session.role };
    }
    if (DEV_MODE) {
        const dev = await dbGet(
            `SELECT u.id, u.name, u.employee_id, r.name AS role
             FROM pos_users u JOIN pos_roles r ON r.id = u.role_id
             WHERE u.employee_id='DEV01' AND u.is_active=1`);
        if (dev) return { id: dev.id, name: dev.name, employee_id: dev.employee_id, role: dev.role };
    }
    // Unauthenticated admin console — LAN-trusted, matches CRM/Automation modules.
    return { id: null, name: 'Admin Console', employee_id: null, role: 'ADMIN' };
}

async function can(role, permission) {
    const row = await dbGet(
        `SELECT 1 AS ok FROM campaign_role_permissions WHERE role=? AND permission=?`, [role, permission]);
    return !!row;
}

function requirePermission(permission) {
    return async (req, res, next) => {
        try {
            const user = await resolveRole(req);
            req.campaignUser = user;
            if (await can(user.role, permission)) return next();
            return res.status(403).json({ error: `Requires '${permission}' permission (role ${user.role})` });
        } catch (e) { next(e); }
    };
}

// Attach the acting user without gating — used by read routes that still want
// actor context (e.g. audit) but are viewable by any resolved role.
async function attachUser(req, res, next) {
    try { req.campaignUser = await resolveRole(req); next(); }
    catch (e) { next(e); }
}

module.exports = { requirePermission, attachUser, resolveRole, can };
