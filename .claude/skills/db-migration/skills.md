# Database Migration

## Purpose

Implement all database schema changes using versioned SQL migrations. Never modify the database schema during application startup.

## When to use

Use this skill whenever a request involves:

- Creating tables
- Altering tables
- Adding columns
- Removing columns
- Renaming columns
- Creating indexes
- Dropping indexes
- Foreign keys
- Constraints
- Data backfills
- Seed data
- Database upgrades
- Schema refactoring

## Never

- Never place ALTER TABLE statements inside db.js.
- Never place CREATE TABLE statements inside db.js.
- Never execute schema changes on every application startup.
- Never modify production data outside a migration.
- Never combine unrelated schema changes into one migration.
- Never reorder previously released migrations.
- Never edit an already-applied migration.

## Migration Structure

Store migrations in:

server/
└── database/
    ├── migrator.js                              ← the runner
    └── migrations/
        ├── 001_cms_core_schema.sql
        ├── 002_pos_core_schema.sql
        ├── 003_legacy_column_cleanup.sql
        ├── 004_indexes_and_constraints.sql
        ├── 005_triggers.sql
        ├── 006_seed_reference_data.js
        ├── 007_data_backfills.sql
        ├── 008_search_indexes_and_wifi_telemetry.sql
        └── rollback/
            └── NNN_<same_name>.down.sql

Migration filenames must be sequential. 001–008 are the applied baseline, so
new work starts at 009.

### Format

NNN_short_description.sql

Examples

009_create_customer_addresses.sql

010_add_menu_icon.sql

011_backfill_customer_codes.sql

## schema_migrations

Maintain a table named:

schema_migrations

Columns

number     — the NNN prefix, primary key

filename   — the migration file name

applied_at — timestamp, defaults to CURRENT_TIMESTAMP

Every successful migration must insert one row, inside the same transaction as
the migration itself.

## Startup

Application startup flow

Connect database

↓

Run migration runner

↓

Read migrations folder

↓

Compare against schema_migrations

↓

Execute unapplied migrations only

↓

Commit

↓

Start server

### Optional statements

Prefix a statement with a `-- @optional` comment when its target table is owned
by the companion website app and may be absent on some installs. The runner
logs and skips such a failure instead of aborting the migration.

## Transactions

Wrap every migration in a transaction whenever supported.

Rollback on failure.

Never leave partial schema updates.

## Data Backfills

Separate schema changes from data updates when practical.

Example

009_add_discount_column.sql

010_backfill_discount_values.sql

## Rollback

When feasible, generate rollback SQL as
`server/database/migrations/rollback/NNN_<same_name>.down.sql`.

Each rollback ends with `DELETE FROM schema_migrations WHERE number = N;` so the
migration re-runs afterwards. Rollbacks are never applied automatically — run
them by hand.

If rollback is unsafe, still create the file and document why in its header
(see `rollback/007_data_backfills.down.sql`).

## Code Changes

When generating migrations:

Create SQL file

Update migration runner if necessary

Remove startup schema modifications from db.js

Never duplicate schema logic

## Output

Whenever this skill is used, produce:

Summary

Migration filename

Migration SQL

Rollback SQL if applicable

Files created

Files modified

Reasoning only if a design decision is required.

## Project Standards

Target database:

MariaDB

Database access:

mysql2

Migration language:

SQL

Application:

Node.js

Express

Existing databases must migrate safely.

No data loss.

No destructive operations without explicit approval.

Preserve backward compatibility whenever possible.
