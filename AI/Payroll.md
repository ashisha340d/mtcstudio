# Payroll Module

## Purpose
The payroll module generates payslips, settles payroll lines, manages commission rules, and stores payroll settings for the HR workflow.

## Current capabilities
- Runs tab: create new payroll runs, recalculate draft runs, finalize runs, reverse finalized runs, and delete draft/reversed runs.
- Register tab: view payslip lines for a selected run, filter by settlement state, search employees, export CSV, print register, and open a payslip modal.
- Commission tab: create, edit, enable/disable, and delete commission rules.
- Settings tab: configure salary cutoff day, days basis, fixed days, half-day factor, and deduction rules such as absent pay deduction, staff-purchase recovery, and carried unsettled balance.

## Main files
- client/src/pages/Payroll/Payroll.jsx
- client/src/pages/Payroll/Payroll.css
- server/routes/payroll.js
- server/services/payrollService.js

## Backend endpoints
- GET /api/payroll/settings
- PUT /api/payroll/settings
- GET /api/payroll/runs
- GET /api/payroll/runs/:id
- POST /api/payroll/runs
- POST /api/payroll/runs/:id/recalc
- POST /api/payroll/runs/:id/finalize
- POST /api/payroll/runs/:id/reverse
- DELETE /api/payroll/runs/:id
- GET /api/payroll/runs/:id/lines
- POST /api/payroll/runs/lines/:lineId/settlement
- GET /api/payroll/commission-rules
- POST /api/payroll/commission-rules
- PUT /api/payroll/commission-rules/:id
- DELETE /api/payroll/commission-rules/:id
- POST /api/payroll/commission-imports

## Important logic
- Payroll runs are built from all active employee profiles.
- Each payslip line is calculated from the latest salary effective on the period end date.
- Attendance affects pay using the exception-based rules from HR.
- Pending bonus/penalty/advance adjustments are claimed when a run is finalized to avoid double pricing in later runs.
- Settlement statuses are UNSETTLED, PENDING, and PAID.

## Notes
The payroll UI is embedded into the HR page as an additional tab, but it still uses its own dedicated frontend component and backend route set.
