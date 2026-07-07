-- ============================================================
-- MTC POS & KDS — SQLite Schema
-- Rule: NEVER hard-delete. Soft-cancel everything.
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Stations ────────────────────────────────────────────────
-- Filter KDS views per prep station (Pizza, Barista, Grill…)
CREATE TABLE IF NOT EXISTS stations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  color_hex   TEXT    NOT NULL DEFAULT '#ffffff',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── Categories ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── Products ────────────────────────────────────────────────
-- prep_time_minutes drives KDS delay colouring logic.
-- is_fast_moving surfaces items in the POS right-pane.
CREATE TABLE IF NOT EXISTS products (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT    NOT NULL,
  category_id        INTEGER REFERENCES categories(id),
  station_id         INTEGER REFERENCES stations(id),
  price              REAL    NOT NULL CHECK(price >= 0),
  prep_time_minutes  INTEGER NOT NULL DEFAULT 10 CHECK(prep_time_minutes > 0),
  is_fast_moving     INTEGER NOT NULL DEFAULT 0,
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_category  ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_station   ON products(station_id);
CREATE INDEX IF NOT EXISTS idx_products_active    ON products(is_active);

-- ── Restaurant Tables ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS restaurant_tables (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  capacity   INTEGER NOT NULL DEFAULT 4,
  section    TEXT,                          -- e.g. "Indoor", "Terrace"
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1
);

-- ── Orders ──────────────────────────────────────────────────
-- One order per table session / takeaway / delivery etc.
-- Multiple KOTs are created per order (one per SEND).
CREATE TABLE IF NOT EXISTS orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_type       TEXT    NOT NULL
                     CHECK(order_type IN (
                       'DINE_IN','TAKEAWAY','DELIVERY','CAKE_ORDER','QUICK_SALE'
                     )),
  table_id         INTEGER REFERENCES restaurant_tables(id),
  customer_name    TEXT,
  customer_phone   TEXT,
  customer_address TEXT,
  delivery_notes   TEXT,
  status           TEXT    NOT NULL DEFAULT 'OPEN'
                     CHECK(status IN ('OPEN','SAVED','CLOSED','CANCELLED')),
  total_amount     REAL    NOT NULL DEFAULT 0,
  paid_amount      REAL    NOT NULL DEFAULT 0,
  discount_amount  REAL    NOT NULL DEFAULT 0,
  tax_amount       REAL    NOT NULL DEFAULT 0,
  notes            TEXT,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at        DATETIME
);

CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_table      ON orders(table_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_type       ON orders(order_type, status);
CREATE INDEX IF NOT EXISTS idx_orders_created    ON orders(created_at);

-- ── KOTs ────────────────────────────────────────────────────
-- Every SEND creates a NEW KOT. Never append to an existing KOT.
-- kot_number is scoped per order (KOT #1, KOT #2… for order X).
CREATE TABLE IF NOT EXISTS kots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id),
  kot_number  INTEGER NOT NULL,             -- sequential per order
  station_id  INTEGER REFERENCES stations(id), -- optional station override
  status      TEXT    NOT NULL DEFAULT 'ORDERSENT'
                CHECK(status IN ('ORDERSENT','IN_PROGRESS','SERVED','CANCELLED')),
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  served_at   DATETIME,
  UNIQUE(order_id, kot_number)
);

CREATE INDEX IF NOT EXISTS idx_kots_order   ON kots(order_id);
CREATE INDEX IF NOT EXISTS idx_kots_status  ON kots(status);
CREATE INDEX IF NOT EXISTS idx_kots_created ON kots(created_at);  -- KDS sort key

-- ── KOT Items ───────────────────────────────────────────────
-- Individual line items within a KOT.
-- is_home_pack → HP badge on KDS.
-- notes presence → yellow badge on KDS.
CREATE TABLE IF NOT EXISTS kot_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kot_id       INTEGER NOT NULL REFERENCES kots(id),
  product_id   INTEGER NOT NULL REFERENCES products(id),
  quantity     INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
  unit_price   REAL    NOT NULL,
  notes        TEXT,
  is_home_pack INTEGER NOT NULL DEFAULT 0,
  status       TEXT    NOT NULL DEFAULT 'ORDERSENT'
                 CHECK(status IN ('ORDERSENT','IN_PROGRESS','SERVED','CANCELLED')),
  served_at    DATETIME,

  -- Denormalised for history integrity (product name/prep_time may change)
  product_name      TEXT    NOT NULL,
  prep_time_minutes INTEGER NOT NULL DEFAULT 10
);

