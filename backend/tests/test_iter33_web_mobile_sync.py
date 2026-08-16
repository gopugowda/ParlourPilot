"""
Iter 33 — Web ↔ Mobile field-name sync tests for Services + Bill enrichment.
Verifies POST/PUT /services writes BOTH schemas (service_type / variable_price
plus gender / additional_price), and bill creation enriches service_gender
from service_type when only service_type is present on the service record.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
PROD_API = "https://salon-invoice-app.emergent.host/api"

OWNER_EMAIL = "book@glowupunisexsalon.com"
OWNER_PASSWORD = "Gopi_1511"


@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data
    return data["token"]


@pytest.fixture(scope="module")
def auth_headers(owner_token):
    return {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}


class TestLogin:
    """Sanity: PROD-user credentials work on preview."""

    def test_login_book_glowup(self, owner_token):
        assert owner_token and isinstance(owner_token, str)

    def test_login_returns_user(self):
        r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert "user" in j
        u = j["user"]
        assert u.get("email") == OWNER_EMAIL
        assert u.get("role") in ("admin", "owner")

    def test_login_platform_admin(self):
        r = requests.post(f"{API}/auth/login", json={"email": "platform@parlourpilot.com", "password": "platform123"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["user"]["role"] in ("platform_admin", "platform_super")


class TestServicesRoundTrip:
    """POST/PUT /services must write BOTH web and mobile schemas."""

    created_ids: list = []

    def test_create_ladies_no_variable(self, auth_headers):
        body = {"name": "TEST_Sync_A", "price": 500, "additional_price": 0, "gender": "ladies", "category": "Hair"}
        r = requests.post(f"{API}/services", json=body, headers=auth_headers, timeout=30)
        assert r.status_code in (200, 201), r.text
        d = r.json()
        assert d.get("service_type") == "Ladies"
        assert d.get("gender") == "ladies"
        assert d.get("variable_price") is False
        assert float(d.get("additional_price", 0)) == 0.0
        TestServicesRoundTrip.created_ids.append(d["id"])

    def test_create_men_with_variable(self, auth_headers):
        body = {"name": "TEST_Sync_B", "price": 300, "additional_price": 200, "gender": "men", "category": "Hair"}
        r = requests.post(f"{API}/services", json=body, headers=auth_headers, timeout=30)
        assert r.status_code in (200, 201), r.text
        d = r.json()
        assert d.get("service_type") == "Men"
        assert d.get("gender") == "men"
        assert d.get("variable_price") is True
        assert float(d.get("additional_price", 0)) == 200.0
        TestServicesRoundTrip.created_ids.append(d["id"])

    def test_list_contains_both_schemas(self, auth_headers):
        r = requests.get(f"{API}/services", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        docs = r.json()
        found = {s["id"]: s for s in docs if s.get("id") in TestServicesRoundTrip.created_ids}
        assert len(found) == 2
        for sid, s in found.items():
            assert "service_type" in s
            assert "variable_price" in s
            assert "gender" in s
            assert "additional_price" in s

    def test_update_to_unisex(self, auth_headers):
        sid = TestServicesRoundTrip.created_ids[0]
        body = {"name": "TEST_Sync_A", "price": 500, "additional_price": 0, "gender": "unisex", "category": "Hair"}
        r = requests.put(f"{API}/services/{sid}", json=body, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("service_type") == "Unisex"
        assert d.get("gender") == "unisex"

    def test_zzz_cleanup(self, auth_headers):
        for sid in TestServicesRoundTrip.created_ids:
            r = requests.delete(f"{API}/services/{sid}", headers=auth_headers, timeout=30)
            assert r.status_code in (200, 404)


class TestProdReadOnly:
    """PROD read-only: verify web-authored services carry service_type."""

    def test_prod_login_and_service_type_present(self):
        try:
            r = requests.post(f"{PROD_API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=30)
        except Exception as e:
            pytest.skip(f"Prod unreachable: {e}")
        if r.status_code != 200:
            pytest.skip(f"Prod login failed: {r.status_code}")
        token = r.json().get("token")
        r2 = requests.get(f"{PROD_API}/services", headers={"Authorization": f"Bearer {token}"}, timeout=30)
        assert r2.status_code == 200
        docs = r2.json()
        assert isinstance(docs, list) and len(docs) > 0, "Expected services on prod for this tenant"
        with_stype = [s for s in docs if s.get("service_type") in ("Ladies", "Men", "Unisex")]
        assert len(with_stype) >= 1, "No prod services carry service_type"
        # Sample: confirm at least one web-authored (no `gender` key) exists.
        # (May not always be true if all were re-saved via mobile, but we log count.)
        web_only = [s for s in docs if s.get("service_type") and not s.get("gender")]
        print(f"Prod services total={len(docs)} with_service_type={len(with_stype)} web_only(no gender)={len(web_only)}")


class TestBillEnrichmentFromServiceType:
    """
    Simulate a web-authored service (only `service_type`, no `gender`) then POST a bill
    without service_gender and verify the stored line item has service_gender enriched.
    """

    svc_id: str = ""
    bill_id: str = ""

    def test_create_service_then_strip_gender_direct_db(self, auth_headers):
        # Create via API (writes both schemas)
        body = {"name": "TEST_WebAuthored_C", "price": 400, "additional_price": 0, "gender": "ladies", "category": "Hair"}
        r = requests.post(f"{API}/services", json=body, headers=auth_headers, timeout=30)
        assert r.status_code in (200, 201)
        TestBillEnrichmentFromServiceType.svc_id = r.json()["id"]

        # Strip `gender` directly in DB, leaving only `service_type: Ladies`.
        from pymongo import MongoClient
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        client = MongoClient(os.environ["MONGO_URL"])
        dbh = client[os.environ.get("DB_NAME", "ParlourPilot")]
        res = dbh.services.update_one({"id": TestBillEnrichmentFromServiceType.svc_id}, {"$unset": {"gender": ""}})
        assert res.matched_count == 1
        doc = dbh.services.find_one({"id": TestBillEnrichmentFromServiceType.svc_id})
        assert doc.get("service_type") == "Ladies"
        assert "gender" not in doc
        client.close()

    def test_create_bill_enriches_service_gender(self, auth_headers):
        sid = TestBillEnrichmentFromServiceType.svc_id
        assert sid
        payload = {
            "customer_name": "TEST_Cust",
            "customer_phone": "",
            "items": [{
                "service_id": sid,
                "service_name": "TEST_WebAuthored_C",
                "price": 400,
                "beautician_name": "TEST_Staff",
            }],
            "payment_mode": "cash",
        }
        r = requests.post(f"{API}/bills", json=payload, headers=auth_headers, timeout=30)
        assert r.status_code in (200, 201), r.text
        b = r.json()
        TestBillEnrichmentFromServiceType.bill_id = b["id"]
        items = b.get("items", [])
        assert len(items) == 1
        assert items[0].get("service_gender") == "ladies", f"Expected ladies from service_type, got {items[0].get('service_gender')}"

    def test_zzz_cleanup(self, auth_headers):
        bid = TestBillEnrichmentFromServiceType.bill_id
        sid = TestBillEnrichmentFromServiceType.svc_id
        if bid:
            requests.delete(f"{API}/bills/{bid}", headers=auth_headers, timeout=30)
        if sid:
            requests.delete(f"{API}/services/{sid}", headers=auth_headers, timeout=30)
