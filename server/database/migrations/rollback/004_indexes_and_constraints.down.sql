-- Rollback for 004_indexes_and_constraints.sql.
-- Non-destructive except that the dropped media_tags table cannot be restored
-- with its contents (it was already unused — see mediaService.js).

-- @optional
ALTER TABLE web_orders DROP FOREIGN KEY fk_wo_customer;
-- @optional
ALTER TABLE loyalty_ledger DROP FOREIGN KEY fk_ll_customer;
-- @optional
ALTER TABLE cake_catalogue DROP FOREIGN KEY fk_cc_product;
ALTER TABLE cake_orders DROP FOREIGN KEY fk_co_customer;
ALTER TABLE products DROP FOREIGN KEY fk_p_category;
ALTER TABLE cake_order_accessories DROP FOREIGN KEY fk_coa_product;
ALTER TABLE cake_order_items DROP FOREIGN KEY fk_coi_product;
ALTER TABLE web_order_items DROP FOREIGN KEY fk_woi_product;
ALTER TABLE pos_kot_items DROP FOREIGN KEY fk_ki_product;
ALTER TABLE weather_recommendations DROP FOREIGN KEY fk_wr_product;
ALTER TABLE product_modifier_assignments DROP FOREIGN KEY fk_pma_modifier;
ALTER TABLE product_modifier_assignments DROP FOREIGN KEY fk_pma_product;
ALTER TABLE pos_modifiers DROP FOREIGN KEY fk_pm_product;
ALTER TABLE product_images DROP FOREIGN KEY fk_pi_media;
ALTER TABLE product_images DROP FOREIGN KEY fk_pi_product;
ALTER TABLE product_variants DROP FOREIGN KEY fk_pv_product;

ALTER TABLE blogs DROP INDEX idx_blogs_author_image;
ALTER TABLE blogs DROP INDEX idx_blogs_featured_image;
ALTER TABLE cake_collections DROP INDEX idx_cc_hero_media;
ALTER TABLE cake_design_media DROP INDEX idx_ckm_media;
ALTER TABLE customers DROP INDEX idx_customers_email2;
ALTER TABLE customers DROP INDEX idx_customers_email;
ALTER TABLE customers DROP INDEX idx_customers_phone2;
ALTER TABLE customers DROP INDEX ft_customers_search;

DELETE FROM schema_migrations WHERE number = 4;
