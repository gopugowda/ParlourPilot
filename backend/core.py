"""
ParlourPilot core framework: DB client, config, JWT/auth, tenancy, branch scope,
razorpay client, and shared business helpers.

Route modules import from here.
"""
from fastapi import HTTPException, Depends, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
import os, re, logging, uuid, hmac, hashlib, json  # noqa: F401 (json/hashlib re-exported for routes)
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt as pyjwt
import certifi
import razorpay

# ------------------------------------------------------------------
# Environment / DB
# ------------------------------------------------------------------
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
_client_kwargs: Dict[str, Any] = {}
if mongo_url.startswith("mongodb+srv://"):
    _client_kwargs["tlsCAFile"] = certifi.where()
client = AsyncIOMotorClient(mongo_url, **_client_kwargs)
db = client[os.environ['DB_NAME']]

# JWT config - REQUIRED
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = 'HS256'
JWT_EXP_HOURS = 24 * 7  # 7 days

# SaaS defaults
TRIAL_DAYS = 15
DEFAULT_MEMBER_DISCOUNT_PCT = 10.0
DEFAULT_MEMBER_MIN_PRICE = 100.0

SUBSCRIPTION_PLANS: List[Dict[str, Any]] = [
    {
        "id": "monthly", "name": "Monthly", "billing_period": "month",
        "price_per_branch": 999, "currency": "INR",
        "features": ["All features included", "Unlimited bills", "Unlimited staff", "All reports", "WhatsApp reminders", "Multi-branch"],
    },
    {
        "id": "yearly", "name": "Yearly", "billing_period": "year",
        "price_per_branch": 9999, "currency": "INR",
        "features": ["All features included", "Unlimited bills", "Unlimited staff", "All reports", "WhatsApp reminders", "Multi-branch", "2 months free"],
    },
]

# Constants exported for legacy imports
EXPENSE_CATEGORIES = ["Material", "Utilities", "Rent", "Salary", "Maintenance", "Other"]
STOCK_UNITS = ["piece", "ml", "g", "kg", "L", "pack", "bottle"]

# ------------------------------------------------------------------
# Razorpay client
# ------------------------------------------------------------------
RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "").strip()
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "").strip()
RAZORPAY_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "").strip()

_razorpay_client: Optional[razorpay.Client] = None
if RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET:
    try:
        _razorpay_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
    except Exception:
        _razorpay_client = None


def get_razorpay() -> razorpay.Client:
    if _razorpay_client is None:
        raise HTTPException(status_code=503, detail="Payment gateway not configured. Contact administrator.")
    return _razorpay_client


def razorpay_enabled() -> bool:
    return _razorpay_client is not None


BRANCH_PLAN_PAISE = {"monthly": 88800, "yearly": 888800}
TENANT_PLAN_PAISE = {"monthly": 99900, "yearly": 999900}
BRANCH_PLAN_PRICES_INR = {"monthly": 888, "yearly": 8888}
TENANT_PLAN_PRICES_INR = {"monthly": 999, "yearly": 9999}

# ------------------------------------------------------------------
# Logger
# ------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("parlourpilot")

# ------------------------------------------------------------------
# Security dependency
# ------------------------------------------------------------------
security = HTTPBearer(auto_error=False)


# ============ Utility ============
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def hash_password(pwd: str) -> str:
    return bcrypt.hashpw(pwd.encode(), bcrypt.gensalt()).decode()


def verify_password(pwd: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pwd.encode(), hashed.encode())
    except Exception:
        return False


def slugify(text: str) -> str:
    text = (text or "").lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-+", "-", text).strip("-")
    return text or "salon"


def create_token(user_id: str, role: str, tenant_id: Optional[str]) -> str:
    payload = {
        "sub": user_id, "role": role, "tenant_id": tenant_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXP_HOURS),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = pyjwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
        user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="Invalid token")
        if not user.get("is_active", True):
            raise HTTPException(status_code=403, detail="User account is disabled")
        return user
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


async def require_admin(user=Depends(get_current_user)):
    if user.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def require_platform_admin(user=Depends(get_current_user)):
    if user.get("role") not in ("platform_admin", "platform_staff"):
        raise HTTPException(status_code=403, detail="Platform admin access required")
    return user


