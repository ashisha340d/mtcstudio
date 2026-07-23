-- Search indexes and cross-table foreign keys.
-- Runs after 001-003 so every referenced table and column already exists.

-- Customer search — FULLTEXT for name/address/notes candidate retrieval, plain
-- indexes so phone2/email prefix lookups don't fall back to a table scan.
ALTER TABLE customers ADD FULLTEXT INDEX IF NOT EXISTS ft_customers_search (name, address, notes);
ALTER TABLE customers ADD INDEX IF NOT EXISTS idx_customers_phone2 (phone2);
ALTER TABLE customers ADD INDEX IF NOT EXISTS idx_customers_email (email);
ALTER TABLE customers ADD INDEX IF NOT EXISTS idx_customers_email2 (email2);
ALTER TABLE cake_design_media ADD INDEX IF NOT EXISTS idx_ckm_media (media_id);
ALTER TABLE cake_collections ADD INDEX IF NOT EXISTS idx_cc_hero_media (hero_media_id);
ALTER TABLE blogs ADD INDEX IF NOT EXISTS idx_blogs_featured_image (featured_image);
ALTER TABLE blogs ADD INDEX IF NOT EXISTS idx_blogs_author_image (author_image);

-- Superseded by live-computed usage (see mediaService.js)
DROP TABLE IF EXISTS media_tags;

-- ── FK constraints: composition CASCADE, history/business RESTRICT ──
ALTER TABLE product_variants ADD FOREIGN KEY IF NOT EXISTS fk_pv_product (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE product_images ADD FOREIGN KEY IF NOT EXISTS fk_pi_product (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE product_images ADD FOREIGN KEY IF NOT EXISTS fk_pi_media (media_id) REFERENCES media_library(id) ON DELETE CASCADE;
ALTER TABLE pos_modifiers ADD FOREIGN KEY IF NOT EXISTS fk_pm_product (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE product_modifier_assignments ADD FOREIGN KEY IF NOT EXISTS fk_pma_product (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE product_modifier_assignments ADD FOREIGN KEY IF NOT EXISTS fk_pma_modifier (modifier_id) REFERENCES shared_modifiers(id) ON DELETE CASCADE;
ALTER TABLE weather_recommendations ADD FOREIGN KEY IF NOT EXISTS fk_wr_product (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE pos_kot_items ADD FOREIGN KEY IF NOT EXISTS fk_ki_product (product_id) REFERENCES products(id) ON DELETE RESTRICT;
ALTER TABLE web_order_items ADD FOREIGN KEY IF NOT EXISTS fk_woi_product (product_id) REFERENCES products(id) ON DELETE RESTRICT;
ALTER TABLE cake_order_items ADD FOREIGN KEY IF NOT EXISTS fk_coi_product (product_id) REFERENCES products(id) ON DELETE RESTRICT;
ALTER TABLE cake_order_accessories ADD FOREIGN KEY IF NOT EXISTS fk_coa_product (product_id) REFERENCES products(id) ON DELETE RESTRICT;
ALTER TABLE products ADD FOREIGN KEY IF NOT EXISTS fk_p_category (category_id) REFERENCES categories(id) ON DELETE RESTRICT;
ALTER TABLE cake_orders ADD FOREIGN KEY IF NOT EXISTS fk_co_customer (crm_customer_id) REFERENCES pos_customers(id) ON DELETE RESTRICT;

-- Customer/catalogue masters owned by the companion website app: block delete
-- while transactional data exists, but skip silently where the table is absent.
-- @optional
ALTER TABLE cake_catalogue ADD FOREIGN KEY IF NOT EXISTS fk_cc_product (product_id) REFERENCES products(id) ON DELETE RESTRICT;
-- @optional
ALTER TABLE loyalty_ledger ADD FOREIGN KEY IF NOT EXISTS fk_ll_customer (customer_id) REFERENCES web_customer(customer_id) ON DELETE RESTRICT;
-- @optional
ALTER TABLE web_orders ADD FOREIGN KEY IF NOT EXISTS fk_wo_customer (customer_id) REFERENCES web_customer(customer_id) ON DELETE RESTRICT;
