"""Payments: Razorpay server-to-server webhook."""
from fastapi import APIRouter, HTTPException, Request
import hmac, hashlib, json

from core import db, now_iso, RAZORPAY_WEBHOOK_SECRET

# Activation helpers live in the branch/tenant sub-modules.
from routes.payments.branch import _activate_branch_from_order
from routes.payments.tenant import _activate_tenant_from_order

router = APIRouter()


@router.post("/razorpay/webhook")
async def razorpay_webhook(request: Request):
    """Server-to-server payment notification. Verify signature against raw body."""
    raw = await request.body()
    received = request.headers.get("x-razorpay-signature", "")
    if not RAZORPAY_WEBHOOK_SECRET:
        # Webhook secret not configured — reject to be safe
        raise HTTPException(status_code=503, detail="Webhook not configured")
    expected = hmac.new(RAZORPAY_WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")
    event_id = request.headers.get("x-razorpay-event-id") or ""
    if event_id:
        try:
            await db.processed_webhooks.insert_one({
                "event_id": event_id,
                "received_at": now_iso(),
            })
        except Exception:
            return {"ok": True, "duplicate": True}
    try:
        event = json.loads(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    kind = event.get("event")
    if kind in ("order.paid", "payment.captured"):
        payload = event.get("payload") or {}
        payment_entity = (payload.get("payment") or {}).get("entity") or {}
        order_id = payment_entity.get("order_id")
        payment_id = payment_entity.get("id")
        if not order_id:
            order_entity = (payload.get("order") or {}).get("entity") or {}
            order_id = order_entity.get("id")
        if order_id:
            order = await db.pending_orders.find_one({"razorpay_order_id": order_id})
            if order and order.get("status") != "paid":
                result = await db.pending_orders.update_one(
                    {"_id": order["_id"], "status": {"$ne": "paid"}},
                    {"$set": {"status": "paid", "payment_id": payment_id, "paid_at": now_iso()}},
                )
                if result.modified_count:
                    order["status"] = "paid"; order["payment_id"] = payment_id
                    if order.get("type") == "tenant_subscription":
                        await _activate_tenant_from_order(order)
                    else:
                        await _activate_branch_from_order(order)
    return {"ok": True}
