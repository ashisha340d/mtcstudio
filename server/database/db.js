'use strict';
/**
 * CMS database handle. Schema lives entirely in database/migrations — this
 * module only exposes the pooled query helpers and the migration-ready promise.
 */
const { dbAll, dbGet, dbRun, transaction } = require('./mysqlPool');
const { ready } = require('./migrator');

module.exports = { dbAll, dbGet, dbRun, transaction, ready };
