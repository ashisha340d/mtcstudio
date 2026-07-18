# IMPLEMENTATION PROMPT — Add "Order Terminal" feature to the EXISTING MTC Companion app

> Paste everything below into the **Gemini (Flash/Pro) agent inside Android Studio**. The agent is already working in the existing **MTCCompanion** codebase and has full file access. This is an **EXTENSION**, not a new project.

---

## 0. ROLE, TARGET & OUTPUT CONTRACT

You are a senior Android engineer working **inside the existing Android Studio project `MTCCompanion`** (package **`com.mtc.companion`**). You have the whole codebase open.

**Your task:** ADD a *Take Away / Delivery order-entry* feature to this existing app, **reusing its existing authentication, its existing Room cache, its existing sync engine, its existing Retrofit client, its existing theme, and its existing navigation**. Do **not** scaffold a new project. Do **not** duplicate infrastructure that already exists.

**Hard rules:**
- **Read the existing code first**, then extend it. Match the existing style, package layout, naming, and DI patterns exactly (minimal-diff philosophy).
- **Preserve ALL existing functionality** — the incoming-call caller popup, WhatsApp/Mero-Kinmel OCR import, and the SMS Gateway WebSocket must keep working untouched. Do not rename or delete existing classes.
- **Reuse, don’t recreate.** The menu/variant/category/customer data is **already synced into Room** by the existing engine. The auth/session is **already implemented**. Only add what is genuinely new (order screens, cart, order API calls, an offline order queue).
- For every file you **create**, output its full path + full contents. For every file you **modify**, output the exact edit (the changed function/block) — do not reprint whole unchanged files. **No placeholders, no pseudocode, no TODOs.** Everything compiles.
- Do not add dependencies beyond what §2 lists. Keep `minSdk 26 / compileSdk 36 / targetSdk 36`.

---

## 1. WHAT THIS FEATURE IS

A **remote Take Away / Delivery order-entry terminal** living inside MTC Companion. Staff open the app, tap **Place Order**, pick/create a customer, choose Take Away or Delivery, browse the menu, build a cart, and send. The order is created **inside the existing MTC Studio POS instantly** (appears on the POS/KDS exactly as if typed there).

**Out of scope (do NOT build):** payments, settlement, cash/till, inventory, reports, manager functions, dine-in tables. The POS server is the single source of truth. **Only Admin logs in** (any PIN the server accepts — do not gate by role).

---

## 2. WHAT ALREADY EXISTS (reuse these — do not rebuild)

The project already contains (inspect them before coding):

- **Auth / session** — `com.mtc.companion.core.security.EncryptedPrefsManager` holds `KEY_SESSION_ID`, `KEY_SERVER_URL` (default `http://100.97.170.28`), `KEY_DEVICE_ID`, `KEY_USER_NAME`, `KEY_PIN`. Login/pair already implemented via `data.remote.MobileApiService` (`api/mobile/login`, `api/mobile/pair`). The user is already logged in when they reach the main screen.
- **Retrofit + auth** — `core.di.AppModule` provides the `OkHttpClient` whose interceptor **injects `x-session-id` and rewrites the base host from `KEY_SERVER_URL`**, and provides the `MobileApiService` (Retrofit). **Add your new endpoints to `MobileApiService`** so they inherit this auth automatically. Do not create a second Retrofit/client.
- **Local cache (Room)** — `data.local.AppDatabase` (currently **version 3**) already stores the full menu + customers, populated by the sync engine:
  - Entities: `CategoryEntity(id,name,slug,sortOrder,status,icon)`, `ProductEntity(id,categoryId,name,shortDescription,posPrice,prepTimeMinutes,isFastMoving,posActive,customerVisible,badge,enableVariantImage,status,sortOrder)`, `VariantEntity(id,productId,name,sku,sellingPrice,unit,status,sortOrder,imageId,imageUrl)`, `ModifierGroupEntity`, `ModifierEntity(id,groupId,name,price,sortOrder,isActive)`, `ModifierAssignmentEntity(productId,modifierId)`, `ProductImageEntity`, `ImageManifestEntity(filename,size,url,localPath)`, `CustomerEntity(phone,name,phone2,address,birthday,email,loyaltyPoints,rewardsTier,discount,status,updatedAt)`, `AddressEntity(id,phone,label,address,isDefault,createdAt)`, `SettingEntity`.
  - DAOs: `MenuDao` (has `getProduct(id)`, `modifiersForProduct(productId)`, `primaryImagePath(productId)`, `productCountFlow()`), `CustomerDao` (`getByPhone`, `countFlow`), `ImageManifestDao`, `SettingDao`, plus `SmsDao`, `ImportDao`, etc.
  - `core.di.DatabaseModule` provides every DAO.
