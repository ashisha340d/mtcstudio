-- CRM extensions: company name, anniversary date, Google Contacts link, and
-- per-customer addresses (multiple, capped at 3 by the API, one default).

ALTER TABLE customers ADD COLUMN IF NOT EXISTS company_name VARCHAR(191) AFTER name;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS anniversary TEXT AFTER birthday;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS google_resource_name VARCHAR(191) AFTER notes;

CREATE TABLE IF NOT EXISTS customer_addresses (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    customer_phone VARCHAR(32) NOT NULL,
    label          VARCHAR(64) NOT NULL DEFAULT 'Home',
    address_line   TEXT NOT NULL,
    city           VARCHAR(128),
    phone          VARCHAR(32),
    is_default     TINYINT NOT NULL DEFAULT 0,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_caddr_customer (customer_phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
