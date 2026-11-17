-- Rollback for 018_fonepay_payments.sql. DESTRUCTIVE: payment log is lost.
DROP TABLE IF EXISTS pos_fonepay_payments;

DELETE FROM schema_migrations WHERE number = 18;
