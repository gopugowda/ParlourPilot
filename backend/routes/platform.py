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

# ============ Platform Admin (SaaS-level) ============
@router.get("/platform/tenants")
async def platform_list_tenants(user=Depends(require_platform_admin)):
    docs = await db.tenants.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    for d in docs:
        d["subscription"] = tenant_status(d)
        d["user_count"] = await db.users.count_documents({"tenant_id": d["id"]})
        d["bills_count"] = await db.bills.count_documents({"tenant_id": d["id"]})
    return docs


@router.get("/platform/stats")
async def platform_stats(user=Depends(require_platform_admin)):
    tenant_count = await db.tenants.count_documents({})
    active = await db.tenants.count_documents({"is_active": True, "subscription_status": {"$in": ["active", "trialing"]}})
    expired = await db.tenants.count_documents({"subscription_status": "expired"})
    users = await db.users.count_documents({})
    bills = await db.bills.count_documents({})
    return {"tenants": tenant_count, "active_tenants": active, "expired_tenants": expired, "users": users, "bills": bills}


@router.put("/platform/tenants/{tid}")
async def platform_update_tenant(tid: str, body: TenantUpdate, user=Depends(require_platform_admin)):
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        tenant = await load_tenant(tid)
        return {"tenant": tenant}
    updates["updated_at"] = now_iso()
    tenant = await db.tenants.find_one_and_update({"id": tid}, {"$set": updates}, return_document=True, projection={"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {"tenant": tenant}


@router.post("/platform/tenants/{tid}/subscription")
async def platform_set_subscription(tid: str, body: PlatformSubscriptionUpdate, user=Depends(require_platform_admin)):
    tenant = await load_tenant(tid)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    updates: dict = {"updated_at": now_iso()}
    if body.subscription_status is not None:
        updates["subscription_status"] = body.subscription_status
    if body.subscription_plan is not None:
        updates["subscription_plan"] = body.subscription_plan
    if body.is_active is not None:
        updates["is_active"] = bool(body.is_active)
    if body.extend_days:
        current_end = tenant.get("subscription_end_date") or tenant.get("trial_end_date") or datetime.now(timezone.utc).isoformat()
        try:
            end_dt = datetime.fromisoformat(current_end.replace("Z", "+00:00"))
        except Exception:
            end_dt = datetime.now(timezone.utc)
        if end_dt < datetime.now(timezone.utc):
            end_dt = datetime.now(timezone.utc)
        new_end = end_dt + timedelta(days=body.extend_days)
        updates["subscription_end_date"] = new_end.isoformat()
        updates["subscription_status"] = updates.get("subscription_status", "active")
        if not tenant.get("subscription_start_date"):
            updates["subscription_start_date"] = datetime.now(timezone.utc).isoformat()
    await db.tenants.update_one({"id": tid}, {"$set": updates})
    # Record in subscription history for audit
    try:
        history_entry = {
            "id": str(uuid.uuid4()),
            "tenant_id": tid,
            "action": "subscription_updated",
            "actor_id": user.get("id"),
            "actor_email": user.get("email"),
            "extend_days": body.extend_days,
            "subscription_status": updates.get("subscription_status"),
            "subscription_plan": updates.get("subscription_plan"),
            "is_active": updates.get("is_active"),
            "subscription_end_date": updates.get("subscription_end_date"),
            "created_at": now_iso(),
        }
        await db.subscription_history.insert_one(history_entry)
    except Exception as e:
        logger.warning(f"Failed to log subscription history: {e}")
    tenant2 = await load_tenant(tid)
    return {"tenant": tenant2, "subscription": tenant_status(tenant2)}


# ============ Seed (legacy demo API — still tenant-aware) ============
@router.post("/platform/tenants/{tid}/reset-password")
async def platform_reset_tenant_password(tid: str, body: dict = Body(...), user=Depends(require_platform_admin)):
    """Platform admin can reset ANY user's password within a tenant. Body: { user_id?, email?, new_password }."""
    new_password = (body or {}).get("new_password")
    user_id = (body or {}).get("user_id")
    email = (body or {}).get("email")
    if not new_password or len(str(new_password)) < 6:
        raise HTTPException(status_code=400, detail="new_password must be at least 6 characters")
    tenant = await load_tenant(tid)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    target = None
    if user_id:
        target = await db.users.find_one({"id": user_id, "tenant_id": tid})
    elif email:
        target = await db.users.find_one({"email": str(email).lower(), "tenant_id": tid})
    else:
        # default: reset the owner of the tenant
        target = await db.users.find_one({"tenant_id": tid, "role": {"$in": ["owner", "admin"]}}, sort=[("created_at", 1)])
    if not target:
        raise HTTPException(status_code=404, detail="User not found in tenant")
    await db.users.update_one(
        {"id": target["id"]},
        {"$set": {"password_hash": hash_password(str(new_password)), "updated_at": now_iso()}}
    )
    return {"ok": True, "user_id": target["id"], "email": target["email"], "role": target.get("role")}


@router.get("/platform/tenants/{tid}/users")
async def platform_list_tenant_users(tid: str, user=Depends(require_platform_admin)):
    tenant = await load_tenant(tid)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    users = await db.users.find(
        {"tenant_id": tid},
        {"_id": 0, "password_hash": 0}
    ).to_list(200)
    return {"users": users}


# ============ Detailed Tenant View (subscription history + branches) ============
@router.get("/platform/tenants/{tid}/detail")
async def platform_tenant_detail(tid: str, user=Depends(require_platform_admin)):
    """Full tenant details: business info, subscription history and all branches (with addresses)."""
    tenant = await load_tenant(tid)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # Branches (name, address, city, active, subscription info)
    branches = await db.branches.find({"tenant_id": tid}, {"_id": 0}).sort("is_head", -1).to_list(500)

    # Subscription history — synthesize from tenant record + audit log + branch payments
    history: List[dict] = []
    # 1) Trial start
    if tenant.get("trial_start_date"):
        history.append({
            "type": "trial_started",
            "date": tenant.get("trial_start_date"),
            "details": f"15-day free trial started (ends {tenant.get('trial_end_date', 'N/A')[:10] if tenant.get('trial_end_date') else 'N/A'})",
            "plan": "trial",
        })
    # 2) Any subscription_history audit entries
    audit = await db.subscription_history.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", 1).to_list(500)
    for a in audit:
        parts = []
        if a.get("extend_days"):
            parts.append(f"Extended by {a['extend_days']} days")
        if a.get("subscription_status"):
            parts.append(f"Status → {a['subscription_status']}")
        if a.get("subscription_plan"):
            parts.append(f"Plan → {a['subscription_plan']}")
        if a.get("is_active") is not None:
            parts.append("Activated" if a["is_active"] else "Suspended")
        if a.get("subscription_end_date"):
            parts.append(f"New end: {a['subscription_end_date'][:10]}")
        history.append({
            "type": a.get("action") or "subscription_updated",
            "date": a.get("created_at"),
            "details": ", ".join(parts) or "Subscription updated",
            "actor": a.get("actor_email"),
            "plan": a.get("subscription_plan"),
        })
    # 3) Branch subscription payments (mock)
    payments = await db.payments.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", 1).to_list(500)
    for p in payments:
        history.append({
            "type": "payment",
            "date": p.get("created_at"),
            "details": f"Branch subscription paid: {p.get('plan')} — ₹{p.get('amount_inr', 0):.0f} (ref: {p.get('payment_reference')})",
            "plan": p.get("plan"),
            "amount_inr": p.get("amount_inr"),
            "reference": p.get("payment_reference"),
        })
    # Sort history by date desc (newest first)
    history.sort(key=lambda x: x.get("date") or "", reverse=True)

    tenant_out = {k: v for k, v in tenant.items()}
    tenant_out["subscription"] = tenant_status(tenant)
    tenant_out["user_count"] = await db.users.count_documents({"tenant_id": tid})
    tenant_out["bills_count"] = await db.bills.count_documents({"tenant_id": tid})

    return {
        "tenant": tenant_out,
        "branches": branches,
        "subscription_history": history,
    }


# ============ Delete Tenant (SUPER admin only) ============
@router.delete("/platform/tenants/{tid}")
async def platform_delete_tenant(tid: str, user=Depends(require_platform_super)):
    """Hard-delete a tenant and ALL its data. Only super admin (platform_admin) can perform this."""
    tenant = await load_tenant(tid)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    # Safety: never allow deleting the seed tenant via API
    if tid == "glowup-tenant-0001":
        raise HTTPException(status_code=400, detail="The seed demo tenant cannot be deleted via API")

    collections_to_purge = [
        "users", "branches", "bills", "beauticians", "services", "members",
        "expenses", "stock_items", "stock_movements", "cash_closings",
        "appointments", "payments", "subscription_history",
    ]
    deleted: Dict[str, int] = {}
    for col in collections_to_purge:
        try:
            res = await db[col].delete_many({"tenant_id": tid})
            deleted[col] = res.deleted_count
        except Exception as e:
            logger.warning(f"Delete tenant {tid}: failed to purge {col}: {e}")
    # Finally delete the tenant record itself
    res = await db.tenants.delete_one({"id": tid})
    deleted["tenants"] = res.deleted_count
    logger.info(f"Platform admin {user.get('email')} deleted tenant {tid}. Purged: {deleted}")
    return {"ok": True, "deleted": deleted}


# ============ CSV Export ============
@router.get("/platform/tenants/export")
async def platform_export_tenants_csv(user=Depends(require_platform_admin)):
    """Return CSV data of all tenants with contact info + branch count.
    Returned as JSON { csv, filename } for cross-platform (web + native) download."""
    docs = await db.tenants.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "Business Name", "Owner Name", "Email", "Phone", "City", "Country",
        "Status", "Plan", "Trial End", "Subscription End", "Days Left",
        "Is Active", "Total Branches", "Users", "Bills", "Created At",
    ])
    for d in docs:
        tid = d.get("id")
        n_branches = await db.branches.count_documents({"tenant_id": tid})
        n_users = await db.users.count_documents({"tenant_id": tid})
        n_bills = await db.bills.count_documents({"tenant_id": tid})
        st = tenant_status(d)
        writer.writerow([
            d.get("business_name", ""),
            d.get("owner_name", ""),
            d.get("email", ""),
            d.get("phone", ""),
            d.get("city", ""),
            d.get("country", ""),
            st.get("status", ""),
            st.get("subscription_plan", ""),
            (d.get("trial_end_date") or "")[:10],
            (d.get("subscription_end_date") or "")[:10],
            st.get("days_left", ""),
            "Yes" if d.get("is_active", True) else "No",
            n_branches,
            n_users,
            n_bills,
            (d.get("created_at") or "")[:10],
        ])
    csv_text = buf.getvalue()
    fname = f"parlourpilot_tenants_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    return {"csv": csv_text, "filename": fname, "count": len(docs)}


