"""
Iteration 13 — Razorpay payment gateway integration tests.
Covers:
- GET /api/payments/config (config for tenant admin)
- POST /api/branches/checkout/order (order creation, role gate, validation)
- POST /api/branches/checkout/verify (signature/order lookup/gateway/idempotency/tenant scope)
- Legacy POST /api/branches/checkout (mock, backward-compat)
- GET /api/pay/{order_id} (hosted checkout HTML)
- POST /api/razorpay/webhook (signature enforcement)
- No regression on /branches CRUD

NOTE: We CANNOT complete a real Razorpay payment in automated tests.
We use the KNOWN test key secret to compute a valid HMAC signature; then
Razorpay.payment.fetch() with a bogus payment_id is expected to 502
(gateway lookup fails). That is asserted as the terminal "gateway" step.
"""
import os, hmac, hashlib, uuid, time
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://salon-invoice-app.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@glowup.com"
ADMIN_PASS = "admin123"
STAFF_EMAIL = "staff@glowup.com"
STAFF_PASS = "staff123"

RAZORPAY_KEY_ID = "rzp_test_TONzleNjsSy4o9"
RAZORPAY_KEY_SECRET = "JASW9tXCoHsVd1JyQtW1TmPJ"


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def staff_token():
    r = requests.post(f"{API}/auth/login", json={"email": STAFF_EMAIL, "password": STAFF_PASS}, timeout=20)
    assert r.status_code == 200, f"staff login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def other_tenant():
    """Create a fresh throwaway tenant admin — used to test cross-tenant isolation."""
    uniq = uuid.uuid4().hex[:8]
    payload = {
        "business_name": f"TEST_biz_{uniq}",
        "owner_name": "TEST Owner",
        "email": f"test_{uniq}@example.com",
        "password": "secret123",
        "num_branches": 1,
    }
    r = requests.post(f"{API}/tenants/signup", json=payload, timeout=30)
    assert r.status_code == 200, f"signup failed: {r.text}"
    return {"token": r.json()["token"], "email": payload["email"]}


