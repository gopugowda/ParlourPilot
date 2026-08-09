"""Iteration 11 backend tests: platform password reset, /pricing, branch checkout, appointments CRUD, currency_symbol."""
import os
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://salon-invoice-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = ("admin@glowup.com", "admin123")
STAFF = ("staff@glowup.com", "staff123")
PLATFORM = ("platform@parlourpilot.com", "platform123")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("token") or data.get("access_token")
    assert tok, f"no token in login response: {data}"
    return tok, data.get("user") or {}


def H(token, branch_id=None):
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if branch_id:
        h["X-Branch-Id"] = branch_id
    return h


# ---------- Fixtures ----------
@pytest.fixture(scope="session")
def admin_ctx():
    tok, u = _login(*ADMIN)
    r = requests.get(f"{API}/branches", headers=H(tok), timeout=20)
    assert r.status_code == 200
    branches = r.json()
    head = next((b for b in branches if b.get("is_head")), branches[0])
    return {"token": tok, "user": u, "branches": branches, "head_branch_id": head["id"]}


@pytest.fixture(scope="session")
def staff_ctx():
    tok, u = _login(*STAFF)
    branch_id = u.get("branch_id")
    if not branch_id:
        # fallback: use head from admin ctx pattern
        atok, _ = _login(*ADMIN)
        rr = requests.get(f"{API}/branches", headers=H(atok), timeout=20).json()
        branch_id = next((b for b in rr if b.get("is_head")), rr[0])["id"]
    return {"token": tok, "user": u, "branch_id": branch_id}


@pytest.fixture(scope="session")
def platform_ctx():
    tok, u = _login(*PLATFORM)
    return {"token": tok, "user": u}


