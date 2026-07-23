-- Rollback for 006_seed_reference_data.js.
-- Only removes rows the seed itself creates, matched by their natural keys, so
-- operator-added lookups, roles, users and receipt settings survive.
-- Rows referenced by live orders will refuse to delete (FK RESTRICT) — that is
-- intentional: never destroy data a transaction points at.

DELETE FROM pos_users WHERE employee_id = 'WTR01';
DELETE FROM cake_production_checklist_template
 WHERE item_key IN ('base_baked','crumb_coated','decorated','boxed');
DELETE FROM lookup_master WHERE lookup_type = 'PRODUCT_BADGE';
DELETE FROM lookup_master WHERE lookup_type = 'TABLE_TAG';
DELETE FROM lookup_master
 WHERE lookup_type IN ('CREAM_TYPE','SHAPE_TYPE','SPONGE_TYPE','THEME_TYPE','DIETARY_TYPE');
DELETE FROM pos_roles WHERE name = 'WAITER';
DELETE FROM automation_category_actions;
DELETE FROM automation_action_types;
DELETE FROM automation_condition_types;
DELETE FROM automation_settings;
DELETE FROM weather_reco_settings WHERE id = 1;
DELETE FROM live_store_schedule;
DELETE FROM printer_config WHERE id = 1;
DELETE FROM receipt_config;

DELETE FROM schema_migrations WHERE number = 6;
