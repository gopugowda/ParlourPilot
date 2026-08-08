"""
ParlourPilot Multi-Tenant SaaS backend tests.
Covers tenant isolation, signup flow, subscription checks, platform admin, and
existing billing preservation.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://salon-invoice-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@glowup.com"
ADMIN_PASSWORD = "admin123"
STAFF_EMAIL = "staff@glowup.com"
STAFF_PASSWORD = "staff123"
PLATFORM_EMAIL = "platform@parlourpilot.com"
PLATFORM_PASSWORD = "platform123"
GLOWUP_TENANT_ID = "glowup-tenant-0001"
EXISTING_BILL_NO = "20260807-0001"


# ---------------- Fixtures ----------------
@pytest.fixture(scope="session")
def s():
    return requests.Session()


def _login(session, email, password):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def admin_token(s):
    return _login(s, ADMIN_EMAIL, ADMIN_PASSWORD)["token"]


@pytest.fixture(scope="session")
def staff_token(s):
    return _login(s, STAFF_EMAIL, STAFF_PASSWORD)["token"]


@pytest.fixture(scope="session")
def platform_token(s):
    return _login(s, PLATFORM_EMAIL, PLATFORM_PASSWORD)["token"]


@pytest.fixture(scope="session")
def new_tenant(s):
    """Sign up a fresh tenant. Session-scoped so we can chain tests."""
    unique = uuid.uuid4().hex[:8]
    payload = {
        "business_name": f"TEST Salon {unique}",
        "owner_name": "TEST Owner",
        "email": f"TEST_owner_{unique}@example.com",
        "password": "testpass123",
        "phone": "9999999999",
        "city": "Bangalore",
    }
    r = s.post(f"{API}/tenants/signup", json=payload, timeout=30)
    assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
    data = r.json()
    data["_login_email"] = payload["email"]
    data["_login_password"] = payload["password"]
    return data


def H(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------------- 1. Login returns tenant + subscription ----------------
class TestLoginResponse:
    def test_admin_login_shape(self, s):
        data = _login(s, ADMIN_EMAIL, ADMIN_PASSWORD)
        assert "token" in data
        assert data["user"]["email"] == ADMIN_EMAIL
        assert data["user"]["role"] in ("admin", "owner")
        assert data["user"]["tenant_id"] == GLOWUP_TENANT_ID
        assert data.get("tenant") is not None
        assert data["tenant"]["id"] == GLOWUP_TENANT_ID
        assert data["tenant"]["business_name"] == "Glow Up Unisex Salon"
        sub = data["subscription"]
        assert sub is not None
        assert sub["status"] in ("active", "trialing")

    def test_platform_login_shape(self, s):
        data = _login(s, PLATFORM_EMAIL, PLATFORM_PASSWORD)
        assert data["user"]["role"] == "platform_admin"
        assert data["user"]["tenant_id"] in (None, "")
        assert data.get("tenant") is None
        assert data.get("subscription") is None


# ---------------- 2. /auth/me and /tenants/me ----------------
class TestMeEndpoints:
    def test_auth_me(self, s, admin_token):
        r = s.get(f"{API}/auth/me", headers=H(admin_token))
        assert r.status_code == 200
        d = r.json()
        assert d["user"]["email"] == ADMIN_EMAIL
        assert d["tenant"]["id"] == GLOWUP_TENANT_ID
        assert d["subscription"]["status"] in ("active", "trialing")

    def test_tenants_me(self, s, admin_token):
        r = s.get(f"{API}/tenants/me", headers=H(admin_token))
        assert r.status_code == 200
        d = r.json()
        assert d["tenant"]["id"] == GLOWUP_TENANT_ID
        assert d["tenant"]["business_name"] == "Glow Up Unisex Salon"
        assert d["subscription"]["status"] in ("active", "trialing")


# ---------------- 3. Signup Flow ----------------
class TestSignupFlow:
    def test_signup_creates_tenant_with_trial(self, new_tenant):
        assert "token" in new_tenant
        assert new_tenant["user"]["role"] == "admin"
        assert new_tenant["tenant"]["subscription_status"] == "trialing"
        assert new_tenant["subscription"]["status"] == "trialing"
        # 7-day trial
        days_left = new_tenant["subscription"]["days_left"]
        assert days_left is not None and 5 <= days_left <= 7

    def test_signup_duplicate_email_rejected(self, s, new_tenant):
        r = s.post(f"{API}/tenants/signup", json={
            "business_name": "Dup Salon",
            "owner_name": "Dup",
            "email": new_tenant["_login_email"],
            "password": "testpass123",
        })
        assert r.status_code == 400

    def test_signup_short_password_rejected(self, s):
        r = s.post(f"{API}/tenants/signup", json={
            "business_name": "X", "owner_name": "Y",
            "email": f"TEST_{uuid.uuid4().hex[:6]}@example.com", "password": "123",
        })
        assert r.status_code == 400


# ---------------- 4. New tenant empty by default ----------------
class TestNewTenantEmpty:
    def test_zero_services(self, s, new_tenant):
        r = s.get(f"{API}/services", headers=H(new_tenant["token"]))
        assert r.status_code == 200
        assert r.json() == []

    def test_zero_beauticians(self, s, new_tenant):
        r = s.get(f"{API}/beauticians", headers=H(new_tenant["token"]))
        assert r.status_code == 200 and r.json() == []

    def test_zero_bills(self, s, new_tenant):
        r = s.get(f"{API}/bills", headers=H(new_tenant["token"]))
        assert r.status_code == 200 and r.json() == []

    def test_zero_expenses(self, s, new_tenant):
        r = s.get(f"{API}/expenses", headers=H(new_tenant["token"]))
        assert r.status_code == 200 and r.json() == []

    def test_zero_stock(self, s, new_tenant):
        r = s.get(f"{API}/stock", headers=H(new_tenant["token"]))
        assert r.status_code == 200 and r.json() == []


# ---------------- 5. Tenant-stamped resource creation ----------------
class TestTenantStamping:
    def test_new_tenant_service_has_tenant_id(self, s, new_tenant):
        r = s.post(f"{API}/services",
                   headers=H(new_tenant["token"]),
                   json={"name": "TEST Haircut", "price": 200, "category": "Hair"})
        assert r.status_code == 200
        svc = r.json()
        assert svc["tenant_id"] == new_tenant["tenant"]["id"]
        assert svc["name"] == "TEST Haircut"


# ---------------- 6. Cross-Tenant Isolation ----------------
class TestCrossTenantIsolation:
    def test_new_tenant_cannot_see_glowup_services(self, s, admin_token, new_tenant):
        # Fetch Glow Up services
        r1 = s.get(f"{API}/services", headers=H(admin_token))
        assert r1.status_code == 200
        glow_services = r1.json()
        assert len(glow_services) > 0, "Glow Up should have seeded services"

        # New tenant listing should NOT include them
        r2 = s.get(f"{API}/services", headers=H(new_tenant["token"]))
        assert r2.status_code == 200
        new_ids = {x["id"] for x in r2.json()}
        for gs in glow_services:
            assert gs["id"] not in new_ids

    def test_new_tenant_get_glowup_service_returns_404(self, s, admin_token, new_tenant):
        r1 = s.get(f"{API}/services", headers=H(admin_token))
        glow_svc_id = r1.json()[0]["id"]
        # Try updating a Glow Up service with new-tenant token
        r2 = s.put(f"{API}/services/{glow_svc_id}",
                   headers=H(new_tenant["token"]),
                   json={"name": "HACKED", "price": 1, "category": "x", "active": True})
        assert r2.status_code == 404
        # And delete
        r3 = s.delete(f"{API}/services/{glow_svc_id}", headers=H(new_tenant["token"]))
        assert r3.status_code == 404

    def test_new_tenant_cannot_delete_glowup_bill(self, s, admin_token, new_tenant):
        r1 = s.get(f"{API}/bills?limit=5", headers=H(admin_token))
        bills = r1.json()
        if bills:
            bid = bills[0]["id"]
            r2 = s.delete(f"{API}/bills/{bid}", headers=H(new_tenant["token"]))
            assert r2.status_code == 404
            r3 = s.get(f"{API}/bills/{bid}", headers=H(new_tenant["token"]))
            assert r3.status_code == 404

    def test_glowup_still_sees_own_services(self, s, admin_token):
        r = s.get(f"{API}/services", headers=H(admin_token))
        assert r.status_code == 200
        assert len(r.json()) >= 1


# ---------------- 7. Existing bill accessible ----------------
class TestExistingBillPreserved:
    def test_existing_bill_20260807_0001(self, s, admin_token):
        # List bills without date filter (admin sees all)
        r = s.get(f"{API}/bills?limit=500", headers=H(admin_token))
        assert r.status_code == 200
        bills = r.json()
        match = [b for b in bills if b.get("bill_no") == EXISTING_BILL_NO]
        assert len(match) == 1, f"Existing bill {EXISTING_BILL_NO} not found among {len(bills)} bills"
        assert match[0]["tenant_id"] == GLOWUP_TENANT_ID


# ---------------- 8. Platform Admin ----------------
class TestPlatformAdmin:
    def test_platform_cannot_access_tenant_endpoint(self, s, platform_token):
        r = s.get(f"{API}/services", headers=H(platform_token))
        # Should be 403 because platform admin has no tenant_id
        assert r.status_code == 403

    def test_platform_list_tenants(self, s, platform_token):
        r = s.get(f"{API}/platform/tenants", headers=H(platform_token))
        assert r.status_code == 200
        tenants = r.json()
        assert isinstance(tenants, list)
        ids = {t["id"] for t in tenants}
        assert GLOWUP_TENANT_ID in ids
        for t in tenants:
            assert "subscription" in t
            assert "user_count" in t
            assert "bills_count" in t

    def test_platform_stats(self, s, platform_token):
        r = s.get(f"{API}/platform/stats", headers=H(platform_token))
        assert r.status_code == 200
        d = r.json()
        for k in ("tenants", "active_tenants", "users", "bills"):
            assert k in d
        assert d["tenants"] >= 1

    def test_platform_extend_subscription(self, s, platform_token, new_tenant):
        tid = new_tenant["tenant"]["id"]
        r = s.post(f"{API}/platform/tenants/{tid}/subscription",
                   headers=H(platform_token),
                   json={"extend_days": 30})
        assert r.status_code == 200
        d = r.json()
        assert d["tenant"]["id"] == tid
        # After 30-day extend, days_left should be > 20
        assert d["subscription"]["days_left"] is not None
        assert d["subscription"]["days_left"] >= 20

    def test_admin_cannot_access_platform_endpoint(self, s, admin_token):
        r = s.get(f"{API}/platform/tenants", headers=H(admin_token))
        assert r.status_code == 403


# ---------------- 9. Tenant profile update ----------------
class TestTenantProfileUpdate:
    def test_update_business_name_and_tax(self, s, new_tenant):
        payload = {
            "business_name": "TEST Updated Name",
            "address": "123 Test St",
            "tax_enabled": True,
            "tax_number": "GSTIN123",
            "tax_percentage": 18.0,
        }
        r = s.put(f"{API}/tenants/me", headers=H(new_tenant["token"]), json=payload)
        assert r.status_code == 200
        t = r.json()["tenant"]
        assert t["business_name"] == "TEST Updated Name"
        assert t["address"] == "123 Test St"
        assert t["tax_enabled"] is True
        assert t["tax_percentage"] == 18.0
        # Verify persistence
        r2 = s.get(f"{API}/tenants/me", headers=H(new_tenant["token"]))
        assert r2.json()["tenant"]["business_name"] == "TEST Updated Name"


# ---------------- 10. Bill creation for admin ----------------
class TestBillCreation:
    def test_admin_creates_bill_with_tenant_id(self, s, admin_token):
        # Need a service + beautician for a valid bill
        rs = s.get(f"{API}/services", headers=H(admin_token))
        svc = rs.json()[0]
        rb = s.get(f"{API}/beauticians", headers=H(admin_token))
        beau = rb.json()[0] if rb.json() else {"id": None, "name": "Test"}

        payload = {
            "customer_name": "TEST Walk-in",
            "customer_phone": "9999911111",
            "items": [{
                "service_id": svc["id"],
                "service_name": svc["name"],
                "price": svc["price"],
                "discount_pct": 0,
                "beautician_id": beau.get("id"),
                "beautician_name": beau.get("name", "Test"),
                "tip_amount": 0,
            }],
            "payment_mode": "cash",
            "is_member": False,
        }
        r = s.post(f"{API}/bills", headers=H(admin_token), json=payload)
        assert r.status_code == 200, r.text
        bill = r.json()
        assert bill["tenant_id"] == GLOWUP_TENANT_ID
        assert bill["grand_total"] == svc["price"]
        assert bill["bill_no"]
        # Cleanup
        s.delete(f"{API}/bills/{bill['id']}", headers=H(admin_token))

    def test_member_discount_applied_from_tenant_settings(self, s, admin_token):
        rs = s.get(f"{API}/services", headers=H(admin_token))
        # Pick a service priced above min_price (100)
        svc = next((x for x in rs.json() if x["price"] > 200), rs.json()[0])
        payload = {
            "customer_name": "TEST Member",
            "customer_phone": "9998887777",
            "items": [{
                "service_id": svc["id"], "service_name": svc["name"],
                "price": svc["price"], "discount_pct": 0,
                "beautician_id": None, "beautician_name": "Test",
                "tip_amount": 0,
            }],
            "payment_mode": "cash",
            "is_member": True,
        }
        r = s.post(f"{API}/bills", headers=H(admin_token), json=payload)
        assert r.status_code == 200
        bill = r.json()
        # 10% member discount expected on service > 100
        if svc["price"] > 100:
            assert bill["items"][0]["effective_discount_pct"] == 10.0
            assert bill["items"][0]["member_applied"] is True
        s.delete(f"{API}/bills/{bill['id']}", headers=H(admin_token))


# ---------------- 11. Staff role restrictions ----------------
class TestStaffRestrictions:
    def test_staff_can_login(self, s):
        d = _login(s, STAFF_EMAIL, STAFF_PASSWORD)
        assert d["user"]["role"] == "staff"

    def test_staff_cannot_manage_users(self, s, staff_token):
        r = s.get(f"{API}/auth/users", headers=H(staff_token))
        assert r.status_code == 403

    def test_staff_cannot_update_tenant(self, s, staff_token):
        r = s.put(f"{API}/tenants/me", headers=H(staff_token), json={"business_name": "hacked"})
        assert r.status_code == 403

    def test_staff_can_create_bill(self, s, admin_token, staff_token):
        rs = s.get(f"{API}/services", headers=H(admin_token))
        svc = rs.json()[0]
        payload = {
            "customer_name": "TEST Staff Bill",
            "customer_phone": "9990001111",
            "items": [{
                "service_id": svc["id"], "service_name": svc["name"],
                "price": svc["price"], "discount_pct": 0,
                "beautician_id": None, "beautician_name": "Test",
                "tip_amount": 0,
            }],
            "payment_mode": "cash",
            "is_member": False,
        }
        r = s.post(f"{API}/bills", headers=H(staff_token), json=payload)
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        # Cleanup with admin
        s.delete(f"{API}/bills/{bid}", headers=H(admin_token))


# ---------------- 12. Session-end cleanup ----------------
def teardown_module(module):
    """Best-effort cleanup: remove TEST tenant, services, users created during test run."""
    try:
        sess = requests.Session()
        r = sess.post(f"{API}/auth/login", json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD})
        if r.status_code != 200:
            return
        tok = r.json()["token"]
        rl = sess.get(f"{API}/platform/tenants", headers=H(tok))
        if rl.status_code != 200:
            return
        for t in rl.json():
            if t["business_name"].startswith("TEST ") or t["business_name"] == "TEST Updated Name":
                sess.delete(f"{API}/platform/tenants/{t['id']}", headers=H(tok))
    except Exception:
        pass
