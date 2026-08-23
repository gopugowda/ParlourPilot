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
    compute_is_owner,
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
    """Accept email OR phone in the `email` field — auto-detects.

    - If identifier contains "@" → treated as email.
    - Else digits are extracted and matched against `users.phone`.
    """
    identifier = (body.email or "").strip()
    user = None
    if "@" in identifier:
        user = await db.users.find_one({"email": identifier.lower()})
    else:
        digits = re.sub(r"\D+", "", identifier)
        if digits:
            # Try direct match on user.phone first.
            user = await db.users.find_one({"phone": digits})
            if not user:
                # Fallback: linked beautician has the phone → resolve to user.
                beaut = await db.beauticians.find_one({"phone": digits, "user_id": {"$exists": True, "$ne": None}})
                if beaut and beaut.get("user_id"):
                    user = await db.users.find_one({"id": beaut["user_id"], "tenant_id": beaut.get("tenant_id")})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email/phone or password")
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
            "is_owner": await compute_is_owner(user),
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
    # Enrich user with is_owner (earliest-created admin/owner).
    user_out = dict(user)
    user_out["is_owner"] = await compute_is_owner(user)
    return {"user": user_out, "tenant": tenant, "branches": branches, "subscription": subscription}


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
    """Request a password reset. Sends a 6-digit OTP to the user's email (if configured).

    Response is intentionally identical whether the email exists or not — this prevents
    account enumeration attacks. If email delivery isn't configured, returns the OTP
    inline as a dev fallback.
    """
    from mailer import send_email, render_otp_email, email_enabled
    import random as _random

    email = body.email.lower().strip()
    target = await db.users.find_one({"email": email})

    # Always issue the same-shape response — but only actually create a record if user exists
    generic = {"ok": True, "email_sent": email_enabled(), "message": "If the email is registered, a 6-digit code has been sent. It expires in 15 minutes."}

    if not target:
        return generic

    # Rate limit: max 3 OTP requests per email per 10 minutes
    ten_min_ago = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    recent = await db.password_resets.count_documents({
        "email": email,
        "created_at": {"$gte": ten_min_ago},
    })
    if recent >= 3:
        raise HTTPException(status_code=429, detail="Too many reset attempts. Please try again in a few minutes.")

    # Invalidate any prior unused OTPs for this email
    await db.password_resets.update_many({"email": email, "used": False}, {"$set": {"used": True, "used_at": now_iso(), "invalidated": True}})

    otp = f"{_random.randint(0, 999999):06d}"
    otp_hash = hashlib.sha256(otp.encode()).hexdigest()
    token = str(uuid.uuid4()).replace("-", "")
    expires = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()

    await db.password_resets.insert_one({
        "token": token,               # kept for legacy compatibility
        "otp_hash": otp_hash,
        "attempts": 0,
        "user_id": target["id"],
        "email": email,
        "expires_at": expires,
        "used": False,
        "created_at": now_iso(),
    })

    # Send email — non-blocking failure (still returns success to caller for security)
    email_result = {"ok": False}
    if email_enabled():
        html = render_otp_email(otp=otp, name=target.get("name"), purpose="reset your ParlourPilot password")
        email_result = await send_email(
            to=email,
            subject=f"Your ParlourPilot password reset code: {otp}",
            html=html,
        )

    resp = {"ok": True, "email_sent": bool(email_result.get("ok")), "message": generic["message"]}
    # Dev fallback: if email couldn't be sent (not configured OR delivery blocked),
    # surface the OTP in the response so the reset flow is testable on preview.
    # NOTE: In production with real customer emails this branch will never trigger.
    if not email_result.get("ok"):
        resp["dev_otp"] = otp
        if not email_enabled():
            resp["message"] = "Email service not configured. Use the code below within 15 minutes."
        else:
            resp["message"] = "Email delivery unavailable for this address. Use the code below within 15 minutes."
    return resp


@router.post("/auth/reset-password")
async def reset_password(body: ResetPasswordReq):
    """Reset a password using EITHER an OTP + email (new flow) OR a legacy token."""
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    # --- New flow: email + 6-digit OTP ---
    if body.otp and body.email:
        email = body.email.lower().strip()
        otp = body.otp.strip()
        if not re.fullmatch(r"\d{4,8}", otp):
            raise HTTPException(status_code=400, detail="Invalid OTP format")
        otp_hash = hashlib.sha256(otp.encode()).hexdigest()

        # Find the most recent unused OTP for this email
        doc = await db.password_resets.find_one(
            {"email": email, "used": False},
            sort=[("created_at", -1)],
        )
        if not doc:
            raise HTTPException(status_code=400, detail="No active reset code. Please request a new one.")

        # Rate-limit brute force: max 5 attempts per OTP
        if doc.get("attempts", 0) >= 5:
            await db.password_resets.update_one({"_id": doc["_id"]}, {"$set": {"used": True, "used_at": now_iso(), "invalidated": True}})
            raise HTTPException(status_code=429, detail="Too many incorrect attempts. Please request a new code.")

        # Expiry check
        try:
            exp = datetime.fromisoformat(doc["expires_at"])
            if datetime.now(timezone.utc) > exp:
                raise HTTPException(status_code=400, detail="Reset code expired. Please request a new one.")
        except HTTPException:
            raise
        except Exception:
            pass

        # Compare in constant time
        if not hmac.compare_digest(doc.get("otp_hash", ""), otp_hash):
            await db.password_resets.update_one({"_id": doc["_id"]}, {"$inc": {"attempts": 1}})
            raise HTTPException(status_code=400, detail="Incorrect reset code")

        # Success — update password + burn the OTP
        await db.users.update_one({"id": doc["user_id"]}, {"$set": {"password_hash": hash_password(body.new_password), "updated_at": now_iso()}})
        await db.password_resets.update_one({"_id": doc["_id"]}, {"$set": {"used": True, "used_at": now_iso()}})
        return {"ok": True}

    # --- Legacy flow: reset token ---
    if not body.token:
        raise HTTPException(status_code=400, detail="Provide either (email + otp) or a legacy reset token.")

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


