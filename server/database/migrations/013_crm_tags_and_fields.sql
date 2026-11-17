-- CRM revamp: Google-Contacts-style tags/labels, extra identity fields, and a
-- recycle-bin delete state. Contacts and customers now share one table; a
-- contact only becomes a "customer" once it has MTC order history, which the
-- system tag "MTC Customers" reflects (reconciled from pos_orders).

ALTER TABLE customers ADD COLUMN IF NOT EXISTS job_title    VARCHAR(191) AFTER company_name;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS country_code VARCHAR(8)   AFTER phone2;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at   DATETIME     AFTER updated_at;

-- Tag/label catalogue. source: 'system' (auto, e.g. MTC Customers, protected),
-- 'google' (imported label), 'manual' (user-made). color is a hex for the chip.
CREATE TABLE IF NOT EXISTS crm_tags (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(128) NOT NULL,
    color       VARCHAR(16)  DEFAULT '#6b7280',
    source      VARCHAR(16)  NOT NULL DEFAULT 'manual',
    google_resource_name VARCHAR(191),
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_crm_tag_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Customer ↔ tag membership (many-to-many, Google-labels style).
CREATE TABLE IF NOT EXISTS customer_tags (
    customer_phone VARCHAR(32) NOT NULL,
    tag_id         INT NOT NULL,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (customer_phone, tag_id),
    INDEX idx_ctag_tag (tag_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The protected system tag, created once.
INSERT INTO crm_tags (name, color, source)
SELECT 'MTC Customers', '#16a34a', 'system'
WHERE NOT EXISTS (SELECT 1 FROM crm_tags WHERE name = 'MTC Customers');