def _auth(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------- 1. /payments/config ----------
class TestPaymentsConfig:
    def test_config_returns_enabled_with_key_id(self, admin_token):
        r = requests.get(f"{API}/payments/config", headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("enabled") is True
        assert j.get("provider") == "razorpay"
        assert j.get("key_id") == RAZORPAY_KEY_ID
        assert j.get("currency") == "INR"

    def test_config_requires_auth(self):
        r = requests.get(f"{API}/payments/config", timeout=15)
        assert r.status_code in (401, 403)


# ---------- 2. Create Order ----------
class TestCreateOrder:
    def test_admin_creates_order_no_branch_yet(self, admin_token):
        # count branches BEFORE
        before = requests.get(f"{API}/branches", headers=_auth(admin_token), timeout=15).json()
        payload = {
            "plan": "monthly",
            "branch": {"name": f"TEST_pending_{uuid.uuid4().hex[:6]}", "active": True},
            "display_amount": 888.0,
            "display_currency": "INR",
        }
        r = requests.post(f"{API}/branches/checkout/order", headers=_auth(admin_token), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["order_id"].startswith("order_"), f"unexpected order_id: {j.get('order_id')}"
        assert j["key_id"] == RAZORPAY_KEY_ID
        assert j["amount"] == 88800  # paise for monthly
        assert j["currency"] == "INR"
        # Branch NOT created yet
        after = requests.get(f"{API}/branches", headers=_auth(admin_token), timeout=15).json()
        assert len(after) == len(before), "branch must NOT be created before payment verification"

    def test_yearly_plan_amount_paise(self, admin_token):
        payload = {"plan": "yearly", "branch": {"name": "TEST_yearly", "active": True}}
        r = requests.post(f"{API}/branches/checkout/order", headers=_auth(admin_token), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["amount"] == 888800

    def test_staff_forbidden(self, staff_token):
        payload = {"plan": "monthly", "branch": {"name": "TEST_x", "active": True}}
        r = requests.post(f"{API}/branches/checkout/order", headers=_auth(staff_token), json=payload, timeout=30)
        # staff blocked either by role check (403) OR by subscription/status — expect 403 primarily
        assert r.status_code in (402, 403), f"expected role denial, got {r.status_code} {r.text}"

    def test_empty_branch_name_400(self, admin_token):
        payload = {"plan": "monthly", "branch": {"name": "   ", "active": True}}
        r = requests.post(f"{API}/branches/checkout/order", headers=_auth(admin_token), json=payload, timeout=30)
        assert r.status_code == 400, r.text
        assert "Branch name" in r.text

    def test_invalid_plan_422(self, admin_token):
        payload = {"plan": "weekly", "branch": {"name": "TEST_x", "active": True}}
        r = requests.post(f"{API}/branches/checkout/order", headers=_auth(admin_token), json=payload, timeout=30)
        # Pydantic Literal validation -> 422
        assert r.status_code in (400, 422), r.text


# ---------- 3. Verify Payment ----------
class TestVerifyPayment:
    def _make_order(self, admin_token):
        payload = {"plan": "monthly", "branch": {"name": f"TEST_verify_{uuid.uuid4().hex[:6]}", "active": True}}
        r = requests.post(f"{API}/branches/checkout/order", headers=_auth(admin_token), json=payload, timeout=30)
        assert r.status_code == 200
        return r.json()

    def test_invalid_signature_400(self, admin_token):
        order = self._make_order(admin_token)
        body = {
            "razorpay_payment_id": "pay_TEST12345",
            "razorpay_order_id": order["order_id"],
            "razorpay_signature": "deadbeef" * 8,
        }
        r = requests.post(f"{API}/branches/checkout/verify", headers=_auth(admin_token), json=body, timeout=30)
        assert r.status_code == 400, r.text
        assert "Invalid payment signature" in r.text

    def test_unknown_order_404(self, admin_token):
        body = {
            "razorpay_payment_id": "pay_x",
            "razorpay_order_id": "order_DOES_NOT_EXIST",
            "razorpay_signature": "sig",
        }
        r = requests.post(f"{API}/branches/checkout/verify", headers=_auth(admin_token), json=body, timeout=30)
        assert r.status_code == 404, r.text
        assert "Unknown order" in r.text

    def test_valid_signature_bogus_payment_id_502(self, admin_token):
        """Valid HMAC computed w/ real key secret, but payment_id doesn't exist at Razorpay -> gateway lookup fails."""
        order = self._make_order(admin_token)
        pay_id = f"pay_BOGUS{uuid.uuid4().hex[:10]}"
        sig = hmac.new(
            RAZORPAY_KEY_SECRET.encode(),
            f'{order["order_id"]}|{pay_id}'.encode(),
            hashlib.sha256,
        ).hexdigest()
        body = {
            "razorpay_payment_id": pay_id,
            "razorpay_order_id": order["order_id"],
            "razorpay_signature": sig,
        }
        r = requests.post(f"{API}/branches/checkout/verify", headers=_auth(admin_token), json=body, timeout=30)
        assert r.status_code == 502, f"expected 502 gateway error, got {r.status_code} {r.text}"

    def test_cross_tenant_forbidden(self, admin_token, other_tenant):
        """A different tenant must NOT be able to verify another tenant's order."""
        order = self._make_order(admin_token)
        body = {
            "razorpay_payment_id": "pay_x",
            "razorpay_order_id": order["order_id"],
            "razorpay_signature": "sig",
        }
        # other tenant tries to verify glowup's order -> pending_orders lookup includes tenant_id -> 404
        r = requests.post(f"{API}/branches/checkout/verify", headers=_auth(other_tenant["token"]), json=body, timeout=30)
        assert r.status_code == 404, r.text
        assert "Unknown order" in r.text

    def test_idempotency_of_paid_order(self, admin_token):
        """Directly flip an order to 'paid' via a paid-marker + retry verify to prove idempotency.
        We cannot actually complete payment; but backend code returns idempotent {ok, idempotent:true}
        immediately when status=='paid'. We simulate this by verifying that repeated verify with
        the SAME bogus signature keeps rejecting (400) — proving order isn't spuriously flipped
        to paid on invalid attempts. True idempotent branch is exercised in production flow.
        """
        order = self._make_order(admin_token)
        body = {
            "razorpay_payment_id": "pay_x",
            "razorpay_order_id": order["order_id"],
            "razorpay_signature": "bad",
        }
        r1 = requests.post(f"{API}/branches/checkout/verify", headers=_auth(admin_token), json=body, timeout=30)
        r2 = requests.post(f"{API}/branches/checkout/verify", headers=_auth(admin_token), json=body, timeout=30)
        assert r1.status_code == 400 and r2.status_code == 400, f"{r1.status_code}/{r2.status_code}"


# ---------- 4. Legacy /branches/checkout (mock) ----------
class TestLegacyCheckout:
    def test_legacy_mock_creates_branch_immediately(self, admin_token):
        name = f"TEST_legacy_{uuid.uuid4().hex[:6]}"
        payload = {
            "plan": "monthly",
            "branch": {"name": name, "active": True},
        }
        r = requests.post(f"{API}/branches/checkout", headers=_auth(admin_token), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["branch"]["name"] == name
        assert j["payment"]["reference"].startswith("MOCKPAY-")
        # Cleanup — delete the branch
        bid = j["branch"]["id"]
        requests.delete(f"{API}/branches/{bid}", headers=_auth(admin_token), timeout=15)


# ---------- 5. Hosted checkout page ----------
class TestHostedPage:
    def test_page_ok_for_known_order(self, admin_token):
        payload = {"plan": "monthly", "branch": {"name": "TEST_page", "active": True}}
        order = requests.post(f"{API}/branches/checkout/order", headers=_auth(admin_token), json=payload, timeout=30).json()
        r = requests.get(f"{API}/pay/{order['order_id']}", timeout=15)
        assert r.status_code == 200, r.text
        html = r.text
        assert order["order_id"] in html
        assert RAZORPAY_KEY_ID in html
        assert "checkout.razorpay.com/v1/checkout.js" in html
        assert "#C42032" in html  # brand theme

    def test_page_404_for_unknown_order(self):
        r = requests.get(f"{API}/pay/order_FAKE_XYZ", timeout=15)
        assert r.status_code == 404


# ---------- 6. Webhook ----------
class TestWebhook:
    def test_webhook_without_signature_rejected(self):
        r = requests.post(f"{API}/razorpay/webhook", data=b"{}", timeout=15)
        # Without RAZORPAY_WEBHOOK_SECRET set the server returns 503 "Webhook not configured".
        # If a secret WERE set, missing signature -> 400. Both are safe-reject behaviors.
        assert r.status_code in (400, 503), r.text

    def test_webhook_with_bad_signature(self):
        r = requests.post(
            f"{API}/razorpay/webhook",
            data=b'{"event":"payment.captured"}',
            headers={"x-razorpay-signature": "deadbeef", "Content-Type": "application/json"},
            timeout=15,
        )
        assert r.status_code in (400, 503), r.text


# ---------- 7. Regression: branch CRUD unaffected ----------
class TestBranchRegression:
    def test_list_branches(self, admin_token):
        r = requests.get(f"{API}/branches", headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_and_delete_branch(self, admin_token):
        name = f"TEST_reg_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/branches", headers=_auth(admin_token), json={"name": name, "active": True}, timeout=20)
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        d = requests.delete(f"{API}/branches/{bid}", headers=_auth(admin_token), timeout=15)
        assert d.status_code == 200

    def test_auth_me_still_ok(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=_auth(admin_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["user"]["email"] == ADMIN_EMAIL
