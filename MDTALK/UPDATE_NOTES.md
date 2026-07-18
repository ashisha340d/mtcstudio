# MTC Companion — Update Notes

Modern home + settings overhaul. Reactive, offline-first, no new dependencies.

## Login
- **Server URL** default is now `http://100.97.170.28` (Tailscale). Persisted in encrypted prefs.
- **PIN** is now **saved state** — restored on next launch, re-saved on successful pair. Default `1234`.
- "Reset to Default (Testing)" restores the new default URL.

Keys: `EncryptedPrefsManager.KEY_SERVER_URL`, `KEY_PIN`.

## Home screen (`MainScreen`)
Rebuilt with Material3 cards, live stats, snackbar feedback.

### Sync Server Data card
- Live **stat tiles** (auto-refresh via Room `Flow`, no manual reload):
  - 🍔 **Menu** — product count
  - 🖼️ **Photos** — `cached / total` image count
  - 👥 **Customers** — customer count
- **Last customer sync** timestamp.
- **Sync Only** — incremental pull + image download (`force=true`).
- **Wipe & Fetch** — confirm dialog → clears local menu/photo/customer data + cached image files + sync cursors, then full re-fetch. Automation history (`wa_imports` / `import_logs`) is kept.
- Progress spinner while syncing; "Data refreshed" snackbar on completion.
- **In-place refresh** (no app restart) — stats stream from the DB.

Backed by new `HomeViewModel` (Hilt) observing `WorkManager.getWorkInfosForUniqueWorkFlow("mtc_manual_sync")`.

## Settings (was "Automation Settings")
Hub screen with two sections:

### WhatsApp Settings
- Full previous automation settings: WhatsApp app mode, group/chat name, notification + media access, Monitor / Auto OCR / Auto Draft / Notify POS, Business Hours (NST).

### Phone Settings
- **Monitor Inbound** (default on) — gates incoming-call popup + POS reporting in `CompanionService`.
- **Monitor Outbound** (default off) — stored only; no server endpoint yet.
- **Forward Call Records** (default off) — stored only; no server endpoint yet.
- **Do Not Track Contacts** — the existing ignore-list screen, moved here.

Keys: `KEY_MONITOR_INBOUND`, `KEY_MONITOR_OUTBOUND`, `KEY_FWD_CALL_RECORDS`.

## Navigation
Manual back-stack (`Screen` enum + `BackHandler`) in `MainActivity` — HOME → SETTINGS → WHATSAPP / PHONE → IGNORE. No navigation-compose dependency added.

## SMS Gateway (real-time WebSocket)
Device acts as WebSocket **client** to the existing MTC Studio `/ws/sms` engine — no polling.

- **`SmsGatewayManager`** (`@Singleton`, `data/sms/`) — owns one persistent OkHttp WebSocket. Started/kept alive by the always-on `CompanionService` FGS (survives business hours; boot-start via existing `BootReceiver`).
- **Endpoint / auth** — derived from saved server URL: `ws(s)://<host>/ws/sms?token=<posSession>&deviceId=<id>` (matches the server's query-string auth; `http→ws`, `https→wss`). Sends a `device_info` frame on open: deviceId, deviceName, PIN, session token, Android version, app version, battery, signal.
- **Heartbeat** — OkHttp `pingInterval(30s)`; server ping/pong liveness honored.
- **Reconnect** — exponential backoff 2s→30s; `ConnectivityManager` default-network callback triggers immediate reconnect on network return (Wi-Fi / cellular / offline detected).
- **Commands in** — `send_sms` (SmsManager multipart send + delivery tracking), `cancel_sms`, `ping`→`pong`, `sync_customers`/`sync_settings`/`sync_contacts`→`SyncScheduler.syncNow()`.
- **Status out** — `sms_queued` → `sms_sending` → `sms_sent` → `sms_delivered`, or `sms_failed{error}` (server maps these to QUEUED/SENDING/SENT/DELIVERED/FAILED, retries per its policy). Multipart completes when all parts report.
- **Incoming SMS** — `SmsInboundReceiver` (manifest, `RECEIVE_SMS`) pushes `sms_received{phone,message,timestamp}` immediately.
- **Local storage** — reuses the current Room DB (v3): `sms_jobs` (jobs + per-status + `reported` flag) and `sms_inbound` (`synced` flag). Any unreported status / unsynced inbound is **replayed on reconnect**. Finished rows pruned after 7 days.
- **Business hours** — gateway stays connected at all times; the server owns business-hours gating for new-job creation, so the device executes every `send_sms` it receives (drains the queue after hours). No device-side business-hours block on sending.
- **Home screen** — new SMS Gateway status card (green/red dot, last event, active-job badge).
- **Permissions** — `SEND_SMS` + `RECEIVE_SMS` added (manifest + runtime request).

> Note: the WebSocket points at whatever server the device is paired to. Re-pair (logout → login) to `http://100.97.170.28` so the gateway reaches the live server.

## Files
- New: `ui/feature/main/HomeViewModel.kt`, `ui/feature/settings/{SettingsScreen,PhoneSettingsScreen,WhatsAppSettingsScreen}.kt`
- Removed: `ui/feature/automation/AutomationSettingsScreen.kt`
- Changed: `MainScreen`, `MainActivity`, `LoginViewModel`, `LoginScreen`, `EncryptedPrefsManager`, `CompanionRepository`, `Daos`, `ImageCacheManager`, `CompanionService`
