-- Rollback for 005_triggers.sql. Fully reversible — no data is touched, but
-- pos_orders.total_amount stops self-maintaining until the triggers return.

DROP TRIGGER IF EXISTS trg_pos_kot_auto_serve;
DROP TRIGGER IF EXISTS trg_pos_recalc_update;
DROP TRIGGER IF EXISTS trg_pos_recalc_insert;

DELETE FROM schema_migrations WHERE number = 5;
