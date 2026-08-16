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

# ============ Services ============
@router.get("/services")
async def list_services(scope: BranchScope = Depends(branch_scope)):
    docs = await db.services.find(scope.filter(), {"_id": 0}).sort("name", 1).to_list(500)
    return docs


@router.post("/services")
async def create_service(body: ServiceIn, scope: BranchScope = Depends(branch_scope_admin)):
    # Sync both schemas: web writes `service_type` (Ladies/Men/Unisex TitleCase) + `variable_price` (bool)
    g = (body.gender or "unisex").lower()
    svc_type = "Ladies" if g == "ladies" else "Men" if g == "men" else "Unisex"
    ap = float(body.additional_price or 0)
    doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": scope.tenant_id,
        "branch_id": scope.branch_id,
        "name": body.name,
        "price": float(body.price),
        # Web-schema keys (primary — this is what the web app reads):
        "service_type": svc_type,
        "variable_price": ap > 0,
        # Mobile-only enhancement keys (kept for backward compat with mobile UI):
        "additional_price": ap,
        "gender": g,
        "category": body.category or "General",
        "tax_percentage": float(body.tax_percentage or 0),
        "active": body.active,
        "created_at": now_iso(),
    }
    await db.services.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.put("/services/{sid}")
async def update_service(sid: str, body: ServiceIn, scope: BranchScope = Depends(branch_scope_admin)):
    g = (body.gender or "unisex").lower()
    svc_type = "Ladies" if g == "ladies" else "Men" if g == "men" else "Unisex"
    ap = float(body.additional_price or 0)
    result = await db.services.find_one_and_update(
        scope.filter({"id": sid}),
        {"$set": {
            "name": body.name, "price": float(body.price),
            "service_type": svc_type,
            "variable_price": ap > 0,
            "additional_price": ap,
            "gender": g,
            "category": body.category,
            "tax_percentage": float(body.tax_percentage or 0),
            "active": body.active,
        }},
        return_document=True, projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Service not found")
    return result


@router.get("/services/categories")
async def list_service_categories(scope: BranchScope = Depends(branch_scope)):
    """Return distinct categories in current tenant (used by the mobile 'Pick or Type' category input)."""
    cats = await db.services.distinct("category", scope.filter())
    # Ensure a couple of sane defaults are always suggested.
    defaults = ["Hair", "Skin", "Nails", "Facial", "Bridal", "Massage", "Waxing", "Threading", "General"]
    seen = []
    for c in [*defaults, *sorted([c for c in cats if c])]:
        if c and c not in seen:
            seen.append(c)
    return seen


@router.delete("/services/{sid}")
async def delete_service(sid: str, scope: BranchScope = Depends(branch_scope_admin)):
    result = await db.services.delete_one(scope.filter({"id": sid}))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


