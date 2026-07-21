'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  Wi-Fi portal telemetry — visit ledger + event stream.
//
//  Self-contained: owns its two tables, touches nothing the POS/CMS relies on.
//  Every write is fire-and-forget so a telemetry hiccup can never stop a guest
//  reaching the Internet.
//
//  Groundwork it deliberately lays for later:
//    • repeat-visitor recognition  → visit_count / last_seen_at per device
//    • loyalty                     → customer_id column, filled once a guest links a phone
//    • personalised promotions     → tags JSON blob per device
// ─────────────────────────────────────────────────────────────────────────────
const { dbAll, dbGet, dbRun } = require('../database/db');

let schemaReady = null;

function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await dbRun(`CREATE TABLE IF NOT EXISTS wifi_devices (
      id            INT PRIMARY KEY AUTO_INCREMENT,
      device_key    VARCHAR(64) NOT NULL UNIQUE,
      mac           VARCHAR(17),
      customer_id   INT NULL,
      visit_count   INT DEFAULT 1,
      connect_count INT DEFAULT 0,
      tags          TEXT,
      first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_wifi_devices_mac (mac),
      INDEX idx_wifi_devices_last_seen (last_seen_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await dbRun(`CREATE TABLE IF NOT EXISTS wifi_events (
      id          BIGINT PRIMARY KEY AUTO_INCREMENT,
      device_key  VARCHAR(64),
      event       VARCHAR(48) NOT NULL,
      section     VARCHAR(48),
      ref_id      VARCHAR(64),
      meta        TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_wifi_events_event (event, created_at),
      INDEX idx_wifi_events_device (device_key, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  })().catch(err => {
    console.error('[wifi] telemetry schema unavailable:', err.message);
    schemaReady = null;   // let a later request retry
  });
  return schemaReady;
}

// Stable per-device id. MAC when MikroTik gave us one (survives cookie wipes and
// is the same key the router sees), else the portal cookie.
function deviceKeyFor({ mac, cookieId }) {
  if (mac) return `mac:${mac}`;
  return cookieId ? `cid:${cookieId}` : '';
}

/**
 * Record a page view and return what we already know about this device.
 * Resolves to { visitCount, returning, connectCount } — never rejects.
 */
async function touchVisit({ deviceKey, mac }) {
  if (!deviceKey) return { visitCount: 1, returning: false, connectCount: 0 };
  try {
    await ensureSchema();
    const existing = await dbGet(`SELECT visit_count, connect_count FROM wifi_devices WHERE device_key=?`, [deviceKey]);
    if (existing) {
      await dbRun(
        `UPDATE wifi_devices SET visit_count=visit_count+1, last_seen_at=CURRENT_TIMESTAMP, mac=COALESCE(?, mac) WHERE device_key=?`,
        [mac || null, deviceKey]
      );
      return {
        visitCount: (existing.visit_count || 0) + 1,
        connectCount: existing.connect_count || 0,
        returning: true,
      };
    }
    await dbRun(`INSERT INTO wifi_devices (device_key, mac) VALUES (?,?)`, [deviceKey, mac || null]);
    return { visitCount: 1, returning: false, connectCount: 0 };
  } catch (err) {
    console.error('[wifi] touchVisit failed:', err.message);
    return { visitCount: 1, returning: false, connectCount: 0 };
  }
}

async function recordConnect(deviceKey) {
  if (!deviceKey) return;
  try {
    await ensureSchema();
    await dbRun(`UPDATE wifi_devices SET connect_count=connect_count+1 WHERE device_key=?`, [deviceKey]);
  } catch (err) {
    console.error('[wifi] recordConnect failed:', err.message);
  }
}

const EVENT_MAX = 48;

async function track({ deviceKey, event, section, refId, meta }) {
  if (!event) return;
  try {
    await ensureSchema();
    await dbRun(
      `INSERT INTO wifi_events (device_key, event, section, ref_id, meta) VALUES (?,?,?,?,?)`,
      [
        (deviceKey || '').slice(0, 64) || null,
        String(event).slice(0, EVENT_MAX),
        section ? String(section).slice(0, EVENT_MAX) : null,
        refId ? String(refId).slice(0, 64) : null,
        meta ? JSON.stringify(meta).slice(0, 2000) : null,
      ]
    );
  } catch (err) {
    console.error('[wifi] track failed:', err.message);
  }
}

// Small roll-up for a future dashboard card.
async function summary(days = 7) {
  await ensureSchema();
  const [devices, events] = await Promise.all([
    dbGet(`SELECT COUNT(*) total, SUM(visit_count>1) returning_devices, SUM(connect_count) connects
           FROM wifi_devices WHERE last_seen_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`, [days]),
    dbAll(`SELECT event, section, COUNT(*) n FROM wifi_events
           WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
           GROUP BY event, section ORDER BY n DESC LIMIT 40`, [days]),
  ]);
  return { days, devices, events };
}

module.exports = { ensureSchema, deviceKeyFor, touchVisit, recordConnect, track, summary };
