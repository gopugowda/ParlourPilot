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

# ============ Expenses ============
@router.get("/expenses/categories")
async def expense_categories(user=Depends(get_current_user_active)):
    return EXPENSE_CATEGORIES


@router.get("/expenses")
async def list_expenses(
    date: Optional[str] = None,
    month: Optional[str] = None,
    limit: int = 200,
    scope: BranchScope = Depends(branch_scope),
):
    query: dict = scope.filter()
    if scope.user.get("role") == "staff":
        query["date"] = today_str()
    elif date:
        query["date"] = date
    elif month:
        query["date"] = {"$regex": f"^{month}"}
    docs = await db.expenses.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return docs


@router.post("/expenses")
async def create_expense(body: ExpenseIn, scope: BranchScope = Depends(branch_scope_required)):
    if not (body.amount and body.amount > 0):
        raise HTTPException(status_code=400, detail="Amount must be > 0")
    if not body.description.strip():
        raise HTTPException(status_code=400, detail="Description required")
    cat = body.category if body.category in EXPENSE_CATEGORIES else "Other"
    d = body.date or today_str()
    doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": scope.tenant_id,
        "branch_id": scope.branch_id,
        "category": cat,
        "description": body.description.strip(),
        "amount": round(float(body.amount), 2),
        "date": d,
        "notes": body.notes or "",
        "created_by": scope.user["id"],
        "created_by_name": scope.user["name"],
        "created_at": now_iso(),
    }
    await db.expenses.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.put("/expenses/{eid}")
async def update_expense(eid: str, body: ExpenseIn, scope: BranchScope = Depends(branch_scope_admin)):
    if not (body.amount and body.amount > 0):
        raise HTTPException(status_code=400, detail="Amount must be > 0")
    cat = body.category if body.category in EXPENSE_CATEGORIES else "Other"
    result = await db.expenses.find_one_and_update(
        scope.filter({"id": eid}),
        {"$set": {
            "category": cat, "description": body.description.strip(),
            "amount": round(float(body.amount), 2),
            "date": body.date or today_str(),
            "notes": body.notes or "",
        }},
        return_document=True, projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Expense not found")
    return result


@router.delete("/expenses/{eid}")
async def delete_expense(eid: str, scope: BranchScope = Depends(branch_scope_admin)):
    result = await db.expenses.delete_one(scope.filter({"id": eid}))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


