"""
Email service — direct Resend SDK integration.

Primary sender: RESEND_FROM_EMAIL (e.g. support@parlourpilot.com) via
Resend API using RESEND_API_KEY. Falls back to the legacy Emergent-managed
proxy only if the direct Resend call fails AND the fallback key is present —
this keeps the flow resilient during DNS/domain-verification rollout.

Templates:
  - render_otp_email(...)      → password reset OTP
  - render_welcome_email(...)  → tenant registration alert
  - render_invoice_email(...)  → bill/invoice sharing with customer

Usage:
    from mailer import send_email, render_otp_email
    await send_email(to="user@example.com", subject="...", html="...")
"""
import os
import logging
import asyncio
from typing import Optional

import httpx  # kept for the Emergent proxy fallback path
import resend  # noqa: F401  (async wrapper below uses resend.Emails.send)
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# --- Primary: Resend SDK ---
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
RESEND_FROM_EMAIL = os.environ.get("RESEND_FROM_EMAIL", "support@parlourpilot.com")
RESEND_FROM_NAME = os.environ.get("RESEND_FROM_NAME", "ParlourPilot")

if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY

# --- Fallback: Emergent-managed proxy (legacy) ---
# Env-driven with playbook default so production can override if the integration host changes.
EMAIL_BASE_URL = os.environ.get("INTEGRATION_PROXY_URL", "https://integrations.emergentagent.com")
EMERGENT_EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", RESEND_FROM_NAME)


def email_enabled() -> bool:
    """True if either Resend or the Emergent fallback is configured."""
    return bool(RESEND_API_KEY) or bool(EMERGENT_EMAIL_KEY)


def _resend_from_field() -> str:
    """Build a `Name <email>` sender string (RFC 5322)."""
    if RESEND_FROM_NAME:
        return f"{RESEND_FROM_NAME} <{RESEND_FROM_EMAIL}>"
    return RESEND_FROM_EMAIL


async def _send_via_resend(to: str, subject: str, html: str, reply_to: Optional[str]) -> dict:
    """Direct call to Resend's REST API. Uses resend.Emails.send (sync SDK) on
    a worker thread to keep the FastAPI event loop non-blocking."""
    if not RESEND_API_KEY:
        return {"ok": False, "error": "resend_not_configured"}

    params = {
        "from": _resend_from_field(),
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if reply_to:
        params["reply_to"] = reply_to

    def _do_send():
        return resend.Emails.send(params)  # returns {"id": "..."} on success

    try:
        result = await asyncio.to_thread(_do_send)
        # Resend SDK raises on error; on success returns a dict with 'id'
        msg_id = result.get("id") if isinstance(result, dict) else None
        return {"ok": True, "id": msg_id, "provider": "resend"}
    except Exception as e:
        # Common Resend errors: 401 invalid_api_key, 403 domain not verified,
        # 422 validation_error, 429 rate_limited
        err = str(e)
        logger.error("Resend send failed to %s: %s", to, err[:500])
        return {"ok": False, "error": err[:300], "provider": "resend"}


async def _send_via_emergent(to: str, subject: str, html: str, reply_to: Optional[str]) -> dict:
    """Emergent-managed Resend proxy fallback."""
    if not EMERGENT_EMAIL_KEY:
        return {"ok": False, "error": "emergent_not_configured"}
    payload = {
        "to": [to],
        "subject": subject,
        "html": html,
        "from_name": EMAIL_FROM_NAME,
    }
    if reply_to:
        payload["contact_email"] = reply_to
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMERGENT_EMAIL_KEY},
                json=payload,
            )
        resp.raise_for_status()
        try:
            data = resp.json()
        except Exception:
            data = {}
        return {"ok": True, "id": data.get("id"), "provider": "emergent"}
    except httpx.HTTPStatusError as e:
        logger.error("Emergent fallback HTTP %s: %s", e.response.status_code, e.response.text[:300])
        return {"ok": False, "error": f"http_{e.response.status_code}", "provider": "emergent"}
    except Exception as e:
        logger.error("Emergent fallback error: %s", e)
        return {"ok": False, "error": str(e), "provider": "emergent"}