CREATE INDEX IF NOT EXISTS idx_kot_items_kot     ON kot_items(kot_id);
CREATE INDEX IF NOT EXISTS idx_kot_items_product ON kot_items(product_id);
CREATE INDEX IF NOT EXISTS idx_kot_items_status  ON kot_items(status);

-- ── Payments ────────────────────────────────────────────────
-- Multiple payments per order (split-pay, partial, etc.).
CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  method     TEXT    NOT NULL
               CHECK(method IN ('CASH','CARD','QR','LEDGER')),
  amount     REAL    NOT NULL CHECK(amount > 0),
  reference  TEXT,                          -- card ref, UPI txn id, etc.
  notes      TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

-- ── Customer Ledger ─────────────────────────────────────────
-- Allows checkout without full payment. Running balance per customer.
CREATE TABLE IF NOT EXISTS ledger (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name  TEXT    NOT NULL,
  customer_phone TEXT,
  order_id       INTEGER REFERENCES orders(id),
  type           TEXT    NOT NULL CHECK(type IN ('DEBIT','CREDIT')),
  amount         REAL    NOT NULL CHECK(amount > 0),
  balance_after  REAL    NOT NULL,          -- running balance snapshot
  notes          TEXT,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ledger_customer ON ledger(customer_phone);
CREATE INDEX IF NOT EXISTS idx_ledger_order    ON ledger(order_id);

-- ── Cancellations Log ────────────────────────────────────────
-- Soft-cancel record. Never hard-delete any row from any table.
-- entity_type + entity_id points back to the cancelled row.
CREATE TABLE IF NOT EXISTS cancellations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type   TEXT NOT NULL
                  CHECK(entity_type IN ('ORDER','KOT','KOT_ITEM')),
  entity_id     INTEGER NOT NULL,
  reason        TEXT,
  cancelled_by  TEXT,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cancellations_entity ON cancellations(entity_type, entity_id);

-- ── Triggers ────────────────────────────────────────────────

-- Auto-update orders.updated_at
CREATE TRIGGER IF NOT EXISTS trg_orders_updated
  AFTER UPDATE ON orders
BEGIN
  UPDATE orders SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Auto-update products.updated_at
CREATE TRIGGER IF NOT EXISTS trg_products_updated
  AFTER UPDATE ON products
BEGIN
  UPDATE products SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Recalculate order total when a KOT item is inserted/updated/cancelled
CREATE TRIGGER IF NOT EXISTS trg_recalc_on_item_insert
  AFTER INSERT ON kot_items
BEGIN
  UPDATE orders
  SET total_amount = (
    SELECT COALESCE(SUM(ki.quantity * ki.unit_price), 0)
    FROM   kot_items ki
    JOIN   kots k ON k.id = ki.kot_id
    WHERE  k.order_id = (
      SELECT order_id FROM kots WHERE id = NEW.kot_id
    ) AND ki.status != 'CANCELLED'
  )
  WHERE id = (SELECT order_id FROM kots WHERE id = NEW.kot_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_recalc_on_item_update
  AFTER UPDATE OF quantity, unit_price, status ON kot_items
BEGIN
  UPDATE orders
  SET total_amount = (
    SELECT COALESCE(SUM(ki.quantity * ki.unit_price), 0)
    FROM   kot_items ki
    JOIN   kots k ON k.id = ki.kot_id
    WHERE  k.order_id = (
      SELECT order_id FROM kots WHERE id = NEW.kot_id
    ) AND ki.status != 'CANCELLED'
  )
  WHERE id = (SELECT order_id FROM kots WHERE id = NEW.kot_id);
END;

-- Auto-close KOT when all its items are SERVED
CREATE TRIGGER IF NOT EXISTS trg_kot_auto_serve
  AFTER UPDATE OF status ON kot_items
  WHEN NEW.status = 'SERVED'
BEGIN
  UPDATE kots
  SET status = 'SERVED', served_at = CURRENT_TIMESTAMP
  WHERE id = NEW.kot_id
    AND NOT EXISTS (
      SELECT 1 FROM kot_items
      WHERE kot_id = NEW.kot_id AND status NOT IN ('SERVED','CANCELLED')
    );
END;

-- ── Seed Data ────────────────────────────────────────────────
INSERT OR IGNORE INTO stations (name, color_hex, sort_order) VALUES
  ('Main Kitchen',  '#f97316', 1),
  ('Barista',       '#8b5cf6', 2),
  ('Grill',         '#ef4444', 3),
  ('Cold Section',  '#3b82f6', 4);

INSERT OR IGNORE INTO categories (name, sort_order) VALUES
  ('Starters',    1),
  ('Mains',       2),
  ('Breads',      3),
  ('Beverages',   4),
  ('Desserts',    5),
  ('Quick Bites', 6);
