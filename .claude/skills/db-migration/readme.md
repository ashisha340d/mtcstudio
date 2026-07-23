# Database Migration Skill

## Purpose

This skill standardizes all database schema changes for the MTC Studio project.

It ensures every schema modification is:
- Versioned
- Reproducible
- Executed once
- Traceable
- Safe for production deployments

## When to Use

Use this skill whenever a task involves:

- Creating tables
- Altering tables
- Adding or removing columns
- Indexes
- Foreign keys
- Constraints
- Seed data
- Data backfills
- Database upgrades
- Schema refactoring

## Project Structure

```
server/
├── database/
│   ├── migrations/
│   │   ├── 001_cms_core_schema.sql
│   │   ├── 002_pos_core_schema.sql
│   │   ├── 003_legacy_column_cleanup.sql
│   │   ├── 004_indexes_and_constraints.sql
│   │   ├── 005_triggers.sql
│   │   ├── 006_seed_reference_data.js
│   │   ├── 007_data_backfills.sql
│   │   ├── 008_search_indexes_and_wifi_telemetry.sql
│   │   ├── README.md
│   │   └── rollback/
│   │       └── NNN_<same_name>.down.sql
│   ├── migrator.js          ← the runner
│   ├── mysqlPool.js         ← pool + query helpers
│   └── db.js                ← re-exports helpers + `ready`, no DDL
└── pos/db.js                ← same, for POS code paths
```

## Migration Workflow

1. Create a new sequential SQL migration.
2. Store it in `server/database/migrations/`.
3. The migration runner executes only unapplied migrations.
4. Record successful execution in `schema_migrations`.
5. Continue application startup.

## Rules

- Never execute schema changes in `db.js`.
- Never edit an applied migration.
- Never skip migration numbers.
- One logical change per migration.
- Use transactions whenever supported.
- Preserve existing data.
- Prefer separate migrations for schema changes and data backfills.

## Naming

`NNN_short_description.sql` — next free number, no gaps, never reused.
Rollbacks mirror the name: `rollback/NNN_short_description.down.sql`.

Migrations 001–008 are the existing baseline (see the table in
`server/database/migrations/README.md`). New work starts at 009, e.g.

```
009_create_customer_addresses.sql
010_add_customer_indexes.sql
011_backfill_customer_codes.sql
```

A `.js` migration exporting `async up(tx)` is allowed only where a backfill
needs real logic (`006_seed_reference_data.js` is the one precedent).

## Output

When using this skill, generated work should include:

- Migration filename
- SQL migration
- Rollback SQL (when possible)
- Files created
- Files modified

## Goal

Maintain a predictable, version-controlled database schema that is safe for development, testing, and production deployments.
