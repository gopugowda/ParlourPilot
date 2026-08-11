"""Iter 14 — Tenant subscription renewal via Razorpay.

Covers:
- POST /api/tenants/checkout/order  (admin only, allowed when expired, 400 on invalid plan)
- POST /api/tenants/checkout/verify (unknown order 404, bad sig 400, bogus pay_id 502)
- Cross-tenant isolation on /tenants/checkout/verify
- GET /api/pay/{order_id} for tenant_subscription — 'Salon subscription' label + verify path
- Regression: branch checkout still works (200 on create order)
"""
import os
import uuid
import hmac
import hashlib
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://salon-invoice-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@glowup.com"
ADMIN_PASSWORD = "admin123"
STAFF_EMAIL = "staff@glowup.com"
STAFF_PASSWORD = "staff123"

# Razorpay test-mode secret (from /app/backend/.env)
RZP_KEY_SECRET = "JASW9tXCoHsVd1JyQtW1TmPJ"
RZP_KEY_ID = "rzp_test_TONzleNjsSy4o9"


# ---------------- fixtures ----------------

@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def staff_token():
    r = requests.post(f"{API}/auth/login", json={"email": STAFF_EMAIL, "password": STAFF_PASSWORD})
    if r.status_code != 200:
        pytest.skip(f"staff login failed: {r.status_code} {r.text}")
    return r.json()["token"]


@pytest.fixture(scope="session")
def other_tenant_token():
    """Create a fresh isolated tenant for cross-tenant tests."""
    uniq = uuid.uuid4().hex[:8]
    payload = {
        "business_name": f"TEST_iter14_{uniq}",
        "owner_name": "Iter14 Owner",
        "email": f"iter14_{uniq}@test.com",
        "password": "pass1234",
        "phone": "9990001234",
    }
    r = requests.post(f"{API}/tenants/signup", json=payload)
    assert r.status_code in (200, 201), f"tenant signup failed: {r.status_code} {r.text}"
    return r.json()["token"]


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------------- Create Order ----------------

class TestTenantCreateOrder:
    def test_monthly_order_created(self, admin_token):
        r = requests.post(f"{API}/tenants/checkout/order",
                          json={"plan": "monthly", "display_amount": 999, "display_currency": "INR"},
                          headers=auth(admin_token))
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["amount"] == 99900
        assert j["currency"] == "INR"
        assert j["key_id"] == RZP_KEY_ID
        assert j["order_id"].startswith("order_")
        assert "Salon" in j["description"] or "subscription" in j["description"].lower()

    def test_yearly_order_created(self, admin_token):
        r = requests.post(f"{API}/tenants/checkout/order",
                          json={"plan": "yearly"},
                          headers=auth(admin_token))
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["amount"] == 999900
        assert j["order_id"].startswith("order_")

    def test_invalid_plan_rejected(self, admin_token):
        r = requests.post(f"{API}/tenants/checkout/order",
                          json={"plan": "weekly"},
                          headers=auth(admin_token))
        # Pydantic Literal validation → 422
        assert r.status_code in (400, 422), r.text

    def test_staff_forbidden(self, staff_token):
        r = requests.post(f"{API}/tenants/checkout/order",
                          json={"plan": "monthly"},
                          headers=auth(staff_token))
        assert r.status_code == 403, f"expected 403 for staff, got {r.status_code} {r.text}"

    def test_no_auth_rejected(self):
        r = requests.post(f"{API}/tenants/checkout/order", json={"plan": "monthly"})
        assert r.status_code in (401, 403), r.text


# ---------------- Verify Payment ----------------

