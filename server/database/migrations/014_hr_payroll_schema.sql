-- HR + payroll schema extensions
ALTER TABLE customers DROP PRIMARY KEY,
    ADD COLUMN IF NOT EXISTS id INT NOT NULL AUTO_INCREMENT FIRST,
    ADD PRIMARY KEY (id),
    ADD UNIQUE KEY IF NOT EXISTS uk_customers_phone (phone);
ALTER TABLE pos_orders
ADD COLUMN IF NOT EXISTS is_staff_purchase TINYINT NOT NULL DEFAULT 0;
ALTER TABLE pos_cash_movements
ADD COLUMN IF NOT EXISTS customer_id INT,
    ADD COLUMN IF NOT EXISTS reference_type VARCHAR(64) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS reference_id INT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS category VARCHAR(32) DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_cash_movements_customer ON pos_cash_movements(customer_id);
CREATE INDEX IF NOT EXISTS idx_pos_cash_movements_reference ON pos_cash_movements(reference_type, reference_id);
ALTER TABLE pos_cash_movements
ADD CONSTRAINT fk_pcm_customer FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE
SET NULL;
CREATE TABLE IF NOT EXISTS employee_profiles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    customer_id INT NOT NULL UNIQUE,
    employee_number VARCHAR(64) NOT NULL UNIQUE,
    pos_user_id INT DEFAULT NULL,
    join_date DATE NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK(
        status IN ('active', 'inactive', 'terminated', 'on_leave')
    ),
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY(pos_user_id) REFERENCES pos_users(id) ON DELETE
    SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
CREATE INDEX IF NOT EXISTS idx_employee_profiles_customer ON employee_profiles(customer_id);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_user ON employee_profiles(pos_user_id);
CREATE TABLE IF NOT EXISTS employee_salary_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    customer_id INT NOT NULL,
    effective_from DATE NOT NULL,
    salary DOUBLE NOT NULL,
    notes TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_employee_salary_history (customer_id, effective_from),
    FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
CREATE INDEX IF NOT EXISTS idx_employee_salary_history_customer ON employee_salary_history(customer_id, effective_from DESC);
CREATE TABLE IF NOT EXISTS employee_attendance (
    id INT PRIMARY KEY AUTO_INCREMENT,
    customer_id INT NOT NULL,
    attendance_date DATE NOT NULL,
    attendance_code VARCHAR(16) NOT NULL CHECK(
        attendance_code IN ('FULL', 'HALF', 'ABSENT', 'LEAVE', 'OFF')
    ),
    notes TEXT,
    created_by INT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_employee_attendance (customer_id, attendance_date),
    FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by) REFERENCES pos_users(id) ON DELETE
    SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
CREATE INDEX IF NOT EXISTS idx_employee_attendance_customer ON employee_attendance(customer_id, attendance_date);
CREATE TABLE IF NOT EXISTS payroll_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    salary_cutoff_day TINYINT NOT NULL DEFAULT 30,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
CREATE TABLE IF NOT EXISTS payroll_runs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    generated_by INT,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'FINALIZED', 'REVERSED')),
    total_gross DOUBLE NOT NULL DEFAULT 0,
    total_deductions DOUBLE NOT NULL DEFAULT 0,
    total_net DOUBLE NOT NULL DEFAULT 0,
    notes TEXT,
    FOREIGN KEY(generated_by) REFERENCES pos_users(id) ON DELETE
    SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
CREATE INDEX IF NOT EXISTS idx_payroll_runs_period ON payroll_runs(period_start, period_end);
CREATE TABLE IF NOT EXISTS payroll_run_lines (
    id INT PRIMARY KEY AUTO_INCREMENT,
    payroll_run_id INT NOT NULL,
    customer_id INT NOT NULL,
    employee_number VARCHAR(64) NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone VARCHAR(32),
    base_salary DOUBLE NOT NULL DEFAULT 0,
    attendance_adjustment DOUBLE NOT NULL DEFAULT 0,
    commission_amount DOUBLE NOT NULL DEFAULT 0,
    bonus_amount DOUBLE NOT NULL DEFAULT 0,
    penalty_amount DOUBLE NOT NULL DEFAULT 0,
    adjustment_amount DOUBLE NOT NULL DEFAULT 0,
    staff_purchase_deduction DOUBLE NOT NULL DEFAULT 0,
    advance_deduction DOUBLE NOT NULL DEFAULT 0,
    previous_balance DOUBLE NOT NULL DEFAULT 0,
    net_pay DOUBLE NOT NULL DEFAULT 0,
    settlement_status VARCHAR(16) NOT NULL DEFAULT 'UNSETTLED' CHECK(
        settlement_status IN ('UNSETTLED', 'PENDING', 'PAID')
    ),
    settlement_note TEXT,
    drawer_movement_id INT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY(payroll_run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE,
    FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY(drawer_movement_id) REFERENCES pos_cash_movements(id) ON DELETE
    SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
CREATE INDEX IF NOT EXISTS idx_payroll_run_lines_run ON payroll_run_lines(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_run_lines_customer ON payroll_run_lines(customer_id);
CREATE TABLE IF NOT EXISTS commission_rules (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(191) NOT NULL,
    rule_type VARCHAR(32) NOT NULL CHECK(
        rule_type IN (
            'PRODUCT',
            'CATEGORY',
            'SALE_CHANNEL',
            'MANUAL',
            'CUSTOM'
        )
    ),
    criteria_json LONGTEXT,
    rate_type VARCHAR(16) NOT NULL CHECK(rate_type IN ('PERCENTAGE', 'FLAT')),
    rate_value DOUBLE NOT NULL DEFAULT 0,
    active TINYINT NOT NULL DEFAULT 1,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by INT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES pos_users(id) ON DELETE
    SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
CREATE INDEX IF NOT EXISTS idx_commission_rules_active ON commission_rules(active);
CREATE TABLE IF NOT EXISTS payroll_commission_imports (
    id INT PRIMARY KEY AUTO_INCREMENT,
    payroll_run_id INT NOT NULL,
    source_type VARCHAR(64) NOT NULL,
    source_id INT NOT NULL,
    customer_id INT NOT NULL,
    amount DOUBLE NOT NULL,
    description TEXT,
    unique_key VARCHAR(191) NOT NULL,
    imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(payroll_run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE,
    FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    UNIQUE KEY uk_payroll_commission_imports (payroll_run_id, unique_key)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
CREATE INDEX IF NOT EXISTS idx_payroll_commission_imports_run ON payroll_commission_imports(payroll_run_id);
