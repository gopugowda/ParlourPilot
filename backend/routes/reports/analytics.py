"""/reports/analytics — unified web-parity analytics payload for mobile Reports screen."""
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, Depends

from core import db, BranchScope, branch_scope_admin
from ._shared import preset_range, clamp_for_staff, aggregate_bills_metrics

router = APIRouter()


@router.get("/reports/analytics")
async def reports_analytics(
    preset: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    scope: BranchScope = Depends(branch_scope_admin),
):
    """Unified analytics payload feeding the mobile Reports screen (web-parity)."""
    today = datetime.now(timezone.utc).date()
    d_from, d_to = preset_range(preset, from_date, to_date)
    d_from, d_to = clamp_for_staff(scope, d_from, d_to)
    from_str = d_from.strftime("%Y-%m-%d")
    to_str = d_to.strftime("%Y-%m-%d")

    async def _bills_between(a: str, b: str):
        return await db.bills.find(
            scope.filter({"billing_date": {"$gte": a, "$lte": b}}),
            {"_id": 0},
        ).to_list(20000)

    async def _exp_between(a: str, b: str):
        return await db.expenses.find(
            scope.filter({"date": {"$gte": a, "$lte": b}}),
            {"_id": 0},
        ).to_list(20000)

    # Main range aggregation
    bills = await _bills_between(from_str, to_str)
    exps = await _exp_between(from_str, to_str)
    agg = aggregate_bills_metrics(bills)

    total_expenses = round(sum(float(e.get("amount") or 0) for e in exps), 2)
    staff_commission = round(sum(float(b.get("staff_commission") or 0) for b in bills), 2)
    net_sales = agg["net_sales"]
    net_profit = round(net_sales - total_expenses - staff_commission, 2)

    # Customer breakdown — new vs returning (based on all-time first bill per phone)
    all_bills_for_phones = await db.bills.find(
        scope.filter(), {"_id": 0, "customer_phone": 1, "billing_date": 1, "created_at": 1},
    ).to_list(50000)
    first_seen: dict = {}
    for b in all_bills_for_phones:
        p = (b.get("customer_phone") or "").strip()
        if not p: continue
        ca = (b.get("billing_date") or (b.get("created_at") or "")[:10])
        if p not in first_seen or ca < first_seen[p]:
            first_seen[p] = ca
    new_customers = 0
    returning_customers = 0
    for p in agg["customer_phones"]:
        first = first_seen.get(p, "")
        if from_str <= first <= to_str:
            new_customers += 1
        else:
            returning_customers += 1
    total_customers = new_customers + returning_customers
    avg_ticket = round(net_sales / agg["invoices"], 2) if agg["invoices"] else 0.0

    # Revenue trend per-day
    by_day: dict = {}
    cur = d_from
    while cur <= d_to:
        by_day[cur.strftime("%Y-%m-%d")] = 0.0
        cur = cur + timedelta(days=1)
    for b in bills:
        day = (b.get("billing_date") or (b.get("created_at") or "")[:10])
        if day in by_day:
            by_day[day] += float(b.get("services_net", b.get("grand_total", 0) - b.get("tip_amount", 0)) or 0)
    trend = [{"date": k, "value": round(v, 2)} for k, v in sorted(by_day.items())]

    # Payment methods donut (cash / upi / card / other=tips)
    total_pay = agg["cash"] + agg["upi"] + agg["card"]
    other = round(agg["total_tips"], 2)
    total_pay_all = total_pay + other
    def _share(x: float) -> float:
        return round((x / total_pay_all) * 100, 1) if total_pay_all > 0 else 0.0
    payment_methods = [
        {"key": "cash",  "label": "Cash",  "amount": agg["cash"],  "share_pct": _share(agg["cash"])},
        {"key": "upi",   "label": "UPI",   "amount": agg["upi"],   "share_pct": _share(agg["upi"])},
        {"key": "card",  "label": "Card",  "amount": agg["card"],  "share_pct": _share(agg["card"])},
        {"key": "other", "label": "Other", "amount": other,        "share_pct": _share(other)},
    ]

    # Comparison periods (this vs last month/year)
    first_this_month = today.replace(day=1)
    last_of_prev_month = first_this_month - timedelta(days=1)
    first_last_month = last_of_prev_month.replace(day=1)
    first_this_year = today.replace(month=1, day=1)
    last_year_start = first_this_year.replace(year=first_this_year.year - 1)
    last_year_end = first_this_year - timedelta(days=1)

    async def _period_summary(a: str, b: str):
        bs = await _bills_between(a, b)
        ax = aggregate_bills_metrics(bs)
        return {"revenue": ax["net_sales"], "invoices": ax["invoices"]}

    this_month = await _period_summary(first_this_month.strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d"))
    last_month = await _period_summary(first_last_month.strftime("%Y-%m-%d"), last_of_prev_month.strftime("%Y-%m-%d"))
    this_year = await _period_summary(first_this_year.strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d"))
    last_year = await _period_summary(last_year_start.strftime("%Y-%m-%d"), last_year_end.strftime("%Y-%m-%d"))

    def _pct_change(cur: float, prev: float) -> Optional[float]:
        if prev <= 0:
            return None if cur == 0 else 100.0
        return round(((cur - prev) / prev) * 100, 1)

    return {
        "from": from_str,
        "to": to_str,
        "total_sales": agg["total_sales"],
        "net_sales": net_sales,
        "net_profit": net_profit,
        "invoices": agg["invoices"],
        "avg_ticket": avg_ticket,
        "total_customers": total_customers,
        "new_customers": new_customers,
        "returning_customers": returning_customers,
        "total_discount": agg["total_discount"],
        "total_tax": agg["total_tax"],
        "total_expenses": total_expenses,
        "staff_commission": staff_commission,
        "cash": agg["cash"],
        "upi": agg["upi"],
        "card": agg["card"],
        "tips": agg["total_tips"],
        "trend": trend,
        "payment_methods": payment_methods,
        "this_month": this_month,
        "last_month": last_month,
        "month_change_pct": _pct_change(this_month["revenue"], last_month["revenue"]),
        "this_year": this_year,
        "last_year": last_year,
        "year_change_pct": _pct_change(this_year["revenue"], last_year["revenue"]),
    }
