"""Regression tests for members, expenses, stock, cash-closing, reports/range, and dashboard alert keys."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'https://salon-invoice-app.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(http):
    http.post(f"{API}/seed", timeout=30)
    r = http.post(f"{API}/auth/login", json={"email": "admin@glowup.com", "password": "admin123"}, timeout=15)
    assert r.status_code == 200
    return r.json()["token"]


@pytest.fixture(scope="module")
def staff_token(http):
    r = http.post(f"{API}/auth/login", json={"email": "staff@glowup.com", "password": "staff123"}, timeout=15)
    assert r.status_code == 200
    return r.json()["token"]


def h(tok): return {"Authorization": f"Bearer {tok}"}


# ---------- Members / WhatsApp indicators ----------
class TestMembers:
    def test_members_list_ok(self, http, admin_token):
        r = http.get(f"{API}/members", headers=h(admin_token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_member_create_expiring_and_expired(self, http, admin_token):
        today = datetime.now(timezone.utc).date()
        # Expiring in 10 days
        exp_soon = (today + timedelta(days=10)).strftime("%Y-%m-%d")
        # Expired 5 days ago
        expired = (today - timedelta(days=5)).strftime("%Y-%m-%d")
        joined = (today - timedelta(days=350)).strftime("%Y-%m-%d")

        phone_a = f"TEST9{uuid.uuid4().hex[:8]}"
        phone_b = f"TEST9{uuid.uuid4().hex[:8]}"

        r1 = http.post(f"{API}/members", headers=h(admin_token),
                       json={"name": "TEST_ExpiringSoon", "phone": phone_a,
                             "joined_at": joined, "expires_at": exp_soon,
                             "notes": "", "active": True}, timeout=10)
        assert r1.status_code == 200, r1.text
        m1 = r1.json()
        assert m1["status"] == "expiring_soon", m1

        r2 = http.post(f"{API}/members", headers=h(admin_token),
                       json={"name": "TEST_Expired", "phone": phone_b,
                             "joined_at": joined, "expires_at": expired,
                             "notes": "", "active": True}, timeout=10)
        assert r2.status_code == 200
        m2 = r2.json()
        assert m2["status"] == "expired"

        # Verify present in list
        lst = http.get(f"{API}/members", headers=h(admin_token), timeout=10).json()
        ids = {m["id"]: m for m in lst}
        assert m1["id"] in ids and ids[m1["id"]]["status"] == "expiring_soon"
        assert m2["id"] in ids and ids[m2["id"]]["status"] == "expired"

        # Members/expiring endpoint should contain both
        exp_list = http.get(f"{API}/members/expiring?days=30", headers=h(admin_token), timeout=10).json()
        exp_ids = {m["id"] for m in exp_list}
        assert m1["id"] in exp_ids
        assert m2["id"] in exp_ids

        # Cleanup
        http.delete(f"{API}/members/{m1['id']}", headers=h(admin_token), timeout=10)
        http.delete(f"{API}/members/{m2['id']}", headers=h(admin_token), timeout=10)

    def test_member_lookup(self, http, admin_token):
        phone = f"TEST9{uuid.uuid4().hex[:8]}"
        today = datetime.now(timezone.utc).date()
        exp = (today + timedelta(days=180)).strftime("%Y-%m-%d")
        r = http.post(f"{API}/members", headers=h(admin_token),
                      json={"name": "TEST_Lookup", "phone": phone,
                            "joined_at": today.strftime("%Y-%m-%d"),
                            "expires_at": exp, "notes": "", "active": True}, timeout=10)
        mid = r.json()["id"]
        lk = http.get(f"{API}/members/lookup?phone={phone}", headers=h(admin_token), timeout=10)
        assert lk.status_code == 200
        j = lk.json()
        assert j["found"] is True and j["is_active_member"] is True
        http.delete(f"{API}/members/{mid}", headers=h(admin_token), timeout=10)


# ---------- Expenses ----------
class TestExpenses:
    def test_expense_categories(self, http, admin_token):
        r = http.get(f"{API}/expenses/categories", headers=h(admin_token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list) and len(r.json()) > 0

    def test_expense_crud(self, http, admin_token):
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        payload = {"date": today, "category": "Supplies", "amount": 123.45,
                   "description": "TEST_expense", "notes": "test"}
        r = http.post(f"{API}/expenses", headers=h(admin_token), json=payload, timeout=10)
        assert r.status_code == 200, r.text
        eid = r.json()["id"]
        assert r.json()["amount"] == 123.45

        lst = http.get(f"{API}/expenses", headers=h(admin_token), timeout=10).json()
        assert any(e["id"] == eid for e in lst)

        d = http.delete(f"{API}/expenses/{eid}", headers=h(admin_token), timeout=10)
        assert d.status_code == 200


# ---------- Stock ----------
class TestStock:
    def test_stock_list_ok(self, http, admin_token):
        r = http.get(f"{API}/stock", headers=h(admin_token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_stock_purchase_creates_auto_expense(self, http, admin_token):
        # Create a stock item
        r = http.post(f"{API}/stock", headers=h(admin_token),
                      json={"name": f"TEST_Item_{uuid.uuid4().hex[:6]}", "unit": "piece",
                            "current_qty": 0, "min_qty": 2, "unit_cost": 50}, timeout=10)
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        # Purchase 10 units at 50 -> auto expense 500
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        before = http.get(f"{API}/expenses?date={today}", headers=h(admin_token), timeout=10).json()
        before_total = sum(e["amount"] for e in before)

        mv = http.post(f"{API}/stock/movement", headers=h(admin_token),
                       json={"item_id": sid, "type": "purchase", "qty": 10, "unit_cost": 50,
                             "notes": "TEST_purchase"}, timeout=10)
        assert mv.status_code == 200, mv.text

        after = http.get(f"{API}/expenses?date={today}", headers=h(admin_token), timeout=10).json()
        after_total = sum(e["amount"] for e in after)
        assert after_total - before_total >= 500 - 0.01, "Auto-expense should have been created for purchase"

        # Verify stock qty
        stock = http.get(f"{API}/stock", headers=h(admin_token), timeout=10).json()
        item = next((s for s in stock if s["id"] == sid), None)
        assert item and item["current_qty"] == 10

        # Consume 3 (type=use)
        cm = http.post(f"{API}/stock/movement", headers=h(admin_token),
                       json={"item_id": sid, "type": "use", "qty": 3, "notes": "TEST_use"}, timeout=10)
        assert cm.status_code == 200

        stock = http.get(f"{API}/stock", headers=h(admin_token), timeout=10).json()
        item = next((s for s in stock if s["id"] == sid), None)
        assert item and item["current_qty"] == 7

        # Cleanup
        http.delete(f"{API}/stock/{sid}", headers=h(admin_token), timeout=10)


# ---------- Cash closing ----------
class TestCashClosing:
    def test_cash_closing_summary(self, http, admin_token):
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        r = http.get(f"{API}/cash-closing/summary?date={today}", headers=h(admin_token), timeout=10)
        assert r.status_code == 200
        d = r.json()
        # actual keys: date, bills_count, total_revenue, cash_sales, suggested_opening, existing_closing
        for k in ("date", "bills_count", "suggested_opening"):
            assert k in d, f"missing key {k} in {list(d.keys())}"


# ---------- Reports: summary must contain low_stock + expiring_members ----------
class TestReports:
    def test_reports_summary_alert_keys(self, http, admin_token):
        r = http.get(f"{API}/reports/summary", headers=h(admin_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "low_stock" in d and isinstance(d["low_stock"], list)
        assert "expiring_members" in d and isinstance(d["expiring_members"], list)

    def test_reports_summary_staff_no_expiring(self, http, staff_token):
        r = http.get(f"{API}/reports/summary", headers=h(staff_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        # For staff, expiring_members is only populated for admin
        assert d.get("expiring_members") == []

    def test_reports_range_week_admin(self, http, admin_token):
        r = http.get(f"{API}/reports/range?preset=week", headers=h(admin_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("from", "to", "days", "totals", "rows"):
            assert k in d
        assert d["days"] == 7, f"Admin week preset should span 7 days, got {d['days']}"

    def test_reports_range_week_staff_clamped(self, http, staff_token):
        r = http.get(f"{API}/reports/range?preset=week", headers=h(staff_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        # Staff should be clamped to at most 2 days (today+yesterday)
        assert d["days"] <= 2, f"Staff week preset should be clamped to 2 days, got {d['days']}"