async def require_platform_super(user=Depends(get_current_user)):
    if user.get("role") != "platform_admin":
        raise HTTPException(status_code=403, detail="Only super admin (platform_admin) can perform this action")
    return user


def tenant_id_of(user: dict) -> str:
    tid = user.get("tenant_id")
    if not tid:
        raise HTTPException(status_code=403, detail="No tenant scope on user")
    return tid


def tq(user: dict, extra: Optional[dict] = None) -> dict:
    q = {"tenant_id": tenant_id_of(user)}
    if extra:
        q.update(extra)
    return q


def _extract_branch_id_header(x_branch_id: Optional[str]) -> Optional[str]:
    v = (x_branch_id or "").strip()
    if not v or v.lower() == "all":
        return None
    return v


async def resolve_branch_id(user: dict, x_branch_id: Optional[str] = None, required: bool = False) -> Optional[str]:
    role = user.get("role")
    if role == "platform_admin":
        return None
    if role == "staff":
        bid = user.get("branch_id")
        if not bid and required:
            raise HTTPException(status_code=400, detail="Staff account has no branch assigned. Please contact admin.")
        return bid
    raw = (x_branch_id or "").strip()
    if raw.lower() in ("__all__", "all"):
        if required:
            default_bid = user.get("branch_id")
            if default_bid:
                return default_bid
            first_br = await db.branches.find_one({"tenant_id": tenant_id_of(user)}, sort=[("created_at", 1)])
            if first_br:
                return first_br["id"]
            raise HTTPException(status_code=400, detail="No branch available.")
        return None
    if raw:
        br = await db.branches.find_one({"id": raw, "tenant_id": tenant_id_of(user)}, {"_id": 0, "id": 1})
        if not br:
            raise HTTPException(status_code=400, detail="Invalid branch")
        return raw
    default_bid = user.get("branch_id")
    if default_bid:
        return default_bid
    if required:
        first_br = await db.branches.find_one({"tenant_id": tenant_id_of(user)}, sort=[("created_at", 1)])
        if first_br:
            return first_br["id"]
        raise HTTPException(status_code=400, detail="No branch available. Please create a branch first.")
    return None


def bq_from(tid: str, branch_id: Optional[str], extra: Optional[dict] = None) -> dict:
    q: dict = {"tenant_id": tid}
    if branch_id:
        q["branch_id"] = branch_id
    if extra:
        q.update(extra)
    return q


def tenant_status(tenant: dict) -> dict:
    status_val = tenant.get("subscription_status") or "trialing"
    now = datetime.now(timezone.utc)
    end_iso = tenant.get("subscription_end_date") or tenant.get("trial_end_date")
    days_left = None
    if end_iso:
        try:
            end_dt = datetime.fromisoformat(end_iso.replace("Z", "+00:00"))
            days_left = (end_dt - now).days
            if status_val in ("trialing", "active") and now > end_dt:
                status_val = "expired"
        except Exception:
            pass
    return {
        "status": status_val, "days_left": days_left,
        "trial_end_date": tenant.get("trial_end_date"),
        "subscription_end_date": tenant.get("subscription_end_date"),
        "subscription_plan": tenant.get("subscription_plan", "trial"),
    }


async def load_tenant(tid: str) -> Optional[dict]:
    if not tid:
        return None
    return await db.tenants.find_one({"id": tid}, {"_id": 0})


async def check_subscription(user: dict) -> dict:
    if user.get("role") == "platform_admin":
        return {}
    tenant = await load_tenant(user.get("tenant_id"))
    if not tenant:
        raise HTTPException(status_code=403, detail="Tenant not found")
    if not tenant.get("is_active", True):
        raise HTTPException(status_code=403, detail="Tenant is suspended")
    st = tenant_status(tenant)
    if st["status"] in ("expired", "cancelled", "suspended"):
        raise HTTPException(
            status_code=402,
            detail=f"Subscription {st['status']}. Please renew to continue using ParlourPilot.",
        )
    return {"tenant": tenant, "status": st}


async def get_current_user_active(user=Depends(get_current_user)):
    await check_subscription(user)
    return user


