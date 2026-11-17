# Loyalty & Rewards System — Code Study

Location: repository-wide inventory of loyalty and rewards features as implemented in this codebase.

This document lists concrete files, DB schema, services, campaign actions, UI pages, and sync endpoints that implement or reference loyalty points, rewards tiers, and related behaviours. It is a factual extraction from the current workspace (no opinions).

---

## 1) Database schema (authoritative)
- `server/database/migrations/001_cms_core_schema.sql`
  - `customers` table contains:
    - `loyalty_points INT DEFAULT 0`
    - `rewards_tier VARCHAR(32) DEFAULT 'standard'`

- `server/database/migrations/004_indexes_and_constraints.sql`
  - Mentions `loyalty_ledger` foreign-key: `ALTER TABLE loyalty_ledger ADD FOREIGN KEY IF NOT EXISTS fk_ll_customer (customer_id) REFERENCES web_customer(customer_id) ON DELETE RESTRICT;`
    - (Migration indicates a ledger table exists/expected; search for `loyalty_ledger` elsewhere if ledger usage is needed.)

## 2) Campaign & automation seeds that use loyalty
- `server/database/migrations/006_seed_reference_data.js`
  - Registers a condition type `loyalty_tier` for the rule engine (field `loyalty_tier`).

- `server/database/migrations/010_campaign_seed.js` and `011_campaign_demo_seed.js`
  - Campaign types include `vip` and `loyalty` types (loyalty-based audiences).
  - Demo campaigns and audiences reference `rewards_tier` and `loyalty_points` in sample audiences (e.g. VIP & Gold Members: `rewards_tier` in `['vip','gold','platinum']` and `loyalty_points >= 100`).

## 3) Campaign engine (where points/tier changes are executed)
- `server/services/campaign/campaignEngine.js`
  - `ACTION_HANDLERS` contains the concrete handlers used by campaigns:
    - `add_loyalty_points(action, { customer })` — adds points via SQL:
      - `UPDATE customers SET loyalty_points = loyalty_points + ? WHERE phone=?`
      - `action.points` drives the amount.
    - `set_tier(action, { customer })` — sets `rewards_tier`:
      - `UPDATE customers SET rewards_tier=? WHERE phone=?`
  - `buildRun(...)` resolves audience, evaluates conditions (including `loyalty_tier` and `loyalty_points`), runs actions, and enqueues per-channel messages in `campaign_queue`.

## 4) Campaign UI / Builder (where rewards are configured)
- `client/src/pages/Campaigns/CampaignBuilder.jsx`
  - The Rewards step supports `issue_coupon` and `add_loyalty_points` (UI controls write `rewards` array used by the engine).
- `client/src/pages/Campaigns/panels.jsx`
  - Template tokens include `{{loyalty_points}}` and `{{tier}}` in sample token lists.

## 5) CRM / Admin UI (customer fields and management)
- `client/src/pages/CRM/CRM.jsx`
  - Columns and forms include `rewards_tier` and `loyalty_points`.
  - CRM screens and bulk operations operate on `customers` rows (the authoritative store is the `customers` table in DB).
- `client/src/pages/CRM/MergeManyModal.jsx` references `loyalty_points` in merge flows.

## 6) Companion / Mobile APIs (runtime surface exposing loyalty)
- `server/routes/pos/companion.js`
  - `/caller-status` response includes `loyaltyPoints` and `rewardsTier` fields pulled from `customers` in CMS DB.
  - `/sync/customers` returns `loyalty_points` and `rewards_tier` in incremental customer sync payloads.

## 7) Where loyalty is read or referenced elsewhere
- Campaign audiences and demo seeds reference `loyalty_points` and `rewards_tier` (`010_campaign_seed.js`, `011_campaign_demo_seed.js`).
- Client-side components that surface loyalty state (examples):
  - `client/src/pages/POS/components/IncomingCallDock.jsx` shows a VIP badge using `c.loyalty?.vip`.
  - Dashboard and CRM panels list loyalty as part of customer stats and segments.

## 8) Queueing & redemption surface
- Campaign engine enqueues messages in `campaign_queue` and links `coupon_code_id` where coupons are issued. Redemption and ledgering of loyalty points are not implemented in the campaign engine beyond the simple `UPDATE customers SET loyalty_points = loyalty_points + ?` performed by `add_loyalty_points`.

## 9) Important code locations (quick reference)
- DB migrations: `server/database/migrations/*.sql` and `*.js` (001, 004, 006, 010, 011)
- Campaign engine: `server/services/campaign/campaignEngine.js`
- Campaign UI: `client/src/pages/Campaigns/*`
- CRM UI: `client/src/pages/CRM/*`
- Companion sync / caller: `server/routes/pos/companion.js`

## 10) Concrete SQL examples (from code)
- Grant points (as used by `add_loyalty_points`):

  UPDATE customers SET loyalty_points = loyalty_points + ? WHERE phone=?;

- Set tier (as used by `set_tier`):

  UPDATE customers SET rewards_tier=? WHERE phone=?;

## 11) Observations you may need for changes or audits (facts only)
- The loyalty balance is stored on the `customers` row (`loyalty_points`). Campaigns directly mutate that column with SQL `UPDATE` operations.
- There is mention of `loyalty_ledger` in migrations; the campaign engine does not write ledger rows — if you need audit trails for point changes, search for `loyalty_ledger` or implement ledger writes where `add_loyalty_points` runs.
- Campaign audiences and conditions are rule-engine driven; conditions include `loyalty_tier` and `loyalty_points` filters.
- Coupons and campaigns are separate: coupons are created/issued by campaign handlers and campaign_queue rows carry coupon_code_id; loyalty points are handled by `add_loyalty_points` action.

## 12) Next-file checklist (where to look for follow-ups)
- If you want a point-change ledger: review `server/database/migrations/*` for `loyalty_ledger` DDL and add DB writes in `server/services/campaign/campaignEngine.js` `add_loyalty_points` handler.
- If you want redemption flows (subtract points on purchase), search for `redeem` / `loyalty` in `server/services` and `server/routes` (none found implementing redemption as of this extraction).

---

File created by automated code inspection: `AI/LOYALTY_STUDY.md`.
