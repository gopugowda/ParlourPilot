"""Iteration 21 — Staff Performance Dashboard endpoint tests.

Covers GET /api/reports/staff-performance:
  - RBAC (owner OK, staff 403, no-auth 401/403)
  - Preset variants (today, week, month, last_month, yesterday)
  - Custom date range (?from_date / ?to_date)
  - Response shape (from/to/days/rows/totals/top_performer)
  - Aggregation correctness (revenue/tips/earnings/services/appointments/avg_ticket)
  - Sorting by earnings desc
  - top_performer = first row with earnings > 0 (None if all zero)
  - Trend array shape: one entry per day in period
  - Zero-performer active beauticians appear as rows with zero values
"""
import os
from datetime import datetime, timezone, timedelta

import pytest
import requests

# Use the public preview URL — frontend and tests go through the same ingress.
BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://salon-invoice-app.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

OWNER = {"email": "admin@glowup.com", "password": "admin123"}
STAFF = {"email": "staff@glowup.com", "password": "staff123"}


# ----------------- fixtures -----------------
@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{API}/auth/login", json=OWNER, timeout=10)
    assert r.status_code == 200, f"Owner login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def staff_token():
    r = requests.post(f"{API}/auth/login", json=STAFF, timeout=10)
    assert r.status_code == 200, f"Staff login failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _headers(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ----------------- RBAC -----------------
class TestRBAC:
    def test_unauthenticated_forbidden(self):
        r = requests.get(f"{API}/reports/staff-performance?preset=month", timeout=10)
        assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}"

    def test_staff_forbidden(self, staff_token):
        r = requests.get(
            f"{API}/reports/staff-performance?preset=month",
            headers=_headers(staff_token),
            timeout=10,
        )
        assert r.status_code == 403, f"Staff must get 403, got {r.status_code}: {r.text}"

    def test_owner_allowed(self, owner_token):
        r = requests.get(
            f"{API}/reports/staff-performance?preset=month",
            headers=_headers(owner_token),
            timeout=15,
        )
        assert r.status_code == 200, r.text


# ----------------- Response shape -----------------
class TestResponseShape:
    def test_top_level_keys(self, owner_token):
        r = requests.get(
            f"{API}/reports/staff-performance?preset=month",
            headers=_headers(owner_token),
            timeout=15,
        )
        data = r.json()
        for k in ("from", "to", "days", "rows", "totals", "top_performer"):
            assert k in data, f"missing '{k}' in response"
        assert isinstance(data["days"], list) and all(isinstance(d, str) for d in data["days"])
        assert isinstance(data["rows"], list)
        assert isinstance(data["totals"], dict)

    def test_row_shape(self, owner_token):
        r = requests.get(
            f"{API}/reports/staff-performance?preset=month",
            headers=_headers(owner_token),
            timeout=15,
        ).json()
        assert r["rows"], "expected at least one row for pre-seeded month data"
        row = r["rows"][0]
        for k in (
            "beautician_id", "beautician_name", "role", "revenue", "tips",
            "earnings", "services", "appointments", "avg_ticket", "trend",
        ):
            assert k in row, f"row missing '{k}'"
        # trend length must equal days list length
        assert len(row["trend"]) == len(r["days"]), (
            f"trend length {len(row['trend'])} != days length {len(r['days'])}"
        )
        for t in row["trend"]:
            assert "date" in t and "value" in t
        # trend dates must match days list order
        assert [t["date"] for t in row["trend"]] == r["days"]

    def test_totals_shape(self, owner_token):
        r = requests.get(
            f"{API}/reports/staff-performance?preset=month",
            headers=_headers(owner_token),
            timeout=15,
        ).json()
        for k in ("revenue", "tips", "earnings", "services", "appointments"):
            assert k in r["totals"]


