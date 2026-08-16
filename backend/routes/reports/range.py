"""/reports/range — daily rollup over a preset or custom range."""
from datetime import timedelta
from typing import Optional
from fastapi import APIRouter, Depends

from core import db, bill_payment_split, BranchScope, branch_scope
from ._shared import preset_range, clamp_for_staff

router = APIRouter()


@router.get("/reports/range")
async def reports_range(
    preset: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    scope: BranchScope = Depends(branch_scope),
):
    d_from, d_to = preset_range(preset, from_date, to_date)
    d_from, d_to = clamp_for_staff(scope, d_from, d_to)
    from_str = d_from.strftime("%Y-%m-%d")
    to_str = d_to.strftime("%Y-%m-%d")

    bills = await db.bills.find(
        scope.filter({"created_at": {"$gte": f"{from_str}T00:00:00", "$lt": f"{to_str}T23:59:59.999999+00:00"}}),
        {"_id": 0},
    ).to_list(20000)
    exps = await db.expenses.find(
        scope.filter({"date": {"$gte": from_str, "$lte": to_str}}),
        {"_id": 0},
    ).to_list(20000)

    by_day: dict = {}
    cur = d_from
    while cur <= d_to:
        by_day[cur.strftime("%Y-%m-%d")] = {"date": cur.strftime("%Y-%m-%d"), "total": 0.0, "count": 0, "cash": 0.0, "qr": 0.0, "tips": 0.0, "expenses": 0.0}
        cur = cur + timedelta(days=1)

    for b in bills:
        day = b["created_at"][:10]
        if day not in by_day: continue
        rev = b.get("services_net", b.get("grand_total", 0) - b.get("tip_amount", 0))
        by_day[day]["total"] += rev
        by_day[day]["count"] += 1
        c, dg, _ = bill_payment_split(b)
        by_day[day]["cash"] += c
        by_day[day]["qr"] += dg
        by_day[day]["tips"] += b.get("tip_amount", 0)
    for e in exps:
        if e["date"] in by_day: by_day[e["date"]]["expenses"] += e["amount"]

    rows = sorted(by_day.values(), key=lambda x: x["date"], reverse=True)
    for r in rows:
        r["total"] = round(r["total"], 2)
        r["cash"] = round(r["cash"], 2)
        r["qr"] = round(r["qr"], 2)
        r["tips"] = round(r["tips"], 2)
        r["expenses"] = round(r["expenses"], 2)
        r["net"] = round(r["total"] - r["expenses"], 2)

    totals = {
        "total": round(sum(r["total"] for r in rows), 2),
        "count": sum(r["count"] for r in rows),
        "cash": round(sum(r["cash"] for r in rows), 2),
        "qr": round(sum(r["qr"] for r in rows), 2),
        "tips": round(sum(r["tips"] for r in rows), 2),
        "expenses": round(sum(r["expenses"] for r in rows), 2),
        "net": round(sum(r["net"] for r in rows), 2),
    }
    return {"from": from_str, "to": to_str, "days": len(rows), "totals": totals, "rows": rows}
