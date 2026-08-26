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

@router.get("/pricing")
async def get_pricing(user=Depends(get_current_user)):
    """Return SaaS pricing table (in INR). Frontend converts to user's preferred currency."""
    return {
        "currency_base": "INR",
        "tenant": TENANT_PLAN_PRICES_INR,
        "branch": BRANCH_PLAN_PRICES_INR,
    }


# ---------- Appointments (scheduling) ----------
def _end_from_start(start_iso: str, duration_min: int) -> str:
    try:
        dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid scheduled_start format (ISO 8601 expected)")
    return (dt + timedelta(minutes=int(duration_min or 60))).isoformat()


@router.get("/appointments")
async def list_appointments(
    scope: BranchScope = Depends(branch_scope),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    status_filter: Optional[str] = None,
    beautician_id: Optional[str] = None,
    limit: int = 200,
):
    """List appointments for the current tenant/branch. Supports date range filtering."""
    q = scope.filter()
    if date_from or date_to:
        rng: dict = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to
        q["scheduled_start"] = rng
    if status_filter:
        q["status"] = status_filter
    if beautician_id:
        q["beautician_id"] = beautician_id
    docs = await db.appointments.find(q, {"_id": 0}).sort("scheduled_start", 1).to_list(int(limit))
    return docs


@router.post("/appointments")
async def create_appointment(body: AppointmentIn, scope: BranchScope = Depends(branch_scope_required)):
    """Both admin and staff can create appointments."""
    if not body.customer_name.strip():
        raise HTTPException(status_code=400, detail="Customer name required")
    end_iso = _end_from_start(body.scheduled_start, body.duration_minutes or 60)
    doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": scope.tenant_id,
        "branch_id": scope.branch_id,
        "customer_name": body.customer_name.strip(),
        "customer_phone": (body.customer_phone or "").strip(),
        "member_id": body.member_id,
        "beautician_id": body.beautician_id,
        "beautician_name": body.beautician_name or "",
        "service_ids": body.service_ids or [],
        "service_names": body.service_names or [],
        "scheduled_start": body.scheduled_start,
        "duration_minutes": int(body.duration_minutes or 60),
        "scheduled_end": end_iso,
        "status": body.status or "booked",
        "notes": body.notes or "",
        "price_estimate": float(body.price_estimate or 0),
        "created_by": scope.user.get("id"),
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.appointments.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.put("/appointments/{apt_id}")
async def update_appointment(apt_id: str, body: AppointmentIn, scope: BranchScope = Depends(branch_scope)):
    """Both admin and staff can modify appointments."""
    q = scope.filter({"id": apt_id})
    updates: dict = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    if "scheduled_start" in updates or "duration_minutes" in updates:
        start = updates.get("scheduled_start")
        if not start:
            existing = await db.appointments.find_one(q, {"scheduled_start": 1})
            start = existing.get("scheduled_start") if existing else None
        dur = int(updates.get("duration_minutes") or 60)
        if start:
            updates["scheduled_end"] = _end_from_start(start, dur)
    updates["updated_at"] = now_iso()
    result = await db.appointments.find_one_and_update(
        q, {"$set": updates}, return_document=True, projection={"_id": 0}
    )
    if not result:
        raise HTTPException(status_code=404, detail="Appointment not found")
    return result


@router.delete("/appointments/{apt_id}")
async def delete_appointment(apt_id: str, scope: BranchScope = Depends(branch_scope)):
    q = scope.filter({"id": apt_id})
    res = await db.appointments.delete_one(q)
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Appointment not found")
    return {"ok": True}


@router.get("/appointments/stats")
async def appointment_stats(scope: BranchScope = Depends(branch_scope)):
    """Today & week counts + upcoming preview for dashboard.

    - Uses the salon's local timezone (tenant.timezone, defaults Asia/Kolkata)
      so an appointment scheduled for "today 6pm local" isn't spilled into the
      next UTC day.
    - Excludes cancelled / deleted / completed appointments — those aren't
      "upcoming activity" the salon needs to prepare for.
    """
    # 1) Resolve the salon's local timezone.
    try:
        from zoneinfo import ZoneInfo  # type: ignore
        tenant = await load_tenant(scope.tenant_id)
        tz_name = (tenant or {}).get("timezone") or "Asia/Kolkata"
        tz = ZoneInfo(tz_name)
    except Exception:
        # Fallback: fixed +05:30 (IST) — matches the app's primary market.
        tz = timezone(timedelta(hours=5, minutes=30))

    # 2) Compute today's window in the salon's local tz, then convert to UTC
    #    since scheduled_start is stored as an ISO-8601 UTC-ish string.
    now_local = datetime.now(tz)
    today_start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end_local = today_start_local + timedelta(days=1)
    week_end_local = today_start_local + timedelta(days=7)

    today_start_utc = today_start_local.astimezone(timezone.utc)
    today_end_utc = today_end_local.astimezone(timezone.utc)
    week_end_utc = week_end_local.astimezone(timezone.utc)

    # 3) Status filter — exclude cancelled / deleted / completed / no_show.
    ACTIVE_STATUSES = ["booked", "confirmed", "in_progress"]

    q_today = scope.filter({
        "scheduled_start": {"$gte": today_start_utc.isoformat(), "$lt": today_end_utc.isoformat()},
        "status": {"$in": ACTIVE_STATUSES},
    })
    q_week = scope.filter({
        "scheduled_start": {"$gte": today_start_utc.isoformat(), "$lt": week_end_utc.isoformat()},
        "status": {"$in": ACTIVE_STATUSES},
    })
    today_count = await db.appointments.count_documents(q_today)
    week_count = await db.appointments.count_documents(q_week)

    upcoming = await db.appointments.find(
        scope.filter({
            "scheduled_start": {"$gte": datetime.now(timezone.utc).isoformat()},
            "status": {"$in": ACTIVE_STATUSES},
        }),
        {"_id": 0},
    ).sort("scheduled_start", 1).to_list(5)
    return {"today": today_count, "week": week_count, "upcoming": upcoming}


