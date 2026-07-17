# Tests for iteration 4: forgot/reset password + admin user management
import os
import uuid
import pytest
import requests

BASE_URL = os.environ['EXPO_BACKEND_URL'].rstrip('/')
ADMIN = {"email": "admin@glowup.com", "password": "admin123"}
STAFF = {"email": "staff@glowup.com", "password": "staff123"}


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"], r.json()["user"]


@pytest.fixture(scope="module")
def admin_ctx():
    token, user = _login(ADMIN["email"], ADMIN["password"])
    ctx = {"token": token, "user": user, "headers": {"Authorization": f"Bearer {token}"}}
    yield ctx
    # Teardown safeguard: ensure admin@ still admin after tests (via any surviving admin token)
    # Re-login fresh (in case password changed)
    try:
        t2, _ = _login(ADMIN["email"], "admin123")
        # verify still admin
        me = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {t2}"}).json()
        assert me.get("role") == "admin", "admin@glowup.com was demoted during tests"
    except Exception as e:
        print(f"TEARDOWN WARNING: {e}")


@pytest.fixture(scope="module")
def staff_ctx():
    token, user = _login(STAFF["email"], STAFF["password"])
    return {"token": token, "user": user, "headers": {"Authorization": f"Bearer {token}"}}


# ---------- Forgot / Reset Password ----------
class TestForgotResetPassword:
    def test_forgot_password_known_email(self):
        r = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": ADMIN["email"]})
        assert r.status_code == 200
        data = r.json()
        assert data.get("email_sent") is False
        assert isinstance(data.get("reset_token"), str) and len(data["reset_token"]) >= 20
        assert "expires_at" in data

    def test_forgot_password_unknown_email(self):
        r = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": f"nobody-{uuid.uuid4().hex}@nowhere.com"})
        assert r.status_code == 200
        data = r.json()
        assert data.get("email_sent") is False
        assert "reset_token" not in data

    def test_reset_password_flow_and_token_reuse(self):
        # Get token
        r = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": ADMIN["email"]})
        token = r.json()["reset_token"]
        # Reset
        r2 = requests.post(f"{BASE_URL}/api/auth/reset-password", json={"token": token, "new_password": "TempPwd123"})
        assert r2.status_code == 200
        # Login with new password
        r3 = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN["email"], "password": "TempPwd123"})
        assert r3.status_code == 200
        # Reuse same token → 400
        r4 = requests.post(f"{BASE_URL}/api/auth/reset-password", json={"token": token, "new_password": "AnotherPwd1"})
        assert r4.status_code == 400
        # Restore admin123
        r5 = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": ADMIN["email"]})
        token2 = r5.json()["reset_token"]
        r6 = requests.post(f"{BASE_URL}/api/auth/reset-password", json={"token": token2, "new_password": "admin123"})
        assert r6.status_code == 200
        assert requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN).status_code == 200

    def test_reset_password_bad_token(self):
        r = requests.post(f"{BASE_URL}/api/auth/reset-password", json={"token": "invalid-token-xyz", "new_password": "abcdef"})
        assert r.status_code == 400
        assert "invalid" in r.text.lower()

    def test_reset_password_short_password(self):
        r = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": ADMIN["email"]})
        token = r.json()["reset_token"]
        r2 = requests.post(f"{BASE_URL}/api/auth/reset-password", json={"token": token, "new_password": "abc"})
        assert r2.status_code == 400


