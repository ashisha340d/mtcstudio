-- Auto KDS: variant never reaches the kitchen display — its KOT line is posted
-- already SERVED (same path as station-less items such as water).
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS auto_kds TINYINT DEFAULT 0 AFTER check_on_bill;
