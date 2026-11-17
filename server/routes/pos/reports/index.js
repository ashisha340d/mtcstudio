'use strict';
/**
 * /api/pos/reports — mounts one router per report family. Paths are unchanged
 * from the single-file version; each sub-router still declares its own full
 * path, so nothing here rewrites URLs.
 */
const express = require('express');
const { requireSession } = require('../../../middleware/posAuth');
const { buildDayEndReport } = require('./dayEndReport');

const router = express.Router();
router.use(requireSession);

router.use(require('./sales'));
router.use(require('./cakePayments'));
router.use(require('./analytics'));
router.use(require('./paymentRegister'));
router.use(require('./calendar'));
router.use(require('./dayEnd'));

module.exports = router;
// till.js builds the same report when closing a shift.
module.exports.buildDayEndReport = buildDayEndReport;
