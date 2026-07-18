# Implementation status (2026-07-16)

Milestones 1–7 built and smoke-tested end to end against the live DB (test
rows cleaned up after). All routes live in `server/routes/pos/mobile.js`,
mounted at `/api/mobile` in `app.js`. Schema added to `pos/db.js`
(`pos_devices`, `pos_call_events`, `pos_customer_addresses`,
`pos_customer_notes`). Emit helpers added to `pos/socketServer.js`
(`emitIncomingCall/emitCallAnswered/emitCallEnded/emitMissedCall`).
`uploadCallRecording` added to `middleware/upload.js`. `authenticatePin`
extracted from `routes/pos/auth.js` and reused by `/api/mobile/login`.
`.env` has the 5 `MOBILE_*` vars.

**Bugs found and fixed during testing** (none of these patterns exist
elsewhere in the repo, so they weren't visible from reading the code alone):

- `UPDATE ... RETURNING *` is not valid on this MariaDB instance — only
  `INSERT ... RETURNING` works here. Every route that updated
  `pos_call_events`/`pos_devices` and expected the row back (`call-answered`,
  `call-ended`, `missed-call`, `upload-recording`, `pair`'s update branch) was
  rewritten to `UPDATE` via `dbRun` then a separate `SELECT` via `dbGet` —
  matching the pattern already used in `scheduled.js`.
- ISO datetime strings from the client (e.g. `"2026-07-16T12:30:05Z"`) fail
  MariaDB's `DATETIME` literal parser when passed straight through as a
  string parameter. Fixed by wrapping in `new Date(...)` before binding, so
  `mysql2` converts it to a `Date` object (which it formats correctly), not a
  raw string.

Milestone 8 (this end-to-end pass) is done. Not yet done: none — plan is
fully implemented. Remaining known gaps are the risks already listed below
(no rate limiting, `DEV_MODE` bypass inherited, phone normalization is
minimal).

Note: the spec below says `/login` returns `{ token, user }` — actual
implementation returns `{ sessionId, user }`, matching the field name
`POST /api/auth/pin` already uses (`auth.js:36`), not the originally drafted
name. Send `sessionId`'s value as the `x-session-id` header on every
subsequent request, same as POS terminals do.

---

# MTC Studio — Mobile API (MTC Companion)

Backend surface for the Android call-companion app. All routes reuse existing POS
infrastructure: `pos_sessions` auth, `pos/db.js` (MariaDB via `mysql2/promise`),
`pos/socketServer.js` Socket.IO broadcast. No new frameworks, no new DB pool,
no new websocket server.

Base path: `/api/mobile`. Gated by `MOBILE_API_ENABLED` (env) — when false, router
responds `503 { error: 'Mobile API disabled' }` on every route.

Auth: same PIN → session-token flow as POS terminals (`pos_users` / `pos_sessions`).
The Android device logs in like a POS terminal and sends `x-session-id` on every
subsequent request. There is no separate device-credential system.

---

## Auth

### POST /api/mobile/login
Body: `{ pin, deviceId }`
Same bcrypt-against-`pos_users` check as `POST /api/auth/pin` (shared helper,
see Files section). `deviceId` is stored as `pos_sessions.terminal_id`.

Response: `{ token, user: { id, name, employee_id, role } }`

### POST /api/mobile/logout
Header: `x-session-id`. Ends the session (`pos_sessions.ended_at`), same as
`POST /api/auth/logout`.

---

## Device lifecycle

### POST /api/mobile/pair
Header: `x-session-id`. Body: `{ deviceId, deviceName, restaurantId, appVersion, platform }`
Upserts `pos_devices` by `device_id`. Sets `paired_by_user_id` from session.

Response: `{ success: true, device }`

### POST /api/mobile/heartbeat
Header: `x-session-id`. Body: `{ deviceId, battery, wifi, network, appVersion }`
Updates `last_seen`, `battery`, `wifi`, `network`, `app_version` on `pos_devices`.

Response: `{ success: true }`

---

## Incoming call

### POST /api/mobile/incoming-call
Header: `x-session-id`. Body:
```json
{ "deviceId": "PHONE01", "phone": "9801234567", "timestamp": "2026-07-16T12:30:00Z" }
```

Process:
1. Normalize phone (strip spaces/`+977`/leading zeros — same normalization used
   nowhere yet in this repo, so a small local helper is added, not borrowed).
2. Look up **both** `pos_customers` and `customers` (CRM) by phone — per the
   decision to query and merge both tables.
3. Look up outstanding `cake_orders` (`balance_due > 0 AND status NOT IN
   ('DELIVERED','CANCELLED','REFUNDED')`) — same predicate already used in
   `routes/pos/cakeOrders.js:265`.
4. Look up last `pos_orders` row and count by `customer_phone`.
5. Look up `pos_customer_addresses` and `pos_customer_notes` by phone (new tables).
6. Insert a `pos_call_events` row (`status='INCOMING'`), returns `callId`.
7. Broadcast `incoming-call` to the `pos` room via `socketServer`.

Response:
```json
{
  "callId": 123,
  "customer": { "...pos_customers row, merged with customers row..." },
  "loyalty": { "loyalty_points": 0, "rewards_tier": "standard", "vip": false },
  "addresses": [ { "id": 1, "label": "Home", "address": "...", "is_default": true } ],
  "lastOrder": { "...pos_orders row or null..." },
  "orderCount": 4,
  "cakeBalance": 0,
  "notes": [ { "id": 1, "note": "...", "created_at": "..." } ]
}
```

## Call events

### POST /api/mobile/call-answered
Body: `{ callId, startTime }` → sets `status='ANSWERED'`, `start_time`.

### POST /api/mobile/call-ended
Body: `{ callId, endTime, duration }` → sets `status='ENDED'`, `end_time`, `duration_seconds`.

### POST /api/mobile/missed-call
Body: `{ callId }` (or `{ deviceId, phone }` if no answer ever happened, callId unknown)
→ sets `status='MISSED'`.

All three broadcast the matching event (`call-answered` / `call-ended` /
`missed-call`) to the `pos` room and write a `pos_audit_log` row via the
existing `audit()` helper.

## Call history

Stored on `pos_call_events` (see schema). No new list/report endpoint requested
yet — reports can query the table directly like every other POS report does.

## Recording upload

### POST /api/mobile/upload-recording
`multipart/form-data`: `audio` file + `deviceId`, `customerId`, `callId` fields.
Reuses `middleware/upload.js`'s audio filter/limits pattern (new `uploadCallRecording`
multer instance, destination `MOBILE_UPLOAD_PATH`, size cap `MOBILE_MAX_UPLOAD_MB`).
Writes `pos_call_events.recording_path`. No processing — `transcript` and
`ai_summary` columns stay `NULL` until the future AI pipeline exists.

Response: `{ success: true, recording_path }`

---

## Future (not implemented, schema-ready only)

`POST /api/ai/transcribe-call` — reads `pos_call_events.recording_path`,
writes `transcript`, then `ai_summary`. Columns already exist on
`pos_call_events` so this is additive, no migration needed when built.

---

## WebSocket events (existing Socket.IO server, `pos` room)

| Event | Emitted from | Payload |
|---|---|---|
| `incoming-call` | `POST /incoming-call` | `{ callId, customer, phone, timestamp, device, vip, loyalty, lastOrder, cakeBalance }` |
| `call-answered` | `POST /call-answered` | `{ callId, phone, deviceId }` |
| `call-ended` | `POST /call-ended` | `{ callId, phone, deviceId, duration }` |
| `missed-call` | `POST /missed-call` | `{ callId, phone, deviceId }` |

New helper functions in `pos/socketServer.js` (`emitIncomingCall`, `emitCallAnswered`,
`emitCallEnded`, `emitMissedCall`), same `if (!io) return; io.to('pos').emit(...)`
shape as every existing emit helper. No new socket role/room — POS terminals
already join `pos` on connect.

---

## Database schema (additions to `server/pos/db.js`, same idempotent
`CREATE TABLE IF NOT EXISTS` pattern as everything else in that file)

