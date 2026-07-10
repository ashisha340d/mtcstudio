'use strict';
const express = require('express');
const { dbAll, dbGet, dbRun, transaction } = require('../../pos/db');
const { requireSession } = require('../../middleware/posAuth');
const { audit } = require('../../middleware/posAudit');
const socketServer = require('../../pos/socketServer');

const router = express.Router();
router.use(requireSession);

// ═══════════════════════════════════════════════════════════════
//  Read helpers — local to this file (does not import from
//  cakeOrders.js, keeping that file's touch-surface minimal)
// ═══════════════════════════════════════════════════════════════

async function now() {
  return (await dbGet(`SELECT CURRENT_TIMESTAMP AS t`)).t;
}

// Field-level permissions for this app, derived from POS's own `status`
// (source of truth for Cancelled/Delivered) and this app's `production_status`.
function getPerms(row) {
  if (row.status === 'CANCELLED') return { checklist: false, tags: false, notes: false, photosUpload: false };
  if (row.status === 'DELIVERED') return { checklist: false, tags: true, notes: false, photosUpload: false };
  if (row.production_status === 'Ready for Delivery') return { checklist: false, tags: true, notes: true, photosUpload: true };
  if (row.production_status === 'In Production') return { checklist: true, tags: true, notes: true, photosUpload: false };
  return { checklist: false, tags: true, notes: true, photosUpload: false }; // New / Acknowledged
}

async function getFullForSync(id) {
  const row = await dbGet(
    `SELECT co.*,
            sh.name AS shape_name,   sh.extra_charge AS shape_charge,
            cr.name AS cream_name,   cr.extra_charge AS cream_charge,
            sp.name AS sponge_name,  sp.extra_charge AS sponge_charge,
            th.name AS theme_name,   th.extra_charge AS theme_charge,
            di.name AS dietary_name, di.extra_charge AS dietary_charge
     FROM   cake_orders co
     LEFT JOIN lookup_master sh ON sh.id = co.shape_id
     LEFT JOIN lookup_master cr ON cr.id = co.cream_type_id
     LEFT JOIN lookup_master sp ON sp.id = co.sponge_type_id
     LEFT JOIN lookup_master th ON th.id = co.theme_id
     LEFT JOIN lookup_master di ON di.id = co.dietary_type_id
     WHERE co.id = ?`,
    [id]
  );
  if (!row) return null;

  const items = await dbAll(`SELECT * FROM cake_order_items WHERE cake_order_id=? ORDER BY sort_order,id`, [id]);
  const accessories = await dbAll(`SELECT * FROM cake_order_accessories WHERE cake_order_id=? ORDER BY sort_order,id`, [id]);
  const photos = await dbAll(
    `SELECT slot_number, image_url, image_name, uploaded_at FROM cake_production_photos WHERE cake_order_id=? ORDER BY slot_number`,
    [id]
  );
  const images = await dbAll(`SELECT id, image_url, image_name FROM cake_order_images WHERE cake_order_id=? ORDER BY created_at`, [id]);
  const stateRow = await dbGet(`SELECT checklist_json, tags_json FROM cake_production_state WHERE cake_order_id=?`, [id]);
  const state = {
    checklist: stateRow ? JSON.parse(stateRow.checklist_json || '[]') : [],
    tags: stateRow ? JSON.parse(stateRow.tags_json || '[]') : [],
  };

  return { ...row, items, accessories, photos, images, state };
}

// ═══════════════════════════════════════════════════════════════
//  Incremental sync
// ═══════════════════════════════════════════════════════════════

// GET /sync?since=<opaque cursor previously returned as serverTime>
// Omitted `since` -> full bootstrap (also returns lookups + checklist template).
// Orders visible to this app: must be confirmed-or-further (production_status
// set) by POS, and not a cancelled order that was removed while still New.
const VISIBLE_WHERE = `co.production_status IS NOT NULL AND NOT (co.status='CANCELLED' AND co.production_status='New')`;

