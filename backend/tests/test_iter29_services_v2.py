"""Iter 29 backend parity tests: Service CRUD w/ new fields (additional_price/gender/category),
   /services/categories endpoint, and backward compat for older bills w/o these fields."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"

OWNER_EMAIL = "testuiowner@testparlourpilot.com"
OWNER_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{BASE_URL}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def owner_headers(owner_token):
    return {"Authorization": f"Bearer {owner_token}", "Content-Type": "application/json"}


# ---------- 1) Service CRUD with new fields ----------
class TestServiceCRUDNewFields:
    created_sid = None

    def test_create_service_with_new_fields(self, owner_headers):
        payload = {
            "name": "TEST_Haircut Long",
            "price": 500,
            "additional_price": 200,
            "gender": "ladies",
            "category": "Hair",
            "tax_percentage": 5,
        }
        r = requests.post(f"{BASE_URL}/services", headers=owner_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == "TEST_Haircut Long"
        assert d["price"] == 500
        assert d["additional_price"] == 200
        assert d["gender"] == "ladies"
        assert d["category"] == "Hair"
        assert d["tax_percentage"] == 5
        assert "id" in d
        TestServiceCRUDNewFields.created_sid = d["id"]

    def test_list_shows_new_service_with_fields(self, owner_headers):
        assert TestServiceCRUDNewFields.created_sid
        r = requests.get(f"{BASE_URL}/services", headers=owner_headers, timeout=15)
        assert r.status_code == 200
        items = r.json()
        match = [s for s in items if s["id"] == TestServiceCRUDNewFields.created_sid]
        assert len(match) == 1
        s = match[0]
        assert s["additional_price"] == 200
        assert s["gender"] == "ladies"
        assert s["category"] == "Hair"

    def test_update_service_new_fields(self, owner_headers):
        sid = TestServiceCRUDNewFields.created_sid
        assert sid
        payload = {
            "name": "TEST_Haircut Premium",
            "price": 600,
            "additional_price": 250,
            "gender": "unisex",
            "category": "Bridal",
            "tax_percentage": 5,
        }
        r = requests.put(f"{BASE_URL}/services/{sid}", headers=owner_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == "TEST_Haircut Premium"
        assert d["price"] == 600
        assert d["additional_price"] == 250
        assert d["gender"] == "unisex"
        assert d["category"] == "Bridal"

        # verify persisted via GET
        r2 = requests.get(f"{BASE_URL}/services", headers=owner_headers, timeout=15)
        s = [x for x in r2.json() if x["id"] == sid][0]
        assert s["additional_price"] == 250
        assert s["gender"] == "unisex"
        assert s["category"] == "Bridal"

    def test_delete_service(self, owner_headers):
        sid = TestServiceCRUDNewFields.created_sid
        assert sid
        r = requests.delete(f"{BASE_URL}/services/{sid}", headers=owner_headers, timeout=15)
        assert r.status_code == 200


# ---------- 2) /api/services/categories ----------
class TestServiceCategories:
    def test_categories_endpoint(self, owner_headers):
        r = requests.get(f"{BASE_URL}/services/categories", headers=owner_headers, timeout=15)
        assert r.status_code == 200, r.text
        cats = r.json()
        assert isinstance(cats, list)
        assert all(isinstance(c, str) for c in cats)
        # seeded defaults must be present
        defaults = {"Hair", "Skin", "Nails", "Facial", "Bridal", "Massage", "Waxing", "Threading", "General"}
        assert defaults.issubset(set(cats)), f"Missing defaults. Got: {cats}"

    def test_categories_merges_tenant_categories(self, owner_headers):
        # Create a service with a unique category and check that it appears
        unique_cat = "TEST_HennaArt"
        r = requests.post(
            f"{BASE_URL}/services",
            headers=owner_headers,
            json={"name": "TEST_HennaSvc", "price": 100, "category": unique_cat},
            timeout=15,
        )
        assert r.status_code == 200
        sid = r.json()["id"]
        try:
            r2 = requests.get(f"{BASE_URL}/services/categories", headers=owner_headers, timeout=15)
            assert r2.status_code == 200
            cats = r2.json()
            assert unique_cat in cats
        finally:
            requests.delete(f"{BASE_URL}/services/{sid}", headers=owner_headers, timeout=15)


# ---------- 3) Backward compatibility ----------
class TestBackwardCompat:
    def test_create_service_without_new_fields_defaults(self, owner_headers):
        r = requests.post(
            f"{BASE_URL}/services",
            headers=owner_headers,
            json={"name": "TEST_BareBones", "price": 300, "category": "General"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["additional_price"] == 0
        assert d["gender"] == "unisex"
        sid = d["id"]
        # cleanup
        requests.delete(f"{BASE_URL}/services/{sid}", headers=owner_headers, timeout=15)

    def test_existing_bills_still_listable(self, owner_headers):
        # existing bills stored without the new service fields should still be listable
        r = requests.get(f"{BASE_URL}/bills", headers=owner_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)