# ----------------- Aggregation correctness -----------------
class TestAggregation:
    def test_earnings_equals_revenue_plus_tips(self, owner_token):
        r = requests.get(
            f"{API}/reports/staff-performance?preset=month",
            headers=_headers(owner_token),
            timeout=15,
        ).json()
        for row in r["rows"]:
            expected = round(row["revenue"] + row["tips"], 2)
            assert abs(row["earnings"] - expected) < 0.02, (
                f"earnings mismatch for {row['beautician_name']}: "
                f"{row['earnings']} vs {row['revenue']}+{row['tips']}"
            )

    def test_avg_ticket(self, owner_token):
        r = requests.get(
            f"{API}/reports/staff-performance?preset=month",
            headers=_headers(owner_token),
            timeout=15,
        ).json()
        for row in r["rows"]:
            if row["appointments"] > 0:
                expected = round(row["earnings"] / row["appointments"], 2)
                assert abs(row["avg_ticket"] - expected) < 0.02
            else:
                assert row["avg_ticket"] == 0.0

    def test_sorted_by_earnings_desc(self, owner_token):
        r = requests.get(
            f"{API}/reports/staff-performance?preset=month",
            headers=_headers(owner_token),
            timeout=15,
        ).json()
        earnings = [row["earnings"] for row in r["rows"]]
        assert earnings == sorted(earnings, reverse=True), (
            f"rows not sorted by earnings desc: {earnings}"
        )

    def test_top_performer_matches_first_positive_row(self, owner_token):
        r = requests.get(
            f"{API}/reports/staff-performance?preset=month",
            headers=_headers(owner_token),
            timeout=15,
        ).json()
        expected = next((row for row in r["rows"] if row["earnings"] > 0), None)
        assert r["top_performer"] == expected

    def test_top_performer_seed_deepa(self, owner_token):
        """Per problem statement, month top performer should be Deepa Bhat ~₹11,400."""
        r = requests.get(
            f"{API}/reports/staff-performance?preset=month",
            headers=_headers(owner_token),
            timeout=15,
        ).json()
        tp = r["top_performer"]
        assert tp is not None, "top_performer should not be None with seed data"
        assert tp["beautician_name"] == "Deepa Bhat", (
            f"Expected Deepa Bhat, got {tp['beautician_name']}"
        )
        # Row count from seed = 11 (per problem statement)
        assert len(r["rows"]) == 11, f"expected 11 rows, got {len(r['rows'])}"

    def test_totals_match_row_sums(self, owner_token):
        r = requests.get(
            f"{API}/reports/staff-performance?preset=month",
            headers=_headers(owner_token),
            timeout=15,
        ).json()
        rows = r["rows"]
        assert abs(r["totals"]["revenue"] - round(sum(x["revenue"] for x in rows), 2)) < 0.02
        assert abs(r["totals"]["tips"] - round(sum(x["tips"] for x in rows), 2)) < 0.02
        assert abs(r["totals"]["earnings"] - round(sum(x["earnings"] for x in rows), 2)) < 0.02
        assert r["totals"]["services"] == sum(x["services"] for x in rows)
        assert r["totals"]["appointments"] == sum(x["appointments"] for x in rows)

    def test_row_matches_bills_ground_truth(self, owner_token):
        """Cross-check aggregation vs raw /api/bills for the month period."""
        today = datetime.now(timezone.utc).date()
        d_from = today.replace(day=1)
        # Pull the perf report
        perf = requests.get(
            f"{API}/reports/staff-performance?preset=month",
            headers=_headers(owner_token),
            timeout=15,
        ).json()
        # Pull the raw bills list (full history) and filter locally
        bills = requests.get(
            f"{API}/bills?limit=5000",
            headers=_headers(owner_token),
            timeout=15,
        ).json()
        # Filter to month
        from_str = d_from.strftime("%Y-%m-%d")
        month_bills = [
            b for b in bills if (b.get("created_at") or "")[:10] >= from_str
        ]

        # Compute expected per beautician_id
        expected: dict = {}
        for b in month_bills:
            bill_id = b.get("id")
            for it in b.get("items", []) or []:
                bid = it.get("beautician_id")
                key = bid or f"_unassigned_{it.get('beautician_name') or 'Unassigned'}"
                slot = expected.setdefault(key, {"rev": 0.0, "tips": 0.0, "svc": 0, "bills": set()})
                slot["rev"] += float(it.get("total") or it.get("price") or 0)
                slot["svc"] += 1
                slot["bills"].add(bill_id)
            if float(b.get("tip_amount") or 0) > 0:
                tid_ = b.get("tip_beautician_id")
                tname = b.get("tip_beautician_name") or "Tip"
                key = tid_ or f"_unassigned_{tname}"
                slot = expected.setdefault(key, {"rev": 0.0, "tips": 0.0, "svc": 0, "bills": set()})
                slot["tips"] += float(b.get("tip_amount") or 0)

        # Verify each row from server matches our recomputed truth
        for row in perf["rows"]:
            key = row["beautician_id"] or f"_unassigned_{row['beautician_name']}"
            exp = expected.get(key)
            if exp is None:
                # Zero-performer (active beautician with no bills) — must be zero
                assert row["revenue"] == 0 and row["tips"] == 0 and row["services"] == 0
                assert row["appointments"] == 0
                continue
            assert abs(row["revenue"] - round(exp["rev"], 2)) < 0.02, (
                f"revenue mismatch {row['beautician_name']}: {row['revenue']} vs {exp['rev']:.2f}"
            )
            assert abs(row["tips"] - round(exp["tips"], 2)) < 0.02, (
                f"tips mismatch {row['beautician_name']}: {row['tips']} vs {exp['tips']:.2f}"
            )
            assert row["services"] == exp["svc"], (
                f"services mismatch {row['beautician_name']}: {row['services']} vs {exp['svc']}"
            )
            assert row["appointments"] == len(exp["bills"]), (
                f"appointments mismatch {row['beautician_name']}: "
                f"{row['appointments']} vs {len(exp['bills'])}"
            )


