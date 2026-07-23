-- Rollback for 003_legacy_column_cleanup.sql — NOT REVERSIBLE.
--
-- The forward migration only drops things. Recreating an empty image_url
-- column or the old idx_pos_payments_cake_advance index would not restore
-- their contents, and that unique index would reject the split-tender advance
-- rows the POS now writes. Restore from backup if this must be undone.
--
-- Only the ledger entry is removed. The forward migration is idempotent
-- (IF EXISTS on every statement), so re-running it is harmless.

DELETE FROM schema_migrations WHERE number = 3;
