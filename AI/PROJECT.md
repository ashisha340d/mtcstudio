# MTC Studio — Project Reference

Single source of truth for how the codebase works today. Written from the code, not from plans.
Business: Munch Time Cafe (Narayangarh, Chitwan, Nepal). All business dates are Nepal time (`Asia/Kathmandu`).

Related docs that remain in `AI/`:
- `CONVENTIONS.md` — coding conventions (route → controller → service, naming).
- `HR_PAYROLL_INTEGRATION.md`, `HR.md`, `Payroll.md` — HR/payroll detail.
- `app.md`, `understand.md` — session logs for the Android apps (MTC Companion, WDS waiter app).
- `LOYALTY_STUDY.md` — loyalty research.
- `server/database/migrations/README.md` — migration rules. `server/routes/wifi.README.md` — Wi-Fi portal.

---

## 1. What the system is

One Node/Express server plus several browser front ends, all on the cafe LAN:

| Surface | URL | Code | Auth |
|---|---|---|---|
| Admin desktop ("Studio") | `/` | `client/src/layouts/AdminLayout.jsx` + `client/src/pages/*` | none (LAN-trusted) |
| POS terminal | `/pos/*` | `client/src/pages/POS/*` | PIN → session |
| Kitchen Display | `/kds` | `client/src/pages/KDS/*` | PIN, token kept in localStorage |
| Waiter PWA | `/waiter/*` | `client/src/pages/Waiter/*` | PIN (own axios instance) |
| Customer QR menu | `/menu`, `/menu/:tableId` | `client/src/pages/CustomerMenu/index.jsx` | public |
| Cake Production PWA | `/cake-app/*` | `client/cake-production/` (separate Vite app) | PIN |
| Wi-Fi captive portal | `/wifi/*` | `server/controllers/wifiController.js`, `templates/wifi-portal.ejs` | public (MikroTik hand-off) |
| Android apps | API only | MTC Companion (caller ID/SMS), WDS (native waiter) — separate repos | PIN → session |

External systems: the public website `munchtimecafe.com.np` (PHP + Node sync endpoints, shared MariaDB for cake catalogue), Mero Kinmel (delivery platform, via OCR of WhatsApp slips), Google Contacts, MikroTik hotspot, TextBee / Android SMS devices, USB ESC/POS printers.

Desktop launcher: `MTC-Studio.exe` (Go, WebView2, source in `D:\mtclaucher`, built by `installs/laucherbuild.bat`). It hosts the UI, restarts the server on `POST /api/system/restart`.

---

## 2. Repository layout

```
package.json              root scripts (dev:server, dev:client, build:client, start:production)
installs/                 deployment.bat (robocopy to the live box), launcher build, runNodeNPM.bat
AI/                       documentation
client/                   main React app (Vite)
  src/App.jsx             all routes
  src/layouts/            AdminLayout (desktop shell), DesktopWindow (draggable window), SettingsPanel
  src/pages/              one folder per module
  src/context/            AuthContext, POSContext, KDSContext, Blog/Category/Media/ProductContext
  src/stores/menuStore.js menu cache (memory + IndexedDB + socket refresh)
  src/services/api.js     admin/CMS axios wrappers  (baseURL VITE_API_URL || /api)
  src/services/posApi.js  POS wrappers, sends X-Session-ID
  src/socket.js           createSocket({ role, station, token })
  src/lib/                nepaliDate (BS↔AD), utils
  src/components/         AuthGate, KDSAuthGate, MediaPicker, NepaliDateChip, ui/* (Radix wrappers)
  cake-production/        standalone PWA (Dexie offline store, sync engine, photo queue)
  public/sw.js, waiter-manifest.json   Waiter PWA service worker + manifest
server/
  app.js                  bootstrap, router mounting, static, SPA fallback, background jobs
  database/               mysqlPool.js, db.js, migrator.js, migrations/ (+ rollback/)
  pos/                    db.js, socketServer.js, menuVersion.js, kdsEvents.js (SSE), draftItems.js, splitTender.js
  routes/                 CMS + admin routers;  routes/pos/ POS routers;  routes/pos/reports/ report routers
  controllers/            only for CMS modules (categories, products, combos, media, blogs, cake catalogue, liveshelf, dashboard, generateBlog, wifi)
  services/               business logic + integrations (campaign/, ocr/ subfolders)
  middleware/             posAuth, hrAuth, campaignAuth, posDayGuard, posAudit, upload, errorHandler
  generators/             static blog/menu HTML builders
  templates/              EJS: blog, blog home, menu, wifi portal
  public/                 client-build/ (built admin/POS SPA), cake-production-build/, blog/, menu.html, wifi assets
  data/holidays-nepal.ics cached Nepal holiday feed
  scripts/                generate-certs.ps1 (mkcert), printtext.js (USB printer test)
  uploads/                runtime uploads (git-ignored); uploads/forapp = webp export for Android apps
```

---

## 3. Running it

| Command (repo root) | Does |
|---|---|
| `npm run dev:server` | `nodemon server/app.js` using `server/.env` |
| `npm run dev:server:local` / `:live` | sets `APP_ENV`, loads `server/.env.local` / `.env.live` |
| `npm run start:production` | `APP_ENV=production node app.js` |
| `npm run dev:client` | Vite on `VITE_DEV_SERVER_PORT` (5173), proxies `/api`, `/uploads`, `/public`, `/socket.io` to `VITE_API_PROXY_TARGET` |
| `npm run build:client` | builds into `server/public/client-build` (served by Express) |

Cake PWA: `cd client/cake-production && npm run build` → output goes to `server/public/cake-production-build`.
`installs/runNodeNPM.bat` opens two consoles (server + Vite). `installs/deployment.bat` robocopies the repo (minus client, node_modules, uploads, env files) to `\\100.97.170.28\mtcstudio`.

There is no test suite, linter or type checker in the repo.

Prerequisites: Node.js + npm, MariaDB (≥10.5), Tesseract (for OCR), mkcert (optional HTTPS certs via `server/scripts/generate-certs.ps1`), Go (launcher build), Android Studio with its bundled JBR (Android apps only).

Setup: `npm install` in `server/`, `client/` (and `client/cake-production/`), create `server/.env`, start the server. Migrations run automatically at boot.

### Environment (`server/.env[.APP_ENV]`)

