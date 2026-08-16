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
    require_admin_active, require_owner, compute_is_owner, require_platform_admin,
    require_platform_super,
    tenant_id_of, tq, bq_from, resolve_branch_id, load_tenant, tenant_status,
    check_subscription, BranchScope, branch_scope, branch_scope_required,
    branch_scope_admin, apply_member_discount, compute_bill_totals,
    resolve_member_discount, bill_payment_split,
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

# ============ Bills ============
async def _next_bill_number(tid: str, branch_id: Optional[str], prefix_override: Optional[str] = None) -> str:
    now = datetime.now(timezone.utc)
    date_prefix = now.strftime("%Y%m%d")
    q: dict = {"tenant_id": tid, "bill_no": {"$regex": f".*{date_prefix}"}}
    if branch_id:
        q["branch_id"] = branch_id
    count = await db.bills.count_documents(q)
    inv_prefix = (prefix_override or "").strip()
    if inv_prefix:
        return f"{inv_prefix}-{date_prefix}-{count + 1:04d}"
    return f"{date_prefix}-{count + 1:04d}"


async def _enrich_items_with_service_gender(items: list, tid: str) -> None:
    """
    Ensure every bill line carries `service_gender` so downstream reports (Type Revenue
    Split) don't have to join back to the services collection. Client may already send
    the correct value; if a line has service_id but no gender we look it up server-side.
    """
    missing_ids = list({(it.get("service_id") or "") for it in items if it.get("service_id") and not it.get("service_gender")})
    lookup: dict = {}
    if missing_ids:
        cursor = db.services.find({"tenant_id": tid, "id": {"$in": missing_ids}}, {"_id": 0, "id": 1, "gender": 1})
        async for svc in cursor:
            lookup[svc.get("id")] = (svc.get("gender") or "unisex").lower()
    for it in items:
        g = it.get("service_gender")
        if not g and it.get("service_id"):
            g = lookup.get(it["service_id"])
        it["service_gender"] = (g or "unisex").lower()


@router.post("/bills")
async def create_bill(body: BillCreate, scope: BranchScope = Depends(branch_scope_required)):
    if not body.items:
        raise HTTPException(status_code=400, detail="At least one service required")
    tid = scope.tenant_id
    tenant = await load_tenant(tid)
    branch = await db.branches.find_one({"id": scope.branch_id, "tenant_id": tid}, {"_id": 0}) if scope.branch_id else None

    # Resolve member discount override (explicit % > tier % > tenant/default).
    disc_override, min_price_override = await resolve_member_discount(
        tenant, tid, (body.customer_phone or "").strip() or None, bool(body.is_member),
    )

    items_eff = apply_member_discount(
        body.items, body.is_member, tenant, disc_override, min_price_override,
    )
    await _enrich_items_with_service_gender(items_eff, tid)
    subtotal, discount, services_net, tax_total = compute_bill_totals(items_eff)

    # Tips (per-line + bill-level). tip_via ∈ {cash, qr, card}.
    line_tip_total = sum(float(it.get("tip_amount", 0) or 0) for it in items_eff)
    line_tip_qr = sum(float(it.get("tip_amount", 0) or 0) for it in items_eff if it.get("tip_via") == "qr")
    line_tip_card = sum(float(it.get("tip_amount", 0) or 0) for it in items_eff if it.get("tip_via") == "card")

    tip_amount_in = round(max(0.0, float(body.tip_amount or 0)), 2)
    tip_via = body.tip_via if tip_amount_in > 0 else None
    if tip_amount_in > 0 and tip_via not in ("cash", "qr", "card"):
        raise HTTPException(status_code=400, detail="tip_via required when tip_amount > 0")

    total_tip_amount = round(tip_amount_in + line_tip_total, 2)
    total_tip_qr = round((tip_amount_in if tip_via == "qr" else 0) + line_tip_qr, 2)
    total_tip_card = round((tip_amount_in if tip_via == "card" else 0) + line_tip_card, 2)
    total_tip_owed = round(total_tip_qr + total_tip_card, 2)
    total_tip_cash = round(total_tip_amount - total_tip_owed, 2)

    # grand_total INCLUDES tips (payment split must cover the grand total).
    grand_total = round(services_net + tax_total + total_tip_amount, 2)

    if body.payment_mode == "cash":
        cash_amt, qr_amt, card_amt = grand_total, 0.0, 0.0
    elif body.payment_mode == "qr":
        cash_amt, qr_amt, card_amt = 0.0, grand_total, 0.0
    elif body.payment_mode == "card":
        cash_amt, qr_amt, card_amt = 0.0, 0.0, grand_total
    elif body.payment_mode == "split":
        cash_amt = round(float(body.cash_amount or 0), 2)
        qr_amt = round(float(body.qr_amount or 0), 2)
        card_amt = round(float(body.card_amount or 0), 2)
        if abs((cash_amt + qr_amt + card_amt) - grand_total) > 0.01:
            raise HTTPException(status_code=400, detail=f"Split amounts must total {grand_total}")
    else:
        raise HTTPException(status_code=400, detail="Invalid payment_mode")

    # Prefer branch-level invoice prefix, then tenant
    inv_prefix = (branch or {}).get("invoice_prefix") or (tenant or {}).get("invoice_prefix") or ""
    bill = {
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "branch_id": scope.branch_id,
        "bill_no": await _next_bill_number(tid, scope.branch_id, inv_prefix),
        "customer_name": body.customer_name or "Walk-in",
        "customer_phone": body.customer_phone or "",
        "items": items_eff,
        "subtotal": subtotal,
        "discount": discount,
        "tax_amount": tax_total,
        "services_net": services_net,
        "is_member": bool(body.is_member),
        "member_discount_pct_applied": disc_override,
        "tip_amount": total_tip_amount,
        "tip_via": tip_via,
        "tip_beautician_id": body.tip_beautician_id if tip_amount_in > 0 else None,
        "tip_beautician_name": (body.tip_beautician_name or "") if tip_amount_in > 0 else "",
        "tip_cash_total": total_tip_cash,
        "tip_qr_total": total_tip_qr,
        "tip_card_total": total_tip_card,
        "tip_owed_total": total_tip_owed,
        "grand_total": grand_total,
        "payment_mode": body.payment_mode,
        "cash_amount": cash_amt,
        "qr_amount": qr_amt,
        "card_amount": card_amt,
        "split_v2": True,
        "notes": body.notes or "",
        "created_by": scope.user["id"],
        "created_by_name": scope.user["name"],
        "created_at": now_iso(),
    }
    await db.bills.insert_one(bill)
    return {k: v for k, v in bill.items() if k != "_id"}


