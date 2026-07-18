'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const { dbAll, dbGet, dbRun } = require('../../pos/db');
const { requireSession } = require('../../middleware/posAuth');
const { audit }          = require('../../middleware/posAudit');

const router = express.Router();

// Shared PIN-check, used by /pin and by the mobile module's /login.
async function authenticatePin(pin) {
  const users = await dbAll(
    `SELECT u.*, r.name AS role
     FROM   pos_users u JOIN pos_roles r ON r.id = u.role_id
     WHERE  u.is_active = 1`
  );
  for (const u of users) {
    if (bcrypt.compareSync(String(pin), u.pin_hash)) return u;
  }
  return null;
}

router.post('/pin', async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });

  const matched = await authenticatePin(pin);
  if (!matched) return res.status(401).json({ error: 'Incorrect PIN' });

  const token = crypto.randomUUID();
  const sess  = await dbGet(
    `INSERT INTO pos_sessions (user_id, token) VALUES (?,?) RETURNING id`,
    [matched.id, token]
  );

  audit({ userId: matched.id, sessionId: sess.id, entityType: 'SESSION', entityId: sess.id, action: 'LOGIN' });

  res.json({
    sessionId: token,
    user: { id: matched.id, name: matched.name, employee_id: matched.employee_id, role: matched.role },
  });
});

router.post('/logout', requireSession, async (req, res) => {
  await dbRun(`UPDATE pos_sessions SET ended_at = CURRENT_TIMESTAMP WHERE id = ?`, [req.posSessionId]);
  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'SESSION', entityId: req.posSessionId, action: 'LOGOUT' });
  res.json({ ok: true });
});

router.get('/me', requireSession, (req, res) => res.json(req.posUser));

// Manager override PIN check (no session created)
router.post('/verify-pin', requireSession, async (req, res) => {
  const { pin, requiredRole } = req.body;
  if (!pin) return res.status(400).json({ error: 'PIN required' });

  const matched = await authenticatePin(pin);
  if (!matched) return res.status(401).json({ error: 'Incorrect PIN' });

  const LEVELS = { CASHIER: 1, MANAGER: 2, ADMIN: 3 };
  if (requiredRole && (LEVELS[matched.role] ?? 0) < (LEVELS[requiredRole] ?? 0)) {
    return res.status(403).json({ error: `Requires ${requiredRole} or higher` });
  }
  res.json({ ok: true, user: { id: matched.id, name: matched.name, employee_id: matched.employee_id, role: matched.role } });
});

module.exports = router;
module.exports.authenticatePin = authenticatePin;
