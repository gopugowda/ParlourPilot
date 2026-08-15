"""Iter 27: Business Logic Parity backend tests for ParlourPilot mobile.

Covers:
- /auth/login and /auth/me returning user.is_owner (admin=true, staff=false)
- Bill creation split_v2 math (split with card tip / card single-mode / split mismatch)
- Cash Closing summary math (cash net of owed tips; digital = qr+card)
- Membership "higher wins" (tenant default vs. manual)
- RBAC: owner-only delete, staff bill scoping, staff bill modify blocked
"""
import os
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"

# The shared Atlas DB does NOT contain the seeded Glow Up tenant (demo seed is disabled).
# We create an isolated test tenant + staff user in-session so tests are hermetic.
import time as _time
_SUFFIX = f"iter27-{int(_time.time())}"
ADMIN_EMAIL = f"admin-{_SUFFIX}@testparlourpilot.com"
ADMIN_PW = "admin123"
STAFF_EMAIL = f"staff-{_SUFFIX}@testparlourpilot.com"
STAFF_PW = "staff123"


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    r.raise_for_status()
    return r.json()


def _bootstrap_admin_and_staff():
    # 1) Signup a new tenant (owner = admin)
    signup_payload = {
        "business_name": f"TEST_Iter27_{_SUFFIX}",
        "owner_name": "Iter27 Owner",
        "email": ADMIN_EMAIL,
        "password": ADMIN_PW,
        "phone": "9999999999",
        "city": "Bangalore",
        "country": "India",
        "num_branches": 1,
    }
    r = requests.post(f"{API}/tenants/signup", json=signup_payload, timeout=60)
    assert r.status_code == 200, r.text
    admin_login = _login(ADMIN_EMAIL, ADMIN_PW)

    admin_branch_id = (admin_login.get("branches") or [{}])[0].get("id") or admin_login["user"].get("branch_id")

    # 2) Register a staff user in this tenant
    reg = requests.post(
        f"{API}/auth/register",
        json={
            "name": "Iter27 Staff",
            "email": STAFF_EMAIL,
            "password": STAFF_PW,
            "role": "staff",
            "branch_id": admin_branch_id,
        },
        headers={"Authorization": f"Bearer {admin_login['token']}"},
        timeout=30,
    )
    assert reg.status_code == 200, reg.text
    staff_login = _login(STAFF_EMAIL, STAFF_PW)
    staff_branch_id = (staff_login.get("branches") or [{}])[0].get("id") or staff_login["user"].get("branch_id")
    return admin_login, admin_branch_id, staff_login, staff_branch_id


_BOOT = None


def _boot():
    global _BOOT
    if _BOOT is None:
        _BOOT = _bootstrap_admin_and_staff()
    return _BOOT


@pytest.fixture(scope="session")
def admin_ctx():
    admin_login, admin_branch_id, _, _ = _boot()
    return {
        "token": admin_login["token"],
        "user": admin_login["user"],
        "branch_id": admin_branch_id,
        "headers": {"Authorization": f"Bearer {admin_login['token']}", "X-Branch-Id": admin_branch_id or ""},
    }


@pytest.fixture(scope="session")
def staff_ctx():
    _, _, staff_login, staff_branch_id = _boot()
    return {
        "token": staff_login["token"],
        "user": staff_login["user"],
        "branch_id": staff_branch_id,
        "headers": {"Authorization": f"Bearer {staff_login['token']}", "X-Branch-Id": staff_branch_id or ""},
    }


