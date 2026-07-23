'use strict';
/**
 * POS database handle. Same pool and same migration run as the CMS handle —
 * kept as a separate module so POS code kept its existing import path.
 * Schema lives entirely in database/migrations.
 */
const { dbAll, dbGet, dbRun, transaction } = require('../database/mysqlPool');
const { ready } = require('../database/migrator');

module.exports = { dbAll, dbGet, dbRun, transaction, ready };
