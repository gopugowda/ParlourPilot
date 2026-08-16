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

    # Use the shared preset resolver so new presets (last_week, quarter, year)
    # are honoured uniformly across all reports endpoints.
    d_from, d_to = _preset_range(preset, from_date, to_date)

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


def _preset_range(preset: Optional[str], from_date: Optional[str], to_date: Optional[str]):
    """Shared preset -> (d_from, d_to) resolver used by analytics + range."""
    today = datetime.now(timezone.utc).date()
    if preset == "today":
        d_from = d_to = today
    elif preset == "yesterday":
        d_from = d_to = today - timedelta(days=1)
    elif preset == "week":
        d_from = today - timedelta(days=6); d_to = today
    elif preset == "last_week":
        # Monday-based last calendar week
        this_mon = today - timedelta(days=today.weekday())
        d_from = this_mon - timedelta(days=7)
        d_to = this_mon - timedelta(days=1)
    elif preset == "month":
        d_from = today.replace(day=1); d_to = today
    elif preset == "last_month":
        first_this = today.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        d_from = last_prev.replace(day=1); d_to = last_prev
    elif preset == "quarter":
        # This quarter (rolling calendar quarter)
        q = (today.month - 1) // 3
        d_from = today.replace(month=q * 3 + 1, day=1); d_to = today
    elif preset == "year":
        d_from = today.replace(month=1, day=1); d_to = today
    else:
        try:
            d_from = datetime.strptime(from_date, "%Y-%m-%d").date() if from_date else today
            d_to = datetime.strptime(to_date, "%Y-%m-%d").date() if to_date else today
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date format (use YYYY-MM-DD)")
    if d_from > d_to:
        d_from, d_to = d_to, d_from
    return d_from, d_to


def _aggregate_bills_metrics(bills: List[dict]):
    """Aggregate per-bill metrics used by both /reports/analytics and comparison periods."""
    total_sales = 0.0  # gross (pre-discount)
    net_sales = 0.0    # post-discount (services_net)
    total_discount = 0.0
    total_tax = 0.0
    total_tips = 0.0
    cash_total = 0.0
    upi_total = 0.0
    card_total = 0.0
    invoice_count = 0
    services_count = 0
    customer_phones: set = set()
    for b in bills:
        invoice_count += 1
        # Item-level totals (gross + discount + tax)
        for it in (b.get("items") or []):
            services_count += 1
            price = float(it.get("price") or 0)
            eff_disc = float(it.get("effective_discount_pct") or it.get("discount_pct") or 0) / 100.0
            tax_pct = float(it.get("tax_percentage") or 0) / 100.0
            line_gross = price
            line_disc = line_gross * eff_disc
            line_net = line_gross - line_disc
            line_tax = line_net * tax_pct
            total_sales += line_gross
            total_discount += line_disc
            total_tax += line_tax
        net = float(b.get("services_net", b.get("grand_total", 0) - b.get("tip_amount", 0)) or 0)
        net_sales += net
        total_tips += float(b.get("tip_amount") or 0)
        # Payment split (cash/upi/card) — version-aware for tips
        cash_raw = float(b.get("cash_amount") or 0)
        qr_raw = float(b.get("qr_amount") or 0)
        card_raw = float(b.get("card_amount") or 0)
        if b.get("split_v2"):
            tips_owed = float(b.get("tip_owed_total") or 0)
            cash_total += max(0.0, cash_raw - tips_owed)
            upi_total += qr_raw
            card_total += card_raw
        else:
            # legacy fallback — best effort
            tip_qr = float(b.get("tip_qr_total") or 0)
            if not tip_qr and b.get("tip_via") == "qr":
                tip_qr = float(b.get("tip_amount") or 0)
            cash_total += max(0.0, cash_raw - tip_qr)
            upi_total += qr_raw + tip_qr
            card_total += card_raw
        phone = (b.get("customer_phone") or "").strip()
        if phone:
            customer_phones.add(phone)
    return {
        "total_sales": round(total_sales, 2),
        "net_sales": round(net_sales, 2),
        "total_discount": round(total_discount, 2),
        "total_tax": round(total_tax, 2),
        "total_tips": round(total_tips, 2),
        "cash": round(cash_total, 2),
        "upi": round(upi_total, 2),
        "card": round(card_total, 2),
        "invoices": invoice_count,
        "services": services_count,
        "customer_phones": customer_phones,
    }