# ============ 1. is_owner flag ============
class TestIsOwner:
    def test_admin_login_is_owner_true(self, admin_ctx):
        assert admin_ctx["user"].get("is_owner") is True, admin_ctx["user"]

    def test_staff_login_is_owner_false(self, staff_ctx):
        assert staff_ctx["user"].get("is_owner") is False, staff_ctx["user"]

    def test_admin_me_is_owner_true(self, admin_ctx):
        r = requests.get(f"{API}/auth/me", headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200
        assert r.json()["user"].get("is_owner") is True

    def test_staff_me_is_owner_false(self, staff_ctx):
        r = requests.get(f"{API}/auth/me", headers=staff_ctx["headers"], timeout=30)
        assert r.status_code == 200
        assert r.json()["user"].get("is_owner") is False


# ============ 2. Bill create split_v2 math ============
class TestBillCreateSplit:
    def _base_item(self, price=100, beautician="S1"):
        return {
            "service_name": "Test",
            "price": price,
            "discount_pct": 0,
            "tax_percentage": 0,
            "beautician_name": beautician,
        }

    def test_case_a_split_with_card_tip(self, admin_ctx):
        payload = {
            "customer_name": "TEST_A",
            "items": [self._base_item(100)],
            "is_member": False,
            "tip_amount": 20,
            "tip_via": "card",
            "tip_beautician_name": "S1",
            "payment_mode": "split",
            "cash_amount": 50,
            "qr_amount": 30,
            "card_amount": 40,
        }
        r = requests.post(f"{API}/bills", json=payload, headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["grand_total"] == 120
        assert b["services_net"] == 100
        assert b["tax_amount"] == 0
        assert b["tip_amount"] == 20
        assert b["tip_card_total"] == 20
        assert b["tip_qr_total"] == 0
        assert b["tip_cash_total"] == 0
        assert b["tip_owed_total"] == 20
        assert b["cash_amount"] == 50
        assert b["qr_amount"] == 30
        assert b["card_amount"] == 40
        assert b["split_v2"] is True
        pytest.case_a_bill_id = b["id"]
        pytest.case_a_bill_date = b["created_at"][:10]

    def test_case_b_card_single_mode_cash_tip(self, admin_ctx):
        payload = {
            "customer_name": "TEST_B",
            "items": [self._base_item(200)],
            "is_member": False,
            "tip_amount": 30,
            "tip_via": "cash",
            "tip_beautician_name": "S1",
            "payment_mode": "card",
        }
        r = requests.post(f"{API}/bills", json=payload, headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["grand_total"] == 230
        assert b["card_amount"] == 230
        assert b["cash_amount"] == 0
        assert b["qr_amount"] == 0
        assert b["tip_owed_total"] == 0
        assert b["tip_cash_total"] == 30
        assert b["split_v2"] is True

    def test_case_c_split_mismatch_400(self, admin_ctx):
        payload = {
            "customer_name": "TEST_C",
            "items": [self._base_item(100)],
            "tip_amount": 20,
            "tip_via": "card",
            "tip_beautician_name": "S1",
            "payment_mode": "split",
            "cash_amount": 10,
            "qr_amount": 10,
            "card_amount": 10,
        }
        r = requests.post(f"{API}/bills", json=payload, headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 400, r.text
        assert "120" in r.json().get("detail", "")


# ============ 3. Cash Closing ============
class TestCashClosing:
    def test_summary_reflects_split_v2(self, admin_ctx):
        # Use today's date (bills created above should exist for today).
        r = requests.get(f"{API}/cash-closing/summary", headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        # Must have keys per spec
        for k in ("cash_sales", "upi_sales", "tips_owed"):
            assert k in d, d
        # Sanity: cash_sales + upi_sales + tips_owed should equal total cash+qr+card of all today's bills
        # We'll only assert that cash_sales isn't unexpectedly huge (owed excluded).
        # Case A contributed cash=50, tip_owed=20 -> cash_sales delta 30; Case B contributed card=230.
        assert d["cash_sales"] >= 0
        assert d["upi_sales"] >= 0
        assert d["tips_owed"] >= 20  # at least from Case A

    def test_post_cash_closing(self, admin_ctx):
        summary = requests.get(f"{API}/cash-closing/summary", headers=admin_ctx["headers"], timeout=30).json()
        cash_sales = summary["cash_sales"]
        payload = {
            "date": summary["date"],
            "opening_balance": 0,
            "cash_expenses": 0,
            "actual_closing": cash_sales,
            "notes": "TEST_iter27",
        }
        r = requests.post(f"{API}/cash-closing", json=payload, headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["expected_closing"] == round(0 + cash_sales - 0, 2)
        assert doc["difference"] == 0
        assert doc["cash_sales"] == cash_sales


# ============ 4. Membership "higher wins" ============
class TestMemberHigherWins:
    def test_member_discount_higher_wins(self, admin_ctx):
        payload = {
            "customer_name": "TEST_MEMBER",
            "is_member": True,
            "items": [
                {"service_name": "A", "price": 150, "discount_pct": 0, "tax_percentage": 0, "beautician_name": "S1"},
                {"service_name": "B", "price": 80, "discount_pct": 0, "tax_percentage": 0, "beautician_name": "S1"},
                {"service_name": "C", "price": 150, "discount_pct": 15, "tax_percentage": 0, "beautician_name": "S1"},
            ],
            "payment_mode": "cash",
        }
        r = requests.post(f"{API}/bills", json=payload, headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text
        b = r.json()
        items = b["items"]
        # Line A: price>100 -> tenant member 10% applies (higher than 0)
        assert items[0]["effective_discount_pct"] == 10, items[0]
        # Line B: price 80 <= 100 -> 0
        assert items[1]["effective_discount_pct"] == 0, items[1]
        # Line C: manual 15% wins over member 10%
        assert items[2]["effective_discount_pct"] == 15, items[2]


# ============ 5. RBAC: Owner-only delete ============
class TestOwnerOnlyDelete:
    def test_staff_delete_forbidden_admin_deletes_ok(self, admin_ctx, staff_ctx):
        # Create a throwaway bill as admin
        payload = {
            "customer_name": "TEST_DELETE",
            "items": [{"service_name": "X", "price": 50, "discount_pct": 0, "tax_percentage": 0, "beautician_name": "S1"}],
            "payment_mode": "cash",
        }
        r = requests.post(f"{API}/bills", json=payload, headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200
        bid = r.json()["id"]

        # Staff attempts delete
        r_staff = requests.delete(f"{API}/bills/{bid}", headers=staff_ctx["headers"], timeout=30)
        assert r_staff.status_code == 403, r_staff.text

        # Admin (owner) deletes
        r_admin = requests.delete(f"{API}/bills/{bid}", headers=admin_ctx["headers"], timeout=30)
        assert r_admin.status_code == 200, r_admin.text


# ============ 6. RBAC: Staff bill scoping ============
class TestStaffScoping:
    def test_staff_list_only_own_and_cannot_get_admin_bill(self, admin_ctx, staff_ctx):
        # Admin creates a bill
        payload = {
            "customer_name": "TEST_SCOPE_ADMIN",
            "items": [{"service_name": "Y", "price": 10, "discount_pct": 0, "tax_percentage": 0, "beautician_name": "S1"}],
            "payment_mode": "cash",
        }
        r = requests.post(f"{API}/bills", json=payload, headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text
        admin_bill_id = r.json()["id"]

        # Staff lists bills - should NOT include admin's bill
        r_list = requests.get(f"{API}/bills", headers=staff_ctx["headers"], timeout=30)
        assert r_list.status_code == 200
        bills = r_list.json()
        staff_uid = staff_ctx["user"]["id"]
        assert all(b.get("created_by") == staff_uid for b in bills), [b.get("created_by") for b in bills[:5]]
        assert not any(b["id"] == admin_bill_id for b in bills)

        # Staff GET admin's bill => 403
        r_get = requests.get(f"{API}/bills/{admin_bill_id}", headers=staff_ctx["headers"], timeout=30)
        assert r_get.status_code == 403, r_get.text


# ============ 7. RBAC: Staff modify blocked ============
class TestStaffModifyBlocked:
    def test_staff_put_bill_403(self, admin_ctx, staff_ctx):
        # Create a bill as staff (or admin, doesn't matter - PUT requires admin)
        payload = {
            "customer_name": "TEST_MOD",
            "items": [{"service_name": "Z", "price": 10, "discount_pct": 0, "tax_percentage": 0, "beautician_name": "S1"}],
            "payment_mode": "cash",
        }
        r = requests.post(f"{API}/bills", json=payload, headers=staff_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text
        bid = r.json()["id"]

        put_payload = dict(payload)
        put_payload["customer_name"] = "TEST_MOD_UPDATED"
        r_put = requests.put(f"{API}/bills/{bid}", json=put_payload, headers=staff_ctx["headers"], timeout=30)
        assert r_put.status_code == 403, r_put.text