# ============ Platform User Management (super admin only) ============


@router.get("/platform/users")
async def list_platform_users(user=Depends(require_platform_admin)):
    """List platform admin/staff users. Both platform_admin & platform_staff can view."""
    docs = await db.users.find(
        {"role": {"$in": ["platform_admin", "platform_staff"]}},
        {"_id": 0, "password_hash": 0},
    ).sort("created_at", 1).to_list(200)
    return {"users": docs}


@router.post("/platform/users")
async def create_platform_user(body: PlatformUserCreate, user=Depends(require_platform_super)):
    email = body.email.lower().strip()
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": None,
        "branch_id": None,
        "name": body.name.strip(),
        "email": email,
        "password_hash": hash_password(body.password),
        "role": body.role,
        "is_active": True,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.users.insert_one(doc)
    return {k: v for k, v in doc.items() if k not in ("_id", "password_hash")}


@router.put("/platform/users/{uid}")
async def update_platform_user(uid: str, body: PlatformUserUpdate, user=Depends(require_platform_super)):
    target = await db.users.find_one({"id": uid, "role": {"$in": ["platform_admin", "platform_staff"]}})
    if not target:
        raise HTTPException(status_code=404, detail="Platform user not found")
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.role is not None:
        # Prevent demoting the last platform_admin
        if target.get("role") == "platform_admin" and body.role == "platform_staff":
            admin_count = await db.users.count_documents({"role": "platform_admin", "is_active": True})
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot demote the last platform_admin")
        updates["role"] = body.role
    if body.is_active is not None:
        # Prevent deactivating the last platform_admin
        if target.get("role") == "platform_admin" and body.is_active is False:
            admin_count = await db.users.count_documents({"role": "platform_admin", "is_active": True})
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot deactivate the last platform_admin")
        updates["is_active"] = bool(body.is_active)
    if not updates:
        return {k: v for k, v in target.items() if k not in ("_id", "password_hash")}
    updates["updated_at"] = now_iso()
    result = await db.users.find_one_and_update(
        {"id": uid}, {"$set": updates},
        return_document=True, projection={"_id": 0, "password_hash": 0},
    )
    return result


@router.delete("/platform/users/{uid}")
async def delete_platform_user(uid: str, user=Depends(require_platform_super)):
    if uid == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    target = await db.users.find_one({"id": uid, "role": {"$in": ["platform_admin", "platform_staff"]}})
    if not target:
        raise HTTPException(status_code=404, detail="Platform user not found")
    if target.get("role") == "platform_admin":
        admin_count = await db.users.count_documents({"role": "platform_admin", "is_active": True})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last platform_admin")
    await db.users.delete_one({"id": uid})
    return {"ok": True}


@router.post("/platform/users/{uid}/reset-password")
async def reset_platform_user_password(uid: str, body: dict = Body(...), user=Depends(require_platform_super)):
    new_password = (body or {}).get("new_password")
    if not new_password or len(str(new_password)) < 6:
        raise HTTPException(status_code=400, detail="new_password must be at least 6 characters")
    target = await db.users.find_one({"id": uid, "role": {"$in": ["platform_admin", "platform_staff"]}})
    if not target:
        raise HTTPException(status_code=404, detail="Platform user not found")
    await db.users.update_one(
        {"id": uid}, {"$set": {"password_hash": hash_password(str(new_password)), "updated_at": now_iso()}}
    )
    return {"ok": True, "email": target["email"]}


