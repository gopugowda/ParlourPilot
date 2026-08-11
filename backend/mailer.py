"""
Emergent-managed Resend email integration.

Send transactional email via the platform-managed proxy — no Resend account or
API key required. `EMAIL_BASE_URL` is a hardcoded constant (per playbook) so it
survives deployment. Sender display name comes from `EMAIL_FROM_NAME`.

Usage:
    from mailer import send_email
    await send_email(
        to="user@example.com",
        subject="Password reset code",
        html="<b>Your code is 123456</b>",
    )
"""
import os
import logging
from typing import Optional

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Emergent managed email proxy. Constant on purpose — NEVER read from env.
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "ParlourPilot")


def email_enabled() -> bool:
    return bool(EMAIL_KEY)


async def send_email(
    *,
    to: str,
    subject: str,
    html: str,
    reply_to: Optional[str] = None,
) -> dict:
    """Send an HTML email. Returns {ok, id?, error?}.

    Non-throwing — callers should check the returned `ok` flag. This keeps the
    core auth/reset flow resilient if the email proxy has a transient failure.
    """
    if not EMAIL_KEY:
        logger.warning("EMERGENT_EMAIL_KEY not configured — skipping send to %s", to)
        return {"ok": False, "error": "email_not_configured"}

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
                headers={"X-Email-Key": EMAIL_KEY},
                json=payload,
            )
        resp.raise_for_status()
        try:
            data = resp.json()
        except Exception:
            data = {}
        return {"ok": True, "id": data.get("id")}
    except httpx.HTTPStatusError as e:
        logger.error("Email send HTTP %s: %s", e.response.status_code, e.response.text[:500])
        return {"ok": False, "error": f"http_{e.response.status_code}"}
    except Exception as e:
        logger.error("Email send error: %s", e)
        return {"ok": False, "error": str(e)}


# ---------- Templates ----------
BRAND_COLOR = "#C42032"


def render_otp_email(*, otp: str, name: Optional[str] = None, purpose: str = "reset your password") -> str:
    """Standard OTP email using table-based inline CSS for max client support."""
    greeting = f"Hi {name}," if name else "Hi there,"
    return f"""<!doctype html>
<html>
<body style="margin:0;padding:0;background:#F5F2EA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1A1A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EA;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0"
             style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:{BRAND_COLOR};padding:20px 24px;text-align:center;color:#FFFFFF;">
            <div style="font-size:22px;font-weight:800;letter-spacing:0.5px;">ParlourPilot</div>
            <div style="font-size:11px;letter-spacing:2px;opacity:0.85;margin-top:2px;">SALON MANAGEMENT PLATFORM</div>
          </td>
        </tr>
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
        </tr>
        <tr>
          <td style="background:#FBF9F4;padding:14px 24px;text-align:center;font-size:11px;color:#6B6862;border-top:1px solid #E8E5DA;">
            © ParlourPilot · Powered by Emergent
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>"""
