"""RevenueCat webhook + Apple subscription sync for ParlourPilot.

Architecture (per user directive — B2B multi-tenant requires backend enforcement,
which contradicts the standard consumer-app RevenueCat playbook):

    Apple StoreKit
        ↓
    RevenueCat (authoritative for the *Apple* subscription lifecycle)
        ↓ (verified webhook + REST double-check)
    ParlourPilot backend  ← THIS FILE
        ↓ (normalizes into tenant.subscription_status / plan / *_end_date)
    Existing plan / branch / staff enforcement (unchanged, source of truth
    for feature access).

Identity mapping:
    RevenueCat AppUser ID == tenant.id (UUIDv4)

Endpoints:
    POST /api/billing/revenuecat/webhook  (public — verifies shared secret)
    POST /api/billing/revenuecat/sync     (authenticated — mobile re-fetch)
    GET  /api/subscription/status         (authenticated — used by mobile
                                           delete-account and manage-sub UI)
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from core import db, logger, now_iso, get_current_user, load_tenant

router = APIRouter(tags=["billing"])

# ---------------------------------------------------------------------------
# Config — provided via environment. Empty placeholders until real values are
# supplied by the tenant owner (via App Store Connect + RevenueCat dashboard).
# ---------------------------------------------------------------------------
REVENUECAT_SECRET_API_KEY = os.getenv("REVENUECAT_SECRET_API_KEY", "").strip()
REVENUECAT_WEBHOOK_AUTH = os.getenv("REVENUECAT_WEBHOOK_AUTH", "").strip()
REVENUECAT_REST_BASE = "https://api.revenuecat.com/v1"


# ---------------------------------------------------------------------------
# Product → plan mapping (also documented in /app/memory/revenuecat.md)
# ---------------------------------------------------------------------------
_PRODUCT_TO_PLAN = {
    "com.parlourpilot.app.starter.monthly": ("starter", "monthly"),
    "com.parlourpilot.app.starter.yearly":  ("starter", "yearly"),
    "com.parlourpilot.app.growth.monthly":  ("growth",  "monthly"),
    "com.parlourpilot.app.growth.yearly":   ("growth",  "yearly"),
}


def _iso_from_ms(ms: Optional[int]) -> Optional[str]:
    if not ms:
        return None
    try:
        return datetime.fromtimestamp(int(ms) / 1000.0, tz=timezone.utc).isoformat()
    except Exception:
        return None


def _classify_apple_status(subscriber: Dict[str, Any], product_id: str) -> str:
    """Return one of:
        active | in_grace_period | in_billing_retry | cancelled_still_active
      | expired_voluntary | expired_billing | none
    """
    subs = (subscriber or {}).get("subscriptions", {}) or {}
    sub = subs.get(product_id) or {}
    if not sub:
        return "none"

    now = datetime.now(timezone.utc)
    expires_at_ms = sub.get("expires_date_ms") or sub.get("expires_date")
    try:
        expires_at = (
            datetime.fromtimestamp(int(expires_at_ms) / 1000.0, tz=timezone.utc)
            if expires_at_ms and isinstance(expires_at_ms, (int, float, str)) and str(expires_at_ms).isdigit()
            else None
        )
    except Exception:
        expires_at = None

    unsubscribe_detected = bool(sub.get("unsubscribe_detected_at"))
    billing_issue = bool(sub.get("billing_issues_detected_at"))
    period_type = (sub.get("period_type") or "").lower()  # normal, intro, trial

    if expires_at and expires_at > now:
        # Still active. Distinguish:
        if unsubscribe_detected:
            return "cancelled_still_active"
        if billing_issue:
            return "in_billing_retry"  # RevenueCat also uses this for grace
        return "active"

    # Expired.
    if billing_issue:
        return "expired_billing"
    return "expired_voluntary"


async def _apply_subscriber(
    tenant_id: str,
    subscriber: Dict[str, Any],
    *,
    verified: bool = True,
) -> Dict[str, Any]:
    """Normalize a RevenueCat subscriber payload into ParlourPilot tenant state
    and persist it.

    Behaviour:
      - Determine the currently-active ParlourPilot product (if any).
      - Store apple_* audit fields on the tenant.
      - If active → mark subscription_provider='apple', set plan/status/end_date.
      - If none active → do NOT clear an existing Razorpay subscription; only
        clear the apple_* fields and mark provider=none if it was 'apple'.

    Safety (fixed per user directive):
      - If the caller cannot verify the subscriber (RC REST temporarily down
        AND webhook body lacks an embedded snapshot), we DO NOT overwrite an
        existing active Apple state — that would let a transient network
        failure silently downgrade a paying tenant. Callers pass verified=False
        to opt into this safe path.
    """
    ent = (subscriber or {}).get("entitlements", {}) or {}
    subs = (subscriber or {}).get("subscriptions", {}) or {}

    # If we couldn't verify AND the payload is essentially empty, refuse to
    # touch the tenant. Idempotency: the next webhook or /sync will retry.
    if not verified and not ent and not subs:
        current = await load_tenant(tenant_id) or {}
        return {
            "apple_subscription_status": current.get("apple_subscription_status"),
            "deferred": True,
            "reason": "unverified_empty_payload",
        }
    # Find the currently-active ParlourPilot entitlement (plan_starter or plan_growth).
    now = datetime.now(timezone.utc)
    active_product_id: Optional[str] = None
    active_plan: Optional[str] = None
    active_expires: Optional[str] = None

    for ent_key in ("plan_starter", "plan_growth"):
        e = ent.get(ent_key)
        if not e:
            continue
        pid = e.get("product_identifier")
        exp_ms = e.get("expires_date_ms") or e.get("expires_date")
        try:
            exp_dt = (
                datetime.fromtimestamp(int(exp_ms) / 1000.0, tz=timezone.utc)
                if exp_ms and str(exp_ms).isdigit()
                else None
            )
        except Exception:
            exp_dt = None
        if exp_dt and exp_dt > now and pid in _PRODUCT_TO_PLAN:
            active_product_id = pid
            active_plan = _PRODUCT_TO_PLAN[pid][0]
            active_expires = exp_dt.isoformat()
            break

    apple_status = (
        _classify_apple_status(subscriber, active_product_id) if active_product_id else "none"
    )

    # Load current tenant to decide whether we're clobbering Razorpay state.
    tenant = await load_tenant(tenant_id) or {}
    was_apple = tenant.get("subscription_provider") == "apple"

    updates: Dict[str, Any] = {
        "apple_app_user_id": subscriber.get("original_app_user_id") or tenant_id,
        "apple_subscription_status": apple_status,
        "apple_product_id": active_product_id,
        "apple_expires_at": active_expires,
        "apple_will_auto_renew": None,  # RC does not expose this directly
        "updated_at": now_iso(),
    }

    # original_transaction_id is at the subscription level, not entitlement.
    if active_product_id:
        subs = subscriber.get("subscriptions", {}) or {}
        s = subs.get(active_product_id) or {}
        updates["apple_original_transaction_id"] = s.get("original_purchase_date_ms")
        updates["apple_will_auto_renew"] = not bool(s.get("unsubscribe_detected_at"))

    if active_plan:
        # Apple purchase is active — take over as the subscription provider.
        updates.update({
            "subscription_provider": "apple",
            "subscription_status": "active",
            "plan": active_plan,
            "subscription_end_date": active_expires,
            # If tenant is transitioning FROM trial (ParlourPilot 15-day)
            # the trial's remaining days are forfeited — this is the safest
            # way to guarantee "no double trials" per user directive.
        })
    elif was_apple:
        # Apple sub is no longer active AND we were previously on Apple.
        # Mark the tenant as expired but don't touch it if user has since
        # started a fresh Razorpay subscription (unlikely mid-webhook but
        # defensive).
        updates.update({
            "subscription_provider": "none",
            "subscription_status": "expired",
        })

    await db.tenants.update_one({"id": tenant_id}, {"$set": updates})
    logger.info(
        "revenuecat.apply tenant=%s plan=%s status=%s product=%s expires=%s",
        tenant_id, active_plan, apple_status, active_product_id, active_expires,
    )
    return updates


async def _fetch_subscriber_from_rc(app_user_id: str) -> Optional[Dict[str, Any]]:
    """Server-side REST verification. Never trust client-supplied CustomerInfo
    alone — always re-fetch from RevenueCat with our Secret API key.
    """
    if not REVENUECAT_SECRET_API_KEY:
        logger.warning("REVENUECAT_SECRET_API_KEY not configured — skipping REST verify")
        return None
    url = f"{REVENUECAT_REST_BASE}/subscribers/{app_user_id}"
    headers = {
        "Authorization": f"Bearer {REVENUECAT_SECRET_API_KEY}",
        "Accept": "application/json",
        "X-Platform": "iOS",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(url, headers=headers)
            if r.status_code >= 400:
                logger.warning("RC REST %s: %s", r.status_code, r.text[:200])
                return None
            data = r.json()
            return (data or {}).get("subscriber")
    except Exception as exc:
        logger.exception("RC REST failure: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Webhook — public endpoint, secret-header authenticated.
# ---------------------------------------------------------------------------
@router.post("/billing/revenuecat/webhook")
async def revenuecat_webhook(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    # 1. Verify shared secret (RevenueCat dashboard → Integrations → Webhooks).
    if REVENUECAT_WEBHOOK_AUTH:
        if authorization != f"Bearer {REVENUECAT_WEBHOOK_AUTH}":
            raise HTTPException(status_code=401, detail="Invalid webhook auth")
    else:
        logger.warning("REVENUECAT_WEBHOOK_AUTH not set — accepting without verification")

    body = await request.json()
    event = (body or {}).get("event", {}) or {}
    event_type = event.get("type")
    app_user_id = event.get("app_user_id") or event.get("original_app_user_id")
    event_id = event.get("id")

    if not app_user_id:
        raise HTTPException(status_code=400, detail="missing app_user_id")

    # 2. Idempotency — dedupe by event_id.
    if event_id:
        existing = await db.revenuecat_events.find_one({"event_id": event_id})
        if existing:
            return {"ok": True, "duplicate": True}

    # 3. Persist raw event for audit / replay.
    await db.revenuecat_events.insert_one({
        "event_id": event_id,
        "event_type": event_type,
        "app_user_id": app_user_id,
        "raw": body,
        "received_at": now_iso(),
    })

    # 4. Verified re-fetch via RC REST API, then normalize into tenant state.
    subscriber = await _fetch_subscriber_from_rc(app_user_id)
    verified = subscriber is not None
    if subscriber is None:
        # Fallback: use the webhook's own subscriber snapshot if included.
        subscriber = body.get("subscriber") or {}
    await _apply_subscriber(app_user_id, subscriber, verified=verified)
    return {"ok": True, "event_type": event_type, "verified": verified}


# ---------------------------------------------------------------------------
# Sync — mobile-triggered fresh check (post-purchase, post-restore, on-open).
# ---------------------------------------------------------------------------
class RcSyncBody(BaseModel):
    # We don't trust this payload for grants — it's only a HINT. The server
    # ALWAYS re-queries RevenueCat REST before mutating tenant state.
    trigger: Optional[str] = None


@router.post("/billing/revenuecat/sync")
async def revenuecat_sync(_: RcSyncBody, user=Depends(get_current_user)):
    tenant_id = user.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="no tenant")
    subscriber = await _fetch_subscriber_from_rc(tenant_id)
    verified = subscriber is not None
    updates = await _apply_subscriber(tenant_id, subscriber or {}, verified=verified)
    return {"ok": True, "verified": verified, "state": updates}


# ---------------------------------------------------------------------------
# Aggregated subscription status — used by mobile Delete-Account + Manage Sub.
# ---------------------------------------------------------------------------
@router.get("/subscription/status")
async def subscription_status(user=Depends(get_current_user)):
    tenant_id = user.get("tenant_id")
    tenant = await load_tenant(tenant_id) or {}
    return {
        "tenant_id": tenant_id,
        "provider": tenant.get("subscription_provider") or "razorpay",
        "plan": tenant.get("plan"),
        "subscription_status": tenant.get("subscription_status"),
        "trial_end_date": tenant.get("trial_end_date"),
        "subscription_end_date": tenant.get("subscription_end_date"),
        # Apple-specific block for the Delete-Account precheck. Client uses
        # these fields to decide whether to show the "Manage Apple Subscription"
        # step before deletion.
        "apple": {
            "status": tenant.get("apple_subscription_status"),
            "product_id": tenant.get("apple_product_id"),
            "expires_at": tenant.get("apple_expires_at"),
            "will_auto_renew": tenant.get("apple_will_auto_renew"),
        },
    }


# Statuses that force the delete-account flow to show the Apple management
# step. Importable so routes/auth.py can share the exact list.
APPLE_ACTIVE_STATUSES = frozenset({
    "active",
    "in_grace_period",
    "in_billing_retry",
    "cancelled_still_active",
})
