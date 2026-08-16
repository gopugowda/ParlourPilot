"""AUTO-GENERATED module split from server.py."""
from fastapi import APIRouter, Depends, HTTPException, Header, Body, Request, Query
from fastapi.responses import HTMLResponse
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel, EmailStr, Field
import os, re, uuid, io, csv, json, hmac, hashlib

from core import (
    db, logger, now_iso, today_str, hash_password, verify_password, slugify,
    create_token, get_current_user, get_current_user_active, require_admin,
    require_admin_active, require_platform_admin, require_platform_super,
    tenant_id_of, tq, bq_from, resolve_branch_id, load_tenant, tenant_status,
    check_subscription, BranchScope, branch_scope, branch_scope_required,
    branch_scope_admin, apply_member_discount, compute_bill_totals,
    bill_payment_split,
    _member_settings_for, _member_status, _plan_end_iso, get_razorpay, razorpay_enabled,
    RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET,
    BRANCH_PLAN_PAISE, TENANT_PLAN_PAISE, BRANCH_PLAN_PRICES_INR,
    TENANT_PLAN_PRICES_INR, TRIAL_DAYS, DEFAULT_MEMBER_DISCOUNT_PCT,
    DEFAULT_MEMBER_MIN_PRICE, SUBSCRIPTION_PLANS, EXPENSE_CATEGORIES, STOCK_UNITS,
    JWT_SECRET, JWT_ALG,
)
from models import (
    TenantSignup, BranchIn, TenantUpdate, UserCreate, UserUpdate, PasswordReset,
    ForgotPasswordReq, ResetPasswordReq, LoginReq, BeauticianIn, ServiceIn,
    BillItem, BillCreate, MemberIn, ExpenseIn, StockItemIn, StockMovementIn,
    CashClosingIn, BranchCheckoutBody, TenantCheckoutBody, VerifyPaymentBody,
    AppointmentIn, PlatformSubscriptionUpdate, PlatformUserCreate, PlatformUserUpdate,
)

router = APIRouter()

# ============ Reports ============
@router.get("/reports/summary")
async def reports_summary(scope: BranchScope = Depends(branch_scope)):
    tid = scope.tenant_id
    today = today_str()
    month = datetime.now(timezone.utc).strftime("%Y-%m")

    q_bills = scope.filter()
    all_bills = await db.bills.find(q_bills, {"_id": 0}).to_list(10000)

    def revenue(b):
        return b.get("services_net", b.get("grand_total", 0) - b.get("tip_amount", 0))

    today_bills = [b for b in all_bills if b["created_at"].startswith(today)]
    month_bills = [b for b in all_bills if b["created_at"].startswith(month)]

    today_total = sum(revenue(b) for b in today_bills)
    today_count = len(today_bills)
    month_total = sum(revenue(b) for b in month_bills)
    month_count = len(month_bills)

    def tip_qr_of(b):
        if "tip_qr_total" in b: return b.get("tip_qr_total", 0)
        return b.get("tip_amount", 0) if b.get("tip_via") == "qr" else 0
    # Version-aware payment mix (cash net of owed tips; qr+card grouped as digital).
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
    # Members are tenant-scoped — any role can see expiring list
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
        day = b["created_at"][:10]
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


@router.get("/reports/range")
async def reports_range(
    preset: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    scope: BranchScope = Depends(branch_scope),
):
    tid = scope.tenant_id
    today = datetime.now(timezone.utc).date()

    if preset == "today":
        d_from = d_to = today
    elif preset == "yesterday":
        d_from = d_to = today - timedelta(days=1)
    elif preset == "week":
        d_from = today - timedelta(days=6); d_to = today
    elif preset == "month":
        d_from = today.replace(day=1); d_to = today
    elif preset == "last_month":
        first_this = today.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        d_from = last_prev.replace(day=1); d_to = last_prev
    else:
        try:
            d_from = datetime.strptime(from_date, "%Y-%m-%d").date() if from_date else today
            d_to = datetime.strptime(to_date, "%Y-%m-%d").date() if to_date else today
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date format (use YYYY-MM-DD)")

    if d_from > d_to:
        d_from, d_to = d_to, d_from

    if scope.user.get("role") == "staff":
        earliest = today - timedelta(days=1)
        if d_from < earliest: d_from = earliest
        if d_to < earliest: d_to = earliest

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


