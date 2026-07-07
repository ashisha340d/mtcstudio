'use strict';
const { dbGet, dbRun } = require('../pos/db');

const DEV_MODE = process.env.DEV_MODE === 'true';

async function requireSession(req, res, next) {
  const token = req.headers['x-session-id'];

  if (DEV_MODE && (!token || token === 'dev-session')) {
    const devUser = await dbGet(
      `SELECT u.*, r.name AS role
       FROM   pos_users u JOIN pos_roles r ON r.id = u.role_id
       WHERE  u.employee_id = 'DEV01' AND u.is_active = 1`
    );
    if (devUser) {
      req.posUser      = devUser;
      req.posSessionId = 0;
      return next();
    }
  }

  if (!token) return res.status(401).json({ error: 'No session token' });

  const session = await dbGet(
    `SELECT s.*, u.id AS uid, u.name AS uname, u.employee_id, u.is_active, r.name AS role
     FROM   pos_sessions s
     JOIN   pos_users    u ON u.id = s.user_id
     JOIN   pos_roles    r ON r.id = u.role_id
     WHERE  s.token = ? AND s.ended_at IS NULL AND u.is_active = 1`,
    [token]
  );

  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });

  await dbRun(`UPDATE pos_sessions SET last_active = CURRENT_TIMESTAMP WHERE id = ?`, [session.id]);

  req.posUser      = { id: session.uid, name: session.uname, employee_id: session.employee_id, role: session.role };
  req.posSessionId = session.id;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.posUser) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.posUser.role)) {
      return res.status(403).json({ error: `Requires ${roles.join(' or ')} role` });
    }
    next();
  };
}

module.exports = { requireSession, requireRole };
