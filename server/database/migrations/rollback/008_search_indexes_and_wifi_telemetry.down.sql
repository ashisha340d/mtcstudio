-- Rollback for 008_search_indexes_and_wifi_telemetry.sql.
-- DESTRUCTIVE for the two wifi_* tables (telemetry history is lost).
-- Dropping the FULLTEXT indexes is safe — OCR matching falls back to fuzzy
-- token scoring, only slower.

DROP TABLE IF EXISTS wifi_events;
DROP TABLE IF EXISTS wifi_devices;

ALTER TABLE product_variants DROP INDEX ft_variants_name_sku;
ALTER TABLE products DROP INDEX ft_products_name;

DELETE FROM schema_migrations WHERE number = 8;
