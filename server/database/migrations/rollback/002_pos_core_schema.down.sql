-- Rollback for 002_pos_core_schema.sql — DESTRUCTIVE, drops all POS history.
-- Reverse dependency order. Run manually, never automatically.

DROP TABLE IF EXISTS combo_items;
DROP TABLE IF EXISTS pos_ocr_imports;
DROP TABLE IF EXISTS recommended_products;
DROP TABLE IF EXISTS web_order_items;
DROP TABLE IF EXISTS web_orders_pending;
DROP TABLE IF EXISTS pos_scheduled_orders;
DROP TABLE IF EXISTS pos_customer_notes;
DROP TABLE IF EXISTS pos_customer_addresses;
DROP TABLE IF EXISTS sms_logs;
DROP TABLE IF EXISTS sms_queue;
DROP TABLE IF EXISTS pos_call_events;
DROP TABLE IF EXISTS pos_devices;
DROP TABLE IF EXISTS cake_production_checklist_template;
DROP TABLE IF EXISTS cake_production_state;
DROP TABLE IF EXISTS cake_production_photos;
DROP TABLE IF EXISTS waiter_calls;
DROP TABLE IF EXISTS lookup_master;
DROP TABLE IF EXISTS cake_order_images;
DROP TABLE IF EXISTS cake_order_accessories;
DROP TABLE IF EXISTS cake_order_items;
DROP TABLE IF EXISTS cake_order_status_history;
DROP TABLE IF EXISTS pos_day_closures;
DROP TABLE IF EXISTS pos_cash_movements;
DROP TABLE IF EXISTS pos_till_sessions;
DROP TABLE IF EXISTS product_modifier_assignments;
DROP TABLE IF EXISTS shared_modifiers;
DROP TABLE IF EXISTS modifier_groups;
DROP TABLE IF EXISTS pos_modifiers;
DROP TABLE IF EXISTS pos_cancellations;
DROP TABLE IF EXISTS pos_ledger;
DROP TABLE IF EXISTS pos_payments;
DROP TABLE IF EXISTS cake_orders;
DROP TABLE IF EXISTS pos_kot_items;
DROP TABLE IF EXISTS pos_kots;
DROP TABLE IF EXISTS pos_orders;
DROP TABLE IF EXISTS pos_customers;
DROP TABLE IF EXISTS pos_restaurant_tables;
DROP TABLE IF EXISTS pos_stations;
DROP TABLE IF EXISTS pos_audit_log;
DROP TABLE IF EXISTS pos_sessions;
DROP TABLE IF EXISTS pos_users;
DROP TABLE IF EXISTS pos_roles;

DELETE FROM schema_migrations WHERE number = 2;
