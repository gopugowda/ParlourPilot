"""
Iteration 34 — RevenueCat / Apple IAP full mock-based test suite.

Runs against the LOCAL backend (backend .env has REVENUECAT_TEST_MODE=true).
The RC REST fetch is short-circuited by a Mongo mock collection populated
via the hidden `/api/billing/revenuecat/_test/mock` endpoint. This test
does NOT make any real RevenueCat REST calls and NEVER touches an existing
production tenant — it always signs up a fresh throwaway tenant.

Scenarios covered (exact matrix requested by user):

WEBHOOK  (POST /api/billing/revenuecat/webhook)
    1  INITIAL_PURCHASE (starter monthly)  → tenant becomes apple/starter/active
    2  RENEWAL                             → expires_at extended
    3  CANCELLATION while access still paid → status=cancelled_still_active
    4  EXPIRATION (voluntary)              → provider=none, status=expired
    5  BILLING_ISSUE / grace period        → status=in_billing_retry (still paid)
    6  PRODUCT_CHANGE (starter → growth)   → plan flips to growth
    7  UNCANCELLATION                      → will_auto_renew=true, status=active
    8  Duplicate webhook delivery          → 2nd call returns duplicate=true, no state change
    9  Out-of-order (EXPIRATION arrives after RENEWAL)  → REST re-fetch wins, tenant still active
   10  Unknown product ID                  → no plan activation, apple_status="none"
   11  Invalid webhook authorization       → 401
   12  RC REST unavailable AND empty body  → deferred=true, tenant state unchanged

SYNC / STATUS
   13  /billing/revenuecat/sync verified success
   14  /billing/revenuecat/sync when RC REST times out → verified=False, deferred=True
   15  /subscription/status returns apple block correctly

ACCOUNT DELETION  (POST /api/auth/delete-account)
   16  No Apple subscription               → 200 OK, tenant soft-deleted
   17  Active Apple subscription           → 409 apple_subscription_active
   18  Cancelled-still-active              → 409 apple_subscription_active
   19  Fully expired                       → 200 OK, tenant soft-deleted
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    'EXPO_PUBLIC_BACKEND_URL',
    'https://salon-invoice-app.preview.emergentagent.com',
).rstrip('/')
API = f"{BASE_URL}/api"

WEBHOOK_AUTH = "t7D6sVTdD0yu_Lkx7BEGmhlbxkH1cD6zK5-vAJ_eaOY"
TEST_AUTH    = "qNH4zVqQOBsuPaIX5nmqiLzswto3ak2x7_JrGcj_zEI"

PROD = {
    "starter_monthly": "com.parlourpilot.app.starter.monthly",
    "starter_yearly":  "com.parlourpilot.app.starter.yearly",
    "growth_monthly":  "com.parlourpilot.app.growth.monthly",
    "growth_yearly":   "com.parlourpilot.app.growth.yearly",
}

ENT = {
    "starter_monthly": "plan_starter",
    "starter_yearly":  "plan_starter",
    "growth_monthly":  "plan_growth",
    "growth_yearly":   "plan_growth",
}


# ---------- helpers ----------------------------------------------------------
def _now_ms(offset_seconds: int = 0) -> int:
    return int((time.time() + offset_seconds) * 1000)


def _make_subscriber(
    app_user_id: str,
    product_id: str,
    *,
    expires_offset_s: int,
    unsubscribe: bool = False,
    billing_issue: bool = False,
    period_type: str = "normal",
):
    """Build a minimal RevenueCat subscriber payload matching v1 shape."""
    ent_key = ENT[
        next(k for k, v in PROD.items() if v == product_id)
    ] if product_id in PROD.values() else "unknown"
    expires_ms = _now_ms(expires_offset_s)
    sub = {
        "expires_date_ms": str(expires_ms),
        "period_type": period_type,
        "purchase_date_ms": str(_now_ms(-3600)),
        "original_purchase_date_ms": str(_now_ms(-3600)),
        "unsubscribe_detected_at": _now_ms(-60) if unsubscribe else None,
        "billing_issues_detected_at": _now_ms(-60) if billing_issue else None,
        "store": "app_store",
    }
    entitlements = {}
    if ent_key in ("plan_starter", "plan_growth"):
        entitlements[ent_key] = {
            "product_identifier": product_id,
            "expires_date_ms": str(expires_ms),
            "purchase_date_ms": str(_now_ms(-3600)),
        }
    return {
        "original_app_user_id": app_user_id,
        "subscriptions": {product_id: sub},
        "entitlements": entitlements,
    }


def _fresh_tenant():
    """Create a throwaway tenant and return (token, tenant_id, email, password)."""
    uniq = uuid.uuid4().hex[:8]
    email = f"rc_test_{uniq}@parlourpilot-qa.com"
    password = "TestPass_123"
    payload = {
        "business_name": f"RC_TEST_{uniq}",
        "owner_name": "RC Test Owner",
        "email": email,
        "password": password,
        "num_branches": 1,
    }
    r = requests.post(f"{API}/tenants/signup", json=payload, timeout=30)
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.text}"
    token = r.json()["token"]
    me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=20)
    assert me.status_code == 200, me.text
    tenant_id = (me.json().get("user") or {}).get("tenant_id") or me.json().get("tenant_id")
    assert tenant_id, f"tenant_id missing in /auth/me: {me.json()}"
    return token, tenant_id, email, password


def _set_mock(app_user_id: str, subscriber=None, error: bool = False):
    r = requests.post(
        f"{API}/billing/revenuecat/_test/mock",
        headers={"X-Test-Auth": TEST_AUTH},
        json={"app_user_id": app_user_id, "subscriber": subscriber, "error": error},
        timeout=10,
    )
    assert r.status_code == 200, f"mock set failed: {r.status_code} {r.text}"


def _clear_mock(app_user_id: str):
    requests.post(
        f"{API}/billing/revenuecat/_test/clear",
        headers={"X-Test-Auth": TEST_AUTH},
        json={"app_user_id": app_user_id},
        timeout=10,
    )


def _webhook(event_type: str, app_user_id: str, product_id: str = None, event_id: str = None, auth: str = None):
    hdrs = {}
    hdrs["Authorization"] = f"Bearer {auth if auth is not None else WEBHOOK_AUTH}"
    body = {
        "event": {
            "id": event_id or f"evt_{uuid.uuid4().hex}",
            "type": event_type,
            "app_user_id": app_user_id,
            "product_id": product_id,
        }
    }
    return requests.post(f"{API}/billing/revenuecat/webhook", headers=hdrs, json=body, timeout=15)


def _status(token: str):
    r = requests.get(
        f"{API}/subscription/status",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _sync(token: str):
    r = requests.post(
        f"{API}/billing/revenuecat/sync",
        headers={"Authorization": f"Bearer {token}"},
        json={"trigger": "test"},
        timeout=15,
    )
    return r


# ============================================================================
# WEBHOOK TESTS
# ============================================================================
def test_01_initial_purchase_starter_monthly():
    token, tid, *_ = _fresh_tenant()
    try:
        pid = PROD["starter_monthly"]
        _set_mock(tid, _make_subscriber(tid, pid, expires_offset_s=30 * 86400))
        r = _webhook("INITIAL_PURCHASE", tid, pid)
        assert r.status_code == 200 and r.json().get("verified") is True, r.text
        s = _status(token)
        assert s["provider"] == "apple"
        assert s["plan"] == "starter"
        assert s["apple"]["status"] == "active"
        assert s["apple"]["product_id"] == pid
        assert s["apple"]["will_auto_renew"] is True
    finally:
        _clear_mock(tid)


def test_02_renewal_extends_expiry():
    token, tid, *_ = _fresh_tenant()
    try:
        pid = PROD["starter_monthly"]
        _set_mock(tid, _make_subscriber(tid, pid, expires_offset_s=30 * 86400))
        _webhook("INITIAL_PURCHASE", tid, pid)
        first = _status(token)["apple"]["expires_at"]
        # Simulate renewal — expiry pushed further out
        _set_mock(tid, _make_subscriber(tid, pid, expires_offset_s=60 * 86400))
        r = _webhook("RENEWAL", tid, pid)
        assert r.status_code == 200
        s = _status(token)
        assert s["apple"]["status"] == "active"
        assert s["apple"]["expires_at"] > first, (first, s["apple"]["expires_at"])
    finally:
        _clear_mock(tid)


def test_03_cancellation_while_still_paid():
    token, tid, *_ = _fresh_tenant()
    try:
        pid = PROD["starter_monthly"]
        # Active but user disabled auto-renew (unsubscribe_detected + future expiry)
        _set_mock(tid, _make_subscriber(tid, pid, expires_offset_s=15 * 86400, unsubscribe=True))
        r = _webhook("CANCELLATION", tid, pid)
        assert r.status_code == 200
        s = _status(token)
        # Apple treats sub as active until expires — plan must still be starter,
        # provider still apple, but apple_status = cancelled_still_active.
        assert s["provider"] == "apple", s
        assert s["plan"] == "starter", s
        assert s["apple"]["status"] == "cancelled_still_active", s
        assert s["apple"]["will_auto_renew"] is False, s
    finally:
        _clear_mock(tid)


def test_04_expiration_voluntary():
    token, tid, *_ = _fresh_tenant()
    try:
        pid = PROD["starter_monthly"]
        # Was purchased, but now expired (expires in past, no billing issue).
        _set_mock(tid, _make_subscriber(tid, pid, expires_offset_s=-3600, unsubscribe=True))
        # First give tenant an apple state via a fake prior active status:
        _set_mock(tid, _make_subscriber(tid, pid, expires_offset_s=86400))
        _webhook("INITIAL_PURCHASE", tid, pid)
        # Now expire it.
        _set_mock(tid, _make_subscriber(tid, pid, expires_offset_s=-3600, unsubscribe=True))
        r = _webhook("EXPIRATION", tid, pid)
        assert r.status_code == 200
        s = _status(token)
        # No active entitlement → provider is downgraded, status is expired.
        assert s["provider"] == "none", s
        assert s["subscription_status"] == "expired", s
        assert s["apple"]["status"] == "none", s
    finally:
        _clear_mock(tid)


def test_05_billing_issue_grace_period():
    token, tid, *_ = _fresh_tenant()
    try:
        pid = PROD["starter_monthly"]
        # Still-active window, but Apple flagged billing issue → grace/retry.
        _set_mock(tid, _make_subscriber(tid, pid, expires_offset_s=5 * 86400, billing_issue=True))
        r = _webhook("BILLING_ISSUE", tid, pid)
        assert r.status_code == 200
        s = _status(token)
        assert s["apple"]["status"] == "in_billing_retry", s
        assert s["plan"] == "starter", s  # user still has access during grace
    finally:
        _clear_mock(tid)


def test_06_product_change_starter_to_growth():
    token, tid, *_ = _fresh_tenant()
    try:
        starter = PROD["starter_monthly"]
        growth  = PROD["growth_monthly"]
        _set_mock(tid, _make_subscriber(tid, starter, expires_offset_s=30 * 86400))
        _webhook("INITIAL_PURCHASE", tid, starter)
        s1 = _status(token)
        assert s1["plan"] == "starter"

        _set_mock(tid, _make_subscriber(tid, growth, expires_offset_s=30 * 86400))
        r = _webhook("PRODUCT_CHANGE", tid, growth)
        assert r.status_code == 200
        s2 = _status(token)
        assert s2["plan"] == "growth", s2
        assert s2["apple"]["product_id"] == growth, s2
        assert s2["apple"]["status"] == "active", s2
    finally:
        _clear_mock(tid)


def test_07_uncancellation():
    token, tid, *_ = _fresh_tenant()
    try:
        pid = PROD["starter_monthly"]
        # Start with cancelled-but-active.
        _set_mock(tid, _make_subscriber(tid, pid, expires_offset_s=15 * 86400, unsubscribe=True))
        _webhook("CANCELLATION", tid, pid)
        assert _status(token)["apple"]["status"] == "cancelled_still_active"
        # Now user reversed the cancellation.
        _set_mock(tid, _make_subscriber(tid, pid, expires_offset_s=15 * 86400, unsubscribe=False))
        r = _webhook("UNCANCELLATION", tid, pid)
        assert r.status_code == 200
        s = _status(token)
        assert s["apple"]["status"] == "active", s
        assert s["apple"]["will_auto_renew"] is True, s
    finally:
        _clear_mock(tid)


def test_08_duplicate_webhook_delivery():
    token, tid, *_ = _fresh_tenant()
    try:
        pid = PROD["starter_monthly"]
        _set_mock(tid, _make_subscriber(tid, pid, expires_offset_s=30 * 86400))
        evt = f"evt_{uuid.uuid4().hex}"
        r1 = _webhook("INITIAL_PURCHASE", tid, pid, event_id=evt)
        r2 = _webhook("INITIAL_PURCHASE", tid, pid, event_id=evt)
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r2.json().get("duplicate") is True, r2.json()
    finally:
        _clear_mock(tid)


def test_09_out_of_order_events():
    """Late EXPIRATION event arrives after a valid RENEWAL. Because we
    re-fetch from RC REST (mock), the newest state wins even if the webhook
    is stale."""
    token, tid, *_ = _fresh_tenant()
    try:
        pid = PROD["starter_monthly"]
        # Simulate: user is currently on a fresh renewal (future expiry).
        _set_mock(tid, _make_subscriber(tid, pid, expires_offset_s=60 * 86400))
        # Now a stale EXPIRATION event lands. RC REST still shows the new
        # active state → tenant stays active. This tests the "REST is
        # authoritative, webhook is a hint" rule.
        r = _webhook("EXPIRATION", tid, pid)
        assert r.status_code == 200
        s = _status(token)
        assert s["provider"] == "apple", s
        assert s["apple"]["status"] == "active", s
    finally:
        _clear_mock(tid)


def test_10_unknown_product_id():
    token, tid, *_ = _fresh_tenant()
    try:
        bogus = "com.parlourpilot.app.unknown.monthly"
        _set_mock(tid, _make_subscriber(tid, bogus, expires_offset_s=30 * 86400))
        r = _webhook("INITIAL_PURCHASE", tid, bogus)
        assert r.status_code == 200
        s = _status(token)
        # Unknown product → no plan activation, no apple provider takeover.
        assert s["provider"] != "apple", s
        assert s["plan"] in (None, "trial", "starter"), s  # untouched
    finally:
        _clear_mock(tid)


def test_11_invalid_webhook_auth_rejected():
    _, tid, *_ = _fresh_tenant()
    try:
        pid = PROD["starter_monthly"]
        r = _webhook("INITIAL_PURCHASE", tid, pid, auth="nope")
        assert r.status_code == 401, r.text
    finally:
        _clear_mock(tid)


def test_12_rest_unavailable_defers_state():
    token, tid, *_ = _fresh_tenant()
    try:
        pid = PROD["starter_monthly"]
        # RC REST simulates failure AND the webhook body has no embedded
        # subscriber → we must NOT overwrite tenant state.
        _set_mock(tid, error=True)
        before = _status(token)
        r = _webhook("INITIAL_PURCHASE", tid, pid)
        assert r.status_code == 200
        assert r.json().get("verified") is False, r.json()
        after = _status(token)
        # State fields must be unchanged.
        assert after["provider"] == before["provider"], (before, after)
        assert after["apple"]["status"] == before["apple"]["status"], (before, after)
    finally:
        _clear_mock(tid)


# ============================================================================
# SYNC / STATUS
# ============================================================================
def test_13_sync_verified_success():
    token, tid, *_ = _fresh_tenant()
    try:
        pid = PROD["growth_yearly"]
        _set_mock(tid, _make_subscriber(tid, pid, expires_offset_s=365 * 86400))
        r = _sync(token)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["verified"] is True, body
        s = _status(token)
        assert s["plan"] == "growth", s
        assert s["apple"]["status"] == "active", s
    finally:
        _clear_mock(tid)


def test_14_sync_rest_failure_defers():
    token, tid, *_ = _fresh_tenant()
    try:
        _set_mock(tid, error=True)
        before = _status(token)
        r = _sync(token)
        assert r.status_code == 200
        assert r.json().get("verified") is False
        after = _status(token)
        assert after["provider"] == before["provider"]
    finally:
        _clear_mock(tid)


def test_15_subscription_status_apple_block():
    token, tid, *_ = _fresh_tenant()
    try:
        pid = PROD["starter_yearly"]
        _set_mock(tid, _make_subscriber(tid, pid, expires_offset_s=365 * 86400))
        _webhook("INITIAL_PURCHASE", tid, pid)
        s = _status(token)
        assert set(s["apple"].keys()) >= {"status", "product_id", "expires_at", "will_auto_renew"}
        assert s["apple"]["status"] == "active"
        assert s["apple"]["product_id"] == pid
        assert s["apple"]["expires_at"] is not None
    finally:
        _clear_mock(tid)


# ============================================================================
# ACCOUNT DELETION
# ============================================================================
DELETE_PAYLOAD = {"password": "TestPass_123", "confirm_text": "DELETE MY BUSINESS"}


def _delete(token):
    return requests.post(
        f"{API}/auth/delete-account",
        headers={"Authorization": f"Bearer {token}"},
        json=DELETE_PAYLOAD,
        timeout=20,
    )


def test_16_delete_no_apple_subscription():
    token, tid, *_ = _fresh_tenant()
    r = _delete(token)
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True


def test_17_delete_active_apple_blocked():
    token, tid, *_ = _fresh_tenant()
    try:
        pid = PROD["growth_monthly"]
        _set_mock(tid, _make_subscriber(tid, pid, expires_offset_s=30 * 86400))
        _webhook("INITIAL_PURCHASE", tid, pid)
        assert _status(token)["apple"]["status"] == "active"
        r = _delete(token)
        assert r.status_code == 409, r.text
        detail = r.json().get("detail") or {}
        assert detail.get("code") == "apple_subscription_active", r.json()
    finally:
        _clear_mock(tid)


def test_18_delete_cancelled_still_active_blocked():
    token, tid, *_ = _fresh_tenant()
    try:
        pid = PROD["growth_monthly"]
        _set_mock(tid, _make_subscriber(tid, pid, expires_offset_s=10 * 86400, unsubscribe=True))
        _webhook("CANCELLATION", tid, pid)
        assert _status(token)["apple"]["status"] == "cancelled_still_active"
        r = _delete(token)
        assert r.status_code == 409, r.text
        assert (r.json().get("detail") or {}).get("code") == "apple_subscription_active"
    finally:
        _clear_mock(tid)


def test_19_delete_after_expiration_allowed():
    token, tid, *_ = _fresh_tenant()
    try:
        pid = PROD["growth_monthly"]
        # Establish that tenant WAS an Apple subscriber, but now expired.
        _set_mock(tid, _make_subscriber(tid, pid, expires_offset_s=30 * 86400))
        _webhook("INITIAL_PURCHASE", tid, pid)
        assert _status(token)["apple"]["status"] == "active"
        # Now the sub expired.
        _set_mock(tid, _make_subscriber(tid, pid, expires_offset_s=-3600, unsubscribe=True))
        _webhook("EXPIRATION", tid, pid)
        assert _status(token)["apple"]["status"] == "none"
        r = _delete(token)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True
    finally:
        _clear_mock(tid)
