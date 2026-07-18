# API ENDPOINT SPECIFICATION — MTC POS & Companion

This document details the API endpoints used by the MTC Companion app, including existing infrastructure and new "Order Terminal" features.

**Base URL**: Configurable (e.g., `http://100.97.170.28`)
**Auth**: Header `x-session-id: <session_id>`

---

## 1. MOBILE AUTH & CORE (Existing)

### POST `/api/mobile/login`
- **Body**: `{ "username", "pin", "deviceId", "deviceName" }`
- **Response**: `{ "sessionId", "user": { "id", "name", "role" } }`

### POST `/api/mobile/pair`
- **Body**: `{ "pairingCode", "deviceId" }`
- **Response**: `200 OK`

### POST `/api/mobile/logout`
- **Response**: `200 OK`

---

## 2. COMPANION SYNC (Existing)

### GET `/api/companion/sync/menu?version=<md5>`
- **Response**: Full menu bundle (categories, products, variants, modifiers, assignments, images). Returns `{ "changed": false }` if version matches.

### GET `/api/companion/sync/customers?since=<timestamp>`
- **Response**: `{ "customers": [...], "addresses": [...], "serverTime": "..." }`

### GET `/api/companion/sync/images`
- **Response**: `{ "images": [{ "filename", "size", "url" }] }`

### GET `/api/companion/settings`
- **Response**: `{ "settings": [{ "key", "value" }], "storeSchedule": [...] }`

---

## 3. POS ORDERING (NEW - Order Terminal)

### GET `/api/pos/customers/lookup?phone=<digits>`
- **Response**: `{ "found": true, "customer": { "id", "name", "phone", "address", "notes" } }` or `{ "found": false }`

### POST `/api/pos/customers`
- **Body**: `{ "name", "phone", "address"?, "notes"? }`
- **Response**: `201 { "id", "name", "phone", "address", "notes" }` (Upserts by phone)

### POST `/api/pos/orders`
- **Purpose**: Create order shell + draft cart.
- **Body**:
```json
{
  "order_type": "TAKEAWAY | DELIVERY",
  "customer_id": 42,
  "customer_name": "Ram",
  "customer_phone": "9812345678",
  "customer_address": "...",
  "order_notes": "...",
  "status": "OPEN",
  "draft_items": [
    {
      "product_id": 10,
      "variant_id": 100,
      "product_name": "Cheese Burger (Regular)",
      "quantity": 2,
      "unit_price": 350.0,
      "notes": "..."
    }
  ]
}
```
- **Response**: `201 { "id": 1234, ... }` (ID is the Order Number)

### POST `/api/pos/kots`
- **Purpose**: Fire items to the kitchen/KDS.
- **Body**:
```json
{
  "order_id": 1234,
  "items": [
    {
      "product_id": 10,
      "variant_id": 100,
      "product_name": "Cheese Burger (Regular)",
      "quantity": 2,
      "unit_price": 350.0,
      "notes": "...",
      "prep_time_minutes": 12,
      "is_home_pack": false,
      "discount_amount": 0,
      "discount_type": null
    }
  ]
}
```
- **Response**: `201 { "id": <kotId>, "order_id": 1234, ... }`

---

## 4. ERROR HANDLING
- **401 Unauthorized**: Session expired.
- **409/403 Forbidden**: POS business day is not open. Body: `{ "error": "POS business day is not open" }`.
- **General Errors**: Body `{ "error": "<message>" }`.