router.get('/sync', async (req, res) => {
  const since = req.query.since || null;
  const serverTime = await now();

  let ids;
  if (!since) {
    ids = (await dbAll(`SELECT id FROM cake_orders co WHERE deleted_at IS NULL AND ${VISIBLE_WHERE}`)).map(r => r.id);
  } else {
    ids = (await dbAll(
      `SELECT DISTINCT co.id
       FROM cake_orders co
       LEFT JOIN cake_production_state  cps ON cps.cake_order_id = co.id
       LEFT JOIN cake_production_photos cpp ON cpp.cake_order_id = co.id
       WHERE co.deleted_at IS NULL AND ${VISIBLE_WHERE}
         AND (co.updated_at > ? OR cps.updated_at > ? OR cpp.updated_at > ?)`,
      [since, since, since]
    )).map(r => r.id);
  }

  const orders = (await Promise.all(ids.map(getFullForSync))).filter(Boolean);

  const deletedIds = since
    ? [
        ...(await dbAll(`SELECT id FROM cake_orders WHERE deleted_at IS NOT NULL AND deleted_at > ?`, [since])).map(r => r.id),
        ...(await dbAll(
          `SELECT id FROM cake_orders WHERE deleted_at IS NULL AND status='CANCELLED' AND production_status='New' AND updated_at > ?`,
          [since]
        )).map(r => r.id),
      ]
    : [];

  const result = { serverTime, orders, deletedIds };

  if (!since) {
    const rows = await dbAll(
      `SELECT id,lookup_type,name,extra_charge,sort_order FROM lookup_master WHERE is_active=1 ORDER BY lookup_type,sort_order,name`
    );
    const lookups = {};
    rows.forEach(r => { (lookups[r.lookup_type] = lookups[r.lookup_type] || []).push(r); });
    result.lookups = lookups;
    result.checklistTemplate = await dbAll(
      `SELECT item_key,label,sort_order FROM cake_production_checklist_template ORDER BY sort_order`
    );
  }

  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
//  Status — bidirectional, production-pipeline-only (own transition
//  map, deliberately separate from the POS's forward-only/cancel/
//  refund-capable TRANSITIONS in cakeOrders.js so this app can never
//  reach CANCELLED/REFUNDED, and can step back a stage e.g. if a
//  chef swipes the wrong way). One adjacent step per request — the
//  chain mirrors the swipe gesture in the app 1:1.
// ═══════════════════════════════════════════════════════════════

const STATUS_CHAIN = ['New', 'Acknowledged', 'In Production', 'Ready for Delivery'];

router.patch('/:id/status', async (req, res) => {
  const existing = await dbGet(`SELECT id, status, production_status FROM cake_orders WHERE id=? AND deleted_at IS NULL`, [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.status === 'CANCELLED') return res.status(400).json({ error: 'Order is cancelled' });
  if (existing.status === 'DELIVERED') return res.status(400).json({ error: 'Order already delivered' });

  const { status } = req.body;
  const from = STATUS_CHAIN.indexOf(existing.production_status);
  const to = STATUS_CHAIN.indexOf(status);
  if (from === -1 || to === -1 || Math.abs(to - from) !== 1) {
    return res.status(400).json({ error: `Cannot transition ${existing.production_status} → ${status}` });
  }

  await transaction(async (tx) => {
    await tx.dbRun(`UPDATE cake_orders SET production_status=? WHERE id=?`, [status, existing.id]);
    await tx.dbRun(`INSERT INTO cake_order_status_history (cake_order_id,old_status,new_status,changed_by) VALUES (?,?,?,?)`,
      [existing.id, existing.production_status, status, req.posUser.id]);

    // Tagging an order Ready for Delivery means production is done — auto-check
    // the whole checklist so the chef doesn't have to re-tick items already
    // implied by the stage change.
    if (status === 'Ready for Delivery') {
      const template = await tx.dbAll(`SELECT item_key FROM cake_production_checklist_template ORDER BY sort_order`);
      const checklist = JSON.stringify(template.map(t => ({ item_key: t.item_key, done: true })));
      const current = await tx.dbGet(`SELECT tags_json FROM cake_production_state WHERE cake_order_id=?`, [existing.id]);
      await tx.dbRun(
        `INSERT INTO cake_production_state (cake_order_id, checklist_json, tags_json) VALUES (?,?,?)
         ON DUPLICATE KEY UPDATE checklist_json=VALUES(checklist_json)`,
        [existing.id, checklist, current?.tags_json || '[]']
      );
    }
  });

  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'CAKE_ORDER', entityId: existing.id, action: 'PRODUCTION_STATUS', delta: { from: existing.production_status, to: status } });
  socketServer.emitCakeProductionChanged({ cake_order_id: existing.id, kind: 'status' });
  // web-origin cake orders: production stage → customer-facing status (no-op otherwise)
  if (status === 'In Production')
    require('../../services/webOrderBridge').notifyCakeOrderEvent(existing.id, 'BAKING');
  else if (status === 'Ready for Delivery')
    require('../../services/webOrderBridge').notifyCakeOrderEvent(existing.id, 'READY');
  res.json(await getFullForSync(existing.id));
});

// ═══════════════════════════════════════════════════════════════
//  Notes (dedicated column — never touched by the admin PUT /:id)
// ═══════════════════════════════════════════════════════════════

router.patch('/:id/notes', async (req, res) => {
  const existing = await dbGet(`SELECT id, status, production_status FROM cake_orders WHERE id=? AND deleted_at IS NULL`, [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!getPerms(existing).notes) return res.status(400).json({ error: 'Notes cannot be edited at this stage' });

  const { production_notes } = req.body;
  await dbRun(`UPDATE cake_orders SET production_notes=? WHERE id=?`, [production_notes ?? null, existing.id]);

  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'CAKE_ORDER', entityId: existing.id, action: 'PRODUCTION_NOTES', delta: { production_notes } });
  socketServer.emitCakeProductionChanged({ cake_order_id: existing.id, kind: 'notes' });
  res.json({ id: existing.id, production_notes: production_notes ?? null });
});

// ═══════════════════════════════════════════════════════════════
//  Checklist + tags (partial upsert — send only the key(s) changing)
// ═══════════════════════════════════════════════════════════════

