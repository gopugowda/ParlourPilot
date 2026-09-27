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
In the RC dashboard → Project settings → Purchase Behavior, set **Restore Behavior**
to `transfer purchases` NO — recommended value is **keep active purchases on original App User
IDs; block new purchaser** to prevent one Apple purchase from silently attaching to a
different ParlourPilot business when they later sign in on the same device.

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
