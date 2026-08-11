"""Iteration 12 backend tests — Super Admin Dashboard additions:
- Platform user CRUD (list/create/update/delete/reset-password)
- Detailed tenant view (subscription history + branches)
- Delete tenant (super-only + seed guard)
- CSV export (headers + rows include Total Branches)
- subscription_history audit trail is populated on set-subscription

Uses only public URL from env (EXPO_PUBLIC_BACKEND_URL).
All created data is TEST_ prefixed and cleaned up in class teardown.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

PLATFORM_EMAIL = "platform@parlourpilot.com"
PLATFORM_PWD = "platform123"
SEED_TID = "glowup-tenant-0001"
TIMEOUT = 30


def _login(email, pwd):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": pwd}, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="session")
def admin_token():
    return _login(PLATFORM_EMAIL, PLATFORM_PWD)


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# --------- Session-scoped staff account (created via admin, torn down at end) ---------
@pytest.fixture(scope="session")
def staff_account(admin_headers):
    email = f"TEST_staff_{uuid.uuid4().hex[:8]}@parlourpilot.com"
    pwd = "staffpw123"
    r = requests.post(f"{BASE_URL}/api/platform/users",
                      json={"name": "TEST Staff", "email": email, "password": pwd,
                            "role": "platform_staff"},
                      headers=admin_headers, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    data = r.json()
    yield {"id": data["id"], "email": email, "password": pwd}
    # teardown
    try:
        requests.delete(f"{BASE_URL}/api/platform/users/{data['id']}",
                        headers=admin_headers, timeout=TIMEOUT)
    except Exception:
        pass


@pytest.fixture(scope="session")
def staff_headers(staff_account):
    tok = _login(staff_account["email"], staff_account["password"])
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ============== Group 1: Platform user CRUD ==============
class TestPlatformUsers:
    def test_list_unauth_401(self):
        r = requests.get(f"{BASE_URL}/api/platform/users", timeout=TIMEOUT)
        assert r.status_code in (401, 403), r.text

    def test_list_as_admin_ok(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/platform/users",
                         headers=admin_headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "users" in body and isinstance(body["users"], list)
        emails = [u["email"] for u in body["users"]]
        assert PLATFORM_EMAIL in emails
        # No password hash leaked
        assert all("password_hash" not in u for u in body["users"])

    def test_list_as_staff_ok(self, staff_headers):
        r = requests.get(f"{BASE_URL}/api/platform/users",
                         headers=staff_headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert any(u["role"] == "platform_admin" for u in r.json()["users"])

    def test_create_as_staff_forbidden(self, staff_headers):
        r = requests.post(f"{BASE_URL}/api/platform/users",
                          json={"name": "TEST X", "email": f"TEST_x_{uuid.uuid4().hex[:6]}@pp.com",
                                "password": "abcdef", "role": "platform_staff"},
                          headers=staff_headers, timeout=TIMEOUT)
        assert r.status_code == 403, r.text

    def test_create_short_password_400(self, admin_headers):
        r = requests.post(f"{BASE_URL}/api/platform/users",
                          json={"name": "TEST W", "email": f"TEST_w_{uuid.uuid4().hex[:6]}@pp.com",
                                "password": "abc", "role": "platform_staff"},
                          headers=admin_headers, timeout=TIMEOUT)
        assert r.status_code == 400, r.text

    def test_create_duplicate_email_400(self, admin_headers, staff_account):
        r = requests.post(f"{BASE_URL}/api/platform/users",
                          json={"name": "TEST Dup", "email": staff_account["email"],
                                "password": "abcdef", "role": "platform_staff"},
                          headers=admin_headers, timeout=TIMEOUT)
        assert r.status_code == 400, r.text

    def test_update_role_and_active(self, admin_headers, staff_account):
        # Promote to admin then demote — should succeed both ways
        r = requests.put(f"{BASE_URL}/api/platform/users/{staff_account['id']}",
                        json={"role": "platform_admin"},
                        headers=admin_headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "platform_admin"

        r = requests.put(f"{BASE_URL}/api/platform/users/{staff_account['id']}",
                        json={"role": "platform_staff"},
                        headers=admin_headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "platform_staff"

        # Toggle is_active off then on
        r = requests.put(f"{BASE_URL}/api/platform/users/{staff_account['id']}",
                        json={"is_active": False},
                        headers=admin_headers, timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json()["is_active"] is False
        r = requests.put(f"{BASE_URL}/api/platform/users/{staff_account['id']}",
                        json={"is_active": True},
                        headers=admin_headers, timeout=TIMEOUT)
        assert r.status_code == 200
        assert r.json()["is_active"] is True

    def test_cannot_demote_last_admin(self, admin_headers):
        # find the platform_admin id (self)
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=admin_headers, timeout=TIMEOUT).json()["user"]
        r = requests.put(f"{BASE_URL}/api/platform/users/{me['id']}",
                        json={"role": "platform_staff"},
                        headers=admin_headers, timeout=TIMEOUT)
        assert r.status_code == 400, r.text
        assert "last" in r.json().get("detail", "").lower()

    def test_cannot_deactivate_last_admin(self, admin_headers):
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=admin_headers, timeout=TIMEOUT).json()["user"]
        r = requests.put(f"{BASE_URL}/api/platform/users/{me['id']}",
                        json={"is_active": False},
                        headers=admin_headers, timeout=TIMEOUT)
        assert r.status_code == 400, r.text

    def test_delete_self_forbidden(self, admin_headers):
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=admin_headers, timeout=TIMEOUT).json()["user"]
        r = requests.delete(f"{BASE_URL}/api/platform/users/{me['id']}",
                            headers=admin_headers, timeout=TIMEOUT)
        assert r.status_code == 400, r.text

    def test_delete_as_staff_forbidden(self, staff_headers, staff_account):
        r = requests.delete(f"{BASE_URL}/api/platform/users/{staff_account['id']}",
                            headers=staff_headers, timeout=TIMEOUT)
        assert r.status_code == 403, r.text

    def test_reset_password_short_400(self, admin_headers, staff_account):
        r = requests.post(f"{BASE_URL}/api/platform/users/{staff_account['id']}/reset-password",
                          json={"new_password": "abc"},
                          headers=admin_headers, timeout=TIMEOUT)
        assert r.status_code == 400, r.text

    def test_reset_password_success_then_login(self, admin_headers, staff_account):
        new_pw = "newpw12345"
        r = requests.post(f"{BASE_URL}/api/platform/users/{staff_account['id']}/reset-password",
                          json={"new_password": new_pw},
                          headers=admin_headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        # Verify new password works
        tok = _login(staff_account["email"], new_pw)
        assert tok
        # Restore for other tests using staff_headers fixture (already logged in)
        r2 = requests.post(f"{BASE_URL}/api/platform/users/{staff_account['id']}/reset-password",
                          json={"new_password": staff_account["password"]},
                          headers=admin_headers, timeout=TIMEOUT)
        assert r2.status_code == 200

    def test_reset_password_as_staff_forbidden(self, staff_headers, staff_account):
        r = requests.post(f"{BASE_URL}/api/platform/users/{staff_account['id']}/reset-password",
                          json={"new_password": "abcdef"},
                          headers=staff_headers, timeout=TIMEOUT)
        assert r.status_code == 403, r.text


# ============== Group 2: Tenant Detail ==============
class TestTenantDetail:
    def test_detail_as_admin(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/platform/tenants/{SEED_TID}/detail",
                         headers=admin_headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "tenant" in body and "branches" in body and "subscription_history" in body
        assert body["tenant"]["id"] == SEED_TID
        assert isinstance(body["branches"], list)
        assert isinstance(body["subscription_history"], list)
        # branches expose address fields
        for b in body["branches"]:
            assert "name" in b
            # address key exists (may be empty)
            assert "address" in b or "city" in b

    def test_detail_as_staff(self, staff_headers):
        r = requests.get(f"{BASE_URL}/api/platform/tenants/{SEED_TID}/detail",
                         headers=staff_headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text

    def test_detail_unknown_tid_404(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/platform/tenants/does-not-exist-xxx/detail",
                         headers=admin_headers, timeout=TIMEOUT)
        assert r.status_code == 404


# ============== Group 3: Subscription history audit trail ==============
class TestSubscriptionHistoryAudit:
    def test_set_subscription_creates_audit_row(self, admin_headers):
        # Snapshot history count
        before = requests.get(f"{BASE_URL}/api/platform/tenants/{SEED_TID}/detail",
                              headers=admin_headers, timeout=TIMEOUT).json()
        # Count only 'subscription_updated'-type entries (trial_started / payment are separate)
        before_updates = len([h for h in before["subscription_history"]
                              if h.get("type") == "subscription_updated"])

        # Perform harmless extend by 1 day
        r = requests.post(f"{BASE_URL}/api/platform/tenants/{SEED_TID}/subscription",
                          json={"extend_days": 1, "subscription_status": "active"},
                          headers=admin_headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text

        time.sleep(0.5)
        after = requests.get(f"{BASE_URL}/api/platform/tenants/{SEED_TID}/detail",
                             headers=admin_headers, timeout=TIMEOUT).json()
        after_updates = len([h for h in after["subscription_history"]
                             if h.get("type") == "subscription_updated"])
        assert after_updates == before_updates + 1, \
            f"Expected 1 new audit row; got {after_updates - before_updates}"
        # actor is captured
        newest = next(h for h in after["subscription_history"]
                      if h.get("type") == "subscription_updated")
        assert newest.get("actor") == PLATFORM_EMAIL


# ============== Group 4: Delete tenant (super-only + seed guard) ==============
class TestDeleteTenant:
    def test_delete_seed_forbidden_400(self, admin_headers):
        r = requests.delete(f"{BASE_URL}/api/platform/tenants/{SEED_TID}",
                            headers=admin_headers, timeout=TIMEOUT)
        assert r.status_code == 400, r.text
        assert "seed" in r.json().get("detail", "").lower()

    def test_delete_as_staff_forbidden(self, staff_headers):
        # Even for a non-existent id, staff must be blocked BEFORE the lookup
        r = requests.delete(f"{BASE_URL}/api/platform/tenants/any-tid",
                            headers=staff_headers, timeout=TIMEOUT)
        assert r.status_code == 403, r.text

    def test_delete_creates_then_purges(self, admin_headers):
        """Signup a fresh tenant, verify delete purges it and returns counts."""
        biz = f"TEST_biz_{uuid.uuid4().hex[:6]}"
        signup = requests.post(f"{BASE_URL}/api/tenants/signup",
                               json={"business_name": biz, "owner_name": "TEST Owner",
                                     "email": f"{biz.lower()}@pp.com", "password": "abcdef",
                                     "phone": "1234567890", "city": "Bengaluru", "country": "IN"},
                               timeout=TIMEOUT)
        assert signup.status_code == 200, signup.text
        tid = signup.json()["tenant"]["id"]

        r = requests.delete(f"{BASE_URL}/api/platform/tenants/{tid}",
                            headers=admin_headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert "deleted" in body and body["deleted"].get("tenants") == 1
        # Verify gone
        r2 = requests.get(f"{BASE_URL}/api/platform/tenants/{tid}/detail",
                          headers=admin_headers, timeout=TIMEOUT)
        assert r2.status_code == 404


# ============== Group 5: CSV Export ==============
class TestCsvExport:
    def _fetch(self, headers):
        return requests.get(f"{BASE_URL}/api/platform/tenants/export",
                            headers=headers, timeout=TIMEOUT)

    def test_export_as_admin(self, admin_headers):
        r = self._fetch(admin_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(["csv", "filename", "count"]).issubset(body.keys())
        assert body["filename"].endswith(".csv")
        assert isinstance(body["csv"], str) and len(body["csv"]) > 0
        # Header row includes 'Total Branches'
        first_line = body["csv"].splitlines()[0]
        assert "Total Branches" in first_line
        assert "Business Name" in first_line and "Email" in first_line and "Phone" in first_line
        # Count matches non-header row count
        rows = body["csv"].splitlines()
        assert len(rows) - 1 == body["count"]
        # Seed tenant appears somewhere
        assert "Glow Up" in body["csv"] or "glow" in body["csv"].lower()

    def test_export_as_staff(self, staff_headers):
        r = self._fetch(staff_headers)
        assert r.status_code == 200, r.text
        assert "csv" in r.json()

    def test_export_unauth_401(self):
        r = requests.get(f"{BASE_URL}/api/platform/tenants/export", timeout=TIMEOUT)
        assert r.status_code in (401, 403), r.text
