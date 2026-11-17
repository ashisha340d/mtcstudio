-- Campaign Management module — configuration-driven marketing engine.
-- Reuses existing customers / pos_orders / pos_payments / sms_queue tables;
-- adds only the normalized campaign-specific tables. No business logic lives
-- in the schema — every campaign behaviour is described by JSON config columns
-- and evaluated by the campaign services.

-- ── Type registry — every campaign type (birthday, dashain, flash sale, …) is
--    a data row, not code. New types are created purely through configuration. ──
CREATE TABLE IF NOT EXISTS campaign_types (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    `key`           VARCHAR(64)  NOT NULL UNIQUE,
    label           VARCHAR(191) NOT NULL,
    category        VARCHAR(64)  NOT NULL DEFAULT 'general',
    description     TEXT,
    icon            VARCHAR(16),
    default_trigger JSON,
    default_channels JSON,
    default_audience JSON,
    default_config  JSON,
    is_system       TINYINT NOT NULL DEFAULT 0,
    is_active       TINYINT NOT NULL DEFAULT 1,
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Channel / provider registry — abstract notification providers.
--    provider maps to a code module in services/campaign/channels; adding a new
--    provider is a row + a module, never a change to campaign logic. ──
CREATE TABLE IF NOT EXISTS campaign_channels (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    `key`       VARCHAR(32) NOT NULL UNIQUE,
    label       VARCHAR(191) NOT NULL,
    provider    VARCHAR(64) NOT NULL,
    is_enabled  TINYINT NOT NULL DEFAULT 1,
    config      JSON,
    sort_order  INT NOT NULL DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Role → permission map for the campaign module. Enforced by
--    middleware/campaignAuth against the existing pos_roles / pos_sessions. ──
CREATE TABLE IF NOT EXISTS campaign_role_permissions (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    role        VARCHAR(64) NOT NULL,
    permission  VARCHAR(64) NOT NULL,
    UNIQUE KEY uniq_role_perm (role, permission)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Reusable message templates (per channel). ──
CREATE TABLE IF NOT EXISTS campaign_templates (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(191) NOT NULL,
    channel     VARCHAR(32) NOT NULL,
    type_key    VARCHAR(64),
    subject     VARCHAR(255),
    body        TEXT NOT NULL,
    variables   JSON,
    is_active   TINYINT NOT NULL DEFAULT 1,
    created_by  INT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_ctpl_channel (channel),
    INDEX idx_ctpl_type (type_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Saved reusable audience segments (nested AND/OR filter trees). ──
CREATE TABLE IF NOT EXISTS campaign_audiences (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(191) NOT NULL,
    description TEXT,
    rules       JSON,
    is_active   TINYINT NOT NULL DEFAULT 1,
    created_by  INT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── The campaign itself — a fully declarative bundle of audience, trigger,
--    conditions, actions, rewards, channels, schedule, approval and config.
--    No column carries behaviour; the services read these JSON blobs. ──
CREATE TABLE IF NOT EXISTS campaigns (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    name              VARCHAR(191) NOT NULL,
    description       TEXT,
    type_key          VARCHAR(64) NOT NULL,
    status            ENUM('draft','pending_approval','approved','scheduled',
                           'active','paused','completed','archived','rejected')
                        NOT NULL DEFAULT 'draft',
    priority          INT NOT NULL DEFAULT 50,
    audience_id       INT,
    audience          JSON,
    trigger_config    JSON,
    conditions        JSON,
    actions           JSON,
    rewards           JSON,
    channels          JSON,
    schedule          JSON,
    config            JSON,
    approval_required TINYINT NOT NULL DEFAULT 0,
    branch_restrictions JSON,
    version           INT NOT NULL DEFAULT 1,
    created_by        INT,
    approved_by       INT,
    approved_at       DATETIME,
    last_run_at       DATETIME,
    next_run_at       DATETIME,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_camp_status (status),
    INDEX idx_camp_type (type_key),
    INDEX idx_camp_next_run (next_run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Coupon definitions — every reward shape the coupon engine supports. ──
CREATE TABLE IF NOT EXISTS campaign_coupons (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    campaign_id         INT,
    name                VARCHAR(191) NOT NULL,
    code                VARCHAR(64),
    code_prefix         VARCHAR(32),
    discount_type       ENUM('percentage','flat','free_item','combo','bogo','delivery')
                          NOT NULL DEFAULT 'percentage',
    value               DOUBLE NOT NULL DEFAULT 0,
    free_product_id     INT,
    max_discount        DOUBLE,
    min_order_amount    DOUBLE NOT NULL DEFAULT 0,
    unique_per_customer TINYINT NOT NULL DEFAULT 1,
    usage_limit_total   INT,
    usage_limit_per_customer INT NOT NULL DEFAULT 1,
    per_campaign_limit  INT,
    branch_restrictions JSON,
    valid_from          DATETIME,
    valid_until         DATETIME,
    config              JSON,
    status              ENUM('active','disabled') NOT NULL DEFAULT 'active',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_coupon_campaign (campaign_id),
    INDEX idx_coupon_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Issued coupon codes (one row per code handed to a customer). ──
CREATE TABLE IF NOT EXISTS campaign_coupon_codes (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    coupon_id      INT NOT NULL,
    campaign_id    INT,
    run_id         INT,
    customer_phone VARCHAR(32),
    code           VARCHAR(96) NOT NULL UNIQUE,
    status         ENUM('active','redeemed','expired','void') NOT NULL DEFAULT 'active',
    issued_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    redeemed_at    DATETIME,
    order_id       INT,
    INDEX idx_ccode_coupon (coupon_id),
    INDEX idx_ccode_customer (customer_phone),
    INDEX idx_ccode_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Redemption ledger — feeds redemption / ROI analytics. ──
CREATE TABLE IF NOT EXISTS campaign_coupon_redemptions (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    coupon_id       INT NOT NULL,
    code_id         INT,
    campaign_id     INT,
    customer_phone  VARCHAR(32),
    order_id        INT,
    discount_amount DOUBLE NOT NULL DEFAULT 0,
    order_amount    DOUBLE NOT NULL DEFAULT 0,
    branch          VARCHAR(64),
    redeemed_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_credeem_coupon (coupon_id),
    INDEX idx_credeem_campaign (campaign_id),
    INDEX idx_credeem_customer (customer_phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── One execution of a campaign — the History spine. ──
CREATE TABLE IF NOT EXISTS campaign_runs (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    campaign_id    INT NOT NULL,
    trigger_type   VARCHAR(32) NOT NULL DEFAULT 'manual',
    trigger_ref    VARCHAR(191),
    status         ENUM('pending','building','pending_approval','approved','rejected',
                        'scheduled','processing','paused','completed','cancelled','failed')
                     NOT NULL DEFAULT 'pending',
    audience_count INT NOT NULL DEFAULT 0,
    queued_count   INT NOT NULL DEFAULT 0,
    sent_count     INT NOT NULL DEFAULT 0,
    failed_count   INT NOT NULL DEFAULT 0,
    scheduled_at   DATETIME,
    started_at     DATETIME,
    finished_at    DATETIME,
    created_by     INT,
    meta           JSON,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_run_campaign (campaign_id),
    INDEX idx_run_status (status),
    INDEX idx_run_scheduled (scheduled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Per-recipient outbound message queue (multi-channel). Its own state
--    machine mirrors sms_queue so the processor logic is familiar. ──
CREATE TABLE IF NOT EXISTS campaign_queue (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    campaign_id    INT NOT NULL,
    run_id         INT,
    customer_phone VARCHAR(32),
    customer_name  VARCHAR(191),
    channel        VARCHAR(32) NOT NULL,
    recipient      VARCHAR(191),
    template_id    INT,
    subject        VARCHAR(255),
    message        TEXT,
    coupon_code_id INT,
    payload        JSON,
    priority       INT NOT NULL DEFAULT 5,
    status         ENUM('preview','pending_approval','approved','rejected','scheduled',
                        'queued','sending','sent','delivered','failed','cancelled','paused')
                     NOT NULL DEFAULT 'preview',
    scheduled_at   DATETIME,
    retry_count    INT NOT NULL DEFAULT 0,
    max_retries    INT NOT NULL DEFAULT 3,
    provider_ref   VARCHAR(128),
    external_job_id INT,
    error_message  TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    queued_at      DATETIME,
    sent_at        DATETIME,
    delivered_at   DATETIME,
    failed_at      DATETIME,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cq_campaign (campaign_id),
    INDEX idx_cq_run (run_id),
    INDEX idx_cq_status (status, priority, scheduled_at),
    INDEX idx_cq_customer (customer_phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Approval workflow audit trail. ──
CREATE TABLE IF NOT EXISTS campaign_approvals (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    campaign_id INT NOT NULL,
    run_id      INT,
    action      ENUM('submit','approve','reject','cancel') NOT NULL,
    actor_id    INT,
    actor_role  VARCHAR(64),
    note        TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_capprove_campaign (campaign_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Inbound trigger events (event-driven / webhook / API / system). The
--    trigger engine consumes unprocessed rows and matches active campaigns. ──
CREATE TABLE IF NOT EXISTS campaign_events (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    event_type     VARCHAR(64) NOT NULL,
    source         ENUM('system','webhook','api','pos','manual') NOT NULL DEFAULT 'system',
    customer_phone VARCHAR(32),
    payload        JSON,
    processed      TINYINT NOT NULL DEFAULT 0,
    processed_at   DATETIME,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cevent_processed (processed, event_type),
    INDEX idx_cevent_type (event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Conversion attribution — links a paid order back to a campaign, the
--    backbone of revenue / ROI / conversion analytics. ──
CREATE TABLE IF NOT EXISTS campaign_conversions (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    campaign_id    INT NOT NULL,
    run_id         INT,
    customer_phone VARCHAR(32),
    order_id       INT,
    coupon_code_id INT,
    revenue        DOUBLE NOT NULL DEFAULT 0,
    converted_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cconv_campaign (campaign_id),
    INDEX idx_cconv_order (order_id),
    INDEX idx_cconv_customer (customer_phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
