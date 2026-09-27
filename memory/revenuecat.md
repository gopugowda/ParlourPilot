# RevenueCat — setup-partial (2026-09-27)

This file is a memory for future agents interacting with the ParlourPilot RevenueCat integration.

## Identifiers (from /setup response — copy verbatim)
- rc_project_id: proj8da738dc
- apple_app_id: appd49dc0d0bd
- play_app_id: appffe621ac75
- Dashboard: https://app.revenuecat.com/projects/proj8da738dc

## Provisioned by Emergent (default managed structure)
- Entitlement: `pro` (unused by ParlourPilot — kept because /setup created it, ignored by client)
- Offering: `default` (reused — see "Custom structure" below)
- Packages: `$rc_monthly`, `$rc_annual` (Test Store products — kept for provisioning idempotency)

## Custom ParlourPilot structure (USER must configure manually in RC dashboard)
The Emergent-managed `/setup` cannot express our multi-tier B2B needs. USER must add the
following to the same RevenueCat project via the dashboard before real iOS purchases work:

### Entitlements
- `plan_starter` — grants ParlourPilot Starter tier
- `plan_growth`  — grants ParlourPilot Growth tier
Both must be present in the same project. Do NOT delete the default `pro` entitlement.

### Products (RevenueCat + App Store Connect, matching IDs)
| Product ID (App Store Connect) | Duration | Attach to Entitlement |
|--------------------------------|----------|-----------------------|
| com.parlourpilot.app.starter.monthly | 1 month | plan_starter |
| com.parlourpilot.app.starter.yearly  | 1 year  | plan_starter |
| com.parlourpilot.app.growth.monthly  | 1 month | plan_growth  |
| com.parlourpilot.app.growth.yearly   | 1 year  | plan_growth  |

All 4 products live in ONE App Store Connect subscription group called `parlourpilot_plans`
so users can upgrade / downgrade / cross-grade with pro-rating handled by Apple. DO NOT
configure Apple introductory / free-trial offers on any product — ParlourPilot's 15-day
backend trial is the only trial (user directive).

### Custom Offering packages (in RC dashboard: Offerings → default → Packages)
Add these packages to the `default` offering (replace/reuse the default $rc_monthly/$rc_annual
package slots as needed). Package identifiers used by the mobile code:
- `$rc_starter_monthly` → com.parlourpilot.app.starter.monthly
- `$rc_starter_yearly`  → com.parlourpilot.app.starter.yearly
- `$rc_growth_monthly`  → com.parlourpilot.app.growth.monthly
- `$rc_growth_yearly`   → com.parlourpilot.app.growth.yearly

Mobile falls back to product-ID matching if these custom lookup keys are absent.

### Restore/Transfer behavior (CRITICAL for multi-tenant B2B)
**Change (2026-09-27):** the RevenueCat dashboard → Project settings → Purchase Behavior
"Restore Behavior" MUST be set to **"Transfer if there are no active subscriptions"**
(NOT "Keep with original App User IDs" as originally proposed).

Rationale:
- Tenant A owns an active Apple subscription. Tenant B logs in on the same device
  and taps "Restore". RevenueCat sees Tenant A's subscription is still active → the
  restore is REFUSED. Tenant B cannot steal it. ✓
- Tenant A's subscription later expires. The same Apple ID may now be legitimately
  attached to a different ParlourPilot tenant (e.g. the owner deleted the old
  business and created a new one, generating a fresh tenant UUID). ✓
- Prevents cross-tenant subscription theft while still allowing the underlying
  Apple account to be reused after its previous ParlourPilot binding ends.

### Apple cancellation ≠ immediate expiration
Apple's `CANCELLATION` webhook event fires the moment the user disables auto-renew,
but the subscription STAYS ACTIVE until `expires_date`. During this window the
normalized status is `cancelled_still_active` and account deletion is BLOCKED (the
user is still Apple-billed for the remaining period, and Apple treats the
subscription as active).

Only after `expires_date` passes (Apple sends `EXPIRATION` OR our REST re-fetch
sees `expires_date_ms < now`) does the status become `expired_voluntary` and
account deletion may proceed.

`APPLE_ACTIVE_STATUSES` (blocks deletion) = `{active, in_grace_period,
in_billing_retry, cancelled_still_active}`.

### REST-verified state, fail-closed on outage
Every webhook handler and every /sync call ALWAYS re-fetches the subscriber from
RevenueCat REST (`GET /v1/subscribers/{app_user_id}` with Secret API key) — the
webhook payload is only a HINT, never authoritative. If the REST call fails AND
the webhook body has no embedded snapshot, `_apply_subscriber(..., verified=False)`
short-circuits with `{deferred: True}` — the tenant state is NOT overwritten, and
the next webhook or /sync will retry. This prevents a transient network failure
from silently downgrading a paying tenant.

### RevenueCat REST API version + key type (verified 2026-06)
- Backend uses **V1** subscriber lookup exclusively — `GET /v1/subscribers/{app_user_id}`.
- RC has **no V2 equivalent** for subscriber-object lookup (V2 currently only
  covers RC Billing + Web SDK).
- Required key type: **Secret API Key**, prefix `sk_...`, from Dashboard →
  Project Settings → API Keys → **Secret Keys** section. Public keys
  authenticate but return empty `subscriber_attributes`.
