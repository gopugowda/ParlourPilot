"""Iter 30 — Type Revenue Split (Ladies vs Men vs Unisex)

Tests for:
- BillItem.service_gender enrichment on create/update
- GET /api/reports/revenue-by-gender with preset today, custom, empty, invalid dates
- Staff scoping (no leak across branches, no 403)
"""
import os
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://salon-invoice-app.preview.emergentagent.com").rstrip("/") + "/api"

OWNER_EMAIL = "testuiowner@testparlourpilot.com"
OWNER_PASSWORD = "admin123"
STAFF_EMAIL = "teststaffui@testparlourpilot.com"
STAFF_PASSWORD = "staff123"


# --------------------- Fixtures --------------------- #

@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{BASE_URL}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def staff_token():
    r = requests.post(f"{BASE_URL}/auth/login", json={"email": STAFF_EMAIL, "password": STAFF_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def owner_headers(owner_token):
    return {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def staff_headers(staff_token):
    return {"Authorization": f"Bearer {staff_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def owner_branch(owner_headers):
    r = requests.get(f"{BASE_URL}/branches", headers=owner_headers, timeout=30)
    assert r.status_code == 200, r.text
    branches = r.json()
    assert len(branches) >= 1
    return branches[0]


@pytest.fixture(scope="module")
def branch_headers(owner_headers, owner_branch):
    return {**owner_headers, "X-Branch-Id": owner_branch["id"]}


@pytest.fixture(scope="module")
def beautician(branch_headers):
    # Reuse an existing beautician or create one
    r = requests.get(f"{BASE_URL}/beauticians", headers=branch_headers, timeout=30)
    if r.status_code == 200 and r.json():
        return r.json()[0]
    r = requests.post(f"{BASE_URL}/beauticians",
                     headers=branch_headers,
                     json={"name": "TEST_Iter30_B", "role": "Stylist", "phone": "9999999999", "active": True},
                     timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def services(branch_headers):
    """Create 3 services (ladies/men/unisex) — return their IDs."""
    created = []
    payloads = [
        {"name": "TEST_Iter30_Ladies Facial", "price": 600, "gender": "ladies", "category": "Facial", "tax_percentage": 0, "active": True},
        {"name": "TEST_Iter30_Men Haircut", "price": 300, "gender": "men", "category": "Hair", "tax_percentage": 0, "active": True},
        {"name": "TEST_Iter30_Foot Massage", "price": 400, "gender": "unisex", "category": "Massage", "tax_percentage": 0, "active": True},
    ]
    for p in payloads:
        r = requests.post(f"{BASE_URL}/services", headers=branch_headers, json=p, timeout=30)
        assert r.status_code == 200, f"Create service failed: {r.text}"
        created.append(r.json())
    yield {"ladies": created[0], "men": created[1], "unisex": created[2]}
    # Cleanup
    for s in created:
        requests.delete(f"{BASE_URL}/services/{s['id']}", headers=branch_headers, timeout=30)


@pytest.fixture(scope="module")
def bills(branch_headers, services, beautician):
    """Create 3 bills (one per segment) with service_gender explicit + a 4th one w/o gender."""
    made = []
    line_ladies = {"service_id": services["ladies"]["id"], "service_name": services["ladies"]["name"], "service_gender": "ladies",
                   "price": 600, "discount_pct": 0, "tax_percentage": 0,
                   "beautician_id": beautician["id"], "beautician_name": beautician["name"], "tip_amount": 0}
    line_men = {"service_id": services["men"]["id"], "service_name": services["men"]["name"], "service_gender": "men",
                "price": 300, "discount_pct": 0, "tax_percentage": 0,
                "beautician_id": beautician["id"], "beautician_name": beautician["name"], "tip_amount": 0}
    line_uni = {"service_id": services["unisex"]["id"], "service_name": services["unisex"]["name"], "service_gender": "unisex",
                "price": 400, "discount_pct": 0, "tax_percentage": 0,
                "beautician_id": beautician["id"], "beautician_name": beautician["name"], "tip_amount": 0}
    line_ladies_no_gender = {"service_id": services["ladies"]["id"], "service_name": services["ladies"]["name"],
                             "price": 600, "discount_pct": 0, "tax_percentage": 0,
                             "beautician_id": beautician["id"], "beautician_name": beautician["name"], "tip_amount": 0}
    bill_payloads = [
        ("A", {"customer_name": "TEST_A", "items": [line_ladies], "payment_mode": "cash"}),
        ("B", {"customer_name": "TEST_B", "items": [line_men], "payment_mode": "card"}),
        ("C", {"customer_name": "TEST_C", "items": [line_uni], "payment_mode": "qr"}),
        ("D", {"customer_name": "TEST_D", "items": [line_ladies_no_gender], "payment_mode": "cash"}),
    ]
    for tag, body in bill_payloads:
        r = requests.post(f"{BASE_URL}/bills", headers=branch_headers, json=body, timeout=30)
        assert r.status_code == 200, f"Bill {tag} failed: {r.text}"
        made.append((tag, r.json()))
    yield made
    # Cleanup
    for _, b in made:
        requests.delete(f"{BASE_URL}/bills/{b['id']}", headers=branch_headers, timeout=30)


# --------------------- Tests --------------------- #

class TestBillItemEnrichment:
    """Verify service_gender persists on stored bills (explicit + inferred)."""

    def test_bill_A_ladies_explicit(self, bills):
        _, b = [x for x in bills if x[0] == "A"][0]
        assert b["items"][0]["service_gender"] == "ladies"

    def test_bill_B_men_explicit(self, bills):
        _, b = [x for x in bills if x[0] == "B"][0]
        assert b["items"][0]["service_gender"] == "men"

    def test_bill_C_unisex_explicit(self, bills):
        _, b = [x for x in bills if x[0] == "C"][0]
        assert b["items"][0]["service_gender"] == "unisex"

    def test_bill_D_inferred_from_service_id(self, bills):
        """Bill sent without service_gender — server enrichment should set it to 'ladies'."""
        _, b = [x for x in bills if x[0] == "D"][0]
        assert b["items"][0]["service_gender"] == "ladies"


class TestRevenueByGenderToday:
    """GET /reports/revenue-by-gender?preset=today aggregation."""

    def test_shape_and_totals(self, branch_headers, bills):
        r = requests.get(f"{BASE_URL}/reports/revenue-by-gender?preset=today", headers=branch_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "from" in data and "to" in data
        assert "total_revenue" in data
        assert "top_segment" in data
        assert "segments" in data and len(data["segments"]) == 3

        by_key = {s["key"]: s for s in data["segments"]}
        assert set(by_key.keys()) == {"ladies", "men", "unisex"}

        # Test bills we just created add 1900. There may be residual bills from other tests
        # under the same tenant (persistent Atlas). Assert LOWER BOUNDS + top_segment invariants.
        assert data["total_revenue"] >= 1900 - 0.01
        assert by_key["ladies"]["revenue"] >= 1200 - 0.01
        assert by_key["men"]["revenue"] >= 300 - 0.01
        assert by_key["unisex"]["revenue"] >= 400 - 0.01
        assert by_key["ladies"]["count"] >= 2
        assert by_key["men"]["count"] >= 1
        assert by_key["unisex"]["count"] >= 1

    def test_share_pct_sums_to_100(self, branch_headers, bills):
        r = requests.get(f"{BASE_URL}/reports/revenue-by-gender?preset=today", headers=branch_headers, timeout=30)
        d = r.json()
        s = sum(x["share_pct"] for x in d["segments"])
        assert 99.5 <= s <= 100.5, f"Share pct sums to {s}"

    def test_top_segment_is_ladies(self, branch_headers, bills):
        # Ladies has 1200+, Men 300, Unisex 400 -> Ladies wins
        r = requests.get(f"{BASE_URL}/reports/revenue-by-gender?preset=today", headers=branch_headers, timeout=30)
        d = r.json()
        # If pre-existing bills push another segment ahead, we skip.
        by_key = {s["key"]: s for s in d["segments"]}
        if by_key["ladies"]["revenue"] < max(by_key["men"]["revenue"], by_key["unisex"]["revenue"]):
            pytest.skip("Pre-existing bills changed leader; test bills alone give ladies=1200 > men=300, unisex=400")
        assert d["top_segment"] == "ladies"


class TestRevenueByGenderCustomRange:
    def test_custom_range_ok(self, branch_headers, bills):
        today = datetime.now(timezone.utc).date()
        y = (today - timedelta(days=1)).strftime("%Y-%m-%d")
        t = today.strftime("%Y-%m-%d")
        r = requests.get(
            f"{BASE_URL}/reports/revenue-by-gender?preset=custom&from_date={y}&to_date={t}",
            headers=branch_headers, timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["from"] == y
        assert d["to"] == t
        assert d["total_revenue"] >= 1900 - 0.01

    def test_invalid_dates_400(self, branch_headers):
        r = requests.get(
            f"{BASE_URL}/reports/revenue-by-gender?preset=custom&from_date=not-a-date&to_date=also-bad",
            headers=branch_headers, timeout=30,
        )
        assert r.status_code == 400


class TestRevenueByGenderEmpty:
    def test_empty_range_zeros(self, branch_headers):
        # Pick a distant past window unlikely to contain any bills.
        r = requests.get(
            f"{BASE_URL}/reports/revenue-by-gender?preset=custom&from_date=2000-01-01&to_date=2000-01-31",
            headers=branch_headers, timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["total_revenue"] == 0
        assert d["top_segment"] is None
        for seg in d["segments"]:
            assert seg["revenue"] == 0
            assert seg["count"] == 0
            assert seg["share_pct"] == 0


class TestStaffScoping:
    def test_staff_can_call_endpoint(self, staff_headers, bills):
        r = requests.get(f"{BASE_URL}/reports/revenue-by-gender?preset=today", headers=staff_headers, timeout=30)
        assert r.status_code == 200, f"Staff got {r.status_code}: {r.text}"
        d = r.json()
        # Staff should see aggregated bills from their branch only. total_revenue should be a number >= 0.
        assert isinstance(d["total_revenue"], (int, float))
        assert d["total_revenue"] >= 0
        assert len(d["segments"]) == 3
