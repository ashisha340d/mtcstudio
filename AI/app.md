# MTC Studio + MTC Companion — Session Log (compacted)

Working session log covering server (`D:\mtcstudio\server`), admin client (`D:\mtcstudio\client`), and Android companion app (`D:\MTCCompanion`).

---

## 1. Companion app — Ping fake-call bug (FIXED)

**Problem:** "Ping" button (and app launch) called `POST /api/mobile/incoming-call` with dummy number 9999999999 → inserted `pos_call_events` row + emitted live POS popup → staff saw fake "new order"/incoming call.

**Fix (client only, no server change):**
- `HomeViewModel.refreshPing()` now calls `POST /api/mobile/heartbeat` (side-effect-free) and measures latency.
- `MainScreen.kt`: shows "Connected to Mobile" / "Disconnected" instead of ping ms.

## 2. Companion app — double order lines on POS (FIXED)

**Problem:** every submitted order showed each item twice on POS: once as draft, once as fired KOT.

**Cause:** `OrderRepository.submitOrder()` populated BOTH `pos_orders.draft_items` (via createOrder) AND fired the same items as a KOT. POS never reconciles the two stores (intentional server design for partial-KOT flows).

**Fix:** companion always sends `draftItems = emptyList()` — items live only on the KOT.

## 3. Companion app — category + variant images (DONE)

**Server** (`routes/pos/companion.js`):
- `/sync/menu`: categories SELECT now includes `image_url`; response adds `image_file` = webp basename stem (`toWebp()`).
- `/sync/images`: manifest now includes category images (was products + variants only). Manifest only lists files that actually exist in `uploads/forapp/`; URL = `/uploads/forapp/<name>.webp`.

**Android client:**
- `CategoryEntity.imageFile`, `VariantEntity.imageFile` added; Room `@Database version = 5` (destructive migration configured).
- `CategorySyncDto.image_file`; `CompanionRepository.toWebpStem()` mirrors server `toWebp()`.
- `MenuDao.categoryImagePath()` / `variantImagePath()` — join `image_manifest.localPath`.
- `CategoryScreen`: `GridCells.Adaptive(150.dp)`, card `aspectRatio(1f)`, Coil `AsyncImage(File(path))` + gradient name overlay; letter-avatar fallback when no image.
- `MenuItemsScreen`: `GridCells.Adaptive(160.dp)`, variant rows show 36dp thumbnails.

**Image data flow:** `categories.image_url` (MySQL, admin panel) → export to `uploads/forapp/<basename>.webp` → `/sync/menu` (`image_file`) + `/sync/images` (manifest) → `ImageCacheManager` downloads to `filesDir/menu_images/` → Room join → Coil renders local file.

**Recommended sizes:** category tile 512×512 webp (square, cropped by `aspectRatio(1f)`); product card ~800×600 4:3 (120dp fixed height, crop); variant thumb 256×256.

## 4. Server — media upload compression + auto-export (DONE)

- `services/mediaService.js`: `compressToWebp()` — every uploaded jpg/png/webp re-encoded webp quality 82 in place (svg/gif skipped), DB row stores webp filename/mimetype/size.
- `controllers/mediaController.js`: `triggerExport()` = fire-and-forget `syncMedia()` after every media CRUD (upload/update/remove/bulk-delete). `syncMedia()` pushes to remote website endpoint (`PUBLIC_SITE_URL/api/sync/images`), deletes remote on delete.

## 5. Client — FoodMenu > Category card view (DONE)

`CategoriesView.jsx`: Table/Cards toggle (`fm_cat_view` in localStorage), reuses `.fm-view-seg` styling. Card grid (`.cat-card-*` in FoodMenu.css, `auto-fill minmax(170px,1fr)`, square image, inline name/status edit, Save/Delete) shares the same drag-reorder handlers as table view — order persists via `categoriesApi.reorder`.

## 6. Client — Media library revamp (DONE)

`pages/Media/Media.jsx` fully rewritten, **all inline CSS** (Media.css deleted). Reason: `FoodMenu.css` `.btn.btn-delete { color:#c0392b }` leaked globally → dark-red text on red delete button. Inline styles immune.

- Dark modern card grid, hover lift, section pill tags.
- Real pagination via `/media/list` (page/perPage/totalPages), page sizes 12/24/48/96 (state in sessionStorage `mediaLibraryState`).
- Single-row sticky toolbar (`position:sticky top:0`): search (330px) → Prev [x/y] Next + page size → section select → Upload → Sync to Website → Make For App → selected/delete → count → msg. Overflow-x scrolls.
- Cards flex-column height:100%; Edit/Delete row pinned bottom via `marginTop:'auto'`.
- Delete buttons: solid `#dc2626` bg + white text.
- `MediaPicker.jsx` (shared modal) is marked DO-NOT-EDIT — untouched.