# ==================== 1. Platform reset-password ====================
class TestPlatformResetPassword:
    def _get_glowup_tid(self, ptok):
        r = requests.get(f"{API}/platform/tenants", headers=H(ptok), timeout=20)
        assert r.status_code == 200, r.text
        tenants = r.json()
        # Sometimes API returns {tenants:[...]} - handle both
        if isinstance(tenants, dict) and "tenants" in tenants:
            tenants = tenants["tenants"]
        glow = next(t for t in tenants if "glow" in (t.get("name") or "").lower() or t.get("id") == "glowup-tenant-0001")
        return glow["id"]

    def test_a_reset_owner_default(self, platform_ctx):
        tid = self._get_glowup_tid(platform_ctx["token"])
        r = requests.post(
            f"{API}/platform/tenants/{tid}/reset-password",
            headers=H(platform_ctx["token"]),
            json={"new_password": "temppw12"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("email") == "admin@glowup.com"
        # verify login with new password
        r2 = requests.post(f"{API}/auth/login", json={"email": "admin@glowup.com", "password": "temppw12"}, timeout=20)
        assert r2.status_code == 200, r2.text
        # reset back
        r3 = requests.post(
            f"{API}/platform/tenants/{tid}/reset-password",
            headers=H(platform_ctx["token"]),
            json={"new_password": "admin123"},
            timeout=20,
        )
        assert r3.status_code == 200
        # verify original login still works
        r4 = requests.post(f"{API}/auth/login", json={"email": "admin@glowup.com", "password": "admin123"}, timeout=20)
        assert r4.status_code == 200

    def test_b_reset_by_user_id(self, platform_ctx):
        tid = self._get_glowup_tid(platform_ctx["token"])
        # get staff user_id via platform users list
        r = requests.get(f"{API}/platform/tenants/{tid}/users", headers=H(platform_ctx["token"]), timeout=20)
        assert r.status_code == 200, r.text
        users = r.json().get("users") if isinstance(r.json(), dict) else r.json()
        staff_user = next(u for u in users if u["email"] == "staff@glowup.com")
        r2 = requests.post(
            f"{API}/platform/tenants/{tid}/reset-password",
            headers=H(platform_ctx["token"]),
            json={"user_id": staff_user["id"], "new_password": "temppw34"},
            timeout=20,
        )
        assert r2.status_code == 200, r2.text
        rlog = requests.post(f"{API}/auth/login", json={"email": "staff@glowup.com", "password": "temppw34"}, timeout=20)
        assert rlog.status_code == 200
        # reset back
        rback = requests.post(
            f"{API}/platform/tenants/{tid}/reset-password",
            headers=H(platform_ctx["token"]),
            json={"user_id": staff_user["id"], "new_password": "staff123"},
            timeout=20,
        )
        assert rback.status_code == 200
        rlog2 = requests.post(f"{API}/auth/login", json={"email": "staff@glowup.com", "password": "staff123"}, timeout=20)
        assert rlog2.status_code == 200

    def test_c_short_password_400(self, platform_ctx):
        tid = self._get_glowup_tid(platform_ctx["token"])
        r = requests.post(
            f"{API}/platform/tenants/{tid}/reset-password",
            headers=H(platform_ctx["token"]),
            json={"new_password": "abc"},
            timeout=20,
        )
        assert r.status_code == 400, r.text

    def test_d_unknown_user_id_404(self, platform_ctx):
        tid = self._get_glowup_tid(platform_ctx["token"])
        r = requests.post(
            f"{API}/platform/tenants/{tid}/reset-password",
            headers=H(platform_ctx["token"]),
            json={"user_id": "does-not-exist", "new_password": "abcdef"},
            timeout=20,
        )
        assert r.status_code == 404, r.text

    def test_e_non_platform_forbidden(self, admin_ctx, platform_ctx):
        tid = self._get_glowup_tid(platform_ctx["token"])
        r = requests.post(
            f"{API}/platform/tenants/{tid}/reset-password",
            headers=H(admin_ctx["token"]),
            json={"new_password": "abcdef"},
            timeout=20,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"


# ==================== 2. Branch checkout ====================
class TestBranchCheckout:
    def _cleanup(self, tok, head_bid, new_bid):
        try:
            requests.delete(f"{API}/branches/{new_bid}", headers=H(tok, head_bid), timeout=20)
        except Exception:
            pass

    def test_monthly_checkout_ok(self, admin_ctx):
        payload = {
            "plan": "monthly",
            "branch": {
                "name": "TEST_Branch_Alpha",
                "address": "Test St",
                "city": "Bangalore",
                "phone": "9876543210",
                "invoice_prefix": "TB1",
            },
            "amount_inr": 888,
            "display_amount": 10.62,
            "display_currency": "USD",
            "payment_reference": "TEST-PAY-001",
        }
        r = requests.post(f"{API}/branches/checkout", headers=H(admin_ctx["token"], admin_ctx["head_branch_id"]), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        br = data["branch"]
        assert br["subscription_status"] == "active"
        assert br["subscription_plan"] == "monthly"
        assert br["is_head"] is False
        assert br["name"] == "TEST_Branch_Alpha"
        # end date ~ now + 30 days
        end_dt = datetime.fromisoformat(br["subscription_end_date"].replace("Z", "+00:00"))
        diff = (end_dt - datetime.now(timezone.utc)).days
        assert 28 <= diff <= 31, f"unexpected end date diff: {diff}"
        # verify list includes it
        rl = requests.get(f"{API}/branches", headers=H(admin_ctx["token"]), timeout=20)
        names = [b["name"] for b in rl.json()]
        assert "TEST_Branch_Alpha" in names
        # cleanup
        self._cleanup(admin_ctx["token"], admin_ctx["head_branch_id"], br["id"])

    def test_yearly_checkout_ok(self, admin_ctx):
        payload = {"plan": "yearly", "branch": {"name": "TEST_Branch_Yearly"}, "amount_inr": 8888}
        r = requests.post(f"{API}/branches/checkout", headers=H(admin_ctx["token"], admin_ctx["head_branch_id"]), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        br = r.json()["branch"]
        assert br["subscription_plan"] == "yearly"
        end_dt = datetime.fromisoformat(br["subscription_end_date"].replace("Z", "+00:00"))
        diff = (end_dt - datetime.now(timezone.utc)).days
        assert 360 <= diff <= 366
        self._cleanup(admin_ctx["token"], admin_ctx["head_branch_id"], br["id"])

    def test_invalid_plan_400(self, admin_ctx):
        payload = {"plan": "weekly", "branch": {"name": "TEST_bad"}}
        r = requests.post(f"{API}/branches/checkout", headers=H(admin_ctx["token"], admin_ctx["head_branch_id"]), json=payload, timeout=20)
        assert r.status_code in (400, 422), f"expected 400/422, got {r.status_code}: {r.text}"

    def test_empty_name_400(self, admin_ctx):
        payload = {"plan": "monthly", "branch": {"name": ""}}
        r = requests.post(f"{API}/branches/checkout", headers=H(admin_ctx["token"], admin_ctx["head_branch_id"]), json=payload, timeout=20)
        assert r.status_code == 400, r.text

    def test_staff_forbidden(self, staff_ctx):
        payload = {"plan": "monthly", "branch": {"name": "TEST_staff"}}
        r = requests.post(f"{API}/branches/checkout", headers=H(staff_ctx["token"], staff_ctx["branch_id"]), json=payload, timeout=20)
        assert r.status_code == 403, r.text


# ==================== 3. GET /api/pricing ====================
class TestPricing:
    def test_pricing_shape(self, admin_ctx):
        r = requests.get(f"{API}/pricing", headers=H(admin_ctx["token"]), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["currency_base"] == "INR"
        assert data["tenant"] == {"monthly": 999, "yearly": 9999}
        assert data["branch"] == {"monthly": 888, "yearly": 8888}


# ==================== 4. Appointments CRUD + stats ====================
class TestAppointments:
    _created_ids = []

    def test_create_get_update_delete(self, staff_ctx):
        tok = staff_ctx["token"]
        bid = staff_ctx["branch_id"]
        # get beautician
        rb = requests.get(f"{API}/beauticians", headers=H(tok, bid), timeout=20)
        assert rb.status_code == 200, rb.text
        beauticians = rb.json()
        assert beauticians, "need at least 1 beautician"
        b = next((x for x in beauticians if x.get("active", True)), beauticians[0])
        # get services
        rs = requests.get(f"{API}/services", headers=H(tok, bid), timeout=20)
        assert rs.status_code == 200
        services = rs.json()
        assert len(services) >= 2, f"need >=2 services, got {len(services)}"
        s1, s2 = services[0], services[1]

        payload = {
            "customer_name": "TEST_Alice",
            "customer_phone": "9111222333",
            "beautician_id": b["id"],
            "beautician_name": b.get("name") or "",
            "service_ids": [s1["id"], s2["id"]],
            "service_names": [s1.get("name") or "", s2.get("name") or ""],
            "scheduled_start": "2026-08-10T10:30:00Z",
            "duration_minutes": 45,
            "notes": "walk-in test",
            "price_estimate": 500,
        }
        r = requests.post(f"{API}/appointments", headers=H(tok, bid), json=payload, timeout=20)
        assert r.status_code == 200, r.text
        apt = r.json()
        assert apt["status"] == "booked"
        assert apt["branch_id"] == bid
        assert apt["scheduled_end"].startswith("2026-08-10T11:15:00")
        aid = apt["id"]
        TestAppointments._created_ids.append((aid, bid, tok))

        # list by date range
        rl = requests.get(
            f"{API}/appointments",
            headers=H(tok, bid),
            params={"date_from": "2026-08-10T00:00:00Z", "date_to": "2026-08-11T00:00:00Z"},
            timeout=20,
        )
        assert rl.status_code == 200, rl.text
        ids = [a["id"] for a in rl.json()]
        assert aid in ids

        # stats
        rst = requests.get(f"{API}/appointments/stats", headers=H(tok, bid), timeout=20)
        assert rst.status_code == 200, rst.text
        st = rst.json()
        for k in ("today", "week", "upcoming"):
            assert k in st

        # update to completed
        upd = dict(payload)
        upd["status"] = "completed"
        ru = requests.put(f"{API}/appointments/{aid}", headers=H(tok, bid), json=upd, timeout=20)
        assert ru.status_code == 200, ru.text
        assert ru.json()["status"] == "completed"

        # delete
        rd = requests.delete(f"{API}/appointments/{aid}", headers=H(tok, bid), timeout=20)
        assert rd.status_code == 200
        TestAppointments._created_ids.remove((aid, bid, tok))

        # verify gone
        rl2 = requests.get(f"{API}/appointments",
                           headers=H(tok, bid),
                           params={"date_from": "2026-08-10T00:00:00Z", "date_to": "2026-08-11T00:00:00Z"},
                           timeout=20)
        assert aid not in [a["id"] for a in rl2.json()]

    def test_missing_customer_name_400(self, staff_ctx):
        payload = {
            "customer_name": "",
            "scheduled_start": "2026-08-10T10:30:00Z",
            "duration_minutes": 30,
        }
        r = requests.post(f"{API}/appointments", headers=H(staff_ctx["token"], staff_ctx["branch_id"]), json=payload, timeout=20)
        assert r.status_code in (400, 422), f"expected 400/422, got {r.status_code}: {r.text}"

    def test_invalid_date_400(self, staff_ctx):
        payload = {
            "customer_name": "TEST_baddate",
            "scheduled_start": "not-a-date",
            "duration_minutes": 30,
        }
        r = requests.post(f"{API}/appointments", headers=H(staff_ctx["token"], staff_ctx["branch_id"]), json=payload, timeout=20)
        assert r.status_code in (400, 422), f"expected 400/422, got {r.status_code}: {r.text}"

    def test_branch_isolation(self, staff_ctx, admin_ctx):
        """Create appt as staff (branch X), admin should not see it if using different branch."""
        # find any other branch than staff's
        other = next((b for b in admin_ctx["branches"] if b["id"] != staff_ctx["branch_id"]), None)
        if not other:
            pytest.skip("only one branch exists; cannot test isolation")
        # create in staff branch
        rb = requests.get(f"{API}/beauticians", headers=H(staff_ctx["token"], staff_ctx["branch_id"]), timeout=20).json()
        beau = rb[0]
        payload = {
            "customer_name": "TEST_isolation",
            "scheduled_start": "2026-09-10T09:00:00Z",
            "duration_minutes": 30,
            "beautician_id": beau["id"],
        }
        r = requests.post(f"{API}/appointments", headers=H(staff_ctx["token"], staff_ctx["branch_id"]), json=payload, timeout=20)
        assert r.status_code == 200
        aid = r.json()["id"]
        try:
            # admin querying with OTHER branch — should not see it
            rl = requests.get(f"{API}/appointments",
                              headers=H(admin_ctx["token"], other["id"]),
                              params={"date_from": "2026-09-10T00:00:00Z", "date_to": "2026-09-11T00:00:00Z"},
                              timeout=20)
            assert rl.status_code == 200
            assert aid not in [a["id"] for a in rl.json()], "branch isolation violated"
        finally:
            requests.delete(f"{API}/appointments/{aid}", headers=H(staff_ctx["token"], staff_ctx["branch_id"]), timeout=20)

    @classmethod
    def teardown_class(cls):
        for aid, bid, tok in cls._created_ids:
            try:
                requests.delete(f"{API}/appointments/{aid}", headers=H(tok, bid), timeout=10)
            except Exception:
                pass


# ==================== 5. Currency symbol persistence ====================
class TestCurrencySymbol:
    def test_persist_and_restore(self, admin_ctx):
        tok = admin_ctx["token"]
        # snapshot
        pre = requests.get(f"{API}/tenants/me", headers=H(tok), timeout=20).json()["tenant"]
        prev_cur = pre.get("currency") or "INR"
        prev_sym = pre.get("currency_symbol") or "₹"
        # PUT USD/$
        r = requests.put(f"{API}/tenants/me", headers=H(tok), json={"currency": "USD", "currency_symbol": "$"}, timeout=20)
        assert r.status_code == 200, r.text
        tt = r.json()["tenant"]
        assert tt.get("currency") == "USD"
        assert tt.get("currency_symbol") == "$"
        # GET verifies
        g = requests.get(f"{API}/tenants/me", headers=H(tok), timeout=20).json()["tenant"]
        assert g.get("currency") == "USD"
        assert g.get("currency_symbol") == "$"
        # restore
        rr = requests.put(f"{API}/tenants/me", headers=H(tok), json={"currency": prev_cur, "currency_symbol": prev_sym}, timeout=20)
        assert rr.status_code == 200
