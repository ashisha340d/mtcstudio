-- Rollback for 007_data_backfills.sql — NOT REVERSIBLE.
--
-- Both statements overwrote a placeholder value (products.pos_price = 0,
-- pos_till_sessions.business_date = NULL) with a derived one. The original
-- values are not recoverable from the current rows, and blanking the columns
-- again would destroy prices and business dates that have since been edited
-- by hand. Restore from backup if this must be undone.
--
-- Only the ledger entry is removed, so the backfill re-runs on next start.
-- It is idempotent: pos_price is only touched where it is still 0, and
-- business_date only where it is still NULL.

DELETE FROM schema_migrations WHERE number = 7;