@router.get("/reports/analytics")
async def reports_analytics(
    preset: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    scope: BranchScope = Depends(branch_scope_admin),
):
    """Unified analytics payload feeding the mobile Reports screen (web-parity)."""
    today = datetime.now(timezone.utc).date()
    d_from, d_to = _preset_range(preset, from_date, to_date)
    if scope.user.get("role") == "staff":
        earliest = today - timedelta(days=1)
        if d_from < earliest: d_from = earliest
        if d_to < earliest: d_to = earliest
    from_str = d_from.strftime("%Y-%m-%d")
    to_str = d_to.strftime("%Y-%m-%d")

    async def _bills_between(a: str, b: str):
        return await db.bills.find(
            scope.filter({"created_at": {"$gte": f"{a}T00:00:00", "$lt": f"{b}T23:59:59.999999+00:00"}}),
            {"_id": 0},
        ).to_list(20000)

    async def _exp_between(a: str, b: str):
        return await db.expenses.find(
            scope.filter({"date": {"$gte": a, "$lte": b}}),
            {"_id": 0},
        ).to_list(20000)

    # Main range
    bills = await _bills_between(from_str, to_str)
    exps = await _exp_between(from_str, to_str)
    agg = _aggregate_bills_metrics(bills)

    total_expenses = round(sum(float(e.get("amount") or 0) for e in exps), 2)
    # Staff commission: prefer bill.staff_commission if present, else 0.
    staff_commission = 0.0
    for b in bills:
        sc = float(b.get("staff_commission") or 0)
        staff_commission += sc
    staff_commission = round(staff_commission, 2)

    net_sales = agg["net_sales"]
    net_profit = round(net_sales - total_expenses - staff_commission, 2)

    # Customer breakdown — new vs returning within range (based on all-time first bill per phone)
    all_bills_for_phones = await db.bills.find(
        scope.filter(), {"_id": 0, "customer_phone": 1, "created_at": 1},
    ).to_list(50000)
    first_seen: dict = {}
    for b in all_bills_for_phones:
        p = (b.get("customer_phone") or "").strip()
        if not p: continue
        ca = b.get("created_at") or ""
        if p not in first_seen or ca < first_seen[p]:
            first_seen[p] = ca
    new_customers = 0
    returning_customers = 0
    for p in agg["customer_phones"]:
        first = first_seen.get(p, "")
        if first.startswith(from_str) or (from_str <= first[:10] <= to_str):
            new_customers += 1
        else:
            returning_customers += 1
    total_customers = new_customers + returning_customers

    avg_ticket = round(net_sales / agg["invoices"], 2) if agg["invoices"] else 0.0

    # Revenue trend — per-day net revenue in the selected range
    by_day: dict = {}
    cur = d_from
    while cur <= d_to:
        by_day[cur.strftime("%Y-%m-%d")] = 0.0
        cur = cur + timedelta(days=1)
    for b in bills:
        day = (b.get("created_at") or "")[:10]
        if day in by_day:
            by_day[day] += float(b.get("services_net", b.get("grand_total", 0) - b.get("tip_amount", 0)) or 0)
    trend = [{"date": k, "value": round(v, 2)} for k, v in sorted(by_day.items())]

    # Payment methods donut (cash, upi, card, other=tips) with shares
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

    # This month vs last month & This year vs last year comparisons
    first_this_month = today.replace(day=1)
    last_of_prev_month = first_this_month - timedelta(days=1)
    first_last_month = last_of_prev_month.replace(day=1)
    first_this_year = today.replace(month=1, day=1)
    last_year_start = first_this_year.replace(year=first_this_year.year - 1)
    last_year_end = first_this_year - timedelta(days=1)

    async def _period_summary(a: str, b: str):
        bs = await _bills_between(a, b)
        ax = _aggregate_bills_metrics(bs)
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
        # metric cards
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
        # charts
        "trend": trend,
        "payment_methods": payment_methods,
        # comparisons
        "this_month": this_month,
        "last_month": last_month,
        "month_change_pct": _pct_change(this_month["revenue"], last_month["revenue"]),
        "this_year": this_year,
        "last_year": last_year,
        "year_change_pct": _pct_change(this_year["revenue"], last_year["revenue"]),
    }


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
    d_from, d_to = _preset_range(preset, from_date, to_date)

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
    d_from, d_to = _preset_range(preset, from_date, to_date)
    if scope.user.get("role") == "staff":
        earliest = today - timedelta(days=1)
        if d_from < earliest: d_from = earliest
        if d_to < earliest: d_to = earliest

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