| Group | Keys |
|---|---|
| Server | `APP_ENV`, `PORT` (default 3001; env files use 80), `HOST`, `DEV_MODE`, `NODE_ENV`, `POS_TERMINAL_ID` |
| MySQL/MariaDB | `SQLPOOL_HOST`, `SQLPOOL_PORT`, `SQLPOOL_USER`, `SQLPOOL_PASSWORD`, `SQLPOOL_DATABASE`, `SQLPOOL_CONNECTION_LIMIT` |
| Website sync | `PUBLIC_SITE_URL`, `AUTOMATION_SYNC_ENABLED`, `AUTOMATION_SYNC_URL`, `AUTOMATION_SYNC_SECRET` |
| Web orders | `WEB_ORDER_BRIDGE_ENABLED`, `WEB_ORDER_WS_URL`, `WEB_ORDER_BRIDGE_TOKEN` |
| SMS | `TEXTBEE_API_KEY`, `TEXTBEE_DEVICE_ID`, `SMS_ENGINE_TICK_MS`, `SMS_ENGINE_BATCH`, `SMS_MAX_RETRIES` |
| Campaigns | `CAMPAIGN_ENGINE_TICK_MS`, `CAMPAIGN_ENGINE_BATCH`, `CAMPAIGN_SCHED_TICK_MS`, `CAMPAIGN_SMS_COST` |
| Mobile | `MOBILE_API_ENABLED`, `MOBILE_MAX_UPLOAD_MB` (also unused `MOBILE_API_VERSION`, `MOBILE_UPLOAD_PATH`, `MOBILE_HEARTBEAT_INTERVAL`) |
| OCR | `TESSERACT_BIN`, `OCR_ENGINE`, `PADDLE_OCR_URL`, `OCR_DRAFT_THRESHOLD`, `MK_DEFAULT_PHONE` |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` |
| Wi-Fi | `WIFI_SITE_URL`, `WIFI_HOTSPOT_HOST`, `WIFI_HOTSPOT_USER`, `WIFI_HOTSPOT_PASSWORD`, `WIFI_FALLBACK_LOGIN_URL`, `WIFI_AFTER_LOGIN_URL`, `WIFI_CACHE_TTL_MS` |

Client (`client/.env.development|production`): `VITE_DEV_MODE`, `VITE_API_URL`, `VITE_API_PROXY_TARGET`, `VITE_DEV_SERVER_PORT`, `VITE_UPLOAD_URL`, `VITE_UPLOAD_API_KEY`.

`DEV_MODE=true` (server) and `VITE_DEV_MODE=true` (client) log every request in as the `DEV01` admin user without a PIN.

---

## 4. Server boot (`server/app.js`)

1. Picks `.env.${APP_ENV}` if it exists, else `.env`.
2. CORS allows any origin; JSON + urlencoded bodies.
3. Static: `/uploads` and `/public` (1-year immutable cache), then `public/client-build` at `/`.
4. Mounts every API router (section 6).
5. `/` → `routes/google.js` (OAuth pages + `/api/*contacts*`), `/wifi` → captive portal, `/cake-app` → PWA build with its own SPA fallback.
6. SPA fallback: any non-`/api/`, non-`/socket.io/` GET returns `client-build/index.html`.
7. `errorHandler` (logs stack, returns `{ error }` with `err.status || 500`). Express 5 forwards rejected async handlers here.
8. HTTP server → `socketServer.init()` (Socket.IO) and `smsGateway` (raw `ws` at `/ws/sms`, same port).
9. Waits for `migrator.ready` (both DB handles share one pool and one migration run). If a migration fails, the process exits.
10. After listen, starts the background jobs:

| Job | Where | Interval |
|---|---|---|
| Live shelf auto-sync to website | `services/liveShelfSync.startAutoSync` | 60 s (+ 400 ms debounced stock push after KOTs) |
| Web order bridge (WS client) | `services/webOrderBridge.start` | persistent, backoff 1 s→60 s |
| SMS engine | `services/smsService.start` | `SMS_ENGINE_TICK_MS` (4 s) |
| Campaign queue worker | `services/campaign/queueProcessor.start` | `CAMPAIGN_ENGINE_TICK_MS` |
| Campaign scheduler | `services/campaign/scheduler.start` | `CAMPAIGN_SCHED_TICK_MS` |
| Holiday feed | `services/holidayCalendar.sync` | once at boot, re-download if cache > 7 days |
| Scheduled order auto-convert | `routes/pos/scheduled.js pollDue` | 30 s |
| Cake catalogue push | `services/cakeCatalogSyncService.queueCakeSync` | debounced on write |

---

## 5. Database

MariaDB (uses `INSERT … RETURNING`, `ADD COLUMN IF NOT EXISTS`). Pool in `database/mysqlPool.js` with `dateStrings: true`; helpers `dbAll`, `dbGet`, `dbRun` (returns `insertId`, `changes`), `transaction(fn)` (gives `tx.dbAll/dbGet/dbRun`). `database/db.js` (CMS) and `pos/db.js` (POS) re-export the same pool.

DATETIME columns hold Nepal wall-clock time (session tz). `utils/nepalDateTime.js`: `getNepalDateStr()` and `getNepalDayBoundsUTC(d)` → `{ start: 'd 00:00:00', end: 'd 23:59:59' }` (Nepal strings despite the name).

### Migrations (`database/migrations`, runner `database/migrator.js`)

Advisory lock `mtc_schema_migrations`; applied files recorded in `schema_migrations`; files run in name order inside a transaction; `-- @optional` statements may fail; `.js` files export `up(tx)`. Rollbacks in `rollback/` are manual only (001–008 exist).

| # | Contents |
|---|---|
| 001 | CMS: categories, products, product_variants, product_images, media_library, blogs, customers (CRM), live_shelf, live_store_schedule, cake_designs (+ media/sizes/flavours/creams), cake_collections(+items), receipt_config, printer_config, weather_recommendations/settings, automation_* (rules, versions, types, settings, logs, test runs) |
| 002 | POS: pos_roles, pos_users, pos_sessions, pos_audit_log, pos_stations, pos_restaurant_tables, pos_customers (+addresses, notes), pos_orders, pos_kots, pos_kot_items, pos_payments, pos_ledger, pos_cancellations, pos_modifiers, modifier_groups, shared_modifiers, product_modifier_assignments, pos_till_sessions, pos_cash_movements, pos_day_closures, cake_orders (+items, accessories, images, status_history), cake_production_* , lookup_master, waiter_calls, pos_devices, pos_call_events, sms_queue, sms_logs, pos_scheduled_orders, web_orders_pending, web_order_items, recommended_products, pos_ocr_imports, combo_items |
| 003 | drops legacy columns/indexes |
| 004 | indexes + cross-table FKs |
| 005 | triggers (below) |
| 006 | seed: receipt config, lookups (PRODUCT_BADGE, TABLE_TAG…), automation types, default WAITER role/user |
| 007 | backfills `products.pos_price`, `pos_till_sessions.business_date` |
| 008 | FULLTEXT search indexes (OCR matching), `wifi_devices`, `wifi_events` |
| 009–011 | campaign schema, seed, demo seed |
| 012 | CRM: company_name, anniversary, google_resource_name, `customer_addresses` |
| 013 | CRM: job_title, country_code, deleted_at, `crm_tags`, `customer_tags`, system tag "MTC Customers" |
| 014 | HR/payroll: `customers` gets an `id` PK (phone stays UNIQUE), `pos_orders.is_staff_purchase`, `pos_cash_movements` reference columns, employee_profiles, employee_salary_history, employee_attendance, payroll_settings, payroll_runs, payroll_run_lines, commission_rules, payroll_commission_imports |
| 015 | department/designation, payroll basis settings, day counts on lines, `employee_adjustments` |
| 016 | `employee_profiles.photo_media_id` → media_library |

Rule: a new column needs its own `ALTER … ADD COLUMN IF NOT EXISTS` migration **and** must be added to the `CREATE TABLE` in 001/002 so fresh installs match.

### Triggers (005)
- `trg_pos_recalc_insert` / `trg_pos_recalc_update` on `pos_kot_items`: `pos_orders.total_amount = SUM(qty*unit_price − discount_amount)` of non-cancelled items. Order totals are never written by app code.
- `trg_pos_kot_auto_serve`: when every item of a KOT is SERVED/CANCELLED, the KOT becomes SERVED.

### Key enums
| Column | Values |
|---|---|
| `pos_orders.order_type` | DINE_IN, TAKEAWAY, DELIVERY, CAKE_ORDER, QUICK_SALE |
| `pos_orders.status` | OPEN, SAVED (draft cart in `draft_items` JSON), CLOSED, CANCELLED. Bill request is a flag (`bill_requested_at`), not a status |
| `pos_kots.status`, `pos_kot_items.status` | ORDERSENT, IN_PROGRESS, SERVED, CANCELLED |
| `pos_payments.method` | CASH, CARD (client "WALLET" is sent as CARD with notes 'WALLET'), QR, LEDGER; `payment_type` ADVANCE / REGULAR |
| `pos_cancellations.kind` | CANCEL (mistake), RETURN (customer returned), WASTE (kitchen flaw) |
| `pos_cash_movements.type` | CASH_IN, PETTY_CASH, PAID_OUT, CREDIT_RECEIVED |
| `pos_till_sessions.status` | OPEN, CLOSED (one per `business_date`) |
| `pos_scheduled_orders` | kind SCHEDULED / DRAFT; status PENDING / CONVERTED / CANCELLED |
| `cake_orders.status` | PENDING, CONFIRMED, IN_PRODUCTION, READY, DELIVERED, CANCELLED, REFUNDED |
| `cake_orders.production_status` | New → Acknowledged → In Production → Ready for Delivery |
| `web_orders_pending.status` | PENDING_APPROVAL, APPROVED, REJECTED, CANCELLED, EXPIRED; `source` WEB_ORDERING or CUSTOMER_QR |
| `pos_ocr_imports.status` | RECEIVED, OCR, PARSED, DRAFTED, MANUAL_REVIEW, FAILED |
| `sms_queue.status` | PENDING, QUEUED, SENDING, SENT, DELIVERED, FAILED, CANCELLED |
| `pos_call_events.status` | INCOMING, ANSWERED, ENDED, MISSED |
| `employee_attendance.attendance_code` | FULL, HALF, ABSENT, LEAVE, OFF |
| `payroll_runs.status` | DRAFT, FINALIZED, REVERSED; line `settlement_status` UNSETTLED / PENDING / PAID |
| `employee_adjustments.kind` | BONUS, PENALTY, ADVANCE |

Two customer tables exist: `customers` (CRM/contacts, phone-keyed, `id` added in 014, used by HR, campaigns, Google sync) and `pos_customers` (POS quick lookup, addresses, notes). Many tables link to customers by **phone**; `crm.js PHONE_LINKED_TABLES` cascades a phone change.

`lookup_master` (by `lookup_type`) is the generic dropdown store: PRODUCT_BADGE, TABLE_TAG, cake SHAPE/CREAM/SPONGE/THEME/DIETARY types, cake-lookup entries.

---

## 6. Authentication and roles

Roles (`pos_roles`): ADMIN, MANAGER, CASHIER, WAITER. Levels used by verify-pin: CASHIER 1, MANAGER 2, ADMIN 3.

- **PIN login** `POST /api/auth/pin` → bcrypt-compares the PIN against every active user, inserts `pos_sessions`, returns `{ sessionId, user }`. The client stores it in `sessionStorage.mtc_session` (KDS: `localStorage.kds_session`) and sends `X-Session-ID`.
- **`requireSession`** (`middleware/posAuth.js`): resolves the token to `req.posUser`, touches `last_active`. With `DEV_MODE=true`, no token or `dev-session` → DEV01 user.
- **`requireRole(...roles)`**: 403 unless `req.posUser.role` matches.
- **`requireOpenDay`** (`posDayGuard.js`): non-GET calls get 423 `{ day_locked: true }` unless a till session is OPEN. Used on orders, kots, transactions.
- **`audit()`** (`posAudit.js`): writes `pos_audit_log`.
- **`campaignAuth.resolveRole`**: valid session → its role; DEV_MODE → DEV01; **otherwise ADMIN** ("LAN-trusted admin console"). `requirePermission(p)` checks `campaign_role_permissions`.
- **`hrAuth.requireHrRole`**: uses `resolveRole`, allows MANAGER/ADMIN, sets `req.actor`. `badRequest(next)` turns service errors into 400s.
- **Client**: `AuthContext` holds the user, auto-locks after 120 s idle, and exposes `can(permission)` with the matrix ORDER_CREATE / SEND_KOT / CHECKOUT / TABLE_MANAGE (all), ORDER_CANCEL / VOID_ITEM / DISCOUNT_APPLY / REFUND / DAY_BOOK_VIEW (manager+), MENU_MANAGE / USER_MANAGE / SETTINGS (admin). `<Can do="…">` hides UI.
- **Socket.IO** handshake: token in `auth.token` or `query.token`; a missing token or `dev-session` is accepted.
- **Manager override**: `POST /api/auth/verify-pin { pin, requiredRole }` checks a second PIN without creating a session (used for cancels, variance approval, reopen).

---

## 7. HTTP API

All paths are prefixed as mounted in `app.js`. "S" = `requireSession`, "D" = `requireOpenDay`, "M" = MANAGER/ADMIN, "A" = ADMIN.

### Auth — `/api/auth` (`routes/pos/auth.js`)
`POST /pin`, `POST /logout` S, `GET /me` S, `POST /verify-pin` S.

### POS master — `/api/pos` (`routes/pos/master.js`, S)
`GET /tables`, `/categories`, `/stations`, `/products`, `/products/:id/modifiers`, `/dashboard/stats`.

### Orders — `/api/pos/orders` (`routes/pos/orders.js`, S + D)
`GET /active` (returns `{ orders, kots }` as flat sibling arrays), `POST /`, `PATCH /:id`, `PATCH /:id/serve-all`, `PATCH /:id/request-bill`, `PATCH /:id/status`, `POST /:id/cancel` M, `PATCH /:id/shift` (move table), `POST /:id/merge`, `POST /:id/transfer-item`, `POST /:id/checkout`.

Checkout: tenders summed per method → `pos/splitTender.validateSplitTender` (payable = total − discount; QR+wallet+ledger ≤ payable; cash covers the rest; change only from cash). In one transaction: insert `pos_payments`, write `pos_ledger` DEBIT (net total) + CREDIT (paid, excluding ledger) for named customers, add to till `cash_sales/card_sales/qr_sales`, set order CLOSED (or keep OPEN if balance due). Emits `order-completed`; notifies the website for web-origin orders.

### KOTs — `/api/pos/kots` (`routes/pos/kots.js`)
`GET /events?token=` — SSE stream (`pos/kdsEvents`), token in query because EventSource can't send headers. Then S + D: `GET /today`, `/served`, `/active`, `/`, `/report/today`, `POST /` (punch KOT; expands combos via `services/comboExpander`, triggers live-shelf stock sync), `PATCH /:id/items/:itemId` (edit qty/notes/pack), `/serve`, `/unserve`, `/status`.

### Other POS routers
| Mount | File | Endpoints |
|---|---|---|
| `/api/pos/customers` and `/api/pos/ledger` | `pos/customers.js` S | `GET /lookup`, `POST /`, `GET /ledger` |
| `/api/pos/till` | `pos/till.js` S | `GET /current`, `POST /open`, `GET /day`, `POST /day/draft`, `POST /day/close`, `POST /day/reopen` M, `POST /day/print`, `POST /close`, `POST /approve-close`, `GET /summary`, `GET/POST /movements`, `PUT/DELETE /movements/:id` M, `PUT /day/opening` M |
| `/api/pos/transactions` | `pos/transactions.js` S+D | `GET /today`, `POST /order/:id/revert` M, `POST /cake/:id/revert` M |
| `/api/pos/waiter` | `pos/waiter.js` S | `GET /table-tags`, `/stats`, `/table/:tableId/last-order`, `/top-items`, `POST /calls`, `GET /calls/active`, `PATCH /calls/:id/resolve` |
| `/api/pos/web-orders` | `pos/webOrders.js` S | `GET /`, `/counts`, `/:id`, `POST /:id/approve`, `POST /:id/reject` |
| `/api/pos/scheduled` | `pos/scheduled.js` S | `GET /`, `GET /hours?date=`, `POST /`, `PATCH /:id`, `POST /:id/convert`, `POST /:id/cancel`, `DELETE /:id` |
| `/api/pos/cake-orders` | `pos/cakeOrders.js` S | `GET /meta`, `POST /lookup`, `GET /products?type=base|accessory`, `POST /upload`, `GET /`, `POST /`, `GET /:id`, `GET /:id/whatsapp-message`, `POST /:id/send-sms`, `PUT /:id`, `PATCH /:id/status`, `GET /:id/payments`, `PATCH /:id/payment`, `DELETE /:id` (soft), `POST /:id/print` |
| `/api/pos/cake-production` | `pos/cakeProduction.js` S | `GET /sync?since=`, `PATCH /:id/status`, `PATCH /:id/notes`, `PUT /:id/state`, `PUT/DELETE /:id/photo/:slot` (1–3), `GET/PUT /checklist-template` |
| `/api/pos/reports` | `pos/reports/index.js` S | see Reports below |
| `/api/maintenance` | `pos/maintenance.js` S+M | tables, stations (CRUD + reorder), users (write = A), products + variants cake-type, `products/bulk`, cake-lookup (CRUD, multiselect, reorder), `GET /roles` |
| `/api/food-menu` | `pos/foodmenu.js` | version, categories, storefront-categories, stations, badges, products (CRUD, bulk), variants (CRUD, bulk, flagged), product modifiers, modifier-groups, shared-modifiers, products-with-assignments, modifier-assignments. Every successful write bumps the menu version |
| `/api/mobile` | `pos/mobile.js` (503 if `MOBILE_API_ENABLED=false`) | `POST /login`, `POST /logout`; then S: `POST /pair`, `/heartbeat`, `/incoming-call`, `/call-answered`, `/call-ended`, `/missed-call`, `/upload-recording`, `GET /dashboard`, `GET /open-orders`, `PATCH /open-orders/:id` |
| `/api/companion` | `pos/companion.js` S + `pos/imports.js` S | `GET /caller-status`, `POST /customer`, `GET /sync/customers`, `/sync/favorites`, `/sync/menu`, `/sync/images`, `/settings`; `POST /ocr-import` (image), `POST /foodmandu-import` (accessibility text), `GET /imports`, `GET /imports/:id` |

### Reports — `/api/pos/reports` (S)
| Endpoint | File | Purpose |
|---|---|---|
| `GET /sales` | `sales.js` | daily sales register (orders + cakes) |
| `GET /cake-payments` | `cakePayments.js` | cake advance/balance payments |
| `GET /order-type-summary`, `/category-summary`, `/product-summary`, `/monthly-summary`, `/zero-sales`, `/weekly-pattern` | `analytics.js` | ranked / monthly / hourly analytics |
| `GET /payment-register` | `paymentRegister.js` | daily tender split |
| `GET /calendar?from&to&bucket=hour|day&include=`, `/calendar-meta`, `/calendar-detail`, `/calendar-holidays` | `calendar.js` | sales calendar (cash net of change, badges fanned out) |
| `GET /day-end`, `POST /day-end/close` M, `POST /day-end/reopen` A | `dayEnd.js` + `dayEndQueries.js` + `dayEndReport.js` | Z report; `buildDayEndReport` is pure computation with balance flags |
| — | `shared.js` | shared filters/helpers |

### CMS / admin routers (no session middleware)
| Mount | File | Endpoints |
|---|---|---|
| `/api/categories` | `categories.js` → controller → service | list, reorder, create, update, delete (writes bump menu version) |
| `/api/products` | `products.js` | list, create, export CSV, template, import CSV, bulk-save, bulk-action, reorder, sync-catalog, get/update/delete, variants CRUD, set-image |
| `/api/combos` | `combos.js` | CRUD (combo = product with `is_combo=1` + `combo_items`) |
| `/api/media` | `media.js` | list, paged list, upload (≤20, compressed to webp by sharp), bulk-delete, update, delete, `make-forapp`, `sync` |
| `/api/blogs`, `/api/generate-blog` | blogs + generator | CRUD, reorder, bulk, preview; static HTML + RSS generation |
| `/api/liveshelf` | `liveshelf.js` | storefront stock items, public feed, sync, store schedule, reorder |
| `/api/cake-catalogue` | `cakeCatalogue.js` | cake designs + collections CRUD, reorder, sync (tables are read directly by the website) |
| `/api/dashboard` | `GET /stats` | counts |
| `/api/crm` | `crm.js` | customers search/list/get/create/update, change phone (cascading), addresses (max 3, one default), soft delete / bulk status / restore / purge, tags CRUD + assign + reconcile, merge, merge-many, stats, delivery-partners, birthdays |
| `/` (google.js) | `google.js` | `GET /auth/google`, `/oauth2callback`, `/api/import-contacts` (SSE), `/api/sync-contacts` (SSE, two-way), `POST /api/export-contacts`, `GET /api/google-status`, `POST /api/google-disconnect` |
| `/api/automation` | `automation.js` | condition/action types, settings, evaluate, rules CRUD + publish + versions + rollback + test runs, compiled, sync-now, recommended products |
| `/api/campaigns` | `campaigns.js` (`attachUser` + `requirePermission`) | types, channels, permissions, audience fields, dashboard, analytics, templates, audiences (preview/count), coupons (issue/validate/redeem), queue (approve/reject/pause/resume/cancel/retry/bulk), runs, events, `webhook/:eventType`, campaign CRUD + status/submit/approve/reject/preview/run/analytics |
| `/api/weather-reco` | `weatherReco.js` | weather-bucket product recommendations + popup settings, sync to website |
| `/api/settings` | `settings.js` | receipt config, cake slip, Mero Kinmel import rules, KDS sounds (upload/clear), printer config, `POST /print` (ESC/POS to USB), `GET /printers` |
| `/api/system` | `system.js` | status, devices, backup/backups/restore/cleanup, logs (read/search/clear), restart, info, holidays |
| `/api/customer` | `customer.js` (public) | menu, recommended, `POST /order`, product modifiers, order status, table orders, pending status |
| `/api/ocr` | `ocr.js` | `POST /` image → Tesseract → parsed items (`x-api-token` optional) |
| `/wifi` | `wifi.js` | portal page, connect (MikroTik CHAP hand-off), `api/event`, `api/summary`, `api/refresh` |
| `/api/hr` | `hr.js` (`requireHrRole`) | summary, employees CRUD, candidates, taxonomy, salary history, attendance (matrix, bulk, per employee), adjustments |
| `/api/payroll` | `payroll.js` (`requireHrRole`) | settings, runs (create, recalc, finalize, reverse, delete, lines), line settlement, commission rules CRUD, commission imports |

---

## 8. Realtime

### Socket.IO (`server/pos/socketServer.js`)
Connect with `query.role` (+ optional `query.station`). Rooms:

| role | rooms joined |
|---|---|
| `customer` | `order-<id>` (from query or `join-order`), `pending-<id>` (`join-pending`) |
| `kds` | `kds` |
| `waiter` | `pos`, `waiter` |
| `cake_production` | `cake_production` |
| anything else | `pos` |
| + station | `station-kitchen|pizzeria|barista|bakery|dessert` |

Events emitted (server → client): `new-order`, `order-updated`, `item-served`, `item-updated`, `order-completed`, `order-ready` (customer), `order-cancelled`, `waiter-call`, `waiter-call-resolved`, `tables-updated`, `menu-updated {version}`, `cake_production_changed`, `web-order-received`, `pending-approved`, `pending-rejected`, `incoming-call`, `call-answered`, `call-ended`, `missed-call`, `ocr-import`, `scheduled-changed`, `sms-update`, `campaign-update`. Client → server: `heartbeat` (device tracker), `join-order`, `join-pending`.

`services/deviceTracker` keeps an in-memory list of connected devices for System Monitor.

### Other channels
- **SSE** `GET /api/pos/kots/events?token=` (KDS fallback) and Google import/sync endpoints.
- **SMS gateway** raw WebSocket `ws://host:PORT/ws/sms?token=&deviceId=`: Android devices receive `send_sms` / `cancel_sms` and report `sms_queued/sending/sent/delivered/failed`. Round-robin across online devices.
- **Web order bridge**: outbound WebSocket to `WEB_ORDER_WS_URL`; on connect sends `{ type:'sync', sinceId }`, imports idempotently by `web_order_id`, acks each order, and pushes status back (approved/rejected/ready/completed/cancelled, KOT item progress, cake stages).

### Menu version
`pos/menuVersion.js` holds an in-memory timestamp. Any write to categories/products/combos/food-menu bumps it and emits `menu-updated`. Clients compare versions to skip refetches (`GET /api/food-menu/version`). It resets on restart, which forces one refresh.

---

## 9. Core business flows

### Business day (till)
1. POS dashboard blocks until a day is open: `POST /api/pos/till/open` creates the `pos_till_sessions` row for today's Nepal date with an opening float.
2. During the day: checkouts add to till sales; drawer movements (`/movements`) record cash in/out; `requireOpenDay` blocks writes when no day is open.
3. Close (`POST /till/day/close`): counted cash (or denominations) vs expected = opening float + cash sales (recomputed from payments, net of change, + cake cash) + net movements. Any variance needs a manager PIN. Stores denominations, cash taken, closing balance, then freezes a Z-report snapshot in `pos_day_closures` with six balance flags.
4. Reopen needs MANAGER/ADMIN + reason (`reopen_count`, audit).
Client: `pages/POS/CashClosing.jsx` (F2 on dashboard) and `pages/DayEnd/DayEnd.jsx`.

### Dine-in / takeaway / delivery order
POS (`POSDashboard` → `POS.jsx`) or Waiter app builds a cart in `POSContext`. Unsent lines persist as `pos_orders.draft_items` JSON (status SAVED, negative ids from `draftItems.assignDraftIds`). Sending creates a KOT (`POST /api/pos/kots`); combos explode into child lines (`combo_parent_id`, `is_combo_child`); stationless items are auto-SERVED. KDS marks items served; the trigger closes the KOT. Cashier checks out with split tender (section 7). Removing a sent item records a `pos_cancellations` row with kind CANCEL/RETURN/WASTE. Tables can be shifted, merged, or have items transferred.

### Customer QR order
`/menu/:tableId` → `POST /api/customer/order` inserts into `web_orders_pending` with `source='CUSTOMER_QR'` and emits `web-order-received`. The cashier approves in the Web Orders modal; approval appends a KOT to the table's OPEN order (or creates one). The customer phone receives `pending-approved` then live item events in `order-<id>`.

### Website order
`webOrderBridge` imports into `web_orders_pending` (source WEB_ORDERING) → POS popup + sound. Approve: food → POS order + KOT; cake items → a CONFIRMED `cake_orders` booking with production status New (never a KOT). Reject stores a reason. Status flows back to the website.

### Scheduled and draft orders
`pos_scheduled_orders` stores carts. SCHEDULED rows auto-convert when `NOW() ≥ scheduled_for − notify_before_min` (30 s poller); DRAFT rows are converted manually. `GET /hours` returns store hours from `live_store_schedule`, which bound delivery times.

### Mero Kinmel OCR import
Companion app uploads a WhatsApp slip (`POST /api/companion/ocr-import`) → `services/ocr/importPipeline`: Tesseract (`ocrEngine`, or Paddle) → `meroKinmelParser` → `orderResolver` (FULLTEXT candidates + token-Jaccard rerank) → a DRAFT scheduled order, or a live order when confidence ≥ `OCR_DRAFT_THRESHOLD` and settings allow. Progress events: `ocr-import`, `scheduled-changed`. Rows are deduped by image hash.

### Foodmandu Restro accessibility import
Companion reads visible Foodmandu order-details semantics through its accessibility service (the app's private database is not readable on an unrooted phone). New-order notifications drive Dashboard → Today's Orders → New → refresh, capture the order, and post raw text to `/api/companion/foodmandu-import`. `foodmanduParser` extracts the order, dedupes by Foodmandu order number, and uses the normal product resolver. Clean Foodmandu imports default to a live POS order (`FOODMANDU_IMPORT_MODE=DRAFT` overrides); FM-REVIEW drafts and failed imports are not acknowledged. After a live POS response, Companion clicks Acknowledge on the Foodmandu detail page. Offline uploads use the same retry queue. Manually opened old orders require the demo switch and never auto-acknowledge.

### Cake orders
POS `pages/CakeOrders` (`/pos/cake`, `/pos/cake/new`, `/pos/cake/:id`). Number format `CAKE-YYYY-NNNN`. Totals: cake + modifiers (lookup extra charges; multi-select stored as comma-separated lookup ids) + accessories − discount; advance recorded in `pos_payments` (`payment_type='ADVANCE'`). POS status transitions: PENDING→CONFIRMED/CANCELLED; CONFIRMED→PENDING/CANCELLED/DELIVERED; DELIVERED→REFUNDED. Production (Cake PWA) moves `production_status` one step at a time, both directions, through New/Acknowledged/In Production/Ready for Delivery; reaching Ready auto-ticks the checklist. The PWA keeps orders offline in Dexie, pulls `/sync?since=` (60 s failsafe + socket push), and queues photo uploads. Balances can be settled through the POS cart ("cake payment" line). WhatsApp/SMS customer messages per stage.

### Call centre (MTC Companion Android)
Phone pairs (`/api/mobile/pair`), sends heartbeats, reports call lifecycle → `pos_call_events` + POS `IncomingCallDock` popup with customer info and favourites. Recordings uploaded to `uploads/call-recordings`. The app syncs customers/menu/images into its own Room DB via `/api/companion/sync/*`.
- Connectivity checks must use `POST /api/mobile/heartbeat`. `/incoming-call` inserts a call row and pops the POS, so a test call there shows staff a fake call.
- Orders placed from the app send `draftItems = []`. Items go only on the KOT; sending both duplicates every line on the POS.
- `GET /api/mobile/dashboard`: today's (Nepal) open/closed counts, sales split (fonePay = QR + CARD, cash net of change, ledger, cake payments included), top items, hot categories with nested items.
- `GET /api/mobile/open-orders`: today-only unified feed. Each row has `kind` POS / SCHEDULED / CAKE, a `stage` (PENDING / PREPARING / READY / SERVED / SCHEDULED / CAKE), `elapsedMin`, `servedInMin` (slowest item), `timeLabel` (`Fires HH:mm`, `Delivery <time>`) and `customerPhone`. POS orders with no KOT are hidden.

The WDS native waiter app reuses `/api/companion/sync/menu` + `/sync/images` (they include category images and use the same PIN session), `/api/pos/tables`, `/api/pos/orders/active` and `/api/pos/scheduled/hours`. It connects its socket with `role=waiter` (rooms `pos` + `waiter`) and plays the central alert sounds from `/api/settings/kds-sound`. Floor layout positions are client-only; the server has no layout concept. Endpoints for "previous bills" (`/api/pos/waiter/table/:id/history`, `/order/:id/bill`) were added and then removed on purpose; don't re-add them without asking.

Android app internals (Kotlin, Room, screens, build notes) are in `AI/app.md` (MTC Companion) and `AI/understand.md` (WDS).

### Media and the forapp export
- Every upload of jpg/png/webp is re-encoded in place to webp quality 82 (`mediaService.compressToWebp`). SVG and GIF are left untouched.
- After every media create, update or delete, `mediaController` fires `syncMedia()` (push or delete on the website) without waiting for it.
- `POST /api/media/make-forapp` wipes `uploads/forapp/`, then exports only product primary images and category images as webp quality 80, max 512×512 (`fit: inside`, no enlargement), keeping the basename stem.
- The Android apps download from `/uploads/forapp/<stem>.webp` using the `/api/companion/sync/images` manifest. The manifest lists only files that exist.
- Recommended source sizes: category 512×512 square, product about 800×600 (4:3), variant 256×256.

### SMS
Every module calls `smsService.enqueue()` or `enqueueTemplate(id, data)` (`smsTemplates.js`: order_confirmation, otp, customer_verification, delivery_notification, payment_reminder…). `sms_queue` is the source of truth; the engine dispatches via `smsGateway` to Android devices, retries up to `SMS_MAX_RETRIES`, logs to `sms_logs`, broadcasts `sms-update`.

### CRM
`customers` table = contacts; a contact becomes a customer once it has order history (system tag "MTC Customers", reconciled from `pos_orders`). Ranked search (`services/customerSearch`: phrase > word > prefix > substring > Levenshtein ≤2 > Double Metaphone). Google Contacts: OAuth tokens in `server/google-tokens.json`; import, two-way sync (CRM wins), export selected, labels ↔ tags, bin → Google trash.

### Campaigns and automation
- **Campaigns** (`services/campaign/*`): `audienceBuilder` compiles AND/OR/NOT filter trees into SQL over whitelisted fields; `ruleEngine` evaluates per-recipient conditions; `campaignEngine` builds runs and enqueues `campaign_queue` rows (with an approval workflow); `queueProcessor` delivers through channel providers (SMS is live; email/WhatsApp/Telegram/Viber/push/AI-call are webhook providers that need an endpoint configured); `couponEngine` handles percentage/flat/free item/combo/BOGO/free delivery coupons; `scheduler` fires scheduled/recurring/birthday/anniversary campaigns; `triggerEngine.emitEvent('order.completed', …)` for event triggers; `analytics` computes ROI/redemption/retention.
- **Automation** (`routes/automation.js`, `services/automationEngine.js`): versioned website marketing rules (conditions → category actions), compiled and pushed to the website (`services/websiteSync.pushCompiledRules`) plus the recommended-products list.

### Website sync (outbound)
| Service | Target | Data |
|---|---|---|
| `liveShelfSync` | `PUBLIC_SITE_URL/api/sync/products`, `/api/sync/schedule` | storefront variants, stock, store hours |
| `menuCatalogSyncService` | `/api/sync/menu` | categories, featured products, modifiers, badges, lookups |
| `mediaSyncService` | `/api/sync/images` | image uploads/deletes |
| `cakeCatalogSyncService` | `/api/synccakes.php` | full cake catalogue tables |
| `websiteSync`, `weatherRecoSync` | `AUTOMATION_SYNC_URL` | compiled automation rules, weather recommendations |

### HR and payroll
- **Employees** are promoted from CRM `customers` (`employee_profiles.customer_id`), optionally linked to a `pos_users` login, with department, designation, photo (media library) and status active/on_leave/inactive/terminated.
- **Salary** is a dated history; a run uses the latest row on or before the period end.
- **Attendance** is exception-based: unmarked days count as worked. Codes F/H/A/L/O; month grid with bulk save.
- **Adjustments**: BONUS (+), PENALTY (−), ADVANCE (−). While unclaimed (`payroll_run_id IS NULL`) they price into any run whose period end ≥ `adj_date`.
- **Settings** (`payroll_settings`): `days_basis` FIXED (`fixed_days`, default 30) or CALENDAR, `half_day_factor` (0.5), `deduct_absent`, `deduct_staff_purchases` (sums `pos_orders.is_staff_purchase` by employee phone), `carry_unsettled`, `salary_cutoff_day`.
- **Line maths** (`payrollService.computeLine`): per-day = salary / basis days; unpaid days = absent + half × (1 − factor) when `deduct_absent`; net = base − unpaid × per-day + commission imports + bonus − penalty − staff purchases − advance + previous unsettled net pay.
- **Run lifecycle**: create (one non-reversed run per exact period) → DRAFT lines for active employees → recalc → finalize (claims adjustments) → reverse (releases them). Finalized runs can't be deleted. Line settlement UNSETTLED/PENDING/PAID with an optional drawer movement link.
- **Commission rules** are stored (PRODUCT/CATEGORY/SALE_CHANNEL/MANUAL/CUSTOM, % or flat), but only manual `commission-imports` reach pay; nothing evaluates the rules automatically.
- **UI**: `pages/HR/HR.jsx` tabs Overview, Directory, Attendance, Salary, Adjustments, Payroll (embeds `pages/Payroll/Payroll.jsx`: Runs, Register, Commission, Settings). `/payroll` redirects to `/hr`.

### Printing
`services/escposBuilder` builds receipt / KOT / cash-closing bytes from `receipt_config`; `services/usbPrinter` sends them to the USB printer chosen in `printer_config` (vendor/product id). `POST /api/settings/print` is the single print entry point; reprints feed the day-end log.

### Wi-Fi captive portal
MikroTik login page redirects to `/wifi?…` with its template variables. Node renders the EJS portal (menu snapshot from `wifiPortalService`, no external CDN) and re-posts the CHAP login to the router (`wifiMikrotik`). Telemetry in `wifi_devices` / `wifi_events`. See `server/routes/wifi.README.md`.

### Holidays and Nepali dates
`holidayCalendar` downloads `officeholidays.com/ics/nepal` into `server/data/holidays-nepal.ics` (offline fallback) for the sales calendar, `/api/system/holidays` and the dashboard. `client/src/lib/nepaliDate.js` converts AD↔BS from a lookup table for `NepaliDateChip` in the admin menu bar.

### System Monitor and backups
`/api/system`: server status, connected devices, rotating logs (`services/logService`, `server/logs/*.log`, 5 MB rotation), backups (`services/backupService` → `server/backups/{manual,daily,weekly}`), restore, restart.

---

## 10. Front-end structure

### Routing (`client/src/App.jsx`)
- Public: `/menu`, `/menu/:tableId`. Standalone: `/waiter/*`.
- `/pos/*` wrapped in `POSRoot` (theme, prefetch, `AuthProvider` → `AuthGate` → `POSProvider`, plus global `WebOrderDock` and `IncomingCallDock`): index `POSDashboard`, `entry` `POS`, `cash-closing`, `cake`, `cake/new`, `cake/:id`. `/pos2` renders `POS` alone.
- `/kds` → `KDSAuthGate` → `KDSProvider` → `KDSDisplay`.
- `/` → `AdminLayout` with child routes: index Dashboard, `sales-report`, `day-end`, `reports`, `food-menu`, `media`, `blogs` (+ new/edit), `cake-catalogue`, `file-maintenance`, `modifier-assignment`, `crm`, `automation`, `campaigns`, `hr`. Redirects: `categories`, `products/*`, `liveshelf` → `/food-menu`; `payroll` → `/hr`; anything else → `/`.
- Admin pages are lazy chunks so POS terminals don't download them; `vendor` chunk = react, react-dom, react-router.

### Admin desktop (`AdminLayout.jsx`)
A desktop with icons, menu bar (Nepali date chip, POS/KDS shortcuts) and floating `DesktopWindow`s. App registry `ALL_APPS`: Food Menu, File Maintenance, Media, Cake Catalogue, Blogs, CRM, Automation, Campaigns, HR, Sales Registry, Day End, Reports, System Monitor; external launchers POS, KDS, Cake Orders. Opening an app adds a window to state and navigates to its path. Window positions and shortcuts persist in localStorage.

### State
- `POSContext` (reducer): master data, live orders and KOTs keyed by order id, table→order map, cart, UI focus, and a per-business-day notification log (read by `NotificationCenter`). Subscribes to socket events and refreshes `menuStore` on `menu-updated`.
- `menuStore`: memory cache (authoritative), IndexedDB (persistence), image warm-up, deduped fetch.
- `KDSContext`: elapsed timers, station filtering, three alert sounds (new/warning/critical) loaded from `/api/settings/kds-sound`, audio unlock on first gesture.

### Module folders (`client/src/pages`)
| Folder | Contents |
|---|---|
| `POS/` | `POSDashboard` (tables, open orders, scheduled/draft cards, web orders, F8 sales report, F2 cash closing), `POS` (menu panel, cart, sent KOT rows, quick access rail, cake payment lines), `CashClosing`, `components/` (split-tender checkout, table merge/shift, customer picker, web orders modal, schedule order, cash drawer, notification center, incoming call dock…) |
| `KDS/` | `KDSDisplay`, KOT cards, summary, report, settings, confetti |
| `Waiter/` | `WaiterApp` (floor grid, new order sheet, open orders, serve board, settings, offline menu cache, PWA) |
| `CustomerMenu/` | QR ordering page |
| `CakeOrders/` | list, `CakeOrderForm`, status timeline, tag input |
| `FoodMenu/` | products grid, categories, combos, live shelf views, badge multi-select |
| `FileMaintenance/` | tabs: Tables, Stations, Modifier Setup, Assign Modifiers, Users, Receipt & Printer, Cake Order Slip, Cake Products, Table Tags, Alert Sounds, Weather Recommends, Mero Kinmel |
| `ModifierAssignment/` | bulk modifier → product assignment |
| `Reports/` | report registry: Sales Register (daily tender), Sales Pattern by Hour, Sales Calendar, Sales by Order Type, Category Summary, Product Summary, Monthly Summary (item/category/order type), Zero Sales; `Calendar/` (Google-Calendar-style views with j/k/t/d/w/m/y shortcuts) |
| `SalesReport/` | daily order register + payment log, reprint |
| `DayEnd/` | Z report, close/reopen |
| `CRM/` | grid, tag bar, merge, address cards, Google sync |
| `Campaigns/`, `Automation/` | builders, rule builder, panels |
| `HR/`, `Payroll/` | see section 9 |
| `Media/`, `Blogs/`, `CakeCatalogue/`, `Products/`, `Dashboard/`, `SystemMonitor/`, `Auth/PinScreen` | as named |

---

## 11. Conventions in practice

- Server CMS modules follow route → controller → service (`CONVENTIONS.md`). POS routers, CRM, campaigns, HR and payroll put handlers inline in the route file; POS routers also query the DB directly.
- POS route handlers are plain `async (req, res)`; CMS controllers use `try/catch → next(e)`.
- Client API calls belong in `services/api.js` / `posApi.js`. The exceptions are `WaiterApp`, `HR.jsx` and `Payroll.jsx`, which create their own axios instances.
- Writes that change the menu must bump `menuVersion` (routers do this with a `res.on('finish')` middleware).
- Dates: always use `getNepalDateStr()` on the server and `todayNepalAD()` from `client/src/lib/nepaliDate.js` on the client for business dates; DB timestamps are Nepal wall-clock.
- Money is stored as DOUBLE; `round2` is used before comparisons.
- Schema changes only through new migration files.
- `client/src/components/MediaPicker/MediaPicker.jsx` is shared by many pages; change it with care.

### What to re-check after a change
| Area changed | Check |
|---|---|
| POS orders / KOTs | POS, KDS, Waiter web app, Companion open-orders, website status push |
| Menu data | menu version bump reaches POS (`menu-updated`), Companion/WDS sync, website sync |
| Media | webp compression, website sync, Make For App export |
| Auth / roles | PIN login, `requireRole` routes, HR/campaign gates |
| HR / payroll | migrations 014–016 applied, run create → recalc → finalize → reverse |
| Server routes for Android apps | restart Node; the APK is rebuilt by the owner, not from here |

---

## 12. Known issues

Confirmed by reading the code (as of 2026-11-16). Fix before treating the system as internet-exposed.

### Security
1. **HR/payroll role gate can be bypassed.** `campaignAuth.resolveRole` treats a missing, invalid or expired token as ADMIN, so `requireHrRole` and campaign permissions pass for anyone who omits `X-Session-ID`.
2. **Admin/CMS APIs have no auth.** `/api/categories`, `/products`, `/media`, `/crm`, `/settings`, `/system` (including backup restore and restart), `/automation`, `/customer`, the Google endpoints and others mount no session middleware. Everything relies on the LAN being trusted.
3. **Socket.IO accepts connections with no token.** Only a wrong token is rejected.
4. **Secrets in git.** `server/google-tokens.json` (OAuth tokens) and `server/google-account.json` are tracked and not in `.gitignore`. A website API key is hardcoded in `liveShelfSync`, `mediaSyncService`, `menuCatalogSyncService` and `cakeCatalogSyncService`. `websiteSync` and `weatherRecoSync` fall back to a hardcoded secret. `installs/deployment*.bat` contain a plaintext network-share password. Rotate the tokens and move them to env/ignored files.
5. **`DEV_MODE=true`** in `server/.env` and `.env.local` makes `requireSession` log in tokenless requests as the DEV01 admin. Only `.env.live` sets it false.
6. `/api/ocr` accepts requests with no token ("for testing").

### Payroll correctness (`server/services/payrollService.js`)
7. **Finalize claims adjustments without recalculating.** An adjustment added after the last calc is marked claimed but never priced, so it is lost.
8. **Unsettled balances compound.** With `carry_unsettled`, earlier finalized UNSETTLED lines stay UNSETTLED after being carried, so each later run adds them again.
9. **Half days are paid in full when `deduct_absent` is off.**
10. **Overlapping runs are allowed.** Only an identical start/end pair is rejected.
11. Draft runs can be "reversed"; they should only be deletable.
12. Commission rules are never evaluated; only manual imports reach pay.
13. `hr.js` and `HR.jsx` default dates with `new Date().toISOString()` (UTC), which is the wrong day for most of the Nepal evening.

### Other
14. **`backupService` copies `server/database/mtcstudio.db`**, a SQLite path left over from before the MySQL move. Backup and restore don't capture the real database.
15. Partial checkout (balance due) sets `closed_at` while the order stays OPEN.
16. `/system-monitor` is in the admin app registry but has no route in `App.jsx`. A reload or direct link redirects to `/`.
17. Convention drift: no controllers for HR/payroll, SQL directly in `routes/pos/reports/calendar.js`, and per-page axios clients in HR/Payroll/Waiter.
18. No automated tests.
