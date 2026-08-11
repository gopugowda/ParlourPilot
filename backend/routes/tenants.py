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

# ============ Tenant / Signup Routes ============
@router.post("/tenants/signup")
async def signup_tenant(body: TenantSignup):
    """Public endpoint. Creates a new tenant + owner user + N branches + 15-day trial."""
    email = body.email.lower().strip()
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    if not body.business_name.strip():
        raise HTTPException(status_code=400, detail="Business name required")

    now = datetime.now(timezone.utc)
    trial_end = now + timedelta(days=TRIAL_DAYS)
    tenant_id = str(uuid.uuid4())
    slug = slugify(body.business_name)
    base_slug = slug
    i = 1
    while await db.tenants.find_one({"slug": slug}):
        i += 1
        slug = f"{base_slug}-{i}"

    tenant_doc = {
        "id": tenant_id,
        "business_name": body.business_name.strip(),
        "slug": slug,
        "logo": None,
        "owner_name": body.owner_name.strip(),
        "email": email,
        "phone": body.phone or "",
        "address": "",
        "city": body.city or "",
        "state": "",
        "country": body.country or "India",
        "postal_code": "",
        "website": "",
        "currency": "INR",
        "timezone": "Asia/Kolkata",
        "tax_enabled": False,
        "tax_number": "",
        "tax_percentage": 0.0,
        "invoice_prefix": "INV",
        "receipt_header": "",
        "receipt_footer": "Thank you! Powered by ParlourPilot",
        "member_discount_pct": DEFAULT_MEMBER_DISCOUNT_PCT,
        "member_min_price": DEFAULT_MEMBER_MIN_PRICE,
        "subscription_plan": "trial",
        "subscription_status": "trialing",
        "trial_start_date": now.isoformat(),
        "trial_end_date": trial_end.isoformat(),
        "subscription_start_date": None,
        "subscription_end_date": trial_end.isoformat(),
        "is_active": True,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.tenants.insert_one(tenant_doc)

    # Create branches
    n_branches = max(1, int(body.num_branches or 1))
    branch_names = body.branch_names or []
    head_branch_id: Optional[str] = None
    created_branches: List[dict] = []
    for idx in range(n_branches):
        bname = branch_names[idx] if idx < len(branch_names) and branch_names[idx].strip() else (
            "Head Branch" if idx == 0 else f"Branch {idx + 1}"
        )
        br_doc = {
            "id": str(uuid.uuid4()),
            "tenant_id": tenant_id,
            "name": bname.strip(),
            "address": "",
            "city": body.city or "",
            "state": "",
            "country": body.country or "India",
            "postal_code": "",
            "phone": body.phone or "" if idx == 0 else "",
            "email": email if idx == 0 else "",
            "logo": None,
            "tax_enabled": False,
            "tax_number": "",
            "tax_percentage": 0.0,
            "invoice_prefix": "" if idx == 0 else f"B{idx + 1}",
            "receipt_header": "",
            "receipt_footer": "",
            "is_head": idx == 0,
            "parent_branch_id": None if idx == 0 else head_branch_id,
            "active": True,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await db.branches.insert_one(br_doc)
        if idx == 0:
            head_branch_id = br_doc["id"]
        created_branches.append({k: v for k, v in br_doc.items() if k != "_id"})

    # Owner user (admin) — assigned to head branch by default but can switch
    user_doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "branch_id": head_branch_id,
        "name": body.owner_name.strip(),
        "email": email,
        "password_hash": hash_password(body.password),
        "role": "admin",
        "is_active": True,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.users.insert_one(user_doc)

    token = create_token(user_doc["id"], user_doc["role"], tenant_id)
    return {
        "token": token,
        "user": {
            "id": user_doc["id"],
            "tenant_id": tenant_id,
            "branch_id": head_branch_id,
            "name": user_doc["name"],
            "email": user_doc["email"],
            "role": user_doc["role"],
        },
        "tenant": {k: v for k, v in tenant_doc.items() if k != "_id"},
        "branches": created_branches,
        "subscription": tenant_status(tenant_doc),
    }


@router.get("/tenants/me")
async def get_my_tenant(user=Depends(get_current_user)):
    if user.get("role") == "platform_admin":
        return {"tenant": None, "subscription": None}
    tenant = await load_tenant(tenant_id_of(user))
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {"tenant": tenant, "subscription": tenant_status(tenant)}


@router.put("/tenants/me")
async def update_my_tenant(body: TenantUpdate, user=Depends(require_admin)):
    tid = tenant_id_of(user)
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        tenant = await load_tenant(tid)
        return {"tenant": tenant, "subscription": tenant_status(tenant)}
    updates["updated_at"] = now_iso()
    tenant = await db.tenants.find_one_and_update(
        {"id": tid}, {"$set": updates},
        return_document=True, projection={"_id": 0},
    )
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {"tenant": tenant, "subscription": tenant_status(tenant)}


@router.get("/tenants/me/subscription")
async def my_subscription(user=Depends(get_current_user)):
    if user.get("role") == "platform_admin":
        return {"status": "platform_admin"}
    tenant = await load_tenant(tenant_id_of(user))
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    # include branch count for pricing
    n_branches = await db.branches.count_documents({"tenant_id": tenant["id"], "active": True})
    st = tenant_status(tenant)
    st["branch_count"] = n_branches
    st["plans"] = SUBSCRIPTION_PLANS
    return st