- Auth header: `Authorization: Bearer <sk_key>`.
- `X-Platform: iOS` — optional, only affects `management_url` in the response.
- `X-Is-Sandbox: true` — **required** for TestFlight/StoreKit-sandbox transactions
  to appear in the subscriber payload. Env-gated by `REVENUECAT_INCLUDE_SANDBOX`.
  Default false in production; must be true only for a Sandbox-only deploy.
- See `/app/memory/revenuecat_test_matrix_report.md` for the full audit and test
  matrix results.

### Test mode
For automated backend tests we short-circuit the RC REST call. When
`REVENUECAT_TEST_MODE=true` is set, `_fetch_subscriber_from_rc()` reads from
`db.revenuecat_mock_responses` (keyed by `app_user_id`) instead of hitting
the RevenueCat API. Two hidden endpoints, both requiring `X-Test-Auth:
$REVENUECAT_TEST_AUTH`, control the mock:
  - `POST /api/billing/revenuecat/_test/mock` — upsert a mock subscriber
  - `POST /api/billing/revenuecat/_test/clear` — remove mock + events
Both endpoints are only mounted when `REVENUECAT_TEST_MODE=true`. Production
MUST have this env var false or unset.

### Webhook signature verification
RevenueCat's standard webhook uses only `Authorization: Bearer <shared_secret>`.
As of Sep 2026 RevenueCat does NOT publicly document an HMAC signature header,
so `X-RevenueCat-Webhook-Signature` verification is NOT implemented. The Bearer
shared secret + IP allowlisting (do this in your reverse proxy / Cloudflare
firewall in front of parlourpilot.com) is the current recommended defense.
Reference: https://www.revenuecat.com/docs/integrations/webhooks.

If RevenueCat later adds HMAC signature support, add it in `revenuecat_webhook()`
using `request.body()` (raw bytes) + `hmac.compare_digest`.

### Webhook
Configure in RC dashboard → Integrations → Webhooks:
- URL: `https://parlourpilot.com/api/billing/revenuecat/webhook`
- Auth header: `Authorization: Bearer <REVENUECAT_WEBHOOK_AUTH>` (backend .env)
- Events: enable ALL — INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, BILLING_ISSUE,
  PRODUCT_CHANGE, UNCANCELLATION, TRANSFER, SUBSCRIPTION_PAUSED, NON_RENEWING_PURCHASE

## Identity mapping
RevenueCat App User ID == `tenant.id` (UUIDv4, immutable, generated on tenant creation).
- Set on every auth path via `Purchases.logIn(tenant.id)` (see `/app/frontend/src/lib/revenuecat.tsx`).
- Cleared via `Purchases.logOut()` on sign-out.
- NEVER anonymous. NEVER owner user.id.

## Backend
- Route: `/app/backend/routes/revenuecat.py`
  - `POST /api/billing/revenuecat/webhook` — public, auth via shared secret
  - `POST /api/billing/revenuecat/sync` — authenticated mobile trigger
  - `GET  /api/subscription/status` — normalized state for delete-account/manage-sub UI
- Tenant fields written: `subscription_provider`, `apple_app_user_id`,
  `apple_subscription_status`, `apple_product_id`, `apple_expires_at`,
  `apple_will_auto_renew`, `apple_original_transaction_id`.
- Env vars (must be set in production backend):
  - `REVENUECAT_SECRET_API_KEY` (RC dashboard → API Keys → Secret)
  - `REVENUECAT_WEBHOOK_AUTH` (RC dashboard → Integrations → Webhooks → shared secret)

## DO NOT
- Do NOT call `/internal/revenuecat/…/products` after this initial `/setup`. It could
  drift the custom package/entitlement structure documented above.
- Do NOT call the RevenueCat REST API from ANY code except the FastAPI backend (with the
  Secret API key). Never from the mobile app; never from a script.
- Do NOT add an Apple introductory / free-trial offer.
- Do NOT use the `pro` entitlement in client code — ParlourPilot uses `plan_starter` /
  `plan_growth` only.

## Later updates
For price / duration changes of the 4 ParlourPilot products, use the RevenueCat dashboard
(NOT the Emergent proxy — see "DO NOT" above). Match the same price in App Store Connect.

## Status check (Emergent proxy — read-only)
```
AUTH='Authorization: Bearer sk-emergent-82eB217F3A748B42c7'
curl -sS -H "$AUTH" "$INTEGRATION_PROXY_URL/internal/revenuecat/projects/d502cb10-0c12-4b20-bb6b-9a40e925c8d5/status"
```

## Taking iOS IAP LIVE — manual store-side steps
1. Upload App Store Connect API key (`.p8`) to RC dashboard → Apps → iOS.
2. In App Store Connect: enable Paid Apps agreement + tax/banking.
3. Create the 4 subscription products (same IDs as above) in ONE subscription group,
   NO introductory offer, matching pricing tier for INR.
4. TestFlight build → sandbox tester → verify each of the 4 purchase flows + Restore + Manage.
5. Submit for App Review with the 4 subscriptions attached to the version.

## Anything Emergent-proxy-managed we should NOT overwrite
- The `default` offering exists — reuse it, replace its packages.
- The `pro` entitlement exists — ignore it (do not delete, safer to leave as-is so future
  Emergent status calls don't complain).
- Test Store products (`prode62403f627`, `proded5299bec3`, etc.) — leave alone; used only
  for Expo Go / web preview simulated purchases.
