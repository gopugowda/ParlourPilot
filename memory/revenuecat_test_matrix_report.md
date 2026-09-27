# RevenueCat / Apple IAP — Test Matrix Report
_Last run: 2026-06 (mock-based)_

---

## 1. RevenueCat REST API version audit

| Item | Value | Source |
|---|---|---|
| Endpoint used by backend | `GET https://api.revenuecat.com/v1/subscribers/{app_user_id}` | `routes/revenuecat.py::_fetch_subscriber_from_rc` |
| V2 equivalent for subscriber lookup | **Does not exist.** RC V2 is scoped to RC Billing + Web SDK; subscriber lookups remain on V1. | RC docs api-v2 / community.revenuecat.com |
| Required key type | **Secret API Key**, prefix `sk_...`, from Dashboard → Project Settings → **API Keys → Secret Keys** | RC docs api-v1/customers, `revenuecat/backend-architecture` guide |
| Auth header format | `Authorization: Bearer <sk_key>` | RC docs |
| Optional header — `X-Platform: iOS` | Only affects `management_url` returned. Present in our code; harmless. | RC docs api-v1/customers |
| **Sandbox header — `X-Is-Sandbox: true`** | **Required** for TestFlight/StoreKit-sandbox transactions to be surfaced. Missing before this patch; now conditional on `REVENUECAT_INCLUDE_SANDBOX` env var. | RC community: "v1 api not returning sandbox data" |
| Rate limits | 100 req/sec/project (RC standard) — we call once per webhook + once per `/sync`. Not close to the ceiling. | RC docs |
| Response cache staleness | RC caches; not real-time. Webhook is trigger; REST re-fetch is the authoritative snapshot. | RC docs |

### Verdict
Our V1 endpoint choice is correct. **No key-type mismatch.** The single missing piece was the sandbox toggle header, now added and env-gated.

Production env must set:
```
REVENUECAT_SECRET_API_KEY=sk_...        # from RC Dashboard → API Keys → Secret Keys
REVENUECAT_WEBHOOK_AUTH=<32+ char random>  # invent locally + paste into RC webhook config
REVENUECAT_INCLUDE_SANDBOX=false        # true only for a TestFlight/Sandbox-only deploy
REVENUECAT_TEST_MODE=false              # MUST be false in production
```

---

## 2. Automated mock-based backend test results

Tests live in `/app/backend/tests/test_iter34_revenuecat.py`. Run with:
```
cd /app/backend && python -m pytest tests/test_iter34_revenuecat.py -v
```

Test-mode uses a Mongo mock collection (`revenuecat_mock_responses`) fed via
`POST /api/billing/revenuecat/_test/mock` (requires `X-Test-Auth` header).
No real RevenueCat REST calls, no real Apple transactions. Every test uses a
freshly signed-up throwaway tenant so no existing tenant is touched.

| # | Scenario | Result |
|---|---|---|
| 01 | INITIAL_PURCHASE (starter monthly) | ✅ PASS |
| 02 | RENEWAL extends expiry | ✅ PASS |
| 03 | CANCELLATION while access still paid → `cancelled_still_active` | ✅ PASS |
| 04 | EXPIRATION voluntary → provider downgraded, plan cleared | ✅ PASS |
| 05 | BILLING_ISSUE / grace period → `in_billing_retry` (access retained) | ✅ PASS |
| 06 | PRODUCT_CHANGE starter → growth | ✅ PASS |
| 07 | UNCANCELLATION restores `active` + `will_auto_renew` | ✅ PASS |
| 08 | Duplicate webhook delivery — 2nd call returns `duplicate:true` | ✅ PASS |
| 09 | Out-of-order webhook (late EXPIRATION after RENEWAL) → REST authoritative | ✅ PASS |
| 10 | Unknown product ID → no provider takeover | ✅ PASS |
| 11 | Invalid webhook Authorization → 401 | ✅ PASS |
| 12 | RC REST unavailable AND empty snapshot → `deferred:true`, no state change | ✅ PASS |
| 13 | `/sync` verified success | ✅ PASS |
| 14 | `/sync` when RC REST times out → `verified:false`, no state change | ✅ PASS |
| 15 | `/subscription/status` returns full apple block | ✅ PASS |
| 16 | Delete account, no Apple sub | ✅ PASS |
| 17 | Delete account, Apple sub active → 409 `apple_subscription_active` | ✅ PASS |
| 18 | Delete account, cancelled-still-active → 409 `apple_subscription_active` | ✅ PASS |
| 19 | Delete account, after expiration → 200 OK, tenant soft-deleted | ✅ PASS |

**Total: 19/19 passing.**

### Bugs found and fixed during this run
1. **Delete-account owner-check regression** — `routes/auth.py` `delete_account()` gated on `user.get("is_owner")`, but `require_admin` never populates that field. Every legitimate owner got a `403 "Only the business owner can delete the account."` Fixed by computing on-the-fly via `compute_is_owner(user)` when the flag is absent.
2. **Missing `X-Is-Sandbox` header** — added `REVENUECAT_INCLUDE_SANDBOX` env-gated support. Without it, TestFlight sandbox purchases would not surface in the subscriber payload → webhook would look "empty" and defer forever.

---

## 3. iOS Sandbox / TestFlight test checklist

Only for you to run **on a real iOS device** after the app is published and a TestFlight build is generated. Everything below assumes:

- App Store Connect: 4 products live under group `parlourpilot_plans`
  (starter/growth × monthly/yearly), no intro/trial offers.
