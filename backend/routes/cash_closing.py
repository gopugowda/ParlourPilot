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
    _member_settings_for, _plan_end_iso, get_razorpay, razorpay_enabled,
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

# ============ Cash Closing ============
async def _compute_day_totals(tid: str, branch_id: Optional[str], d: str):
    q_bills: dict = {"tenant_id": tid, "created_at": {"$gte": f"{d}T00:00:00", "$lt": f"{d}T23:59:59.999999+00:00"}}
    if branch_id: q_bills["branch_id"] = branch_id
    bills = await db.bills.find(q_bills, {"_id": 0}).to_list(3000)
    services_net = sum(b.get("services_net", b.get("grand_total", 0) - b.get("tip_amount", 0)) for b in bills)
    tip_total = sum(b.get("tip_amount", 0) for b in bills)
    tip_qr = sum(b.get("tip_qr_total", b.get("tip_amount", 0) if b.get("tip_via") == "qr" else 0) for b in bills)
    cash_sales = sum(b.get("cash_amount", 0) for b in bills) - tip_qr
    upi_sales = sum(b.get("qr_amount", 0) for b in bills) + tip_qr
    q_exp: dict = {"tenant_id": tid, "date": d}
    if branch_id: q_exp["branch_id"] = branch_id
    exps = await db.expenses.find(q_exp, {"_id": 0}).to_list(500)
    total_expenses = sum(e["amount"] for e in exps)
    return {
        "bills_count": len(bills),
        "total_revenue": round(services_net, 2),
        "cash_sales": round(cash_sales, 2),
        "upi_sales": round(upi_sales, 2),
        "tips": round(tip_total, 2),
        "total_expenses": round(total_expenses, 2),
    }


@router.get("/cash-closing/summary")
async def cash_closing_summary(date: Optional[str] = None, scope: BranchScope = Depends(branch_scope_required)):
    tid = scope.tenant_id
    d = date or today_str()
    totals = await _compute_day_totals(tid, scope.branch_id, d)
    prev = await db.cash_closings.find_one(
        {"tenant_id": tid, "branch_id": scope.branch_id, "date": {"$lt": d}},
        sort=[("date", -1)], projection={"_id": 0},
    )
    suggested_opening = prev["actual_closing"] if prev else 0
    existing = await db.cash_closings.find_one({"tenant_id": tid, "branch_id": scope.branch_id, "date": d}, projection={"_id": 0})
    return {"date": d, **totals, "suggested_opening": round(suggested_opening, 2), "existing_closing": existing}


@router.post("/cash-closing")
async def create_cash_closing(body: CashClosingIn, scope: BranchScope = Depends(branch_scope_required)):
    tid = scope.tenant_id
    d = body.date or today_str()
    totals = await _compute_day_totals(tid, scope.branch_id, d)

    opening = round(float(body.opening_balance or 0), 2)
    cash_exp = round(float(body.cash_expenses or 0), 2)
    actual = round(float(body.actual_closing or 0), 2)
    expected = round(opening + totals["cash_sales"] - cash_exp, 2)
    difference = round(actual - expected, 2)

    doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "branch_id": scope.branch_id,
        "date": d,
        "opening_balance": opening,
        "cash_sales": totals["cash_sales"],
        "upi_sales": totals["upi_sales"],
        "total_revenue": totals["total_revenue"],
        "total_expenses": totals["total_expenses"],
        "cash_expenses": cash_exp,
        "tips": totals["tips"],
        "bills_count": totals["bills_count"],
        "expected_closing": expected,
        "actual_closing": actual,
        "difference": difference,
        "notes": body.notes or "",
        "submitted_by": scope.user["id"],
        "submitted_by_name": scope.user["name"],
        "submitted_at": now_iso(),
    }
    await db.cash_closings.replace_one({"tenant_id": tid, "branch_id": scope.branch_id, "date": d}, doc, upsert=True)
    return doc


@router.get("/cash-closing")
async def list_cash_closings(limit: int = 30, scope: BranchScope = Depends(branch_scope)):
    docs = await db.cash_closings.find(scope.filter(), {"_id": 0}).sort("date", -1).to_list(limit)
    return docs


@router.delete("/cash-closing/{cid}")
async def delete_cash_closing(cid: str, scope: BranchScope = Depends(branch_scope_admin)):
    result = await db.cash_closings.delete_one(scope.filter({"id": cid}))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