```sql
CREATE TABLE IF NOT EXISTS pos_devices (
  id                INT PRIMARY KEY AUTO_INCREMENT,
  device_id         VARCHAR(128) NOT NULL UNIQUE,
  device_name       TEXT,
  restaurant_id     VARCHAR(64),
  platform          VARCHAR(32),
  app_version       VARCHAR(32),
  status            VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  battery           INT,
  wifi              TEXT,
  network           TEXT,
  ip_address        VARCHAR(64),
  last_seen         DATETIME,
  paired_by_user_id INT,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(paired_by_user_id) REFERENCES pos_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pos_call_events (
  id                INT PRIMARY KEY AUTO_INCREMENT,
  device_id         VARCHAR(128) NOT NULL,
  phone             VARCHAR(32) NOT NULL,
  pos_customer_id   INT,
  customer_name     TEXT,
  status            VARCHAR(16) NOT NULL DEFAULT 'INCOMING'
                     CHECK(status IN ('INCOMING','ANSWERED','ENDED','MISSED')),
  start_time        DATETIME,
  end_time          DATETIME,
  duration_seconds  INT,
  recording_path    TEXT,
  transcript        LONGTEXT,
  ai_summary        LONGTEXT,
  created_by        INT,
  restaurant_id     VARCHAR(64),
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(pos_customer_id) REFERENCES pos_customers(id),
  FOREIGN KEY(created_by) REFERENCES pos_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_pos_call_events_phone ON pos_call_events(phone);
CREATE INDEX IF NOT EXISTS idx_pos_call_events_device ON pos_call_events(device_id);

CREATE TABLE IF NOT EXISTS pos_customer_addresses (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  phone      VARCHAR(32) NOT NULL,
  label      VARCHAR(64),
  address    TEXT NOT NULL,
  is_default INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_pos_customer_addresses_phone ON pos_customer_addresses(phone);

CREATE TABLE IF NOT EXISTS pos_customer_notes (
  id         INT PRIMARY KEY AUTO_INCREMENT,
  phone      VARCHAR(32) NOT NULL,
  note       TEXT NOT NULL,
  created_by INT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(created_by) REFERENCES pos_users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX IF NOT EXISTS idx_pos_customer_notes_phone ON pos_customer_notes(phone);
```

