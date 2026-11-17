# HR / Payroll Integration Summary

## Project context

Repository: d:\mtcstudio

This workspace contains a multi-module business platform with a Node/Express backend and a React/Vite admin interface. The HR and payroll workflow sits inside the admin experience and is connected to the POS and customer systems.

## Integration scope

The HR/payroll feature covers:
- backend schema migrations in server/database/migrations/014_hr_payroll_schema.sql, 015_hr_payroll_fixes.sql, and 016_hr_employee_photo.sql
- backend API routes in server/routes/hr.js and server/routes/payroll.js
- backend business logic in server/services/payrollService.js
- authentication guard in server/middleware/hrAuth.js
- frontend pages in client/src/pages/HR/HR.jsx and client/src/pages/Payroll/Payroll.jsx
- route registration in client/src/App.jsx and client/src/layouts/AdminLayout.jsx

## Backend architecture

### Route registration

server/app.js mounts:
- /api/hr -> server/routes/hr.js
- /api/payroll -> server/routes/payroll.js

Both routers use requireHrRole from server/middleware/hrAuth.js, so HR access is role-gated.

### HR routes

Employee management
- GET /api/hr/employees
- GET /api/hr/candidates
- GET /api/hr/taxonomy
- GET /api/hr/employees/:customerId
- POST /api/hr/employees
- PUT /api/hr/employees/:customerId
- DELETE /api/hr/employees/:customerId

Salary
- GET /api/hr/employees/:customerId/salary-history
- POST /api/hr/employees/:customerId/salary-history
- DELETE /api/hr/salary-history/:id

Attendance
- GET /api/hr/attendance
- POST /api/hr/attendance/bulk
- GET /api/hr/employees/:customerId/attendance
- POST /api/hr/employees/:customerId/attendance
- PUT /api/hr/employees/:customerId/attendance/:id

Adjustments
- GET /api/hr/adjustments
- POST /api/hr/adjustments
- DELETE /api/hr/adjustments/:id

Dashboard summary
- GET /api/hr/summary

### Payroll routes

Settings
- GET /api/payroll/settings
- PUT /api/payroll/settings

Payroll runs
- GET /api/payroll/runs
- GET /api/payroll/runs/:id
- POST /api/payroll/runs
- POST /api/payroll/runs/:id/recalc
- POST /api/payroll/runs/:id/finalize
- POST /api/payroll/runs/:id/reverse
- DELETE /api/payroll/runs/:id
- GET /api/payroll/runs/:id/lines
- POST /api/payroll/runs/lines/:lineId/settlement

Commission
- GET /api/payroll/commission-rules
- POST /api/payroll/commission-rules
- PUT /api/payroll/commission-rules/:id
- DELETE /api/payroll/commission-rules/:id
- POST /api/payroll/commission-imports

## Service implementation

server/services/payrollService.js contains the main business logic for:
- employee CRUD and candidate lookup
- salary-history CRUD
- attendance persistence and bulk save
- adjustment ledger creation and deletion
- payroll settings update
- payroll run generation, recalculation, finalization, reversal, and deletion
- payroll line settlement updates
- commission rule CRUD and commission imports
- HR summary metrics

## Key rules in the current implementation

- Employees are promoted from customer records.
- Attendance uses an exception-based model: unmarked days are treated as worked days.
- Half days reduce pay according to the configured half-day factor.
- Pending adjustments are claimed when a run is finalized so they are not double-priced in later runs.
- Reversing a run releases those claimed adjustments back to pending state.
- Finalized runs cannot be deleted; they must be reversed first.
- Payroll runs use the latest salary on or before the period end date.

## Frontend architecture

### HR page

client/src/pages/HR/HR.jsx provides six tabs:
- Overview
- Directory
- Attendance
- Salary
- Adjustments
- Payroll

The page uses inline Axios requests to /api/hr/* and includes:
- employee cards and an add-employee modal
- employee drawer with photo selection and salary-history timeline
- a full monthly attendance grid with save/reset actions
- salary revision entry and removal
- adjustment ledger with pending-only filtering

### Payroll page

client/src/pages/Payroll/Payroll.jsx provides four tabs:
- Runs
- Register
- Commission
- Settings

The page supports:
- new payroll-run generation with preset periods
- draft recalculation and run finalization/reversal
- payslip line settlement and CSV/print export
- commission-rule management
- payroll settings configuration

## Current status

### Confirmed implementation points
- HR and payroll routes are mounted and protected by HR role gating.
- The employee, attendance, salary, adjustment, and payroll-run lifecycle are implemented in the backend service.
- The UI includes the main HR and payroll flows expected by the product.
- Migration files exist for the database tables needed by HR and payroll.

### Areas worth validating
- confirm the runtime role context provides req.actor with HR membership
- verify migrations against the current database engine and schema state
- smoke-test add employee, mark attendance, create payroll run, and finalize a run end to end

## Useful files

- server/app.js
- server/routes/hr.js
- server/routes/payroll.js
- server/services/payrollService.js
- server/middleware/hrAuth.js
- client/src/pages/HR/HR.jsx
- client/src/pages/Payroll/Payroll.jsx
- server/database/migrations/014_hr_payroll_schema.sql
- server/database/migrations/015_hr_payroll_fixes.sql
- server/database/migrations/016_hr_employee_photo.sql
