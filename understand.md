# MTC Studio — Project Understanding

> Generated from `project_dump.txt` (full source snapshot, UTF-16LE, ~62k lines) and `changelog.md` (~2,580 lines), cross-checked against the live directory tree. Written for a developer or future Claude session that needs to get oriented fast.

---

## 1. What This Project Is

**MTC Studio** is an all-in-one restaurant/bakery management system for "Munch Time Cafe" (Chitwan/Bharatpur, Nepal). It bundles:

- A **POS** (point of sale) system for dine-in, takeaway, delivery, cake orders, and quick sale
- A **KDS** (Kitchen Display System) for real-time kitchen order tickets, with per-station filtering
- A **Waiter PWA** — mobile-first progressive web app for table-side order taking
- A **Cake Order Management** module — separate workflow for custom cake orders (production, delivery, payments)
- A **CRM** — customer database with loyalty tiers, birthdays, delivery partners
- A **CMS** — manages the public-facing website content (categories, products/menu, blog, media library) and syncs it to a separate live website (`munchtimecafe.com.np`) via PHP endpoints
- A **Live Shelf** — real-time storefront stock/availability board synced to the website
- An **Electron desktop wrapper** — packages the whole thing as a Windows desktop app with tray icon, health monitoring, auto-backup, and a management dashboard

It is a **single-repo, single-port** application: one Express server (port 3001) serves the REST API, Socket.IO realtime layer, and the built React SPA (which itself contains all of POS/KDS/Waiter/CRM/CMS as client-side routes).

---

## 2. Top-Level Architecture

```
MTC Studio.exe  (Electron — desktop shell, optional/production only)
      ↓
  electron/main.js  (spawns child process)
      ↓
  node server/app.js   (Express — port 3001)
      ↓
  serves: server/public/client-build/  (React SPA — all routes, built by Vite)
      ↓
  database: server/database/mtcstudio.db   (SQLite — single file, two connections)
  realtime: Socket.IO on the same HTTP server/port
```

Dev workflow (no Electron needed) is two processes:
- `npm run dev:server` → `nodemon app.js` on port 3001
- `npm run dev:client` → `vite` dev server on port 5173, proxying `/api`, `/uploads`, `/public`, `/socket.io` to `:3001`

Single URL scheme once deployed (`http://<server-ip>:3001/...`):

| Path | Content |
|---|---|
| `/` | Admin CMS desktop (AdminLayout) |
| `/pos` | POS dashboard / entry |
| `/kds` | Kitchen Display |
| `/crm` | CRM |
| `/waiter` | Waiter PWA |
| `/menu/:tableId` | Public customer QR-ordering menu (no auth) |
| `/api/*` | Express REST API |
| `ws://.../socket.io` | Realtime |

This single-port architecture was the result of a 12-phase "Architecture Restructure" (most recent major changelog entry, 2026-06-27) that consolidated a previously fragmented multi-root setup (Electron lived inside `server/electron/`) into the current layout.

---

## 3. Repository Layout (confirmed against live files)

```
mtcstudio/
├── package.json            # root — Electron entry + dev scripts + electron-builder config
├── electron/                # Electron desktop wrapper (NOT bundled with server source)
│   ├── main.js, preload.js, tray.js, serverManager.js, windowManager.js
│   ├── healthMonitor.js, backupManager.js, settingsManager.js, logViewer.js
│   ├── notificationManager.js, dashboard.html, assets/generateIcons.js
├── client/                  # React + Vite frontend
│   ├── src/
│   │   ├── App.jsx                  # top-level router
│   │   ├── context/                 # AuthContext, POSContext, KDSContext, CategoryContext, MediaContext, BlogContext, LiveShelfContext, ProductContext
│   │   ├── pages/                   # one folder per feature (see §5)
│   │   ├── components/              # AuthGate, KDSAuthGate, SocketStatus, MediaPicker, ui/ (shadcn-style primitives)
│   │   ├── layouts/                 # AdminLayout (desktop-OS shell), DesktopWindow, SettingsPanel
│   │   ├── services/                # api.js (CMS), posApi.js (POS/KDS/Waiter)
│   │   ├── utils/                   # dateTime.js (Nepal TZ), serverConfig.js
│   │   ├── hooks/useApi.js
│   │   ├── db/                      # schema.sql, auth_schema.sql — legacy/reference SQL docs, NOT the live schema
│   │   └── socket.js                # Socket.IO client singleton factory
│   └── vite.config.js               # outDir → ../server/public/client-build; dev proxy to :3001
├── server/                  # Express backend
│   ├── app.js                       # entrypoint — registers all routers, static serving, SPA fallback, HTTP+Socket.IO server
│   ├── controllers/                 # CMS controllers (categories, products, media, blogs, menu sections, dashboard, generateMenu, generateBlog, liveshelf)
│   ├── routes/                      # CMS routes (categories, products, media, blogs, crm, settings, system, ocr, customer, dashboard, generateMenu/Blog, liveshelf, menuSections)
│   │   └── pos/                     # POS-specific routes: auth, master, orders, kots, customers, till, maintenance, foodmenu, cakeOrders, waiter, reports
│   ├── services/                    # business logic: categoriesService, productsService, mediaService, blogsService, dashboardService, menuSectionsService, generateMenuService, liveshelfService, liveShelfSync, liveStoreScheduleService, mediaSyncService, deviceTracker, backupService, logService, escposBuilder, usbPrinter
│   ├── database/db.js                # sqlite3 (async) connection — CMS tables: categories, products, product_variants, media_library, product_images, menu_sections, receipt_config, printer_config, customers, blogs, live_shelf, live_store_schedule
│   ├── pos/
│   │   ├── db.js                     # better-sqlite3 (sync) connection — SAME PHYSICAL FILE as database/db.js, POS-prefixed tables (see §6)
│   │   ├── socketServer.js           # Socket.IO init, rooms, emit helpers
│   │   ├── splitTender.js            # validateSplitTender() + saveSplitTenderOrder() — authoritative checkout math (see §8)
│   │   └── kdsEvents.js              # legacy SSE event helpers (Socket.IO is primary now)
│   ├── middleware/                   # posAuth (session token), posAudit (audit log writer), upload (multer), errorHandler
│   ├── generators/generateBlog.js   # static blog page generator (EJS)
│   ├── templates/                   # EJS templates: blog-home, blog-template, menu-template
│   ├── public/                       # static site assets + generated blog/menu HTML + client-build (React SPA output)
│   ├── uploads/                      # user-uploaded media (products, blogs, cake photos)
│   ├── backups/{manual,daily,weekly}/  # DB + uploads snapshots
│   ├── logs/                         # app.log, error.log, crash.log, printer.log
│   ├── scripts/                      # printtext.js (standalone direct-USB ESC/POS test script)
│   └── utils/                        # escHtml, formatDate, nepalDateTime, slugify
├── changelog.md
└── project_dump.txt          # full project source snapshot (this analysis's source)
```

---

## 4. Tech Stack

### Backend (`server/`)
- **Node.js + Express 5**
- **MariaDB via `mysql2/promise`** — as of §19 (2026-07-05), both the CMS layer (`server/database/db.js`) and the POS/KDS/Waiter/Cake layer (`server/pos/db.js`) run on one shared pool (`server/database/mysqlPool.js`) against `munchtim_mtcstudio` on `localhost`. The two-SQLite-drivers/one-file setup described below is history — SQLite is no longer used at runtime; see §19 for the full migration writeup. (Kept as historical context since the code shape — two schema-owning modules, one CMS one POS — carried over unchanged.)
  - ~~`sqlite3` (async/callback) in `server/database/db.js` — legacy CMS layer (categories, products, media, blogs, etc.)~~
  - ~~`better-sqlite3` (sync) in `server/pos/db.js` — POS/KDS/Waiter/Cake layer, with WAL mode and `busy_timeout=5000` to avoid `SQLITE_BUSY` races between the two connections~~
- **Socket.IO 4.8** — realtime order/KDS/waiter events
- **bcryptjs** — PIN hashing for POS users
- **multer** — file uploads
- **sharp** — image processing/icon generation
- **ejs** — server-rendered blog/menu static pages
- **escpos / escpos-usb / serialport / usb** — thermal printer libraries; `escpos` + `escpos-usb` are the live printing path (direct USB ESC/POS, see §8), `serialport` is unused by the current printing flow
- **node-tesseract-ocr** — OCR route (`/api/ocr`)
- **csv-parse / csv-stringify** — Food Menu CSV import/export
- **dotenv**, **cors**, **nodemon** (dev)

### Frontend (`client/`)
- **React 19** + **React Router 7** (`react-router`, not `react-router-dom`)
- **Vite 6** build tool, `@vitejs/plugin-react`
- **Tailwind CSS 4** (via `@tailwindcss/vite`) + Radix UI primitives (dialog, select, tabs, tooltip, checkbox, popover, scroll-area, label, separator) wrapped in `components/ui/` (shadcn-style)
- **ag-grid-community / ag-grid-react** — used in `FoodMenuV2`-style grid views
- **axios** — HTTP client (two instances: CMS `api.js`, POS `posApi.js` with separate session storage)
- **socket.io-client** — realtime
- **lucide-react** — icons
- **class-variance-authority, clsx, tailwind-merge** — styling utilities

