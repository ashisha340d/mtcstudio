# Cake Atelier — Cream Selection & Prep Time (web-side update)

Two changes were made in the CMS (MTC Studio) to `cake_designs`. Both are
already synced by the existing **🔄 Sync** button, but the **live website**
(munchtimecafe.com.np) needs its display/pricing logic updated to actually use
them — the data alone won't change anything on the frontend.

## 1. Per-design cream selection + rate override

**Before:** `cake_designs.cream_choice` was a simple on/off flag. When on, the
website showed *every* row in `cake_creams` (global list) as an option, all at
the same global `surcharge`.

**Now:** a new join table decides which creams apply to a specific design, and
lets each one have a design-specific rate.

```sql
CREATE TABLE cake_design_creams (
    id         INT PRIMARY KEY,
    design_id  INT NOT NULL,   -- → cake_designs.id
    cream_id   INT NOT NULL,   -- → cake_creams.id
    surcharge  DOUBLE DEFAULT 0,  -- Rs/kg override for THIS design (not the global rate)
    sort_order INT DEFAULT 0
);
```

**What the website needs to do:**
- If `cream_choice = 1` for a design, fetch its cream options with:
  ```sql
  SELECT dc.cream_id, c.name, dc.surcharge
  FROM cake_design_creams dc
  JOIN cake_creams c ON c.id = dc.cream_id
  WHERE dc.design_id = ?
  ORDER BY dc.sort_order;
  ```
- Use `dc.surcharge` (not `cake_creams.surcharge`) for pricing — it's the
  per-design override.
- **Backward-compat note:** designs saved before this change may have
  `cream_choice = 1` but zero rows in `cake_design_creams` (nobody has picked
  specific creams for them yet in the CMS). Decide how to handle that case —
  either show no cream picker until the CMS admin ticks some creams, or fall
  back to the old "show all active `cake_creams`" behavior. This is a product
  decision, not something the CMS enforces.

## 2. Prep time / lead time

**New column:** `cake_designs.prep_time_hours` (INT, default `24`).

Admin enters how many hours ahead a customer needs to order a given design
(e.g. `24`, `6`). Show this on the design/product page so customers know
whether they need to order in advance — e.g. *"⏱ Needs 24 hrs advance order"*.

## Deployment checklist

- [x] CMS schema updated (`cake_designs.prep_time_hours`, new
      `cake_design_creams` table) — done in MTC Studio.
- [x] `server/services/cakeCatalogSyncService.js` — added `cake_design_creams`
      to the tables pushed on sync.
- [x] `server/remote_php/synccakes.php` — added `prep_time_hours` column and
      `cake_design_creams` table to the remote schema so Sync creates/fills
      them on the live DB.
- [ ] **Re-upload the updated `synccakes.php`** to
      `public_html/api/synccakes.php` on the live host (it was only edited
      locally in this repo — the remote copy is stale until re-uploaded).
- [ ] Website: update the cake design page to query `cake_design_creams`
      instead of all of `cake_creams`, and use the per-design `surcharge`.
- [ ] Website: display `prep_time_hours` on the design page.
- [ ] After the PHP file is re-uploaded, click **🔄 Sync** in the CMS once to
      push existing designs' data (including backfilling `cake_design_creams`
      for any design where the admin has since selected specific creams).