# ---------- Admin User CRUD ----------
class TestAdminUserCRUD:
    @pytest.fixture(scope="class")
    def created(self, admin_ctx):
        # create fresh test user
        payload = {"name": "TEST_User", "email": f"testuser-{uuid.uuid4().hex[:8]}@glowup.com",
                   "password": "pwd12345", "role": "staff"}
        r = requests.post(f"{BASE_URL}/api/auth/register", json=payload, headers=admin_ctx["headers"])
        assert r.status_code == 200
        uid = r.json()["id"]
        yield {"id": uid, "email": payload["email"]}
        # cleanup
        requests.delete(f"{BASE_URL}/api/auth/users/{uid}", headers=admin_ctx["headers"])

    def test_create_user_persists(self, admin_ctx, created):
        users = requests.get(f"{BASE_URL}/api/auth/users", headers=admin_ctx["headers"]).json()
        assert any(u["id"] == created["id"] for u in users)

    def test_update_user_name_and_role(self, admin_ctx, created):
        r = requests.put(f"{BASE_URL}/api/auth/users/{created['id']}",
                         json={"name": "TEST_Updated", "role": "admin"},
                         headers=admin_ctx["headers"])
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "TEST_Updated"
        assert r.json()["role"] == "admin"
        # revert
        requests.put(f"{BASE_URL}/api/auth/users/{created['id']}",
                     json={"role": "staff"}, headers=admin_ctx["headers"])

    def test_update_duplicate_email_rejected(self, admin_ctx, created):
        r = requests.put(f"{BASE_URL}/api/auth/users/{created['id']}",
                         json={"email": ADMIN["email"]}, headers=admin_ctx["headers"])
        assert r.status_code == 400

    def test_admin_reset_user_password(self, admin_ctx, created):
        r = requests.post(f"{BASE_URL}/api/auth/users/{created['id']}/reset-password",
                          json={"new_password": "NewPwd999"}, headers=admin_ctx["headers"])
        assert r.status_code == 200
        r2 = requests.post(f"{BASE_URL}/api/auth/login",
                           json={"email": created["email"], "password": "NewPwd999"})
        assert r2.status_code == 200

    def test_admin_reset_password_short(self, admin_ctx, created):
        r = requests.post(f"{BASE_URL}/api/auth/users/{created['id']}/reset-password",
                          json={"new_password": "abc"}, headers=admin_ctx["headers"])
        assert r.status_code == 400

    def test_cannot_delete_self(self, admin_ctx):
        admin_uid = admin_ctx["user"]["id"]
        r = requests.delete(f"{BASE_URL}/api/auth/users/{admin_uid}", headers=admin_ctx["headers"])
        assert r.status_code == 400
        assert "own account" in r.text.lower()

    def test_cannot_demote_last_admin_conditional(self, admin_ctx):
        """Only meaningful when admin@ is the sole admin. If multiple admins exist, skip."""
        users = requests.get(f"{BASE_URL}/api/auth/users", headers=admin_ctx["headers"]).json()
        admins = [u for u in users if u["role"] == "admin"]
        if len(admins) > 1:
            pytest.skip(f"{len(admins)} admins exist — cannot test last-admin guard without demoting non-test users")
        # Only 1 admin — try to demote self
        admin_uid = admin_ctx["user"]["id"]
        r = requests.put(f"{BASE_URL}/api/auth/users/{admin_uid}",
                         json={"role": "staff"}, headers=admin_ctx["headers"])
        assert r.status_code == 400
        assert "last admin" in r.text.lower()

    def test_delete_user(self, admin_ctx, created):
        r = requests.delete(f"{BASE_URL}/api/auth/users/{created['id']}", headers=admin_ctx["headers"])
        assert r.status_code == 200
        # verify gone
        users = requests.get(f"{BASE_URL}/api/auth/users", headers=admin_ctx["headers"]).json()
        assert not any(u["id"] == created["id"] for u in users)


# ---------- Staff RBAC ----------
class TestStaffForbidden:
    def test_staff_cannot_update_user(self, staff_ctx, admin_ctx):
        users = requests.get(f"{BASE_URL}/api/auth/users", headers=admin_ctx["headers"]).json()
        tid = users[0]["id"]
        r = requests.put(f"{BASE_URL}/api/auth/users/{tid}", json={"name": "hack"}, headers=staff_ctx["headers"])
        assert r.status_code == 403

    def test_staff_cannot_delete_user(self, staff_ctx, admin_ctx):
        users = requests.get(f"{BASE_URL}/api/auth/users", headers=admin_ctx["headers"]).json()
        tid = users[0]["id"]
        r = requests.delete(f"{BASE_URL}/api/auth/users/{tid}", headers=staff_ctx["headers"])
        assert r.status_code == 403

    def test_staff_cannot_admin_reset(self, staff_ctx, admin_ctx):
        users = requests.get(f"{BASE_URL}/api/auth/users", headers=admin_ctx["headers"]).json()
        tid = users[0]["id"]
        r = requests.post(f"{BASE_URL}/api/auth/users/{tid}/reset-password",
                          json={"new_password": "whatever12"}, headers=staff_ctx["headers"])
        assert r.status_code == 403


# ---------- Regression ----------
class TestRegression:
    def test_admin_login(self):
        assert requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN).status_code == 200

    def test_staff_login(self):
        assert requests.post(f"{BASE_URL}/api/auth/login", json=STAFF).status_code == 200

    def test_reports_summary_admin(self):
        t, _ = _login(ADMIN["email"], ADMIN["password"])
        r = requests.get(f"{BASE_URL}/api/reports/summary", headers={"Authorization": f"Bearer {t}"})
        assert r.status_code == 200
        j = r.json()
        assert "today" in j and "month" in j

    def test_reports_range_week(self):
        t, _ = _login(ADMIN["email"], ADMIN["password"])
        r = requests.get(f"{BASE_URL}/api/reports/range?preset=week", headers={"Authorization": f"Bearer {t}"})
        assert r.status_code == 200
        assert "totals" in r.json()

    def test_beauticians_list(self):
        t, _ = _login(STAFF["email"], STAFF["password"])
        r = requests.get(f"{BASE_URL}/api/beauticians", headers={"Authorization": f"Bearer {t}"})
        assert r.status_code == 200
        assert isinstance(r.json(), list)
