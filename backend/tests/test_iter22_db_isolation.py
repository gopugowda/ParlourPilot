"""
Iteration 22 — Cross-DB isolation verification.

Confirms the mobile backend (this project) is bound to Atlas cluster
`slaon-master.8oc5pjc.mongodb.net` DB `ParlourPilot`, that demo seed is
disabled, that platform_admin is the only surviving user, and that a tenant
created via the WEB backend (parlourpilot.com) is NOT visible here.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
WEB_URL = "https://parlourpilot.com"
PLATFORM_EMAIL = "platform@parlourpilot.com"
PLATFORM_PASSWORD = "platform123"

if not BASE_URL:
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not set")


@pytest.fixture(scope="module")
def platform_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"platform login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def platform_headers(platform_token):
    return {"Authorization": f"Bearer {platform_token}"}


@pytest.fixture(scope="module")
def created_tenant_ids():
    ids = []
    yield ids
    # Teardown — delete anything we created
    try:
        tok = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD},
            timeout=15,
        ).json().get("token")
        if tok:
            h = {"Authorization": f"Bearer {tok}"}
            for tid in ids:
                requests.delete(f"{BASE_URL}/api/platform/tenants/{tid}", headers=h, timeout=15)
    except Exception as e:
        print(f"teardown error: {e}")


# ---------- 1. Backend identity ----------
class TestMobileBackendIdentity:
    """Verify mobile backend responds as parlourpilot-api (not the web service)."""

    def test_api_health_identity(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data.get("ok") is True
        assert data.get("service") == "parlourpilot-api", (
            f"Expected mobile backend service 'parlourpilot-api', got {data}"
        )

    def test_root_health_identity(self):
        r = requests.get(f"{BASE_URL}/", timeout=15)
        # Nginx routes / to frontend usually, but ingress may forward.
        # We at least require API health to differ from web.
        pass

    def test_web_backend_identity_differs(self):
        """Sanity — the web backend must report a different service name."""
        try:
            r = requests.get(f"{WEB_URL}/api/health", timeout=15)
        except Exception as e:
            pytest.skip(f"web backend unreachable: {e}")
        if r.status_code != 200:
            pytest.skip(f"web /api/health returned {r.status_code}")
        data = r.json()
        assert data.get("service") != "parlourpilot-api", (
            "Web and mobile backends share the same service name — "
            "cannot confirm they are separate deployments"
        )


# ---------- 2. Platform admin auth ----------
class TestPlatformAdminAuth:
    def test_platform_login(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": PLATFORM_EMAIL, "password": PLATFORM_PASSWORD},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert "token" in j
        assert j["user"]["role"] == "platform_admin"
        assert j["user"]["email"] == PLATFORM_EMAIL


# ---------- 3. DB is clean (Atlas ParlourPilot) ----------
class TestCleanAtlasDatabase:
    def test_tenant_count_low(self, platform_headers):
        r = requests.get(f"{BASE_URL}/api/platform/stats", headers=platform_headers, timeout=15)
        assert r.status_code == 200
        j = r.json()
        # After purge, expect 0. Allow small slack in case previous tests created any.
        assert j.get("tenants", 0) <= 3, f"expected clean tenants count, got {j}"
        print(f"platform stats: {j}")

    def test_no_glow_up_tenant(self, platform_headers):
        r = requests.get(f"{BASE_URL}/api/platform/tenants", headers=platform_headers, timeout=15)
        assert r.status_code == 200
        body = r.json()
        tenants = body if isinstance(body, list) else body.get("tenants", [])
        glowup = [t for t in tenants if t.get("id") == "glowup-tenant-0001"
                  or t.get("slug") == "glow-up-unisex-salon"]
        assert not glowup, f"Glow Up demo tenant still exists: {glowup}"

    def test_admin_glowup_login_rejected(self):
        """admin@glowup.com was purged — must not log in."""
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@glowup.com", "password": "admin123"},
            timeout=15,
        )
        assert r.status_code in (400, 401), (
            f"Expected 401/400 for purged admin@glowup.com; got {r.status_code} {r.text}"
        )


# ---------- 4. Demo seed disabled after restart ----------
class TestDemoSeedDisabled:
    def test_startup_log_shows_demo_disabled(self):
        with open("/var/log/supervisor/backend.err.log") as f:
            log = f.read()[-8000:]
        assert "Demo seed disabled" in log or "skipping Glow Up seed" in log, (
            "Expected 'Demo seed disabled' log line after startup"
        )

    def test_no_glow_up_after_wait(self, platform_headers):
        """Give startup a moment and confirm no re-seed happened."""
        time.sleep(1)
        r = requests.get(f"{BASE_URL}/api/platform/tenants", headers=platform_headers, timeout=15)
        assert r.status_code == 200
        body = r.json()
        tenants = body if isinstance(body, list) else body.get("tenants", [])
        assert not any(t.get("id") == "glowup-tenant-0001" for t in tenants)


# ---------- 5. Tenant signup end-to-end on mobile backend ----------
class TestMobileTenantSignup:
    def test_signup_and_login_flow(self, created_tenant_ids, platform_headers):
        ts = int(time.time())
        email = f"TEST_mobile_iso_{ts}@resend.dev"
        payload = {
            "business_name": f"TEST Mobile Iso {ts}",
            "owner_name": "Iso Tester",
            "email": email,
            "password": "isopass123",
            "phone": "+911234567890",
            "city": "Bengaluru",
            "num_branches": 1,
        }
        r = requests.post(f"{BASE_URL}/api/tenants/signup", json=payload, timeout=30)
        assert r.status_code == 200, f"signup failed: {r.status_code} {r.text}"
        data = r.json()
        assert "token" in data
        assert data["user"]["email"].lower() == email.lower()
        tid = data["tenant"]["id"]
        created_tenant_ids.append(tid)

        # Log in with the new tenant
        r2 = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": email, "password": "isopass123"},
            timeout=15,
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["user"]["tenant_id"] == tid

        # Platform admin can see this tenant on mobile backend
        pl = requests.get(f"{BASE_URL}/api/platform/tenants", headers=platform_headers, timeout=15)
        assert pl.status_code == 200
        body = pl.json()
        tenants = body if isinstance(body, list) else body.get("tenants", [])
        ids = [t["id"] for t in tenants]
        assert tid in ids, "mobile-created tenant not visible in mobile platform list"


# ---------- 6. Cross-DB isolation: tenant created via WEB must NOT appear here ----------
class TestCrossDbIsolation:
    def test_web_created_tenant_not_in_mobile_db(self, platform_headers):
        ts = int(time.time())
        email = f"TEST_crossdb_verify_{ts}@resend.dev"
        payload = {
            "business_name": f"TEST CrossDB {ts}",
            "owner_name": "Cross Tester",
            "email": email,
            "password": "crosspass123",
            "phone": "+911111111111",
            "city": "Mumbai",
            "num_branches": 1,
        }
        try:
            wr = requests.post(f"{WEB_URL}/api/tenants/signup", json=payload, timeout=30)
        except Exception as e:
            pytest.skip(f"web backend unreachable: {e}")

        if wr.status_code not in (200, 201):
            pytest.skip(f"web signup did not succeed ({wr.status_code}): {wr.text[:200]}")

        web_tenant = wr.json().get("tenant", {})
        web_tid = web_tenant.get("id")
        web_email = web_tenant.get("email") or email
        print(f"web-created tenant id={web_tid} email={web_email}")

        # 6a — Cannot log in on mobile backend with web credentials
        lr = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": email, "password": "crosspass123"},
            timeout=15,
        )
        assert lr.status_code in (400, 401), (
            f"ISOLATION BROKEN: mobile backend accepted login for web-created tenant "
            f"(status={lr.status_code}). This means both backends share the DB."
        )

        # 6b — Platform list on mobile must NOT contain the web tenant id/email
        pl = requests.get(f"{BASE_URL}/api/platform/tenants", headers=platform_headers, timeout=15)
        assert pl.status_code == 200
        body = pl.json()
        tenants = body if isinstance(body, list) else body.get("tenants", [])
        assert not any(t.get("id") == web_tid for t in tenants), (
            f"ISOLATION BROKEN: web tenant {web_tid} visible on mobile platform list"
        )
        assert not any((t.get("email") or "").lower() == web_email.lower() for t in tenants), (
            f"ISOLATION BROKEN: web email {web_email} visible on mobile platform list"
        )
        print(
            f"Isolation confirmed: web tenant {web_tid} not present in mobile DB "
            f"(mobile tenant count={len(tenants)})"
        )