- **Single Sync already exists** — `data.repo.CompanionRepository.syncMetadata()` + `downloadImages()`, driven by `data.sync.SyncScheduler.syncNow(force=true)` and the Home screen’s existing **“Sync Only” / “Wipe & Fetch”** buttons. This is the “single sync makes everything syncable” requirement — **already done**. Your feature just **reads Room**; do not add a second sync path. (If the cache is empty when the user taps Place Order, trigger the existing `SyncScheduler.syncNow(true)` and show the existing progress.)
- **Menu images** — already downloaded to local files; `MenuDao.primaryImagePath(productId)` returns the absolute local path (or null). Load item images from that local `File` (see §2a).
- **Navigation** — `MainActivity` uses a manual back-stack with a top-level `enum Screen { HOME, SETTINGS, WHATSAPP, PHONE, IGNORE }` + `BackHandler`. `ui.feature.main.MainScreen` is Home (uses `HomeViewModel`). **Integrate the new screens into this same nav** (extend the enum + `when` block) — do not introduce Navigation-Compose.
- **Theme** — `ui.theme.MTCCompanionTheme`, `ui.theme.Color.kt` (`MtcBlue`, `MtcBlueLight`, `MtcOrange`, `MtcOrangeLight`). Reuse; supports light/dark already.
- **Stack in place:** Kotlin 2.x, Compose (BOM), Material 3, Hilt, Room (+ksp), Retrofit+OkHttp+Gson, WorkManager, `hilt-navigation-compose` (so `hiltViewModel()` works), coroutines, StateFlow.

### 2a. ONLY new dependency allowed
Add **Coil Compose** for menu images: `io.coil-kt:coil-compose` (pin a recent stable version in `gradle/libs.versions.toml` + `app/build.gradle.kts`). Load images from the **local file path** returned by `MenuDao.primaryImagePath(productId)` (e.g. `AsyncImage(model = File(path), …)`) so browsing is instant and offline. Fallback to a placeholder vector when null. Do not fetch images over the network on the hot path.

---

## 3. SERVER API — REAL CONTRACT (authoritative; add the order calls to `MobileApiService`)

**Base URL:** taken from `KEY_SERVER_URL` (default `http://100.97.170.28`) — the existing interceptor handles host + `x-session-id`. Cleartext + internet are already permitted in the manifest. Send raw phone digits; the server normalizes (strips spaces/dashes, `+977`, leading zeros).

### 3.1 Already implemented (do not re-add): `POST /api/mobile/login`, `/api/mobile/pair`. Session in `KEY_SESSION_ID`.

### 3.2 Already synced into Room (do not re-add sync): `GET /api/companion/sync/menu?version=`, `/sync/customers?since=`, `/sync/images`, `/settings`. Menu bundle shape (for reference — already mapped into the entities above):
```json
{ "changed": true, "version": "<md5>",
  "categories":[{"id":1,"name":"Burgers","slug":"burgers","sort_order":0,"status":"active","icon":null}],
  "products":[{"id":10,"category_id":1,"name":"Cheese Burger","short_description":"…","pos_price":350.0,"prep_time_minutes":12,"is_fast_moving":1,"pos_active":1,"customer_visible":1,"badge":null,"enable_variant_image":0,"status":"active","sort_order":0}],
  "variants":[{"id":100,"product_id":10,"name":"Regular","sku":"CB-R","selling_price":350.0,"unit":"pc","status":"active","sort_order":0,"image_id":null,"image_url":null}],
  "modifierGroups":[{"id":1,"name":"Add-ons","sort_order":0}],
  "modifiers":[{"id":5,"group_id":1,"name":"Extra Cheese","price":50.0,"sort_order":0,"is_active":1}],
  "assignments":[{"id":1,"product_id":10,"modifier_id":5}],
  "images":[{"product_id":10,"filename":"abc123.webp","is_primary":1,"sort_order":0}] }
```

### 3.3 Customers — ADD to `MobileApiService` (prefix `/api/pos`, auth via existing header)
- **GET `/api/pos/customers/lookup?phone=<digits>`** → `{ "found": true, "customer": { "id","name","phone","address","notes", … } }` or `{ "found": false }`
- **POST `/api/pos/customers`** — body `{ "name", "phone", "address"?, "notes"? }` → `201 { "id","name","phone","address","notes", … }` (upserts by phone; `name`+`phone` required)

> **Primary customer search = local Room** (`CustomerDao`, instant/offline). Use `/lookup` only as a live confirmation, and `POST /api/pos/customers` to create when not found.