async def send_email(
    *,
    to: str,
    subject: str,
    html: str,
    reply_to: Optional[str] = None,
) -> dict:
    """Send an HTML email. Tries Resend first, falls back to Emergent proxy.

    Returns:
      {ok: bool, id?: str, provider: 'resend' | 'emergent', error?: str}
    Non-throwing — callers should check the returned `ok` flag.
    """
    if not email_enabled():
        logger.warning("No email provider configured — skipping send to %s", to)
        return {"ok": False, "error": "email_not_configured"}

    # Try Resend first
    if RESEND_API_KEY:
        result = await _send_via_resend(to, subject, html, reply_to)
        if result.get("ok"):
            return result
        # Only fall back for provider-side failures — not for genuine validation errors
        # that would fail on Emergent too.
        logger.info("Resend failed (%s), trying Emergent fallback", result.get("error", "")[:80])

    # Fallback
    return await _send_via_emergent(to, subject, html, reply_to)


# ============================================================
#                        HTML TEMPLATES
# ============================================================
BRAND_COLOR = "#C42032"


def _wrap(inner_html: str) -> str:
    """Common shell used by all templates. Table-based, inline CSS, no external assets."""
    return f"""<!doctype html>
<html>
<body style="margin:0;padding:0;background:#F5F2EA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1A1A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EA;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0"
             style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:{BRAND_COLOR};padding:20px 24px;text-align:center;color:#FFFFFF;">
            <div style="font-size:22px;font-weight:800;letter-spacing:0.5px;">ParlourPilot</div>
            <div style="font-size:11px;letter-spacing:2px;opacity:0.85;margin-top:2px;">SALON MANAGEMENT PLATFORM</div>
          </td>
        </tr>
        {inner_html}
        <tr>
          <td style="background:#FBF9F4;padding:14px 24px;text-align:center;font-size:11px;color:#6B6862;border-top:1px solid #E8E5DA;">
            © ParlourPilot · Sent from support@parlourpilot.com<br/>
            Need help? Just reply to this email.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


def render_otp_email(*, otp: str, name: Optional[str] = None, purpose: str = "reset your password") -> str:
    """OTP email for password-reset flow."""
    greeting = f"Hi {name}," if name else "Hi there,"
    inner = f"""
        <tr>
          <td style="padding:28px 28px 8px 28px;">
            <div style="font-size:15px;color:#1A1A1A;">{greeting}</div>
            <div style="font-size:14px;color:#4B4842;margin-top:8px;line-height:1.5;">
              Use the verification code below to {purpose}. This code will expire in <b>15 minutes</b>.
            </div>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:12px 28px 20px 28px;">
            <div style="display:inline-block;background:#FDF3E4;border:1px dashed #E8C87A;border-radius:10px;padding:16px 28px;">
              <div style="font-size:28px;font-weight:900;letter-spacing:8px;color:{BRAND_COLOR};font-family:Menlo,Consolas,monospace;">{otp}</div>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px 24px 28px;">
            <div style="font-size:12px;color:#6B6862;line-height:1.5;">
              If you didn't request this, you can safely ignore this email — your password will remain unchanged.
              For your security, never share this code with anyone.
            </div>
          </td>
        </tr>"""
    return _wrap(inner)


def render_welcome_email(*, business_name: str, owner_name: Optional[str], trial_days: int = 15) -> str:
    """Welcome / registration confirmation email sent when a tenant signs up."""
    greeting = f"Hi {owner_name}," if owner_name else "Hi there,"
    inner = f"""
        <tr>
          <td style="padding:28px 28px 8px 28px;">
            <div style="font-size:15px;color:#1A1A1A;">{greeting}</div>
            <div style="font-size:22px;font-weight:800;color:#1A1A1A;margin-top:8px;">Welcome to ParlourPilot! 🎉</div>
            <div style="font-size:14px;color:#4B4842;margin-top:8px;line-height:1.6;">
              Your salon <b style="color:{BRAND_COLOR};">{business_name}</b> is all set up. You're on a
              <b>{trial_days}-day free trial</b> with full access to every feature — no credit card required.
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 28px 20px 28px;">
            <div style="background:#FBF9F4;border:1px solid #E8E5DA;border-radius:8px;padding:16px;">
              <div style="font-size:13px;font-weight:700;color:{BRAND_COLOR};margin-bottom:8px;">GET STARTED IN 3 STEPS</div>
              <div style="font-size:13px;color:#1A1A1A;line-height:1.9;">
                <b>1.</b> Add your services & prices under <i>Manage → Services</i><br/>
                <b>2.</b> Add your beauticians/staff under <i>Manage → Beauticians</i><br/>
                <b>3.</b> Create your first bill from the <i>New Bill</i> tab
              </div>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:0 28px 24px 28px;">
            <div style="font-size:12px;color:#6B6862;line-height:1.5;">
              Questions? Just reply to this email — a human will get back to you.
            </div>
          </td>
        </tr>"""
    return _wrap(inner)


def render_invoice_email(
    *,
    customer_name: Optional[str],
    business_name: str,
    invoice_no: str,
    date_str: str,
    items: list,          # each: {"name": str, "price": float, "qty": int?}
    subtotal: float,
    tax: float,
    tip: float,
    grand_total: float,
    currency_symbol: str = "₹",
) -> str:
    """Invoice / bill email — sent to the customer with a formatted receipt."""
    greeting = f"Hi {customer_name}," if customer_name else "Hi there,"
    rows_html = ""
    for it in items:
        name = it.get("name") or it.get("service_name") or "Service"
        price = float(it.get("total", it.get("price", 0)) or 0)
        qty = it.get("qty") or 1
        qty_label = f" × {qty}" if qty and qty != 1 else ""
        rows_html += f"""
              <tr>
                <td style="padding:8px 0;font-size:13px;color:#1A1A1A;border-bottom:1px solid #F0EDE5;">{name}{qty_label}</td>
                <td style="padding:8px 0;font-size:13px;color:#1A1A1A;border-bottom:1px solid #F0EDE5;text-align:right;font-weight:600;">{currency_symbol}{price:,.2f}</td>
              </tr>"""

    inner = f"""
        <tr>
          <td style="padding:28px 28px 8px 28px;">
            <div style="font-size:15px;color:#1A1A1A;">{greeting}</div>
            <div style="font-size:14px;color:#4B4842;margin-top:8px;line-height:1.5;">
              Thank you for visiting <b>{business_name}</b>. Here's your invoice for today's visit.
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px 8px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF9F4;border-radius:8px;padding:12px 16px;">
              <tr>
                <td style="font-size:11px;color:#6B6862;font-weight:700;letter-spacing:1px;">INVOICE</td>
                <td style="font-size:11px;color:#6B6862;font-weight:700;letter-spacing:1px;text-align:right;">DATE</td>
              </tr>
              <tr>
                <td style="font-size:15px;color:#1A1A1A;font-weight:800;">#{invoice_no}</td>
                <td style="font-size:15px;color:#1A1A1A;font-weight:800;text-align:right;">{date_str}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 28px 8px 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <th style="padding:8px 0;font-size:11px;color:#6B6862;font-weight:700;letter-spacing:1px;text-align:left;border-bottom:2px solid #1A1A1A;">SERVICE</th>
                <th style="padding:8px 0;font-size:11px;color:#6B6862;font-weight:700;letter-spacing:1px;text-align:right;border-bottom:2px solid #1A1A1A;">AMOUNT</th>
              </tr>
              {rows_html}
              <tr>
                <td style="padding:10px 0 6px 0;font-size:13px;color:#4B4842;">Subtotal</td>
                <td style="padding:10px 0 6px 0;font-size:13px;color:#4B4842;text-align:right;">{currency_symbol}{subtotal:,.2f}</td>
              </tr>
              {"<tr><td style='padding:2px 0;font-size:13px;color:#4B4842;'>Tax</td><td style='padding:2px 0;font-size:13px;color:#4B4842;text-align:right;'>" + currency_symbol + f"{tax:,.2f}</td></tr>" if tax else ""}
              {"<tr><td style='padding:2px 0;font-size:13px;color:#4B4842;'>Tip</td><td style='padding:2px 0;font-size:13px;color:#4B4842;text-align:right;'>" + currency_symbol + f"{tip:,.2f}</td></tr>" if tip else ""}
              <tr>
                <td style="padding:14px 0 6px 0;font-size:16px;color:{BRAND_COLOR};font-weight:900;border-top:2px solid {BRAND_COLOR};">GRAND TOTAL</td>
                <td style="padding:14px 0 6px 0;font-size:16px;color:{BRAND_COLOR};font-weight:900;text-align:right;border-top:2px solid {BRAND_COLOR};">{currency_symbol}{grand_total:,.2f}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 28px 24px 28px;">
            <div style="font-size:12px;color:#6B6862;line-height:1.5;">
              We'd love to see you again! Reply to this email if you have any questions about this invoice.
            </div>
          </td>
        </tr>"""
    return _wrap(inner)
