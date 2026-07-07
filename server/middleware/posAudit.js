'use strict';
const { dbRun } = require('../pos/db');

/**
 * Write a row to audit_log.
 * @param {{ userId, sessionId, entityType, entityId, action, delta }} opts
 */
async function audit({ userId, sessionId, entityType, entityId, action, delta = null }) {
  await dbRun(
    `INSERT INTO pos_audit_log (user_id, session_id, entity_type, entity_id, action, delta_json)
     VALUES (?,?,?,?,?,?)`,
    [userId, sessionId ?? null, entityType, entityId, action, delta ? JSON.stringify(delta) : null]
  );
}

module.exports = { audit };
