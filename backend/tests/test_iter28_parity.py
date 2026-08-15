"""Iter 28: 3 smaller parity items for ParlourPilot.

Covers:
1) Bill edit_history persists on each PUT (owner-editable).
2) Staff Members: POST + PUT allowed with tier_id; DELETE forbidden (403); admin DELETE ok.
3) Tenant member_tiers CRUD via PUT/GET /api/tenants/me.
4) Member tier resolves in bill math (VIP tier 25% / min 500, manual override wins).
"""
import os
import time
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE}/api"

ADMIN_EMAIL = "testuiowner@testparlourpilot.com"
ADMIN_PW = "admin123"
STAFF_EMAIL = "teststaffui@testparlourpilot.com"
STAFF_PW = "staff123"


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    r.raise_for_status()
    return r.json()


@pytest.fixture(scope="session")
def admin_ctx():
    d = _login(ADMIN_EMAIL, ADMIN_PW)
    branch_id = (d.get("branches") or [{}])[0].get("id") or d["user"].get("branch_id")
    return {
        "token": d["token"],
        "user": d["user"],
        "branch_id": branch_id,
        "headers": {"Authorization": f"Bearer {d['token']}", "X-Branch-Id": branch_id or ""},
    }


@pytest.fixture(scope="session")
def staff_ctx():
    d = _login(STAFF_EMAIL, STAFF_PW)
    branch_id = (d.get("branches") or [{}])[0].get("id") or d["user"].get("branch_id")
    return {
        "token": d["token"],
        "user": d["user"],
        "branch_id": branch_id,
        "headers": {"Authorization": f"Bearer {d['token']}", "X-Branch-Id": branch_id or ""},
    }


# ============ 1) Bill edit_history ============
class TestBillEditHistory:
    def test_edit_history_appends_on_each_put(self, admin_ctx):
        # Create a fresh bill
        payload = {
            "customer_name": "TEST_EDIT_HISTORY",
            "items": [{
                "service_name": "Haircut", "price": 100, "discount_pct": 0,
                "tax_percentage": 0, "beautician_name": "S1",
            }],
            "payment_mode": "cash",
        }
        r = requests.post(f"{API}/bills", json=payload, headers=admin_ctx["headers"], timeout=30)
        assert r.status_code == 200, r.text
        bid = r.json()["id"]

        # GET bill: edit_history missing/empty
        r0 = requests.get(f"{API}/bills/{bid}", headers=admin_ctx["headers"], timeout=30)
        assert r0.status_code == 200, r0.text
        eh0 = r0.json().get("edit_history") or []
        assert eh0 == [] or eh0 is None, f"expected empty edit_history initially, got {eh0}"

        # First PUT
        put1 = dict(payload)
        put1["customer_name"] = "TEST_EDIT_HISTORY_v1"
        r1 = requests.put(f"{API}/bills/{bid}", json=put1, headers=admin_ctx["headers"], timeout=30)
        assert r1.status_code == 200, r1.text

        r1g = requests.get(f"{API}/bills/{bid}", headers=admin_ctx["headers"], timeout=30)
        eh1 = r1g.json().get("edit_history") or []
        assert len(eh1) == 1, f"expected 1 history entry, got {len(eh1)}: {eh1}"
        entry = eh1[0]
        assert "edited_by" in entry and entry["edited_by"], entry
        assert "edited_by_name" in entry and entry["edited_by_name"], entry
        assert "edited_at" in entry and entry["edited_at"], entry

        # Second PUT
        put2 = dict(payload)
        put2["customer_name"] = "TEST_EDIT_HISTORY_v2"
        r2 = requests.put(f"{API}/bills/{bid}", json=put2, headers=admin_ctx["headers"], timeout=30)
        assert r2.status_code == 200, r2.text

        r2g = requests.get(f"{API}/bills/{bid}", headers=admin_ctx["headers"], timeout=30)
        eh2 = r2g.json().get("edit_history") or []
        assert len(eh2) == 2, f"expected 2 history entries, got {len(eh2)}"

        # Cleanup
        requests.delete(f"{API}/bills/{bid}", headers=admin_ctx["headers"], timeout=30)