### 3.4 Create order + fire to kitchen — ADD to `MobileApiService` (prefix `/api/pos`, auth header **and an OPEN business day**, see §3.5)

**Step 1 — POST `/api/pos/orders`** (create order shell + draft cart):
```json
{ "order_type":"TAKEAWAY", "customer_id":42, "customer_name":"Ram", "customer_phone":"9812345678",
  "customer_address":"Baneshwor…", "order_notes":"no onions", "status":"OPEN",
  "draft_items":[ {"product_id":10,"variant_id":100,"product_name":"Cheese Burger (Regular)","quantity":2,"unit_price":350.0,"notes":"extra ketchup"} ] }
```
→ `201 { "id":1234, "order_type":"TAKEAWAY", "status":"OPEN", … }` — **`id` is the Order Number.** `order_type` ∈ {`TAKEAWAY`,`DELIVERY`}. `customer_address` only for DELIVERY (else null).

**Step 2 — POST `/api/pos/kots`** (send those items to the kitchen — this makes it a real fired order on the KDS):
```json
{ "order_id":1234,
  "items":[ {"product_id":10,"variant_id":100,"product_name":"Cheese Burger (Regular)","quantity":2,"unit_price":350.0,"notes":"extra ketchup","prep_time_minutes":12,"is_home_pack":false,"discount_amount":0,"discount_type":null} ] }
```
→ `201 { "id":<kotId>, "order_id":1234, "kot_number":1, "items":[…] }`

**Finalize = Step 1 then Step 2, both must succeed** and are one user action. If Step 2 fails after Step 1 succeeded, **keep the returned order `id` and retry Step 2 only** — never recreate the order (idempotency). Order Number shown to the user = `id` from Step 1.

KOT item fields (per cart line): `product_id`(Int), `variant_id`(Int?), `product_name`(String — product name + " (variant)" when a variant is picked), `quantity`(Int≥1), `unit_price`(Double — variant `sellingPrice` if chosen else product `posPrice`), `notes`(String?), `prep_time_minutes`(Int — product’s value, default 10), `is_home_pack`(Bool=false), `discount_amount`(Double=0), `discount_type`(String? in `MANUAL|PROMO|COMPLIMENTARY|EMPLOYEE` or null; default null).

### 3.5 Business-day guard (critical)
`/api/pos/orders` and `/api/pos/kots` require an **OPEN POS business day** (`requireOpenDay`). If the day is closed they return a non-2xx (typically **409/403**) with `{ "error": "…" }`. The app **cannot** open the day. Handle it: show a clear, non-blocking message *“POS business day is not open — ask the POS to open the day; the order will send automatically.”* and **keep the order in the offline queue** to auto-retry (§8).

### 3.6 Errors
Bodies are `{ "error": "<msg>" }` with 4xx/5xx. `401` = session invalid → clear `KEY_SESSION_ID` and route to the existing login. Network failure → offline queue. Everything else → snackbar with the server `error` text.

---

## 4. LOCAL DATA — reuse existing Room; add ONLY the order queue

**Reuse** the existing `AppDatabase` and entities/DAOs for all menu + customer reads. **Add** to the existing DB (bump `AppDatabase` version **3 → 4**; the project already uses `fallbackToDestructiveMigration`, so no manual migration needed):

- New entity `QueuedOrderEntity` (table `queued_orders`): `localId` PK autoGen, `payloadJson` (order body), `kotPayloadJson` (kot body), `createdOrderId` Long? , `status` (`PENDING|CREATED|SENT|FAILED`), `attempts` Int, `lastError` String?, `createdAt` Long.
- New DAO `QueuedOrderDao`: insert, get all `PENDING`/`FAILED`, update, delete-by-id, `Flow<Int>` count of unsent (for a Dashboard badge). Register it in `AppDatabase` + provide it in `DatabaseModule`.

**Add query methods** to the existing DAOs (do not create parallel tables):
- `MenuDao`: `fun categories(): Flow<List<CategoryEntity>>` = `SELECT * FROM categories WHERE status IS NULL OR status='active' ORDER BY sortOrder, id`; `fun productsByCategory(categoryId: Int): Flow<List<ProductEntity>>` = `… WHERE categoryId=:categoryId AND posActive=1 ORDER BY sortOrder, id`; `suspend fun variantsForProduct(productId: Int): List<VariantEntity>` = `… WHERE productId=:productId ORDER BY sortOrder, id`. (`modifiersForProduct`, `getProduct`, `primaryImagePath` already exist.)
- `CustomerDao`: `fun search(q: String): Flow<List<CustomerEntity>>` = `SELECT * FROM customers WHERE name LIKE :q OR phone LIKE :q ORDER BY name LIMIT 50` (caller passes `"%term%"`). Add an index on `name` if not present.