# ----------------- Presets & custom range -----------------
class TestPresets:
    def test_today(self, owner_token):
        r = requests.get(
            f"{API}/reports/staff-performance?preset=today",
            headers=_headers(owner_token),
            timeout=15,
        ).json()
        assert r["from"] == r["to"]
        assert len(r["days"]) == 1
        assert r["days"][0] == r["from"]

    def test_yesterday(self, owner_token):
        r = requests.get(
            f"{API}/reports/staff-performance?preset=yesterday",
            headers=_headers(owner_token),
            timeout=15,
        ).json()
        y = (datetime.now(timezone.utc).date() - timedelta(days=1)).strftime("%Y-%m-%d")
        assert r["from"] == y and r["to"] == y

    def test_week_is_7_days(self, owner_token):
        r = requests.get(
            f"{API}/reports/staff-performance?preset=week",
            headers=_headers(owner_token),
            timeout=15,
        ).json()
        assert len(r["days"]) == 7, f"week should be 7 days, got {len(r['days'])}"
        today = datetime.now(timezone.utc).date().strftime("%Y-%m-%d")
        assert r["to"] == today

    def test_month_starts_on_first(self, owner_token):
        r = requests.get(
            f"{API}/reports/staff-performance?preset=month",
            headers=_headers(owner_token),
            timeout=15,
        ).json()
        today = datetime.now(timezone.utc).date()
        assert r["from"] == today.replace(day=1).strftime("%Y-%m-%d")
        assert r["to"] == today.strftime("%Y-%m-%d")
        assert len(r["days"]) == today.day

    def test_last_month_is_prev_full_calendar(self, owner_token):
        r = requests.get(
            f"{API}/reports/staff-performance?preset=last_month",
            headers=_headers(owner_token),
            timeout=15,
        ).json()
        today = datetime.now(timezone.utc).date()
        first_this = today.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        expected_from = last_prev.replace(day=1).strftime("%Y-%m-%d")
        expected_to = last_prev.strftime("%Y-%m-%d")
        assert r["from"] == expected_from, f"{r['from']} vs {expected_from}"
        assert r["to"] == expected_to, f"{r['to']} vs {expected_to}"
        assert len(r["days"]) == last_prev.day  # days in previous month

    def test_custom_range(self, owner_token):
        # Use current month first-week
        today = datetime.now(timezone.utc).date()
        d_from = today.replace(day=1)
        d_to = d_from + timedelta(days=3)
        r = requests.get(
            f"{API}/reports/staff-performance"
            f"?from_date={d_from.strftime('%Y-%m-%d')}"
            f"&to_date={d_to.strftime('%Y-%m-%d')}",
            headers=_headers(owner_token),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["from"] == d_from.strftime("%Y-%m-%d")
        assert j["to"] == d_to.strftime("%Y-%m-%d")
        assert len(j["days"]) == 4

    def test_invalid_date_returns_400(self, owner_token):
        r = requests.get(
            f"{API}/reports/staff-performance?from_date=bad-date",
            headers=_headers(owner_token),
            timeout=10,
        )
        assert r.status_code == 400, r.text

    def test_swapped_range_normalised(self, owner_token):
        """from_date > to_date should be swapped internally, not error."""
        today = datetime.now(timezone.utc).date()
        earlier = today.replace(day=1)
        r = requests.get(
            f"{API}/reports/staff-performance"
            f"?from_date={today.strftime('%Y-%m-%d')}"
            f"&to_date={earlier.strftime('%Y-%m-%d')}",
            headers=_headers(owner_token),
            timeout=10,
        )
        assert r.status_code == 200
        j = r.json()
        # After swap: from = earlier, to = today
        assert j["from"] == earlier.strftime("%Y-%m-%d")
        assert j["to"] == today.strftime("%Y-%m-%d")


# ----------------- Zero-performers -----------------
class TestZeroPerformers:
    def test_zero_performer_appears(self, owner_token):
        """Every active beautician must appear in the rows list, even with zero bills."""
        # Get all active beauticians
        beauticians = requests.get(
            f"{API}/beauticians",
            headers=_headers(owner_token),
            timeout=10,
        ).json()
        active_ids = {b["id"] for b in beauticians if b.get("active", True)}

        # Use "yesterday" preset which likely has no bills -> everyone should be zero
        r = requests.get(
            f"{API}/reports/staff-performance?preset=yesterday",
            headers=_headers(owner_token),
            timeout=15,
        ).json()
        row_ids = {row["beautician_id"] for row in r["rows"] if row["beautician_id"]}
        missing = active_ids - row_ids
        assert not missing, f"active beauticians missing from rows: {missing}"

    def test_top_performer_none_when_all_zero(self, owner_token):
        """Use a far-future date range with no bills -> top_performer must be null."""
        future = (datetime.now(timezone.utc).date() + timedelta(days=365)).strftime("%Y-%m-%d")
        r = requests.get(
            f"{API}/reports/staff-performance"
            f"?from_date={future}&to_date={future}",
            headers=_headers(owner_token),
            timeout=10,
        ).json()
        assert r["top_performer"] is None
        assert all(row["earnings"] == 0 for row in r["rows"])
