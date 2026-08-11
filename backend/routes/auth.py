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

# ============ Auth Routes ============
@router.post("/auth/register")
async def register(body: UserCreate, user=Depends(require_admin)):
    """Admin creates a staff/user WITHIN their own tenant."""
    tid = tenant_id_of(user)
    email = body.email.lower()
    existing = await db.users.find_one({"email": email, "tenant_id": tid})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered in this salon")
    role = "admin" if body.role in ("admin", "owner") else "staff"
    # Validate branch_id belongs to tenant if provided
    branch_id = body.branch_id
    if branch_id:
        br = await db.branches.find_one({"id": branch_id, "tenant_id": tid})
        if not br:
            raise HTTPException(status_code=400, detail="Invalid branch")
    # Staff must have a branch — default to first branch if not specified
    if role == "staff" and not branch_id:
        head = await db.branches.find_one({"tenant_id": tid, "is_head": True})
        branch_id = head["id"] if head else None
    user_doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "branch_id": branch_id,
        "name": body.name,
        "email": email,
        "password_hash": hash_password(body.password),
        "role": role,
        "is_active": True,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.users.insert_one(user_doc)
    return {k: v for k, v in user_doc.items() if k not in ("_id", "password_hash")}


@router.post("/auth/login")
async def login(body: LoginReq):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account disabled. Please contact administrator.")

    token = create_token(user["id"], user["role"], user.get("tenant_id"))

    subscription = None
    tenant = None
    branches: List[dict] = []
    if user.get("tenant_id"):
        tenant = await load_tenant(user["tenant_id"])
        if tenant:
            subscription = tenant_status(tenant)
        branches = await db.branches.find({"tenant_id": user["tenant_id"], "active": True}, {"_id": 0}).sort("is_head", -1).to_list(500)

    return {
        "token": token,
        "user": {
            "id": user["id"],
            "tenant_id": user.get("tenant_id"),
            "branch_id": user.get("branch_id"),
            "name": user["name"],
            "email": user["email"],
            "role": user["role"],
        },
        "tenant": tenant,
        "branches": branches,
        "subscription": subscription,
    }


@router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    tenant = None
    subscription = None
    branches: List[dict] = []
    if user.get("tenant_id"):
        tenant = await load_tenant(user["tenant_id"])
        if tenant:
            subscription = tenant_status(tenant)
        branches = await db.branches.find({"tenant_id": user["tenant_id"], "active": True}, {"_id": 0}).sort("is_head", -1).to_list(500)
    return {"user": user, "tenant": tenant, "branches": branches, "subscription": subscription}


@router.get("/auth/users")
async def list_users(user=Depends(require_admin)):
    users = await db.users.find(tq(user), {"_id": 0, "password_hash": 0}).to_list(500)
    return users


