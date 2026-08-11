"""Iteration 20: Cancel Subscription (Pending Expiry) — backend tests.

Covers POST/DELETE /api/tenants/me/cancel-subscription, RBAC, idempotency,
access-preservation, cancellation_pending surfacing in GETs, and platform stats
`cancelled_pending` counter. Ensures state is restored at the end.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL / EXPO_BACKEND_URL missing"
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"

OWNER = {"email": "admin@glowup.com", "password": "admin123"}
STAFF = {"email": "staff@glowup.com", "password": "staff123"}
PLATFORM = {"email": "platform@parlourpilot.com", "password": "platform123"}
GLOWUP_TID = "glowup-tenant-0001"


# ---------- fixtures ----------
def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"Login failed for {creds['email']}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def owner_token():
    return _login(OWNER)


@pytest.fixture(scope="module")
def staff_token():
    return _login(STAFF)


@pytest.fixture(scope="module")
def platform_token():
    return _login(PLATFORM)


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module", autouse=True)
def _ensure_clean_state(owner_token):
    """Before & after: make sure Glow Up tenant has NO pending cancellation."""
    # pre-clean (ignore 400 if not cancelled)
    requests.delete(f"{API}/tenants/me/cancel-subscription", headers=_h(owner_token), timeout=15)
    yield
    # post-clean
    r = requests.delete(f"{API}/tenants/me/cancel-subscription", headers=_h(owner_token), timeout=15)
    # 200 (was cancelled) or 400 (already restored) are both fine
    assert r.status_code in (200, 400), f"cleanup unexpected: {r.status_code} {r.text}"
    # verify state
    r2 = requests.get(f"{API}/tenants/me/subscription", headers=_h(owner_token), timeout=15)
    assert r2.status_code == 200
    j = r2.json()
    assert j.get("cancellation_pending") is False, f"Tenant left in cancelled state! {j}"
    assert j.get("cancellation_requested_at") in (None, ""), j


# ---------- Health / login sanity ----------
class TestSanity:
    def test_backend_reachable(self):
        r = requests.get(f"{API}/tenants/me", timeout=10)
        # unauthenticated -> 401/403
        assert r.status_code in (401, 403, 422)


# ---------- Cancel endpoint core behaviour ----------
class TestCancelSubscription:
    def test_cancel_by_owner_success(self, owner_token):
        r = requests.post(f"{API}/tenants/me/cancel-subscription", headers=_h(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert set(["tenant", "subscription", "already_cancelled"]).issubset(j.keys())
        assert j["already_cancelled"] is False
        sub = j["subscription"]
        # Status remains active/trialing (soft cancel)
        assert sub["status"] in ("active", "trialing"), sub
        assert sub["cancellation_pending"] is True
        assert sub["cancellation_requested_at"], sub
        assert sub["cancelled_by"] == OWNER["email"], sub
        # tenant doc also has the fields
        t = j["tenant"]
        assert t.get("cancellation_requested_at")
        assert t.get("cancelled_by") == OWNER["email"]

    def test_cancel_idempotent(self, owner_token):
        r = requests.post(f"{API}/tenants/me/cancel-subscription", headers=_h(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["already_cancelled"] is True
        assert j["subscription"]["cancellation_pending"] is True

    def test_subscription_get_exposes_fields(self, owner_token):
        r = requests.get(f"{API}/tenants/me/subscription", headers=_h(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("cancellation_pending", "cancellation_requested_at", "cancelled_by"):
            assert k in j, f"missing {k} in {j.keys()}"
        assert j["cancellation_pending"] is True
        assert j["cancelled_by"] == OWNER["email"]
        assert j["status"] in ("active", "trialing")

    def test_access_preserved_after_cancel_services(self, owner_token):
        r = requests.get(f"{API}/services", headers=_h(owner_token), timeout=15)
        assert r.status_code == 200, f"Access lost after cancel: {r.status_code} {r.text}"

    def test_access_preserved_after_cancel_bills(self, owner_token):
        r = requests.get(f"{API}/bills", headers=_h(owner_token), timeout=15)
        assert r.status_code == 200, f"Bills endpoint blocked after cancel: {r.status_code} {r.text}"

    def test_access_preserved_after_cancel_tenants_me(self, owner_token):
        r = requests.get(f"{API}/tenants/me", headers=_h(owner_token), timeout=15)
        assert r.status_code == 200
        sub = r.json().get("subscription") or {}
        assert sub.get("cancellation_pending") is True


# ---------- RBAC ----------
class TestCancelRBAC:
    def test_staff_cannot_cancel(self, staff_token):
        r = requests.post(f"{API}/tenants/me/cancel-subscription", headers=_h(staff_token), timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_staff_cannot_undo_cancel(self, staff_token):
        r = requests.delete(f"{API}/tenants/me/cancel-subscription", headers=_h(staff_token), timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_unauthenticated_rejected(self):
        r = requests.post(f"{API}/tenants/me/cancel-subscription", timeout=15)
        assert r.status_code in (401, 403), r.status_code


# ---------- Platform-side visibility ----------
class TestPlatformVisibility:
    def test_platform_stats_includes_cancelled_pending(self, platform_token, owner_token):
        # Ensure we are in cancelled state (previous class may have set it)
        requests.post(f"{API}/tenants/me/cancel-subscription", headers=_h(owner_token), timeout=15)
        r = requests.get(f"{API}/platform/stats", headers=_h(platform_token), timeout=15)
        assert r.status_code == 200, r.text
        stats = r.json()
        assert "cancelled_pending" in stats, stats
        assert isinstance(stats["cancelled_pending"], int)
        assert stats["cancelled_pending"] >= 1, f"expected >=1 cancelled_pending, got {stats}"

    def test_platform_tenants_shows_cancellation_flag(self, platform_token):
        r = requests.get(f"{API}/platform/tenants", headers=_h(platform_token), timeout=15)
        assert r.status_code == 200
        tenants = r.json()
        assert isinstance(tenants, list)
        glowup = next((t for t in tenants if t["id"] == GLOWUP_TID), None)
        assert glowup, "Glow Up tenant not found in platform list"
        sub = glowup.get("subscription") or {}
        assert sub.get("cancellation_pending") is True, sub
        assert sub.get("cancelled_by") == OWNER["email"]

    def test_platform_tenant_detail_shows_cancellation(self, platform_token):
        r = requests.get(f"{API}/platform/tenants/{GLOWUP_TID}/detail", headers=_h(platform_token), timeout=15)
        assert r.status_code == 200, r.text
        t = r.json().get("tenant") or {}
        sub = t.get("subscription") or {}
        assert sub.get("cancellation_pending") is True
        assert t.get("cancellation_requested_at")
        assert t.get("cancelled_by") == OWNER["email"]


# ---------- Undo ----------
class TestUndoCancel:
    def test_undo_success(self, owner_token):
        # Ensure cancelled first
        requests.post(f"{API}/tenants/me/cancel-subscription", headers=_h(owner_token), timeout=15)
        r = requests.delete(f"{API}/tenants/me/cancel-subscription", headers=_h(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        sub = r.json().get("subscription") or {}
        assert sub.get("cancellation_pending") is False
        assert sub.get("cancellation_requested_at") in (None, "")
        assert sub.get("cancelled_by") in (None, "")

    def test_undo_on_non_cancelled_400(self, owner_token):
        # Already not cancelled after prior test
        r = requests.delete(f"{API}/tenants/me/cancel-subscription", headers=_h(owner_token), timeout=15)
        assert r.status_code == 400, f"expected 400 for undo on non-cancelled: {r.status_code} {r.text}"
        assert "not cancelled" in (r.json().get("detail") or "").lower()

    def test_platform_stats_decrement(self, platform_token):
        r = requests.get(f"{API}/platform/stats", headers=_h(platform_token), timeout=15)
        assert r.status_code == 200
        # After undo, glowup should no longer count; but other tenants may.
        # Just assert the field exists and is a non-negative int.
        stats = r.json()
        assert "cancelled_pending" in stats
        assert stats["cancelled_pending"] >= 0

    def test_platform_tenants_after_undo(self, platform_token):
        r = requests.get(f"{API}/platform/tenants", headers=_h(platform_token), timeout=15)
        assert r.status_code == 200
        glowup = next((t for t in r.json() if t["id"] == GLOWUP_TID), None)
        assert glowup
        assert (glowup.get("subscription") or {}).get("cancellation_pending") is False


# ---------- Cannot cancel expired / suspended ----------
class TestCancelInvalidStates:
    """Use platform admin to flip Glow Up to expired/suspended, try cancel, restore."""

    def test_cannot_cancel_expired(self, owner_token, platform_token):
        # Snapshot original
        orig = requests.get(f"{API}/platform/tenants/{GLOWUP_TID}/detail", headers=_h(platform_token), timeout=15).json()["tenant"]
        try:
            # Force expired
            r = requests.post(
                f"{API}/platform/tenants/{GLOWUP_TID}/subscription",
                headers=_h(platform_token),
                json={"subscription_status": "expired"},
                timeout=15,
            )
            assert r.status_code == 200, r.text
            # Attempt cancel
            r2 = requests.post(f"{API}/tenants/me/cancel-subscription", headers=_h(owner_token), timeout=15)
            assert r2.status_code == 400, f"expected 400 for expired cancel: {r2.status_code} {r2.text}"
            detail = (r2.json().get("detail") or "").lower()
            assert "expired" in detail or "cannot cancel" in detail, r2.text
        finally:
            # Restore
            requests.post(
                f"{API}/platform/tenants/{GLOWUP_TID}/subscription",
                headers=_h(platform_token),
                json={
                    "subscription_status": orig.get("subscription_status") or "active",
                    "is_active": bool(orig.get("is_active", True)),
                },
                timeout=15,
            )

    def test_cannot_cancel_suspended(self, owner_token, platform_token):
        orig = requests.get(f"{API}/platform/tenants/{GLOWUP_TID}/detail", headers=_h(platform_token), timeout=15).json()["tenant"]
        try:
            r = requests.post(
                f"{API}/platform/tenants/{GLOWUP_TID}/subscription",
                headers=_h(platform_token),
                json={"is_active": False},
                timeout=15,
            )
            assert r.status_code == 200, r.text
            # Owner login token may still be valid (JWT), attempt cancel
            r2 = requests.post(f"{API}/tenants/me/cancel-subscription", headers=_h(owner_token), timeout=15)
            # tenant_status returns "suspended" only for is_active=False? Let's just assert non-200.
            # Acceptable: 400 (blocked in endpoint) or 402/403 (blocked by require_admin_active middleware)
            assert r2.status_code in (400, 402, 403), f"expected block for suspended: {r2.status_code} {r2.text}"
        finally:
            requests.post(
                f"{API}/platform/tenants/{GLOWUP_TID}/subscription",
                headers=_h(platform_token),
                json={
                    "subscription_status": orig.get("subscription_status") or "active",
                    "is_active": True,
                },
                timeout=15,
            )
