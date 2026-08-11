"""Payments: branch subscription orders — Razorpay order creation, signature verification, and branch activation."""
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from datetime import datetime, timezone
import uuid, hmac, hashlib

from core import (
    db, logger, now_iso, tenant_id_of, require_admin_active,
    get_razorpay, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
    BRANCH_PLAN_PAISE, BRANCH_PLAN_PRICES_INR, _plan_end_iso,
)
from models import BranchCheckoutBody, VerifyPaymentBody

router = APIRouter()

async def _create_pending_order(tid: str, uid: str, plan: str, branch_payload: dict, display_amount: Optional[float], display_currency: Optional[str]) -> dict:
    """Create a Razorpay order + persist a pending payment record.
    The branch is NOT created here — only on payment verification (success)."""
    if plan not in ("monthly", "yearly"):
        raise HTTPException(status_code=400, detail="Invalid plan")
    amount = BRANCH_PLAN_PAISE[plan]  # paise
    client = get_razorpay()
    receipt = f"br_{uid[:8]}_{int(datetime.now(timezone.utc).timestamp())}"[:40]
    try:
        order = client.order.create(data={
            "amount": amount,
            "currency": "INR",
            "receipt": receipt,
            "notes": {
                "tenant_id": tid,
                "user_id": uid,
                "plan": plan,
                "type": "branch_subscription",
            },
        })
    except Exception as e:
        logger.error(f"Razorpay order create failed: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"Payment gateway error: {str(e)[:200]}")

    doc = {
        "id": str(uuid.uuid4()),
        "razorpay_order_id": order["id"],
        "tenant_id": tid,
        "user_id": uid,
        "type": "branch_subscription",
        "plan": plan,
        "amount_paise": amount,
        "amount_inr": amount / 100.0,
        "currency": "INR",
        "display_amount": display_amount,
        "display_currency": display_currency,
        "branch_payload": branch_payload,
        "status": "created",
        "payment_id": None,
        "signature": None,
        "created_at": now_iso(),
        "paid_at": None,
    }
    await db.pending_orders.insert_one(doc)
    return {
        "key_id": RAZORPAY_KEY_ID,
        "order_id": order["id"],
        "amount": amount,
        "currency": "INR",
        "name": "ParlourPilot",
        "description": f"Branch {plan} subscription",
        "receipt": receipt,
    }


@router.post("/branches/checkout/order")
async def branch_checkout_create_order(body: BranchCheckoutBody, user=Depends(require_admin_active)):
    """Create a Razorpay Order for adding a new branch. The branch is created only after payment success."""
    tid = tenant_id_of(user)
    if not body.branch.name.strip():
        raise HTTPException(status_code=400, detail="Branch name required")
    # Serialize branch payload for later creation
    branch_payload = {k: v for k, v in body.branch.model_dump().items() if v is not None}
    branch_payload["name"] = branch_payload.get("name", "").strip()
    return await _create_pending_order(
        tid=tid, uid=user["id"], plan=body.plan,
        branch_payload=branch_payload,
        display_amount=body.display_amount, display_currency=body.display_currency,
    )


async def _activate_branch_from_order(order: dict) -> dict:
    """Atomically create the branch + payment record from a paid order.
    Idempotent: if already activated, returns existing branch."""
    # Check if branch already created for this order
    existing = await db.branches.find_one({"razorpay_order_id": order["razorpay_order_id"]}, {"_id": 0})
    if existing:
        return existing
    plan = order["plan"]
    now = datetime.now(timezone.utc)
    end_iso = _plan_end_iso(plan)
    payload = order.get("branch_payload") or {}
    doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": order["tenant_id"],
        "razorpay_order_id": order["razorpay_order_id"],
        "razorpay_payment_id": order.get("payment_id"),
        "name": payload.get("name", "").strip() or "New Branch",
        "address": payload.get("address") or "",
        "city": payload.get("city") or "",
        "state": payload.get("state") or "",
        "country": payload.get("country") or "India",
        "postal_code": payload.get("postal_code") or "",
        "phone": payload.get("phone") or "",
        "email": payload.get("email") or "",
        "logo": payload.get("logo"),
        "tax_enabled": bool(payload.get("tax_enabled") or False),
        "tax_number": payload.get("tax_number") or "",
        "tax_percentage": float(payload.get("tax_percentage") or 0),
        "invoice_prefix": payload.get("invoice_prefix") or "",
        "receipt_header": payload.get("receipt_header") or "",
        "receipt_footer": payload.get("receipt_footer") or "",
        "is_head": False,
        "parent_branch_id": payload.get("parent_branch_id"),
        "active": True,
        "subscription_status": "active",
        "subscription_plan": plan,
        "subscription_start_date": now.isoformat(),
        "subscription_end_date": end_iso,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.branches.insert_one(doc)
    # Payment audit record
    await db.payments.insert_one({
        "id": str(uuid.uuid4()),
        "tenant_id": order["tenant_id"],
        "branch_id": doc["id"],
        "type": "branch_subscription",
        "plan": plan,
        "amount_inr": order.get("amount_inr", order.get("amount_paise", 0) / 100.0),
        "display_amount": order.get("display_amount"),
        "display_currency": order.get("display_currency"),
        "payment_reference": order.get("payment_id") or order["razorpay_order_id"],
        "razorpay_order_id": order["razorpay_order_id"],
        "razorpay_payment_id": order.get("payment_id"),
        "status": "success",
        "provider": "razorpay",
        "created_at": now_iso(),
    })
    return {k: v for k, v in doc.items() if k != "_id"}


@router.post("/branches/checkout/verify")
async def branch_checkout_verify(body: VerifyPaymentBody, user=Depends(require_admin_active)):
    """Verify Razorpay payment signature and activate the branch. Idempotent."""
    tid = tenant_id_of(user)
    order = await db.pending_orders.find_one({
        "razorpay_order_id": body.razorpay_order_id,
        "user_id": user["id"],
        "tenant_id": tid,
    })
    if not order:
        raise HTTPException(status_code=404, detail="Unknown order")

    # Idempotent success
    if order.get("status") == "paid":
        br = await db.branches.find_one({"razorpay_order_id": order["razorpay_order_id"]}, {"_id": 0})
        return {"ok": True, "status": "paid", "branch": br, "idempotent": True}

    # Verify signature: HMAC-SHA256 of "order_id|payment_id"
    expected = hmac.new(
        RAZORPAY_KEY_SECRET.encode(),
        f'{order["razorpay_order_id"]}|{body.razorpay_payment_id}'.encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, body.razorpay_signature):
        raise HTTPException(status_code=400, detail="Invalid payment signature")

    # Confirm with Razorpay
    client = get_razorpay()
    try:
        payment = client.payment.fetch(body.razorpay_payment_id)
    except Exception as e:
        logger.error(f"payment.fetch failed: {e}")
        raise HTTPException(status_code=502, detail="Could not verify payment with gateway")
    if payment.get("order_id") != order["razorpay_order_id"]:
        raise HTTPException(status_code=400, detail="Payment/order mismatch")
    if payment.get("status") not in ("captured", "authorized"):
        raise HTTPException(status_code=400, detail=f"Payment not successful (status={payment.get('status')})")

    # Mark order paid atomically
    result = await db.pending_orders.update_one(
        {"_id": order["_id"], "status": {"$ne": "paid"}},
        {"$set": {
            "status": "paid",
            "payment_id": body.razorpay_payment_id,
            "signature": body.razorpay_signature,
            "paid_at": now_iso(),
        }},
    )
    if result.modified_count:
        # Update in-memory copy with new fields for activation
        order["status"] = "paid"
        order["payment_id"] = body.razorpay_payment_id
    branch = await _activate_branch_from_order(order)
    return {"ok": True, "status": "paid", "branch": branch}


# Deprecated legacy mock endpoint — kept for backward compatibility during transition.
# New clients must use /branches/checkout/order + /branches/checkout/verify.
@router.post("/branches/checkout")
async def branch_checkout_legacy(body: BranchCheckoutBody, user=Depends(require_admin_active)):
    """[Deprecated] Mock payment. Prefer /checkout/order + /checkout/verify with Razorpay."""
    tid = tenant_id_of(user)
    if not body.branch.name.strip():
        raise HTTPException(status_code=400, detail="Branch name required")
    plan = body.plan
    now = datetime.now(timezone.utc)
    end_iso = _plan_end_iso(plan)
    payment_ref = f"MOCKPAY-{uuid.uuid4().hex[:12].upper()}"
    doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "name": body.branch.name.strip(),
        "address": body.branch.address or "",
        "city": body.branch.city or "",
        "state": body.branch.state or "",
        "country": body.branch.country or "India",
        "postal_code": body.branch.postal_code or "",
        "phone": body.branch.phone or "",
        "email": body.branch.email or "",
        "logo": body.branch.logo,
        "tax_enabled": bool(body.branch.tax_enabled),
        "tax_number": body.branch.tax_number or "",
        "tax_percentage": float(body.branch.tax_percentage or 0),
        "invoice_prefix": body.branch.invoice_prefix or "",
        "receipt_header": body.branch.receipt_header or "",
        "receipt_footer": body.branch.receipt_footer or "",
        "is_head": False,
        "parent_branch_id": body.branch.parent_branch_id,
        "active": True,
        "subscription_status": "active",
        "subscription_plan": plan,
        "subscription_start_date": now.isoformat(),
        "subscription_end_date": end_iso,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.branches.insert_one(doc)
    await db.payments.insert_one({
        "id": str(uuid.uuid4()),
        "tenant_id": tid, "branch_id": doc["id"], "type": "branch_subscription",
        "plan": plan,
        "amount_inr": float(BRANCH_PLAN_PRICES_INR[plan]),
        "display_amount": body.display_amount,
        "display_currency": body.display_currency,
        "payment_reference": payment_ref,
        "status": "success", "provider": "mock", "created_at": now_iso(),
    })
    return {
        "branch": {k: v for k, v in doc.items() if k != "_id"},
        "payment": {"reference": payment_ref, "amount_inr": float(BRANCH_PLAN_PRICES_INR[plan]), "plan": plan, "next_renewal": end_iso},
    }
