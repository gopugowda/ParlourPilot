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

# ---------- Branch subscription (Razorpay) ----------
# (Models & constants imported from core/models)


@router.get("/payments/config")
async def payments_config(user=Depends(get_current_user)):
    """Return non-secret Razorpay config so the client can open Checkout."""
    return {
        "enabled": razorpay_enabled(),
        "key_id": RAZORPAY_KEY_ID if razorpay_enabled() else "",
        "provider": "razorpay",
        "currency": "INR",
    }


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


# ============ Hosted Razorpay Checkout Page (for mobile WebView fallback) ============
@router.get("/pay/{order_id}", response_class=HTMLResponse)
async def hosted_checkout_page(order_id: str, request: Request):
    """Serves an HTML page that opens Razorpay Checkout for the given order.
    Used by mobile clients that cannot embed checkout.js directly. On success, the
    page POSTs to /branches/checkout/verify then redirects to a success URL that
    the app WebBrowser can detect and dismiss.
    Query params:
      token   - JWT for authenticated /verify call
      return  - URL to redirect to on completion (with ?status=paid or ?status=cancelled)
    """
    token = request.query_params.get("token", "")
    return_url = request.query_params.get("return", "")
    order = await db.pending_orders.find_one({"razorpay_order_id": order_id}, {"_id": 0})
    if not order:
        return HTMLResponse("<h3>Order not found</h3>", status_code=404)
    if not RAZORPAY_KEY_ID:
        return HTMLResponse("<h3>Payment gateway not configured</h3>", status_code=503)
    amount = order.get("amount_paise", 0)
    order_type = order.get("type") or "branch_subscription"
    verify_path = "/api/tenants/checkout/verify" if order_type == "tenant_subscription" else "/api/branches/checkout/verify"
    subject_label = "Salon subscription" if order_type == "tenant_subscription" else f"Branch {order.get('plan','')} subscription"
    html = f"""<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Complete Payment · ParlourPilot</title>
<style>
  body {{ font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #FDFCF9; color: #1A1A1A; text-align: center; padding: 32px; }}
  .card {{ background: #fff; padding: 24px; border-radius: 12px; max-width: 400px; margin: 40px auto; border: 1px solid #E8E5DA; }}
  h2 {{ color: #C42032; }}
  .btn {{ background: #C42032; color: #fff; border: 0; padding: 14px 28px; border-radius: 8px; font-size: 16px; font-weight: 700; cursor: pointer; }}
  .amount {{ font-size: 40px; font-weight: 900; color: #C42032; margin: 12px 0; }}
  .muted {{ color: #6B6862; font-size: 13px; }}
  .status {{ margin-top: 16px; }}
</style>
</head>
<body>
<div class="card">
  <h2>ParlourPilot</h2>
  <div class="muted">{subject_label}</div>
  <div class="amount">₹{amount/100:.0f}</div>
  <button class="btn" id="payBtn">Pay with Razorpay</button>
  <div class="status" id="status"></div>
</div>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
  const orderId  = {json.dumps(order_id)};
  const keyId    = {json.dumps(RAZORPAY_KEY_ID)};
  const amount   = {amount};
  const token    = {json.dumps(token)};
  const returnUrl = {json.dumps(return_url)};

  function setStatus(txt) {{ document.getElementById('status').innerText = txt; }}

  function finish(status, extra) {{
    if (returnUrl) {{
      const sep = returnUrl.indexOf('?') >= 0 ? '&' : '?';
      const q = new URLSearchParams({{ status, ...(extra || {{}}) }}).toString();
      window.location.href = returnUrl + sep + q;
    }}
  }}

  async function verify(res) {{
    setStatus('Verifying payment…');
    try {{
      const r = await fetch({json.dumps(verify_path)}, {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }},
        body: JSON.stringify(res),
      }});
      const data = await r.json();
      if (r.ok) {{ setStatus('✅ Payment successful. Returning to app…'); finish('paid', {{ payment_id: res.razorpay_payment_id }}); }}
      else {{ setStatus('❌ ' + (data.detail || 'Verification failed')); finish('failed', {{ error: data.detail || 'verify_failed' }}); }}
    }} catch (e) {{
      setStatus('Network error: ' + e.message);
      finish('failed', {{ error: 'network' }});
    }}
  }}

  function openCheckout() {{
    const options = {{
      key: keyId, amount: amount, currency: 'INR',
      order_id: orderId,
      name: 'ParlourPilot', description: 'Branch subscription',
      handler: verify,
      modal: {{ ondismiss: () => {{ setStatus('Payment cancelled'); finish('cancelled'); }} }},
      theme: {{ color: '#C42032' }},
    }};
    const rzp = new Razorpay(options);
    rzp.on('payment.failed', (r) => {{ setStatus('Payment failed: ' + (r.error && r.error.description || '')); finish('failed', {{ error: r.error && r.error.code }}); }});
    rzp.open();
  }}

  document.getElementById('payBtn').addEventListener('click', openCheckout);
  // Auto-open shortly after load
  setTimeout(openCheckout, 400);
</script>
</body>
</html>
"""
    return HTMLResponse(content=html)


# ============ Razorpay Webhook ============
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

