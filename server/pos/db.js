'use strict';
const bcrypt = require('bcryptjs');
const { dbAll, dbGet, dbRun, transaction } = require('../database/mysqlPool');

async function ensureSchema() {
  await dbRun(`CREATE TABLE IF NOT EXISTS pos_roles (
    id   INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(64) NOT NULL UNIQUE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await dbRun(`CREATE TABLE IF NOT EXISTS pos_users (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    name        TEXT    NOT NULL,
    employee_id VARCHAR(64) NOT NULL UNIQUE,
    role_id     INT NOT NULL,
    pin_hash    TEXT    NOT NULL,
    is_active   INT NOT NULL DEFAULT 1,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(role_id) REFERENCES pos_roles(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await dbRun(`CREATE TABLE IF NOT EXISTS pos_sessions (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    user_id     INT NOT NULL,
    token       VARCHAR(191) NOT NULL UNIQUE,
    terminal_id TEXT,
    started_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at    DATETIME,
    FOREIGN KEY(user_id) REFERENCES pos_users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pos_sessions_token ON pos_sessions(token)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS pos_audit_log (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    user_id     INT NOT NULL,
    session_id  INT,
    entity_type VARCHAR(64) NOT NULL,
    entity_id   INT NOT NULL,
    action      VARCHAR(64) NOT NULL,
    delta_json  LONGTEXT,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pos_audit_entity ON pos_audit_log(entity_type, entity_id)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS pos_stations (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    name       VARCHAR(64) NOT NULL UNIQUE,
    color_hex  VARCHAR(16) NOT NULL DEFAULT '#ffffff',
    sort_order INT NOT NULL DEFAULT 0,
    is_active  INT NOT NULL DEFAULT 1
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await dbRun(`CREATE TABLE IF NOT EXISTS pos_restaurant_tables (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    name       VARCHAR(64) NOT NULL UNIQUE,
    capacity   INT NOT NULL DEFAULT 4,
    section    TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    is_active  INT NOT NULL DEFAULT 1
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await dbRun(`CREATE TABLE IF NOT EXISTS pos_customers (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    name       TEXT    NOT NULL,
    phone      VARCHAR(32) NOT NULL UNIQUE,
    address    TEXT,
    notes      TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pos_customers_phone ON pos_customers(phone)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS pos_orders (
    id               INT PRIMARY KEY AUTO_INCREMENT,
    order_type       VARCHAR(32) NOT NULL CHECK(order_type IN
                       ('DINE_IN','TAKEAWAY','DELIVERY','CAKE_ORDER','QUICK_SALE')),
    table_id         INT,
    customer_id      INT,
    customer_name    TEXT,
    customer_phone   TEXT,
    customer_address TEXT,
    status           VARCHAR(32) NOT NULL DEFAULT 'OPEN'
                       CHECK(status IN ('OPEN','SAVED','CLOSED','CANCELLED')),
    total_amount     DOUBLE NOT NULL DEFAULT 0,
    paid_amount      DOUBLE NOT NULL DEFAULT 0,
    discount_amount  DOUBLE NOT NULL DEFAULT 0,
    notes            TEXT,
    punched_by       INT,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at        DATETIME,
    FOREIGN KEY(table_id) REFERENCES pos_restaurant_tables(id),
    FOREIGN KEY(customer_id) REFERENCES pos_customers(id),
    FOREIGN KEY(punched_by) REFERENCES pos_users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pos_orders_status  ON pos_orders(status)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pos_orders_table   ON pos_orders(table_id, status)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pos_orders_created ON pos_orders(created_at)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS pos_kots (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    order_id   INT NOT NULL,
    kot_number INT NOT NULL,
    status     VARCHAR(32) NOT NULL DEFAULT 'ORDERSENT'
                 CHECK(status IN ('ORDERSENT','IN_PROGRESS','SERVED','CANCELLED')),
    punched_by INT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    served_at  DATETIME,
    FOREIGN KEY(order_id) REFERENCES pos_orders(id),
    FOREIGN KEY(punched_by) REFERENCES pos_users(id),
    UNIQUE(order_id, kot_number)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pos_kots_order   ON pos_kots(order_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pos_kots_status  ON pos_kots(status)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pos_kots_created ON pos_kots(created_at)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS pos_kot_items (
    id                INT PRIMARY KEY AUTO_INCREMENT,
    kot_id            INT NOT NULL,
    product_id        INT NOT NULL,
    quantity          INT NOT NULL DEFAULT 1,
    unit_price        DOUBLE NOT NULL,
    notes             TEXT,
    is_home_pack      INT NOT NULL DEFAULT 0,
    status            VARCHAR(32) NOT NULL DEFAULT 'ORDERSENT'
                        CHECK(status IN ('ORDERSENT','IN_PROGRESS','SERVED','CANCELLED')),
    served_at         DATETIME,
    product_name      TEXT NOT NULL,
    prep_time_minutes INT NOT NULL DEFAULT 10,
    station_id        INT,
    customer_notes    TEXT,
    variant_id        INT,
    FOREIGN KEY(kot_id) REFERENCES pos_kots(id),
    FOREIGN KEY(station_id) REFERENCES pos_stations(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pos_kot_items_kot    ON pos_kot_items(kot_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pos_kot_items_status ON pos_kot_items(status)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS cake_orders (
    id                   INT PRIMARY KEY AUTO_INCREMENT,
    order_number         VARCHAR(64) NOT NULL UNIQUE,
    crm_customer_id      INT,
    phone                TEXT,
    customer_name        TEXT    NOT NULL,
    order_date           DATE    NOT NULL DEFAULT (CURRENT_DATE),
    delivery_date        DATE,
    delivery_time        TEXT,
    shape_id             INT,
    cream_type_id        INT,
    sponge_type_id       INT,
    theme_id             INT,
    dietary_type_id      INT,
    message_on_cake      TEXT,
    design_notes         TEXT,
    dietary_notes        TEXT,
    allergy_notes        TEXT,
    internal_notes       TEXT,
    production_notes     TEXT,
    production_status    TEXT,
    assigned_baker       TEXT,
    cake_total           DOUBLE NOT NULL DEFAULT 0,
    modifier_total       DOUBLE NOT NULL DEFAULT 0,
    accessory_total       DOUBLE NOT NULL DEFAULT 0,
    discount             DOUBLE NOT NULL DEFAULT 0,
    grand_total          DOUBLE NOT NULL DEFAULT 0,
    advance_paid         DOUBLE NOT NULL DEFAULT 0,
    balance_due          DOUBLE NOT NULL DEFAULT 0,
    status               VARCHAR(32) NOT NULL DEFAULT 'PENDING'
                           CHECK(status IN ('PENDING','CONFIRMED','IN_PRODUCTION','READY','DELIVERED','CANCELLED','REFUNDED')),
    created_by           INT,
    created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at           DATETIME,
    FOREIGN KEY(created_by) REFERENCES pos_users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_cake_orders_status   ON cake_orders(status)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_cake_orders_delivery ON cake_orders(delivery_date)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_cake_orders_date     ON cake_orders(order_date)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_cake_orders_phone    ON cake_orders(phone(64))`);

  await dbRun(`CREATE TABLE IF NOT EXISTS pos_payments (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    order_id      INT,
    cake_order_id INT,
    method        VARCHAR(16) NOT NULL CHECK(method IN ('CASH','CARD','QR','LEDGER')),
    amount        DOUBLE NOT NULL,
    payment_type  VARCHAR(16) NOT NULL DEFAULT 'REGULAR' CHECK(payment_type IN ('ADVANCE','REGULAR')),
    reference     TEXT,
    notes         TEXT,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY(order_id) REFERENCES pos_orders(id),
    FOREIGN KEY(cake_order_id) REFERENCES cake_orders(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pos_payments_order ON pos_payments(order_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pos_payments_cake  ON pos_payments(cake_order_id)`);
  await dbRun(`ALTER TABLE pos_payments ADD COLUMN IF NOT EXISTS payment_type VARCHAR(16) NOT NULL DEFAULT 'REGULAR' CHECK(payment_type IN ('ADVANCE','REGULAR'))`);
  await dbRun(`ALTER TABLE pos_payments ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
  // Split-tender advances + multiple follow-up payments per cake order —
  // the old one-row-per-type unique index must go on existing installs.
  await dbRun(`ALTER TABLE pos_payments DROP INDEX IF EXISTS idx_pos_payments_cake_advance`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pos_payments_created ON pos_payments(created_at)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS pos_ledger (
    id             INT PRIMARY KEY AUTO_INCREMENT,
    customer_name  TEXT NOT NULL,
    customer_phone TEXT,
    customer_id    INT,
    order_id       INT,
    type           VARCHAR(16) NOT NULL CHECK(type IN ('DEBIT','CREDIT')),
    amount         DOUBLE NOT NULL,
    balance_after  DOUBLE NOT NULL,
    notes          TEXT,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(customer_id) REFERENCES pos_customers(id),
    FOREIGN KEY(order_id) REFERENCES pos_orders(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await dbRun(`CREATE TABLE IF NOT EXISTS pos_cancellations (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    entity_type   VARCHAR(16) NOT NULL CHECK(entity_type IN ('ORDER','KOT','KOT_ITEM')),
    entity_id     INT NOT NULL,
    reason        TEXT,
    cancelled_by  INT,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(cancelled_by) REFERENCES pos_users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  // CANCEL = mistake/edit, RETURN = customer returned prepared food, WASTE = kitchen flaw
  await dbRun(`ALTER TABLE pos_cancellations ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'CANCEL'`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pos_cancellations_created ON pos_cancellations(created_at)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS pos_modifiers (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    product_id INT NOT NULL,
    name       TEXT    NOT NULL,
    price      DOUBLE    NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    is_active  INT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pos_modifiers_product ON pos_modifiers(product_id)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS modifier_groups (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    name       VARCHAR(191) NOT NULL UNIQUE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await dbRun(`CREATE TABLE IF NOT EXISTS shared_modifiers (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    group_id   INT,
    name       TEXT    NOT NULL,
    price      DOUBLE    NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    is_active  INT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(group_id) REFERENCES modifier_groups(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_shared_modifiers_group ON shared_modifiers(group_id)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS product_modifier_assignments (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    product_id  INT NOT NULL,
    modifier_id INT NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY(modifier_id) REFERENCES shared_modifiers(id) ON DELETE CASCADE,
    UNIQUE(product_id, modifier_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pma_product  ON product_modifier_assignments(product_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pma_modifier ON product_modifier_assignments(modifier_id)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS pos_till_sessions (
    id                   INT PRIMARY KEY AUTO_INCREMENT,
    opened_by            INT NOT NULL,
    opened_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    opening_float        DOUBLE NOT NULL DEFAULT 0,
    closed_by            INT,
    closed_at            DATETIME,
    closing_counted      DOUBLE,
    cash_sales           DOUBLE NOT NULL DEFAULT 0,
    card_sales           DOUBLE NOT NULL DEFAULT 0,
    qr_sales             DOUBLE NOT NULL DEFAULT 0,
    variance             DOUBLE,
    variance_note        TEXT,
    variance_approved_by INT,
    status               VARCHAR(16) NOT NULL DEFAULT 'OPEN'
                           CHECK(status IN ('OPEN','CLOSED')),
    FOREIGN KEY(opened_by) REFERENCES pos_users(id),
    FOREIGN KEY(closed_by) REFERENCES pos_users(id),
    FOREIGN KEY(variance_approved_by) REFERENCES pos_users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await dbRun(`CREATE TABLE IF NOT EXISTS pos_cash_movements (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    till_session_id INT NOT NULL,
    type            VARCHAR(20) NOT NULL CHECK(type IN ('CASH_IN','PETTY_CASH','PAID_OUT','CREDIT_RECEIVED')),
    amount          DOUBLE NOT NULL,
    reason          TEXT,
    customer_name   TEXT,
    customer_phone  VARCHAR(32),
    created_by      INT,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(till_session_id) REFERENCES pos_till_sessions(id),
    FOREIGN KEY(created_by) REFERENCES pos_users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pos_cash_movements_till    ON pos_cash_movements(till_session_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_pos_cash_movements_created ON pos_cash_movements(created_at)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS pos_day_closures (
    id                INT PRIMARY KEY AUTO_INCREMENT,
    business_date     DATE NOT NULL UNIQUE,
    snapshot_json     LONGTEXT NOT NULL,
    sales_balanced    INT NOT NULL DEFAULT 0,
    payments_balanced INT NOT NULL DEFAULT 0,
    cash_balanced     INT NOT NULL DEFAULT 0,
    orders_balanced   INT NOT NULL DEFAULT 0,
    cakes_balanced    INT NOT NULL DEFAULT 0,
    credits_balanced  INT NOT NULL DEFAULT 0,
    day_closed        INT NOT NULL DEFAULT 0,
    closed_by         INT,
    closed_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes             TEXT,
    FOREIGN KEY(closed_by) REFERENCES pos_users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await dbRun(`CREATE TABLE IF NOT EXISTS cake_order_status_history (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    cake_order_id INT NOT NULL,
    old_status    TEXT,
    new_status    TEXT    NOT NULL,
    changed_by    INT,
    changed_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(cake_order_id) REFERENCES cake_orders(id),
    FOREIGN KEY(changed_by) REFERENCES pos_users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_cosh_order ON cake_order_status_history(cake_order_id)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS cake_order_items (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    cake_order_id INT NOT NULL,
    product_id    INT,
    variant_id    INT,
    product_name  TEXT    NOT NULL,
    variant_name  TEXT,
    size          TEXT,
    unit          VARCHAR(16) NOT NULL DEFAULT 'PCS',
    qty           INT NOT NULL DEFAULT 1,
    rate          DOUBLE NOT NULL DEFAULT 0,
    amount        DOUBLE NOT NULL DEFAULT 0,
    sort_order    INT NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_coi_order ON cake_order_items(cake_order_id)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS cake_order_accessories (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    cake_order_id INT NOT NULL,
    product_id    INT,
    variant_id    INT,
    product_name  TEXT    NOT NULL,
    variant_name  TEXT,
    unit          VARCHAR(16) NOT NULL DEFAULT 'PCS',
    qty           INT NOT NULL DEFAULT 1,
    rate          DOUBLE NOT NULL DEFAULT 0,
    amount        DOUBLE NOT NULL DEFAULT 0,
    sort_order    INT NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_coa_order ON cake_order_accessories(cake_order_id)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS cake_order_images (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    cake_order_id INT NOT NULL,
    image_url     TEXT    NOT NULL,
    image_name    TEXT,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_coimages_order ON cake_order_images(cake_order_id)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS lookup_master (
    id           INT PRIMARY KEY AUTO_INCREMENT,
    lookup_type  VARCHAR(64) NOT NULL,
    code         VARCHAR(64),
    name         TEXT    NOT NULL,
    value        TEXT,
    extra_charge DOUBLE  NOT NULL DEFAULT 0,
    description  TEXT,
    sort_order   INT NOT NULL DEFAULT 0,
    is_active    INT NOT NULL DEFAULT 1,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(lookup_type, name(191))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_lookup_master_type ON lookup_master(lookup_type)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS waiter_calls (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    table_id    INT NOT NULL,
    table_name  TEXT,
    status      VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    FOREIGN KEY(table_id) REFERENCES pos_restaurant_tables(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_waiter_calls_table ON waiter_calls(table_id, status)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS cake_production_photos (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    cake_order_id INT NOT NULL,
    slot_number   INT NOT NULL CHECK(slot_number BETWEEN 1 AND 3),
    image_url     TEXT NOT NULL,
    image_name    TEXT,
    uploaded_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY(cake_order_id) REFERENCES cake_orders(id),
    UNIQUE(cake_order_id, slot_number)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_cpp_order   ON cake_production_photos(cake_order_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_cpp_updated ON cake_production_photos(updated_at)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS cake_production_state (
    cake_order_id  INT PRIMARY KEY,
    checklist_json LONGTEXT NOT NULL,
    tags_json      LONGTEXT NOT NULL,
    updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY(cake_order_id) REFERENCES cake_orders(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_cps_updated ON cake_production_state(updated_at)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS cake_production_checklist_template (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    item_key   VARCHAR(191) NOT NULL UNIQUE,
    label      TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // ── Pending Web Orders (pushed from the website over the WS bridge) ──
  await dbRun(`CREATE TABLE IF NOT EXISTS web_orders_pending (
    id                INT PRIMARY KEY AUTO_INCREMENT,
    web_order_id      INT NOT NULL UNIQUE,
    order_number      VARCHAR(64) NOT NULL,
    source            VARCHAR(32) NOT NULL DEFAULT 'WEB_ORDERING',
    order_type        VARCHAR(20) NOT NULL DEFAULT 'Pickup',
    customer_name     TEXT,
    customer_phone    VARCHAR(32),
    customer_address  TEXT,
    landmark          TEXT,
    customer_notes    TEXT,
    items_json        LONGTEXT NOT NULL,
    subtotal          DOUBLE NOT NULL DEFAULT 0,
    discount          DOUBLE NOT NULL DEFAULT 0,
    tax               DOUBLE NOT NULL DEFAULT 0,
    delivery_charge   DOUBLE NOT NULL DEFAULT 0,
    grand_total       DOUBLE NOT NULL DEFAULT 0,
    distance_km       DOUBLE,
    payment_method    VARCHAR(20) NOT NULL DEFAULT 'COD',
    payment_status    VARCHAR(20) NOT NULL DEFAULT 'UNPAID',
    payment_reference TEXT,
    status            VARCHAR(32) NOT NULL DEFAULT 'PENDING_APPROVAL'
                        CHECK(status IN ('PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED','EXPIRED')),
    pos_order_id      INT,
    approved_by       INT,
    approved_at       DATETIME,
    rejected_by       INT,
    rejected_at       DATETIME,
    reject_reason     TEXT,
    ordered_at        DATETIME,
    received_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(pos_order_id) REFERENCES pos_orders(id),
    FOREIGN KEY(approved_by) REFERENCES pos_users(id),
    FOREIGN KEY(rejected_by) REFERENCES pos_users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_wop_status   ON web_orders_pending(status)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_wop_received ON web_orders_pending(received_at)`);

  await dbRun(`CREATE TABLE IF NOT EXISTS web_order_items (
    id             INT PRIMARY KEY AUTO_INCREMENT,
    pending_id     INT NOT NULL,
    web_pid        VARCHAR(64),
    kind           VARCHAR(20) NOT NULL DEFAULT 'product',
    product_id     INT,
    variant_id     INT,
    item_name      TEXT NOT NULL,
    variant_name   TEXT,
    quantity       INT NOT NULL DEFAULT 1,
    unit_price     DOUBLE NOT NULL DEFAULT 0,
    line_total     DOUBLE NOT NULL DEFAULT 0,
    modifiers_json LONGTEXT,
    special_note   TEXT,
    sort_order     INT NOT NULL DEFAULT 0,
    FOREIGN KEY(pending_id) REFERENCES web_orders_pending(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_woi_pending ON web_order_items(pending_id)`);

  // ── Column additions on shared tables ─────────────────────────
  await dbRun(`ALTER TABLE categories ADD COLUMN IF NOT EXISTS icon TEXT`);

  await dbRun(`ALTER TABLE products ADD COLUMN IF NOT EXISTS pos_price DOUBLE NOT NULL DEFAULT 0`);
  await dbRun(`ALTER TABLE products ADD COLUMN IF NOT EXISTS prep_time_minutes INT NOT NULL DEFAULT 10`);
  await dbRun(`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_fast_moving INT NOT NULL DEFAULT 0`);
  await dbRun(`ALTER TABLE products ADD COLUMN IF NOT EXISTS pos_station_id INT`);
  await dbRun(`ALTER TABLE products ADD COLUMN IF NOT EXISTS pos_active INT NOT NULL DEFAULT 1`);
  await dbRun(`ALTER TABLE products ADD COLUMN IF NOT EXISTS cake_type VARCHAR(32)`);
  await dbRun(`ALTER TABLE products ADD COLUMN IF NOT EXISTS customer_visible INT NOT NULL DEFAULT 0`);
  await dbRun(`ALTER TABLE products ADD COLUMN IF NOT EXISTS customer_max_qty INT`);
  await dbRun(`ALTER TABLE products ADD COLUMN IF NOT EXISTS badge TEXT`);

  await dbRun(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS cake_type VARCHAR(32)`);

  // Item-level discounts — absolute amount per line; type drives day-end section J
  await dbRun(`ALTER TABLE pos_kot_items ADD COLUMN IF NOT EXISTS discount_amount DOUBLE NOT NULL DEFAULT 0`);
  await dbRun(`ALTER TABLE pos_kot_items ADD COLUMN IF NOT EXISTS discount_type VARCHAR(16)`);

  await dbRun(`ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS draft_items LONGTEXT`);
  await dbRun(`ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS change_amount DOUBLE NOT NULL DEFAULT 0`);
  await dbRun(`ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS pax_count INT DEFAULT 0`);
  await dbRun(`ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS table_tags TEXT`);
  await dbRun(`ALTER TABLE cake_orders ADD COLUMN IF NOT EXISTS advance_method VARCHAR(16) NOT NULL DEFAULT 'CASH'`);

  // Pre-populate pos_price from product_variants where still 0
  await dbRun(`
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
    WHERE p.pos_price = 0
  `);

  // ── Triggers ───────────────────────────────────────────────────
  await dbRun(`DROP TRIGGER IF EXISTS trg_pos_recalc_insert`);
  await dbRun(`
    CREATE TRIGGER trg_pos_recalc_insert
      AFTER INSERT ON pos_kot_items
      FOR EACH ROW
    UPDATE pos_orders SET total_amount = (
      SELECT COALESCE(SUM(ki.quantity * ki.unit_price - ki.discount_amount), 0)
      FROM   pos_kot_items ki JOIN pos_kots k ON k.id = ki.kot_id
      WHERE  k.order_id = (SELECT order_id FROM pos_kots WHERE id = NEW.kot_id)
        AND  ki.status != 'CANCELLED'
    ) WHERE id = (SELECT order_id FROM pos_kots WHERE id = NEW.kot_id)
  `);

  await dbRun(`DROP TRIGGER IF EXISTS trg_pos_recalc_update`);
  await dbRun(`
    CREATE TRIGGER trg_pos_recalc_update
      AFTER UPDATE ON pos_kot_items
      FOR EACH ROW
    UPDATE pos_orders SET total_amount = (
      SELECT COALESCE(SUM(ki.quantity * ki.unit_price - ki.discount_amount), 0)
      FROM   pos_kot_items ki JOIN pos_kots k ON k.id = ki.kot_id
      WHERE  k.order_id = (SELECT order_id FROM pos_kots WHERE id = NEW.kot_id)
        AND  ki.status != 'CANCELLED'
    ) WHERE id = (SELECT order_id FROM pos_kots WHERE id = NEW.kot_id)
  `);

  await dbRun(`DROP TRIGGER IF EXISTS trg_pos_kot_auto_serve`);
  await dbRun(`
    CREATE TRIGGER trg_pos_kot_auto_serve
      AFTER UPDATE ON pos_kot_items
      FOR EACH ROW
    UPDATE pos_kots SET status = 'SERVED', served_at = CURRENT_TIMESTAMP
    WHERE  id = NEW.kot_id
      AND  NEW.status = 'SERVED'
      AND  NOT EXISTS (
        SELECT 1 FROM pos_kot_items
        WHERE  kot_id = NEW.kot_id AND status NOT IN ('SERVED','CANCELLED')
      )
  `);

  // ── Seed reference data ─────────────────────────────────────────
  await dbRun(`INSERT IGNORE INTO pos_roles (name) VALUES ('WAITER')`);

  const lookupCount = await dbGet(`SELECT COUNT(*) AS c FROM lookup_master`);
  if (!lookupCount || lookupCount.c === 0) {
    const seedLookup = async (type, name, charge, i) =>
      dbRun(`INSERT IGNORE INTO lookup_master (lookup_type,name,extra_charge,sort_order) VALUES (?,?,?,?)`, [type, name, charge, i]);
    const groups = {
      CREAM_TYPE: [['Fresh Cream', 250], ['Non Dairy', 0], ['Whipping Cream', 0], ['Buttercream', 150], ['Chocolate Ganache', 200], ['Cream Cheese', 150]],
      SHAPE_TYPE: [['Round', 0], ['Square', 100], ['Heart', 150], ['Rectangle', 100], ['Number', 200], ['Custom', 300]],
      SPONGE_TYPE: [['Vanilla', 0], ['Chocolate', 0], ['Red Velvet', 100], ['Black Forest', 0], ['White Forest', 0]],
      THEME_TYPE: [['Birthday', 0], ['Wedding', 300], ['Anniversary', 100], ['Kids', 150], ['Corporate', 200], ['Photo Print', 200], ['Fondant', 500], ['Cartoon', 200], ['Floral', 150], ['Custom', 0]],
      DIETARY_TYPE: [['Eggless', 100], ['Vegan', 150], ['Sugar Free', 200], ['Gluten Free', 200], ['Nut Free', 0]],
    };
    for (const [type, items] of Object.entries(groups)) {
      let i = 0;
      for (const [n, c] of items) { await seedLookup(type, n, c, i++); }
    }
  }

  const tableTagCount = await dbGet(`SELECT COUNT(*) AS c FROM lookup_master WHERE lookup_type = 'TABLE_TAG'`);
  if (!tableTagCount || tableTagCount.c === 0) {
    const defaults = [
      { code: 'VIP', name: 'VIP', value: '👑', sort_order: 1 },
      { code: 'BIRTHDAY', name: 'Birthday', value: '🎂', sort_order: 2 },
      { code: 'ALLERGY', name: 'Allergy', value: '⚠', sort_order: 3 },
      { code: 'SPECIAL_GUEST', name: 'Special Guest', value: '⭐', sort_order: 4 },
      { code: 'CELEBRATION', name: 'Celebration', value: '🎉', sort_order: 5 },
      { code: 'CORPORATE', name: 'Corporate', value: '💼', sort_order: 6 },
    ];
    for (const t of defaults) {
      await dbRun(`INSERT INTO lookup_master (lookup_type,code,name,value,sort_order) VALUES ('TABLE_TAG',?,?,?,?)`, [t.code, t.name, t.value, t.sort_order]);
    }
  }

  const badgeCount = await dbGet(`SELECT COUNT(*) AS c FROM lookup_master WHERE lookup_type = 'PRODUCT_BADGE'`);
  if (!badgeCount || badgeCount.c === 0) {
    const defaults = [
      { code: 'VEG', name: 'Veg', value: '🟢', sort_order: 1 },
      { code: 'NONVEG', name: 'Non Veg', value: '🔴', sort_order: 2 },
      { code: 'SPICY', name: 'Spicy', value: '🌶️', sort_order: 3 },
      { code: 'HOT', name: 'Hot', value: '🔥', sort_order: 4 },
      { code: 'CHEF_SPECIAL', name: 'Chef Special', value: '👨‍🍳', sort_order: 5 },
      { code: 'POPULAR', name: 'Popular', value: '⭐', sort_order: 6 },
      { code: 'NEW', name: 'New', value: '🆕', sort_order: 7 },
      { code: 'GLUTEN_FREE', name: 'Gluten Free', value: '🌾', sort_order: 8 },
      { code: 'DAIRY_FREE', name: 'Dairy Free', value: '🥛', sort_order: 9 },
      { code: 'HIGH_PROTEIN', name: 'High Protein', value: '💪', sort_order: 10 },
      { code: 'KIDS', name: 'Kids', value: '🧒', sort_order: 11 },
      { code: 'SIGNATURE', name: 'Signature', value: '✨', sort_order: 12 },
    ];
    for (const b of defaults) {
      await dbRun(`INSERT IGNORE INTO lookup_master (lookup_type,code,name,value,sort_order) VALUES ('PRODUCT_BADGE',?,?,?,?)`, [b.code, b.name, b.value, b.sort_order]);
    }
  }

  const templateCount = await dbGet(`SELECT COUNT(*) n FROM cake_production_checklist_template`);
  if (!templateCount || templateCount.n === 0) {
    const items = [['base_baked', 'Base baked', 1], ['crumb_coated', 'Crumb-coated', 2], ['decorated', 'Decorated', 3], ['boxed', 'Boxed & ready', 4]];
    for (const [k, l, s] of items) {
      await dbRun(`INSERT INTO cake_production_checklist_template (item_key,label,sort_order) VALUES (?,?,?)`, [k, l, s]);
    }
  }

  // Default WAITER role + default waiter user (INSERT IGNORE safe every boot)
  const waiterRole = await dbGet(`SELECT id FROM pos_roles WHERE name = 'WAITER'`);
  if (waiterRole) {
    const existingWaiter = await dbGet(`SELECT id FROM pos_users WHERE employee_id = 'WTR01'`);
    if (!existingWaiter) {
      await dbRun(
        `INSERT INTO pos_users (name, employee_id, role_id, pin_hash) VALUES ('Waiter', 'WTR01', ?, ?)`,
        [waiterRole.id, bcrypt.hashSync('1111', 10)]
      );
    }
  }
}

let readyResolve, readyReject;
const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });

ensureSchema()
  .then(readyResolve)
  .catch(err => {
    console.error('[POS DB] Schema/seed failed:', err.message);
    readyReject(err);
  });

module.exports = { dbAll, dbGet, dbRun, transaction, ready };
