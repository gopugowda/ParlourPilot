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

# ============ Stock / Inventory ============
@router.get("/stock/units")
async def stock_units(user=Depends(get_current_user_active)):
    return STOCK_UNITS


@router.get("/stock")
async def list_stock(scope: BranchScope = Depends(branch_scope)):
    docs = await db.stock_items.find(scope.filter(), {"_id": 0}).sort("name", 1).to_list(500)
    for d in docs:
        d["low_stock"] = d.get("current_qty", 0) <= d.get("min_qty", 0)
    return docs


@router.get("/stock/low")
async def list_low_stock(scope: BranchScope = Depends(branch_scope)):
    docs = await db.stock_items.find(scope.filter(), {"_id": 0}).to_list(500)
    return [d for d in docs if d.get("current_qty", 0) <= d.get("min_qty", 0)]


@router.post("/stock")
async def create_stock(body: StockItemIn, scope: BranchScope = Depends(branch_scope_admin)):
    if await db.stock_items.find_one(scope.filter({"name": body.name.strip()})):
        raise HTTPException(status_code=400, detail="Item with this name already exists")
    doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": scope.tenant_id,
        "branch_id": scope.branch_id,
        "name": body.name.strip(),
        "unit": body.unit if body.unit in STOCK_UNITS else "piece",
        "current_qty": round(float(body.current_qty or 0), 2),
        "min_qty": round(float(body.min_qty or 0), 2),
        "unit_cost": round(float(body.unit_cost or 0), 2),
        "notes": body.notes or "",
        "created_at": now_iso(),
    }
    await db.stock_items.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@router.put("/stock/{sid}")
async def update_stock(sid: str, body: StockItemIn, scope: BranchScope = Depends(branch_scope_admin)):
    result = await db.stock_items.find_one_and_update(
        scope.filter({"id": sid}),
        {"$set": {
            "name": body.name.strip(),
            "unit": body.unit if body.unit in STOCK_UNITS else "piece",
            "current_qty": round(float(body.current_qty or 0), 2),
            "min_qty": round(float(body.min_qty or 0), 2),
            "unit_cost": round(float(body.unit_cost or 0), 2),
            "notes": body.notes or "",
        }},
        return_document=True, projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    return result


@router.delete("/stock/{sid}")
async def delete_stock(sid: str, scope: BranchScope = Depends(branch_scope_admin)):
    result = await db.stock_items.delete_one(scope.filter({"id": sid}))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    await db.stock_movements.delete_many(scope.filter({"item_id": sid}))
    return {"ok": True}


@router.post("/stock/movement")
async def create_stock_movement(body: StockMovementIn, scope: BranchScope = Depends(branch_scope_required)):
    tid = scope.tenant_id
    item = await db.stock_items.find_one(scope.filter({"id": body.item_id}), {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Stock item not found")
    if not (body.qty and body.qty > 0):
        raise HTTPException(status_code=400, detail="Qty must be > 0")

    if body.type == "purchase":
        new_qty = round(item["current_qty"] + body.qty, 2)
        unit_cost = round(float(body.unit_cost or item.get("unit_cost", 0) or 0), 2)
        total_cost = round(body.qty * unit_cost, 2)
    elif body.type == "use":
        new_qty = round(item["current_qty"] - body.qty, 2)
        unit_cost = 0
        total_cost = 0
    else:
        new_qty = round(float(body.qty), 2)
        unit_cost = 0
        total_cost = 0

    update = {"current_qty": new_qty}
    if body.type == "purchase" and unit_cost > 0:
        update["unit_cost"] = unit_cost
    await db.stock_items.update_one(scope.filter({"id": body.item_id}), {"$set": update})

    today = today_str()
    mv = {
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "branch_id": scope.branch_id,
        "item_id": body.item_id,
        "item_name": item["name"],
        "unit": item["unit"],
        "type": body.type,
        "qty": round(float(body.qty), 2),
        "unit_cost": unit_cost,
        "total_cost": total_cost,
        "resulting_qty": new_qty,
        "notes": body.notes or "",
        "date": today,
        "created_by": scope.user["id"],
        "created_by_name": scope.user["name"],
        "created_at": now_iso(),
    }
    await db.stock_movements.insert_one(mv)

    expense_created = None
    if body.type == "purchase" and total_cost > 0:
        exp = {
            "id": str(uuid.uuid4()),
            "tenant_id": tid,
            "branch_id": scope.branch_id,
            "category": "Material",
            "description": f"{item['name']} x{body.qty}{item['unit']}",
            "amount": total_cost,
            "date": today,
            "notes": f"Auto from stock purchase",
            "created_by": scope.user["id"],
            "created_by_name": scope.user["name"],
            "created_at": now_iso(),
            "stock_movement_id": mv["id"],
        }
        await db.expenses.insert_one(exp)
        expense_created = {k: v for k, v in exp.items() if k != "_id"}

    return {"movement": {k: v for k, v in mv.items() if k != "_id"}, "expense": expense_created, "new_qty": new_qty}


@router.get("/stock/{sid}/movements")
async def list_movements(sid: str, limit: int = 50, scope: BranchScope = Depends(branch_scope)):
    docs = await db.stock_movements.find(scope.filter({"item_id": sid}), {"_id": 0}).sort("created_at", -1).to_list(limit)
    return docs


