"""Backend tests for OTP-based Forgot Password / Reset Password flow.

Covers:
- POST /api/auth/forgot-password (OTP issuance, rate limiting, non-enum, invalidation)
- POST /api/auth/reset-password (OTP verify, expiry, attempts, reuse, weak pw, legacy token)
- Regression: login with new password + restore original password after tests.
"""
import os
import time
import hashlib
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

# Load backend env for MONGO_URL / DB_NAME
load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://salon-invoice-app.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME", "glowup_db")

ADMIN_EMAIL = "admin@glowup.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module", autouse=True)
def cleanup_admin_resets(mongo):
    # clean any lingering resets for admin so rate-limit doesn't preload
    mongo.password_resets.delete_many({"email": ADMIN_EMAIL})
    yield
    # After the module, restore admin password to admin123 so downstream tests work
    _restore_admin_password(mongo)


def _restore_admin_password(mongo):
    """Restore admin@glowup.com password back to admin123 using OTP flow."""
    # request otp
    r = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": ADMIN_EMAIL}, timeout=30)
    if r.status_code == 429:
        # wait some seconds and clear resets
        mongo.password_resets.delete_many({"email": ADMIN_EMAIL})
        r = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": ADMIN_EMAIL}, timeout=30)
    j = r.json()
    otp = j.get("dev_otp")
    if not otp:
        # fetch from db
        doc = list(mongo.password_resets.find({"email": ADMIN_EMAIL, "used": False}).sort("created_at", -1).limit(1))
        if not doc:
            return
        # can't reverse hash; regenerate: force known otp via direct hash update
        new_otp = "123456"
        mongo.password_resets.update_one(
            {"_id": doc[0]["_id"]},
            {"$set": {"otp_hash": hashlib.sha256(new_otp.encode()).hexdigest(), "attempts": 0}}
        )
        otp = new_otp
    requests.post(f"{BASE_URL}/api/auth/reset-password",
                  json={"email": ADMIN_EMAIL, "otp": otp, "new_password": ADMIN_PASSWORD},
                  timeout=30)


# ============ /auth/forgot-password ============

class TestForgotPassword:
    def test_forgot_password_nonexistent_email_no_leak(self, api, mongo):
        """Non-existent emails must return same shape and NOT create a record."""
        fake = f"TEST_nobody_{uuid.uuid4().hex[:8]}@example.com"
        before = mongo.password_resets.count_documents({"email": fake})
        r = api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": fake})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert "email_sent" in body
        assert "message" in body
        # dev_otp must NOT leak for nonexistent user
        assert "dev_otp" not in body
        after = mongo.password_resets.count_documents({"email": fake})
        assert after == before, "No password_resets record should be created for non-existent email"

    def test_forgot_password_existing_user_issues_otp(self, api, mongo):
        """Real user: response has dev_otp fallback (undeliverable) OR email_sent=True."""
        mongo.password_resets.delete_many({"email": ADMIN_EMAIL})
        r = api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": ADMIN_EMAIL})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        # Either email sent OR dev_otp exposed
        assert body.get("email_sent") is True or "dev_otp" in body
        if "dev_otp" in body:
            assert len(body["dev_otp"]) == 6 and body["dev_otp"].isdigit()

        # DB record shape
        doc = mongo.password_resets.find_one({"email": ADMIN_EMAIL, "used": False}, sort=[("created_at", -1)])
        assert doc is not None
        assert doc.get("otp_hash") and len(doc["otp_hash"]) == 64  # sha256 hex
        assert doc.get("attempts") == 0
        assert doc.get("used") is False
        assert doc.get("expires_at")
        # otp must NOT be stored plain
        assert "otp" not in doc, "Plain OTP should never be persisted"

    def test_forgot_password_invalidates_prior_otps(self, api, mongo):
        """New request should mark prior unused OTPs as used+invalidated."""
        mongo.password_resets.delete_many({"email": ADMIN_EMAIL})
        api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": ADMIN_EMAIL})
        first = mongo.password_resets.find_one({"email": ADMIN_EMAIL}, sort=[("created_at", -1)])
        assert first and first["used"] is False

        api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": ADMIN_EMAIL})
        # first doc should now be marked used
        updated = mongo.password_resets.find_one({"_id": first["_id"]})
        assert updated["used"] is True
        assert updated.get("invalidated") is True

        # newest is unused
        latest = mongo.password_resets.find_one({"email": ADMIN_EMAIL, "used": False}, sort=[("created_at", -1)])
        assert latest is not None and latest["_id"] != first["_id"]

    def test_forgot_password_rate_limit(self, api, mongo):
        """>=3 requests within 10 min for same email -> 429."""
        mongo.password_resets.delete_many({"email": ADMIN_EMAIL})
        # 3 successful requests
        for i in range(3):
            r = api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": ADMIN_EMAIL})
            assert r.status_code == 200, f"Request {i} failed: {r.text}"
        # 4th should 429
        r = api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": ADMIN_EMAIL})
        assert r.status_code == 429, r.text
        # Cleanup
        mongo.password_resets.delete_many({"email": ADMIN_EMAIL})

    def test_forgot_password_invalid_email_format(self, api):
        r = api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": "not-an-email"})
        assert r.status_code == 422


