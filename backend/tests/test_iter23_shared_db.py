"""
Iteration 23 — Shared DB parity between mobile backend and web backend.

Previous iteration (22) confirmed the two backends were writing to SEPARATE
databases. The user has now redeployed the web project with corrected
MongoDB Secrets. This iteration formally verifies:

  1. Both backends return 200 on /api/health with the expected services.
  2. A tenant created on mobile is visible/authable on web.
  3. A tenant created on web is visible/authable on mobile.
  4. JWTs are cross-accepted (same JWT_SECRET) — SSO parity.
  5. Platform admin `user.id` matches on both backends
     (`9f03ff19-29dd-4046-aed3-e5eb1fd8f3c4`).
  6. Direct Atlas query confirms the web-signup tenant lives in the
     `ParlourPilot` DB.
  7. All created data is torn down; platform admin is preserved.
"""
import os
import time
from typing import List

import jwt as pyjwt
import pytest
import requests
from pymongo import MongoClient

MOBILE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
WEB_URL = "https://parlourpilot.com"
PLATFORM_EMAIL = "platform@parlourpilot.com"
PLATFORM_PASSWORD = "platform123"
EXPECTED_PLATFORM_ID = "9f03ff19-29dd-4046-aed3-e5eb1fd8f3c4"

MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME", "ParlourPilot")
JWT_SECRET = os.environ.get("JWT_SECRET")

# Load from .env if not in environment (backend runs under supervisor so env is
# usually not exported to the pytest shell)
if not MONGO_URL or not JWT_SECRET:
    try:
        with open("/app/backend/.env") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                v = v.strip().strip('"').strip("'")
                if k == "MONGO_URL" and not MONGO_URL:
                    MONGO_URL = v
                elif k == "DB_NAME":
                    DB_NAME = v
                elif k == "JWT_SECRET" and not JWT_SECRET:
                    JWT_SECRET = v
    except FileNotFoundError:
        pass

assert MOBILE_URL, "EXPO_PUBLIC_BACKEND_URL not set"
assert MONGO_URL, "MONGO_URL not set (env or /app/backend/.env)"
assert JWT_SECRET, "JWT_SECRET not set"


# --------------------------- fixtures ---------------------------

@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=15000)
    db = client[DB_NAME]
    yield db
    client.close()


@pytest.fixture(scope="module")
def created():
    """
    Track every tenant/user we create so we can clean up at the end.
    Structure: {"mobile": [tid, ...], "web": [tid, ...], "emails": [...] }
    """
    state = {"mobile": [], "web": [], "emails": []}
    yield state

    # ---------- teardown ----------
    def _token(base):
        try:
            r = requests.post(
                f"{base}/api/auth/login",
                json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD},
                timeout=15,
            )
            if r.status_code == 200:
                return r.json().get("token")
        except Exception as e:
            print(f"teardown login({base}) failed: {e}")
        return None

    mob_tok = _token(MOBILE_URL)
    web_tok = _token(WEB_URL)

    all_tids = set(state["mobile"]) | set(state["web"])
    for tid in all_tids:
        for base, tok in ((MOBILE_URL, mob_tok), (WEB_URL, web_tok)):
            if not tok:
                continue
            try:
                dr = requests.delete(
                    f"{base}/api/platform/tenants/{tid}",
                    headers={"Authorization": f"Bearer {tok}"},
                    timeout=15,
                )
                print(f"teardown DELETE {base}/api/platform/tenants/{tid} -> {dr.status_code}")
                if dr.status_code in (200, 204):
                    break  # deleted; shared DB means one delete is enough
            except Exception as e:
                print(f"teardown delete on {base} failed: {e}")


def _signup_payload(prefix: str):
    ts = int(time.time() * 1000)
    email = f"TEST_{prefix}_{ts}@resend.dev"
    return email, {
        "business_name": f"TEST {prefix} {ts}",
        "owner_name": f"{prefix.title()} Tester",
        "email": email,
        "password": "sharedpass123",
        "phone": "+911234567890",
        "city": "Bengaluru",
        "num_branches": 1,
    }


