"""Iter 15 — Refactor smoke tests.

Validates that after splitting the 3441-line server.py into 20+ modular
route files, every documented endpoint category still works end-to-end
against the public URL. No behavior changes expected.
"""
import hmac
import hashlib
import os
import uuid

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

ADMIN_EMAIL = "admin@glowup.com"
ADMIN_PASSWORD = "admin123"
STAFF_EMAIL = "staff@glowup.com"
STAFF_PASSWORD = "staff123"
PLATFORM_EMAIL = "platform@parlourpilot.com"
PLATFORM_PASSWORD = "platform123"

RAZORPAY_KEY_SECRET = "JASW9tXCoHsVd1JyQtW1TmPJ"


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _login(s, email, pw):
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=15)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text[:200]}"
    return r.json()


@pytest.fixture(scope="session")
def admin(s):
    return _login(s, ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="session")
def staff(s):
    return _login(s, STAFF_EMAIL, STAFF_PASSWORD)


@pytest.fixture(scope="session")
def platform(s):
    return _login(s, PLATFORM_EMAIL, PLATFORM_PASSWORD)


def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ============ 1. Bootstrap / misc ============
class TestBootstrap:
    def test_root(self, s):
        r = s.get(f"{BASE_URL}/api/", timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j.get("message") == "ParlourPilot SaaS API"
        assert j.get("status") == "ok"

    def test_seed_idempotent(self, s):
        r1 = s.post(f"{BASE_URL}/api/seed", timeout=15)
        r2 = s.post(f"{BASE_URL}/api/seed", timeout=15)
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json().get("ok") is True and r2.json().get("ok") is True

    def test_pricing(self, s, admin):
        # /pricing is authenticated (get_current_user)
        r = s.get(f"{BASE_URL}/api/pricing", headers=H(admin["token"]), timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j is not None


# ============ 2. Auth ============
class TestAuth:
    def test_login_admin(self, admin):
        assert admin.get("token")
        assert admin["user"]["email"] == ADMIN_EMAIL
        assert admin["user"]["role"] in ("admin", "owner")
        assert admin["tenant"] is not None
        assert admin["tenant"]["id"] == "glowup-tenant-0001"

    def test_login_bad_password(self, s):
        r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"}, timeout=10)
        assert r.status_code == 401

    def test_me(self, s, admin):
        r = s.get(f"{BASE_URL}/api/auth/me", headers=H(admin["token"]), timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j["user"]["email"] == ADMIN_EMAIL
        assert j["tenant"]["id"] == "glowup-tenant-0001"
        assert isinstance(j.get("branches"), list)
        assert j.get("subscription") is not None

    def test_me_no_token(self, s):
        r = s.get(f"{BASE_URL}/api/auth/me", timeout=10)
        assert r.status_code in (401, 403)

    def test_list_users_admin(self, s, admin):
        r = s.get(f"{BASE_URL}/api/auth/users", headers=H(admin["token"]), timeout=10)
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list) and len(arr) >= 1
        # ensure no _id / password_hash leaked
        for u in arr:
            assert "_id" not in u
            assert "password_hash" not in u

    def test_list_users_staff_forbidden(self, s, staff):
        r = s.get(f"{BASE_URL}/api/auth/users", headers=H(staff["token"]), timeout=10)
        assert r.status_code == 403

    def test_forgot_and_reset_password(self, s):
        # 1) request reset for a throwaway user we create then throw away.
        # simpler: use forgot for existing admin, capture token, immediately reset to same pw
        r = s.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": ADMIN_EMAIL}, timeout=10)
        assert r.status_code == 200
        tok = r.json().get("reset_token")
        assert tok  # dev mode returns token in body
        # reset back to same password to keep tests self-contained
        r2 = s.post(f"{BASE_URL}/api/auth/reset-password", json={"token": tok, "new_password": ADMIN_PASSWORD}, timeout=10)
        assert r2.status_code == 200 and r2.json().get("ok") is True
        # second use must fail (token consumed)
        r3 = s.post(f"{BASE_URL}/api/auth/reset-password", json={"token": tok, "new_password": ADMIN_PASSWORD}, timeout=10)
        assert r3.status_code == 400


# ============ 3. Tenants / Branches ============
class TestTenants:
    def test_tenants_me(self, s, admin):
        # NB: /tenants/me returns {tenant, subscription}. Branches are exposed via /api/branches
        # (this matches original server_original.py.bak behavior — refactor preserved it).
        r = s.get(f"{BASE_URL}/api/tenants/me", headers=H(admin["token"]), timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j["tenant"]["id"] == "glowup-tenant-0001"
        assert j.get("subscription") is not None

    def test_branches_list(self, s, admin):
        r = s.get(f"{BASE_URL}/api/branches", headers=H(admin["token"]), timeout=10)
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list) and len(arr) >= 1
        assert any(b.get("is_head") for b in arr)


# ============ 4. Domain endpoints (list smoke) ============
class TestDomains:
    @pytest.mark.parametrize("path", [
        "/api/services",
        "/api/beauticians",
        "/api/members",
        "/api/expenses",
        "/api/stock",
        "/api/cash-closing",
        "/api/appointments",
    ])
    def test_list_returns_json(self, s, admin, path):
        r = s.get(f"{BASE_URL}{path}", headers=H(admin["token"]), timeout=15)
        assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"
        # each returns a list (or dict for cash-closing summary shape)
        data = r.json()
        assert isinstance(data, (list, dict))

    def test_reports_summary(self, s, admin):
        """Regression: previously failed with 'NameError: _member_status' after refactor."""
        r = s.get(f"{BASE_URL}/api/reports/summary", headers=H(admin["token"]), timeout=15)
        assert r.status_code == 200, f"reports/summary -> {r.status_code} {r.text[:300]}"
        j = r.json()
        # Should have some numeric summary fields
        assert isinstance(j, dict)


# ============ 5. Bill create + read + delete ============
class TestBills:
    def test_create_read_delete_bill(self, s, admin):
        # need a service to bill against
        r = s.get(f"{BASE_URL}/api/services", headers=H(admin["token"]), timeout=10)
        assert r.status_code == 200
        services = r.json()
        assert services, "no services seeded"
        svc = services[0]

        payload = {
            "customer_name": "TEST_refactor_iter15",
            "customer_phone": "9999999999",
            "items": [{
                "service_id": svc["id"],
                "service_name": svc["name"],
                "price": float(svc.get("price", 100)),
                "beautician_id": None,
                "beautician_name": "",
                "discount_pct": 0,
                "discount_amount": 0,
                "tip_amount": 0,
            }],
            "is_member": False,
            "payment_mode": "cash",
            "cash_amount": 0,
            "qr_amount": 0,
            "notes": "iter15 refactor smoke",
        }
        r = s.post(f"{BASE_URL}/api/bills", headers=H(admin["token"]), json=payload, timeout=15)
        assert r.status_code == 200, f"create bill -> {r.status_code} {r.text[:300]}"
        bill = r.json()
        assert bill["id"] and bill.get("bill_no")
        assert bill["customer_name"] == "TEST_refactor_iter15"
        assert bill["grand_total"] > 0
        bid = bill["id"]

        # GET verifies persistence
        r = s.get(f"{BASE_URL}/api/bills/{bid}", headers=H(admin["token"]), timeout=10)
        assert r.status_code == 200
        assert r.json()["id"] == bid

        # cleanup
        r = s.delete(f"{BASE_URL}/api/bills/{bid}", headers=H(admin["token"]), timeout=10)
        assert r.status_code == 200


# ============ 6. Razorpay ============
class TestPayments:
    def test_payments_config(self, s, admin):
        r = s.get(f"{BASE_URL}/api/payments/config", headers=H(admin["token"]), timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j["provider"] == "razorpay"
        assert j["currency"] == "INR"
        assert j["enabled"] is True
        assert j["key_id"].startswith("rzp_")

    def test_branch_order_and_verify_bad_signature(self, s, admin):
        payload = {
            "plan": "monthly",
            "branch": {
                "name": f"TEST_iter15_{uuid.uuid4().hex[:6]}",
                "city": "TestCity",
                "country": "India",
            },
            "display_amount": 888,
            "display_currency": "INR",
        }
        r = s.post(f"{BASE_URL}/api/branches/checkout/order", headers=H(admin["token"]), json=payload, timeout=20)
        assert r.status_code == 200, f"branch order -> {r.status_code} {r.text[:300]}"
        j = r.json()
        assert j["order_id"].startswith("order_")
        assert j["amount"] == 88800
        oid = j["order_id"]

        # verify with bogus signature must 400
        v = s.post(f"{BASE_URL}/api/branches/checkout/verify",
                   headers=H(admin["token"]),
                   json={"razorpay_order_id": oid, "razorpay_payment_id": "pay_bogus", "razorpay_signature": "deadbeef"},
                   timeout=15)
        assert v.status_code == 400, f"expected 400 got {v.status_code}: {v.text[:200]}"

    def test_tenant_order_admin(self, s, admin):
        r = s.post(f"{BASE_URL}/api/tenants/checkout/order",
                   headers=H(admin["token"]),
                   json={"plan": "monthly", "display_amount": 999, "display_currency": "INR"},
                   timeout=20)
        assert r.status_code == 200, f"tenant order -> {r.status_code} {r.text[:300]}"
        j = r.json()
        assert j["order_id"].startswith("order_")
        assert j["amount"] == 99900

    def test_hosted_checkout_page(self, s, admin):
        # first create an order
        r = s.post(f"{BASE_URL}/api/tenants/checkout/order",
                   headers=H(admin["token"]),
                   json={"plan": "yearly", "display_amount": 9999, "display_currency": "INR"},
                   timeout=20)
        assert r.status_code == 200
        oid = r.json()["order_id"]
        page = s.get(f"{BASE_URL}/api/pay/{oid}", timeout=15)
        assert page.status_code == 200
        assert "text/html" in page.headers.get("content-type", "").lower()
        assert "Razorpay" in page.text or "razorpay" in page.text
        # tenant order → verify path must be tenants
        assert "/api/tenants/checkout/verify" in page.text
        assert "Salon subscription" in page.text

    def test_hosted_checkout_unknown(self, s):
        page = s.get(f"{BASE_URL}/api/pay/order_unknown_xxx", timeout=10)
        assert page.status_code == 404


# ============ 7. Platform admin ============
class TestPlatform:
    def test_platform_login(self, platform):
        assert platform["user"]["role"] in ("platform_admin", "platform_staff")

    def test_platform_tenants(self, s, platform):
        r = s.get(f"{BASE_URL}/api/platform/tenants", headers=H(platform["token"]), timeout=15)
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list) and any(t["id"] == "glowup-tenant-0001" for t in arr)

    def test_platform_users(self, s, platform):
        r = s.get(f"{BASE_URL}/api/platform/users", headers=H(platform["token"]), timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert "users" in j and isinstance(j["users"], list)
        assert any(u["email"] == PLATFORM_EMAIL for u in j["users"])

    def test_platform_tenant_detail(self, s, platform):
        r = s.get(f"{BASE_URL}/api/platform/tenants/glowup-tenant-0001/detail",
                  headers=H(platform["token"]), timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j["tenant"]["id"] == "glowup-tenant-0001"
        assert isinstance(j["branches"], list)
        assert isinstance(j["subscription_history"], list)

    def test_platform_export(self, s, platform):
        r = s.get(f"{BASE_URL}/api/platform/tenants/export",
                  headers=H(platform["token"]), timeout=20)
        assert r.status_code == 200
        j = r.json()
        assert "csv" in j and "filename" in j
        assert "Business Name" in j["csv"]

    def test_delete_seed_tenant_blocked(self, s, platform):
        """Super-admin protection: cannot delete the glowup seed tenant via API."""
        r = s.delete(f"{BASE_URL}/api/platform/tenants/glowup-tenant-0001",
                     headers=H(platform["token"]), timeout=15)
        # Either 400 (blocked by safety guard) or 403 (if platform user is not super)
        assert r.status_code == 400, f"expected 400 seed-guard, got {r.status_code}: {r.text[:200]}"
        assert "seed" in r.text.lower() or "cannot" in r.text.lower()

    def test_admin_forbidden_on_platform(self, s, admin):
        r = s.get(f"{BASE_URL}/api/platform/tenants", headers=H(admin["token"]), timeout=10)
        assert r.status_code == 403


# ============ 8. Multi-tenant isolation (fresh tenant cannot see glowup data) ============
class TestTenantIsolation:
    def test_signup_and_isolation(self, s, admin):
        biz = f"TEST_iter15_{uuid.uuid4().hex[:8]}"
        email = f"iter15_{uuid.uuid4().hex[:8]}@example.com"
        signup = s.post(f"{BASE_URL}/api/tenants/signup", json={
            "business_name": biz,
            "owner_name": "Iter15 Owner",
            "email": email,
            "password": "pass1234",
            "phone": "9000000000",
            "city": "Test",
            "country": "India",
        }, timeout=20)
        assert signup.status_code == 200, f"signup -> {signup.status_code} {signup.text[:300]}"
        new_token = signup.json()["token"]

        # New tenant's bills must be empty (no cross-tenant leak)
        r = s.get(f"{BASE_URL}/api/bills", headers=H(new_token), timeout=15)
        assert r.status_code == 200
        assert r.json() == []

        # New tenant cannot access a glowup order (create bogus id lookup returns 404)
        r = s.get(f"{BASE_URL}/api/bills/nonexistent-id-xyz", headers=H(new_token), timeout=10)
        assert r.status_code == 404