# ============ /auth/reset-password (OTP flow) ============

class TestResetPasswordOtp:
    def _fresh_otp(self, api, mongo, email=ADMIN_EMAIL):
        mongo.password_resets.delete_many({"email": email})
        r = api.post(f"{BASE_URL}/api/auth/forgot-password", json={"email": email})
        assert r.status_code == 200, r.text
        body = r.json()
        otp = body.get("dev_otp")
        if not otp:
            # Force known otp
            doc = mongo.password_resets.find_one({"email": email, "used": False}, sort=[("created_at", -1)])
            otp = "654321"
            mongo.password_resets.update_one(
                {"_id": doc["_id"]},
                {"$set": {"otp_hash": hashlib.sha256(otp.encode()).hexdigest()}}
            )
        return otp

    def test_reset_password_weak_password_rejected(self, api, mongo):
        otp = self._fresh_otp(api, mongo)
        r = api.post(f"{BASE_URL}/api/auth/reset-password",
                     json={"email": ADMIN_EMAIL, "otp": otp, "new_password": "abc"})
        assert r.status_code == 400
        assert "6 characters" in r.json().get("detail", "").lower() or "6" in r.json().get("detail", "")

    def test_reset_password_wrong_otp(self, api, mongo):
        self._fresh_otp(api, mongo)
        r = api.post(f"{BASE_URL}/api/auth/reset-password",
                     json={"email": ADMIN_EMAIL, "otp": "000000", "new_password": "newpass123"})
        assert r.status_code == 400
        assert "incorrect" in r.json().get("detail", "").lower()
        # attempts incremented
        doc = mongo.password_resets.find_one({"email": ADMIN_EMAIL, "used": False}, sort=[("created_at", -1)])
        assert doc.get("attempts", 0) >= 1

    def test_reset_password_invalid_otp_format(self, api, mongo):
        self._fresh_otp(api, mongo)
        r = api.post(f"{BASE_URL}/api/auth/reset-password",
                     json={"email": ADMIN_EMAIL, "otp": "abc", "new_password": "newpass123"})
        assert r.status_code == 400
        assert "format" in r.json().get("detail", "").lower()

    def test_reset_password_no_active_otp(self, api, mongo):
        mongo.password_resets.delete_many({"email": ADMIN_EMAIL})
        r = api.post(f"{BASE_URL}/api/auth/reset-password",
                     json={"email": ADMIN_EMAIL, "otp": "123456", "new_password": "newpass123"})
        assert r.status_code == 400
        assert "no active" in r.json().get("detail", "").lower()

    def test_reset_password_expired_otp(self, api, mongo):
        otp = self._fresh_otp(api, mongo)
        # Force expiry
        mongo.password_resets.update_one(
            {"email": ADMIN_EMAIL, "used": False},
            {"$set": {"expires_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()}}
        )
        r = api.post(f"{BASE_URL}/api/auth/reset-password",
                     json={"email": ADMIN_EMAIL, "otp": otp, "new_password": "newpass123"})
        assert r.status_code == 400
        assert "expired" in r.json().get("detail", "").lower()

    def test_reset_password_max_attempts_locks(self, api, mongo):
        self._fresh_otp(api, mongo)
        # 5 wrong tries
        for _ in range(5):
            api.post(f"{BASE_URL}/api/auth/reset-password",
                     json={"email": ADMIN_EMAIL, "otp": "000000", "new_password": "newpass123"})
        # 6th should be 429 lockout
        r = api.post(f"{BASE_URL}/api/auth/reset-password",
                     json={"email": ADMIN_EMAIL, "otp": "000000", "new_password": "newpass123"})
        assert r.status_code == 429
        # OTP is invalidated
        doc = mongo.password_resets.find_one({"email": ADMIN_EMAIL}, sort=[("created_at", -1)])
        assert doc.get("used") is True
        assert doc.get("invalidated") is True

    def test_reset_password_happy_path_and_login(self, api, mongo):
        """Reset with correct OTP + login with new password + reused OTP fails."""
        new_pw = "GlowUp_New_2026!"
        otp = self._fresh_otp(api, mongo)
        r = api.post(f"{BASE_URL}/api/auth/reset-password",
                     json={"email": ADMIN_EMAIL, "otp": otp, "new_password": new_pw})
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # OTP marked used
        doc = mongo.password_resets.find_one({"email": ADMIN_EMAIL}, sort=[("created_at", -1)])
        assert doc.get("used") is True
        assert doc.get("used_at")

        # Login with new password works
        lr = api.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": new_pw})
        assert lr.status_code == 200, lr.text
        assert lr.json().get("token")

        # Login with OLD password fails
        lr_old = api.post(f"{BASE_URL}/api/auth/login",
                          json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert lr_old.status_code == 401

        # Replay of same OTP is rejected (no active OTP now)
        rr = api.post(f"{BASE_URL}/api/auth/reset-password",
                      json={"email": ADMIN_EMAIL, "otp": otp, "new_password": "another123"})
        assert rr.status_code == 400
        assert "no active" in rr.json().get("detail", "").lower()

        # Restore password using a new OTP so downstream tests keep working
        otp2 = self._fresh_otp(api, mongo)
        rr2 = api.post(f"{BASE_URL}/api/auth/reset-password",
                       json={"email": ADMIN_EMAIL, "otp": otp2, "new_password": ADMIN_PASSWORD})
        assert rr2.status_code == 200

        # Confirm original password works
        lr2 = api.post(f"{BASE_URL}/api/auth/login",
                       json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert lr2.status_code == 200

    def test_reset_password_missing_all_fields(self, api):
        r = api.post(f"{BASE_URL}/api/auth/reset-password",
                     json={"new_password": "abcdef1"})
        assert r.status_code == 400
        assert "either" in r.json().get("detail", "").lower() or "token" in r.json().get("detail", "").lower()


# ============ Legacy token flow ============

class TestResetPasswordLegacyToken:
    def test_legacy_token_flow_still_works(self, api, mongo):
        """Backward compat: create a password_resets doc with a raw token, use it."""
        # Ensure admin exists
        user = mongo.users.find_one({"email": ADMIN_EMAIL})
        assert user, "admin@glowup.com must exist"
        token = uuid.uuid4().hex
        mongo.password_resets.insert_one({
            "token": token,
            "user_id": user["id"],
            "email": ADMIN_EMAIL,
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(),
            "used": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        new_pw = "LegacyReset_2026"
        r = api.post(f"{BASE_URL}/api/auth/reset-password",
                     json={"token": token, "new_password": new_pw})
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Login with new pw
        lr = api.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": new_pw})
        assert lr.status_code == 200

        # Reuse legacy token -> already used
        r2 = api.post(f"{BASE_URL}/api/auth/reset-password",
                      json={"token": token, "new_password": "another_pw"})
        assert r2.status_code == 400
        assert "used" in r2.json().get("detail", "").lower()

        # Restore admin pw via legacy token
        token2 = uuid.uuid4().hex
        mongo.password_resets.insert_one({
            "token": token2,
            "user_id": user["id"],
            "email": ADMIN_EMAIL,
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(),
            "used": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        rr = api.post(f"{BASE_URL}/api/auth/reset-password",
                      json={"token": token2, "new_password": ADMIN_PASSWORD})
        assert rr.status_code == 200

    def test_legacy_invalid_token(self, api):
        r = api.post(f"{BASE_URL}/api/auth/reset-password",
                     json={"token": "nonexistent_token_xyz", "new_password": "abcdef1"})
        assert r.status_code == 400
        assert "invalid" in r.json().get("detail", "").lower()

    def test_legacy_expired_token(self, api, mongo):
        user = mongo.users.find_one({"email": ADMIN_EMAIL})
        token = uuid.uuid4().hex
        mongo.password_resets.insert_one({
            "token": token,
            "user_id": user["id"],
            "email": ADMIN_EMAIL,
            "expires_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(),
            "used": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        r = api.post(f"{BASE_URL}/api/auth/reset-password",
                     json={"token": token, "new_password": "abcdef1"})
        assert r.status_code == 400
        assert "expired" in r.json().get("detail", "").lower()
