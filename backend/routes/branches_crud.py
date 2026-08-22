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

# ============ Branches ============
@router.get("/branches")
async def list_branches(user=Depends(get_current_user)):
    """List branches for current tenant. Staff also sees list (needed for readonly identify)."""
    if user.get("role") == "platform_admin":
        raise HTTPException(status_code=403, detail="Platform admin does not have branches")
    docs = await db.branches.find({"tenant_id": tenant_id_of(user)}, {"_id": 0}).sort("is_head", -1).to_list(500)
    return docs


@router.post("/branches")
async def create_branch(body: BranchIn, user=Depends(require_admin_active)):
    tid = tenant_id_of(user)
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Branch name required")
    doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "name": body.name.strip(),
        "address": body.address or "",
        "city": body.city or "",
        "state": body.state or "",
        "country": body.country or "India",
        "postal_code": body.postal_code or "",
        "phone": body.phone or "",
        "email": body.email or "",
        "logo": body.logo,
        "tax_enabled": bool(body.tax_enabled),
        "tax_number": body.tax_number or "",
        "tax_percentage": float(body.tax_percentage or 0),
        "invoice_prefix": body.invoice_prefix or "",
        "receipt_header": body.receipt_header or "",
        "receipt_footer": body.receipt_footer or "",
        "is_head": bool(body.is_head),
        "parent_branch_id": body.parent_branch_id,
        "active": True if body.active is None else bool(body.active),
        "latitude": body.latitude,
        "longitude": body.longitude,
        "geofence_radius_m": body.geofence_radius_m,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.branches.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.put("/branches/{bid}")
async def update_branch(bid: str, body: BranchIn, user=Depends(require_admin_active)):
    raw = body.model_dump(exclude_unset=True)
    # For geofence fields, allow explicit null (so user can clear the geofence)
    geofence_fields = {"latitude", "longitude", "geofence_radius_m"}
    updates = {k: v for k, v in raw.items() if v is not None or k in geofence_fields}
    if "name" in updates and isinstance(updates["name"], str):
        updates["name"] = updates["name"].strip()
    updates["updated_at"] = now_iso()
    result = await db.branches.find_one_and_update(
        tq(user, {"id": bid}), {"$set": updates},
        return_document=True, projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Branch not found")
    return result


@router.delete("/branches/{bid}")
async def delete_branch(bid: str, user=Depends(require_admin_active)):
    tid = tenant_id_of(user)
    br = await db.branches.find_one({"id": bid, "tenant_id": tid})
    if not br:
        raise HTTPException(status_code=404, detail="Not found")
    # Cannot delete if it's the last active branch
    n_active = await db.branches.count_documents({"tenant_id": tid, "active": True, "id": {"$ne": bid}})
    if n_active == 0:
        raise HTTPException(status_code=400, detail="Cannot delete the last branch. Tenant must have at least one branch.")
    # Cannot delete if it has bills
    n_bills = await db.bills.count_documents({"tenant_id": tid, "branch_id": bid})
    if n_bills > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: this branch has {n_bills} bills. You can deactivate it instead.")
    await db.branches.delete_one({"id": bid, "tenant_id": tid})
    # Also cleanup users assigned to this branch → reassign to head or unset
    head = await db.branches.find_one({"tenant_id": tid, "is_head": True})
    new_bid = head["id"] if head else None
    await db.users.update_many({"tenant_id": tid, "branch_id": bid}, {"$set": {"branch_id": new_bid}})
    return {"ok": True}

