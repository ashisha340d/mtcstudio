-- Legacy cleanup: removes objects that older installs still carry.
--
-- Everything this file used to ADD or MODIFY now lives inline in the
-- CREATE TABLE statements of 001 and 002, so only the removals remain — a
-- CREATE TABLE cannot express "and drop this column that used to be here".
--
-- All three are already no-ops on the current production database (verified
-- against munchtim_mtcstudio: both columns and the index are absent).

-- Category and variant photos live in media_library and are referenced only
-- through image_id; the denormalised filename column is gone.
ALTER TABLE categories DROP COLUMN IF EXISTS image_url;
ALTER TABLE product_variants DROP COLUMN IF EXISTS image_url;

-- Split-tender advances + multiple follow-up payments per cake order —
-- the old one-row-per-type unique index must go on existing installs.
ALTER TABLE pos_payments DROP INDEX IF EXISTS idx_pos_payments_cake_advance;
