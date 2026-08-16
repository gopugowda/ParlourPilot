"""/reports/summary  and  /reports/daily  — legacy dashboard endpoints."""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends

from core import (
    db, today_str, bill_payment_split, _member_status,
    BranchScope, branch_scope,
)

router = APIRouter()


@router.get("/reports/summary")
async def reports_summary(scope: BranchScope = Depends(branch_scope)):
    tid = scope.tenant_id
    today = today_str()
    month = datetime.now(timezone.utc).strftime("%Y-%m")

    q_bills = scope.filter()
    all_bills = await db.bills.find(q_bills, {"_id": 0}).to_list(10000)

    def revenue(b):
        return b.get("services_net", b.get("grand_total", 0) - b.get("tip_amount", 0))

    today_bills = [b for b in all_bills if (b.get("billing_date") or b["created_at"][:10]) == today]
    month_bills = [b for b in all_bills if (b.get("billing_date") or b["created_at"][:10]).startswith(month)]

    today_total = sum(revenue(b) for b in today_bills)
    today_count = len(today_bills)
    month_total = sum(revenue(b) for b in month_bills)
    month_count = len(month_bills)

    today_cash = 0.0
    today_qr = 0.0
    for b in today_bills:
        c, dg, _ = bill_payment_split(b)
        today_cash += c
        today_qr += dg
    today_tips = sum(b.get("tip_amount", 0) for b in today_bills)

    per_beautician: dict = {}
    for b in month_bills:
        line_totals = []
        for it in b["items"]:
            eff = it.get("effective_discount_pct", it.get("discount_pct", 0)) or 0
            lt = it["price"] * (1 - eff / 100.0)
            line_totals.append(lt)
        gross = sum(line_totals) or 1
        rev = revenue(b)
        for it, lt in zip(b["items"], line_totals):
            name = it["beautician_name"] or "Unassigned"
            share = (lt / gross) * rev
            per_beautician.setdefault(name, {"name": name, "amount": 0.0, "bills": 0, "tips": 0.0})
            per_beautician[name]["amount"] += share
            per_beautician[name]["bills"] += 1
        if b.get("tip_amount", 0) > 0 and b.get("tip_beautician_name"):
            n = b["tip_beautician_name"]
            per_beautician.setdefault(n, {"name": n, "amount": 0.0, "bills": 0, "tips": 0.0})
            per_beautician[n]["tips"] += b["tip_amount"]

    per_beautician_list = sorted(
        [{"name": v["name"], "amount": round(v["amount"], 2), "bills": v["bills"], "tips": round(v["tips"], 2)} for v in per_beautician.values()],
        key=lambda x: x["amount"] + x["tips"], reverse=True
    )

    all_exp = await db.expenses.find(scope.filter(), {"_id": 0}).to_list(20000)
    today_exp = sum(e["amount"] for e in all_exp if e["date"] == today)
    month_exp = sum(e["amount"] for e in all_exp if e["date"].startswith(month))
    exp_by_cat_today: dict = {}
    for e in all_exp:
        if e["date"] != today: continue
        exp_by_cat_today[e["category"]] = exp_by_cat_today.get(e["category"], 0) + e["amount"]

    stock_docs = await db.stock_items.find(scope.filter(), {"_id": 0}).to_list(500)
    low_stock = [
        {"id": s["id"], "name": s["name"], "current_qty": s.get("current_qty", 0), "min_qty": s.get("min_qty", 0), "unit": s.get("unit", "piece")}
        for s in stock_docs if s.get("current_qty", 0) <= s.get("min_qty", 0)
    ]

    expiring_members = []
    mem_docs = await db.members.find({"tenant_id": tid, "active": True}, {"_id": 0}).to_list(1000)
    for m in mem_docs:
        m2 = _member_status(m)
        if m2["status"] in ("expiring_soon", "expired"):
            expiring_members.append({
                "id": m2["id"], "name": m2["name"], "phone": m2["phone"],
                "status": m2["status"], "days_left": m2.get("days_left"),
                "expires_at": m2.get("expires_at"),
            })
    expiring_members.sort(key=lambda x: x.get("days_left") if x.get("days_left") is not None else 9999)

    return {
        "today": {
            "total": round(today_total, 2), "count": today_count,
            "cash": round(today_cash, 2), "qr": round(today_qr, 2),
            "tips": round(today_tips, 2),
            "expenses": round(today_exp, 2),
            "net": round(today_total - today_exp, 2),
            "expenses_by_category": [
                {"category": k, "amount": round(v, 2)} for k, v in sorted(exp_by_cat_today.items(), key=lambda x: -x[1])
            ],
        },
        "month": {
            "total": round(month_total, 2), "count": month_count,
            "expenses": round(month_exp, 2),
            "net": round(month_total - month_exp, 2),
        },
        "per_beautician_month": per_beautician_list,
        "low_stock": low_stock,
        "expiring_members": expiring_members,
    }


@router.get("/reports/daily")
async def reports_daily(days: int = 30, scope: BranchScope = Depends(branch_scope)):
    if scope.user.get("role") == "staff":
        days = min(days, 2)
    all_bills = await db.bills.find(scope.filter(), {"_id": 0}).to_list(20000)
    all_exp = await db.expenses.find(scope.filter(), {"_id": 0}).to_list(20000)
    by_day: dict = {}
    for b in all_bills:
        day = (b.get("billing_date") or b["created_at"][:10])
        by_day.setdefault(day, {"date": day, "total": 0.0, "count": 0, "cash": 0.0, "qr": 0.0, "tips": 0.0, "expenses": 0.0})
        rev = b.get("services_net", b.get("grand_total", 0) - b.get("tip_amount", 0))
        by_day[day]["total"] += rev
        by_day[day]["count"] += 1
        c, dg, _ = bill_payment_split(b)
        by_day[day]["cash"] += c
        by_day[day]["qr"] += dg
        by_day[day]["tips"] += b.get("tip_amount", 0)
    for e in all_exp:
        day = e["date"]
        by_day.setdefault(day, {"date": day, "total": 0.0, "count": 0, "cash": 0.0, "qr": 0.0, "tips": 0.0, "expenses": 0.0})
        by_day[day]["expenses"] += e["amount"]
    rows = sorted(by_day.values(), key=lambda x: x["date"], reverse=True)[:days]
    for r in rows:
        r["total"] = round(r["total"], 2)
        r["cash"] = round(r["cash"], 2)
        r["qr"] = round(r["qr"], 2)
        r["tips"] = round(r["tips"], 2)
        r["expenses"] = round(r["expenses"], 2)
        r["net"] = round(r["total"] - r["expenses"], 2)
    return rows
