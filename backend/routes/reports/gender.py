"""/reports/revenue-by-gender — segments net revenue by service_gender."""
from typing import Optional
from fastapi import APIRouter, Depends

from core import db, BranchScope, branch_scope
from ._shared import preset_range, clamp_for_staff

router = APIRouter()


@router.get("/reports/revenue-by-gender")
async def reports_revenue_by_gender(
    preset: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    scope: BranchScope = Depends(branch_scope),
):
    """Type Revenue Split — aggregates net line revenue by service gender.

    Uses the same preset semantics as /reports/range. Line revenue =
    price * (1 - effective_discount%/100). Tips excluded.
    """
    d_from, d_to = preset_range(preset, from_date, to_date)
    d_from, d_to = clamp_for_staff(scope, d_from, d_to)
    from_str = d_from.strftime("%Y-%m-%d")
    to_str = d_to.strftime("%Y-%m-%d")

    bills = await db.bills.find(
        scope.filter({"billing_date": {"$gte": from_str, "$lte": to_str}}),
        {"_id": 0, "items": 1},
    ).to_list(20000)

    buckets: dict = {
        "ladies": {"revenue": 0.0, "count": 0},
        "men":    {"revenue": 0.0, "count": 0},
        "unisex": {"revenue": 0.0, "count": 0},
    }
    for b in bills:
        for it in (b.get("items") or []):
            g = (it.get("service_gender") or "unisex").lower()
            if g not in buckets:
                g = "unisex"
            price = float(it.get("price") or 0)
            eff_disc = float(it.get("effective_discount_pct") or it.get("discount_pct") or 0)
            net = price * (1.0 - eff_disc / 100.0)
            buckets[g]["revenue"] += net
            buckets[g]["count"] += 1

    total_revenue = sum(v["revenue"] for v in buckets.values())
    for k in buckets:
        buckets[k]["revenue"] = round(buckets[k]["revenue"], 2)
        buckets[k]["share_pct"] = round((buckets[k]["revenue"] / total_revenue) * 100, 1) if total_revenue > 0 else 0

    top_key = max(buckets, key=lambda k: buckets[k]["revenue"]) if total_revenue > 0 else None

    return {
        "from": from_str,
        "to": to_str,
        "total_revenue": round(total_revenue, 2),
        "top_segment": top_key,
        "segments": [
            {"key": "ladies", "label": "Ladies", **buckets["ladies"]},
            {"key": "men",    "label": "Men",    **buckets["men"]},
            {"key": "unisex", "label": "Unisex", **buckets["unisex"]},
        ],
    }
