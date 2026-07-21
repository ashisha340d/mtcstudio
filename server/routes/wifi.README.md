# Wi-Fi Captive Portal — `/wifi`

Server-rendered landing page shown to guests when they join the café hotspot.
MikroTik keeps full responsibility for network authentication; Node only
presents the page and hands the guest back to the router.

## Files

| File | Role |
|---|---|
| `routes/wifi.js` | Route mounting + hash-versioned asset serving |
| `controllers/wifiController.js` | Request handling, café config, MikroTik hand-off page |
| `services/wifiPortalService.js` | Cached, read-only catalogue projection |
| `services/wifiMikrotik.js` | Hotspot param parsing, CHAP, URL safety |
| `services/wifiAnalyticsService.js` | `wifi_devices` / `wifi_events` telemetry |
| `templates/wifi-portal.ejs` | The page |
| `public/wifi/portal.{css,js}` | Styles + interactions (no dependencies) |

Nothing here writes to POS/CMS tables. The two `wifi_*` tables are created on
first request and are owned solely by this module.

## MikroTik setup

**1. Walled garden** — the guest has no Internet yet, so the router must allow
the portal host before login. In `IP → Hotspot → Walled Garden IP`:

```
/ip hotspot walled-garden ip
add action=accept dst-address=<STUDIO_SERVER_IP> dst-port=3001 protocol=tcp comment="MTC Wi-Fi portal"
```

Without this the page cannot load at all.

**2. Redirect to the portal** — edit `hotspot/login.html` on the router so it
forwards its template variables:

```html
<html><head><meta http-equiv="refresh" content="0; url=http://<STUDIO_SERVER_IP>:3001/wifi?link-login-only=$(link-login-only)&link-orig=$(link-orig)&mac=$(mac)&ip=$(ip)&username=$(username)&error=$(error)&chap-id=$(chap-id)&chap-challenge=$(chap-challenge)&server-name=$(server-name)"></head><body></body></html>
```

**3. Guest credentials** — create the hotspot user the portal logs in as, or
enable the trial/open profile. Then set `WIFI_HOTSPOT_USER` /
`WIFI_HOTSPOT_PASSWORD` to match.

CHAP is handled server-side (`chapPassword` in `wifiMikrotik.js`), so both
`http-chap` and `http-pap` login methods work without shipping any crypto to
the browser and without the shared password appearing in page source.

## Environment

All optional — every one has a working default.

| Variable | Default | Purpose |
|---|---|---|
| `WIFI_HOTSPOT_USER` | `guest` | Hotspot username posted to MikroTik |
| `WIFI_HOTSPOT_PASSWORD` | `''` | Hotspot password (CHAP-hashed automatically) |
| `WIFI_FALLBACK_LOGIN_URL` | — | Login endpoint when the router sends no `link-login-only` |
| `WIFI_HOTSPOT_HOST` | — | Alternative fallback: builds `http://<host>/login` |
| `WIFI_AFTER_LOGIN_URL` | site URL | Landing page when there is no original destination |
| `WIFI_SITE_URL` | `https://munchtimecafe.com.np` | Base for Order / Book Cake targets |
| `WIFI_CACHE_TTL_MS` | `300000` | Catalogue snapshot lifetime |

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`/`POST` | `/wifi` | The portal |
| `GET`/`POST` | `/wifi/connect` | Hand-off; posts the guest into MikroTik's login |
| `POST` | `/wifi/api/event` | Beacon sink (scroll depth, taps, sections reached) |
| `GET` | `/wifi/api/summary?days=7` | Telemetry roll-up |
| `POST` | `/wifi/api/refresh` | Drop the catalogue cache after a menu edit |

## Design constraints worth preserving

- **No external requests.** A guest behind the hotspot cannot reach a CDN, so
  there are no webfonts, no icon libraries, and no Lottie player. The animated
  marks (Wi-Fi ping, embers, steam, beacon) are inline SVG + CSS keyframes,
  which cost zero extra bytes and run pre-auth.
- **Everything on one scroll.** No tabs, no wizard, no second page.
- **Outbound links go through `/wifi/connect`.** Tapping Book a Cake or a
  social icon connects the guest first and passes the target as `dst`, so the
  link actually opens instead of failing against a blocked network.
- The floating dock stays reachable throughout; the hero and footer each carry
  their own "Continue to Internet" so the action is never more than a tap away.

## Content sources

Sections are driven live from existing tables and disappear when empty:
featured/pizza/coffee/desserts from `products` + `product_images`, Today's
Specials from `live_shelf`, cakes from `cake_designs`, offers from
`combo_items`, testimonials from `order_reviews` (curated Google reviews fill
in below three real ones).

Catalogue rows whose image file is missing from `uploads/` are dropped from the
image-led carousels and rendered with a branded placeholder on the shelf, so a
stale row never shows a broken frame.
