# WDS — MTC Waiter Android App — Session Notes
### 2. WDS project genesis
User asked for a **new, separate Android project** at `D:\APP\WDS` — described as "a conversion of mtcstudio/Waiter (the existing web app at localhost/waiter) but faster and fuller": adds take-away, delivery, scheduled orders, draft orders (the web Waiter app only does dine-in); SQLite-first with all menu data (products, variants, images, tables, product-variant images) downloaded ahead of time for very fast execution; category images (the plain `/api/pos/categories` endpoint the web app uses doesn't have these — the Companion sync endpoint does); offline/online capable; KDS→waiter and POS→waiter notifications; billing-request button; tag-food-served-after-serve.
Confirmed to the user (explicitly asked "are you reading mtcstudio waiter for reference???") — yes, real backend/frontend source was read, not guessed: `server/routes/pos/{auth,master,orders,kots,scheduled,waiter,companion}.js`, `server/pos/socketServer.js`, `server/pos/db.js`, `server/middleware/posAuth.js`, `client/src/pages/Waiter/WaiterApp.jsx` + `waiter.css`, `client/src/socket.js`.
Foundation built in one pass: Gradle files, Hilt/Room/Retrofit setup, all entities/DAOs/DTOs/API interface/repository/ViewModels/screens, adaptive icon (vector-only, no binary PNGs since the Write tool can't produce binaries), gradle wrapper jar copied from the sibling MTCCompanion project (Write tool can't create binary `.jar` files either).

### 3. Login flow question ("first screen should have IP + PIN, then normally ONLY PIN — is that done???")
At the time of asking, it was **not** implemented — every login screen visit showed both fields. Explained where menu/table/image data actually comes from (same mtcstudio backend DB via `/api/companion/sync/menu` + `/api/companion/sync/images` + `/api/pos/tables` + `/api/pos/orders/active`), then implemented: server URL/IP field only shows on first run (or via a "Change" link); every later login is PIN-only.

### 4. "Server port hard coded?? 192.168.1.5" / actual connection error
`192.168.1.5:3001` was only ever a `DEFAULT_BASE_URL` fallback constant, never a hardcoded live value — but the user hit a real bug: after saving a *new* server IP (`192.168.1.64`), the app still connected to the old default. Root cause: Retrofit's `baseUrl()` was set once at Hilt singleton construction time (whichever URL was in prefs at that first app launch), and never re-read afterward. Fixed by moving the base URL out of the Retrofit builder and into a `BaseUrlInterceptor` that rewrites the request host from prefs on every single call.

### 5. First real-device run — "worst app I ever seen, no UI/UX... BE PROFESSIONAL"
Concrete asks: vacant/non-vacant table should show bill amount; can see previous bills; see who served the previous order; variant/modifier/category-image sync all local-DB, fast; "26th century type," professional, matching the real web Waiter app's visual language as a starting reference.
First pass: reused the web app's terracotta/cream palette (`waiter.css` colors) directly, added real table-status logic (vacant/occupied/bill-requested with time-based heat color), a table detail sheet with running bill + **previous bills with server name** (new backend endpoints `/waiter/table/:id/history` + `/waiter/order/:id/bill`), category images, search, variant/modifier picker sheet, 4-digit PIN pad.

### 6. "DON'T COPY DESIGN OF WAITER APP — MAKE YOUR OWN, SUPER DUPER AWARD-WINNING, TOO MODERN"
Discarded the light terracotta palette entirely. Built an original dark design system (`Theme.kt`): near-black `#0A0B0F` ground, single ember accent gradient, status conveyed via glowing dots + tinted washes rather than borders, `pressable()` press-scale on every tappable surface, spring/breathe animations throughout (`WdsComponents.kt`).

### 7. "Animation and visuals and order notification should be clearly visible on side, with set database alarm on MTCStudio, waiters call etc."
Built `NotificationRail.kt` (right-edge alert stack, visible on every screen, waiter-calls are sticky until resolved) and `AlertPlayer.kt`, which pulls the **actual centrally-configured alert sounds from MTCStudio's own settings** (`GET /api/settings/kds-sound` → `receipt_config` table, keys like `kds_sound_waiter_ready`, `kds_sound_waiter_new_order` — the same sounds KDS and POS already use) rather than bundling arbitrary app sound assets, caches them to `forapp/sounds`, plays + vibrates (distinct pattern for waiter calls) on food-ready/waiter-call/new-order socket events.

### 8. Major functional correction — table sheet, delivery time, invisible order queues, UI polish
Four explicit asks in one message:
- **Drop "previous bills" entirely** — a table sheet should show only its **current active order** (a table stacks KOT rounds onto one order, never multiple orders).
- **Delivery/scheduled time**: no date field (always today), just hour+minute, bounded by real business hours from `/api/pos/scheduled/hours` (can't promise a time that's already passed, can't promise past closing).
- Takeaway/delivery/scheduled/draft orders were being created but **never shown anywhere in the UI** — fixed by building a dedicated view for them (later merged into the tables screen, see below).
- General "make it modern" polish pass.
Backend bill-history endpoints from step 5 were reverted (removed from `server/routes/pos/waiter.js`, back to original) since the feature was explicitly dropped.

### 9. Final table-screen correction (most recent, this segment)
- **Don't categorize tables by section** — flat freeform floor only.
- **Long-press to reposition a table, save the layout** — implemented as a drag-after-long-press gesture, position persisted to a new `tables.posX/posY` column (Room DB bumped to v3), explicitly preserved across every future menu/table sync (server has no concept of floor layout — this is pure client-local state that must survive `replaceAll`'s clear+reinsert).
- **All open orders shown as cards on the same screen** — deleted the separate `ActiveOrdersScreen.kt`/`ActiveOrdersViewModel` entirely; folded takeaway/delivery/scheduled/draft queues directly into `TablesViewModel` and render them as an inline card stack above the floor, no tab navigation required.

---


Project: `D:\APP\WDS` (package `com.mtc.wds`)
Reference/backend: `D:\mtcstudio` (Express + MySQL POS backend, existing web Waiter app at `client/src/pages/Waiter/WaiterApp.jsx`)

Native Android conversion of the web Waiter app: take-away, delivery, scheduled orders, draft orders, dine-in tables, offline-capable SQLite cache, live socket updates from KDS/POS.

---

## Architecture

- **Kotlin + Jetpack Compose**, Hilt DI, Room (SQLite), Retrofit/OkHttp, Coil, socket.io-client, WorkManager, EncryptedSharedPreferences.
- Custom `mutableStateListOf<Screen>` back-stack navigation (no Navigation-Compose) — same pattern as sister app MTCCompanion. `hiltViewModel()` calls are therefore Activity-scoped.
- **Master data pulled once, order traffic stays live**: menu/variants/modifiers/tables/alert-sounds sync into Room + local files; only orders/calls/KDS status flow over the socket in real time.
- Reuses backend endpoints built for the call-center Companion app (`/api/companion/sync/menu`, `/api/companion/sync/images`) since they share the same POS-PIN `x-session-id` auth as `/api/pos/*` and already return webp category images — avoided building new backend auth.
- No server-side changes were needed for KDS→waiter / POS→waiter notifications: connecting the socket with `role=waiter` already joins both the `'pos'` room (order status) and `'waiter'` room (calls) — confirmed in `server/pos/socketServer.js`.

## Key files

- `data/local/Entities.kt`, `Daos.kt`, `AppDatabase.kt` — Room schema (currently **v3**: added `active_orders.totalAmount/tableName`, `items.punchedByEmp`, `tables.posX/posY`).
- `data/remote/model/ApiModels.kt` — Retrofit DTOs, matched exactly against real server response shapes (see "Bugs fixed" below).
- `core/network/ApiService.kt` / `NetworkModule.kt` — Retrofit interface; base URL is read fresh per-request via `BaseUrlInterceptor` (not baked in at Hilt startup).
- `core/socket/SocketManager.kt` — socket.io client, `role=waiter`, listeners survive reconnects via a hot `MutableSharedFlow` bus.
- `core/alert/AlertPlayer.kt` — pulls alert sounds from MTCStudio's centralized `/api/settings/kds-sound` config (same `receipt_config` used by KDS/POS), caches to `forapp/sounds`, plays + vibrates on food-ready / waiter-call / new-order.
- `data/sync/ImageCacheManager.kt` — downloads product/category/variant images into `context.filesDir/forapp` (mirrors server's `/uploads/forapp` export dir).
- `data/repo/WdsRepository.kt` — single repository, all sync + order-submission + realtime-adjacent logic.
- `ui/WdsViewModels.kt` — all ViewModels in one file (LoginViewModel, SyncViewModel, TablesViewModel, CategoryViewModel, MenuViewModel, CartViewModel, CheckoutViewModel, NotificationViewModel).
- `ui/theme/Theme.kt` — dark design system: near-black ground (`#0A0B0F`), single ember accent gradient (`#FF5A1F→#FF9F1C`), status colors (Mint/Amber/Rose/Violet/Sky) carried by glow dots and tinted washes, not heavy borders.
- `ui/components/WdsComponents.kt` — shared primitives: `WHeader`, `WCard`, `EmberButton`, `GhostButton`, `Tag`, `FilterChip`, `GlowDot`, `QtyStepper`, `MicroLabel`, `WEmpty`, `pressable()` (press-scale on every tappable surface), `breathe()` (pulsing alpha), time/money formatting helpers.
- `ui/components/NotificationRail.kt` — right-edge alert stack (`NoticeHost`), visible on every screen, spring slide-in, waiter-calls are sticky (stay until acted on) with a GO action.
- `ui/feature/login/LoginScreen.kt` — 4-digit PIN pad; server URL/IP asked only on first run (or via "Change" link), auto-submits on 4th digit.
- `ui/feature/sync/SyncScreen.kt` — one "Sync Now" button; per-image download progress; shows what's SQLite vs local-file vs Live.
- `ui/feature/tables/TablesScreen.kt` — **the main screen** (see below).
- `ui/feature/category/CategoryScreen.kt`, `ui/feature/menu/MenuScreen.kt` — category images, product search, variant/modifier picker sheet (previously silently auto-picked first variant — now a real sheet).
- `ui/feature/checkout/CheckoutScreen.kt` — delivery/scheduled time entry.
- `MainActivity.kt` — nav host, wires the notification rail + alert sounds into every socket event.

## TablesScreen — current design (most recently revised)

Per explicit user correction, this replaced an earlier "sectioned grid + separate Orders board" design:

1. **No table categorization/sections** — flat freeform floor, not grouped by section.
2. **Long-press to reposition, persisted** — hold a table card to lift it (scale + ember glow), drag anywhere, release to save. Position stored as `tables.posX/posY` (dp floats, `-1` = unset/default grid). `TableDao.replaceAll` carries the saved position forward across every future menu/table sync instead of wiping it — server has no concept of floor layout, this is 100% client-local state.
3. **All open orders as cards on the same screen** — no separate "Orders board" screen anymore (deleted `ActiveOrdersScreen.kt` + `ActiveOrdersViewModel`, folded into `TablesViewModel`). The floor screen shows, top to bottom: stat strip → quick actions (Take Away/Delivery/Schedule/Draft) → waiter-call banner → **"Open orders" card stack** (every live Take Away + Delivery order, every Scheduled/Draft in the `pos_scheduled_orders` queue, inline, no tabs) → the freeform table floor.
4. Tapping an occupied table opens a bottom sheet showing **its one live order**, grouped by KOT round ("Round 1, Round 2…" — a table stacks rounds onto the same order, never a new order), with per-item Serve, "mark all served," Add Round, Request Bill. (Earlier "previous bills / who served" concept was explicitly dropped by the user — replaced with live-order-only.)

## Checkout — delivery/scheduled time entry

- Always **today**, no date picker.
- Simple `HH` / `MM` entry, bounded by real business hours: earliest = now+15min, latest = today's closing time from `GET /api/pos/scheduled/hours?date=`. E.g. at 9:20 PM with an 11 PM close, 8:00 PM is rejected (red), times up to 11:00 PM are accepted (green). Falls back to draft if store is closed today.
- One-tap time presets clamped to the same window.

## Bugs found & fixed this session

- **`/api/pos/orders/active` returns `{orders, kots}` as two flat sibling arrays** (kots carry `order_id`, not nested under each order) — the original DTO assumed nesting, so **every table always rendered vacant**. Fixed in `ApiModels.kt` (`ActiveOrdersResponse`) + `WdsRepository.syncActiveOrders()`.
- **Retrofit baked the base URL once at Hilt startup** — saving a new server IP via the login screen's "Change" link had no effect until app restart. Fixed via `BaseUrlInterceptor` that rewrites the request host from prefs on every call.
- **`SocketManager.events()` bound listeners to a possibly-null/stale socket instance**, never re-attached after reconnect — realtime KDS/POS/waiter-call notifications could silently stop firing. Rewritten around a persistent hot `MutableSharedFlow` bus that survives reconnects.
- **Room v1→v2 destructive migration wipes local tables but the cached `menu_version` pref survives** — server would then reply `changed:false` forever and the menu would never repopulate. Guarded: the cached version is only sent if `productCount() > 0`.
- Variant/modifier picker previously silently auto-selected the first variant for any multi-variant product — replaced with a real bottom-sheet picker (`OptionsSheet` in `MenuScreen.kt`).

## Explicitly reverted (do not re-add without asking)

- Two backend endpoints (`/api/pos/waiter/table/:tableId/history`, `/api/pos/waiter/order/:orderId/bill`) were added to `server/routes/pos/waiter.js` for a "previous bills" feature, then the user said the table sheet should show **only the current live order**, not history. Both endpoints were removed; `server/routes/pos/waiter.js` is back to its original state — **no backend restart needed**.
- Client-side `BillHistoryDto`/`BillLineDto` DTOs and the corresponding Retrofit calls were added then removed for the same reason.

## Known gaps (flagged, not built — only do if explicitly asked)

- No foreground service to keep the socket connected when the app is backgrounded/killed.
- No push notifications for a fully-closed app (current notification rail is in-app only).
- No PIN length other than 4 supported (matches the web app's actual behavior, confirmed via `WaiterApp.jsx`).

## Related persistent memory (auto-memory index)

These live in `C:\Users\admin\.claude\projects\d--mtcstudio\memory\` and apply across sessions:
- `mtc-companion-android-app.md` — sister app MTCCompanion, broken `JAVA_HOME`, must build via Android Studio's bundled JBR (`D:\Program Files\Android\Android Studio\jbr`) — same JBR was reused to compile WDS.
- `companion-session-log-appmd.md` — points to `D:\mtcstudio\app.md` as the session log to read before further mobile-app work; notes empty-`draftItems` and heartbeat-vs-incoming-call gotchas from that earlier project.
- `centralized-sms-service.md` — same "single source of truth, centrally configured" pattern this session followed for alert sounds (`AlertPlayer` pulling from MTCStudio's `receipt_config` instead of bundling local assets).
- `business-day-cash-closing.md`, `scheduled-draft-orders-table.md` — background on `pos_till_sessions`/`pos_scheduled_orders` schema referenced while building the scheduled/draft order flow and business-hours-bounded delivery time.

## Build status

Not yet compiled/verified in this later revision — user explicitly said **"DO NOT COMPILE OR BUILD I WILL DO THAT"**, so all changes since then are unverified by a build. An earlier revision (before the redesign) did pass `./gradlew :app:compileDebugKotlin` successfully using Android Studio's bundled JBR (`D:\Program Files\Android\Android Studio\jbr`) as `JAVA_HOME`, gradle wrapper jar copied over from the sibling MTCCompanion project since it wasn't generated yet.
