-- Rollback for 001_cms_core_schema.sql — DESTRUCTIVE, drops catalogue data.
-- Reverse dependency order. Run manually, never automatically.

DROP TABLE IF EXISTS automation_test_runs;
DROP TABLE IF EXISTS automation_execution_log;
DROP TABLE IF EXISTS automation_rule_versions;
DROP TABLE IF EXISTS automation_rules;
DROP TABLE IF EXISTS automation_settings;
DROP TABLE IF EXISTS automation_category_actions;
DROP TABLE IF EXISTS automation_action_types;
DROP TABLE IF EXISTS automation_condition_types;
DROP TABLE IF EXISTS weather_reco_settings;
DROP TABLE IF EXISTS weather_recommendations;
DROP TABLE IF EXISTS cake_collection_items;
DROP TABLE IF EXISTS cake_collections;
DROP TABLE IF EXISTS cake_design_creams;
DROP TABLE IF EXISTS cake_design_flavours;
DROP TABLE IF EXISTS cake_design_sizes;
DROP TABLE IF EXISTS cake_design_media;
DROP TABLE IF EXISTS cake_designs;
DROP TABLE IF EXISTS blogs;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS live_store_schedule;
DROP TABLE IF EXISTS live_shelf;
DROP TABLE IF EXISTS printer_config;
DROP TABLE IF EXISTS receipt_config;
DROP TABLE IF EXISTS product_images;
DROP TABLE IF EXISTS media_library;
DROP TABLE IF EXISTS product_variants;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;

DELETE FROM schema_migrations WHERE number = 1;
