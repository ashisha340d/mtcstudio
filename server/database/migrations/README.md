# Database migrations

Every schema change lives here. `db.js` (both `database/db.js` and `pos/db.js`)
only opens the pool and exposes `ready` — it must never contain DDL again.

## How it runs

`database/migrator.js` is required once per process. On start it:

1. takes the `mtc_schema_migrations` advisory lock (safe with multiple workers),
2. creates `schema_migrations (number, filename, applied_at)` if absent,
3. lists `NNN_*.sql` / `NNN_*.js` in this directory, sorted by filename,
4. runs the ones whose `number` is not in `schema_migrations`, each inside a
   transaction, recording the row in that same transaction.

A failed migration aborts startup — `app.js` exits non-zero rather than serve
traffic against a half-migrated schema.

## Adding one

Create the next number. Schema changes and data backfills go in separate files.

```
009_add_customer_segment.sql          -- schema
010_backfill_customer_segment.sql     -- data
rollback/009_add_customer_segment.down.sql
```

Rules:

- **Additive first.** `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS` — a live production database must survive the
  migration untouched apart from the intended change.
- **Never drop a column holding data** in the same release that stops writing
  to it. Ship the code change, then drop a release later.
- Prefix a statement with `-- @optional` when the target table belongs to the
  companion website app and may be absent; failures are logged and skipped.
- `.js` migrations export `async up(tx)` with `tx = { dbAll, dbGet, dbRun }`.
  Use them only where a backfill needs real logic (see `006`).

MySQL/MariaDB commits implicitly on DDL, so the transaction only truly protects
data-only migrations. Keep each migration small enough to re-run safely.

## Rollback

`rollback/NNN_*.down.sql` mirrors each migration and ends by deleting its
`schema_migrations` row. They are **not** run automatically — apply by hand:

```
mysql -u USER -p DBNAME < database/migrations/rollback/00N_name.down.sql
```

Read the header first: several are destructive, and `007` is not reversible at
all (it overwrote placeholder values with derived ones).

## Current migrations

| # | File | Contents |
|---|------|----------|
| 001 | `001_cms_core_schema.sql` | Catalogue, media, blogs, cake designs, automation engine |
| 002 | `002_pos_core_schema.sql` | POS orders/KOTs/payments, cake orders, till, SMS, web orders |
| 003 | `003_legacy_column_cleanup.sql` | Drops columns/indexes older installs still carry |
| 004 | `004_indexes_and_constraints.sql` | Search indexes and cross-table foreign keys |
| 005 | `005_triggers.sql` | Order-total recalc + KOT auto-serve triggers |
| 006 | `006_seed_reference_data.js` | Receipt config, lookups, automation types, default waiter |
| 007 | `007_data_backfills.sql` | `products.pos_price`, `pos_till_sessions.business_date` |
| 008 | `008_search_indexes_and_wifi_telemetry.sql` | OCR FULLTEXT indexes, Wi-Fi telemetry tables |

001–008 reproduce the schema the old boot-time `ensureSchema()` functions
built. On an existing database they are all no-ops that simply register the
baseline in `schema_migrations` — verified against production
(`munchtim_mtcstudio`): every table in 001/002 matches live column-for-column,
and all three statements in 003 are already applied there.

Because 001 and 002 declare every column inline, they are the single source of
truth for a table's shape. A new column on an existing table still needs its
own `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migration — add it to the
`CREATE TABLE` **as well**, so fresh installs and upgrades converge.
