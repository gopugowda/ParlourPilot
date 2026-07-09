"""GLOW UP Salon Billing API — end-to-end backend tests"""
import os
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://salon-invoice-app.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_token(http):
    # ensure seed
    http.post(f"{API}/seed", timeout=30)
    r = http.post(f"{API}/auth/login", json={"email": "admin@glowup.com", "password": "admin123"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def staff_token(http):
    r = http.post(f"{API}/auth/login", json={"email": "staff@glowup.com", "password": "staff123"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- Health & Seed ----------
def test_root(http):
    r = http.get(f"{API}/", timeout=10)
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


def test_seed_idempotent(http):
    r1 = http.post(f"{API}/seed", timeout=30)
    r2 = http.post(f"{API}/seed", timeout=30)
    assert r1.status_code == 200 and r2.status_code == 200
    # second call should create nothing
    assert r2.json()["seeded"] == {"users": 0, "beauticians": 0, "services": 0}


# ---------- Auth ----------
def test_admin_login(admin_token):
    assert admin_token and isinstance(admin_token, str)


def test_staff_login(staff_token):
    assert staff_token and isinstance(staff_token, str)


def test_bad_login(http):
    r = http.post(f"{API}/auth/login", json={"email": "admin@glowup.com", "password": "wrong"}, timeout=10)
    assert r.status_code == 401


def test_me(http, admin_token):
    r = http.get(f"{API}/auth/me", headers=_auth(admin_token), timeout=10)
    assert r.status_code == 200
    assert r.json()["email"] == "admin@glowup.com"
    assert r.json()["role"] == "admin"


def test_no_auth_rejected(http):
    r = http.get(f"{API}/bills", timeout=10)
    assert r.status_code == 401


def test_staff_cant_register(http, staff_token):
    r = http.post(f"{API}/auth/register", headers=_auth(staff_token),
                  json={"name": "x", "email": "x@x.com", "password": "p", "role": "staff"}, timeout=10)
    assert r.status_code == 403


# ---------- Beauticians / Services ----------
def test_beauticians_seeded(http, admin_token):
    r = http.get(f"{API}/beauticians", headers=_auth(admin_token), timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list) and len(data) >= 8


def test_services_seeded(http, admin_token):
    r = http.get(f"{API}/services", headers=_auth(admin_token), timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list) and len(data) >= 17


def test_service_crud(http, admin_token):
    h = _auth(admin_token)
    r = http.post(f"{API}/services", headers=h,
                  json={"name": "TEST_Service", "price": 199.5, "category": "TEST"}, timeout=10)
    assert r.status_code == 200
    sid = r.json()["id"]
    assert r.json()["price"] == 199.5
    # update
    r2 = http.put(f"{API}/services/{sid}", headers=h,
                  json={"name": "TEST_Service2", "price": 250, "category": "TEST", "active": True}, timeout=10)
    assert r2.status_code == 200 and r2.json()["price"] == 250
    # verify via list
    lst = http.get(f"{API}/services", headers=h, timeout=10).json()
    assert any(s["id"] == sid and s["name"] == "TEST_Service2" for s in lst)
    # delete
    r3 = http.delete(f"{API}/services/{sid}", headers=h, timeout=10)
    assert r3.status_code == 200


def test_beautician_crud(http, admin_token):
    h = _auth(admin_token)
    r = http.post(f"{API}/beauticians", headers=h,
                  json={"name": "TEST_Bea", "role": "Stylist", "phone": "9999", "active": True}, timeout=10)
    assert r.status_code == 200
    bid = r.json()["id"]
    r2 = http.put(f"{API}/beauticians/{bid}", headers=h,
                  json={"name": "TEST_Bea2", "role": "Barber", "phone": "888", "active": True}, timeout=10)
    assert r2.status_code == 200 and r2.json()["role"] == "Barber"
    r3 = http.delete(f"{API}/beauticians/{bid}", headers=h, timeout=10)
    assert r3.status_code == 200


# ---------- Bills ----------
@pytest.fixture(scope="session")
def sample_ids(http, admin_token):
    h = _auth(admin_token)
    svc = http.get(f"{API}/services", headers=h, timeout=10).json()
    bea = http.get(f"{API}/beauticians", headers=h, timeout=10).json()
    return svc[0], bea[0]


def test_bill_create_cash(http, admin_token, sample_ids):
    h = _auth(admin_token)
    svc, bea = sample_ids
    payload = {
        "customer_name": "TEST_Customer",
        "items": [{
            "service_id": svc["id"], "service_name": svc["name"], "price": svc["price"],
            "discount_pct": 10, "beautician_id": bea["id"], "beautician_name": bea["name"]
        }],
        "payment_mode": "cash",
    }
    r = http.post(f"{API}/bills", headers=h, json=payload, timeout=10)
    assert r.status_code == 200, r.text
    bill = r.json()
    expected = round(svc["price"] * 0.9, 2)
    assert bill["grand_total"] == expected
    assert bill["cash_amount"] == expected and bill["qr_amount"] == 0
    assert bill["bill_no"] and "-" in bill["bill_no"]
    # GET verify
    g = http.get(f"{API}/bills/{bill['id']}", headers=h, timeout=10)
    assert g.status_code == 200 and g.json()["id"] == bill["id"]


def test_bill_split_validation(http, admin_token, sample_ids):
    h = _auth(admin_token)
    svc, bea = sample_ids
    payload = {
        "items": [{"service_id": svc["id"], "service_name": svc["name"], "price": 100,
                   "discount_pct": 0, "beautician_id": bea["id"], "beautician_name": bea["name"]}],
        "payment_mode": "split", "cash_amount": 40, "qr_amount": 30,
    }
    r = http.post(f"{API}/bills", headers=h, json=payload, timeout=10)
    assert r.status_code == 400  # sum mismatch


def test_bill_split_ok(http, admin_token, sample_ids):
    h = _auth(admin_token)
    svc, bea = sample_ids
    payload = {
        "items": [{"service_id": svc["id"], "service_name": svc["name"], "price": 100,
                   "discount_pct": 0, "beautician_id": bea["id"], "beautician_name": bea["name"]}],
        "payment_mode": "split", "cash_amount": 60, "qr_amount": 40,
    }
    r = http.post(f"{API}/bills", headers=h, json=payload, timeout=10)
    assert r.status_code == 200
    assert r.json()["cash_amount"] == 60 and r.json()["qr_amount"] == 40


def test_bill_empty_items(http, admin_token):
    h = _auth(admin_token)
    r = http.post(f"{API}/bills", headers=h, json={"items": [], "payment_mode": "cash"}, timeout=10)
    assert r.status_code == 400


def test_bills_list_filter(http, admin_token):
    h = _auth(admin_token)
    r = http.get(f"{API}/bills?payment_mode=cash", headers=h, timeout=10)
    assert r.status_code == 200
    for b in r.json():
        assert b["payment_mode"] == "cash"


# ---------- Reports ----------
def test_reports_summary(http, admin_token):
    r = http.get(f"{API}/reports/summary", headers=_auth(admin_token), timeout=15)
    assert r.status_code == 200
    d = r.json()
    for k in ("today", "month", "per_beautician_month"):
        assert k in d
    assert "total" in d["today"] and "count" in d["today"]


def test_reports_daily(http, admin_token):
    r = http.get(f"{API}/reports/daily?days=30", headers=_auth(admin_token), timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)