@router.get("/reports/revenue-by-gender")
async def reports_revenue_by_gender(
    preset: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    scope: BranchScope = Depends(branch_scope),
):
    """
    Type Revenue Split — aggregates net line revenue by service gender (ladies / men / unisex).
    Uses the same preset & custom-range semantics as /reports/range so the UI can share the
    date picker. Line revenue = price * (1 - effective_discount%/100). Tips are excluded.
    """
    today = datetime.now(timezone.utc).date()

    if preset == "today":
        d_from = d_to = today
    elif preset == "yesterday":
        d_from = d_to = today - timedelta(days=1)
    elif preset == "week":
        d_from = today - timedelta(days=6); d_to = today
    elif preset == "month":
        d_from = today.replace(day=1); d_to = today
    elif preset == "last_month":
        first_this = today.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        d_from = last_prev.replace(day=1); d_to = last_prev
    else:
        try:
            d_from = datetime.strptime(from_date, "%Y-%m-%d").date() if from_date else today.replace(day=1)
            d_to = datetime.strptime(to_date, "%Y-%m-%d").date() if to_date else today
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date format (use YYYY-MM-DD)")

    if d_from > d_to:
        d_from, d_to = d_to, d_from

    if scope.user.get("role") == "staff":
        earliest = today - timedelta(days=1)
        if d_from < earliest: d_from = earliest
        if d_to < earliest: d_to = earliest

    from_str = d_from.strftime("%Y-%m-%d")
    to_str = d_to.strftime("%Y-%m-%d")

    bills = await db.bills.find(
        scope.filter({"created_at": {"$gte": f"{from_str}T00:00:00", "$lt": f"{to_str}T23:59:59.999999+00:00"}}),
        {"_id": 0, "items": 1},
    ).to_list(20000)

    buckets: dict = {
        "ladies": {"revenue": 0.0, "count": 0},
        "men": {"revenue": 0.0, "count": 0},
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

    # Also return the winning segment (highest revenue) for a quick UI highlight.
    top_key = max(buckets, key=lambda k: buckets[k]["revenue"]) if total_revenue > 0 else None

    return {
        "from": from_str,
        "to": to_str,
        "total_revenue": round(total_revenue, 2),
        "top_segment": top_key,
        "segments": [
            {"key": "ladies", "label": "Ladies", **buckets["ladies"]},
            {"key": "men", "label": "Men", **buckets["men"]},
            {"key": "unisex", "label": "Unisex", **buckets["unisex"]},
        ],
    }


@router.get("/reports/staff-performance")
async def reports_staff_performance(
    preset: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    scope: BranchScope = Depends(branch_scope_admin),
):
    """Owner-only staff-performance dashboard.

    Aggregates each bill's line items by `beautician_id`:
      - `revenue` = sum of line-item `total` (post-discount, pre-tax) attributed to that staffer
      - `tips`    = tips routed to this staffer via `tip_beautician_id`
      - `earnings`= revenue + tips (what they generated for the business)
      - `services`= count of line items they performed
      - `appointments` = distinct bills they appeared on
      - Includes a per-day trend array for charting

    Returns rows sorted by earnings desc; `top_performer` is a shortcut to row[0].
    """
    tid = scope.tenant_id
    today = datetime.now(timezone.utc).date()

    if preset == "today":
        d_from = d_to = today
    elif preset == "yesterday":
        d_from = d_to = today - timedelta(days=1)
    elif preset == "week":
        d_from = today - timedelta(days=6); d_to = today
    elif preset == "month":
        d_from = today.replace(day=1); d_to = today
    elif preset == "last_month":
        first_this = today.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        d_from = last_prev.replace(day=1); d_to = last_prev
    else:
        try:
            d_from = datetime.strptime(from_date, "%Y-%m-%d").date() if from_date else today
            d_to = datetime.strptime(to_date, "%Y-%m-%d").date() if to_date else today
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date format (use YYYY-MM-DD)")
    if d_from > d_to:
        d_from, d_to = d_to, d_from

    from_str = d_from.strftime("%Y-%m-%d")
    to_str = d_to.strftime("%Y-%m-%d")

    # Load all beauticians in scope (so zero-performers show up too)
    beauticians = await db.beauticians.find(
        scope.filter({"active": True}), {"_id": 0, "id": 1, "name": 1, "role": 1},
    ).to_list(500)
    b_by_id: Dict[str, dict] = {b["id"]: b for b in beauticians}

    bills = await db.bills.find(
        scope.filter({"created_at": {"$gte": f"{from_str}T00:00:00", "$lt": f"{to_str}T23:59:59.999999+00:00"}}),
        {"_id": 0},
    ).to_list(20000)

    # Build day buckets for the trend chart
    days: List[str] = []
    cur = d_from
    while cur <= d_to:
        days.append(cur.strftime("%Y-%m-%d")); cur = cur + timedelta(days=1)

    # Accumulator per staff
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
        # Attribute line items
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
        # Attribute tip to the tip-beautician
        tip_amt = float(bill.get("tip_amount") or 0)
        if tip_amt > 0:
            tid_ = bill.get("tip_beautician_id")
            tname = bill.get("tip_beautician_name") or "Tip"
            b = _bucket(tid_, tname)
            b["tips"] += tip_amt
            if day in b["trend"]:
                b["trend"][day] += tip_amt

    # Ensure all active beauticians appear even with zero performance
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


