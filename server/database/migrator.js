'use strict';
/**
 * Schema migration runner.
 *
 * Every schema change lives in `database/migrations/NNN_name.sql` (or `.js`)
 * and is applied exactly once, in strict filename order, recorded in
 * `schema_migrations`. Nothing else in the codebase may modify the schema.
 *
 * SQL files are split into individual statements. A statement preceded by a
 * `-- @optional` comment may fail without aborting the migration — used for
 * tables owned by the companion website app that are absent on some installs.
 *
 * JS files export `async up(tx)` where tx is `{ dbAll, dbGet, dbRun }` bound to
 * the migration's connection. Used where a backfill needs real logic.
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('./mysqlPool');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const FILE_RE = /^(\d+)_[\w-]+\.(sql|js)$/;
const LOCK_NAME = 'mtc_schema_migrations';
const LOCK_TIMEOUT_SEC = 120;

/** Split a SQL script into statements, respecting quotes and comments. */
function splitStatements(sql) {
    const statements = [];
    let buf = '';
    let i = 0;
    let quote = null; // ', " or `

    while (i < sql.length) {
        const ch = sql[i];

        if (quote) {
            buf += ch;
            if (ch === '\\' && quote !== '`') { buf += sql[i + 1] ?? ''; i += 2; continue; }
            if (ch === quote) {
                // '' / "" / `` doubling is an escaped quote, not a terminator
                if (sql[i + 1] === quote) { buf += sql[i + 1]; i += 2; continue; }
                quote = null;
            }
            i++;
            continue;
        }

        if (ch === "'" || ch === '"' || ch === '`') { quote = ch; buf += ch; i++; continue; }

        // line comments — kept in the buffer so directives survive to the caller
        if ((ch === '-' && sql[i + 1] === '-') || ch === '#') {
            const nl = sql.indexOf('\n', i);
            const end = nl === -1 ? sql.length : nl;
            buf += sql.slice(i, end);
            i = end;
            continue;
        }

        if (ch === '/' && sql[i + 1] === '*') {
            const close = sql.indexOf('*/', i + 2);
            i = close === -1 ? sql.length : close + 2;
            continue;
        }

        if (ch === ';') { statements.push(buf); buf = ''; i++; continue; }

        buf += ch;
        i++;
    }
    statements.push(buf);

    return statements
        .map(raw => ({ raw, body: stripComments(raw).trim() }))
        .filter(s => s.body.length > 0)
        .map(s => ({ sql: s.body, optional: /--\s*@optional/i.test(s.raw) }));
}

/** Remove comment lines so a comment-only chunk is not mistaken for a statement. */
function stripComments(sql) {
    return sql
        .split('\n')
        .map(line => line.replace(/(^|\s)(--(\s.*)?|#.*)$/, ''))
        .join('\n');
}

async function ensureMigrationsTable(conn) {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        number     INT PRIMARY KEY,
        filename   VARCHAR(191) NOT NULL,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

function listMigrations() {
    if (!fs.existsSync(MIGRATIONS_DIR)) return [];
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter(name => FILE_RE.test(name))
        .sort((a, b) => a.localeCompare(b, 'en'))
        .map(filename => ({
            filename,
            number: Number(FILE_RE.exec(filename)[1]),
            fullPath: path.join(MIGRATIONS_DIR, filename),
        }));
}

async function applySql(conn, fullPath) {
    const script = fs.readFileSync(fullPath, 'utf8');
    for (const { sql, optional } of splitStatements(script)) {
        try {
            await conn.query(sql);
        } catch (err) {
            if (!optional) throw err;
            console.warn(`[migrate] skipped optional statement: ${err.message}`);
        }
    }
}

async function applyJs(conn, fullPath) {
    const mod = require(fullPath);
    const tx = {
        dbAll: async (sql, params = []) => { const [rows] = await conn.query(sql, params); return rows; },
        dbGet: async (sql, params = []) => { const [rows] = await conn.query(sql, params); return rows[0]; },
        dbRun: async (sql, params = []) => {
            const [result] = await conn.query(sql, params);
            return { lastInsertRowid: result.insertId, changes: result.affectedRows, insertId: result.insertId };
        },
    };
    await mod.up(tx);
}

async function applyMigration(conn, migration) {
    // MySQL/MariaDB implicitly commits on DDL, so a transaction only truly
    // protects data-only migrations — wrap regardless, per the runner contract.
    await conn.beginTransaction();
    try {
        if (migration.filename.endsWith('.sql')) await applySql(conn, migration.fullPath);
        else await applyJs(conn, migration.fullPath);

        await conn.query(
            `INSERT INTO schema_migrations (number, filename) VALUES (?, ?)`,
            [migration.number, migration.filename]
        );
        await conn.commit();
    } catch (err) {
        try { await conn.rollback(); } catch { /* DDL already committed */ }
        throw new Error(`Migration ${migration.filename} failed: ${err.message}`);
    }
}

async function migrate() {
    const conn = await pool.getConnection();
    let locked = false;
    try {
        const [[lock]] = await conn.query(`SELECT GET_LOCK(?, ?) AS ok`, [LOCK_NAME, LOCK_TIMEOUT_SEC]);
        if (!lock || Number(lock.ok) !== 1) throw new Error('Could not acquire migration lock');
        locked = true;

        await ensureMigrationsTable(conn);
        const [rows] = await conn.query(`SELECT number FROM schema_migrations`);
        const applied = new Set(rows.map(r => Number(r.number)));

        const pending = listMigrations().filter(m => !applied.has(m.number));
        if (!pending.length) return { applied: [] };

        for (const migration of pending) {
            console.log(`[migrate] applying ${migration.filename}`);
            await applyMigration(conn, migration);
        }
        console.log(`[migrate] ${pending.length} migration(s) applied`);
        return { applied: pending.map(m => m.filename) };
    } finally {
        if (locked) { try { await conn.query(`SELECT RELEASE_LOCK(?)`, [LOCK_NAME]); } catch { /* connection dying */ } }
        conn.release();
    }
}

// Single run per process — both database/db.js and pos/db.js await this promise.
const ready = migrate().catch(err => {
    console.error('[migrate] failed:', err.message);
    throw err;
});

module.exports = { ready, migrate, splitStatements };
