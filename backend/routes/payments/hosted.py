"""Payments: hosted Razorpay checkout HTML page (used by mobile WebView fallback)."""
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
import json

from core import db, RAZORPAY_KEY_ID

router = APIRouter()

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

