"""Payments: tenant subscription renewal — Razorpay order creation, signature verification, and subscription extension."""
from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timezone, timedelta
import uuid, hmac, hashlib

from core import (
    db, logger, now_iso, tenant_id_of, load_tenant, tenant_status,
    require_admin, get_razorpay, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
    TENANT_PLAN_PAISE,
)
from models import TenantCheckoutBody, VerifyPaymentBody

router = APIRouter()

# ============ Tenant Subscription Renewal (Razorpay) ============


@router.post("/tenants/checkout/order")
async def tenant_checkout_create_order(body: TenantCheckoutBody, user=Depends(require_admin)):
    """Create a Razorpay order for renewing/activating the tenant subscription.
    NOTE: uses require_admin (not require_admin_active) so expired tenants can pay to renew."""
    tid = tenant_id_of(user)
    tenant = await load_tenant(tid)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if body.plan not in ("monthly", "yearly"):
        raise HTTPException(status_code=400, detail="Invalid plan")
    amount = TENANT_PLAN_PAISE[body.plan]
    client = get_razorpay()
    receipt = f"tn_{tid[:8]}_{int(datetime.now(timezone.utc).timestamp())}"[:40]
    try:
        order = client.order.create(data={
            "amount": amount,
            "currency": "INR",
            "receipt": receipt,
            "notes": {
                "tenant_id": tid,
                "user_id": user["id"],
                "plan": body.plan,
                "type": "tenant_subscription",
            },
        })
    except Exception as e:
        logger.error(f"Razorpay tenant order create failed: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"Payment gateway error: {str(e)[:200]}")

    await db.pending_orders.insert_one({
        "id": str(uuid.uuid4()),
        "razorpay_order_id": order["id"],
        "tenant_id": tid,
        "user_id": user["id"],
        "type": "tenant_subscription",
        "plan": body.plan,
        "amount_paise": amount,
        "amount_inr": amount / 100.0,
        "currency": "INR",
        "display_amount": body.display_amount,
        "display_currency": body.display_currency,
        "status": "created",
        "payment_id": None,
        "signature": None,
        "created_at": now_iso(),
        "paid_at": None,
    })
    return {
        "key_id": RAZORPAY_KEY_ID,
        "order_id": order["id"],
        "amount": amount,
        "currency": "INR",
        "name": "ParlourPilot",
        "description": f"Salon {body.plan} subscription — {tenant.get('business_name','')}",
        "receipt": receipt,
    }


async def _activate_tenant_from_order(order: dict) -> dict:
    """Extend the tenant subscription based on paid order. Idempotent."""
    tid = order["tenant_id"]
    tenant = await load_tenant(tid)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    plan = order["plan"]
    now = datetime.now(timezone.utc)
    # Extend from current end if in future, else from now
    current_end = tenant.get("subscription_end_date") or tenant.get("trial_end_date")
    start_dt = now
    if current_end:
        try:
            end_dt = datetime.fromisoformat(current_end.replace("Z", "+00:00"))
            if end_dt > now:
                start_dt = end_dt
        except Exception:
            pass
    delta = timedelta(days=365) if plan == "yearly" else timedelta(days=30)
    new_end = start_dt + delta
    updates = {
        "subscription_status": "active",
        "subscription_plan": plan,
        "subscription_start_date": tenant.get("subscription_start_date") or now.isoformat(),
        "subscription_end_date": new_end.isoformat(),
        "is_active": True,
        "updated_at": now_iso(),
    }
    await db.tenants.update_one({"id": tid}, {"$set": updates})
    # Payment audit
    await db.payments.insert_one({
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "branch_id": None,
        "type": "tenant_subscription",
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
    # Subscription history audit
    try:
        await db.subscription_history.insert_one({
            "id": str(uuid.uuid4()),
            "tenant_id": tid,
            "action": "tenant_renewed",
            "actor_id": order.get("user_id"),
            "actor_email": None,
            "extend_days": (365 if plan == "yearly" else 30),
            "subscription_status": "active",
            "subscription_plan": plan,
            "is_active": True,
            "subscription_end_date": new_end.isoformat(),
            "created_at": now_iso(),
        })
    except Exception:
        pass
    tenant2 = await load_tenant(tid)
    return tenant2


@router.post("/tenants/checkout/verify")
async def tenant_checkout_verify(body: VerifyPaymentBody, user=Depends(require_admin)):
    tid = tenant_id_of(user)
    order = await db.pending_orders.find_one({
        "razorpay_order_id": body.razorpay_order_id,
        "user_id": user["id"],
        "tenant_id": tid,
        "type": "tenant_subscription",
    })
    if not order:
        raise HTTPException(status_code=404, detail="Unknown order")
    if order.get("status") == "paid":
        tenant = await load_tenant(tid)
        return {"ok": True, "status": "paid", "tenant": tenant, "subscription": tenant_status(tenant), "idempotent": True}

    expected = hmac.new(
        RAZORPAY_KEY_SECRET.encode(),
        f'{order["razorpay_order_id"]}|{body.razorpay_payment_id}'.encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, body.razorpay_signature):
        raise HTTPException(status_code=400, detail="Invalid payment signature")

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
        order["status"] = "paid"; order["payment_id"] = body.razorpay_payment_id
    tenant = await _activate_tenant_from_order(order)
    return {"ok": True, "status": "paid", "tenant": tenant, "subscription": tenant_status(tenant)}

