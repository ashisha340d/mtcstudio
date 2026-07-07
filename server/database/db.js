'use strict';
const { dbAll, dbGet, dbRun, transaction } = require('./mysqlPool');

async function ensureSchema() {
    await dbRun(`CREATE TABLE IF NOT EXISTS categories (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name TEXT NOT NULL,
        slug VARCHAR(191) UNIQUE,
        description TEXT,
        sort_order INT DEFAULT 0,
        status VARCHAR(32) DEFAULT 'active'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await dbRun(`CREATE TABLE IF NOT EXISTS products (
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
        FOREIGN KEY(category_id) REFERENCES categories(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await dbRun(`CREATE TABLE IF NOT EXISTS product_variants (
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
        FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await dbRun(`CREATE TABLE IF NOT EXISTS media_library (
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await dbRun(`CREATE TABLE IF NOT EXISTS product_images (
        id INT PRIMARY KEY AUTO_INCREMENT,
        product_id INT NOT NULL,
        media_id INT NOT NULL,
        is_primary INT DEFAULT 0,
        sort_order INT DEFAULT 0,
        FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY(media_id) REFERENCES media_library(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await dbRun(`CREATE TABLE IF NOT EXISTS receipt_config (
        \`key\`     VARCHAR(191) PRIMARY KEY,
        value      TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await dbRun(`CREATE TABLE IF NOT EXISTS printer_config (
        id           INT PRIMARY KEY CHECK(id = 1),
        printer_name TEXT,
        vendor_id    TEXT,
        product_id   TEXT,
        paper_width  INT DEFAULT 80,
        updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    const RECEIPT_DEFAULTS = [
        ['org_name',             'MTC STUDIO'],
        ['org_tagline',          'Thank You! Visit Again'],
        ['org_address',          ''],
        ['org_phone',            ''],
        ['org_email',            ''],
        ['org_gstin',            ''],
        ['org_pan',              ''],
        ['receipt_footer',       'Powered by MTC POS'],
        ['show_logo',            '0'],
        ['logo_text',            ''],
        ['show_customer_phone',  '1'],
        ['show_order_type',      '1'],
        ['show_table',           '1'],
        ['show_kot_breakdown',   '0'],
        ['paper_width_mm',       '80'],
        ['font_size_px',         '12'],
        ['copies',               '1'],
        ['custom_header_line',   ''],
        ['custom_footer_line',   ''],
        ['cake_slip_shop_name',        ''],
        ['cake_slip_header_line',      'CAKE PRODUCTION ORDER'],
        ['cake_slip_footer',           ''],
        ['cake_slip_show_phone',       '1'],
        ['cake_slip_show_flavour',     '1'],
        ['cake_slip_show_size',        '1'],
        ['cake_slip_show_qty',         '1'],
        ['cake_slip_show_cream',       '1'],
        ['cake_slip_show_sponge',      '1'],
        ['cake_slip_show_shape',       '1'],
        ['cake_slip_show_theme',       '1'],
        ['cake_slip_show_message',     '1'],
        ['cake_slip_show_accessories', '1'],
        ['cake_slip_show_allergies',   '1'],
        ['cake_slip_show_notes',       '1'],
        ['cake_slip_show_status',      '1'],
        ['cake_slip_show_qr',          '1'],
        ['cake_slip_show_pricing',     '1'],
    ];
    for (const [k, v] of RECEIPT_DEFAULTS) {
        await dbRun(`INSERT IGNORE INTO receipt_config (\`key\`, value) VALUES (?, ?)`, [k, v]);
    }

    await dbRun(`INSERT IGNORE INTO printer_config (id, printer_name) VALUES (1, NULL)`);

    await dbRun(`CREATE TABLE IF NOT EXISTS live_shelf (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await dbRun(`CREATE TABLE IF NOT EXISTS live_store_schedule (
        id INT PRIMARY KEY AUTO_INCREMENT,
        day_of_week INT NOT NULL UNIQUE,
        day_name TEXT NOT NULL,
        is_open INT DEFAULT 1,
        open_time TEXT DEFAULT '08:00',
        close_time TEXT DEFAULT '20:00',
        note TEXT,
        sync_status INT DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    const scheduleCount = await dbGet(`SELECT COUNT(*) as cnt FROM live_store_schedule`);
    if (!scheduleCount || scheduleCount.cnt === 0) {
        const days = [
            [0, 'Sunday', 0], [1, 'Monday', 1], [2, 'Tuesday', 1],
            [3, 'Wednesday', 1], [4, 'Thursday', 1], [5, 'Friday', 1], [6, 'Saturday', 1],
        ];
        for (const [dow, name, open] of days) {
            await dbRun(
                `INSERT INTO live_store_schedule (day_of_week, day_name, is_open, open_time, close_time)
                 VALUES (?, ?, ?, '08:00', '20:00')`,
                [dow, name, open]
            );
        }
    }

    await dbRun(`CREATE TABLE IF NOT EXISTS customers (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await dbRun(`CREATE TABLE IF NOT EXISTS blogs (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // Cake Atelier tables — shared with the v3 website (which reads them directly
    // from this same MariaDB). Same DDL as the website's server.js MYSQL_SCHEMA.
    await dbRun(`CREATE TABLE IF NOT EXISTS cake_designs (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await dbRun(`CREATE TABLE IF NOT EXISTS cake_design_media (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        design_id  INT NOT NULL,
        url        VARCHAR(500) NOT NULL,
        alt        VARCHAR(255),
        sort_order INT DEFAULT 0,
        INDEX idx_ckm_design (design_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await dbRun(`CREATE TABLE IF NOT EXISTS cake_design_sizes (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        design_id  INT NOT NULL,
        label      VARCHAR(100) NOT NULL,
        weight_kg  DOUBLE NOT NULL,
        serves     VARCHAR(50),
        price      DOUBLE NOT NULL,
        sort_order INT DEFAULT 0,
        INDEX idx_cks_design (design_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await dbRun(`CREATE TABLE IF NOT EXISTS cake_design_flavours (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        design_id  INT NOT NULL,
        name       VARCHAR(100) NOT NULL,
        surcharge  DOUBLE DEFAULT 0,
        sort_order INT DEFAULT 0,
        INDEX idx_ckf_design (design_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // cream_id references lookup_master.id WHERE lookup_type='CREAM_TYPE'
    await dbRun(`CREATE TABLE IF NOT EXISTS cake_design_creams (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        design_id  INT NOT NULL,
        cream_id   INT NOT NULL,
        surcharge  DOUBLE DEFAULT 0,
        sort_order INT DEFAULT 0,
        INDEX idx_ckdc_design (design_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await dbRun(`CREATE TABLE IF NOT EXISTS cake_collections (
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
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await dbRun(`CREATE TABLE IF NOT EXISTS cake_collection_items (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        collection_id INT NOT NULL,
        design_id     INT NOT NULL,
        note          VARCHAR(500),
        sort_order    INT DEFAULT 0,
        INDEX idx_cci_coll (collection_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    await dbRun(`ALTER TABLE cake_designs ADD COLUMN IF NOT EXISTS prep_time_hours INT DEFAULT 24`);
    await dbRun(`ALTER TABLE products ADD COLUMN IF NOT EXISTS menu_section_id INT`);
    await dbRun(`ALTER TABLE products ADD COLUMN IF NOT EXISTS storefront_category TEXT`);
    await dbRun(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS show_online INT DEFAULT 0`);
    await dbRun(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS sync_status INT DEFAULT 0`);
    await dbRun(`ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS image_id INT`);
    await dbRun(`ALTER TABLE media_library ADD COLUMN IF NOT EXISTS sync_status INT DEFAULT 0`);
}

let readyResolve, readyReject;
const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });

ensureSchema()
    .then(readyResolve)
    .catch(err => {
        console.error('[CMS DB] Schema/seed failed:', err.message);
        readyReject(err);
    });

module.exports = { dbAll, dbGet, dbRun, transaction, ready };