class TestTenantVerify:
    def test_unknown_order_returns_404(self, admin_token):
        r = requests.post(f"{API}/tenants/checkout/verify",
                          json={
                              "razorpay_order_id": f"order_UNKNOWN_{uuid.uuid4().hex[:8]}",
                              "razorpay_payment_id": "pay_fake123",
                              "razorpay_signature": "0" * 64,
                          },
                          headers=auth(admin_token))
        assert r.status_code == 404, r.text

    def test_bad_signature_returns_400(self, admin_token):
        # First create a real order
        o = requests.post(f"{API}/tenants/checkout/order", json={"plan": "monthly"}, headers=auth(admin_token))
        assert o.status_code == 200
        order_id = o.json()["order_id"]
        r = requests.post(f"{API}/tenants/checkout/verify",
                          json={
                              "razorpay_order_id": order_id,
                              "razorpay_payment_id": "pay_bogus",
                              "razorpay_signature": "deadbeef" * 8,
                          },
                          headers=auth(admin_token))
        assert r.status_code == 400, r.text
        assert "signature" in r.text.lower()

    def test_valid_signature_bogus_payment_returns_502(self, admin_token):
        """Compute a valid HMAC but with a fake payment_id → server calls Razorpay
        payment.fetch which fails → 502."""
        o = requests.post(f"{API}/tenants/checkout/order", json={"plan": "monthly"}, headers=auth(admin_token))
        assert o.status_code == 200
        order_id = o.json()["order_id"]
        fake_pay = f"pay_TESTfake{uuid.uuid4().hex[:12]}"
        sig = hmac.new(RZP_KEY_SECRET.encode(),
                       f"{order_id}|{fake_pay}".encode(),
                       hashlib.sha256).hexdigest()
        r = requests.post(f"{API}/tenants/checkout/verify",
                          json={
                              "razorpay_order_id": order_id,
                              "razorpay_payment_id": fake_pay,
                              "razorpay_signature": sig,
                          },
                          headers=auth(admin_token))
        assert r.status_code == 502, f"expected 502 gateway error, got {r.status_code} {r.text}"

    def test_cross_tenant_isolation(self, admin_token, other_tenant_token):
        # admin@glowup.com creates order
        o = requests.post(f"{API}/tenants/checkout/order", json={"plan": "monthly"}, headers=auth(admin_token))
        assert o.status_code == 200
        order_id = o.json()["order_id"]
        # a different tenant tries to verify that order → 404 (isolation)
        r = requests.post(f"{API}/tenants/checkout/verify",
                          json={
                              "razorpay_order_id": order_id,
                              "razorpay_payment_id": "pay_x",
                              "razorpay_signature": "0" * 64,
                          },
                          headers=auth(other_tenant_token))
        assert r.status_code == 404, f"cross-tenant leak: {r.status_code} {r.text}"

    def test_staff_verify_forbidden(self, staff_token):
        r = requests.post(f"{API}/tenants/checkout/verify",
                          json={
                              "razorpay_order_id": "order_x",
                              "razorpay_payment_id": "pay_x",
                              "razorpay_signature": "0" * 64,
                          },
                          headers=auth(staff_token))
        assert r.status_code == 403, r.text


# ---------------- Hosted /pay page ----------------

class TestHostedPage:
    def test_pay_page_for_tenant_order(self, admin_token):
        o = requests.post(f"{API}/tenants/checkout/order", json={"plan": "yearly"}, headers=auth(admin_token))
        assert o.status_code == 200
        order_id = o.json()["order_id"]
        r = requests.get(f"{API}/pay/{order_id}")
        assert r.status_code == 200, r.text
        html = r.text
        assert "Salon subscription" in html, "tenant order page must show 'Salon subscription' label"
        assert "/api/tenants/checkout/verify" in html, "tenant order page must POST to tenant verify"
        assert RZP_KEY_ID in html

    def test_pay_page_not_found(self):
        r = requests.get(f"{API}/pay/order_DOES_NOT_EXIST_{uuid.uuid4().hex[:8]}")
        assert r.status_code == 404


# ---------------- Branch regression ----------------

class TestBranchRegression:
    def test_branch_checkout_still_works(self, admin_token):
        r = requests.post(f"{API}/branches/checkout/order",
                          json={
                              "plan": "monthly",
                              "branch": {"name": f"TEST_iter14_{uuid.uuid4().hex[:6]}", "active": True},
                              "display_amount": 888, "display_currency": "INR",
                          },
                          headers=auth(admin_token))
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["amount"] == 88800
        r2 = requests.get(f"{API}/pay/{j['order_id']}")
        assert r2.status_code == 200
        assert "/api/branches/checkout/verify" in r2.text
        assert "Branch" in r2.text


# ---------------- Payments config regression ----------------

class TestPaymentsConfig:
    def test_config_with_auth(self, admin_token):
        r = requests.get(f"{API}/payments/config", headers=auth(admin_token))
        assert r.status_code == 200
        j = r.json()
        assert j.get("enabled") is True
        assert j.get("key_id") == RZP_KEY_ID

    def test_pricing_exposes_tenant_plan(self, admin_token):
        r = requests.get(f"{API}/pricing", headers=auth(admin_token))
        assert r.status_code == 200
        j = r.json()
        assert j.get("tenant", {}).get("monthly") == 999
        assert j.get("tenant", {}).get("yearly") == 9999
        assert j.get("branch", {}).get("monthly") == 888
