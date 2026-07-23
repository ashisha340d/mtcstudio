-- Absorbs the last two lazy "create it on first use" schema sites:
--   • services/ocr/orderResolver.js  — FULLTEXT indexes for catalogue matching
--   • services/wifiAnalyticsService.js — Wi-Fi portal telemetry tables

-- OCR catalogue matching runs FULLTEXT BOOLEAN MODE queries against these.
ALTER TABLE products ADD FULLTEXT INDEX IF NOT EXISTS ft_products_name (name);
ALTER TABLE product_variants ADD FULLTEXT INDEX IF NOT EXISTS ft_variants_name_sku (name, sku);

-- Wi-Fi portal telemetry — visit ledger + event stream. Self-contained; the
-- POS/CMS never reads these, so a telemetry gap can't stop a guest connecting.
CREATE TABLE IF NOT EXISTS wifi_devices (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    device_key    VARCHAR(64) NOT NULL UNIQUE,
    mac           VARCHAR(17),
    customer_id   INT NULL,
    visit_count   INT DEFAULT 1,
    connect_count INT DEFAULT 0,
    tags          TEXT,
    first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_wifi_devices_mac (mac),
    INDEX idx_wifi_devices_last_seen (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wifi_events (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    device_key  VARCHAR(64),
    event       VARCHAR(48) NOT NULL,
    section     VARCHAR(48),
    ref_id      VARCHAR(64),
    meta        TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_wifi_events_event (event, created_at),
    INDEX idx_wifi_events_device (device_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
