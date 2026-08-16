"""/reports/staff-performance — owner-only staff productivity dashboard."""
from datetime import timedelta
from typing import Optional, Dict, List
from fastapi import APIRouter, Depends

from core import db, BranchScope, branch_scope_admin
from ._shared import preset_range, clamp_for_staff

router = APIRouter()


@router.get("/reports/staff-performance")
async def reports_staff_performance(
    preset: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    scope: BranchScope = Depends(branch_scope_admin),
):
    """Owner-only staff-performance dashboard.

    Aggregates each bill's line items by `beautician_id`:
      - `revenue` = sum of line-item `total` (post-discount, pre-tax)
      - `tips` = tips routed to this staffer via `tip_beautician_id`
      - `earnings` = revenue + tips
      - `services` = count of line items performed
      - `appointments` = distinct bills they appeared on
      - `trend` array for per-day charting
    """
    d_from, d_to = preset_range(preset, from_date, to_date)
    d_from, d_to = clamp_for_staff(scope, d_from, d_to)
    from_str = d_from.strftime("%Y-%m-%d")
    to_str = d_to.strftime("%Y-%m-%d")

    beauticians = await db.beauticians.find(
        scope.filter({"active": True}), {"_id": 0, "id": 1, "name": 1, "role": 1},
    ).to_list(500)
    b_by_id: Dict[str, dict] = {b["id"]: b for b in beauticians}

    bills = await db.bills.find(
        scope.filter({"created_at": {"$gte": f"{from_str}T00:00:00", "$lt": f"{to_str}T23:59:59.999999+00:00"}}),
        {"_id": 0},
    ).to_list(20000)

    days: List[str] = []
    cur = d_from
    while cur <= d_to:
        days.append(cur.strftime("%Y-%m-%d")); cur = cur + timedelta(days=1)

    stats: Dict[str, dict] = {}

    def _bucket(bid: Optional[str], bname: str) -> dict:
        key = bid or f"_unassigned_{bname}"
        if key not in stats:
            stats[key] = {
                "beautician_id": bid,
                "beautician_name": bname or "Unassigned",
                "role": (b_by_id.get(bid) or {}).get("role", ""),
                "revenue": 0.0,
                "tips": 0.0,
                "services": 0,
                "appointments": 0,
                "_bill_ids": set(),
                "trend": {d: 0.0 for d in days},
            }
        return stats[key]

    for bill in bills:
        day = bill["created_at"][:10]
        bill_id = bill.get("id")
        for it in bill.get("items", []) or []:
            bname = it.get("beautician_name") or "Unassigned"
            bid = it.get("beautician_id")
            b = _bucket(bid, bname)
            line_total = float(it.get("total") or it.get("price") or 0)
            b["revenue"] += line_total
            b["services"] += 1
            if bill_id and bill_id not in b["_bill_ids"]:
                b["_bill_ids"].add(bill_id)
                b["appointments"] += 1
            if day in b["trend"]:
                b["trend"][day] += line_total
        tip_amt = float(bill.get("tip_amount") or 0)
        if tip_amt > 0:
            tid_ = bill.get("tip_beautician_id")
            tname = bill.get("tip_beautician_name") or "Tip"
            b = _bucket(tid_, tname)
            b["tips"] += tip_amt
            if day in b["trend"]:
                b["trend"][day] += tip_amt

    for b in beauticians:
        _bucket(b["id"], b["name"])

    rows = []
    for st in stats.values():
        earnings = round(st["revenue"] + st["tips"], 2)
        appts = st["appointments"] or 0
        rows.append({
            "beautician_id": st["beautician_id"],
            "beautician_name": st["beautician_name"],
            "role": st["role"],
            "revenue": round(st["revenue"], 2),
            "tips": round(st["tips"], 2),
            "earnings": earnings,
            "services": st["services"],
            "appointments": appts,
            "avg_ticket": round(earnings / appts, 2) if appts else 0.0,
            "trend": [{"date": d, "value": round(v, 2)} for d, v in st["trend"].items()],
        })

    rows.sort(key=lambda x: x["earnings"], reverse=True)

    totals = {
        "revenue": round(sum(r["revenue"] for r in rows), 2),
        "tips": round(sum(r["tips"] for r in rows), 2),
        "earnings": round(sum(r["earnings"] for r in rows), 2),
        "services": sum(r["services"] for r in rows),
        "appointments": sum(r["appointments"] for r in rows),
    }
    top = next((r for r in rows if r["earnings"] > 0), None)

    return {
        "from": from_str,
        "to": to_str,
        "days": days,
        "rows": rows,
        "totals": totals,
        "top_performer": top,
    }
