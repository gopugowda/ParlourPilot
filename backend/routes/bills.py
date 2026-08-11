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

# ============ Bills ============
async def _next_bill_number(tid: str, branch_id: Optional[str], prefix_override: Optional[str] = None) -> str:
    now = datetime.now(timezone.utc)
    date_prefix = now.strftime("%Y%m%d")
    q: dict = {"tenant_id": tid, "bill_no": {"$regex": f".*{date_prefix}"}}
    if branch_id:
        q["branch_id"] = branch_id
    count = await db.bills.count_documents(q)
    inv_prefix = (prefix_override or "").strip()
    if inv_prefix:
        return f"{inv_prefix}-{date_prefix}-{count + 1:04d}"
    return f"{date_prefix}-{count + 1:04d}"


@router.post("/bills")
async def create_bill(body: BillCreate, scope: BranchScope = Depends(branch_scope_required)):
    if not body.items:
        raise HTTPException(status_code=400, detail="At least one service required")
    tid = scope.tenant_id
    tenant = await load_tenant(tid)
    branch = await db.branches.find_one({"id": scope.branch_id, "tenant_id": tid}, {"_id": 0}) if scope.branch_id else None

    # If is_member, look up the member's own discount override (members are tenant-scoped)
    member_disc_override: Optional[float] = None
    if body.is_member and body.customer_phone:
        m = await db.members.find_one({"tenant_id": tid, "phone": body.customer_phone.strip(), "active": True})
        if m and m.get("discount_pct") is not None:
            member_disc_override = float(m["discount_pct"])

    items_eff = apply_member_discount(body.items, body.is_member, tenant, member_disc_override)
    subtotal, discount, services_net, tax_total = compute_bill_totals(items_eff)

    line_tip_total = sum(float(it.get("tip_amount", 0) or 0) for it in items_eff)
    line_tip_qr = sum(float(it.get("tip_amount", 0) or 0) for it in items_eff if it.get("tip_via") == "qr")
    line_tip_cash = line_tip_total - line_tip_qr

    payable = round(services_net + tax_total, 2)

    if body.payment_mode == "cash":
        cash_amt = payable; qr_amt = 0.0
    elif body.payment_mode == "qr":
        cash_amt = 0.0; qr_amt = payable
    else:
        cash_amt = round(body.cash_amount, 2); qr_amt = round(body.qr_amount, 2)
        if abs((cash_amt + qr_amt) - payable) > 0.01:
            raise HTTPException(status_code=400, detail=f"Split amounts must total {payable}")

    tip_amount = round(max(0.0, float(body.tip_amount or 0)), 2)
    tip_via = body.tip_via if tip_amount > 0 else None
    if tip_amount > 0 and tip_via not in ("cash", "qr"):
        raise HTTPException(status_code=400, detail="tip_via required when tip_amount > 0")

    total_tip_amount = round(tip_amount + line_tip_total, 2)
    total_tip_qr = round((tip_amount if tip_via == "qr" else 0) + line_tip_qr, 2)
    total_tip_cash = round(total_tip_amount - total_tip_qr, 2)
    grand_total = round(services_net + tax_total + total_tip_amount, 2)

    # Prefer branch-level invoice prefix, then tenant
    inv_prefix = (branch or {}).get("invoice_prefix") or (tenant or {}).get("invoice_prefix") or ""
    bill = {
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "branch_id": scope.branch_id,
        "bill_no": await _next_bill_number(tid, scope.branch_id, inv_prefix),
        "customer_name": body.customer_name or "Walk-in",
        "customer_phone": body.customer_phone or "",
        "items": items_eff,
        "subtotal": subtotal,
        "discount": discount,
        "tax_amount": tax_total,
        "services_net": services_net,
        "is_member": bool(body.is_member),
        "member_discount_pct_applied": member_disc_override,
        "tip_amount": total_tip_amount,
        "tip_via": tip_via,
        "tip_beautician_id": body.tip_beautician_id if tip_amount > 0 else None,
        "tip_beautician_name": (body.tip_beautician_name or "") if tip_amount > 0 else "",
        "tip_cash_total": total_tip_cash,
        "tip_qr_total": total_tip_qr,
        "grand_total": grand_total,
        "payment_mode": body.payment_mode,
        "cash_amount": cash_amt,
        "qr_amount": qr_amt,
        "notes": body.notes or "",
        "created_by": scope.user["id"],
        "created_by_name": scope.user["name"],
        "created_at": now_iso(),
    }
    await db.bills.insert_one(bill)
    return {k: v for k, v in bill.items() if k != "_id"}


