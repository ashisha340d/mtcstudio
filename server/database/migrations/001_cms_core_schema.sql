-- CMS / catalogue core tables (previously database/db.js ensureSchema).

CREATE TABLE IF NOT EXISTS categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name TEXT NOT NULL,
    slug VARCHAR(191) UNIQUE,
    description TEXT,
    sort_order INT DEFAULT 0,
    status VARCHAR(32) DEFAULT 'active',
    icon TEXT,
    -- Category photos live in media_library, referenced only through image_id.
    image_id INT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS products (
    id INT PRIMARY KEY AUTO_INCREMENT,
    category_id INT,
    name TEXT NOT NULL,
    slug VARCHAR(191) UNIQUE,
    short_description TEXT,
    description TEXT,
    featured INT DEFAULT 0,
    status VARCHAR(32) DEFAULT 'active',
    sort_order INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    menu_section_id INT,
    pos_price DOUBLE NOT NULL DEFAULT 0,
    prep_time_minutes INT NOT NULL DEFAULT 10,
    is_fast_moving INT NOT NULL DEFAULT 0,
    pos_station_id INT,
    pos_active INT NOT NULL DEFAULT 1,
    storefront_category TEXT,
    cake_type VARCHAR(32),
    customer_visible INT NOT NULL DEFAULT 0,
    customer_max_qty INT,
    badge TEXT,
    enable_variant_image TINYINT DEFAULT 0,
    -- Combo meal: a combo is a normal product row flagged here; its composition
    -- lives in combo_items. Price/category/image stay on the product itself.
    is_combo INT NOT NULL DEFAULT 0,
    FOREIGN KEY(category_id) REFERENCES categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS product_variants (
    id INT PRIMARY KEY AUTO_INCREMENT,
    product_id INT NOT NULL,
    name TEXT NOT NULL,
    sku VARCHAR(191) UNIQUE,
    selling_price DOUBLE DEFAULT 0,
    cost_price DOUBLE DEFAULT 0,
    stock DOUBLE DEFAULT 0,
    reorder_level DOUBLE DEFAULT 0,
    unit TEXT,
    barcode TEXT,
    status VARCHAR(32) DEFAULT 'active',
    sort_order INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    show_online INT DEFAULT 0,
    sync_status INT DEFAULT 0,
    -- Variant photos live in media_library, referenced only through image_id.
    image_id INT,
    cake_type VARCHAR(32),
    auto_entry TINYINT DEFAULT 0,
    check_on_bill TINYINT DEFAULT 0,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS media_library (
    id INT PRIMARY KEY AUTO_INCREMENT,
    filename TEXT NOT NULL,
    original_name TEXT,
    title TEXT,
    alt_text TEXT,
    caption TEXT,
    file_type TEXT,
    file_size INT,
    width INT,
    height INT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sync_status INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS product_images (
    id INT PRIMARY KEY AUTO_INCREMENT,
    product_id INT NOT NULL,
    media_id INT NOT NULL,
    is_primary INT DEFAULT 0,
    sort_order INT DEFAULT 0,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY(media_id) REFERENCES media_library(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS receipt_config (
    `key`      VARCHAR(191) PRIMARY KEY,
    value      TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS printer_config (
    id           INT PRIMARY KEY CHECK(id = 1),
    printer_name TEXT,
    vendor_id    TEXT,
    product_id   TEXT,
    paper_width  INT DEFAULT 80,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS live_shelf (
    id INT PRIMARY KEY AUTO_INCREMENT,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    price DOUBLE DEFAULT 0,
    quantity INT DEFAULT 0,
    image TEXT,
    notes TEXT,
    sort_order INT DEFAULT 0,
    sync_status INT DEFAULT 0,
    show_online INT DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS live_store_schedule (
    id INT PRIMARY KEY AUTO_INCREMENT,
    day_of_week INT NOT NULL UNIQUE,
    day_name TEXT NOT NULL,
    is_open INT DEFAULT 1,
    open_time TEXT DEFAULT '08:00',
    close_time TEXT DEFAULT '20:00',
    note TEXT,
    sync_status INT DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customers (
    phone       VARCHAR(32) PRIMARY KEY,
    phone2      TEXT,
    name        TEXT NOT NULL,
    address     TEXT,
    birthday    TEXT,
    email       TEXT,
    email2      TEXT,
    loyalty_points INT DEFAULT 0,
    rewards_tier   VARCHAR(32) DEFAULT 'standard',
    notes          TEXT,
    status         VARCHAR(32) DEFAULT 'active',
    is_delivery_partner INT DEFAULT 0,
    discount       DOUBLE DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS blogs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    topic TEXT,
    title TEXT NOT NULL,
    slug VARCHAR(191) UNIQUE NOT NULL,
    featured_image INT,
    content_html LONGTEXT,
    youtube_url TEXT,
    author_name TEXT,
    author_image INT,
    comment_text TEXT,
    status VARCHAR(32) DEFAULT 'draft',
    published_at DATETIME,
    sort_order INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(featured_image) REFERENCES media_library(id),
    FOREIGN KEY(author_image) REFERENCES media_library(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

/* Cake Atelier tables — shared with the v3 website (which reads them directly
   from this same MariaDB). Same DDL as the website's server.js MYSQL_SCHEMA. */
CREATE TABLE IF NOT EXISTS cake_designs (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    slug        VARCHAR(255) UNIQUE,
    tagline     VARCHAR(255),
    description TEXT,
    shape_tags  VARCHAR(255) DEFAULT '',
    badge_tags  VARCHAR(255) DEFAULT '',
    cream_choice TINYINT DEFAULT 1,
    eggless_available TINYINT DEFAULT 1,
    prep_time_hours INT DEFAULT 24,
    sort_order  INT DEFAULT 0,
    is_active   TINYINT DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cake_design_media (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    design_id  INT NOT NULL,
    url        VARCHAR(500) NOT NULL,
    alt        VARCHAR(255),
    sort_order INT DEFAULT 0,
    media_id   INT,
    INDEX idx_ckm_design (design_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cake_design_sizes (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    design_id  INT NOT NULL,
    label      VARCHAR(100) NOT NULL,
    weight_kg  DOUBLE NOT NULL,
    serves     VARCHAR(50),
    price      DOUBLE NOT NULL,
    sort_order INT DEFAULT 0,
    INDEX idx_cks_design (design_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cake_design_flavours (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    design_id  INT NOT NULL,
    name       VARCHAR(100) NOT NULL,
    surcharge  DOUBLE DEFAULT 0,
    sort_order INT DEFAULT 0,
    INDEX idx_ckf_design (design_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

/* cream_id references lookup_master.id WHERE lookup_type='CREAM_TYPE' */
CREATE TABLE IF NOT EXISTS cake_design_creams (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    design_id  INT NOT NULL,
    cream_id   INT NOT NULL,
    surcharge  DOUBLE DEFAULT 0,
    sort_order INT DEFAULT 0,
    INDEX idx_ckdc_design (design_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cake_collections (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    slug       VARCHAR(255) UNIQUE,
    title      VARCHAR(255) NOT NULL,
    kicker     VARCHAR(255),
    intro      TEXT,
    quote      TEXT,
    hero_url   VARCHAR(500),
    sort_order INT DEFAULT 0,
    is_active  TINYINT DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    hero_media_id INT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cake_collection_items (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    collection_id INT NOT NULL,
    design_id     INT NOT NULL,
    note          VARCHAR(500),
    sort_order    INT DEFAULT 0,
    INDEX idx_cci_coll (collection_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

/* Weather Recommendations (File Maintenance → Weather Recommends; synced to website) */
CREATE TABLE IF NOT EXISTS weather_recommendations (
    id         INT PRIMARY KEY AUTO_INCREMENT,
    bucket     VARCHAR(20) NOT NULL,
    product_id INT NOT NULL,
    sort_order INT DEFAULT 0,
    UNIQUE KEY uq_wr_bucket_product (bucket, product_id),
    INDEX idx_wr_bucket (bucket)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS weather_reco_settings (
    id              INT PRIMARY KEY,
    enabled         INT DEFAULT 1,
    modal_seconds   INT DEFAULT 8,
    max_per_session INT DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

/* Automation Rule Engine (schema v1) */
CREATE TABLE IF NOT EXISTS automation_condition_types (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    `key`       VARCHAR(100) NOT NULL UNIQUE,
    label       VARCHAR(255) NOT NULL,
    category    ENUM('product','customer','history','context','cart','business') NOT NULL,
    value_schema JSON,
    is_active   TINYINT DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS automation_action_types (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    `key`       VARCHAR(100) NOT NULL UNIQUE,
    label       VARCHAR(255) NOT NULL,
    category    ENUM('sales','service','kitchen','inventory','operations','cx','notifications','knowledge','custom') NOT NULL,
    value_schema JSON,
    is_active   TINYINT DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS automation_category_actions (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    category    VARCHAR(100) NOT NULL,
    action_key  VARCHAR(100) NOT NULL,
    UNIQUE KEY uniq_cat_action (category, action_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS automation_settings (
    scope               ENUM('website','pos','kiosk') PRIMARY KEY,
    global_session_cap  INT DEFAULT 3,
    conflict_strategy   VARCHAR(100) DEFAULT 'priority_then_score',
    stop_overrides_cap  TINYINT DEFAULT 1,
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS automation_rules (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    priority        INT DEFAULT 50,
    status          ENUM('draft','published','disabled') DEFAULT 'draft',
    scope           ENUM('website','pos','kiosk') NOT NULL,
    trigger_type    VARCHAR(100) NOT NULL,
    conditions      JSON,
    actions         JSON,
    schedule        JSON,
    frequency_cap   JSON,
    stop_processing TINYINT DEFAULT 0,
    version         INT DEFAULT 1,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_rules_scope_status (scope, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS automation_rule_versions (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    rule_id     INT NOT NULL,
    version     INT NOT NULL,
    snapshot    JSON NOT NULL,
    published_by VARCHAR(255),
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_rv_rule (rule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS automation_execution_log (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    rule_id     INT NOT NULL,
    scope       ENUM('website','pos','kiosk') NOT NULL,
    session_id  VARCHAR(255),
    customer_id VARCHAR(32),
    action_key  VARCHAR(100),
    fired       TINYINT DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_exec_rule (rule_id),
    INDEX idx_exec_session (session_id),
    INDEX idx_exec_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS automation_test_runs (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    rule_id        INT NOT NULL,
    sample_payload JSON,
    result         JSON,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_test_rule (rule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