Customer search must be **local and instant** (<100 ms over thousands of rows): Room `Flow` + `LIKE`, input debounced ~120 ms. No network on the search hot path.

---

## 5. FLOW & SCREENS (new `com.mtc.companion.ui.feature.order` package)

Add these as new `Screen` enum values in `MainActivity` and route them in the existing `when(backStack.last())` block; push/pop with the existing helpers.

1. **Home / Dashboard = existing `MainScreen`** — ADD a prominent primary **“＋ Place Order”** button (thumb-reachable, e.g. large FAB or bottom button) that navigates to the Customer screen and starts a fresh order session. Also show a small **queued-orders** indicator (count from `QueuedOrderDao`) when > 0. Keep every existing MainScreen element (status chips, SMS Gateway card, Sync card, Settings, Tools, Logout).
2. **Customer** — instant local search by **phone or name** (debounced, `CustomerDao.search`). Large result rows (name + phone + default address). If none → big **“＋ Add Customer”** → inline form (name, phone, address?) → `POST /api/pos/customers` → continue. Selecting/creating advances to Order Type.
3. **Order Type** — two large cards: **Take Away** / **Delivery**. Delivery reveals an **Address** field (prefill the customer’s default `AddressEntity`; editable). Continue → Category.
4. **Category** — grid of large, touch-friendly cards (name + optional image/first product image) from `MenuDao.categories()`. Tap → **animated horizontal slide** into that category’s items.
5. **Menu Items** (per category) — item cards: **image (Coil from local file), name, price, fast-moving/favorite badge**. Tap:
   - No variants & no modifiers → **add 1 to cart directly**, brief confirmation, then **auto-slide back to Category**.
   - Has variants/modifiers → **bottom sheet**: pick variant (radio), pick modifiers, quantity (±), per-line note → Add → cart → auto-return to Category.
6. **Cart** (persistent cart FAB/badge with item count + subtotal): editable quantities (±), remove, per-line note, running **subtotal**. → Review.
7. **Review** — customer, line items, unit prices, subtotal/total, order type, delivery address (if delivery), order + per-line notes, **estimated prep time** (max line `prepTimeMinutes`). → **Finalize / Send**.
8. **Send** — Step 1 then Step 2 (§3.4). Progress indicator. Success → Success screen with **Order #id**. Failure → route by §3.6 (offline queue on network/day-closed; snackbar otherwise).
9. **Success** — large check animation, **“Order #1234 Created”**, buttons **Create Another Order** (new session → Customer) and **Home**.

Back-navigation via the existing `BackHandler`/back-stack must be sane at every step.

---

## 6. UX LAWS (non-negotiable)
Speed first. Minimal taps. Large thumb targets (≥48 dp; primary ≥56 dp, bottom-anchored, one-handed). 60 FPS transitions (category↔items horizontal slide via `AnimatedContent`, add-to-cart scale, success check). Instant transitions on cached data (no blocking spinners). No unnecessary dialogs — prefer inline + bottom sheets. After adding an item, always bounce back to Category so the next add is ~2 taps. Local menu load + local search only.

---

## 7. ARCHITECTURE (match existing patterns)
- New package `com.mtc.companion.ui.feature.order` (Composables + one `@HiltViewModel` per screen exposing `StateFlow<UiState>`; stateless Composables collect state). New `com.mtc.companion.data.order` for `OrderRepository`, DTOs, and the queue drain.
- **Cart** = a `@Singleton` Hilt-injected holder exposing the in-progress order (customer, type, address, lines, notes) as `StateFlow`; cleared after a successful send or explicit cancel.
- **`OrderRepository`** injects the existing `MobileApiService`, the existing DAOs, `QueuedOrderDao`, and `EncryptedPrefsManager`. It performs Step 1 + Step 2, classifies failures (network / http / dayClosed(409|403) / auth(401)) with a sealed result, and owns the offline queue.
- Reuse the existing DI (`AppModule`, `DatabaseModule`) — add `@Provides` for the new DAO only. Reuse the existing `hiltViewModel()` setup.

---

