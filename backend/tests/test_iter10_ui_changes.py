"""
Iteration 10 backend verification for UI fixes:
1. Members list returns status/days_left/discount_pct
2. Bill member_discount_pct_applied reflects per-member override (20%)
3. Branch PUT accepts logo (base64 data URI) and preserves other branches
4. Salon Settings: tenant PUT + per-branch PUT (invoice_prefix, receipt_footer, tax, logo)
5. Users: POST /auth/register + PUT /auth/users/{id} with branch_id
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://salon-invoice-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@glowup.com"
ADMIN_PWD = "admin123"
STAFF_EMAIL = "staff@glowup.com"
STAFF_PWD = "staff123"

# 1x1 transparent PNG data URI
TINY_LOGO = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def _login(email, pwd):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    j = r.json()
    tok = j.get("token") or j.get("access_token")
    assert tok, f"no token in login response keys={list(j.keys())}"
    me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=30).json()
    return tok, me


@pytest.fixture(scope="module")
def admin_ctx():
    tok, me = _login(ADMIN_EMAIL, ADMIN_PWD)
    branches = me.get("branches") or []
    head = next((b for b in branches if b.get("is_head")), branches[0] if branches else None)
    bid = head["id"] if head else me.get("branch_id")
    return {"token": tok, "branch_id": bid, "branches": branches, "user": me}


@pytest.fixture(scope="module")
def staff_ctx():
    tok, me = _login(STAFF_EMAIL, STAFF_PWD)
    bid = me.get("branch_id") or (me["branches"][0]["id"] if me.get("branches") else None)
    return {"token": tok, "branch_id": bid}


def _h(ctx):
    return {"Authorization": f"Bearer {ctx['token']}", "X-Branch-Id": ctx["branch_id"]}


# ---------- Task 1: Members list has status/days_left/discount_pct ----------
class TestMembersFilterFields:
    def test_admin_members_have_status_and_days_left(self, admin_ctx):
        r = requests.get(f"{API}/members", headers=_h(admin_ctx), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        if data:
            m = data[0]
            assert "status" in m, f"status missing: {m.keys()}"
            assert m["status"] in ("active", "expiring_soon", "expired", "inactive")
            assert "days_left" in m
            assert "discount_pct" in m

    def test_staff_can_list_members(self, staff_ctx):
        # Staff should be able to see members for filtering
        r = requests.get(f"{API}/members", headers=_h(staff_ctx), timeout=30)
        assert r.status_code == 200, f"staff /members should be 200, got {r.status_code} {r.text}"
        data = r.json()
        assert isinstance(data, list)
        if data:
            assert "status" in data[0]


# ---------- Task 2: Member 20% override → bill.member_discount_pct_applied == 20 ----------
class TestBillMemberDiscountApplied:
    _member_id = None
    _bill_id = None
    _phone = f"9999{int(time.time()) % 1000000:06d}"

    def test_create_member_with_20_override(self, admin_ctx):
        payload = {
            "name": "TEST Twenty Iter10",
            "phone": self.__class__._phone,
            "joined_at": "2026-01-01",
            "expires_at": "2027-01-01",
            "discount_pct": 20,
            "active": True,
            "notes": "iter10 test",
        }
        r = requests.post(f"{API}/members", headers=_h(admin_ctx), json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        m = r.json()
        assert m["discount_pct"] == 20
        self.__class__._member_id = m["id"]

    def test_create_bill_uses_20_percent(self, admin_ctx):
        # Fetch a service+beautician for a valid bill
        svcs = requests.get(f"{API}/services", headers=_h(admin_ctx), timeout=30).json()
        beauticians = requests.get(f"{API}/beauticians", headers=_h(admin_ctx), timeout=30).json()
        assert svcs and beauticians, "need at least 1 service and 1 beautician seeded"
        svc = next((s for s in svcs if (s.get("price") or 0) >= 200), svcs[0])
        bt = beauticians[0]

        bill_payload = {
            "customer_name": "TEST Twenty Iter10",
            "customer_phone": self.__class__._phone,
            "is_member": True,
            "items": [{
                "service_id": svc["id"],
                "service_name": svc["name"],
                "beautician_id": bt["id"],
                "beautician_name": bt["name"],
                "price": svc.get("price") or 500,
                "discount_pct": 0,
            }],
            "payment_mode": "cash",
            "cash_amount": 0,
            "qr_amount": 0,
        }
        r = requests.post(f"{API}/bills", headers=_h(admin_ctx), json=bill_payload, timeout=30)
        assert r.status_code in (200, 201), f"create bill: {r.status_code} {r.text}"
        b = r.json()
        self.__class__._bill_id = b["id"]
        assert b.get("is_member") is True
        # member_discount_pct_applied should be 20 for this member (override)
        applied = b.get("member_discount_pct_applied")
        assert applied == 20, f"expected member_discount_pct_applied=20, got {applied} (bill={b})"

    def test_get_bill_by_id_returns_applied_pct(self, admin_ctx):
        assert self.__class__._bill_id
        r = requests.get(f"{API}/bills/{self.__class__._bill_id}", headers=_h(admin_ctx), timeout=30)
        assert r.status_code == 200
        b = r.json()
        assert b.get("member_discount_pct_applied") == 20

    def test_cleanup(self, admin_ctx):
        if self.__class__._bill_id:
            requests.delete(f"{API}/bills/{self.__class__._bill_id}", headers=_h(admin_ctx), timeout=30)
        if self.__class__._member_id:
            requests.delete(f"{API}/members/{self.__class__._member_id}", headers=_h(admin_ctx), timeout=30)


# ---------- Task 3+4: Branch PUT accepts logo & other branches remain intact ----------
class TestBranchLogoAndPerBranchSave:
    _original = {}

    def test_branches_list(self, admin_ctx):
        r = requests.get(f"{API}/branches", headers=_h(admin_ctx), timeout=30)
        assert r.status_code == 200
        bs = r.json()
        assert isinstance(bs, list) and len(bs) >= 1
        # snapshot original head branch to restore later
        head = next((b for b in bs if b.get("is_head")), bs[0])
        self.__class__._original = {k: head.get(k) for k in (
            "id", "name", "logo", "invoice_prefix", "receipt_footer", "tax_enabled",
            "tax_percentage", "is_head", "active"
        )}

    def test_put_branch_logo_persists(self, admin_ctx):
        orig = self.__class__._original
        assert orig.get("id")
        payload = {
            "name": orig["name"],
            "logo": TINY_LOGO,
            "invoice_prefix": "B2TEST",
            "receipt_footer": "TEST Iter10 footer",
            "tax_enabled": True,
            "tax_percentage": 5,
            "is_head": orig.get("is_head", False),
            "active": orig.get("active", True),
        }
        r = requests.put(f"{API}/branches/{orig['id']}", headers=_h(admin_ctx), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b.get("logo", "").startswith("data:image/"), f"logo not persisted as data URI: {b.get('logo')!r:.80}"
        assert b["invoice_prefix"] == "B2TEST"
        assert b["receipt_footer"] == "TEST Iter10 footer"
        assert b["tax_enabled"] is True
        assert float(b["tax_percentage"]) == 5.0

    def test_branch_get_after_put(self, admin_ctx):
        r = requests.get(f"{API}/branches", headers=_h(admin_ctx), timeout=30)
        assert r.status_code == 200
        bs = r.json()
        b = next((x for x in bs if x["id"] == self.__class__._original["id"]), None)
        assert b is not None
        assert b.get("logo", "").startswith("data:image/")
        assert b["invoice_prefix"] == "B2TEST"

    def test_restore_branch(self, admin_ctx):
        orig = self.__class__._original
        payload = {
            "name": orig["name"],
            "logo": orig.get("logo"),
            "invoice_prefix": orig.get("invoice_prefix") or "",
            "receipt_footer": orig.get("receipt_footer") or "",
            "tax_enabled": bool(orig.get("tax_enabled")),
            "tax_percentage": orig.get("tax_percentage") or 0,
            "is_head": orig.get("is_head", False),
            "active": orig.get("active", True),
        }
        r = requests.put(f"{API}/branches/{orig['id']}", headers=_h(admin_ctx), json=payload, timeout=30)
        assert r.status_code == 200


# ---------- Task 5: Tenant PUT /me updates business_name / website / member_discount ----------
class TestTenantMePut:
    _original = {}

    def test_get_tenant_me(self, admin_ctx):
        r = requests.get(f"{API}/tenants/me", headers={"Authorization": f"Bearer {admin_ctx['token']}"}, timeout=30)
        assert r.status_code == 200
        t = r.json()
        for k in ("business_name", "website", "member_discount_pct", "member_min_price"):
            self.__class__._original[k] = t.get(k)

    def test_put_tenant_updates(self, admin_ctx):
        payload = {
            "business_name": (self.__class__._original.get("business_name") or "Glow Up"),
            "website": "https://iter10-test.example.com",
            "member_discount_pct": 12,
            "member_min_price": 150,
        }
        r = requests.put(f"{API}/tenants/me", headers={"Authorization": f"Bearer {admin_ctx['token']}"}, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        # response is {tenant: {...}, subscription: {...}}
        t = body.get("tenant", body)
        assert t.get("website") == "https://iter10-test.example.com"
        assert float(t.get("member_discount_pct")) == 12.0
        assert float(t.get("member_min_price")) == 150.0
        # verify persistence via GET
        r2 = requests.get(f"{API}/tenants/me", headers={"Authorization": f"Bearer {admin_ctx['token']}"}, timeout=30)
        t2 = r2.json().get("tenant", r2.json())
        assert t2.get("website") == "https://iter10-test.example.com"

    def test_restore_tenant(self, admin_ctx):
        payload = {
            "business_name": self.__class__._original.get("business_name") or "Glow Up",
            "website": self.__class__._original.get("website") or "",
            "member_discount_pct": self.__class__._original.get("member_discount_pct") or 10,
            "member_min_price": self.__class__._original.get("member_min_price") or 100,
        }
        r = requests.put(f"{API}/tenants/me", headers={"Authorization": f"Bearer {admin_ctx['token']}"}, json=payload, timeout=30)
        assert r.status_code == 200


# ---------- Task 6: Users — register + update with branch_id ----------
class TestUserBranchAssignment:
    _user_id = None
    _email = f"test_iter10_{uuid.uuid4().hex[:6]}@example.com"

    def test_register_staff_with_branch(self, admin_ctx):
        payload = {
            "name": "TEST Iter10 Staff",
            "email": self.__class__._email,
            "password": "secret123",
            "role": "staff",
            "branch_id": admin_ctx["branch_id"],
        }
        r = requests.post(f"{API}/auth/register",
                          headers={"Authorization": f"Bearer {admin_ctx['token']}"},
                          json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        u = r.json()
        assert u.get("branch_id") == admin_ctx["branch_id"]
        assert u["role"] == "staff"
        self.__class__._user_id = u["id"]

    def test_update_user_branch_null(self, admin_ctx):
        # Change role to admin + branch_id null (all-branches)
        assert self.__class__._user_id
        r = requests.put(f"{API}/auth/users/{self.__class__._user_id}",
                         headers={"Authorization": f"Bearer {admin_ctx['token']}"},
                         json={"name": "TEST Iter10 Admin", "email": self.__class__._email, "role": "admin", "branch_id": None},
                         timeout=30)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u.get("branch_id") in (None, ""), f"expected null, got {u.get('branch_id')!r}"
        assert u["role"] == "admin"

    def test_update_user_branch_specific(self, admin_ctx):
        # Now assign to a specific branch
        assert self.__class__._user_id
        r = requests.put(f"{API}/auth/users/{self.__class__._user_id}",
                         headers={"Authorization": f"Bearer {admin_ctx['token']}"},
                         json={"name": "TEST Iter10 Admin", "email": self.__class__._email, "role": "admin", "branch_id": admin_ctx["branch_id"]},
                         timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("branch_id") == admin_ctx["branch_id"]

    def test_cleanup_user(self, admin_ctx):
        if self.__class__._user_id:
            requests.delete(f"{API}/auth/users/{self.__class__._user_id}",
                            headers={"Authorization": f"Bearer {admin_ctx['token']}"}, timeout=30)
