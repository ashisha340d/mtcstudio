-- Order-total recalculation and KOT auto-serve triggers.
-- Each body is a single statement, so no DELIMITER handling is required.

DROP TRIGGER IF EXISTS trg_pos_recalc_insert;
CREATE TRIGGER trg_pos_recalc_insert
  AFTER INSERT ON pos_kot_items
  FOR EACH ROW
UPDATE pos_orders SET total_amount = (
  SELECT COALESCE(SUM(ki.quantity * ki.unit_price - ki.discount_amount), 0)
  FROM   pos_kot_items ki JOIN pos_kots k ON k.id = ki.kot_id
  WHERE  k.order_id = (SELECT order_id FROM pos_kots WHERE id = NEW.kot_id)
    AND  ki.status != 'CANCELLED'
) WHERE id = (SELECT order_id FROM pos_kots WHERE id = NEW.kot_id);

DROP TRIGGER IF EXISTS trg_pos_recalc_update;
CREATE TRIGGER trg_pos_recalc_update
  AFTER UPDATE ON pos_kot_items
  FOR EACH ROW
UPDATE pos_orders SET total_amount = (
  SELECT COALESCE(SUM(ki.quantity * ki.unit_price - ki.discount_amount), 0)
  FROM   pos_kot_items ki JOIN pos_kots k ON k.id = ki.kot_id
  WHERE  k.order_id = (SELECT order_id FROM pos_kots WHERE id = NEW.kot_id)
    AND  ki.status != 'CANCELLED'
) WHERE id = (SELECT order_id FROM pos_kots WHERE id = NEW.kot_id);

DROP TRIGGER IF EXISTS trg_pos_kot_auto_serve;
CREATE TRIGGER trg_pos_kot_auto_serve
  AFTER UPDATE ON pos_kot_items
  FOR EACH ROW
UPDATE pos_kots SET status = 'SERVED', served_at = CURRENT_TIMESTAMP
WHERE  id = NEW.kot_id
  AND  NEW.status = 'SERVED'
  AND  NOT EXISTS (
    SELECT 1 FROM pos_kot_items
    WHERE  kot_id = NEW.kot_id AND status NOT IN ('SERVED','CANCELLED')
  );