### Desktop (`electron/`)
- **Electron 33**, **electron-builder 25**, **cross-env 7**
- Packages as NSIS installer + portable EXE; bundles `electron/` only in the asar, and copies the entire `server/` (with `node_modules`) into `resources/server/` so no separate Node install is needed on the target machine.

---

## 5. Key Client Modules / Pages

| Module | Path | Notes |
|---|---|---|
| **Admin CMS Desktop** | `layouts/AdminLayout.jsx` | A full "desktop OS" shell — draggable/resizable floating windows (`DesktopWindow.jsx`), desktop icons with drag-drop positioning persisted to localStorage, menu bar, taskbar, settings panel. All CMS modules open as windows inside it. |
| **Dashboard** | `pages/Dashboard` | Present in routes but intentionally removed from the desktop icon registry (was auto-opening on every render — fixed by removing from `ALL_APPS`). |
| **Categories** | `pages/Categories` | CRUD + drag-and-drop reorder (`POST /api/categories/reorder`). |
| **Food Menu** | `pages/FoodMenu` | Products + variants grid, keyboard-navigable, CSV import/export, storefront category + online toggle columns. |
| **Media** | `pages/Media` | Media library with website sync (`mediaSyncService.js`). |
| **Menu Sections / Menu Generator** | `pages/MenuSections`, `pages/MenuGenerator` | Builds/generates the public food menu page. |
| **Blogs** | `pages/Blogs` | Inline edit modal, bulk publish/unpublish/delete, drag-reorder, auto site regeneration via `generateBlog.js`. |
| **Live Shelf** | `pages/LiveShelf` | Real-time storefront stock board (see §8). |
| **File Maintenance** | `pages/FileMaintenance` + `tabs/*` | Central admin settings hub — tabs: Users, Stations, Departments, Modifiers, Shared Modifiers, Tables, Table Tags, POS Products, Cake Products, Cake Lookup (modifiers), Cake Order Slip, Receipt & Printer Settings. |
| **Modifier Assignment** | `pages/ModifierAssignment` | Assigns shared modifiers to products. |
| **CRM** | `pages/CRM` | Customer database, loyalty tiers, birthdays, delivery partners. |
| **POS Dashboard / Entry** | `pages/POS/POSDashboard.jsx`, `pages/POS/POS.jsx`, `pages/POS/components/*` | Table map, order cards, cart pane, checkout modal, thermal receipt, table merge. |
| **Checkout (split-tender)** | `pages/POS/components/SplitTenderCheckout.jsx` + `SplitTenderCheckoutContainer.jsx` | Newer checkout UI (2026-06-30) — single discount %/₹ pair + CASH/QR/WALLET/LEDGER tendered simultaneously, must sum exactly to the post-discount payable amount. Wired into `POS.jsx`/`POSDashboard.jsx` in place of the older single-method `CheckoutModal.jsx` (still present, unused but kept for instant revert — see §8/§11). |
| **Cake Orders** | `pages/CakeOrders` | Dedicated order form (`CakeOrderForm.jsx`), dashboard list (`CakeOrders.jsx`), status timeline, tag input. |
| **KDS** | `pages/KDS` | Kitchen ticket display, station-aware filtering, live tickers, served/active tabs, KOT report. |
| **Waiter App** | `pages/Waiter/WaiterApp.jsx` | Standalone mobile PWA — see §9. |
| **Customer Menu** | `pages/CustomerMenu` | Public, no-auth QR-code table ordering page. |
| **System Monitor** | `pages/SystemMonitor` | Backend/socket/DB health, connected devices, log viewer — added in the architecture restructure. |
| **Sales Report** | `pages/SalesReport` | Day's cash/card/credit + per-order breakdown, plus cake-payments collections. Opens as a modal (`pages/POS/components/SalesReportModal.jsx`) via **F8** from `POSDashboard.jsx`/`POS.jsx`, closes on **Esc** — see §20. |
| **Revert Transaction** | `pages/POS/components/RevertTransactionModal.jsx`, opened from a Manager/Admin-only button in `POSDashboard.jsx`'s topbar | "Undo a mistaken checkout" tool — see §8/§11 for the full mechanism. |

---

## 6. Data Model

**As of §19 (2026-07-05), this all lives in one MariaDB database (`munchtim_mtcstudio`) instead of SQLite** — table/module ownership below is unchanged, only the driver and the mechanism for coexistence (real MySQL connections from one pool, not two SQLite driver instances on one file). Original SQLite-era text kept below since the ownership split it describes is still accurate.

The system used to run on **one SQLite file** (`server/database/mtcstudio.db`) accessed via **two separate driver connections** that had to coexist safely (mitigated with WAL mode + busy_timeout on the better-sqlite3 side) — that file is now retired (see §19).

### CMS tables (`server/database/db.js`, now MariaDB via `mysql2`)
- `categories`, `products`, `product_variants`, `product_images`, `media_library`
- `menu_sections`
- `blogs` (with `sort_order` for drag-reorder)
- `customers` (CRM — phone is effectively the natural key; `is_delivery_partner` flag)
- `live_shelf` (legacy — mostly superseded by `product_variants.show_online`, see §8)
- `live_store_schedule` (7-row weekly store hours table)
- `receipt_config` (key/value store — org info, receipt layout, **and** 18 `cake_slip_*` keys for the cake production slip)
- `pos_orders.discount_amount` — present since early schema but dead (never read/written) until the split-tender checkout (2026-06-30) wired it through `POST /pos/orders/:id/checkout`'s new optional `discount_amount` body field; see §8.
- `printer_config` (single-row: `printer_name`, `paper_width`)

### POS tables (`server/pos/db.js`, now MariaDB via `mysql2`)
Core operational schema:
- `pos_roles`, `pos_users` (PIN-hashed via bcrypt), `pos_sessions`, `pos_audit_log`
- `pos_stations` (kitchen/pizzeria/barista/bakery/dessert — drives KDS station routing)
- `pos_restaurant_tables` (`section`, `sort_order`)
- `pos_customers` (separate from CRM `customers`), `pos_ledger` (DEBIT/CREDIT running balance)
- `pos_orders` — `order_type` ∈ `DINE_IN | TAKEAWAY | DELIVERY | CAKE_ORDER | QUICK_SALE`; `status` ∈ `OPEN | SAVED | CLOSED | CANCELLED`; also carries `pax_count`, `table_tags`, `customer_source` (added in later migrations)
- `pos_kots` — one row per "kitchen order ticket" batch sent to the kitchen; `status` ∈ `ORDERSENT | IN_PROGRESS | SERVED | CANCELLED`
- `pos_kot_items` — line items; carries `station_id` (for KDS routing), `variant_id` (added later for stock-deduction precision), `prep_time_minutes`
- `pos_payments` — `method` ∈ `CASH | CARD | QR | LEDGER`; later migrated so `order_id` is nullable and a `cake_order_id` FK was added (cake orders share the same payments table)
- `pos_cancellations`, `pos_modifiers` (legacy per-product modifiers)
- `modifier_groups`, `shared_modifiers`, `product_modifier_assignments` (the current, group-based modifier system)
- `pos_till_sessions` — cash drawer open/close with cash/card/qr subtotals and variance tracking
- `waiter_calls` — table service-call alerts from the Waiter app
- `lookup_master` — **generic key-value lookup table** that replaced four separate cake-tag tables (`cake_cream_types`, `cake_sponge_types`, `cake_shapes`, `cake_themes`). Columns: `lookup_type, code, name, extra_charge, description, sort_order, is_active`. Also reused for `TABLE_TAG` (waiter side-menu tags).
- `cake_orders` — recreated/migrated from a flat schema to a normalized one referencing `lookup_master` by FK (`shape_id`, `cream_type_id`, `sponge_type_id`, `theme_id`, `dietary_type_id`); computed totals `cake_total`, `modifier_total`, `accessory_total`, `grand_total`; status ∈ `PENDING → CONFIRMED → IN_PRODUCTION → READY → DELIVERED`, terminal `REFUNDED`/`CANCELLED`
- `cake_order_items`, `cake_order_accessories`, `cake_order_images`, `cake_order_status_history`
- `product_variants.cake_type` (variant-level tagging as `CAKE_BASE` / `CAKE_ACCESSORY`, also at product level)

**Note on `client/src/db/*.sql`**: `schema.sql` and `auth_schema.sql` in the client source tree are **legacy/reference documents** describing an earlier, non-`pos_`-prefixed schema (`users`, `orders`, `kots`, `roles`, `sessions`). The live, authoritative schema is `server/pos/db.js`. Don't treat the `.sql` files as ground truth for current structure.

### Migration pattern
All schema evolution happens **in code**, at the top of `server/pos/db.js` / `server/database/db.js`, guarded by `PRAGMA table_info(...)` column-existence checks or `CREATE TABLE IF NOT EXISTS`. Destructive changes (e.g. `cake_orders` restructure) snapshot old data into a `_v2` table, copy across, drop, and rename — with `foreign_keys = OFF` temporarily where needed. This runs automatically on every server boot; no separate migration tool/CLI.

---

## 7. Authentication

