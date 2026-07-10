# Rule Engine Progress

## Done
- Module 1: DB schema (server/database/db.js, ensureSchema, after cake_collection_items block)
  - automation_condition_types, automation_action_types (metadata registries, AI-writable later)
  - automation_category_actions (category->action lookup, metadata-driven)
  - automation_settings (per-scope: global_session_cap=3, conflict_strategy, stop_overrides_cap=1) seeded website/pos/kiosk
  - automation_rules (core rule row, JSON columns: conditions/actions/schedule/frequency_cap)
  - automation_rule_versions (snapshot for rollback, spec sec 8)
  - automation_execution_log (audit trail, fired=0 means matched-but-suppressed by cap)
  - automation_test_runs (sandbox simulation log, spec sec 7)
  - Verified against local DB (.env.local): tables created OK.

- Module 2: metadata registry seed (server/database/db.js, ensureSchema, after module 1 block)
  - 16 condition_types across product/customer/history/context/cart/business
  - 11 action_types across sales/service/kitchen/inventory/operations/cx/notifications/knowledge/custom
  - category_actions mapping linking each category to its action_key(s)
  - Verified against local DB: 16/11/11/3 rows match expected.

- Module 3: server/routes/automation.js (mirrors crm.js style), registered in app.js at /api/automation
  - GET condition-types, action-types, category-actions (metadata reads)
  - GET/PUT settings (per-scope cap/conflict/stop-override)
  - CRUD rules: GET list (filter scope/status), GET one, POST, PUT (version++), DELETE (soft->disabled), DELETE purge (hard)
  - POST rules/:id/publish (snapshots to automation_rule_versions, status->published)
  - GET rules/:id/versions, POST rules/:id/rollback/:versionRowId (restore snapshot, status->draft)
  - Verified live against local DB: insert/fetch/publish/cleanup all OK.

- Module 4: server/services/automationEngine.js — evaluateRules(scope,triggerType,sessionId,customerId,context,score)
  - condition tree evaluator (and/or/leaf, ops eq/in/contains/gte/lte/gt/lt/between) driven by condition_types.value_schema
  - rule-level cap checks: max_shows_per_session/per_customer_per_day/lifetime, cooldown_hours
  - global per-channel session cap from automation_settings; conflict resolution = priority desc, stop_processing overrides cap + halts lower rules (per locked decisions)
  - writes automation_execution_log (fired=1 shown, fired=0 matched-but-suppressed)
  - POST /api/automation/evaluate — live firing endpoint
  - Verified: 4 rules/cap=3 -> 3 fired 1 suppressed; repeat session -> 0 fired (rule cap); stop_processing rule fires alone + halts rest.
- Module 5: sandbox test/simulation (spec sec 7)
  - POST /api/automation/rules/:id/test — dry run against sample_payload, no execution_log write, logs to automation_test_runs
  - GET /api/automation/rules/:id/test-runs
  - Verified: condition match true/false correct, execution_log untouched (0 rows).
- Module 6: GET /api/automation/compiled?scope= — publish-output read endpoint for website/POS/kiosk to consume (published rules + settings only, no admin fields). Website repo NOT touched, per REG-1 rule 6 — it will call this API.

- Module 7 (client wizard UI): client/src/pages/Automation/Automation.jsx + .css
  - List view (filter scope/status, publish/edit/disable actions)
  - 7-step wizard per spec sec 5: General, Trigger, Conditions, Actions, Schedule & Limits, Review+Test, Publish
  - automationApi added to client/src/services/api.js (house pattern, not ad-hoc axios)
  - Wired into client/src/App.jsx route + client/src/layouts/AdminLayout.jsx (nav registry, icon grid pos, default shortcuts, Apps group)
  - Step 6 (Review) includes sandbox "Save & Test" calling POST rules/:id/test, no live impact
  - Verified: `npx vite build` clean (only pre-existing chunk-size warning, unrelated)

- Module 8: MTC Studio -> website sync (decided: Node HTTP push, shared secret; website caches in its own munchtim_web DB, not shared tables; proceeding now, not blocked like coupon/loyalty phases)
  - Website (D:\web\munchtimecafeweborder): new tables automation_rules_cache, automation_settings_cache (server/schema.js), new server/automation.js (syncRules, getActiveRules), routes POST /api/automation/sync + GET /api/automation/active wired in server.js. Auth: body.api_key against AUTOMATION_SYNC.token (server/config.js, env AUTOMATION_SYNC_TOKEN, default 'mtc-automation-sync-2026').
  - MTC Studio: new server/services/websiteSync.js pushCompiledRules(scope) — fetch()-POSTs compiled rules+settings to website. Env: AUTOMATION_SYNC_ENABLED/AUTOMATION_SYNC_URL/AUTOMATION_SYNC_TOKEN (not yet set in .env.local — sync is a no-op locally until AUTOMATION_SYNC_URL is set).
  - Wired into server/routes/automation.js: publish, rollback, disable(DELETE) all fire-and-forget pushCompiledRules(scope) after their DB write; publish failures don't block on website being down (caught + logged).
  - Verified live: started website server locally (port 3311), POSTed real sync payload -> {ok:true,synced:1}; wrong api_key -> 401 Unauthorized; GET /api/automation/active?scope=website returned correct parsed JSON; cleared test row after. Test server left running on :3311 (background, harmless) — broad taskkill was blocked by permission classifier, didn't force it.

- Shared secret finalized: AUTOMATION_SYNC_SECRET=MTC_LIVE_SHELF_2026_X7K9P2Q8 (reuses same secret as legacy api/syncmenu.php), set in both D:\mtcstudio\server\.env.local and new D:\web\munchtimecafeweborder\.env (gitignored). Renamed env var/code from AUTOMATION_SYNC_TOKEN to AUTOMATION_SYNC_SECRET in websiteSync.js + website's config.js. AUTOMATION_SYNC_URL=http://localhost:3300 set for local dev (matches website's dev PORT); production URL still pending (user will check/add).
- Verified live on isolated port (3312, to avoid touching user's already-running :3300 dev server): correct secret -> synced OK, old default secret -> 401 rejected.

- Manual sync feature (user feedback: needed explicit control, not just publish-triggered):
  - websiteSync.js: pushCompiledRules(scope, {ruleIds, force}) — ruleIds filters which published rules to include (rest dropped from website cache = overwrite); force bypasses AUTOMATION_SYNC_ENABLED but still needs URL configured.
  - POST /api/automation/sync-now {scope, ruleIds} — new manual-trigger route.
  - Client: checkbox column + select-all on rule list, "Sync Checked to Website" / "Sync All (scope) to Website" buttons in Automation.jsx (scope filter must be a single scope to sync). automationApi.syncNow added.
  - Verified live: manual force-sync with ruleIds filter against isolated test instance -> {ok:true,synced:1}. Client build clean.

## Next
- Production AUTOMATION_SYNC_URL not yet set (user to provide after checking prod setup)
- User's real local website dev server (already running on :3300 before .env existed) needs a restart to pick up AUTOMATION_SYNC_SECRET
- Recommendation/score engine referenced by evaluateRules(score) not built yet — score currently passed in by caller, defaults 0
- Condition/action UI is minimal (single AND group, text-value inputs) — no nested OR groups or typed value pickers yet
- Not manually clicked through in browser yet — only build-verified
- Website side has no popup/recommendation display UI yet consuming GET /api/automation/active — cache + read API only

## Decisions (spec sec 9)
- Global cap number: 3 (setting, not hardcoded)
- Cap scope: per-channel (Website/POS/Kiosk separate counters)
- Stop Processing overrides global cap: Yes

## Schema version
- v0 — not yet created
