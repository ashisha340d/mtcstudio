'use strict';
// ─────────────────────────────────────────────────────────────────────────────
//  /wifi — MikroTik captive portal landing page.
//  Public and unauthenticated by design: the guest has no Internet yet.
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const path = require('path');
const controller = require('../controllers/wifiController');
const portalService = require('../services/wifiPortalService');

const router = express.Router();

// Portal assets are hash-versioned by the controller, so they can be pinned hard.
router.use('/assets', express.static(path.join(__dirname, '..', 'public', 'wifi'), {
  maxAge: '1y',
  immutable: true,
  fallthrough: false,
}));

// MikroTik's login.html may bounce the client here by GET or POST depending on
// how the router template was written — accept both at the same address.
router.get('/', controller.renderPortal);
router.post('/', controller.renderPortal);

router.post('/connect', controller.connect);
router.get('/connect', controller.connect);

router.post('/api/event', controller.trackEvent);
router.get('/api/summary', controller.summary);

// Menu edits should show on the portal without a restart.
router.post('/api/refresh', (req, res) => {
  portalService.invalidate();
  res.json({ ok: true });
});

module.exports = router;