- **POS/KDS/Waiter**: PIN-based login. `pos_users.pin_hash` (bcrypt). Session token issued and required via `x-session-id` header, checked by `middleware/posAuth.js` (`requireSession`, `requireRole`). A `DEV_MODE` env flag allows a `dev-session` bypass using a seeded `DEV01` user — convenient for local dev, must be off in production.
- **CMS/Admin**: not session-gated the same way (the dump doesn't show a comparable login gate for `/` — CMS access appears to rely on network/physical access control rather than app-level auth).
- **Customer Menu** (`/menu/:tableId`): explicitly public, no auth.
- Audit trail: every meaningful POS mutation writes to `pos_audit_log` via `middleware/posAudit.js`.

---

## 8. Notable Patterns & Design Decisions

- **Server is the source of truth for money.** Cake order totals, balances, etc. are always recalculated server-side (`recalc()` in `cakeOrders.js`) — the client never sets totals directly, only line items.
- **Nepal timezone handling without SQL timezone math.** SQLite stores UTC; `server/utils/nepalDateTime.js` computes Nepal-day UTC boundaries in JavaScript and SQL just does `col >= ? AND col < ?` range comparisons — avoids SQLite's lack of clean +5:45 offset support. Mirrored on the client by `client/src/utils/dateTime.js` (`toUtcMs()` appends `Z` to bare SQLite timestamp strings before parsing, since browsers otherwise treat them as local time).
- **Live Shelf / storefront stock model evolved twice:**
  1. Originally a separate `live_shelf` table, manually managed.
  2. Rewired to be derived from `product_variants` (`show_online`, `sync_status` columns) — Food Menu became the single place to manage storefront-visible products.
  3. Final model: `stock` (manually set beginning inventory, never touched by POS) vs `kot_sold` (SUM of today's non-cancelled KOT items, computed live) vs `available = MAX(0, stock - kot_sold)`. POS no longer mutates `stock` directly; cancellations auto-drop out of the SUM rather than requiring restore logic.
- **Targeted dirty-queue sync instead of polling.** Website sync (`liveShelfSync.js`) used to run a 60s full-table-scan interval; replaced with `markDirty(variantIds)` + 400ms debounced drain that only pushes changed variants (`mode=partial` upsert/remove payload) to the remote PHP endpoint (`syncproducts.php`).
- **Remote PHP sync endpoints required for full functionality**: `syncproducts.php`, `syncimages.php`, `syncschedule.php` on `munchtimecafe.com.np` — these are *external*, not part of this repo; changelog notes several "PHP update required" sections describing contract changes the remote API must match.
- **Realtime via Socket.IO rooms**, not global broadcast: `kds`, `pos`, `waiter`, and per-station rooms (`station-kitchen`, `station-pizzeria`, etc.) so each screen only receives relevant events. KDS does **three layers of station filtering** (order-level in context, item-level in `KOTCard`, backend returns everything unfiltered).
- **KDS "Close Order" never closes the actual order** — it only marks remaining KOT items SERVED (`PATCH /orders/:id/serve-all`), deliberately leaving `pos_orders.status = OPEN` so the cashier can still checkout/process payment. This was a deliberate fix after an earlier version accidentally broke payment processing.
- **Thermal printing migrated twice: browser `window.print()` → PowerShell/Windows-spooler raw printing → direct USB ESC/POS (current).** The PowerShell-era pipeline (`rawprint.ps1`, `winspool.Drv` P/Invoke via `WritePrinter`/`OpenPrinter`, temp `.bin` files, `child_process.exec`) was removed entirely because it was unreliable. The current pipeline: `server/services/escposBuilder.js` (receipts) and the inline byte-builder in `server/routes/pos/cakeOrders.js` (cake slips) build the ESC/POS byte buffer; `server/services/usbPrinter.js` opens the configured USB device directly via `escpos` + `escpos-usb` (`escpos.USB(vendorId, productId)`) and writes the buffer straight to the USB endpoint — no spooler, no shell-out, no temp files. The target printer is identified by `vendor_id`/`product_id` (hex strings, e.g. `0x0416`/`0x5011`) stored on `printer_config`, settable from File Maintenance → Receipt & Printer after a `GET /api/settings/printers` USB scan (`escpos.USB.findPrinter()`).
- **Generic `lookup_master` table** is a recurring "don't keep adding new tag tables" pattern — replaced 4 cake-tag tables and is reused for unrelated things (waiter `TABLE_TAG`s) via a `lookup_type` discriminator column.
- **Window-state persistence everywhere**: AdminLayout windows remember position/size/maximized state in localStorage (debounced 300ms saves), versioned cache keys (`v3` → `v4`) used to invalidate stale shortcut data after structural UI changes.
- **Defensive `||` vs `??` fallout**: a real bug class the project hit — `VITE_API_URL ?? '/api'` doesn't fall through when the env var is set to an *empty string* (only `null`/`undefined` trigger `??`). Had to be swept across ~20 files to `||` so the Vite proxy path works when `VITE_API_URL` is intentionally blank.
- **Revert Mistaken Transaction (added post-2026-06-30).** A correction tool for the cashier's most common mistake — checking out an order or recording a cake advance with the wrong amount/method. `server/routes/pos/transactions.js` (`GET /api/pos/transactions/today`, `POST /api/pos/transactions/order/:id/revert`, `POST /api/pos/transactions/cake/:id/revert`), Manager/Admin-gated. Deliberately **does not delete or mutate the original `pos_payments` row** — it inserts an offsetting negative-amount row instead (`notes: 'Revert of payment #...'`), so `pos_till_sessions` math, audit trail, and history all stay intact and consistent with how every other balance in this codebase is tracked (additive, never destructive). For a regular order: reverses the till credit, sets `pos_orders.status` back to `OPEN` (`paid_amount=0`, `closed_at=NULL`). If the order's original `table_id` is still free it reopens straight onto that table; if another live order has since taken the table, it's reassigned `table_id=NULL` / `order_type='QUICK_SALE'` with a `"Reverted from Table X"` note appended, so it surfaces in the Quick Order list instead of conflicting on the table map. For a cake order: only the payment is offset (`advance_paid`/`balance_due` recalculated) — `cake_orders.status` (the production/delivery state) is left untouched, since a payment mistake shouldn't roll back kitchen progress. **`pos_kots`/`pos_kot_items` are never touched by revert** — checkout never wrote to them in the first place (confirmed by reading `orders.js`), so KOT/served state survives a revert exactly as-is, matching the "don't touch kitchen state" requirement this feature was built around. Reuses the existing `audit()` (`pos_audit_log`, action `REVERT`) for the audit trail rather than `pos_cancellations`, since that table's `entity_type` CHECK constraint (`ORDER|KOT|KOT_ITEM`) doesn't cover payment-only events. The `/today` list and revert eligibility are self-guarding against double-revert: a reverted order drops out of the `status='CLOSED'` query immediately, and a reverted cake order drops out once `advance_paid` nets to 0.
- **Split-tender checkout (added 2026-06-30), wired alongside the old single-method `CheckoutModal.jsx` rather than replacing it.** `SplitTenderCheckout.jsx` is a self-contained, framework-agnostic component (JSDoc `@typedef`s instead of real TS — this repo has no TypeScript toolchain at all, confirmed by absence of `tsconfig.json`/`typescript` dep), themed with the existing `pos.css` warm-beige design system (`.modal`, `.checkout-total`, `.checkout-amount-input`, `.checkout-balance`, CSS vars `--green`/`--red`/`--text-*`) rather than the Tailwind/shadcn system used elsewhere in `components/ui/`, since this module lives inside the POS subsystem which has its own separate theme. `SplitTenderCheckoutContainer.jsx` adapts it onto the existing `orderId/onClose/onSuccess` call-site contract (fetches order/KOTs/CRM customers, posts the checkout, shows the same Print Receipt/Reprint/Done screen as the old modal). `POS.jsx` and `POSDashboard.jsx` import the container under the local name `CheckoutModal` from `./components/SplitTenderCheckoutContainer` — reverting to the old flow is a one-line import-path change back to `./components/CheckoutModal` in each file; `CheckoutModal.jsx` itself was never edited.
  - **Tender math (revised 2026-06-30):** one discount %/₹ pair (auto-cross-calculated, resets all tenders on change) over CASH/QR/WALLET/LEDGER. Unlike a naive "must sum exactly," **only CASH may overshoot the payable amount** — `QR+WALLET+LEDGER` (`nonCashTotal`) is hard-capped at `payableAmount` (blocks confirm if exceeded), `cashRequired = max(0, payableAmount − nonCashTotal)`, `shortfall = max(0, cashRequired − cashGiven)` (must be 0 to confirm), `changeDue = max(0, cashGiven − cashRequired)`. Worked example: bill 1000, 10% discount → payable 900; CASH 1000 + QR 100 + WALLET 100 + LEDGER 200 (nonCash 400 ≤ 900 ✓) → cashRequired 500, shortfall 0, change 500. LEDGER > 0 requires a CRM customer.
  - **Payments rows on confirm:** up to 4 `pos_payments` rows, one per non-zero method, **storing the raw amount the cashier typed** ("cash given," "QR given" — not netted against change), matching the project's additive/non-destructive accounting style (see Revert Transaction above). Because `pos_payments.method` has a DB CHECK constraint of `CASH|CARD|QR|LEDGER` (no `WALLET`), the container maps `WALLET → CARD` on the wire with a `notes: 'WALLET'` tag rather than altering the schema — a `pos_payments_new`-style table-recreate migration (the pattern used elsewhere in `pos/db.js`, e.g. the `cake_order_id` migration) would be the way to add a true `WALLET` enum value if ever needed.
  - **Change is order-level metadata, not a payment row.** New `pos_orders.change_amount` column (idempotent `addOrderCol` migration in `pos/db.js`, alongside the pre-existing-but-previously-dead `discount_amount`).
  - **Server-side math hardened (2026-07-01) — `server/pos/splitTender.js`.** Originally the checkout route trusted a client-computed `change_amount` from the request body; that's gone. Now `POST /pos/orders/:id/checkout` re-derives `cash`/`qr`/`wallet`/`ledger` itself by summing the submitted `payments` array (`wallet` = sum of `method:'CARD'`, since WALLET still rides the CARD slot — see below) and runs them through `validateSplitTender({ total_amount, discount_amount, cash, qr, wallet, ledger })`, the single authoritative implementation of the 7 tender rules: `payable = total_amount − discount_amount`; reject if `qr+wallet+ledger > payable`; `cash_needed = payable − (qr+wallet+ledger)`; reject (`400`) if `cash < cash_needed`; `change = cash − cash_needed`; **`paid_amount = cash + qr + wallet − change` (ledger deliberately excluded — it's debt, not cash received)**; `balance_due = payable − paid_amount − ledger` (algebraically always `0` once validation passes — kept as a defensive `OPEN`-vs-`CLOSED` branch rather than assumed). The route only ever persists/uses this server-computed `paid_amount`/`change`/`balance_due` — it discards anything the client claims. `splitTender.js` also exports `saveSplitTenderOrder(db, orderData, payments)`, a reusable transactional helper (validate → insert `pos_payments` rows with raw tendered amounts, `WALLET`→`CARD`+`notes` mapped → `UPDATE pos_orders` with `payable_amount`/`paid_amount`/`discount_amount`/`change_amount`/`status`) for any future call site that wants the same guarantees without duplicating the checkout route's ledger/till bookkeeping. `posApi.js` / `POSContext.checkout()` still forward `discount_amount` (trusted/clamped, not re-derived — there's no independent KOT-sum check on it yet) but no longer need to send `change_amount` at all.
  - **Delivery prefill.** `OrderTypeModal.jsx` already captures `customer_name`/`customer_phone` on the order at creation time for `DELIVERY` orders (CRM lookup by phone). `SplitTenderCheckoutContainer` uses that to auto-resolve the matching CRM `customers` row (falling back to a direct `GET /crm/customers/:phone` fetch if not already in the loaded list) and passes it to `SplitTenderCheckout` as a one-time `prefill` prop: selects the customer, sets the discount % from the customer's `discount` column, and prefills `LEDGER` with the full post-discount payable amount — so for a typical delivery order the cashier only needs to click Confirm, while every field stays editable if they need to override.
  - **`customers.discount` column** (CMS `customers` table, `server/database/db.js`) was added manually to the live DB outside of code; a matching idempotent `ALTER TABLE customers ADD COLUMN discount NUMERIC DEFAULT 0` (the project's standard `db.run(..., () => {})`-swallow-error migration idiom for the async `sqlite3` driver) was added to `db.js` so fresh installs/clones get the same column. No CRM route changes were needed — both `GET /crm/customers` and `GET /crm/customers/:phone` already `SELECT *`, so `discount` flows through automatically.
- **Idempotent seeding** is a hard rule — all `INSERT OR IGNORE` seed data and `ALTER TABLE` migrations are safe to re-run on every boot; user-entered data (e.g. TABLE_TAG rows) is protected by "only seed if zero rows exist" guards rather than delete-then-reinsert.

---

## 9. Waiter PWA (notable subsystem)

A standalone, installable (Add to Home Screen) mobile web app at `/waiter`, reusing all existing POS APIs — no separate backend.

- 4-digit PIN auth, session in `localStorage` (separate from POS's `sessionStorage`)
- Flow: `Login → Tables → Categories → Items → Review → Send`
- Full variant/modifier picker (bottom-sheet modal) matching POS logic; cart key = `productId_variantId` so different sizes are separate lines
- Table cards: live elapsed-time timer, color-coded by age, swipe gestures (right = open, left = request bill), "ready items" badge
- Side drawer (☰): bill request + toggleable table tags (from `lookup_master WHERE lookup_type='TABLE_TAG'`)
- Category icons via smart emoji-matching regex fallback (`catEmoji()`), DB-set icon takes priority
- Offline queue: failed orders serialize to `localStorage`, drain on reconnect/online event
- Waiter performance stats modal (orders today, tables served, avg service time)
- Service worker (`sw.js`) — cache-first for static assets, network-only for `/api/`

---

## 10. Electron Desktop Wrapper

Acts purely as a **launcher / process manager / tray / dashboard**, never bundles the server source into the asar — the server is copied as a plain `extraResources` folder and run with a normal `node app.js` child process, so editing backend code requires only a restart, not a rebuild.

- `serverManager.js` — spawns `node app.js`, detects readiness via stdout regex + HTTP ping fallback, auto-restarts on crash (configurable max retries), keeps crash history
- `healthMonitor.js` — 30s polling of API/Socket.IO/DB/internet/memory health
- `backupManager.js` (Electron-side) / `backupService.js` (server-side, exposed via `/api/system/backup*`) — both exist; manual/daily/weekly backup with pre-restore snapshotting
- `tray.js` — colored SVG status icons (running/stopped/starting/restarting/error), quick links to POS/CRM/KDS/Waiter/Cake/Reports
- `dashboard.html` — single-file embedded management UI (Dashboard/Health/Logs/Backup/Network/Settings/About tabs)
- `settingsManager.js` — persisted JSON config in `app.getPath('userData')` (port, auto-start, auto-restart, backup schedule, etc.)
- A notable past bug class: `contextBridge.exposeInMainWorld('api', ...)` makes `api` a global on `window`; a later `const api = window.api` inside `'use strict'` in `dashboard.html` was a silent `SyntaxError` (re-declaration) that killed every button — fixed by referencing the global directly.

---

## 11. Evolution Summary (from changelog.md, newest → oldest themes)

1. **Architecture Restructure (2026-06-27, 12 phases)** — the most significant recent change. Consolidated a fragmented multi-root project into single-repo/single-port. Added System Monitor, device tracking, backup engine, structured logging, Electron Builder packaging (NSIS + portable).
2. **Electron Desktop Manager build + bug-fix pass (2026-06-27)** — initial Electron wrapper, then a focused fix session (CSP header, `api` redeclaration crash, unhandled `error` event crash, debug tracing through the full IPC chain).
3. **Waiter App — full build-out (2026-06-24 → 2026-06-27)** — went from "doesn't exist" to a fully-featured PWA across ~6 incremental sessions: initial PWA shell → 4-digit PIN/seed user → variant/modifier picker parity with POS → table vacancy bug fix → side menu/table tags/category icons → timer/swipe/offline-queue/stats feature batch.
4. **Cake Order Management — major rework (2026-06-26)** — went from a flat single-table design (`flavour`, `size`, tag JSON arrays) to a fully normalized line-item model (`cake_order_items`, `cake_order_accessories`, `cake_order_images`) driven by the generic `lookup_master` table, with server-side pricing (`recalc()`), advance-payment integration into `pos_payments`/till, a UI redesign (collapsible sections, Minimal/Advanced modes), and a File Maintenance tab for managing cake product tagging and modifiers.
5. **Admin Desktop OS UI (2026-06-26)** — `AdminLayout` rebuilt as a full desktop-OS metaphor: floating draggable/resizable windows, desktop icons with persisted positions, taskbar, multi-window manager, warm-beige theme replacing an earlier dark terminal theme across POS too.
6. **Live Shelf / Storefront sync architecture, twice-redesigned (2026-06-22 → 2026-06-24)** — moved off a standalone `live_shelf` table onto `product_variants`, then refined the stock model to separate "beginning stock" from "today's KOT sold" so available-online quantity is always computed live instead of mutated destructively. Sync moved from a 60s full-scan to a debounced dirty-queue push.
7. **Real-time infrastructure (2026-06-22)** — Socket.IO introduced (replacing/augmenting SSE), with room-based routing for KDS stations, POS, and (later) Waiter; numerous "X didn't update in realtime" bugs fixed by wiring missing emit calls.
8. **CRM module (2026-06-24)** — net-new customer database, separate from `pos_customers`, with loyalty tiers and delivery-partner flag feeding into POS order modals.
9. **Receipt/printing infrastructure (2026-06-24 → 2026-06-30)** — File Maintenance Receipt & Printer Settings tab, then migration to raw ESC/POS PowerShell/Windows-spooler printing (replacing `window.print()`), extended to the cake production slip with its own configurable field toggles, and finally (2026-06-30) replaced again with direct USB ESC/POS printing via `escpos`/`escpos-usb` after the PowerShell spooler path proved unreliable — see §8 and §12.
10. **Timezone correctness pass (2026-06-22, "UTC Timezone Standardization")** — foundational fix: established the UTC-in-DB / Nepal-at-display-only rule and the shared `nepalDateTime.js` / `dateTime.js` utilities; fixed a subtle SQLite string-comparison bug where ISO `T`-separated bounds sorted incorrectly against SQLite's native ` `-separated `CURRENT_TIMESTAMP` format.
11. **KDS refinements** — station-aware three-layer filtering, live per-second timers, Active/Served tab redesign (replacing an older "All Day" summary-card tab), and the discovery/fix of the "CLOSE ORDER must never set `pos_orders.status`" payment-safety rule.

---

## 12. Known Issues / Things to Watch

- ~~Two SQLite connections, one file.~~ **Resolved by §19's MariaDB migration (2026-07-05)** — `database/db.js` and `pos/db.js` now share one `mysql2` pool against real MariaDB, so the `SQLITE_BUSY` risk class this bullet used to describe no longer applies. Left here for history.
- **No app-level auth visible for the CMS/Admin area** (`/`) in what was read — POS/KDS/Waiter all have PIN+session auth, but the admin desktop does not appear to share that gate. Worth confirming directly in `AdminLayout.jsx` / routing if this matters for the deployment's threat model.
- **External PHP sync endpoints are out-of-repo.** `syncproducts.php`, `syncimages.php`, `syncschedule.php` live on the separate `munchtimecafe.com.np` hosting and must be manually kept in sync with whatever contract the Node services expect (the changelog has several "PHP update required" notes — these are easy to forget when only working in this repo).
- **Legacy/dead code still present**: `server/pos/kdsEvents.js` (SSE) appears to be a fallback/legacy path now that Socket.IO is primary; `pos_modifiers` and `cake_cream_types`/`cake_sponge_types`/`cake_shapes`/`cake_themes` tables are superseded by `shared_modifiers`/`modifier_groups` and `lookup_master` respectively but likely still exist in the DB (migrations don't drop them, only add new tables alongside).
- **`client/src/db/schema.sql` and `auth_schema.sql` are stale/reference-only** — they describe a non-`pos_`-prefixed schema that doesn't match the live `server/pos/db.js`. Could mislead a future contributor; consider deleting or clearly marking as historical.
- **`/pos2` route** in `App.jsx` maps directly to `<POS />` outside of `POSRoot` (no auth wrapper) — looks like a leftover dev/test route; worth confirming it's intentional before shipping.
- **Two routes serve `POS`** (`/pos/entry` inside `POSRoot` and `/pos2` outside it) — naming suggests `POS.jsx` / `POSv2` exist as parallel implementations (changelog references `POSv2.jsx` extensively under `pages/POS/v2/` in older entries, but the current live tree only shows `pages/POS/POS.jsx`) — the v2 component may have been since merged/renamed to be the only `POS.jsx`. Worth a quick diff-check if `POSv2`-era changelog entries seem inconsistent with current file names.
- **better-sqlite3 native binary** (`node_sqlite3.node`, `better_sqlite3.node`) is platform-specific (Windows here) — any deployment to a different OS/arch needs a rebuild (`npm rebuild` / `electron-rebuild`), not just `npm install`.
- **Printing now requires a USB-connected ESC/POS thermal printer, not a Windows-installed printer driver** (changed 2026-06-30). `printer_config` gained `vendor_id`/`product_id` columns; the old `printer_name`-as-Windows-spooler-name flow and `rawprint.ps1` were deleted. If a deployment's printer was only ever set up as a Windows print queue (network/shared printer, virtual PDF printer, etc.) it will no longer work — it must be detectable via `escpos.USB.findPrinter()` (libusb), which on Windows generally requires the printer to show up with a WinUSB/libusb-compatible driver (e.g. via Zadig) rather than the stock Windows printer driver. Re-pair the printer from File Maintenance → Receipt & Printer → Scan after this change.
- **[FIXED 2026-06-30] Food Menu product creation was silently corrupting new rows.** `productsService.create()` always auto-inserted a hardcoded second `'Regular'` variant (price 0) in addition to whatever variant(s) the client had already queued in `dirtyVariants`, *and* `productsController.create()` returned `{ product_id, variant_id }` instead of the `{ product: { id } }` shape the client's `saveAll()` expected (`res.data.product?.id`). Because that lookup always resolved to `undefined`, the temp-ID → real-ID remap (`idMap`) was never populated, so every variant-creation call for a brand-new product POSTed to `/products/new_<timestamp>/variants` instead of the real numeric product ID — silently failing (or writing garbage `product_id` values) while the UI still reported success. Net effect: adding a product (with one variant, multiple variants, or relying on the inline-price default variant) produced either a duplicate phantom `Regular`/Rs.0 variant, orphaned variants, or both. **Fix:** `create()` now only inserts the `products` row and returns `{ product_id }`; the controller wraps it as `{ product: { id } }`; all variant rows — one or many — are created exclusively through the existing `addVariant` calls in the client's `saveAll()` loop, which already runs once per dirty variant after the real product ID comes back. No phantom variant is ever created, and CRUD works identically whether the product has zero (not currently reachable — `addRow` always seeds one), one, or many variants queued. Slug uniqueness (`uniqueSlug()` in `productsService.js`, dash-number collision suffixing) and "newest row on top" (`fm_sort` defaults to `id`/`desc` in `FoodMenu.jsx`) were already implemented correctly and did not need changes.

---

## 13. Quick Orientation for New Work

- **Adding a POS feature?** Schema → `server/pos/db.js`. Routes → `server/routes/pos/*.js`. Client state → `client/src/context/POSContext.jsx`. Realtime → emit via `server/pos/socketServer.js` helpers, consume in the relevant context's socket `useEffect`.
- **Adding a CMS/website feature?** Schema → `server/database/db.js`. Routes/controllers/services → matching trio in `server/routes/`, `server/controllers/`, `server/services/`. If it needs to reach the live website, you'll likely need a new/updated PHP endpoint on the remote host plus a sync service here.
- **Touching dates/times?** Always use `getNepalDayBoundsUTC()` / `getNepalDateStr()` (server) or `dateTime.js` helpers (client). Never compare raw ISO strings against SQLite `CURRENT_TIMESTAMP` strings directly — the formats don't sort identically.
- **Adding a new tag/category-like lookup?** Default to a new `lookup_type` value in `lookup_master` rather than a new table, matching the project's established pattern.
- **Printing?** Build the ESC/POS byte buffer (`escposBuilder.js` for receipts, or inline like `cakeOrders.js` does for the cake slip), then send it via `server/services/usbPrinter.js`'s `printRawUsingConfig(buffer, copies)` — it reads `vendor_id`/`product_id` off `printer_config` and writes directly to the USB device via `escpos`/`escpos-usb`. Never use browser `window.print()` or shell out to PowerShell/the Windows print spooler — that path was removed (see §8, §12).
- **Touching the Cake Production PWA?** It's a separate project (`client/cake-production/`, own `npm run build` → `server/public/cake-production-build/`, own Dexie store) — don't confuse it with `pages/CakeOrders` in the main SPA. Its bidirectional status endpoint (`server/routes/pos/cakeProduction.js`) is intentionally separate from `cakeOrders.js`'s forward-only/cancel/refund-capable one — never merge them. See §18.

## 14. remote_php dynamic menu (2026-07-01)
server/remote_php/menu.html: static snapshot, copy of server/public/menu.html, generated by server/generators/buildMenuContent.js + server/templates/menu-template.ejs, grouped by menu_sections+menu_section_id (server/services/generateMenuService.js).
remote MySQL (munchtim_mtcstudio via syncmenu.php) has NO menu_sections table — only categories/media_library/products/product_variants/product_images/product_modifier_assignments.
local categories table gained icon col via ALTER in server/pos/db.js:765 (`ALTER TABLE categories ADD COLUMN icon TEXT`); menuCatalogSyncService.js does `SELECT * FROM categories` so icon was already in the sync payload, but syncmenu.php's remote CREATE TABLE/INSERT dropped it on the floor — fixed: added `icon VARCHAR(20)` to CREATE TABLE + `SHOW COLUMNS...LIKE 'icon'` guarded ALTER for existing installs + bind_param icon in INSERT.
server/remote_php/mtcmenu.html: new PHP page (kept .html ext per user instruction — host must parse .html as PHP), same head/css/cart-drawer/modal/footer/script verbatim from menu.html, only `<nav class="section-nav">` and `<main class="menu-content">` are now PHP-driven: categories WHERE status='active' ORDER BY sort_order (skip if no active products) → products WHERE status='active' AND category_id=cat.id → product_variants status='active' + product_images(is_primary=1)+media_library for img. Card/variant id + price formatting mirrors buildMenuContent.js exactly (slug||`product-{id}`, single 'Regular' variant collapses to flat button, else size-list, prices via formatPrice() stripping trailing .00 to match old sqlite REAL output vs MySQL DECIMAL(10,2) string).
No PHP binary available locally to lint mtcmenu.html — not yet executed against real DB, only reasoned through.

## 15. syncmenu.php bugs found + full-replace rewrite (2026-07-01)
Live crash `fetch_assoc() on boolean` at menu.html:31 was actually mtcmenu.html: categories query failed because remote table lacked `icon` col (ALTER only runs inside syncmenu.php, not yet deployed/triggered) — query() returns false, not an object.
Found via `node -e` char-by-char bind_param audit (manual counting kept miscounting — don't hand-count type strings, script it): products bind_param `iiisssississ` had description(pos7)/featured(pos8) SWAPPED — description bound as type `i` → silently cast to int → remote description column stuck at "0". Fixed to `iiissssisiss`. Also media_library file_size(pos8) was bound `s` not `i` (harmless — MySQL auto-casts numeric string into INT col — but fixed to `issssssiiis` anyway.
Deploy note: these fixes are local-repo-only (server/remote_php/syncmenu.php) — must be re-uploaded to the live host's public_html/api/syncmenu.php and a fresh sync triggered before description actually updates; old bad "0" rows don't self-heal.
Changed sync model (user-directed) from forever-upsert (comment used to say "No rows are deleted") to full replace: syncmenu.php now wraps everything in begin_transaction()/commit(), DELETEs all 6 tables up front (children-first order: product_modifier_assignments, product_images, product_variants, products, media_library, categories), then inserts fresh payload; catch block rolls back. menuCatalogSyncService.js narrowed source queries to `categories WHERE status='active'` and `products WHERE status='active' AND featured=1`, with product_variants/product_images/product_modifier_assignments scoped to only those product ids (empty-array guard when 0 featured). mtcmenu.html product query also has `AND featured=1` as defense-in-depth.
Net effect: only active categories + active&featured products (and their variants/images) ever exist in the remote DB at all now — not just filtered at display time.

## 16. mtcnew.html redesign + dynamic Product Badges backend (2026-07-02)
Built `server/remote_php/mtcnew.html` — a from-scratch redesigned public menu (still PHP, `.html` ext per the host's PHP mapping) that keeps `mtcmenu.html`'s exact head/SEO/PWA block + `c.css` visual language, but replaces the markup/JS entirely: desktop sidebar (search → badge filter chips → category list w/ counts) + product grid on the right; mobile gets a sticky horizontally-scrollable filter bar + bottom floating cart button. Preserves the `CustomerMenu` (React) ordering flow server-side-in-spirit: variant selection + only-assigned modifier groups in a bottom sheet, qty, special-request note. Cart/checkout collect name/phone/Pickup-or-Delivery; Delivery reveals a Google-Maps Places address box (graceful fallback to plain text if `CONFIG.MAPS_KEY` is left as the placeholder) and computes free-delivery (≤3km, confetti) vs `Rs 30/km` (min Rs 50) via client-side haversine from a hardcoded store lat/lng. WhatsApp order message rewritten to be itemized/professional (unit×qty=line total, modifiers, subtotal/delivery/grand total, customer+address+special request). All tunables (WhatsApp number, store coords, free-km, per-km rate, min fee, Maps key) live in one `CONFIG` object at the top of the page's `<script>`.
**Product Badges (new, dynamic)**: a product can carry multiple badges (Veg, Non Veg, Spicy, Hot, Chef Special, Popular, New, Gluten Free, Dairy Free, High Protein, Kids, Signature). Modeled as `products.badge` = comma-separated **codes** (e.g. `VEG,SPICY`), resolved against `lookup_master` rows with `lookup_type='PRODUCT_BADGE'` (`code`=key, `name`=label, `value`=emoji) — same pattern as the existing `TABLE_TAG` type, so badges are managed as data, not hardcoded. `server/pos/db.js` → `migrateProductBadges()` (mirrors `migrateTableTags()`) adds the `products.badge` column and seeds the 12 defaults above on first run only.
**Sync layer extended** to carry the new data to the remote MySQL host: `syncmenu.php` gained `products.badge` (+ ALTER migration for existing remote installs) and three new full-replace tables — `modifier_groups`, `shared_modifiers` (so the remote menu can render the *actual* modifier options, not just assignment IDs), and `product_badges` (the resolved PRODUCT_BADGE catalogue). `menuCatalogSyncService.js` now also queries and ships `modifier_groups`, `shared_modifiers` (active only), and `product_badges` (from `lookup_master`) alongside the existing tables.
No product had badges assigned as of this session — the catalogue exists and syncs, but every product's `badge` column was still `''` until File Maintenance / Food Menu gained a way to set it (see §17).
PHP still not installed locally (§14's caveat still applies) — `mtcnew.html`/`syncmenu.php` verified by: PHP tag balance (46/46), alternative-syntax `foreach`/`endforeach` and `if`/`endif` balance, all 9 `bind_param` type-strings hand-checked against column counts, and by running the actual data-assembly queries against the live local DB via `better-sqlite3` (69 featured products, 20 multi-variant, 12 with modifiers assigned, sample modifier-group JSON shape matches what the page's JS expects).

## 17. Product Badges admin UI — Food Menu (2026-07-02)
Food Menu (`client/src/pages/FoodMenu/FoodMenu.jsx`) has no create/edit *dialog* — it's a fully inline-editable spreadsheet-style grid (every cell is a live input/select, "Save All" batches dirty rows). So the badge picker was added as a new **Badges** column/field directly in that grid (table view + card view) rather than a separate modal — consistent with how every other field (name, category, status, price…) already works here.
New component `client/src/pages/FoodMenu/BadgeMultiSelect.jsx` (+ `BadgeMultiSelect.css`, own neutral palette matching FoodMenu's `.cell`/`--brand` look, distinct from the golden CakeOrders `TagInput.jsx` theme) — a from-scratch searchable multi-select chip input (not a fork of `TagInput.jsx`, which is string-only/CakeOrders-specific with a "create new" POST flow that doesn't apply here). Handles: type-to-filter, ↑/↓ to move a highlighted row, Enter to select it, Backspace-on-empty-input removes the last chip, Escape closes+clears, outside-click closes, no duplicate chips, order preserved. It stores/emits only badge **codes**; icon/name are resolved for display from the `options` catalogue, and an unresolved/stale code is silently skipped (never rendered broken).
Badge catalogue is loaded once via a new `getLookupMaster(lookupType)` helper added to `client/src/services/posApi.js` (reuses its existing `http` axios instance, which already attaches `X-Session-ID` from `sessionStorage('mtc_session')`/`kds_session`/DEV_MODE fallback) — calls the same `/api/maintenance/cake-lookup` endpoint `TableTagsTab.jsx` already uses, filtered client-side to `lookup_type==='PRODUCT_BADGE' && is_active`. **Caveat inherited from the existing codebase, not introduced here**: `/api/maintenance/*` requires POS session auth (`requireSession`+`requireRole('MANAGER','ADMIN')` in `server/routes/pos/maintenance.js`), but Food Menu lives under the CMS `/` route tree which has no `AuthProvider`/`AuthGate` at all (see §12's "No app-level auth visible for the CMS/Admin area" note) — so in production this call only succeeds if the same browser tab already has `mtc_session` set from a prior POS PIN login, or if `DEV_MODE=true` server-side (it is, locally). `TableTagsTab.jsx` has this identical dependency already; not a regression.
Backend: `productsService.js` `create()`/`update()` now include `badge` in their explicit INSERT/UPDATE column lists (previously enumerated columns and would have silently dropped `badge` even after the DB column existed) — `getAll()`/`getById()` needed no change since they already `SELECT p.*`. Stored as `''` when no badges selected (matches the column's `DEFAULT ''`, not `NULL`).
Verified end-to-end against the live local DB: `productsService.create({badge:'VEG,SPICY'})` → `getById` round-trips the string correctly; `update()` to a different set and to `''` both persist correctly; `getAll()` carries `badge` through; confirmed live over HTTP too (`POST/GET/PUT/DELETE /api/products/:id`) against `/api/maintenance/cake-lookup` returning all 12 active `PRODUCT_BADGE` rows with the right shape. **One process-hygiene note, not a code defect**: an already-running dev server on port 3000 (started before these edits, not spawned by this session, not restarted since it wasn't this session's process to manage) still served pre-edit code/bundle during live testing — a normal `dev:server` restart (nodemon) or rebuild picks up all of this immediately. `npm --prefix client run build` was run once to confirm no syntax/type errors across the whole SPA (clean build), then its output artifacts in `server/public/client-build/` were reverted (`git checkout`) since a production rebuild/deploy wasn't requested — only the source files listed above are part of this change.

## 18. Cake Production PWA — standalone app (2026-07-03)

A **fully separate, installable React PWA** at `client/cake-production/`, built to give the Pastry Chef a dedicated production workspace independent of the admin `CakeOrders` CRUD screen inside the main SPA. Own `package.json`/Vite build (`dev:5174`, `base:'/cake-app/'`), own Dexie IndexedDB offline store, served by the **same** `node app.js` process at `/cake-app` (static files from `server/public/cake-production-build/`, mounted in `app.js` before the POS SPA's catch-all). Built strictly additively per the project's standing "don't touch POS" constraint — new tables, one new route file, two single-line hooks into existing files (see below); no existing POS endpoint's behavior or response shape changed.

**Backend additions** (`server/routes/pos/cakeProduction.js`, mounted at `/api/pos/cake-production`, same `requireSession` auth as `cakeOrders.js`):
- `GET /sync?since=` — incremental pull (full bootstrap when `since` omitted), embeds items/accessories/photos/images/lookups/checklist+tags per order.
- `PATCH /:id/status` — **its own bidirectional transition map**, `STATUS_CHAIN = ['PENDING','CONFIRMED','IN_PRODUCTION','READY','DELIVERED']`, one-adjacent-step-only (`Math.abs(to-from)!==1` → 400), deliberately excludes CANCELLED/REFUNDED so the cake app can never reach them (POS's own forward-only+cancel/refund-capable `PATCH /api/pos/cake-orders/:id/status` in `cakeOrders.js` is untouched and still the only path to those terminal states). Gates the `DELIVERED` transition specifically: rejects unless `delivery_date` equals `date('now','localtime')` (not UTC — matches the existing convention for `order_date`/`delivery_date` elsewhere in the schema). Tagging `READY` auto-flips every checklist-template item to `done:true` inside the same transaction (chef doesn't have to re-tick items implied by the stage change) while leaving tags untouched.
- `PATCH /:id/notes` — writes to a **new dedicated column**, `cake_orders.production_notes`, added specifically so the chef's notes can never be clobbered by the admin `CakeOrderForm.jsx`'s full-document `PUT /:id` (that form's fixed column list never included this new column — confirmed by reading it — so a same-timing edit from both apps can't overwrite each other).
- `PUT /:id/state` (checklist/tags partial upsert), `PUT`/`DELETE /:id/photo/:slot` (1–3, own `cake_production_photos` table — separate from the admin's unbounded `cake_order_images` "Reference Images" feature), `GET`/`PUT /checklist-template` (configured inside this app, not POS — the obvious POS-side home, `CakeLookupTab.jsx`'s hardcoded 5-type array, would require touching POS client code).
- New tables (`server/pos/db.js`, guarded IIFE before `module.exports`, same idiom as `waiterMigrations()`): `cake_production_photos`, `cake_production_state`, `cake_production_checklist_template` (seeded with 4 defaults on first run only), plus `cake_orders.production_notes` column.
- `socketServer.js` gained an isolated `cake_production` room + `emitCakeProductionChanged({cake_order_id, kind})` helper, emitted after every mutation here and after the one hook line added into `cakeOrders.js`'s `PATCH /:id/status` (so a status change made in POS admin still notifies any open cake-app device).

**Frontend** (`client/cake-production/src/`): PIN login (reuses existing POS auth), `ProductionBoard.jsx` (card list, tap-to-open, swipe-to-change-status), `OrderDetail.jsx` (full order view), Dexie `orders`/`syncQueue`/`photoQueue`/`meta` stores, `syncEngine.js` (pull on boot/socket-reconnect/`cake_production_changed` event/60s failsafe; push via a strictly-serial FIFO with exponential backoff), independent photo-upload channel straight to `munchtimecafe.com.np/api/uploadimages.php` (its own `.env` with `VITE_UPLOAD_API_KEY` — this file didn't exist originally, which was the root cause of an early "photo upload not working" bug; blank key → live PHP endpoint's 401).

**Order detail screen (Round 3 redesign)**: two fixed blocks that never reorder — Customer Detail (small font: name, date with day abbreviation e.g. "Fri, 03 Jul 2026") and Cake Section (large font: cake name(s)+variant+size×qty, message-on-cake). Below that, a **user-reorderable section list** (Cake Detail, Reference Images, Move Stage, Photos, Checklist, Tags, Notes) with ▲/▼ buttons per section, order persisted to Dexie `meta` (`orderDetailSectionOrder` key) — device-local only, deliberately not synced to the server since it's a personal display preference, not production data. Merged "Cake Detail" section: 2-col CSS grid (Shape/Sponge, Cream/Theme, Dietary), no Assigned Baker field, Design Notes and Dietary/Allergy notes uncaptioned (allergy text kept bold red), Internal Notes (from POS) labeled and appended. Carousel-style swipe-left/right between orders — the board threads its currently-filtered/sorted visible-order-id list through `App.jsx`'s view state into `OrderDetail`, so swiping always walks exactly what the chef was looking at on the board.

**Animated carousel swipe (2026-07-03, later same day)**: the original swipe implementation only detected direction and instantly remounted the next order (`key={view.id}` in `App.jsx` forces a fresh mount per order, avoiding stale-ref bugs like `notesLoaded.current`) — no visual motion. Added real drag-follow + slide animation in `OrderDetail.jsx`: content translateX's 1:1 with the pointer during drag (rubber-band resistance capped at 60px when there's no next/prev order to go to), and on release past the 90px threshold the current order's content animates fully off-screen (260ms `cubic-bezier(.22,.61,.36,1)`) while `App.jsx` passes an `enterDir` prop (`'left'|'right'`, derived from the swipe direction passed through `onNavigate(id, dir)`) so the newly-mounted next/prev order starts pre-positioned off the correct edge and animates in to settle at 0. Wrapped in a `.cp-carousel-viewport` (`overflow-x:hidden`, no fixed height so vertical scrolling of the page is unaffected — only the horizontal overflow during the slide is clipped); the `.cp-carousel-hint` chevrons had to stay *outside* the transformed `.cp-carousel-page` div, since a CSS `transform` on an ancestor turns it into the containing block for `position:fixed` descendants (would otherwise break the chevrons' fixed-to-viewport-edge positioning while dragging).

**Bug-fix pass (2026-07-03, same day)**, three issues reported together:
1. **Board no longer needs Active/All tabs** — `ProductionBoard.jsx`'s filter state/buttons removed entirely; the board always shows every status (still hides orders whose `delivery_date` has passed, per the earlier Round 2 requirement — unrelated, untouched).
2. **Row-tap was "very sensitive" (dead clicks)** — root cause: `OrderCard`'s old pointer-move handler set a `moved` flag true after just 6px of movement in *any* direction, and `onPointerUp` only opened the detail view `if (!moved)`. Any small jitter (finger tremor, imprecise mouse) above 6px but below the 80px swipe threshold produced neither a tap-open nor a status swipe — a silently swallowed click. Reworked into an explicit `mode: null|'swipe'|'scroll'` state machine with a 10px tap-tolerance zone: displacement must clear 10px before committing to either 'scroll' (vertical-dominant, passes through untouched) or 'swipe' (horizontal-dominant, drag-follow + threshold logic as before); anything that never leaves the tolerance zone is treated as a genuine tap on release, regardless of tiny jitter along the way.
3. **"Moving stages logic not executing properly"** — root cause: `mutations.status()`/`mutations.notes()` only wrote to the outbound `syncQueue`, never touching the local Dexie `orders` row directly; the UI (`useOrder`/`useOrders`, which read straight from Dexie) only reflected the new status after a full round trip (push → server → socket echo → pull) completed. A second tap/swipe before that round trip finished computed its target stage off the *stale* local status, got rejected by the server's `Math.abs(to-from)!==1` check as an already-applied transition, and was dropped after retries — looking like the stage change "didn't happen." Fixed by adding an `optimistic` patch to `enqueueMutation()` (`syncEngine.js`) applied to `db.orders` immediately via `Dexie.update()` (shallow-merges just the changed top-level key) before the item is queued/pushed, so the UI and any immediately-following tap both see the new status instantly, independent of network latency.

All three verified via headless Edge/Playwright: filter tabs absent + all 4 seeded orders visible regardless of status; a simulated jittery tap (4–7px wobble) correctly opened the detail view; a status button clicked twice back-to-back showed the second click's optimistic status already applied at the 30ms mark, with the round trip settling to the correct final state — zero console errors in all three runs.

## 19. Full migration off SQLite → MariaDB (2026-07-05)

**The entire app now runs on MariaDB (`munchtim_mtcstudio` on `localhost`), not SQLite.** Both prior drivers (`sqlite3` in `server/database/db.js`, `better-sqlite3` in `server/pos/db.js`) are gone from the runtime path; `server/database/mtcstudio.db` is retired (kept on disk only as the source the one-time migration read from). This is a separate app from the public-website demo stack described in `LOGIC.md` (`server.js` at repo root) — that stack's own SQLite→MySQL flip happened earlier the same day into the same `munchtim_mtcstudio` database; this migration is the main POS/CMS/KDS/Waiter/Cake app described in the rest of this file.

**New shared driver** — `server/database/mysqlPool.js`: one `mysql2/promise` pool (`MYSQL_CONFIG`: host `localhost`, user `munchtim_admin`, db `munchtim_mtcstudio`, `dateStrings:true`), exporting `dbAll/dbGet/dbRun/transaction`. `dbRun()` returns `{lastInsertRowid, changes}` (same field names better-sqlite3 used) so call sites reading `result.lastInsertRowid`/`.changes` needed no change beyond adding `await`. `transaction(fn)` takes a connection from the pool, runs `fn(tx)` with `tx.dbAll/dbGet/dbRun` bound to that connection, commits/rolls back around it — the async replacement for `db.transaction(() => {...})()`.

**`server/database/db.js`** (CMS tables: categories/products/product_variants/media_library/product_images/menu_sections/receipt_config/printer_config/live_shelf/live_store_schedule/customers/blogs/cake_catalogue) and **`server/pos/db.js`** (POS/cake/production tables) were rewritten to build their schema as MySQL/MariaDB DDL (`AUTO_INCREMENT`, explicit `FOREIGN KEY ... ON DELETE CASCADE` only where the app actually relies on cascade — `product_variants`/`product_images`/`product_modifier_assignments` → `products`/`media_library`/`shared_modifiers` — plain typed columns elsewhere to avoid FK-ordering headaches across the two schemas) using MariaDB's `IF NOT EXISTS`/`IF EXISTS` extensions on `ADD COLUMN`/`CREATE INDEX`/`DROP TRIGGER` so the guarded-migration style from the SQLite era carried over almost 1:1. Both modules now export `{dbAll, dbGet, dbRun, transaction, ready}` — `ready` is a promise that resolves once schema creation + seeding finishes; `app.js` now does `Promise.all([cmsDb.ready, db.ready]).then(() => mainServer.listen(...))` instead of listening immediately, since MySQL bootstrap is async (SQLite's was synchronous/queued).

**Every consumer of `pos/db.js`'s formerly-synchronous API was converted to async** — `db.prepare(sql).get/all/run(...)` → `await dbGet/dbAll/dbRun(sql, params)`, `db.transaction(() => {...})()` → `await transaction(async (tx) => {...})` using `tx.dbGet/dbAll/dbRun`, every touched function/route handler made `async` (Express 5 auto-forwards rejected promises to `errorHandler`, so no new try/catch was needed). Touched: all of `routes/pos/*.js` (auth, customers, master, till, waiter, orders, kots, reports, transactions, cakeOrders, cakeProduction, foodmenu, maintenance), `routes/customer.js`, `routes/liveshelf.js`, `routes/system.js`, `pos/socketServer.js` (the session-auth `io.use` middleware and the station-lookup emit helpers), `pos/splitTender.js` (`saveSplitTenderOrder` now takes `transaction` instead of a raw `db`; not currently called from any route, kept for future use per its original design), and — easy to miss since they're outside `routes/`/`services/`/`pos/` — **`middleware/posAuth.js`** (`requireSession`, hit on nearly every POS request) and **`middleware/posAudit.js`** (`audit()`, called from nearly every mutating route). `transactions.js`'s `creditTill()` helper was restructured to take `tx` as its first argument so both revert endpoints stay atomic.

**SQLite→MySQL SQL-dialect fixes applied inline** (beyond the mechanical async conversion): `INSERT OR IGNORE` → `INSERT IGNORE`, `date('now','localtime')`/`datetime('now','localtime')` → `CURDATE()`/`NOW()`, SQLite's positional `GROUP_CONCAT(x, sep)` → `GROUP_CONCAT(x SEPARATOR sep)`, `JULIANDAY(...)` diff-in-days math → `TIMESTAMPDIFF(...)`, SQLite `INSERT ... ON CONFLICT(...) DO UPDATE SET x=excluded.x` → MySQL `INSERT ... ON DUPLICATE KEY UPDATE x=VALUES(x)`, and `INSERT ... RETURNING *` was **kept as-is** (MariaDB 10.11, confirmed on this box, supports `RETURNING` since 10.5 — verified via `SELECT VERSION()`). One real bug this surfaced: `routes/pos/transactions.js`'s order-revert `UPDATE` used SQLite-style `||` string concatenation for appending a note (`COALESCE(notes,'') || CASE ...`) — MySQL/MariaDB's default `sql_mode` treats `||` as logical OR, which numeric-casts an empty-string operand and throws `Truncated incorrect DOUBLE value: ''`; found by actually exercising the revert endpoint, fixed by rewriting the expression with `CONCAT(...)`/`CASE` instead of `||`. Two more MySQL-native duplicate-key checks (`e.message?.includes('UNIQUE')`, which matched SQLite's error text and never would have matched MySQL's) were fixed to `e.code === 'ER_DUP_ENTRY'` in `cakeOrders.js` (`POST /lookup`) and `maintenance.js` (cake-lookup create). A pre-existing bug unrelated to this migration was also found and fixed while exercising the payment endpoint: `cakeOrders.js`'s `PATCH /:id/payment` referenced `dbMethod` in its `audit()` call outside the scope where it was declared (inside `recordPayment()`), throwing `ReferenceError` on every cake-order payment even under the original SQLite code — changed to log `req.body.method` instead.

**Data migration** (`server/scripts/migrateSqliteToMysql.js`, one-off but idempotent/re-runnable): requires `database/db.js`+`pos/db.js` to build the schema, then for each app-owned table `TRUNCATE`s it and reloads every row from `server/database/mtcstudio.db` (via `better-sqlite3`, read-only) with original ids preserved (so `AUTO_INCREMENT` counters continue correctly — no explicit reseeding needed), column-intersecting against `INFORMATION_SCHEMA` so schema drift between the SQLite source and the new MySQL DDL doesn't fail the copy. ISO datetime strings (`...T...Z`) from SQLite are reformatted to MySQL `DATETIME` literals inline. Tables **not** owned by this app (`web_orders`, `log_crm`, `auth_otp`, `auth_sessions`, `loyalty_ledger`, `cake_designs`/`cake_design_media`/`cake_design_sizes`/`cake_design_flavours`, `cake_creams`, `cake_collections`/`cake_collection_items` — all belonging to the separate `LOGIC.md` website stack, already migrated into the same `munchtim_mtcstudio` DB by that stack's own script) are left untouched if they already have rows; legacy/unused tables present only in the old SQLite file (`products_backup`, `cake_cream_types`, `cake_sponge_types`, `cake_shapes`, `cake_themes`) are copied in generically (types inferred from `PRAGMA table_info`) for completeness, matching this project's "never silently drop data" convention.

**Verified end-to-end against live migrated data** (not just `node --check`): CMS `/api/categories`/`/api/products`, POS `/api/pos/categories`/`/api/pos/tables`, order create → KOT create (confirmed the MySQL `trg_pos_recalc_insert` trigger correctly recomputes `pos_orders.total_amount`) → split-tender checkout → till open/current → revert-transaction (confirmed till credit + order reopen), cake-order list/payment/status-transition/revert, `/api/food-menu`, `/api/maintenance/cake-lookup`, `/api/liveshelf`, and the public `/api/customer/menu`. Auth verified via the `DEV_MODE=true` dev-session bypass (`x-session-id: dev-session`) since real user PINs are unknown; PIN login itself (`POST /api/auth/pin`) round-trips correctly against the migrated `pos_users`/`pos_roles` rows.

**Known residual quirk, not fixed (pre-existing pattern, not migration-introduced)**: `audit()` writes now go through the shared pool independently of whatever `transaction(...)` a caller is inside — on MySQL this means an audit-log row is no longer atomic with the business transaction it describes (both used to share one connection/transaction under better-sqlite3). Every call site already treats `audit()` as fire-and-forget (never awaited), so this only matters in the rare case of a transaction rolling back after the audit insert already committed — acceptable for a log table, flagged here in case it ever needs tightening.

**`sqlite3`/`better-sqlite3` remain in `server/package.json`** solely so the migration script can still read the old file if ever re-run; nothing at runtime requires either package anymore.

## 20. Sales Report — cash-mismatch fix + table/discount/search + F8 modal (2026-07-08)

**Root cause of a real "cash collection doesn't match" report**: `GET /pos/reports/sales` (`server/routes/pos/reports.js`) summed `pos_payments.amount` for `method='CASH'` raw — but that column stores the *tendered* amount (what the customer physically handed over), not what stayed in the drawer. Example live-DB case (2026-07-08): 3 cash orders tendered ₹1350 total but ₹105 was given back as change, so actual net cash was ₹1245 — the report showed ₹1350. Fixed by subtracting `SUM(pos_orders.change_amount)` (for the day's closed orders) from `sumCash`. This mirrors the `/day-end` Z-report's `expectedCash` formula, which already netted change correctly — **if `/sales` cash ever looks wrong again, diff it against `/day-end`'s `expectedCash` calc first**, since that's the fuller reconciliation (it also accounts for till opening float and `pos_cash_movements`, which `/sales` still does not — `/sales` is a same-day snapshot, not a full drawer reconciliation).

**Cake payments were entirely absent from `/sales`'s cash/card/credit totals** (they only appeared in the separate `/cake-payments` section of the page). Fixed by summing `pos_payments` rows where `cake_order_id IS NOT NULL` and `created_at` falls in the Nepal day bounds (`getNepalDayBoundsUTC`, independent of the linked cake order's own status/delivery date — cash can be collected on a different day than delivery) and merging those method-sums into the same `sumCash/sumCard/sumQR/sumLedger` totals used for POS orders. The separate `/cake-payments` section (advance/follow-up breakdown) is untouched and still renders on its own.

**`/sales` now also joins `pos_restaurant_tables`** (`o.table_id → t.name AS table_name`) and selects `o.discount_amount`, exposed per order as `tableName`/`discount`. Reminder on the schema: `pos_orders.total_amount` is maintained by a DB trigger as `SUM(item qty×price − item discount)` over non-cancelled KOT items (post item-discount, pre bill-discount); `discount_amount` is a separate manual bill-level discount; net payable = `total_amount − discount_amount`.

**Frontend** (`SalesReport.jsx`/`.css`): header heading+date merged into one line; added a client-side search box (order id/customer/phone/table) filtering the order list, its count, and the "Total Collected" footer (top summary tiles stay whole-day); order rows show a "Table N" tag when `tableName` is present; expanded-row detail gained a Total/Discount/per-method-Payment-lines summary above the items table.

**F8-opens/Esc-closes modal**: new `pages/POS/components/SalesReportModal.jsx` wraps `SalesReport` in the project's existing plain-component modal convention (`.modal-overlay`/`.modal`, `onClose` prop, no internal Esc handling — see §8's "no generic Modal component" note). Wired into both `POSDashboard.jsx` (which had no keydown listener at all before this) and `POS.jsx` (added into its existing single keydown effect, `Escape`-closes-report checked *first*, ahead of the screen's other modal-close/`navigate('/pos')` fallthrough branches, matching the established "most specific modal first" Esc convention).

Verified: `vite build` (client) and `node --check` (reports.js) both clean; re-queried the live DB directly for 2026-07-08 to confirm net cash (₹1245) and the new table-name join (orders 99/100 → "TABLE 06"/"TABLE 03", order 101's `discount_amount`=54 surfaced) before shipping.
