"""
Iteration 8: Tests for 6 fixes applied to ParlourPilot backend
- Service tax_percentage per-service (Issue #5)
- Member per-member discount_pct override (Issue #6)
- /api/members/lookup returns effective_discount_pct
- Bill applies per-member discount, per-line tax, correct grand_total
- Split payment validated against services_net + tax_amount
- update_bill mirrors create_bill behavior
- Tenant isolation smoke check
"""
import os
import pytest
import requests
import uuid

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://salon-invoice-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@glowup.com"
ADMIN_PASSWORD = "admin123"


# ============ Fixtures ============
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def tenant_defaults(admin_headers):
    r = requests.get(f"{API}/tenants/me", headers=admin_headers, timeout=30)
    assert r.status_code == 200
    t = r.json()["tenant"]
    return {
        "member_discount_pct": t.get("member_discount_pct") or 10.0,
        "member_min_price": t.get("member_min_price") or 100.0,
    }


@pytest.fixture(scope="module")
def signup_second_tenant():
    """Signup a fresh tenant for isolation testing."""
    email = f"iso_{uuid.uuid4().hex[:8]}@testsalon.com"
    payload = {
        "business_name": f"TEST_Iso_{uuid.uuid4().hex[:6]}",
        "owner_name": "TEST Iso",
        "email": email,
        "password": "isopass123",
    }
    r = requests.post(f"{API}/tenants/signup", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    return {"token": r.json()["token"], "email": email}


# ============ Issue #5: Service tax_percentage ============
class TestServiceTaxPercentage:
    def test_create_service_with_tax_percentage(self, admin_headers):
        payload = {"name": f"TEST_TaxService_{uuid.uuid4().hex[:6]}", "price": 1000.0, "tax_percentage": 18, "category": "TEST"}
        r = requests.post(f"{API}/services", json=payload, headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["tax_percentage"] == 18.0, f"Expected 18.0, got {data.get('tax_percentage')}"
        assert data["name"] == payload["name"]
        # Cleanup
        requests.delete(f"{API}/services/{data['id']}", headers=admin_headers, timeout=30)

    def test_service_default_tax_percentage_zero(self, admin_headers):
        payload = {"name": f"TEST_NoTax_{uuid.uuid4().hex[:6]}", "price": 500.0}
        r = requests.post(f"{API}/services", json=payload, headers=admin_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["tax_percentage"] == 0.0
        requests.delete(f"{API}/services/{data['id']}", headers=admin_headers, timeout=30)

    def test_update_service_tax_percentage(self, admin_headers):
        # Create
        payload = {"name": f"TEST_UpdTax_{uuid.uuid4().hex[:6]}", "price": 500.0, "tax_percentage": 5}
        r = requests.post(f"{API}/services", json=payload, headers=admin_headers, timeout=30)
        assert r.status_code == 200
        sid = r.json()["id"]
        # Update
        upd = {"name": payload["name"], "price": 500.0, "tax_percentage": 12, "active": True}
        r2 = requests.put(f"{API}/services/{sid}", json=upd, headers=admin_headers, timeout=30)
        assert r2.status_code == 200, r2.text
        assert r2.json()["tax_percentage"] == 12.0
        # Verify via GET list
        r3 = requests.get(f"{API}/services", headers=admin_headers, timeout=30)
        found = [s for s in r3.json() if s["id"] == sid]
        assert found and found[0]["tax_percentage"] == 12.0
        requests.delete(f"{API}/services/{sid}", headers=admin_headers, timeout=30)


# ============ Issue #6: Member discount_pct override ============
class TestMemberDiscountOverride:
    def _make_member(self, admin_headers, discount_pct=None, phone=None):
        phone = phone or f"9{uuid.uuid4().int % 10**9:09d}"
        payload = {
            "name": f"TEST_Member_{uuid.uuid4().hex[:6]}",
            "phone": phone,
            "discount_pct": discount_pct,
            "active": True,
        }
        r = requests.post(f"{API}/members", json=payload, headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        return r.json()

    def test_create_member_with_discount_pct(self, admin_headers):
        m = self._make_member(admin_headers, discount_pct=20)
        try:
            assert m["discount_pct"] == 20.0, f"Expected 20.0, got {m.get('discount_pct')}"
        finally:
            requests.delete(f"{API}/members/{m['id']}", headers=admin_headers, timeout=30)

    def test_create_member_without_discount_pct_null(self, admin_headers):
        m = self._make_member(admin_headers, discount_pct=None)
        try:
            assert m["discount_pct"] is None, f"Expected null, got {m.get('discount_pct')}"
        finally:
            requests.delete(f"{API}/members/{m['id']}", headers=admin_headers, timeout=30)

    def test_lookup_member_effective_discount_override(self, admin_headers):
        m = self._make_member(admin_headers, discount_pct=20)
        try:
            r = requests.get(f"{API}/members/lookup", params={"phone": m["phone"]}, headers=admin_headers, timeout=30)
            assert r.status_code == 200
            data = r.json()
            assert data["found"] is True
            assert data["member"]["effective_discount_pct"] == 20.0
        finally:
            requests.delete(f"{API}/members/{m['id']}", headers=admin_headers, timeout=30)

    def test_lookup_member_effective_discount_tenant_default(self, admin_headers, tenant_defaults):
        m = self._make_member(admin_headers, discount_pct=None)
        try:
            r = requests.get(f"{API}/members/lookup", params={"phone": m["phone"]}, headers=admin_headers, timeout=30)
            assert r.status_code == 200
            data = r.json()
            assert data["found"] is True
            expected = float(tenant_defaults["member_discount_pct"])
            assert data["member"]["effective_discount_pct"] == expected, \
                f"Expected tenant default {expected}, got {data['member']['effective_discount_pct']}"
        finally:
            requests.delete(f"{API}/members/{m['id']}", headers=admin_headers, timeout=30)

    def test_update_member_discount_pct(self, admin_headers):
        m = self._make_member(admin_headers, discount_pct=15)
        try:
            upd = {"name": m["name"], "phone": m["phone"], "discount_pct": 25, "active": True,
                   "joined_at": m.get("joined_at"), "expires_at": m.get("expires_at")}
            r = requests.put(f"{API}/members/{m['id']}", json=upd, headers=admin_headers, timeout=30)
            assert r.status_code == 200, r.text
            assert r.json()["discount_pct"] == 25.0
        finally:
            requests.delete(f"{API}/members/{m['id']}", headers=admin_headers, timeout=30)


# ============ Bill: member override + per-line tax ============
class TestBillTaxAndMemberDiscount:
    def _create_beautician(self, admin_headers):
        r = requests.post(f"{API}/beauticians", json={"name": f"TEST_B_{uuid.uuid4().hex[:6]}", "role": "Stylist"},
                          headers=admin_headers, timeout=30)
        assert r.status_code == 200
        return r.json()

    def _cleanup_bill(self, admin_headers, bill_id):
        requests.delete(f"{API}/bills/{bill_id}", headers=admin_headers, timeout=30)

    def test_bill_applies_member_override_discount(self, admin_headers):
        # Setup: create a member with 20% override
        phone = f"9{uuid.uuid4().int % 10**9:09d}"
        m = requests.post(f"{API}/members",
                          json={"name": "TEST_VIP", "phone": phone, "discount_pct": 20, "active": True},
                          headers=admin_headers, timeout=30).json()
        b = self._create_beautician(admin_headers)
        try:
            bill_payload = {
                "customer_name": "TEST Customer",
                "customer_phone": phone,
                "items": [{
                    "service_name": "Haircut", "price": 1000, "discount_pct": 0,
                    "tax_percentage": 0,
                    "beautician_id": b["id"], "beautician_name": b["name"],
                }],
                "payment_mode": "cash",
                "is_member": True,
            }
            r = requests.post(f"{API}/bills", json=bill_payload, headers=admin_headers, timeout=30)
            assert r.status_code == 200, r.text
            bill = r.json()
            assert bill["member_discount_pct_applied"] == 20.0, \
                f"Expected 20.0, got {bill.get('member_discount_pct_applied')}"
            # 1000 - 20% = 800
            assert bill["services_net"] == 800.0
            assert bill["items"][0]["effective_discount_pct"] == 20.0
            self._cleanup_bill(admin_headers, bill["id"])
        finally:
            requests.delete(f"{API}/members/{m['id']}", headers=admin_headers, timeout=30)
            requests.delete(f"{API}/beauticians/{b['id']}", headers=admin_headers, timeout=30)

    def test_bill_with_per_line_tax(self, admin_headers):
        # Setup: create a member with 20% override
        phone = f"9{uuid.uuid4().int % 10**9:09d}"
        m = requests.post(f"{API}/members",
                          json={"name": "TEST_VIP2", "phone": phone, "discount_pct": 20, "active": True},
                          headers=admin_headers, timeout=30).json()
        b = self._create_beautician(admin_headers)
        try:
            # Example: item price 1000, discount 20%, tax 18% → services_net 800, tax 144, grand_total 944
            bill_payload = {
                "customer_name": "TEST",
                "customer_phone": phone,
                "items": [{
                    "service_name": "Facial", "price": 1000, "discount_pct": 0,
                    "tax_percentage": 18,
                    "beautician_id": b["id"], "beautician_name": b["name"],
                }],
                "payment_mode": "cash",
                "is_member": True,
            }
            r = requests.post(f"{API}/bills", json=bill_payload, headers=admin_headers, timeout=30)
            assert r.status_code == 200, r.text
            bill = r.json()
            assert bill["services_net"] == 800.0, f"services_net expected 800, got {bill['services_net']}"
            assert bill["tax_amount"] == 144.0, f"tax_amount expected 144, got {bill['tax_amount']}"
            assert bill["grand_total"] == 944.0, f"grand_total expected 944, got {bill['grand_total']}"
            self._cleanup_bill(admin_headers, bill["id"])
        finally:
            requests.delete(f"{API}/members/{m['id']}", headers=admin_headers, timeout=30)
            requests.delete(f"{API}/beauticians/{b['id']}", headers=admin_headers, timeout=30)

    def test_bill_split_payment_validates_against_net_plus_tax(self, admin_headers):
        b = self._create_beautician(admin_headers)
        try:
            # item 1000, discount 0, tax 18% → services_net=1000, tax=180, payable=1180
            bill_payload = {
                "customer_name": "TEST",
                "items": [{
                    "service_name": "Massage", "price": 1000, "discount_pct": 0,
                    "tax_percentage": 18,
                    "beautician_id": b["id"], "beautician_name": b["name"],
                }],
                "payment_mode": "split",
                "cash_amount": 500,
                "qr_amount": 680,  # 500+680=1180
                "is_member": False,
            }
            r = requests.post(f"{API}/bills", json=bill_payload, headers=admin_headers, timeout=30)
            assert r.status_code == 200, f"Expected success with correct split, got {r.status_code}: {r.text}"
            bill = r.json()
            assert bill["tax_amount"] == 180.0
            assert bill["grand_total"] == 1180.0
            self._cleanup_bill(admin_headers, bill["id"])

            # Now try invalid split (against services_net only, ignoring tax)
            bad = dict(bill_payload)
            bad["cash_amount"] = 500
            bad["qr_amount"] = 500  # total 1000, would be OK if ignoring tax; should fail
            r2 = requests.post(f"{API}/bills", json=bad, headers=admin_headers, timeout=30)
            assert r2.status_code == 400, f"Expected 400, got {r2.status_code}: {r2.text}"
            assert "1180" in r2.text, f"Error should mention payable 1180: {r2.text}"
        finally:
            requests.delete(f"{API}/beauticians/{b['id']}", headers=admin_headers, timeout=30)

    def test_bill_non_member_uses_tenant_default(self, admin_headers, tenant_defaults):
        b = self._create_beautician(admin_headers)
        try:
            bill_payload = {
                "customer_name": "TEST Walk-in",
                "customer_phone": "",
                "items": [{
                    "service_name": "Trim", "price": 500, "discount_pct": 0,
                    "tax_percentage": 0,
                    "beautician_id": b["id"], "beautician_name": b["name"],
                }],
                "payment_mode": "cash",
                "is_member": True,  # marked member but no matching phone
            }
            r = requests.post(f"{API}/bills", json=bill_payload, headers=admin_headers, timeout=30)
            assert r.status_code == 200, r.text
            bill = r.json()
            # member_discount_pct_applied should be null (no override found)
            assert bill["member_discount_pct_applied"] is None
            # Effective discount should be tenant default (10)
            expected_pct = float(tenant_defaults["member_discount_pct"])
            assert bill["items"][0]["effective_discount_pct"] == expected_pct
            self._cleanup_bill(admin_headers, bill["id"])
        finally:
            requests.delete(f"{API}/beauticians/{b['id']}", headers=admin_headers, timeout=30)

    def test_update_bill_recomputes_tax_and_member_override(self, admin_headers):
        # Setup: member with 15% override
        phone = f"9{uuid.uuid4().int % 10**9:09d}"
        m = requests.post(f"{API}/members",
                          json={"name": "TEST_VIP3", "phone": phone, "discount_pct": 15, "active": True},
                          headers=admin_headers, timeout=30).json()
        b = self._create_beautician(admin_headers)
        try:
            # First create simple bill
            create_payload = {
                "customer_name": "TEST", "customer_phone": phone,
                "items": [{
                    "service_name": "Cut", "price": 500, "discount_pct": 0,
                    "tax_percentage": 0,
                    "beautician_id": b["id"], "beautician_name": b["name"],
                }],
                "payment_mode": "cash", "is_member": False,
            }
            r = requests.post(f"{API}/bills", json=create_payload, headers=admin_headers, timeout=30)
            assert r.status_code == 200
            bill_id = r.json()["id"]

            # Now update: add tax, set is_member=True → should use 15% override
            update_payload = dict(create_payload)
            update_payload["is_member"] = True
            update_payload["items"] = [{
                "service_name": "Cut", "price": 1000, "discount_pct": 0,
                "tax_percentage": 10,
                "beautician_id": b["id"], "beautician_name": b["name"],
            }]
            # 1000 - 15% = 850, tax 10% of 850 = 85, grand = 935
            update_payload["payment_mode"] = "cash"
            r2 = requests.put(f"{API}/bills/{bill_id}", json=update_payload, headers=admin_headers, timeout=30)
            assert r2.status_code == 200, r2.text
            updated = r2.json()
            assert updated["services_net"] == 850.0, f"got {updated['services_net']}"
            assert updated["tax_amount"] == 85.0, f"got {updated['tax_amount']}"
            assert updated["grand_total"] == 935.0
            assert updated["member_discount_pct_applied"] == 15.0
            self._cleanup_bill(admin_headers, bill_id)
        finally:
            requests.delete(f"{API}/members/{m['id']}", headers=admin_headers, timeout=30)
            requests.delete(f"{API}/beauticians/{b['id']}", headers=admin_headers, timeout=30)


# ============ Tenant isolation smoke ============
class TestTenantIsolation:
    def test_second_tenant_cannot_see_glowup_services(self, signup_second_tenant, admin_headers):
        # Create a service in Glow Up
        p = {"name": f"TEST_IsoSvc_{uuid.uuid4().hex[:6]}", "price": 100, "tax_percentage": 5}
        r = requests.post(f"{API}/services", json=p, headers=admin_headers, timeout=30)
        assert r.status_code == 200
        sid = r.json()["id"]
        try:
            other_headers = {"Authorization": f"Bearer {signup_second_tenant['token']}"}
            r2 = requests.get(f"{API}/services", headers=other_headers, timeout=30)
            assert r2.status_code == 200
            other_services = r2.json()
            # Should not include Glow Up's service
            assert not any(s["id"] == sid for s in other_services), \
                "TENANT LEAK: second tenant sees Glow Up services!"
        finally:
            requests.delete(f"{API}/services/{sid}", headers=admin_headers, timeout=30)