async def require_admin_active(user=Depends(require_admin)):
    await check_subscription(user)
    return user


class BranchScope:
    def __init__(self, user: dict, tenant_id: str, branch_id: Optional[str]):
        self.user = user
        self.tenant_id = tenant_id
        self.branch_id = branch_id

    def filter(self, extra: Optional[dict] = None) -> dict:
        q: dict = {"tenant_id": self.tenant_id}
        if self.branch_id:
            q["branch_id"] = self.branch_id
        if extra:
            q.update(extra)
        return q


async def branch_scope(
    user=Depends(get_current_user_active),
    x_branch_id: Optional[str] = Header(default=None, alias="X-Branch-Id"),
) -> BranchScope:
    bid = await resolve_branch_id(user, x_branch_id, required=False)
    return BranchScope(user, tenant_id_of(user), bid)


async def branch_scope_required(
    user=Depends(get_current_user_active),
    x_branch_id: Optional[str] = Header(default=None, alias="X-Branch-Id"),
) -> BranchScope:
    bid = await resolve_branch_id(user, x_branch_id, required=True)
    return BranchScope(user, tenant_id_of(user), bid)


async def branch_scope_admin(
    user=Depends(require_admin_active),
    x_branch_id: Optional[str] = Header(default=None, alias="X-Branch-Id"),
) -> BranchScope:
    bid = await resolve_branch_id(user, x_branch_id, required=True)
    return BranchScope(user, tenant_id_of(user), bid)


# ============ Business Helpers ============
def _member_settings_for(tenant: Optional[dict]):
    if not tenant:
        return DEFAULT_MEMBER_DISCOUNT_PCT, DEFAULT_MEMBER_MIN_PRICE
    return (
        float(tenant.get("member_discount_pct") or DEFAULT_MEMBER_DISCOUNT_PCT),
        float(tenant.get("member_min_price") or DEFAULT_MEMBER_MIN_PRICE),
    )


def apply_member_discount(items, is_member: bool, tenant: Optional[dict], member_discount_pct: Optional[float] = None):
    tenant_disc_pct, min_price = _member_settings_for(tenant)
    disc_pct = float(member_discount_pct) if (member_discount_pct is not None) else tenant_disc_pct
    out = []
    for it in items:
        base = it.model_dump()
        member_pct = disc_pct if (is_member and it.price > min_price) else 0.0
        eff = max(float(it.discount_pct or 0), member_pct)
        base["effective_discount_pct"] = round(eff, 2)
        base["member_applied"] = member_pct > 0 and member_pct >= (it.discount_pct or 0)
        out.append(base)
    return out


def compute_bill_totals(items_effective):
    subtotal = 0.0
    total_discount = 0.0
    total_tax = 0.0
    for it in items_effective:
        line_gross = it["price"]
        line_disc = line_gross * (it.get("effective_discount_pct", 0) or 0) / 100.0
        line_net = line_gross - line_disc
        line_tax = line_net * (it.get("tax_percentage", 0) or 0) / 100.0
        subtotal += line_gross
        total_discount += line_disc
        total_tax += line_tax
    services_net = round(subtotal - total_discount, 2)
    return round(subtotal, 2), round(total_discount, 2), services_net, round(total_tax, 2)


def _plan_end_iso(plan: str) -> str:
    now = datetime.now(timezone.utc)
    delta = timedelta(days=365) if plan == "yearly" else timedelta(days=30)
    return (now + delta).isoformat()


def _member_status(m: dict) -> dict:
    """Enrich a member document with status + days_left."""
    m = dict(m)
    if not m.get("active"):
        m["status"] = "inactive"; m["days_left"] = None
        return m
    exp = m.get("expires_at")
    if not exp:
        m["status"] = "active"; m["days_left"] = None
        return m
    try:
        exp_dt = datetime.strptime(exp, "%Y-%m-%d")
        today = datetime.now(timezone.utc).replace(tzinfo=None)
        days_left = (exp_dt - today).days
        m["days_left"] = days_left
        if days_left < 0:
            m["status"] = "expired"
        elif days_left <= 30:
            m["status"] = "expiring_soon"
        else:
            m["status"] = "active"
    except Exception:
        m["status"] = "active"; m["days_left"] = None
    return m
