# HR Module

## Purpose
The HR module manages staff records from onboarding to day-to-day attendance, salary history, and adjustment entries.

## Current capabilities
- Overview tab: staff headcount, attendance summary, pending advances/bonuses/penalties, unsettled payroll, and newest joiners.
- Directory tab: searchable employee cards, add-employee flow, employee drawer for editing department/designation/status/notes, and salary-history timeline.
- Attendance tab: month-grid attendance entry with paint mode, bulk save, future-date protection, right-click code menu, and per-row/day summaries.
- Salary tab: select an employee, record salary revisions, and review the full salary history timeline.
- Adjustments tab: add bonus/penalty/advance entries and review a pending-only or full ledger.

## Main files
- client/src/pages/HR/HR.jsx
- client/src/pages/HR/HR.css
- server/routes/hr.js
- server/services/payrollService.js
- server/middleware/hrAuth.js

## Backend endpoints
- GET /api/hr/summary
- GET /api/hr/employees
- GET /api/hr/candidates
- GET /api/hr/taxonomy
- GET /api/hr/employees/:customerId
- POST /api/hr/employees
- PUT /api/hr/employees/:customerId
- DELETE /api/hr/employees/:customerId
- GET /api/hr/employees/:customerId/salary-history
- POST /api/hr/employees/:customerId/salary-history
- DELETE /api/hr/salary-history/:id
- GET /api/hr/attendance
- POST /api/hr/attendance/bulk
- GET /api/hr/employees/:customerId/attendance
- POST /api/hr/employees/:customerId/attendance
- PUT /api/hr/employees/:customerId/attendance/:id
- GET /api/hr/adjustments
- POST /api/hr/adjustments
- DELETE /api/hr/adjustments/:id

## Important behavior
- Access is protected by requireHrRole.
- Employees are created from existing customer records and promoted to staff.
- Join dates cannot be in the future.
- Attendance is exception-based: unmarked days count as worked, while ABSENT/HALF/LEAVE/OFF are recorded as exceptions.
- Staff photos are selected from the media library using the employee section.

## Notes
The HR screen is implemented as a single React page with tabbed sections, and it is tightly connected to the payroll module.
