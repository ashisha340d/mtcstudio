-- One-off data backfills. Both are idempotent (guarded by a WHERE), but the
-- migration ledger means they now run once instead of on every boot.

-- Pre-populate pos_price from the first active variant where still 0.
UPDATE products p
JOIN (
  SELECT product_id, selling_price
  FROM product_variants v1
  WHERE status = 'active'
    AND id = (
      SELECT id FROM product_variants v2
      WHERE v2.product_id = v1.product_id AND v2.status = 'active'
      ORDER BY sort_order, id LIMIT 1
    )
) pv ON pv.product_id = p.id
SET p.pos_price = COALESCE(pv.selling_price, 0)
WHERE p.pos_price = 0;

-- Till sessions predating the business-day column take it from opened_at.
UPDATE pos_till_sessions SET business_date = DATE(opened_at) WHERE business_date IS NULL;