@router.get("/bills")
async def list_bills(
    limit: int = 100,
    date: Optional[str] = None,
    payment_mode: Optional[str] = None,
    scope: BranchScope = Depends(branch_scope),
):
    query: dict = scope.filter()
    # Staff can only see their OWN bills across time (spec §1).
    if scope.user.get("role") == "staff":
        query["created_by"] = scope.user["id"]
    if date:
        query["created_at"] = {"$gte": f"{date}T00:00:00", "$lt": f"{date}T23:59:59.999999+00:00"}
    if payment_mode and payment_mode != "all":
        query["payment_mode"] = payment_mode
    docs = await db.bills.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return docs


@router.put("/bills/{bid}")
async def update_bill(bid: str, body: BillCreate, scope: BranchScope = Depends(branch_scope_admin)):
    tid = scope.tenant_id
    tenant = await load_tenant(tid)
    existing = await db.bills.find_one(scope.filter({"id": bid}), {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Bill not found")
    if not body.items:
        raise HTTPException(status_code=400, detail="At least one service required")

    disc_override, min_price_override = await resolve_member_discount(
        tenant, tid, (body.customer_phone or "").strip() or None, bool(body.is_member),
    )

    items_eff = apply_member_discount(
        body.items, body.is_member, tenant, disc_override, min_price_override,
    )
    await _enrich_items_with_service_gender(items_eff, tid)
    subtotal, discount, services_net, tax_total = compute_bill_totals(items_eff)

    line_tip_total = sum(float(it.get("tip_amount", 0) or 0) for it in items_eff)
    line_tip_qr = sum(float(it.get("tip_amount", 0) or 0) for it in items_eff if it.get("tip_via") == "qr")
    line_tip_card = sum(float(it.get("tip_amount", 0) or 0) for it in items_eff if it.get("tip_via") == "card")

    tip_amount_in = round(max(0.0, float(body.tip_amount or 0)), 2)
    tip_via = body.tip_via if tip_amount_in > 0 else None
    if tip_amount_in > 0 and tip_via not in ("cash", "qr", "card"):
        raise HTTPException(status_code=400, detail="tip_via required when tip_amount > 0")

    total_tip_amount = round(tip_amount_in + line_tip_total, 2)
    total_tip_qr = round((tip_amount_in if tip_via == "qr" else 0) + line_tip_qr, 2)
    total_tip_card = round((tip_amount_in if tip_via == "card" else 0) + line_tip_card, 2)
    total_tip_owed = round(total_tip_qr + total_tip_card, 2)
    total_tip_cash = round(total_tip_amount - total_tip_owed, 2)

    grand_total = round(services_net + tax_total + total_tip_amount, 2)

    if body.payment_mode == "cash":
        cash_amt, qr_amt, card_amt = grand_total, 0.0, 0.0
    elif body.payment_mode == "qr":
        cash_amt, qr_amt, card_amt = 0.0, grand_total, 0.0
    elif body.payment_mode == "card":
        cash_amt, qr_amt, card_amt = 0.0, 0.0, grand_total
    elif body.payment_mode == "split":
        cash_amt = round(float(body.cash_amount or 0), 2)
        qr_amt = round(float(body.qr_amount or 0), 2)
        card_amt = round(float(body.card_amount or 0), 2)
        if abs((cash_amt + qr_amt + card_amt) - grand_total) > 0.01:
            raise HTTPException(status_code=400, detail=f"Split amounts must total {grand_total}")
    else:
        raise HTTPException(status_code=400, detail="Invalid payment_mode")

    update = {
        "customer_name": body.customer_name or existing.get("customer_name", "Walk-in"),
        "customer_phone": body.customer_phone or "",
        "items": items_eff,
        "subtotal": subtotal,
        "discount": discount,
        "tax_amount": tax_total,
        "services_net": services_net,
        "is_member": bool(body.is_member),
        "member_discount_pct_applied": disc_override,
        "tip_amount": total_tip_amount,
        "tip_via": tip_via,
        "tip_beautician_id": body.tip_beautician_id if tip_amount_in > 0 else None,
        "tip_beautician_name": (body.tip_beautician_name or "") if tip_amount_in > 0 else "",
        "tip_cash_total": total_tip_cash,
        "tip_qr_total": total_tip_qr,
        "tip_card_total": total_tip_card,
        "tip_owed_total": total_tip_owed,
        "grand_total": grand_total,
        "payment_mode": body.payment_mode,
        "cash_amount": cash_amt,
        "qr_amount": qr_amt,
        "card_amount": card_amt,
        "split_v2": True,
        "notes": body.notes or "",
        "edited_by": scope.user["id"],
        "edited_by_name": scope.user["name"],
        "edited_at": now_iso(),
    }
    # Append an edit-history entry (who/when).
    history_entry = {
        "edited_by": scope.user["id"],
        "edited_by_name": scope.user["name"],
        "edited_at": now_iso(),
    }
    result = await db.bills.find_one_and_update(
        scope.filter({"id": bid}),
        {"$set": update, "$push": {"edit_history": history_entry}},
        return_document=True, projection={"_id": 0},
    )
    return result


@router.get("/bills/{bid}")
async def get_bill(bid: str, scope: BranchScope = Depends(branch_scope)):
    doc = await db.bills.find_one(scope.filter({"id": bid}), {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Bill not found")
    # Staff can only view their own bills.
    if scope.user.get("role") == "staff" and doc.get("created_by") != scope.user["id"]:
        raise HTTPException(status_code=403, detail="You can only view your own bills")
    return doc


@router.delete("/bills/{bid}")
async def delete_bill(bid: str, user=Depends(require_owner), x_branch_id: Optional[str] = Header(default=None, alias="X-Branch-Id")):
    # Owner-only. Branch scoping used for safety.
    tid = tenant_id_of(user)
    bid_scope = await resolve_branch_id(user, x_branch_id, required=False)
    q: dict = {"id": bid, "tenant_id": tid}
    if bid_scope:
        q["branch_id"] = bid_scope
    result = await db.bills.delete_one(q)
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


class EmailInvoiceBody(BaseModel):
    email: EmailStr
    customer_name: Optional[str] = None


@router.post("/bills/{bid}/email")
async def email_invoice(bid: str, body: EmailInvoiceBody, scope: BranchScope = Depends(branch_scope)):
    """Email the invoice PDF-style receipt to a customer address.

    Best-effort: returns ok=False (200) if email delivery fails so the UI can
    surface a friendly message.
    """
    from mailer import send_email, render_invoice_email

    doc = await db.bills.find_one(scope.filter({"id": bid}), {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Bill not found")

    tenant = await load_tenant(scope.tenant_id)
    business_name = (tenant.get("business_name") if tenant else "") or "Your Salon"
    currency_symbol = "₹" if (tenant or {}).get("currency", "INR") == "INR" else "$"

    # Normalise line items for the template
    items = []
    for it in doc.get("items", []) or []:
        items.append({
            "name": it.get("service_name") or "Service",
            "price": float(it.get("total") or it.get("price") or 0),
        })

    date_str = (doc.get("created_at") or "")[:10]
    inv_no = doc.get("bill_no") or bid[:8]

    subtotal = float(doc.get("services_net") or doc.get("grand_total", 0) or 0)
    tax = float(doc.get("tax_amount") or 0)
    tip = float(doc.get("tip_amount") or 0)
    grand = float(doc.get("grand_total") or 0)

    html = render_invoice_email(
        customer_name=body.customer_name or doc.get("customer_name"),
        business_name=business_name,
        invoice_no=inv_no,
        date_str=date_str,
        items=items,
        subtotal=subtotal,
        tax=tax,
        tip=tip,
        grand_total=grand,
        currency_symbol=currency_symbol,
    )

    result = await send_email(
        to=str(body.email),
        subject=f"Invoice #{inv_no} from {business_name}",
        html=html,
        reply_to="support@parlourpilot.com",
    )
    if not result.get("ok"):
        # Return a friendly 200 so the frontend can display an inline message
        # rather than crashing with a red toast.
        return {"ok": False, "error": result.get("error", "delivery_failed"), "provider": result.get("provider")}
    return {"ok": True, "id": result.get("id"), "provider": result.get("provider")}