# ============ 2) Staff Members RBAC ============
class TestStaffMembersRBAC:
    def test_staff_add_renew_ok_delete_forbidden(self, admin_ctx, staff_ctx):
        # Ensure tenant has member_tiers with 'student' so tier_id persists
        tiers_body = {"member_tiers": [
            {"id": "regular", "name": "Regular", "discount_pct": 10, "min_price": 100},
            {"id": "student", "name": "Student", "discount_pct": 20, "min_price": 100},
            {"id": "vip", "name": "VIP", "discount_pct": 25, "min_price": 500},
        ]}
        rt = requests.put(f"{API}/tenants/me", json=tiers_body, headers=admin_ctx["headers"], timeout=30)
        assert rt.status_code == 200, rt.text

        phone = f"9999{int(time.time()) % 1000000:06d}"
        # Staff POST
        rc = requests.post(
            f"{API}/members",
            json={"name": "TEST_Staff_Member", "phone": phone, "tier_id": "student"},
            headers=staff_ctx["headers"], timeout=30,
        )
        assert rc.status_code == 200, rc.text
        m = rc.json()
        assert m.get("tier_id") == "student", m
        mid = m["id"]

        # Staff PUT (renew) -> new expires_at
        put_payload = {
            "name": m["name"],
            "phone": m["phone"],
            "joined_at": m.get("joined_at"),
            "expires_at": "2030-12-31",
            "tier_id": "student",
            "active": True,
        }
        rp = requests.put(f"{API}/members/{mid}", json=put_payload, headers=staff_ctx["headers"], timeout=30)
        assert rp.status_code == 200, rp.text
        assert rp.json().get("expires_at") == "2030-12-31"

        # Staff DELETE -> 403
        rd = requests.delete(f"{API}/members/{mid}", headers=staff_ctx["headers"], timeout=30)
        assert rd.status_code == 403, rd.text

        # Admin DELETE -> 200
        rda = requests.delete(f"{API}/members/{mid}", headers=admin_ctx["headers"], timeout=30)
        assert rda.status_code == 200, rda.text


# ============ 3) Tenant member_tiers CRUD ============
class TestMemberTiersCRUD:
    def test_put_and_get_member_tiers(self, admin_ctx):
        tiers = [
            {"id": "regular", "name": "Regular", "discount_pct": 10, "min_price": 100},
            {"id": "student", "name": "Student", "discount_pct": 20, "min_price": 100},
            {"id": "vip", "name": "VIP", "discount_pct": 25, "min_price": 500},
        ]
        rp = requests.put(f"{API}/tenants/me", json={"member_tiers": tiers}, headers=admin_ctx["headers"], timeout=30)
        assert rp.status_code == 200, rp.text

        rg = requests.get(f"{API}/tenants/me", headers=admin_ctx["headers"], timeout=30)
        assert rg.status_code == 200, rg.text
        body = rg.json()
        tenant = body.get("tenant") or body
        got = tenant.get("member_tiers") or []
        assert isinstance(got, list) and len(got) == 3, got
        by_id = {t["id"]: t for t in got}
        for t in tiers:
            g = by_id.get(t["id"])
            assert g is not None, f"missing tier {t['id']}"
            assert g["name"] == t["name"]
            assert float(g["discount_pct"]) == float(t["discount_pct"])
            assert float(g["min_price"]) == float(t["min_price"])


# ============ 4) Member tier resolves in bill math ============
class TestMemberTierInBillMath:
    def test_vip_tier_applied_by_price_and_manual_wins(self, admin_ctx):
        # Ensure vip tier is present
        tiers = [
            {"id": "regular", "name": "Regular", "discount_pct": 10, "min_price": 100},
            {"id": "student", "name": "Student", "discount_pct": 20, "min_price": 100},
            {"id": "vip", "name": "VIP", "discount_pct": 25, "min_price": 500},
        ]
        rt = requests.put(f"{API}/tenants/me", json={"member_tiers": tiers}, headers=admin_ctx["headers"], timeout=30)
        assert rt.status_code == 200, rt.text

        phone = f"8888{int(time.time()) % 1000000:06d}"
        rc = requests.post(
            f"{API}/members",
            json={"name": "TEST_VIP", "phone": phone, "tier_id": "vip"},
            headers=admin_ctx["headers"], timeout=30,
        )
        assert rc.status_code == 200, rc.text
        mid = rc.json()["id"]

        try:
            payload = {
                "customer_name": "TEST_VIP",
                "customer_phone": phone,
                "is_member": True,
                "items": [
                    {"service_name": "A", "price": 600, "discount_pct": 0, "tax_percentage": 0, "beautician_name": "S1"},
                    {"service_name": "B", "price": 400, "discount_pct": 0, "tax_percentage": 0, "beautician_name": "S1"},
                    {"service_name": "C", "price": 600, "discount_pct": 30, "tax_percentage": 0, "beautician_name": "S1"},
                ],
                "payment_mode": "cash",
            }
            r = requests.post(f"{API}/bills", json=payload, headers=admin_ctx["headers"], timeout=30)
            assert r.status_code == 200, r.text
            b = r.json()
            items = b["items"]
            # A: price 600 > 500 -> VIP tier 25%
            assert items[0]["effective_discount_pct"] == 25, items[0]
            # B: price 400 <= 500 -> below min -> 0
            assert items[1]["effective_discount_pct"] == 0, items[1]
            # C: manual 30% wins over VIP 25%
            assert items[2]["effective_discount_pct"] == 30, items[2]

            # Cleanup bill
            requests.delete(f"{API}/bills/{b['id']}", headers=admin_ctx["headers"], timeout=30)
        finally:
            requests.delete(f"{API}/members/{mid}", headers=admin_ctx["headers"], timeout=30)
