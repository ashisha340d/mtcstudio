-- ============================================================
-- MTC Auth — Users, Roles, Audit Trail (addendum to schema.sql)
-- ============================================================

-- ── Roles ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE    -- 'ADMIN' | 'MANAGER' | 'CASHIER'
);

INSERT OR IGNORE INTO roles (name) VALUES ('CASHIER'), ('MANAGER'), ('ADMIN');

-- ── Users ────────────────────────────────────────────────────
-- pin_hash: bcrypt/argon2 hash — NEVER store plain PIN
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  employee_id TEXT    NOT NULL UNIQUE,   -- display code, e.g. "EMP01"
  role_id     INTEGER NOT NULL REFERENCES roles(id),
  pin_hash    TEXT    NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── Sessions ─────────────────────────────────────────────────
-- Short-lived terminal sessions. Auto-lock invalidates these.
CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  terminal_id TEXT,                        -- optional: which POS terminal
  started_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at    DATETIME                     -- NULL = still active
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ── Audit Log ─────────────────────────────────────────────────
-- Every create/update/cancel/payment/void action is logged here.
-- entity_type: 'ORDER' | 'KOT' | 'KOT_ITEM' | 'PAYMENT' | 'LEDGER'
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  session_id   INTEGER REFERENCES sessions(id),
  entity_type  TEXT    NOT NULL,
  entity_id    INTEGER NOT NULL,
  action       TEXT    NOT NULL,          -- 'CREATE' | 'UPDATE' | 'CANCEL' | 'VOID' | 'CHECKOUT' | 'DISCOUNT'
  delta_json   TEXT,                      -- JSON snapshot of changed fields
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_time    ON audit_log(created_at);

-- ── Backfill user_id onto orders ─────────────────────────────
-- Add punched_by column to orders and kots for cashier tracking
ALTER TABLE orders ADD COLUMN IF NOT EXISTS punched_by INTEGER REFERENCES users(id);
ALTER TABLE kots   ADD COLUMN IF NOT EXISTS punched_by INTEGER REFERENCES users(id);

-- ── Auto-lock config per terminal ────────────────────────────
CREATE TABLE IF NOT EXISTS terminal_config (
  terminal_id        TEXT PRIMARY KEY,
  auto_lock_seconds  INTEGER NOT NULL DEFAULT 120   -- 2 min default
);