## 7. Server+Client — "Make For App" button (DONE)

- `POST /media/make-forapp` (`mediaService.makeForApp()`): wipes `uploads/forapp/`, exports ONLY product (menu) primary images + category images → webp quality 80, resize max 512×512 `fit:inside withoutEnlargement`, basename stem preserved.
- Media page button 📱 Make For App (confirm dialog, reports exported/missing/failed).
- Flow: button → forapp rebuilt → companion app's next image sync pulls fresh files.

## 8. Companion app — order #2 never submitted (FIXED)

**Problem:** after completing an order, the next order jumped straight to success without reaching POS.

**Cause:** custom backStack in MainActivity means `hiltViewModel()` is activity-scoped — `ReviewViewModel._result` kept order #1's `Success`; `LaunchedEffect(result)` fired instantly on entering Review for order #2.

**Fix:** `consumeResult()` added, called after navigation in `ReviewScreen`.

## 9. Companion app — Review screen customer prefill (DONE)

- `Cart.updateCustomerInfo(name, phone)` — edits in place, preserves loyalty/address.
- `ReviewViewModel.prefillFromCallLog()` — if no customer phone, fills from latest call-log entry; `setCustomerName/`setCustomerPhone` for user edits.
- `ReviewScreen`: prefill LaunchedEffect added. Order notes (message) field already existed.

## 10. Call monitoring — why some calls missed (EXPLAINED)

4 in-app gates in `CompanionService.handleIncomingRing()` (any one silently skips): ignore list, "Monitor inbound" off, outside business hours, 8s same-number dedup (dedup is correct — merges duplicate reports from screening service + PHONE_STATE receiver).

2 environment causes (most likely for random gaps): Call Screening role denied (fallback PHONE_STATE path needs READ_CALL_LOG for number), and OEM battery optimization killing the foreground service → fix: Settings → Apps → MTC Companion → Battery → Unrestricted (+ Autostart on Xiaomi).

**WhatsApp calls:** invisible to telephony stack; monitoring them requires extending `WhatsAppNotificationListener` (CATEGORY_CALL notifications) — NOT yet implemented.

## 11. Companion app — Business Hours moved to main Settings (DONE)

`SettingsScreen` now: WhatsApp Settings card → Phone Settings card → divider → Business Hours (NST) section (enable toggle + Open/Close TimePicker, same prefs keys `KEY_BIZ_HOURS_ON`/`KEY_OPEN_TIME`/`KEY_CLOSE_TIME`) → divider → Wipe & Fetch. Removed from `WhatsAppSettingsScreen`. `SettingsScreen` gained `prefs: EncryptedPrefsManager` param (MainActivity passes `prefsManager`).

## 12. Companion app — Home dashboard + bottom nav + Open Orders (DONE 2026-07-19)

**Server** (`routes/pos/mobile.js`, needs restart):
- `GET /api/mobile/dashboard` — today's (Nepal) open/closed counts, sales split (fonePay = QR+CARD, cash netted of change, ledger; incl. cake payments), top items, hot categories each with nested items (drill-down data).
- `GET /api/mobile/open-orders` — OPEN/SAVED orders + table/customer, KOT items, stage (PENDING/PREPARING/READY/SERVED), total.

**Android** (needs APK rebuild):
- `CompanionBottomBar` (floating pill, Home/Orders/Settings) in `MainComponents.kt` + `HomeTab` enum; wired in `MainActivity` (new `Screen.ORDERS`), bar visible only on HOME/ORDERS.
- `MainScreen.kt` rewritten: compact status strip (pulse dot + Perms/Role/SMS chips), hero kept, Open/Closed tiles (Open taps to Orders tab), Sales Dashboard card (FonePay/Cash/Ledger + gold Total banner), Hot Categories LazyRow → ModalBottomSheet item drill-down, Top 5 items with rank badges. Database card + ToolItem row removed; Sync + Logout now top-bar icons. 60s dashboard poll.
- New `ui/feature/orders/OpenOrdersScreen.kt` (+ `OpenOrdersViewModel`): live order cards (stage chip, per-item status dots, time, total), 20s poll.
- DTOs in `ApiModels.kt` (`DashboardResponse`, `OpenOrdersResponse` etc.), endpoints in `MobileApiService.kt`, dashboard state in `HomeViewModel`.

## 13. Companion app — Orders v2, Calls tab, walk-in orders, Settings DB card (DONE 2026-07-19)

**Server** (`routes/pos/mobile.js` /open-orders, needs restart): today-only (Nepal bounds), `elapsedMin` (since order created), `servedInMin` (slowest item via `pos_kot_items.served_at` when stage SERVED).

**Android:**
- Orders tab: All Orders / Table Orders segmented filter; footer shows ordered time + "Waiting Xm" (red ≥30m) or "Served in Xm". Time parser fixed: server sends `"yyyy-MM-dd HH:mm:ss"` Nepal local (mysqlPool `dateStrings:true`), not ISO.
- New Calls tab (`ui/feature/calls/CallLogScreen.kt`): device call log (top 40, deduped), matched against Room customers (gold border + "Customer" chip), call-type icons, + button → `cart.requestOrderLaunch(customer)` → existing order flow with customer prefilled.
- Customer now optional end-to-end: CheckoutScreen continue button no longer requires customer; `OrderRepository.submitOrder` defaults name "Walk-in", null phone; `CreateOrderRequest.customerPhone` nullable.
- Settings: Database card restored (menu/photos/customers counts + last sync + Sync Now); Wipe & Fetch now shows staged progress modal (wipe → fetch data → image download x/y with progress bar, Done gated).
- Bottom nav now 4 tabs: Home / Orders / Calls / Settings.

**Debug note:** hot-categories "not showing" was just un-restarted node — dashboard SQL verified live against DB, categories return correctly.

## 14. Companion app — Orders v3, skins, order SMS (DONE 2026-07-19)

**Server** (`/open-orders` in `routes/pos/mobile.js`, restart): unified feed — POS orders (draft-only/no-KOT hidden), today's `pos_scheduled_orders` (PENDING, `timeLabel:"Fires HH:mm"`), today's `cake_orders` deliveries (`stage:'CAKE'`, `timeLabel:"Delivery <time>"`). Each row: `kind` (POS|SCHEDULED|CAKE) + `customerPhone`.

**Android:**
- Orders tabs renamed: **Orders** (delivery/takeaway/scheduled/cake, non-table) / **Tables** (table name big gold first, order # smaller). New stage chips SCHEDULED (purple) / CAKE (pink). `Modifier.animateItem()` on cards.
- **Skins**: `Color.kt` rebuilt — `SkinPalette` + `AppSkins` (Midnight Gold / Deep Ocean / Emerald Night); legacy names (`PremiumBlack`, `MtcGold`…) are now getters over `currentSkin` (mutableStateOf) so whole app restyles live. Picker in Settings (Appearance), persisted `app_skin` pref, applied in MainActivity.onCreate.
- **Order SMS** (`data/sms/OrderSms.kt`): valid Nepali mobile = `^9[678]\d{8}$` after +977/0 strip. Settings "Order SMS": auto-SMS toggle (`order_auto_sms`) + QR payment link (`order_sms_qr_link`). ReviewViewModel sends confirmation SMS (order #, total, QR link) on Success. Order cards (PREPARING/READY + valid phone) show "Send SMS" button → status SMS, turns green "SMS Sent".
- Variant bottom sheet (menu → item options): `skipPartiallyExpanded = true` so Add to Cart visible immediately.
- SettingsScreen now scrollable (verticalScroll; weight-spacer removed).

## 15. Foodmandu Restro order sync (DONE 2026-11-16)

- Direct database access is unavailable: `com.foodmandu.restroApp` is release/non-debuggable, the phone is unrooted, and no order content provider is exported.
- `FoodmanduAccessibilityService` reads Flutter accessibility text, dedupes by order number, and queues raw text in `wa_imports` (Room v8). Real notifications drive Dashboard → Today's Orders → New → refresh, with retries until the order appears. Clean imports become live POS orders by default; only then does the service click Acknowledge on Foodmandu.
- `POST /api/companion/foodmandu-import` accepts the text. `foodmanduParser` extracts order number, items, quantities, prices, subtotal and rider; the existing resolver creates FM/FM-REVIEW orders without OCR. `FOODMANDU_IMPORT_MODE=DRAFT` disables direct conversion.
- Enable Settings → WhatsApp Settings → Foodmandu Restro → Enable Foodmandu Access. Notification access must remain enabled. The separate demo switch imports manually opened old orders without acknowledging them.
- Server restart and Android APK rebuild/install are required. Live build/deploy remains user-owned as noted below.

---

## Pending / notes

- App is LIVE — user said do not build/deploy from here; user rebuilds APK + restarts server themselves.
- Node server restart needed for: sharp compression, make-forapp route, companion.js image routes.
- Client rebuild needed for: Media page, CategoriesView cards, Make For App button.
- WhatsApp call monitoring: designed (notification-listener approach) but not implemented.
- forapp folder previously populated by unknown external process; now owned by Make For App button.