## 8. OFFLINE QUEUE
On send failure due to no network **or** closed day: persist to `queued_orders` (order + kot payloads) as `PENDING`, tell the user *“Order queued — will send automatically.”* A WorkManager unique periodic worker (network-constrained) **plus** an immediate attempt on connectivity regained (`ConnectivityManager` callback — you may reuse the existing `core.network.ConnectionTracker`) drains it:
- Per `PENDING`: if `createdOrderId` null → Step 1 → store id → `CREATED`; then Step 2 → `SENT` (prune). If `createdOrderId` set → run Step 2 only. **Never recreate an order that already has `createdOrderId`.**
- Backoff on repeated failure; keep `attempts`/`lastError`; day-closed stays queued (not a hard error). Keep the Dashboard queue badge live.

---

## 9. PERFORMANCE
Menu + search read from Room instantly (thousands of products/customers, no jank): `LazyVerticalGrid`/`LazyColumn` with stable keys, `derivedStateOf`, `@Immutable`/`@Stable` UI models, Coil memory+disk cache with correct sizing, hoisted state to avoid recomposition storms. Category transitions 60 FPS. Search <100 ms.

---

## 10. DESIGN
Reuse `MTCCompanionTheme` (MtcBlue/MtcOrange), full light+dark already supported. Modern, premium, restaurant-grade Material 3: rounded cards, soft elevation, generous spacing, tactile press states, meaningful motion (shared-axis/slide category↔items, scale+fade add-to-cart, pure-Compose success check). Responsive + **tablet** (wider category grid; optional two-pane category+items on large screens/landscape) + **landscape**. Ship any new icons as vector drawables (no external icon assets).

---

## 11. THINGS ALREADY CONFIGURED (do not redo)
`INTERNET` + `ACCESS_NETWORK_STATE`, `usesCleartextTraffic=true` + `network_security_config.xml`, Hilt `Application`, WorkManager-Hilt, session interceptor, ProGuard keeps — all present. Only extend the manifest if you add a new WorkManager worker that needs it (usually not).

---

## 12. DELIVERABLES (add/modify only — preserve everything else)

**Create:**
- `data/order/OrderDtos.kt` (order/kot/customer request+response DTOs), `data/order/OrderRepository.kt`, `data/order/OrderQueueWorker.kt`.
- `data/local/QueuedOrderEntity.kt` (or add to existing `Entities.kt`), `QueuedOrderDao` (or add to `Daos.kt`).
- `domain/order/Cart.kt` (+ cart line + order-session models).
- `ui/feature/order/`: `CustomerScreen`+VM, `OrderTypeScreen`+VM, `CategoryScreen`+VM, `MenuItemsScreen`+VM, `ItemOptionsSheet`, `CartScreen`+VM, `ReviewScreen`+VM, `SendResultScreen`, plus a shared `OrderFlowViewModel` if useful.

**Modify (show only the edits):**
- `data/remote/MobileApiService.kt` — add the 4 endpoints in §3.3–3.4 + their DTO signatures.
- `data/local/AppDatabase.kt` — register `QueuedOrderEntity` + DAO, bump version 3→4.
- `data/local/Daos.kt` — add the `MenuDao`/`CustomerDao` query methods in §4 + the `QueuedOrderDao`.
- `core/di/DatabaseModule.kt` — provide `QueuedOrderDao`.
- `MainActivity.kt` — extend `enum Screen` + the `when` router with the new screens.
- `ui/feature/main/MainScreen.kt` — add the **“＋ Place Order”** button + queued-orders indicator.
- `gradle/libs.versions.toml` + `app/build.gradle.kts` — add Coil.

Everything compiles; existing caller/OCR/SMS features remain intact.

---

### APPENDIX — cart line → API field map

| Cart line | Source (existing Room) | order `draft_items` | kot `items` |
|---|---|---|---|
| product_id | `ProductEntity.id` | ✓ | ✓ |
| variant_id | chosen `VariantEntity.id` / null | ✓ | ✓ |
| product_name | `ProductEntity.name` (+ " (" + variant.name + ")") | ✓ | ✓ |
| quantity | user | ✓ | ✓ |
| unit_price | `VariantEntity.sellingPrice` ?: `ProductEntity.posPrice` | ✓ | ✓ |
| notes | per-line note (append chosen modifier names) | ✓ | ✓ |
| prep_time_minutes | `ProductEntity.prepTimeMinutes` | — | ✓ |
| is_home_pack | false | — | ✓ |
| discount_amount / discount_type | 0 / null | — | ✓ |

`order_type` ∈ {`TAKEAWAY`,`DELIVERY`}; `status`=`"OPEN"`; Order Number = order `id` from Step 1.

> Modifiers: MTC’s KOT API takes **flat line items** (no nested modifier array). Represent chosen modifiers by (a) adding their `price` into the line `unit_price` if they should be billed, and (b) appending their names to the line `notes` so the kitchen sees them.
