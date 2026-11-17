-- HR / payroll corrections on top of 014.
--   * adjustment ledger — bonus / penalty / advance had columns on
--     payroll_run_lines but no table to source them from,
--   * payroll basis settings — per-day rate needs a days basis and a
--     half-day factor, neither existed,
--   * attendance day counts on the run line so a payslip can show its own
--     working, instead of recomputing attendance at read time,
--   * department / designation on the employee profile.

ALTER TABLE employee_profiles
    ADD COLUMN IF NOT EXISTS department  VARCHAR(64) AFTER employee_number,
    ADD COLUMN IF NOT EXISTS designation VARCHAR(64) AFTER department;

ALTER TABLE payroll_settings
    ADD COLUMN IF NOT EXISTS days_basis             VARCHAR(16) NOT NULL DEFAULT 'FIXED',
    ADD COLUMN IF NOT EXISTS fixed_days             TINYINT     NOT NULL DEFAULT 30,
    ADD COLUMN IF NOT EXISTS half_day_factor        DOUBLE      NOT NULL DEFAULT 0.5,
    ADD COLUMN IF NOT EXISTS deduct_absent          TINYINT     NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS deduct_staff_purchases TINYINT     NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS carry_unsettled        TINYINT     NOT NULL DEFAULT 1;

ALTER TABLE payroll_run_lines
    ADD COLUMN IF NOT EXISTS days_full    DOUBLE NOT NULL DEFAULT 0 AFTER base_salary,
    ADD COLUMN IF NOT EXISTS days_half    DOUBLE NOT NULL DEFAULT 0 AFTER days_full,
    ADD COLUMN IF NOT EXISTS days_absent  DOUBLE NOT NULL DEFAULT 0 AFTER days_half,
    ADD COLUMN IF NOT EXISTS days_leave   DOUBLE NOT NULL DEFAULT 0 AFTER days_absent,
    ADD COLUMN IF NOT EXISTS days_off     DOUBLE NOT NULL DEFAULT 0 AFTER days_leave,
    ADD COLUMN IF NOT EXISTS basis_days   DOUBLE NOT NULL DEFAULT 0 AFTER days_off,
    ADD COLUMN IF NOT EXISTS payable_days DOUBLE NOT NULL DEFAULT 0 AFTER basis_days;

CREATE TABLE IF NOT EXISTS employee_adjustments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    customer_id INT NOT NULL,
    adj_date DATE NOT NULL,
    kind VARCHAR(16) NOT NULL CHECK(kind IN ('BONUS', 'PENALTY', 'ADVANCE')),
    amount DOUBLE NOT NULL,
    note TEXT,
    payroll_run_id INT DEFAULT NULL,
    created_by INT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE,
    FOREIGN KEY(payroll_run_id) REFERENCES payroll_runs(id) ON DELETE SET NULL,
    FOREIGN KEY(created_by) REFERENCES pos_users(id) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE INDEX IF NOT EXISTS idx_employee_adjustments_customer ON employee_adjustments(customer_id, adj_date);
CREATE INDEX IF NOT EXISTS idx_employee_adjustments_run ON employee_adjustments(payroll_run_id);