# --------------------------- 1. Health parity ---------------------------

class TestHealthParity:
    def test_mobile_health(self):
        r = requests.get(f"{MOBILE_URL}/api/health", timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("service") == "parlourpilot-api", j

    def test_web_health(self):
        r = requests.get(f"{WEB_URL}/api/health", timeout=15)
        assert r.status_code == 200, r.text
        # Web service may report service='parlourpilot' — that's fine, just
        # verify it's up.
        j = r.json()
        assert j.get("status") == "ok" or j.get("ok") is True, j


# --------------------------- 2. Platform admin ID parity ---------------------------

class TestPlatformAdminIdParity:
    """Login on BOTH backends and confirm user.id is identical (proves same DB row)."""

    @pytest.fixture(scope="class")
    def mobile_login(self):
        r = requests.post(
            f"{MOBILE_URL}/api/auth/login",
            json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        return r.json()

    @pytest.fixture(scope="class")
    def web_login(self):
        r = requests.post(
            f"{WEB_URL}/api/auth/login",
            json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        return r.json()

    def test_mobile_platform_id(self, mobile_login):
        uid = mobile_login["user"]["id"]
        print(f"mobile platform id = {uid}")
        assert uid == EXPECTED_PLATFORM_ID, (
            f"mobile platform id {uid} != expected {EXPECTED_PLATFORM_ID}"
        )

    def test_web_platform_id(self, web_login):
        uid = web_login["user"]["id"]
        print(f"web    platform id = {uid}")
        assert uid == EXPECTED_PLATFORM_ID, (
            f"web platform id {uid} != expected {EXPECTED_PLATFORM_ID}"
        )

    def test_ids_match(self, mobile_login, web_login):
        assert mobile_login["user"]["id"] == web_login["user"]["id"], (
            "Platform admin id differs between backends — DBs are still not shared"
        )


# --------------------------- 3. Shared DB signal: mobile -> web ---------------------------

class TestMobileToWebSharedDb:
    def test_signup_on_mobile_then_login_on_web(self, created):
        email, payload = _signup_payload("m2w")
        sr = requests.post(f"{MOBILE_URL}/api/tenants/signup", json=payload, timeout=30)
        assert sr.status_code == 200, f"mobile signup failed: {sr.status_code} {sr.text}"
        j = sr.json()
        tid = j["tenant"]["id"]
        created["mobile"].append(tid)
        created["emails"].append(email)
        print(f"mobile-created tenant id={tid} email={email}")

        # Wait a moment for propagation (Atlas is a single cluster — should be instant)
        time.sleep(2)

        # Login on WEB with the same credentials — this proves shared DB
        lr = requests.post(
            f"{WEB_URL}/api/auth/login",
            json={"email": email, "password": "sharedpass123"},
            timeout=15,
        )
        assert lr.status_code == 200, (
            f"SHARED DB BROKEN: mobile-created tenant cannot log in on web: "
            f"{lr.status_code} {lr.text[:200]}"
        )
        lj = lr.json()
        assert lj["user"]["tenant_id"] == tid, (
            f"tenant_id mismatch: web login says {lj['user']['tenant_id']} vs mobile {tid}"
        )

    def test_mobile_tenant_visible_in_web_platform_list(self, created):
        # Use a platform token issued by WEB
        tok = requests.post(
            f"{WEB_URL}/api/auth/login",
            json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD},
            timeout=15,
        ).json()["token"]
        pl = requests.get(
            f"{WEB_URL}/api/platform/tenants",
            headers={"Authorization": f"Bearer {tok}"},
            timeout=15,
        )
        assert pl.status_code == 200, pl.text
        body = pl.json()
        tenants = body if isinstance(body, list) else body.get("tenants", [])
        ids = {t["id"] for t in tenants}
        for tid in created["mobile"]:
            assert tid in ids, (
                f"SHARED DB BROKEN: mobile-created tenant {tid} not in web platform list "
                f"(count={len(tenants)})"
            )


# --------------------------- 4. Shared DB signal: web -> mobile ---------------------------

class TestWebToMobileSharedDb:
    def test_signup_on_web_then_login_on_mobile(self, created):
        email, payload = _signup_payload("w2m")
        try:
            sr = requests.post(f"{WEB_URL}/api/tenants/signup", json=payload, timeout=30)
        except Exception as e:
            pytest.skip(f"web unreachable: {e}")
        assert sr.status_code == 200, f"web signup failed: {sr.status_code} {sr.text}"
        j = sr.json()
        tid = j["tenant"]["id"]
        created["web"].append(tid)
        created["emails"].append(email)
        print(f"web-created tenant id={tid} email={email}")

        time.sleep(2)

        lr = requests.post(
            f"{MOBILE_URL}/api/auth/login",
            json={"email": email, "password": "sharedpass123"},
            timeout=15,
        )
        assert lr.status_code == 200, (
            f"SHARED DB BROKEN: web-created tenant cannot log in on mobile: "
            f"{lr.status_code} {lr.text[:200]}"
        )
        lj = lr.json()
        assert lj["user"]["tenant_id"] == tid


# --------------------------- 5. JWT SSO parity (same JWT_SECRET) ---------------------------

class TestJwtSsoParity:
    def _fresh_tenant(self, base_url, prefix, created):
        email, payload = _signup_payload(prefix)
        r = requests.post(f"{base_url}/api/tenants/signup", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        tid = j["tenant"]["id"]
        # Track under whichever key so teardown can find it
        created["mobile" if base_url == MOBILE_URL else "web"].append(tid)
        created["emails"].append(email)
        return j["token"], tid, email

    def test_mobile_token_accepted_by_web(self, created):
        token, tid, email = self._fresh_tenant(MOBILE_URL, "jwt_m2w", created)
        # Decode locally to prove same secret
        decoded = pyjwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        print(f"mobile-issued JWT decoded on mobile secret: {decoded}")

        r = requests.get(
            f"{WEB_URL}/api/tenants/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        assert r.status_code == 200, (
            f"JWT SSO BROKEN: mobile token rejected by web ({r.status_code} {r.text[:200]})"
        )
        body = r.json()
        # /api/tenants/me returns {"tenant": {...}, "subscription": {...}}
        tenant_obj = body.get("tenant") or body
        assert tenant_obj.get("id") == tid, f"tenant id mismatch: got {tenant_obj}, expected {tid}"

    def test_web_token_accepted_by_mobile(self, created):
        token, tid, email = self._fresh_tenant(WEB_URL, "jwt_w2m", created)
        # Try to decode locally with mobile's JWT_SECRET — informational.
        try:
            decoded = pyjwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            print(f"web-issued JWT decoded on mobile secret: {decoded}")
        except pyjwt.InvalidSignatureError:
            print("web-issued JWT could NOT be decoded with mobile JWT_SECRET — "
                  "JWT_SECRET differs between deployments")

        r = requests.get(
            f"{MOBILE_URL}/api/tenants/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        assert r.status_code == 200, (
            f"JWT SSO BROKEN: web token rejected by mobile ({r.status_code} {r.text[:200]})"
        )
        body = r.json()
        tenant_obj = body.get("tenant") or body
        assert tenant_obj.get("id") == tid, f"tenant id mismatch: got {tenant_obj}, expected {tid}"

    def test_platform_admin_token_cross_backend(self):
        """Login as platform_admin on BOTH backends; use each token against the
        OTHER backend's /api/platform/tenants — must return 200 with the tenant list,
        AND payloads must have identical sub/role."""
        mob = requests.post(
            f"{MOBILE_URL}/api/auth/login",
            json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD},
            timeout=15,
        )
        web = requests.post(
            f"{WEB_URL}/api/auth/login",
            json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD},
            timeout=15,
        )
        assert mob.status_code == 200 and web.status_code == 200, (mob.text, web.text)
        mob_tok = mob.json()["token"]
        web_tok = web.json()["token"]

        # Payload parity — same sub, same role, HS256
        mp = pyjwt.decode(mob_tok, JWT_SECRET, algorithms=["HS256"])
        wp = pyjwt.decode(web_tok, JWT_SECRET, algorithms=["HS256"])
        print(f"mobile-issued platform payload = {mp}")
        print(f"web-issued    platform payload = {wp}")
        assert mp["sub"] == wp["sub"] == EXPECTED_PLATFORM_ID
        assert mp["role"] == wp["role"] == "platform_admin"
        # Both signed with HS256 (decodes cleanly with algorithms=['HS256'])

        # Cross-use
        r1 = requests.get(
            f"{WEB_URL}/api/platform/tenants",
            headers={"Authorization": f"Bearer {mob_tok}"},
            timeout=15,
        )
        assert r1.status_code == 200, f"mobile platform token -> web 401? {r1.status_code} {r1.text[:200]}"
        r2 = requests.get(
            f"{MOBILE_URL}/api/platform/tenants",
            headers={"Authorization": f"Bearer {web_tok}"},
            timeout=15,
        )
        assert r2.status_code == 200, f"web platform token -> mobile 401? {r2.status_code} {r2.text[:200]}"

        # Both return the same tenants (same DB)
        b1 = r1.json()
        b2 = r2.json()
        t1 = b1 if isinstance(b1, list) else b1.get("tenants", [])
        t2 = b2 if isinstance(b2, list) else b2.get("tenants", [])
        print(f"web sees {len(t1)} tenants, mobile sees {len(t2)} tenants")
        assert {t["id"] for t in t1} == {t["id"] for t in t2}, "platform tenant lists differ"


# --------------------------- 6. Direct Atlas cross-check ---------------------------

class TestAtlasDirect:
    def test_web_signup_lands_in_atlas(self, mongo, created):
        """
        Create a fresh tenant via WEB, then read it directly from
        `ParlourPilot` DB using the mobile MONGO_URL. Same doc = shared cluster.
        """
        email, payload = _signup_payload("atlas_web")
        try:
            sr = requests.post(f"{WEB_URL}/api/tenants/signup", json=payload, timeout=30)
        except Exception as e:
            pytest.skip(f"web unreachable: {e}")
        assert sr.status_code == 200, sr.text
        tid = sr.json()["tenant"]["id"]
        created["web"].append(tid)
        created["emails"].append(email)

        time.sleep(2)

        tenant_doc = mongo["tenants"].find_one({"id": tid})
        assert tenant_doc is not None, (
            f"SHARED DB BROKEN: web-created tenant {tid} NOT found in "
            f"Atlas cluster/{DB_NAME}.tenants"
        )
        print(f"Atlas tenants.{{id={tid}}} → business_name={tenant_doc.get('business_name')}")

        # Backends normalise email to lowercase on insert — do the same when
        # querying so we don't get a false-negative from a case mismatch.
        user_doc = mongo["users"].find_one({"email": email.lower()})
        assert user_doc is not None, (
            f"SHARED DB BROKEN: web-created user {email.lower()} NOT found in Atlas users"
        )
        assert user_doc.get("tenant_id") == tid

    def test_platform_admin_row_in_atlas(self, mongo):
        u = mongo["users"].find_one({"email": PLATFORM_EMAIL})
        assert u is not None, "platform_admin user missing from Atlas"
        print(f"Atlas users.platform_admin id = {u.get('id')}")
        assert u.get("id") == EXPECTED_PLATFORM_ID
        assert u.get("role") == "platform_admin"