router.put('/:id/state', async (req, res) => {
  const existing = await dbGet(`SELECT id, status, production_status FROM cake_orders WHERE id=? AND deleted_at IS NULL`, [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const perms = getPerms(existing);

  const { checklist, tags } = req.body;
  if (checklist !== undefined && !perms.checklist) return res.status(400).json({ error: 'Checklist cannot be edited at this stage' });
  if (tags !== undefined && !perms.tags) return res.status(400).json({ error: 'Tags cannot be edited at this stage' });

  const current = await dbGet(`SELECT checklist_json, tags_json FROM cake_production_state WHERE cake_order_id=?`, [existing.id]);

  const checklist_json = JSON.stringify(checklist !== undefined ? checklist : JSON.parse(current?.checklist_json || '[]'));
  const tags_json = JSON.stringify(tags !== undefined ? tags : JSON.parse(current?.tags_json || '[]'));

  await dbRun(
    `INSERT INTO cake_production_state (cake_order_id, checklist_json, tags_json) VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE checklist_json=VALUES(checklist_json), tags_json=VALUES(tags_json)`,
    [existing.id, checklist_json, tags_json]
  );

  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'CAKE_ORDER', entityId: existing.id, action: 'PRODUCTION_STATE', delta: { checklist, tags } });
  socketServer.emitCakeProductionChanged({ cake_order_id: existing.id, kind: checklist !== undefined ? 'checklist' : 'tags' });
  res.json({ checklist: JSON.parse(checklist_json), tags: JSON.parse(tags_json) });
});

// ═══════════════════════════════════════════════════════════════
//  Photo slots (1-3) — fixed slots, independent of admin's
//  unbounded cake_order_images "Reference Images" feature
// ═══════════════════════════════════════════════════════════════

function parseSlot(req, res) {
  const slot = parseInt(req.params.slot, 10);
  if (![1, 2, 3].includes(slot)) { res.status(400).json({ error: 'slot must be 1, 2, or 3' }); return null; }
  return slot;
}

router.put('/:id/photo/:slot', async (req, res) => {
  const slot = parseSlot(req, res);
  if (slot === null) return;
  const existing = await dbGet(`SELECT id, status, production_status FROM cake_orders WHERE id=? AND deleted_at IS NULL`, [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!getPerms(existing).photosUpload) return res.status(400).json({ error: 'Photo upload disabled at this stage' });

  const { image_url, image_name } = req.body;
  if (!image_url) return res.status(400).json({ error: 'image_url required' });

  await dbRun(
    `INSERT INTO cake_production_photos (cake_order_id, slot_number, image_url, image_name) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE image_url=VALUES(image_url), image_name=VALUES(image_name), uploaded_at=CURRENT_TIMESTAMP`,
    [existing.id, slot, image_url, image_name || null]
  );

  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'CAKE_ORDER', entityId: existing.id, action: 'PRODUCTION_PHOTO', delta: { slot, image_url } });
  socketServer.emitCakeProductionChanged({ cake_order_id: existing.id, kind: 'photo' });
  res.json({ slot_number: slot, image_url, image_name: image_name || null });
});

router.delete('/:id/photo/:slot', async (req, res) => {
  const slot = parseSlot(req, res);
  if (slot === null) return;
  const existing = await dbGet(`SELECT id, status, production_status FROM cake_orders WHERE id=? AND deleted_at IS NULL`, [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!getPerms(existing).photosUpload) return res.status(400).json({ error: 'Photo upload disabled at this stage' });

  await dbRun(`DELETE FROM cake_production_photos WHERE cake_order_id=? AND slot_number=?`, [existing.id, slot]);

  audit({ userId: req.posUser.id, sessionId: req.posSessionId, entityType: 'CAKE_ORDER', entityId: existing.id, action: 'PRODUCTION_PHOTO_DELETE', delta: { slot } });
  socketServer.emitCakeProductionChanged({ cake_order_id: existing.id, kind: 'photo' });
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
//  Checklist template — configured inside this app, not POS
//  (see plan: existing POS UI has no generic slot for a new type)
// ═══════════════════════════════════════════════════════════════

router.get('/checklist-template', async (_req, res) => {
  res.json(await dbAll(`SELECT item_key,label,sort_order FROM cake_production_checklist_template ORDER BY sort_order`));
});

router.put('/checklist-template', async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : req.body?.items;
  if (!Array.isArray(items) || items.some(r => !r.item_key || !r.label))
    return res.status(400).json({ error: 'body must be an array of {item_key,label}' });

  await transaction(async (tx) => {
    await tx.dbRun(`DELETE FROM cake_production_checklist_template`);
    for (const [i, r] of items.entries()) {
      await tx.dbRun(`INSERT INTO cake_production_checklist_template (item_key,label,sort_order) VALUES (?,?,?)`, [r.item_key, r.label, r.sort_order ?? i]);
    }
  });

  res.json(await dbAll(`SELECT item_key,label,sort_order FROM cake_production_checklist_template ORDER BY sort_order`));
});

module.exports = router;
