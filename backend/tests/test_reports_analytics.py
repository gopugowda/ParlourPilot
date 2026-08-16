"""Backend tests for the new /api/reports/analytics endpoint (iteration 34).

Covers:
- Owner authentication + all preset values return 200 with full payload keys.
- payment_methods has 4 fixed entries (cash/upi/card/other) and share_pct sums to ~100.
- Staff receives 403 (branch_scope_admin guard).
- Custom range echoes from/to dates.
- /api/reports/range accepts preset=last_week (shared resolver expectation).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://salon-invoice-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "testuiowner@testparlourpilot.com"
OWNER_PASS = "admin123"
STAFF_EMAIL = "teststaffui@testparlourpilot.com"
STAFF_PASS = "staff123"

PRESETS = ["today", "yesterday", "week", "last_week", "month", "last_month", "quarter", "year"]

REQUIRED_TOP_KEYS = {
    "from", "to",
    "total_sales", "net_sales", "net_profit", "invoices", "avg_ticket",
    "total_customers", "new_customers", "returning_customers",
    "total_discount", "total_tax", "total_expenses", "staff_commission",
    "cash", "upi", "card", "tips",
    "trend", "payment_methods",
    "this_month", "last_month", "month_change_pct",
    "this_year", "last_year", "year_change_pct",
}


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"no token in login response: {data}"
    return token


@pytest.fixture(scope="module")
def owner_headers():
    return {"Authorization": f"Bearer {_login(OWNER_EMAIL, OWNER_PASS)}"}


@pytest.fixture(scope="module")
def staff_headers():
    return {"Authorization": f"Bearer {_login(STAFF_EMAIL, STAFF_PASS)}"}


# ---------- /reports/analytics : owner presets ----------
@pytest.mark.parametrize("preset", PRESETS)
def test_owner_analytics_preset_returns_full_payload(preset, owner_headers):
    r = requests.get(f"{API}/reports/analytics", params={"preset": preset}, headers=owner_headers, timeout=30)
    assert r.status_code == 200, f"preset={preset} -> {r.status_code} {r.text}"
    body = r.json()
    missing = REQUIRED_TOP_KEYS - set(body.keys())
    assert not missing, f"preset={preset} missing keys: {missing}"

    # payment_methods shape
    pm = body["payment_methods"]
    assert isinstance(pm, list) and len(pm) == 4, f"payment_methods len != 4 for {preset}: {pm}"
    keys = [e["key"] for e in pm]
    assert keys == ["cash", "upi", "card", "other"], f"payment_methods key order wrong: {keys}"
    for e in pm:
        assert set(["key", "label", "amount", "share_pct"]).issubset(e.keys()), f"bad payment_method entry: {e}"

    # share_pct sums to ~100 when there is any total
    total_amt = sum(e["amount"] for e in pm)
    share_sum = sum(e["share_pct"] for e in pm)
    if total_amt > 0:
        assert abs(share_sum - 100.0) <= 1.5, f"share_pct sum={share_sum} for preset={preset} (amounts={pm})"
    else:
        # All zeros -> share_pct should also all be 0
        assert share_sum == 0.0, f"empty range but share_sum={share_sum}"

    # trend is a list of {date, value}
    assert isinstance(body["trend"], list)
    for pt in body["trend"][:3]:
        assert "date" in pt and "value" in pt

    # this_month / last_month / this_year / last_year contain revenue+invoices
    for k in ("this_month", "last_month", "this_year", "last_year"):
        assert set(["revenue", "invoices"]).issubset(body[k].keys()), f"{k} missing subkeys: {body[k]}"


# ---------- /reports/analytics : staff forbidden ----------
def test_staff_analytics_forbidden(staff_headers):
    r = requests.get(f"{API}/reports/analytics", params={"preset": "today"}, headers=staff_headers, timeout=15)
    assert r.status_code == 403, f"expected 403 for staff, got {r.status_code} {r.text}"


# ---------- /reports/analytics : custom range echoes dates ----------
def test_owner_analytics_custom_range_echo(owner_headers):
    params = {"preset": "custom", "from_date": "2026-08-01", "to_date": "2026-08-16"}
    r = requests.get(f"{API}/reports/analytics", params=params, headers=owner_headers, timeout=30)
    assert r.status_code == 200, f"custom range -> {r.status_code} {r.text}"
    body = r.json()
    assert body["from"] == "2026-08-01", f"from echo wrong: {body['from']}"
    assert body["to"] == "2026-08-16", f"to echo wrong: {body['to']}"


# ---------- /reports/range : shared resolver should accept last_week ----------
def test_reports_range_accepts_last_week(owner_headers):
    r = requests.get(f"{API}/reports/range", params={"preset": "last_week"}, headers=owner_headers, timeout=30)
    assert r.status_code == 200, f"/reports/range?preset=last_week -> {r.status_code} {r.text}"
    body = r.json()
    # Sanity: response has from/to
    assert "from" in body and "to" in body
    # If /reports/range truly shares _preset_range, from<to should span 7 calendar days
    # (Mon-based last week). Report if same-day (means preset was not honoured).
    from datetime import date
    d_from = date.fromisoformat(body["from"])
    d_to = date.fromisoformat(body["to"])
    delta_days = (d_to - d_from).days
    assert delta_days == 6, (
        f"/reports/range?preset=last_week did not resolve to a 7-day window "
        f"(from={body['from']}, to={body['to']}, delta={delta_days}d). "
        f"Local resolver in /reports/range likely does not use shared _preset_range."
    )