`phone` (not an FK) is the join key throughout, since `pos_customers` (INT id)
and `customers` (VARCHAR phone PK) aren't linked and both must resolve against
these tables.

---

## Configuration (`.env`, read the same `process.env.X` way as every other module)

```
MOBILE_API_ENABLED=true
MOBILE_API_VERSION=1
MOBILE_UPLOAD_PATH=uploads/call-recordings
MOBILE_MAX_UPLOAD_MB=20
MOBILE_HEARTBEAT_INTERVAL=60
```

---

## Files

**New:**
- `server/routes/pos/mobile.js` — all `/api/mobile/*` routes (POS style: route
  file calls `dbAll/dbGet/dbRun/transaction` from `pos/db.js` directly, `audit()`
  from `middleware/posAudit.js`, emit helpers from `pos/socketServer.js`).

**Modified:**
- `server/app.js` — mount `app.use('/api/mobile', mobileRouter)`.
- `server/pos/db.js` — add the four `CREATE TABLE IF NOT EXISTS` blocks above
  to `ensureSchema()`.
- `server/pos/socketServer.js` — add `emitIncomingCall/emitCallAnswered/
  emitCallEnded/emitMissedCall`, export them.
- `server/middleware/upload.js` — add `uploadCallRecording` multer instance
  (destination from `MOBILE_UPLOAD_PATH`, size from `MOBILE_MAX_UPLOAD_MB`).
- `server/routes/pos/auth.js` — extract the PIN-check body of `POST /pin` into
  an exported `authenticatePin(pin, terminalId)` helper so `/api/mobile/login`
  reuses it instead of duplicating the bcrypt loop.
- `server/.env` — add the five `MOBILE_*` vars.

No new dependencies. `multer`, `bcryptjs`, `socket.io`, `mysql2` are already
in `server/package.json`.

---

## Risks / open items

1. **No rate limiting anywhere in this repo.** `/incoming-call` is public-shaped
   enough (any paired device can fire it) that a misbehaving/compromised phone
   could spam it. Out of scope unless requested — flagging, not building.
2. **`DEV_MODE` bypass** in `posAuth.js` applies to `/api/mobile/*` too, since
   it reuses `requireSession`. Same as every POS route today — not a new hole,
   just inherited.
3. Phone normalization: no existing helper in the repo does this. A small
   local one is needed (strip spaces/dashes, handle `+977` prefix) — will be
   scoped to `routes/pos/mobile.js`, not a shared util, unless a second caller
   shows up later.
4. `vip` in the broadcast payload is a derived value (`rewards_tier !==
   'standard'`), not a stored column — cosmetic, easy to change once you see
   what the Android UI actually wants.

---

## Roadmap (one milestone at a time, compile + fix errors after each)

1. Schema: add 4 tables to `pos/db.js`, restart server, verify `ready` resolves.
2. Auth: extract `authenticatePin` in `auth.js`, add login/logout to `mobile.js`.
3. Device: pair + heartbeat routes.
4. Incoming call: lookup + insert + response shape (no socket yet).
5. Socket: add 4 emit helpers, wire into the 4 call routes.
6. Upload: `uploadCallRecording`, upload-recording route.
7. `.env` vars + `MOBILE_API_ENABLED` gate middleware.
8. Manual end-to-end test with curl/Postman against a live session token.