@router.put("/auth/users/{uid}")
async def update_user(uid: str, body: UserUpdate, user=Depends(require_admin)):
    tid = tenant_id_of(user)
    target = await db.users.find_one({"id": uid, "tenant_id": tid}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.email is not None:
        email_lower = body.email.lower()
        existing = await db.users.find_one({"email": email_lower, "tenant_id": tid, "id": {"$ne": uid}})
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")
        updates["email"] = email_lower
    if body.role is not None:
        target_role = target.get("role")
        new_role = "admin" if body.role in ("admin", "owner") else "staff"
        # Prevent demoting the last admin/owner of this tenant
        if target_role in ("admin", "owner") and new_role == "staff":
            admin_count = await db.users.count_documents({"tenant_id": tid, "role": {"$in": ["admin", "owner"]}})
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot demote the last owner/admin")
        updates["role"] = new_role
    if "branch_id" in body.model_fields_set:
        # Preventing staff from being unassigned from a branch (staff MUST have a branch)
        target_role = target.get("role")
        new_role = updates.get("role", target_role)
        if new_role == "staff" and not body.branch_id:
            raise HTTPException(status_code=400, detail="Staff users must be assigned to a branch")
        if body.branch_id:
            br = await db.branches.find_one({"id": body.branch_id, "tenant_id": tid})
            if not br:
                raise HTTPException(status_code=400, detail="Invalid branch")
        updates["branch_id"] = body.branch_id or None
    if body.is_active is not None:
        updates["is_active"] = bool(body.is_active)
    if not updates:
        return {k: v for k, v in target.items() if k != "password_hash"}
    updates["updated_at"] = now_iso()
    result = await db.users.find_one_and_update(
        {"id": uid, "tenant_id": tid}, {"$set": updates},
        return_document=True, projection={"_id": 0, "password_hash": 0},
    )
    return result


@router.delete("/auth/users/{uid}")
async def delete_user(uid: str, user=Depends(require_admin)):
    tid = tenant_id_of(user)
    if uid == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    target = await db.users.find_one({"id": uid, "tenant_id": tid})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") in ("admin", "owner"):
        admin_count = await db.users.count_documents({"tenant_id": tid, "role": {"$in": ["admin", "owner"]}})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last owner/admin")
    await db.users.delete_one({"id": uid, "tenant_id": tid})
    return {"ok": True}


@router.delete("/auth/me")
async def delete_own_account(user=Depends(get_current_user)):
    """Self-service account deletion (App Store review compliant).
    Owners cannot self-delete if they are the last admin; they should delete the tenant instead."""
    uid = user["id"]
    tid = user.get("tenant_id")
    if tid and user.get("role") in ("admin", "owner"):
        admin_count = await db.users.count_documents({"tenant_id": tid, "role": {"$in": ["admin", "owner"]}})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="You are the last owner. Please transfer ownership or contact support to delete your account.")
    await db.users.delete_one({"id": uid})
    return {"ok": True}


@router.post("/auth/users/{uid}/reset-password")
async def admin_reset_password(uid: str, body: PasswordReset, user=Depends(require_admin)):
    tid = tenant_id_of(user)
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    target = await db.users.find_one({"id": uid, "tenant_id": tid})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await db.users.update_one({"id": uid, "tenant_id": tid}, {"$set": {"password_hash": hash_password(body.new_password), "updated_at": now_iso()}})
    return {"ok": True}


@router.post("/auth/forgot-password")
async def forgot_password(body: ForgotPasswordReq):
    email = body.email.lower()
    target = await db.users.find_one({"email": email})
    if not target:
        return {"ok": True, "email_sent": False, "message": "If the email exists, a reset link is available."}
    token = str(uuid.uuid4()).replace("-", "")
    expires = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    await db.password_resets.insert_one({
        "token": token,
        "user_id": target["id"],
        "email": email,
        "expires_at": expires,
        "used": False,
        "created_at": now_iso(),
    })
    return {
        "ok": True,
        "email_sent": False,
        "reset_token": token,
        "expires_at": expires,
        "message": "Email not configured. Use the token below to reset your password within 1 hour.",
    }


@router.post("/auth/reset-password")
async def reset_password(body: ResetPasswordReq):
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    doc = await db.password_resets.find_one({"token": body.token})
    if not doc:
        raise HTTPException(status_code=400, detail="Invalid reset token")
    if doc.get("used"):
        raise HTTPException(status_code=400, detail="Token already used")
    try:
        exp = datetime.fromisoformat(doc["expires_at"])
        if datetime.now(timezone.utc) > exp:
            raise HTTPException(status_code=400, detail="Reset token expired")
    except HTTPException:
        raise
    except Exception:
        pass
    await db.users.update_one({"id": doc["user_id"]}, {"$set": {"password_hash": hash_password(body.new_password), "updated_at": now_iso()}})
    await db.password_resets.update_one({"token": body.token}, {"$set": {"used": True, "used_at": now_iso()}})
    return {"ok": True}


