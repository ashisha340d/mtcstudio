-- POS / cake / mobile core tables (previously pos/db.js ensureSchema).

CREATE TABLE IF NOT EXISTS pos_roles (
    id   INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(64) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pos_users (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    name        TEXT    NOT NULL,
    employee_id VARCHAR(64) NOT NULL UNIQUE,
    role_id     INT NOT NULL,
    pin_hash    TEXT    NOT NULL,
    is_active   INT NOT NULL DEFAULT 1,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(role_id) REFERENCES pos_roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pos_sessions (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    user_id     INT NOT NULL,
    token       VARCHAR(191) NOT NULL UNIQUE,
    terminal_id TEXT,
    started_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at    DATETIME,
    FOREIGN KEY(user_id) REFERENCES pos_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_pos_sessions_token ON pos_sessions(token);

CREATE TABLE IF NOT EXISTS pos_audit_log (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    user_id     INT NOT NULL,
    session_id  INT,
    entity_type VARCHAR(64) NOT NULL,
    entity_id   INT NOT NULL,
    action      VARCHAR(64) NOT NULL,
    delta_json  LONGTEXT,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_pos_audit_entity ON pos_audit_log(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS pos_stations (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    name       VARCHAR(64) NOT NULL UNIQUE,
    color_hex  VARCHAR(16) NOT NULL DEFAULT '#ffffff',
    sort_order INT NOT NULL DEFAULT 0,
    is_active  INT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pos_restaurant_tables (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    name       VARCHAR(64) NOT NULL UNIQUE,
    capacity   INT NOT NULL DEFAULT 4,
    section    TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    is_active  INT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pos_customers (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    name       TEXT    NOT NULL,
    phone      VARCHAR(32) NOT NULL UNIQUE,
    address    TEXT,
    notes      TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_pos_customers_phone ON pos_customers(phone);

CREATE TABLE IF NOT EXISTS pos_orders (
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
    draft_items      LONGTEXT,
    change_amount    DOUBLE NOT NULL DEFAULT 0,
    pax_count        INT DEFAULT 0,
    table_tags       TEXT,
    order_caption    VARCHAR(64),
    order_notes      TEXT,
    -- Waiter "request bill" — a flag, not a status: the order must stay OPEN so it
    -- keeps showing on the floor and the status CHECK constraint stays satisfied.
    bill_requested_at DATETIME,
    FOREIGN KEY(table_id) REFERENCES pos_restaurant_tables(id),
    FOREIGN KEY(customer_id) REFERENCES pos_customers(id),
    FOREIGN KEY(punched_by) REFERENCES pos_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_pos_orders_status  ON pos_orders(status);
CREATE INDEX IF NOT EXISTS idx_pos_orders_table   ON pos_orders(table_id, status);
CREATE INDEX IF NOT EXISTS idx_pos_orders_created ON pos_orders(created_at);

CREATE TABLE IF NOT EXISTS pos_kots (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_pos_kots_order   ON pos_kots(order_id);
CREATE INDEX IF NOT EXISTS idx_pos_kots_status  ON pos_kots(status);
CREATE INDEX IF NOT EXISTS idx_pos_kots_created ON pos_kots(created_at);

CREATE TABLE IF NOT EXISTS pos_kot_items (
    id                INT PRIMARY KEY AUTO_INCREMENT,
    kot_id            INT NOT NULL,
    -- Nullable: history rows keep a name/price snapshot, so a deleted product
    -- may leave this dangling rather than removing the sales line.
    product_id        INT NULL,
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
    -- Item-level discounts — absolute amount per line; type drives day-end section J
    discount_amount   DOUBLE NOT NULL DEFAULT 0,
    discount_type     VARCHAR(16),
    -- Combo expansion on the order line: child KOT rows link to their combo parent
    -- row so the cashier sees one line, kitchen/inventory see the components.
    combo_parent_id   INT,
    is_combo_child    INT NOT NULL DEFAULT 0,
    FOREIGN KEY(kot_id) REFERENCES pos_kots(id),
    FOREIGN KEY(station_id) REFERENCES pos_stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_pos_kot_items_kot    ON pos_kot_items(kot_id);
CREATE INDEX IF NOT EXISTS idx_pos_kot_items_status ON pos_kot_items(status);

CREATE TABLE IF NOT EXISTS cake_orders (
    id                   INT PRIMARY KEY AUTO_INCREMENT,
    order_number         VARCHAR(64) NOT NULL UNIQUE,
    crm_customer_id      INT,
    phone                TEXT,
    customer_name        TEXT    NOT NULL,
    order_date           DATE    NOT NULL DEFAULT (CURRENT_DATE),
    delivery_date        DATE,
    delivery_time        TEXT,
    -- Modifiers are multi-select: a comma-separated list of lookup_master ids.
    shape_id             VARCHAR(191),
    cream_type_id        VARCHAR(191),
    sponge_type_id       VARCHAR(191),
    theme_id             VARCHAR(191),
    dietary_type_id      VARCHAR(191),
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
    advance_method       VARCHAR(16) NOT NULL DEFAULT 'CASH',
    FOREIGN KEY(created_by) REFERENCES pos_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_cake_orders_status   ON cake_orders(status);
CREATE INDEX IF NOT EXISTS idx_cake_orders_delivery ON cake_orders(delivery_date);
CREATE INDEX IF NOT EXISTS idx_cake_orders_date     ON cake_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_cake_orders_phone    ON cake_orders(phone(64));

CREATE TABLE IF NOT EXISTS pos_payments (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_pos_payments_order ON pos_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_pos_payments_cake  ON pos_payments(cake_order_id);
CREATE INDEX IF NOT EXISTS idx_pos_payments_created ON pos_payments(created_at);

CREATE TABLE IF NOT EXISTS pos_ledger (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pos_cancellations (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    entity_type   VARCHAR(16) NOT NULL CHECK(entity_type IN ('ORDER','KOT','KOT_ITEM')),
    entity_id     INT NOT NULL,
    reason        TEXT,
    cancelled_by  INT,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- CANCEL = mistake/edit, RETURN = customer returned prepared food, WASTE = kitchen flaw
    kind          VARCHAR(16) NOT NULL DEFAULT 'CANCEL',
    FOREIGN KEY(cancelled_by) REFERENCES pos_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_pos_cancellations_created ON pos_cancellations(created_at);

CREATE TABLE IF NOT EXISTS pos_modifiers (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    product_id INT NOT NULL,
    name       TEXT    NOT NULL,
    price      DOUBLE    NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    is_active  INT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_pos_modifiers_product ON pos_modifiers(product_id);

CREATE TABLE IF NOT EXISTS modifier_groups (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    name       VARCHAR(191) NOT NULL UNIQUE,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shared_modifiers (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    group_id   INT,
    name       TEXT    NOT NULL,
    price      DOUBLE    NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    is_active  INT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(group_id) REFERENCES modifier_groups(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_shared_modifiers_group ON shared_modifiers(group_id);

CREATE TABLE IF NOT EXISTS product_modifier_assignments (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    product_id  INT NOT NULL,
    modifier_id INT NOT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY(modifier_id) REFERENCES shared_modifiers(id) ON DELETE CASCADE,
    UNIQUE(product_id, modifier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_pma_product  ON product_modifier_assignments(product_id);
CREATE INDEX IF NOT EXISTS idx_pma_modifier ON product_modifier_assignments(modifier_id);

CREATE TABLE IF NOT EXISTS pos_till_sessions (
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
    -- Business-day columns — one till session per business date (Daily Cash Closing)
    business_date        DATE,
    denominations_json   LONGTEXT,
    cash_taken           DOUBLE NOT NULL DEFAULT 0,
    closing_balance      DOUBLE,
    closing_note         TEXT,
    reopened_by          INT,
    reopened_at          DATETIME,
    reopen_reason        TEXT,
    reopen_count         INT NOT NULL DEFAULT 0,
    FOREIGN KEY(opened_by) REFERENCES pos_users(id),
    FOREIGN KEY(closed_by) REFERENCES pos_users(id),
    FOREIGN KEY(variance_approved_by) REFERENCES pos_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_pos_till_business_date ON pos_till_sessions(business_date);

CREATE TABLE IF NOT EXISTS pos_cash_movements (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_pos_cash_movements_till    ON pos_cash_movements(till_session_id);
CREATE INDEX IF NOT EXISTS idx_pos_cash_movements_created ON pos_cash_movements(created_at);

CREATE TABLE IF NOT EXISTS pos_day_closures (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cake_order_status_history (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    cake_order_id INT NOT NULL,
    old_status    TEXT,
    new_status    TEXT    NOT NULL,
    changed_by    INT,
    changed_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(cake_order_id) REFERENCES cake_orders(id),
    FOREIGN KEY(changed_by) REFERENCES pos_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_cosh_order ON cake_order_status_history(cake_order_id);

CREATE TABLE IF NOT EXISTS cake_order_items (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_coi_order ON cake_order_items(cake_order_id);

CREATE TABLE IF NOT EXISTS cake_order_accessories (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_coa_order ON cake_order_accessories(cake_order_id);

CREATE TABLE IF NOT EXISTS cake_order_images (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    cake_order_id INT NOT NULL,
    image_url     TEXT    NOT NULL,
    image_name    TEXT,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_coimages_order ON cake_order_images(cake_order_id);

CREATE TABLE IF NOT EXISTS lookup_master (
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
    multiselect  INT NOT NULL DEFAULT 0,
    UNIQUE(lookup_type, name(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_lookup_master_type ON lookup_master(lookup_type);

CREATE TABLE IF NOT EXISTS waiter_calls (
    id          INT PRIMARY KEY AUTO_INCREMENT,
    table_id    INT NOT NULL,
    table_name  TEXT,
    status      VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    FOREIGN KEY(table_id) REFERENCES pos_restaurant_tables(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_waiter_calls_table ON waiter_calls(table_id, status);

CREATE TABLE IF NOT EXISTS cake_production_photos (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    cake_order_id INT NOT NULL,
    slot_number   INT NOT NULL CHECK(slot_number BETWEEN 1 AND 3),
    image_url     TEXT NOT NULL,
    image_name    TEXT,
    uploaded_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY(cake_order_id) REFERENCES cake_orders(id),
    UNIQUE(cake_order_id, slot_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_cpp_order   ON cake_production_photos(cake_order_id);
CREATE INDEX IF NOT EXISTS idx_cpp_updated ON cake_production_photos(updated_at);

CREATE TABLE IF NOT EXISTS cake_production_state (
    cake_order_id  INT PRIMARY KEY,
    checklist_json LONGTEXT NOT NULL,
    tags_json      LONGTEXT NOT NULL,
    updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY(cake_order_id) REFERENCES cake_orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_cps_updated ON cake_production_state(updated_at);

CREATE TABLE IF NOT EXISTS cake_production_checklist_template (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    item_key   VARCHAR(191) NOT NULL UNIQUE,
    label      TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

/* Mobile API (MTC Companion Android app) */
CREATE TABLE IF NOT EXISTS pos_devices (
    id                INT PRIMARY KEY AUTO_INCREMENT,
    device_id         VARCHAR(128) NOT NULL UNIQUE,
    device_name       TEXT,
    restaurant_id     VARCHAR(64),
    platform          VARCHAR(32),
    app_version       VARCHAR(32),
    status            VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    battery           INT,
    wifi              TEXT,
    network           TEXT,
    ip_address        VARCHAR(64),
    last_seen         DATETIME,
    paired_by_user_id INT,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(paired_by_user_id) REFERENCES pos_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pos_call_events (
    id                INT PRIMARY KEY AUTO_INCREMENT,
    device_id         VARCHAR(128) NOT NULL,
    phone             VARCHAR(32) NOT NULL,
    pos_customer_id   INT,
    customer_name     TEXT,
    status            VARCHAR(16) NOT NULL DEFAULT 'INCOMING'
                        CHECK(status IN ('INCOMING','ANSWERED','ENDED','MISSED')),
    start_time        DATETIME,
    end_time          DATETIME,
    duration_seconds  INT,
    recording_path    TEXT,
    transcript        LONGTEXT,
    ai_summary        LONGTEXT,
    created_by        INT,
    restaurant_id     VARCHAR(64),
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(pos_customer_id) REFERENCES pos_customers(id),
    FOREIGN KEY(created_by) REFERENCES pos_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_pos_call_events_phone ON pos_call_events(phone);
CREATE INDEX IF NOT EXISTS idx_pos_call_events_device ON pos_call_events(device_id);

/* Centralized SMS Service: single queue for every module's SMS jobs */
CREATE TABLE IF NOT EXISTS sms_queue (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    phone         VARCHAR(32) NOT NULL,
    message       TEXT NOT NULL,
    customer_id   VARCHAR(64),
    order_id      INT,
    template_id   VARCHAR(64),
    priority      INT NOT NULL DEFAULT 5,
    status        VARCHAR(16) NOT NULL DEFAULT 'PENDING'
                    CHECK(status IN ('PENDING','QUEUED','SENDING','SENT','DELIVERED','FAILED','CANCELLED')),
    retry_count   INT NOT NULL DEFAULT 0,
    max_retries   INT NOT NULL DEFAULT 3,
    device_id     VARCHAR(128),
    created_by    INT,
    error_message TEXT,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    queued_at     DATETIME,
    sending_at    DATETIME,
    sent_at       DATETIME,
    delivered_at  DATETIME,
    failed_at     DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_sms_queue_status ON sms_queue(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_sms_queue_device ON sms_queue(device_id);

CREATE TABLE IF NOT EXISTS sms_logs (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    job_id     INT,
    event      VARCHAR(32) NOT NULL,
    device_id  VARCHAR(128),
    detail     TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_sms_logs_job ON sms_logs(job_id);

CREATE TABLE IF NOT EXISTS pos_customer_addresses (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    phone      VARCHAR(32) NOT NULL,
    label      VARCHAR(64),
    address    TEXT NOT NULL,
    is_default INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_pos_customer_addresses_phone ON pos_customer_addresses(phone);

CREATE TABLE IF NOT EXISTS pos_customer_notes (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    phone      VARCHAR(32) NOT NULL,
    note       TEXT NOT NULL,
    created_by INT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES pos_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_pos_customer_notes_phone ON pos_customer_notes(phone);

/* Scheduled & Draft orders — separate table so pos_orders/pos_kots logic
   (reports, KDS, shift close) never sees them until conversion. */
CREATE TABLE IF NOT EXISTS pos_scheduled_orders (
    id                 INT PRIMARY KEY AUTO_INCREMENT,
    kind               VARCHAR(16) NOT NULL CHECK(kind IN ('SCHEDULED','DRAFT')),
    order_type         VARCHAR(32) NOT NULL DEFAULT 'DELIVERY',
    customer_name      TEXT,
    customer_phone     VARCHAR(32),
    order_notes        TEXT,
    order_caption      VARCHAR(64),
    scheduled_for      DATETIME,
    notify_before_min  INT NOT NULL DEFAULT 30,
    items_json         LONGTEXT,
    total_amount       DOUBLE NOT NULL DEFAULT 0,
    status             VARCHAR(16) NOT NULL DEFAULT 'PENDING'
                         CHECK(status IN ('PENDING','CONVERTED','CANCELLED')),
    converted_order_id INT,
    created_by         INT,
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY(converted_order_id) REFERENCES pos_orders(id),
    FOREIGN KEY(created_by) REFERENCES pos_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_pso_status_sched ON pos_scheduled_orders(status, scheduled_for);

/* Pending Web Orders (pushed from the website over the WS bridge) */
CREATE TABLE IF NOT EXISTS web_orders_pending (
    id                INT PRIMARY KEY AUTO_INCREMENT,
    -- In-house Customer QR orders (source='CUSTOMER_QR') reuse this queue and
    -- have no website counterpart, so this must allow NULL.
    web_order_id      INT NULL UNIQUE,
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
    cake_order_id     INT,
    -- Which dine-in table an approved Customer QR order appends its KOT to.
    table_id          INT,
    FOREIGN KEY(pos_order_id) REFERENCES pos_orders(id),
    FOREIGN KEY(approved_by) REFERENCES pos_users(id),
    FOREIGN KEY(rejected_by) REFERENCES pos_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_wop_status   ON web_orders_pending(status);
CREATE INDEX IF NOT EXISTS idx_wop_received ON web_orders_pending(received_at);

CREATE TABLE IF NOT EXISTS web_order_items (
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
    -- Web cake items carry their full configuration (design/size/flavour/cream/
    -- dietary/neededAt/message); approval books them into cake_orders, not a KOT.
    cake_json      LONGTEXT,
    FOREIGN KEY(pending_id) REFERENCES web_orders_pending(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_woi_pending ON web_order_items(pending_id);

/* Recommended Products — admin-curated "you might also like" list (Automation
   module). Global, not per-product cross-sell — one ordered list. */
CREATE TABLE IF NOT EXISTS recommended_products (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    product_id INT NOT NULL UNIQUE,
    sort_order INT NOT NULL DEFAULT 0,
    is_active  INT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

/* OCR / WhatsApp image imports (Mero Kinmel etc.). One row per received image.
   Draft order (if created) lives in pos_scheduled_orders(kind='DRAFT');
   scheduled_order_id links to it. */
CREATE TABLE IF NOT EXISTS pos_ocr_imports (
    id                 INT PRIMARY KEY AUTO_INCREMENT,
    source             VARCHAR(32) NOT NULL DEFAULT 'WhatsApp Business',
    platform           VARCHAR(64) NOT NULL DEFAULT 'Mero Kinmel',
    image_filename     VARCHAR(255),
    image_hash         VARCHAR(64) UNIQUE,
    notification_ts    DATETIME,
    ocr_ms             INT NOT NULL DEFAULT 0,
    parser_confidence  DOUBLE NOT NULL DEFAULT 0,
    match_confidence   DOUBLE NOT NULL DEFAULT 0,
    overall_confidence DOUBLE NOT NULL DEFAULT 0,
    status             VARCHAR(20) NOT NULL DEFAULT 'RECEIVED'
                         CHECK(status IN ('RECEIVED','OCR','PARSED','DRAFTED','MANUAL_REVIEW','FAILED')),
    raw_text           LONGTEXT,
    parsed_json        LONGTEXT,
    scheduled_order_id INT,
    error              TEXT,
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY(scheduled_order_id) REFERENCES pos_scheduled_orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_ocr_imports_status ON pos_ocr_imports(status, created_at);

/* Combo composition — no pricing, only which child items a combo expands into. */
CREATE TABLE IF NOT EXISTS combo_items (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    combo_product_id  INT NOT NULL,
    child_product_id  INT NOT NULL,
    child_variant_id  INT NULL,
    quantity          INT NOT NULL DEFAULT 1,
    sequence          INT NOT NULL DEFAULT 0,
    CONSTRAINT fk_combo_parent FOREIGN KEY (combo_product_id) REFERENCES products(id) ON DELETE CASCADE,
    CONSTRAINT fk_combo_child  FOREIGN KEY (child_product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_combo_items_parent ON combo_items(combo_product_id);