@router.get("/bills")
async def list_bills(
    limit: int = 100,
    date: Optional[str] = None,
    payment_mode: Optional[str] = None,
    scope: BranchScope = Depends(branch_scope),
):
    query: dict = scope.filter()
    if scope.user.get("role") == "staff":
        t = today_str()
        query["created_at"] = {"$gte": f"{t}T00:00:00", "$lt": f"{t}T23:59:59.999999+00:00"}
    elif date:
        query["created_at"] = {"$gte": f"{date}T00:00:00", "$lt": f"{date}T23:59:59.999999+00:00"}
    if payment_mode and payment_mode != "all":
        query["payment_mode"] = payment_mode
    docs = await db.bills.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return docs


@router.put("/bills/{bid}")
async def update_bill(bid: str, body: BillCreate, scope: BranchScope = Depends(branch_scope_admin)):
    tid = scope.tenant_id
    tenant = await load_tenant(tid)
    existing = await db.bills.find_one(scope.filter({"id": bid}), {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Bill not found")
    if not body.items:
        raise HTTPException(status_code=400, detail="At least one service required")

    member_disc_override: Optional[float] = None
    if body.is_member and body.customer_phone:
        m = await db.members.find_one({"tenant_id": tid, "phone": body.customer_phone.strip(), "active": True})
        if m and m.get("discount_pct") is not None:
            member_disc_override = float(m["discount_pct"])

    items_eff = apply_member_discount(body.items, body.is_member, tenant, member_disc_override)
    subtotal, discount, services_net, tax_total = compute_bill_totals(items_eff)

    line_tip_total = sum(float(it.get("tip_amount", 0) or 0) for it in items_eff)
    line_tip_qr = sum(float(it.get("tip_amount", 0) or 0) for it in items_eff if it.get("tip_via") == "qr")

    payable = round(services_net + tax_total, 2)

    if body.payment_mode == "cash":
        cash_amt = payable; qr_amt = 0.0
    elif body.payment_mode == "qr":
        cash_amt = 0.0; qr_amt = payable
    else:
        cash_amt = round(body.cash_amount, 2); qr_amt = round(body.qr_amount, 2)
        if abs((cash_amt + qr_amt) - payable) > 0.01:
            raise HTTPException(status_code=400, detail=f"Split amounts must total {payable}")

    tip_amount = round(max(0.0, float(body.tip_amount or 0)), 2)
    tip_via = body.tip_via if tip_amount > 0 else None
    total_tip_amount = round(tip_amount + line_tip_total, 2)
    total_tip_qr = round((tip_amount if tip_via == "qr" else 0) + line_tip_qr, 2)
    total_tip_cash = round(total_tip_amount - total_tip_qr, 2)
    grand_total = round(services_net + tax_total + total_tip_amount, 2)

    update = {
        "customer_name": body.customer_name or existing.get("customer_name", "Walk-in"),
        "customer_phone": body.customer_phone or "",
        "items": items_eff,
        "subtotal": subtotal,
        "discount": discount,
        "tax_amount": tax_total,
        "services_net": services_net,
        "is_member": bool(body.is_member),
        "member_discount_pct_applied": member_disc_override,
        "tip_amount": total_tip_amount,
        "tip_via": tip_via,
        "tip_beautician_id": body.tip_beautician_id if tip_amount > 0 else None,
        "tip_beautician_name": (body.tip_beautician_name or "") if tip_amount > 0 else "",
        "tip_cash_total": total_tip_cash,
        "tip_qr_total": total_tip_qr,
        "grand_total": grand_total,
        "payment_mode": body.payment_mode,
        "cash_amount": cash_amt,
        "qr_amount": qr_amt,
        "notes": body.notes or "",
        "edited_by": scope.user["id"],
        "edited_by_name": scope.user["name"],
        "edited_at": now_iso(),
    }
    result = await db.bills.find_one_and_update(
        scope.filter({"id": bid}), {"$set": update},
        return_document=True, projection={"_id": 0},
    )
    return result


@router.get("/bills/{bid}")
async def get_bill(bid: str, scope: BranchScope = Depends(branch_scope)):
    doc = await db.bills.find_one(scope.filter({"id": bid}), {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Bill not found")
    if scope.user.get("role") == "staff":
        t = today_str()
        if not doc["created_at"].startswith(t):
            raise HTTPException(status_code=403, detail="Staff can only view today's bills")
    return doc


@router.delete("/bills/{bid}")
async def delete_bill(bid: str, scope: BranchScope = Depends(branch_scope_admin)):
    result = await db.bills.delete_one(scope.filter({"id": bid}))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


