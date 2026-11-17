-- Fonepay payments captured by MTC Companion from FoneBiz notifications.
-- dedupe_key is built on the phone so retries never double-insert.
CREATE TABLE IF NOT EXISTS pos_fonepay_payments (
    id              INT PRIMARY KEY AUTO_INCREMENT,
    device_id       VARCHAR(128) NOT NULL,
    dedupe_key      VARCHAR(191) NOT NULL,
    amount          DECIMAL(12,2),
    payer           VARCHAR(255),
    txn_id          VARCHAR(128),
    raw_title       TEXT,
    raw_text        TEXT,
    notified_at     DATETIME,
    created_by      INT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_fonepay_dedupe (dedupe_key),
    INDEX idx_fonepay_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