- RevenueCat Dashboard → Apps → iOS: App Store Connect API key (.p8) uploaded.
- RevenueCat Dashboard → Entitlements: `plan_starter`, `plan_growth` created,
  each mapped to their 2 products.
- RevenueCat Dashboard → Offerings → `default`: packages
  `$rc_starter_monthly`, `$rc_starter_yearly`, `$rc_growth_monthly`, `$rc_growth_yearly`
  (or leave standard slots; client falls back to product-id match).
- RevenueCat Dashboard → Integrations → Webhooks:
    - URL: `https://parlourpilot.com/api/billing/revenuecat/webhook`
    - Auth: `Authorization: Bearer <REVENUECAT_WEBHOOK_AUTH>`
    - Events: all (INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION,
      BILLING_ISSUE, PRODUCT_CHANGE, UNCANCELLATION, TRANSFER,
      SUBSCRIPTION_PAUSED, NON_RENEWING_PURCHASE)
- RevenueCat Dashboard → Project Settings → Purchase Behavior → Restore Behavior:
  **"Transfer if there are no active subscriptions"**.
- Backend prod env vars set:
  ```
  REVENUECAT_SECRET_API_KEY=sk_...
  REVENUECAT_WEBHOOK_AUTH=<same as dashboard>
  REVENUECAT_INCLUDE_SANDBOX=true      # ← flip to false after Sandbox testing
  REVENUECAT_TEST_MODE=false
  ```

### Device setup
1. On the iOS device: Settings → App Store → Sandbox Account → sign in with a
   Sandbox Apple ID (create in App Store Connect → Users and Access → Sandbox
   Testers if you don't have one).
2. Install the ParlourPilot TestFlight build.
3. Log into ParlourPilot with a **fresh** owner account (do NOT reuse the
   production `demo@parlourpilot.com` — every purchase creates permanent audit
   fields on the tenant).

### Purchase matrix — expected outcomes

| # | Action on device | What to check in ParlourPilot | What to check in RC dashboard |
|---|---|---|---|
| 1 | Tap **Starter Monthly** → complete sandbox purchase | Home tab shows Starter unlocked. Settings → Billing shows plan=starter, expiry within ~5 min ahead (sandbox renewal timescale). Delete-account button now shows "Manage Apple Subscription first". | Customer appears with `original_app_user_id` = the tenant.id UUID (not `$RCAnonymousID:...`). Entitlement `plan_starter` is active. |
| 2 | Wait for sandbox auto-renewal (5 min = 1 month in sandbox) | Expiry pushes further into the future (check Settings → Billing). | Event log shows RENEWAL. |
| 3 | Settings → **Manage Apple Subscription** → **Cancel Subscription** | ParlourPilot still shows Starter active. Status pill shows "Cancelled — access until <date>". Delete-account still blocked. | CANCELLATION event; `unsubscribe_detected_at` set; entitlement still active. |
| 4 | Wait for expiry (or fast-forward via sandbox re-purchase then let it lapse) | ParlourPilot drops to no-plan state. Delete-account button now works. | EXPIRATION event; entitlement no longer active. |
| 5 | Purchase **Growth Yearly** | Home flips to Growth plan. Prior Starter row is inactive. | PRODUCT_CHANGE event (if it was mid-cycle) or new INITIAL_PURCHASE (if after gap). Entitlement `plan_growth` active. |
| 6 | Simulate billing issue: Settings → App Store → Sandbox Account → use a card that declines. Trigger a renewal. | Access remains during grace period. Status pill shows "Billing issue". | BILLING_ISSUE event; `billing_issues_detected_at` set. Entitlement still active during grace. |
| 7 | **Restore Purchases** with the same Sandbox Apple ID | Owner's plan reflects the latest entitlement. | REST re-fetch succeeds. No TRANSFER event unless account switched. |
| 8 | **Restore Purchases** from a *different* ParlourPilot tenant (Tenant B) on the same device while Tenant A's sub is still active | Tenant B does NOT gain access. Server refuses the restore because RC restore-behaviour = "Transfer only when no active subscriptions". | No TRANSFER event; entitlement remains bound to Tenant A. |
| 9 | Delete account with active Apple sub | 409 error with `apple_subscription_active` code; UI routes to Manage Apple Subscription. | Nothing changes. |
| 10 | Delete account after Apple sub expired | 200 OK. Tenant soft-deleted; users deactivated; customer PII anonymised on historical bills. | Nothing changes on Apple side. |

### Webhook wiring verification
- Backend logs (`sudo supervisorctl tail -f backend`) should show
  `revenuecat.apply tenant=<uuid> plan=starter status=active …` after each purchase.
- Duplicate deliveries (RC will retry on non-2xx) must return `duplicate:true`
  on the 2nd try — check `db.revenuecat_events` count doesn't grow.
- Bad auth header must return 401 — hit the endpoint with a wrong Bearer to confirm.

### Regression / negative checks
- iPad + iPhone install same tenant → both show consistent plan after `/sync`.
- Log out on iPhone → `Purchases.logOut()` unbinds AppUserID; new login rebinds.
- Killing the app during purchase then reopening → next launch's `getCustomerInfo` should reflect Apple's decision (either purchased or aborted). No duplicate entitlement on our side.
- With `REVENUECAT_INCLUDE_SANDBOX=false` in prod, sandbox purchases must NOT leak into production tenant records — they'll simply not appear in the subscriber payload.

### After all 10 scenarios pass on device
1. Set `REVENUECAT_INCLUDE_SANDBOX=false` in prod backend env.
2. Redeploy backend.
3. Submit build for App Review with the 4 subscriptions attached to the version.
