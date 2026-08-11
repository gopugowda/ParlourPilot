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

# ============ Members ============
@router.get("/members")
async def list_members(user=Depends(get_current_user_active)):
    """Members are tenant-scoped (shared across branches). Staff can view."""
    docs = await db.members.find(tq(user), {"_id": 0}).sort("name", 1).to_list(1000)
    return [_member_status(m) for m in docs]


@router.get("/members/lookup")
async def lookup_member(phone: str, user=Depends(get_current_user_active)):
    phone_clean = (phone or "").strip()
    if len(phone_clean) < 4:
        return {"found": False}
    doc = await db.members.find_one(tq(user, {"phone": phone_clean}), {"_id": 0})
    if not doc:
        return {"found": False}
    m = _member_status(doc)
    tenant = await load_tenant(tenant_id_of(user))
    default_pct, _ = _member_settings_for(tenant)
    m["effective_discount_pct"] = float(m.get("discount_pct")) if m.get("discount_pct") is not None else float(default_pct)
    return {"found": True, "member": m, "is_active_member": m["status"] in ("active", "expiring_soon")}


@router.post("/members")
async def create_member(body: MemberIn, user=Depends(require_admin_active)):
    tid = tenant_id_of(user)
    phone_clean = body.phone.strip()
    if await db.members.find_one({"tenant_id": tid, "phone": phone_clean}):
        raise HTTPException(status_code=400, detail="Phone already registered as member")
    today = today_str()
    joined = body.joined_at or today
    if not body.expires_at:
        try:
            j = datetime.strptime(joined, "%Y-%m-%d")
            expires = (j.replace(year=j.year + 1)).strftime("%Y-%m-%d")
        except Exception:
            expires = None
    else:
        expires = body.expires_at
    doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "name": body.name.strip(),
        "phone": phone_clean,
        "joined_at": joined,
        "expires_at": expires,
        "discount_pct": float(body.discount_pct) if body.discount_pct is not None else None,
        "notes": body.notes or "",
        "active": body.active,
        "created_at": now_iso(),
    }
    await db.members.insert_one(doc)
    return _member_status({k: v for k, v in doc.items() if k != "_id"})


@router.put("/members/{mid}")
async def update_member(mid: str, body: MemberIn, user=Depends(require_admin_active)):
    result = await db.members.find_one_and_update(
        tq(user, {"id": mid}),
        {"$set": {
            "name": body.name.strip(), "phone": body.phone.strip(),
            "joined_at": body.joined_at, "expires_at": body.expires_at,
            "discount_pct": float(body.discount_pct) if body.discount_pct is not None else None,
            "notes": body.notes or "", "active": body.active,
        }},
        return_document=True, projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Member not found")
    return _member_status(result)


@router.delete("/members/{mid}")
async def delete_member(mid: str, user=Depends(require_admin_active)):
    result = await db.members.delete_one(tq(user, {"id": mid}))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


@router.get("/members/expiring")
async def members_expiring(days: int = 30, user=Depends(get_current_user_active)):
    docs = await db.members.find(tq(user, {"active": True}), {"_id": 0}).to_list(1000)
    result = []
    for m in docs:
        m2 = _member_status(m)
        if m2["status"] in ("expiring_soon", "expired"):
            result.append(m2)
    result.sort(key=lambda x: x.get("days_left") if x.get("days_left") is not None else 9999)
    return result


