"""
ParlourPilot - Multi-Tenant Salon Management SaaS
Backend API (FastAPI + MongoDB)

Every tenant-owned collection is scoped by `tenant_id`. All authenticated
requests derive the tenant from the JWT — never from the request body.
"""
from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Request, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, re, ssl, logging, uuid
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal, Dict, Any
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt as pyjwt
import certifi


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB
mongo_url = os.environ['MONGO_URL']
_client_kwargs: Dict[str, Any] = {}
if mongo_url.startswith("mongodb+srv://"):
    # Atlas requires TLS with certifi CA bundle in some container environments
    _client_kwargs["tlsCAFile"] = certifi.where()
client = AsyncIOMotorClient(mongo_url, **_client_kwargs)
db = client[os.environ['DB_NAME']]

# JWT config - REQUIRED from environment, fail fast if missing
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = 'HS256'
JWT_EXP_HOURS = 24 * 7  # 7 days

# SaaS defaults
TRIAL_DAYS = 15
DEFAULT_MEMBER_DISCOUNT_PCT = 10.0
DEFAULT_MEMBER_MIN_PRICE = 100.0

# Subscription Plans (₹999/month/branch, ₹9999/year/branch — all features included)
SUBSCRIPTION_PLANS: List[Dict[str, Any]] = [
    {
        "id": "monthly",
        "name": "Monthly",
        "billing_period": "month",
        "price_per_branch": 999,
        "currency": "INR",
        "features": ["All features included", "Unlimited bills", "Unlimited staff", "All reports", "WhatsApp reminders", "Multi-branch"],
    },
    {
        "id": "yearly",
        "name": "Yearly",
        "billing_period": "year",
        "price_per_branch": 9999,
        "currency": "INR",
        "features": ["All features included", "Unlimited bills", "Unlimited staff", "All reports", "WhatsApp reminders", "Multi-branch", "2 months free"],
    },
]

app = FastAPI(title="ParlourPilot SaaS API")
api_router = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


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
        "sub": user_id,
        "role": role,
        "tenant_id": tenant_id,
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
    """Tenant admin/owner (formerly 'admin')."""
    if user.get("role") not in ("admin", "owner"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def require_platform_admin(user=Depends(get_current_user)):
    if user.get("role") != "platform_admin":
        raise HTTPException(status_code=403, detail="Platform admin access required")
    return user


def tenant_id_of(user: dict) -> str:
    """Extract tenant_id from authenticated user. Fails if missing (guards accidental cross-tenant leaks)."""
    tid = user.get("tenant_id")
    if not tid:
        raise HTTPException(status_code=403, detail="No tenant scope on user")
    return tid


def tq(user: dict, extra: Optional[dict] = None) -> dict:
    """Build a tenant-scoped Mongo query filter. Always includes tenant_id.
    Does NOT include branch filter — use `bq()` for branch-scoped collections."""
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
    """Resolve the branch context for a request.
    - Staff: always their assigned user.branch_id (header ignored).
    - Owner/admin: header value if provided & belongs to tenant.
       If header == "__all__" → None (view all branches aggregate).
       Else fall back to user.branch_id; else None.
    - Platform admin: never branch-scoped.
    If `required=True` and no branch context → 400.
    """
    role = user.get("role")
    if role == "platform_admin":
        return None
    if role == "staff":
        bid = user.get("branch_id")
        if not bid and required:
            raise HTTPException(status_code=400, detail="Staff account has no branch assigned. Please contact admin.")
        return bid
    # admin / owner
    raw = (x_branch_id or "").strip()
    # Explicit "all branches" sentinel
    if raw.lower() in ("__all__", "all"):
        if required:
            # Aggregate context but a specific branch is required → use user's default or first
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
    """Build tenant+branch scoped filter from raw params."""
    q: dict = {"tenant_id": tid}
    if branch_id:
        q["branch_id"] = branch_id
    if extra:
        q.update(extra)
    return q


def tenant_status(tenant: dict) -> dict:
    """Compute subscription status: active | trialing | expired | suspended | cancelled."""
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
        "status": status_val,
        "days_left": days_left,
        "trial_end_date": tenant.get("trial_end_date"),
        "subscription_end_date": tenant.get("subscription_end_date"),
        "subscription_plan": tenant.get("subscription_plan", "trial"),
    }


async def load_tenant(tid: str) -> Optional[dict]:
    if not tid:
        return None
    return await db.tenants.find_one({"id": tid}, {"_id": 0})


async def check_subscription(user: dict) -> dict:
    """Return tenant with status; raise 402 if expired/suspended for non-platform users."""
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
    """User dependency that also enforces subscription/trial validity."""
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


# ============ Models ============
class TenantSignup(BaseModel):
    business_name: str
    owner_name: str
    email: EmailStr
    password: str
    phone: Optional[str] = ""
    city: Optional[str] = ""
    country: Optional[str] = "India"
    num_branches: Optional[int] = 1  # create N branches upfront
    branch_names: Optional[List[str]] = None  # optional custom names


class BranchIn(BaseModel):
    name: str
    address: Optional[str] = ""
    city: Optional[str] = ""
    state: Optional[str] = ""
    country: Optional[str] = "India"
    postal_code: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    logo: Optional[str] = None
    tax_enabled: Optional[bool] = False
    tax_number: Optional[str] = ""
    tax_percentage: Optional[float] = 0.0
    invoice_prefix: Optional[str] = ""
    receipt_header: Optional[str] = ""
    receipt_footer: Optional[str] = ""
    is_head: Optional[bool] = False
    parent_branch_id: Optional[str] = None
    active: Optional[bool] = True


class TenantUpdate(BaseModel):
    business_name: Optional[str] = None
    logo: Optional[str] = None  # base64 or URL
    owner_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    postal_code: Optional[str] = None
    currency: Optional[str] = None
    timezone: Optional[str] = None
    tax_enabled: Optional[bool] = None
    tax_number: Optional[str] = None
    tax_percentage: Optional[float] = None
    invoice_prefix: Optional[str] = None
    receipt_header: Optional[str] = None
    receipt_footer: Optional[str] = None
    website: Optional[str] = None
    member_discount_pct: Optional[float] = None
    member_min_price: Optional[float] = None


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Literal["admin", "owner", "staff"] = "staff"
    branch_id: Optional[str] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[Literal["admin", "owner", "staff"]] = None
    branch_id: Optional[str] = None
    is_active: Optional[bool] = None


class PasswordReset(BaseModel):
    new_password: str


class ForgotPasswordReq(BaseModel):
    email: EmailStr


class ResetPasswordReq(BaseModel):
    token: str
    new_password: str


class LoginReq(BaseModel):
    email: EmailStr
    password: str


class BeauticianIn(BaseModel):
    name: str
    role: Optional[str] = "Stylist"
    phone: Optional[str] = ""
    active: bool = True


class ServiceIn(BaseModel):
    name: str
    price: float
    category: Optional[str] = "General"
    tax_percentage: Optional[float] = 0
    active: bool = True


class BillItem(BaseModel):
    service_id: Optional[str] = None
    service_name: str
    price: float
    discount_pct: float = 0
    tax_percentage: float = 0  # per-service tax
    beautician_id: Optional[str] = None
    beautician_name: str
    tip_amount: float = 0
    tip_via: Optional[Literal["cash", "qr"]] = None


class BillCreate(BaseModel):
    customer_name: Optional[str] = ""
    customer_phone: Optional[str] = ""
    items: List[BillItem]
    payment_mode: Literal["cash", "qr", "split"]
    cash_amount: float = 0
    qr_amount: float = 0
    is_member: bool = False
    tip_amount: float = 0
    tip_via: Optional[Literal["cash", "qr"]] = None
    tip_beautician_id: Optional[str] = None
    tip_beautician_name: Optional[str] = ""
    notes: Optional[str] = ""


class MemberIn(BaseModel):
    name: str
    phone: str
    joined_at: Optional[str] = None
    expires_at: Optional[str] = None
    discount_pct: Optional[float] = None  # overrides tenant default when set
    notes: Optional[str] = ""
    active: bool = True


EXPENSE_CATEGORIES = ["Material", "Utilities", "Rent", "Salary", "Maintenance", "Other"]


class ExpenseIn(BaseModel):
    category: str = "Other"
    description: str
    amount: float
    date: Optional[str] = None
    notes: Optional[str] = ""


STOCK_UNITS = ["piece", "ml", "g", "kg", "L", "pack", "bottle"]


class StockItemIn(BaseModel):
    name: str
    unit: str = "piece"
    current_qty: float = 0
    min_qty: float = 0
    unit_cost: float = 0
    notes: Optional[str] = ""


class StockMovementIn(BaseModel):
    item_id: str
    type: Literal["purchase", "use", "adjust"]
    qty: float
    unit_cost: Optional[float] = None
    notes: Optional[str] = ""


class CashClosingIn(BaseModel):
    date: Optional[str] = None
    opening_balance: float = 0
    cash_expenses: float = 0
    actual_closing: float = 0
    notes: Optional[str] = ""


# ============ Business Helpers ============
def _member_settings_for(tenant: Optional[dict]):
    if not tenant:
        return DEFAULT_MEMBER_DISCOUNT_PCT, DEFAULT_MEMBER_MIN_PRICE
    return (
        float(tenant.get("member_discount_pct") or DEFAULT_MEMBER_DISCOUNT_PCT),
        float(tenant.get("member_min_price") or DEFAULT_MEMBER_MIN_PRICE),
    )


def apply_member_discount(items: List[BillItem], is_member: bool, tenant: Optional[dict], member_discount_pct: Optional[float] = None) -> List[dict]:
    """Return list of item dicts with effective_discount_pct + member_applied flag.

    When member_discount_pct is provided (per-member override), it takes precedence
    over the tenant default when the member is active.
    """
    tenant_disc_pct, min_price = _member_settings_for(tenant)
    # Use member's own discount % if provided, else tenant default
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


def compute_bill_totals(items_effective: List[dict]):
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


# ============ Tenant / Signup Routes ============
@api_router.post("/tenants/signup")
async def signup_tenant(body: TenantSignup):
    """Public endpoint. Creates a new tenant + owner user + N branches + 15-day trial."""
    email = body.email.lower().strip()
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    if not body.business_name.strip():
        raise HTTPException(status_code=400, detail="Business name required")

    now = datetime.now(timezone.utc)
    trial_end = now + timedelta(days=TRIAL_DAYS)
    tenant_id = str(uuid.uuid4())
    slug = slugify(body.business_name)
    base_slug = slug
    i = 1
    while await db.tenants.find_one({"slug": slug}):
        i += 1
        slug = f"{base_slug}-{i}"

    tenant_doc = {
        "id": tenant_id,
        "business_name": body.business_name.strip(),
        "slug": slug,
        "logo": None,
        "owner_name": body.owner_name.strip(),
        "email": email,
        "phone": body.phone or "",
        "address": "",
        "city": body.city or "",
        "state": "",
        "country": body.country or "India",
        "postal_code": "",
        "website": "",
        "currency": "INR",
        "timezone": "Asia/Kolkata",
        "tax_enabled": False,
        "tax_number": "",
        "tax_percentage": 0.0,
        "invoice_prefix": "INV",
        "receipt_header": "",
        "receipt_footer": "Thank you! Powered by ParlourPilot",
        "member_discount_pct": DEFAULT_MEMBER_DISCOUNT_PCT,
        "member_min_price": DEFAULT_MEMBER_MIN_PRICE,
        "subscription_plan": "trial",
        "subscription_status": "trialing",
        "trial_start_date": now.isoformat(),
        "trial_end_date": trial_end.isoformat(),
        "subscription_start_date": None,
        "subscription_end_date": trial_end.isoformat(),
        "is_active": True,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.tenants.insert_one(tenant_doc)

    # Create branches
    n_branches = max(1, int(body.num_branches or 1))
    branch_names = body.branch_names or []
    head_branch_id: Optional[str] = None
    created_branches: List[dict] = []
    for idx in range(n_branches):
        bname = branch_names[idx] if idx < len(branch_names) and branch_names[idx].strip() else (
            "Head Branch" if idx == 0 else f"Branch {idx + 1}"
        )
        br_doc = {
            "id": str(uuid.uuid4()),
            "tenant_id": tenant_id,
            "name": bname.strip(),
            "address": "",
            "city": body.city or "",
            "state": "",
            "country": body.country or "India",
            "postal_code": "",
            "phone": body.phone or "" if idx == 0 else "",
            "email": email if idx == 0 else "",
            "logo": None,
            "tax_enabled": False,
            "tax_number": "",
            "tax_percentage": 0.0,
            "invoice_prefix": "" if idx == 0 else f"B{idx + 1}",
            "receipt_header": "",
            "receipt_footer": "",
            "is_head": idx == 0,
            "parent_branch_id": None if idx == 0 else head_branch_id,
            "active": True,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await db.branches.insert_one(br_doc)
        if idx == 0:
            head_branch_id = br_doc["id"]
        created_branches.append({k: v for k, v in br_doc.items() if k != "_id"})

    # Owner user (admin) — assigned to head branch by default but can switch
    user_doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "branch_id": head_branch_id,
        "name": body.owner_name.strip(),
        "email": email,
        "password_hash": hash_password(body.password),
        "role": "admin",
        "is_active": True,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.users.insert_one(user_doc)

    token = create_token(user_doc["id"], user_doc["role"], tenant_id)
    return {
        "token": token,
        "user": {
            "id": user_doc["id"],
            "tenant_id": tenant_id,
            "branch_id": head_branch_id,
            "name": user_doc["name"],
            "email": user_doc["email"],
            "role": user_doc["role"],
        },
        "tenant": {k: v for k, v in tenant_doc.items() if k != "_id"},
        "branches": created_branches,
        "subscription": tenant_status(tenant_doc),
    }


@api_router.get("/tenants/me")
async def get_my_tenant(user=Depends(get_current_user)):
    if user.get("role") == "platform_admin":
        return {"tenant": None, "subscription": None}
    tenant = await load_tenant(tenant_id_of(user))
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {"tenant": tenant, "subscription": tenant_status(tenant)}


@api_router.put("/tenants/me")
async def update_my_tenant(body: TenantUpdate, user=Depends(require_admin)):
    tid = tenant_id_of(user)
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        tenant = await load_tenant(tid)
        return {"tenant": tenant, "subscription": tenant_status(tenant)}
    updates["updated_at"] = now_iso()
    tenant = await db.tenants.find_one_and_update(
        {"id": tid}, {"$set": updates},
        return_document=True, projection={"_id": 0},
    )
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {"tenant": tenant, "subscription": tenant_status(tenant)}


@api_router.get("/tenants/me/subscription")
async def my_subscription(user=Depends(get_current_user)):
    if user.get("role") == "platform_admin":
        return {"status": "platform_admin"}
    tenant = await load_tenant(tenant_id_of(user))
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    # include branch count for pricing
    n_branches = await db.branches.count_documents({"tenant_id": tenant["id"], "active": True})
    st = tenant_status(tenant)
    st["branch_count"] = n_branches
    st["plans"] = SUBSCRIPTION_PLANS
    return st


# ============ Branches ============
@api_router.get("/branches")
async def list_branches(user=Depends(get_current_user)):
    """List branches for current tenant. Staff also sees list (needed for readonly identify)."""
    if user.get("role") == "platform_admin":
        raise HTTPException(status_code=403, detail="Platform admin does not have branches")
    docs = await db.branches.find({"tenant_id": tenant_id_of(user)}, {"_id": 0}).sort("is_head", -1).to_list(500)
    return docs


@api_router.post("/branches")
async def create_branch(body: BranchIn, user=Depends(require_admin_active)):
    tid = tenant_id_of(user)
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Branch name required")
    doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "name": body.name.strip(),
        "address": body.address or "",
        "city": body.city or "",
        "state": body.state or "",
        "country": body.country or "India",
        "postal_code": body.postal_code or "",
        "phone": body.phone or "",
        "email": body.email or "",
        "logo": body.logo,
        "tax_enabled": bool(body.tax_enabled),
        "tax_number": body.tax_number or "",
        "tax_percentage": float(body.tax_percentage or 0),
        "invoice_prefix": body.invoice_prefix or "",
        "receipt_header": body.receipt_header or "",
        "receipt_footer": body.receipt_footer or "",
        "is_head": bool(body.is_head),
        "parent_branch_id": body.parent_branch_id,
        "active": True if body.active is None else bool(body.active),
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.branches.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@api_router.put("/branches/{bid}")
async def update_branch(bid: str, body: BranchIn, user=Depends(require_admin_active)):
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "name" in updates:
        updates["name"] = updates["name"].strip()
    updates["updated_at"] = now_iso()
    result = await db.branches.find_one_and_update(
        tq(user, {"id": bid}), {"$set": updates},
        return_document=True, projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Branch not found")
    return result


@api_router.delete("/branches/{bid}")
async def delete_branch(bid: str, user=Depends(require_admin_active)):
    tid = tenant_id_of(user)
    br = await db.branches.find_one({"id": bid, "tenant_id": tid})
    if not br:
        raise HTTPException(status_code=404, detail="Not found")
    # Cannot delete if it's the last active branch
    n_active = await db.branches.count_documents({"tenant_id": tid, "active": True, "id": {"$ne": bid}})
    if n_active == 0:
        raise HTTPException(status_code=400, detail="Cannot delete the last branch. Tenant must have at least one branch.")
    # Cannot delete if it has bills
    n_bills = await db.bills.count_documents({"tenant_id": tid, "branch_id": bid})
    if n_bills > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete: this branch has {n_bills} bills. You can deactivate it instead.")
    await db.branches.delete_one({"id": bid, "tenant_id": tid})
    # Also cleanup users assigned to this branch → reassign to head or unset
    head = await db.branches.find_one({"tenant_id": tid, "is_head": True})
    new_bid = head["id"] if head else None
    await db.users.update_many({"tenant_id": tid, "branch_id": bid}, {"$set": {"branch_id": new_bid}})
    return {"ok": True}


@api_router.get("/subscription/plans")
async def get_plans():
    """Public — list of subscription plans."""
    return SUBSCRIPTION_PLANS


# ============ Auth Routes ============
@api_router.post("/auth/register")
async def register(body: UserCreate, user=Depends(require_admin)):
    """Admin creates a staff/user WITHIN their own tenant."""
    tid = tenant_id_of(user)
    email = body.email.lower()
    existing = await db.users.find_one({"email": email, "tenant_id": tid})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered in this salon")
    role = "admin" if body.role in ("admin", "owner") else "staff"
    # Validate branch_id belongs to tenant if provided
    branch_id = body.branch_id
    if branch_id:
        br = await db.branches.find_one({"id": branch_id, "tenant_id": tid})
        if not br:
            raise HTTPException(status_code=400, detail="Invalid branch")
    # Staff must have a branch — default to first branch if not specified
    if role == "staff" and not branch_id:
        head = await db.branches.find_one({"tenant_id": tid, "is_head": True})
        branch_id = head["id"] if head else None
    user_doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "branch_id": branch_id,
        "name": body.name,
        "email": email,
        "password_hash": hash_password(body.password),
        "role": role,
        "is_active": True,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.users.insert_one(user_doc)
    return {k: v for k, v in user_doc.items() if k not in ("_id", "password_hash")}


@api_router.post("/auth/login")
async def login(body: LoginReq):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account disabled. Please contact administrator.")

    token = create_token(user["id"], user["role"], user.get("tenant_id"))

    subscription = None
    tenant = None
    branches: List[dict] = []
    if user.get("tenant_id"):
        tenant = await load_tenant(user["tenant_id"])
        if tenant:
            subscription = tenant_status(tenant)
        branches = await db.branches.find({"tenant_id": user["tenant_id"], "active": True}, {"_id": 0}).sort("is_head", -1).to_list(500)

    return {
        "token": token,
        "user": {
            "id": user["id"],
            "tenant_id": user.get("tenant_id"),
            "branch_id": user.get("branch_id"),
            "name": user["name"],
            "email": user["email"],
            "role": user["role"],
        },
        "tenant": tenant,
        "branches": branches,
        "subscription": subscription,
    }


@api_router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    tenant = None
    subscription = None
    branches: List[dict] = []
    if user.get("tenant_id"):
        tenant = await load_tenant(user["tenant_id"])
        if tenant:
            subscription = tenant_status(tenant)
        branches = await db.branches.find({"tenant_id": user["tenant_id"], "active": True}, {"_id": 0}).sort("is_head", -1).to_list(500)
    return {"user": user, "tenant": tenant, "branches": branches, "subscription": subscription}


@api_router.get("/auth/users")
async def list_users(user=Depends(require_admin)):
    users = await db.users.find(tq(user), {"_id": 0, "password_hash": 0}).to_list(500)
    return users


@api_router.put("/auth/users/{uid}")
async def update_user(uid: str, body: UserUpdate, user=Depends(require_admin)):
    tid = tenant_id_of(user)
    target = await db.users.find_one({"id": uid, "tenant_id": tid}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.email is not None:
        email_lower = body.email.lower()
        existing = await db.users.find_one({"email": email_lower, "tenant_id": tid, "id": {"$ne": uid}})
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")
        updates["email"] = email_lower
    if body.role is not None:
        target_role = target.get("role")
        new_role = "admin" if body.role in ("admin", "owner") else "staff"
        # Prevent demoting the last admin/owner of this tenant
        if target_role in ("admin", "owner") and new_role == "staff":
            admin_count = await db.users.count_documents({"tenant_id": tid, "role": {"$in": ["admin", "owner"]}})
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot demote the last owner/admin")
        updates["role"] = new_role
    if "branch_id" in body.model_fields_set:
        # Preventing staff from being unassigned from a branch (staff MUST have a branch)
        target_role = target.get("role")
        new_role = updates.get("role", target_role)
        if new_role == "staff" and not body.branch_id:
            raise HTTPException(status_code=400, detail="Staff users must be assigned to a branch")
        if body.branch_id:
            br = await db.branches.find_one({"id": body.branch_id, "tenant_id": tid})
            if not br:
                raise HTTPException(status_code=400, detail="Invalid branch")
        updates["branch_id"] = body.branch_id or None
    if body.is_active is not None:
        updates["is_active"] = bool(body.is_active)
    if not updates:
        return {k: v for k, v in target.items() if k != "password_hash"}
    updates["updated_at"] = now_iso()
    result = await db.users.find_one_and_update(
        {"id": uid, "tenant_id": tid}, {"$set": updates},
        return_document=True, projection={"_id": 0, "password_hash": 0},
    )
    return result


@api_router.delete("/auth/users/{uid}")
async def delete_user(uid: str, user=Depends(require_admin)):
    tid = tenant_id_of(user)
    if uid == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    target = await db.users.find_one({"id": uid, "tenant_id": tid})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.get("role") in ("admin", "owner"):
        admin_count = await db.users.count_documents({"tenant_id": tid, "role": {"$in": ["admin", "owner"]}})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last owner/admin")
    await db.users.delete_one({"id": uid, "tenant_id": tid})
    return {"ok": True}


@api_router.delete("/auth/me")
async def delete_own_account(user=Depends(get_current_user)):
    """Self-service account deletion (App Store review compliant).
    Owners cannot self-delete if they are the last admin; they should delete the tenant instead."""
    uid = user["id"]
    tid = user.get("tenant_id")
    if tid and user.get("role") in ("admin", "owner"):
        admin_count = await db.users.count_documents({"tenant_id": tid, "role": {"$in": ["admin", "owner"]}})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="You are the last owner. Please transfer ownership or contact support to delete your account.")
    await db.users.delete_one({"id": uid})
    return {"ok": True}


@api_router.post("/auth/users/{uid}/reset-password")
async def admin_reset_password(uid: str, body: PasswordReset, user=Depends(require_admin)):
    tid = tenant_id_of(user)
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    target = await db.users.find_one({"id": uid, "tenant_id": tid})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await db.users.update_one({"id": uid, "tenant_id": tid}, {"$set": {"password_hash": hash_password(body.new_password), "updated_at": now_iso()}})
    return {"ok": True}


@api_router.post("/auth/forgot-password")
async def forgot_password(body: ForgotPasswordReq):
    email = body.email.lower()
    target = await db.users.find_one({"email": email})
    if not target:
        return {"ok": True, "email_sent": False, "message": "If the email exists, a reset link is available."}
    token = str(uuid.uuid4()).replace("-", "")
    expires = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    await db.password_resets.insert_one({
        "token": token,
        "user_id": target["id"],
        "email": email,
        "expires_at": expires,
        "used": False,
        "created_at": now_iso(),
    })
    return {
        "ok": True,
        "email_sent": False,
        "reset_token": token,
        "expires_at": expires,
        "message": "Email not configured. Use the token below to reset your password within 1 hour.",
    }


@api_router.post("/auth/reset-password")
async def reset_password(body: ResetPasswordReq):
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    doc = await db.password_resets.find_one({"token": body.token})
    if not doc:
        raise HTTPException(status_code=400, detail="Invalid reset token")
    if doc.get("used"):
        raise HTTPException(status_code=400, detail="Token already used")
    try:
        exp = datetime.fromisoformat(doc["expires_at"])
        if datetime.now(timezone.utc) > exp:
            raise HTTPException(status_code=400, detail="Reset token expired")
    except HTTPException:
        raise
    except Exception:
        pass
    await db.users.update_one({"id": doc["user_id"]}, {"$set": {"password_hash": hash_password(body.new_password), "updated_at": now_iso()}})
    await db.password_resets.update_one({"token": body.token}, {"$set": {"used": True, "used_at": now_iso()}})
    return {"ok": True}


# ============ Beauticians ============
@api_router.get("/beauticians")
async def list_beauticians(scope: BranchScope = Depends(branch_scope)):
    docs = await db.beauticians.find(scope.filter(), {"_id": 0}).sort("name", 1).to_list(500)
    return docs


@api_router.post("/beauticians")
async def create_beautician(body: BeauticianIn, scope: BranchScope = Depends(branch_scope_admin)):
    doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": scope.tenant_id,
        "branch_id": scope.branch_id,
        "name": body.name,
        "role": body.role or "Stylist",
        "phone": body.phone or "",
        "active": body.active,
        "created_at": now_iso(),
    }
    await db.beauticians.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@api_router.put("/beauticians/{bid}")
async def update_beautician(bid: str, body: BeauticianIn, scope: BranchScope = Depends(branch_scope_admin)):
    result = await db.beauticians.find_one_and_update(
        scope.filter({"id": bid}),
        {"$set": {"name": body.name, "role": body.role, "phone": body.phone or "", "active": body.active}},
        return_document=True, projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Beautician not found")
    return result


@api_router.delete("/beauticians/{bid}")
async def delete_beautician(bid: str, scope: BranchScope = Depends(branch_scope_admin)):
    result = await db.beauticians.delete_one(scope.filter({"id": bid}))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ============ Services ============
@api_router.get("/services")
async def list_services(scope: BranchScope = Depends(branch_scope)):
    docs = await db.services.find(scope.filter(), {"_id": 0}).sort("name", 1).to_list(500)
    return docs


@api_router.post("/services")
async def create_service(body: ServiceIn, scope: BranchScope = Depends(branch_scope_admin)):
    doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": scope.tenant_id,
        "branch_id": scope.branch_id,
        "name": body.name,
        "price": float(body.price),
        "category": body.category or "General",
        "tax_percentage": float(body.tax_percentage or 0),
        "active": body.active,
        "created_at": now_iso(),
    }
    await db.services.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@api_router.put("/services/{sid}")
async def update_service(sid: str, body: ServiceIn, scope: BranchScope = Depends(branch_scope_admin)):
    result = await db.services.find_one_and_update(
        scope.filter({"id": sid}),
        {"$set": {
            "name": body.name, "price": float(body.price),
            "category": body.category,
            "tax_percentage": float(body.tax_percentage or 0),
            "active": body.active,
        }},
        return_document=True, projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Service not found")
    return result


@api_router.delete("/services/{sid}")
async def delete_service(sid: str, scope: BranchScope = Depends(branch_scope_admin)):
    result = await db.services.delete_one(scope.filter({"id": sid}))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


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


@api_router.post("/bills")
async def create_bill(body: BillCreate, scope: BranchScope = Depends(branch_scope_required)):
    if not body.items:
        raise HTTPException(status_code=400, detail="At least one service required")
    tid = scope.tenant_id
    tenant = await load_tenant(tid)
    branch = await db.branches.find_one({"id": scope.branch_id, "tenant_id": tid}, {"_id": 0}) if scope.branch_id else None

    # If is_member, look up the member's own discount override (members are tenant-scoped)
    member_disc_override: Optional[float] = None
    if body.is_member and body.customer_phone:
        m = await db.members.find_one({"tenant_id": tid, "phone": body.customer_phone.strip(), "active": True})
        if m and m.get("discount_pct") is not None:
            member_disc_override = float(m["discount_pct"])

    items_eff = apply_member_discount(body.items, body.is_member, tenant, member_disc_override)
    subtotal, discount, services_net, tax_total = compute_bill_totals(items_eff)

    line_tip_total = sum(float(it.get("tip_amount", 0) or 0) for it in items_eff)
    line_tip_qr = sum(float(it.get("tip_amount", 0) or 0) for it in items_eff if it.get("tip_via") == "qr")
    line_tip_cash = line_tip_total - line_tip_qr

    payable = round(services_net + tax_total, 2)

    if body.payment_mode == "cash":
        cash_amt = payable; qr_amt = 0.0
    elif body.payment_mode == "qr":
        cash_amt = 0.0; qr_amt = payable
    else:
        cash_amt = round(body.cash_amount, 2); qr_amt = round(body.qr_amount, 2)
        if abs((cash_amt + qr_amt) - payable) > 0.01:
            raise HTTPException(status_code=400, detail=f"Split amounts must total {payable}")

    tip_amount = round(max(0.0, float(body.tip_amount or 0)), 2)
    tip_via = body.tip_via if tip_amount > 0 else None
    if tip_amount > 0 and tip_via not in ("cash", "qr"):
        raise HTTPException(status_code=400, detail="tip_via required when tip_amount > 0")

    total_tip_amount = round(tip_amount + line_tip_total, 2)
    total_tip_qr = round((tip_amount if tip_via == "qr" else 0) + line_tip_qr, 2)
    total_tip_cash = round(total_tip_amount - total_tip_qr, 2)
    grand_total = round(services_net + tax_total + total_tip_amount, 2)

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
        "member_discount_pct_applied": member_disc_override,
        "tip_amount": total_tip_amount,
        "tip_via": tip_via,
        "tip_beautician_id": body.tip_beautician_id if tip_amount > 0 else None,
        "tip_beautician_name": (body.tip_beautician_name or "") if tip_amount > 0 else "",
        "tip_cash_total": total_tip_cash,
        "tip_qr_total": total_tip_qr,
        "grand_total": grand_total,
        "payment_mode": body.payment_mode,
        "cash_amount": cash_amt,
        "qr_amount": qr_amt,
        "notes": body.notes or "",
        "created_by": scope.user["id"],
        "created_by_name": scope.user["name"],
        "created_at": now_iso(),
    }
    await db.bills.insert_one(bill)
    return {k: v for k, v in bill.items() if k != "_id"}


@api_router.get("/bills")
async def list_bills(
    limit: int = 100,
    date: Optional[str] = None,
    payment_mode: Optional[str] = None,
    scope: BranchScope = Depends(branch_scope),
):
    query: dict = scope.filter()
    if scope.user.get("role") == "staff":
        t = today_str()
        query["created_at"] = {"$gte": f"{t}T00:00:00", "$lt": f"{t}T23:59:59.999999+00:00"}
    elif date:
        query["created_at"] = {"$gte": f"{date}T00:00:00", "$lt": f"{date}T23:59:59.999999+00:00"}
    if payment_mode and payment_mode != "all":
        query["payment_mode"] = payment_mode
    docs = await db.bills.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return docs


@api_router.put("/bills/{bid}")
async def update_bill(bid: str, body: BillCreate, scope: BranchScope = Depends(branch_scope_admin)):
    tid = scope.tenant_id
    tenant = await load_tenant(tid)
    existing = await db.bills.find_one(scope.filter({"id": bid}), {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Bill not found")
    if not body.items:
        raise HTTPException(status_code=400, detail="At least one service required")

    member_disc_override: Optional[float] = None
    if body.is_member and body.customer_phone:
        m = await db.members.find_one({"tenant_id": tid, "phone": body.customer_phone.strip(), "active": True})
        if m and m.get("discount_pct") is not None:
            member_disc_override = float(m["discount_pct"])

    items_eff = apply_member_discount(body.items, body.is_member, tenant, member_disc_override)
    subtotal, discount, services_net, tax_total = compute_bill_totals(items_eff)

    line_tip_total = sum(float(it.get("tip_amount", 0) or 0) for it in items_eff)
    line_tip_qr = sum(float(it.get("tip_amount", 0) or 0) for it in items_eff if it.get("tip_via") == "qr")

    payable = round(services_net + tax_total, 2)

    if body.payment_mode == "cash":
        cash_amt = payable; qr_amt = 0.0
    elif body.payment_mode == "qr":
        cash_amt = 0.0; qr_amt = payable
    else:
        cash_amt = round(body.cash_amount, 2); qr_amt = round(body.qr_amount, 2)
        if abs((cash_amt + qr_amt) - payable) > 0.01:
            raise HTTPException(status_code=400, detail=f"Split amounts must total {payable}")

    tip_amount = round(max(0.0, float(body.tip_amount or 0)), 2)
    tip_via = body.tip_via if tip_amount > 0 else None
    total_tip_amount = round(tip_amount + line_tip_total, 2)
    total_tip_qr = round((tip_amount if tip_via == "qr" else 0) + line_tip_qr, 2)
    total_tip_cash = round(total_tip_amount - total_tip_qr, 2)
    grand_total = round(services_net + tax_total + total_tip_amount, 2)

    update = {
        "customer_name": body.customer_name or existing.get("customer_name", "Walk-in"),
        "customer_phone": body.customer_phone or "",
        "items": items_eff,
        "subtotal": subtotal,
        "discount": discount,
        "tax_amount": tax_total,
        "services_net": services_net,
        "is_member": bool(body.is_member),
        "member_discount_pct_applied": member_disc_override,
        "tip_amount": total_tip_amount,
        "tip_via": tip_via,
        "tip_beautician_id": body.tip_beautician_id if tip_amount > 0 else None,
        "tip_beautician_name": (body.tip_beautician_name or "") if tip_amount > 0 else "",
        "tip_cash_total": total_tip_cash,
        "tip_qr_total": total_tip_qr,
        "grand_total": grand_total,
        "payment_mode": body.payment_mode,
        "cash_amount": cash_amt,
        "qr_amount": qr_amt,
        "notes": body.notes or "",
        "edited_by": scope.user["id"],
        "edited_by_name": scope.user["name"],
        "edited_at": now_iso(),
    }
    result = await db.bills.find_one_and_update(
        scope.filter({"id": bid}), {"$set": update},
        return_document=True, projection={"_id": 0},
    )
    return result


@api_router.get("/bills/{bid}")
async def get_bill(bid: str, scope: BranchScope = Depends(branch_scope)):
    doc = await db.bills.find_one(scope.filter({"id": bid}), {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Bill not found")
    if scope.user.get("role") == "staff":
        t = today_str()
        if not doc["created_at"].startswith(t):
            raise HTTPException(status_code=403, detail="Staff can only view today's bills")
    return doc


@api_router.delete("/bills/{bid}")
async def delete_bill(bid: str, scope: BranchScope = Depends(branch_scope_admin)):
    result = await db.bills.delete_one(scope.filter({"id": bid}))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ============ Members ============
def _member_status(m: dict) -> dict:
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
        if days_left < 0: m["status"] = "expired"
        elif days_left <= 30: m["status"] = "expiring_soon"
        else: m["status"] = "active"
    except Exception:
        m["status"] = "active"; m["days_left"] = None
    return m


@api_router.get("/members")
async def list_members(user=Depends(get_current_user_active)):
    """Members are tenant-scoped (shared across branches). Staff can view."""
    docs = await db.members.find(tq(user), {"_id": 0}).sort("name", 1).to_list(1000)
    return [_member_status(m) for m in docs]


@api_router.get("/members/lookup")
async def lookup_member(phone: str, user=Depends(get_current_user_active)):
    phone_clean = (phone or "").strip()
    if len(phone_clean) < 4:
        return {"found": False}
    doc = await db.members.find_one(tq(user, {"phone": phone_clean}), {"_id": 0})
    if not doc:
        return {"found": False}
    m = _member_status(doc)
    tenant = await load_tenant(tenant_id_of(user))
    default_pct, _ = _member_settings_for(tenant)
    m["effective_discount_pct"] = float(m.get("discount_pct")) if m.get("discount_pct") is not None else float(default_pct)
    return {"found": True, "member": m, "is_active_member": m["status"] in ("active", "expiring_soon")}


@api_router.post("/members")
async def create_member(body: MemberIn, user=Depends(require_admin_active)):
    tid = tenant_id_of(user)
    phone_clean = body.phone.strip()
    if await db.members.find_one({"tenant_id": tid, "phone": phone_clean}):
        raise HTTPException(status_code=400, detail="Phone already registered as member")
    today = today_str()
    joined = body.joined_at or today
    if not body.expires_at:
        try:
            j = datetime.strptime(joined, "%Y-%m-%d")
            expires = (j.replace(year=j.year + 1)).strftime("%Y-%m-%d")
        except Exception:
            expires = None
    else:
        expires = body.expires_at
    doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "name": body.name.strip(),
        "phone": phone_clean,
        "joined_at": joined,
        "expires_at": expires,
        "discount_pct": float(body.discount_pct) if body.discount_pct is not None else None,
        "notes": body.notes or "",
        "active": body.active,
        "created_at": now_iso(),
    }
    await db.members.insert_one(doc)
    return _member_status({k: v for k, v in doc.items() if k != "_id"})


@api_router.put("/members/{mid}")
async def update_member(mid: str, body: MemberIn, user=Depends(require_admin_active)):
    result = await db.members.find_one_and_update(
        tq(user, {"id": mid}),
        {"$set": {
            "name": body.name.strip(), "phone": body.phone.strip(),
            "joined_at": body.joined_at, "expires_at": body.expires_at,
            "discount_pct": float(body.discount_pct) if body.discount_pct is not None else None,
            "notes": body.notes or "", "active": body.active,
        }},
        return_document=True, projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Member not found")
    return _member_status(result)


@api_router.delete("/members/{mid}")
async def delete_member(mid: str, user=Depends(require_admin_active)):
    result = await db.members.delete_one(tq(user, {"id": mid}))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


@api_router.get("/members/expiring")
async def members_expiring(days: int = 30, user=Depends(get_current_user_active)):
    docs = await db.members.find(tq(user, {"active": True}), {"_id": 0}).to_list(1000)
    result = []
    for m in docs:
        m2 = _member_status(m)
        if m2["status"] in ("expiring_soon", "expired"):
            result.append(m2)
    result.sort(key=lambda x: x.get("days_left") if x.get("days_left") is not None else 9999)
    return result


# ============ Expenses ============
@api_router.get("/expenses/categories")
async def expense_categories(user=Depends(get_current_user_active)):
    return EXPENSE_CATEGORIES


@api_router.get("/expenses")
async def list_expenses(
    date: Optional[str] = None,
    month: Optional[str] = None,
    limit: int = 200,
    scope: BranchScope = Depends(branch_scope),
):
    query: dict = scope.filter()
    if scope.user.get("role") == "staff":
        query["date"] = today_str()
    elif date:
        query["date"] = date
    elif month:
        query["date"] = {"$regex": f"^{month}"}
    docs = await db.expenses.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return docs


@api_router.post("/expenses")
async def create_expense(body: ExpenseIn, scope: BranchScope = Depends(branch_scope_required)):
    if not (body.amount and body.amount > 0):
        raise HTTPException(status_code=400, detail="Amount must be > 0")
    if not body.description.strip():
        raise HTTPException(status_code=400, detail="Description required")
    cat = body.category if body.category in EXPENSE_CATEGORIES else "Other"
    d = body.date or today_str()
    doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": scope.tenant_id,
        "branch_id": scope.branch_id,
        "category": cat,
        "description": body.description.strip(),
        "amount": round(float(body.amount), 2),
        "date": d,
        "notes": body.notes or "",
        "created_by": scope.user["id"],
        "created_by_name": scope.user["name"],
        "created_at": now_iso(),
    }
    await db.expenses.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@api_router.put("/expenses/{eid}")
async def update_expense(eid: str, body: ExpenseIn, scope: BranchScope = Depends(branch_scope_admin)):
    if not (body.amount and body.amount > 0):
        raise HTTPException(status_code=400, detail="Amount must be > 0")
    cat = body.category if body.category in EXPENSE_CATEGORIES else "Other"
    result = await db.expenses.find_one_and_update(
        scope.filter({"id": eid}),
        {"$set": {
            "category": cat, "description": body.description.strip(),
            "amount": round(float(body.amount), 2),
            "date": body.date or today_str(),
            "notes": body.notes or "",
        }},
        return_document=True, projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Expense not found")
    return result


@api_router.delete("/expenses/{eid}")
async def delete_expense(eid: str, scope: BranchScope = Depends(branch_scope_admin)):
    result = await db.expenses.delete_one(scope.filter({"id": eid}))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ============ Stock / Inventory ============
@api_router.get("/stock/units")
async def stock_units(user=Depends(get_current_user_active)):
    return STOCK_UNITS


@api_router.get("/stock")
async def list_stock(scope: BranchScope = Depends(branch_scope)):
    docs = await db.stock_items.find(scope.filter(), {"_id": 0}).sort("name", 1).to_list(500)
    for d in docs:
        d["low_stock"] = d.get("current_qty", 0) <= d.get("min_qty", 0)
    return docs


@api_router.get("/stock/low")
async def list_low_stock(scope: BranchScope = Depends(branch_scope)):
    docs = await db.stock_items.find(scope.filter(), {"_id": 0}).to_list(500)
    return [d for d in docs if d.get("current_qty", 0) <= d.get("min_qty", 0)]


@api_router.post("/stock")
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


@api_router.put("/stock/{sid}")
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


@api_router.delete("/stock/{sid}")
async def delete_stock(sid: str, scope: BranchScope = Depends(branch_scope_admin)):
    result = await db.stock_items.delete_one(scope.filter({"id": sid}))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    await db.stock_movements.delete_many(scope.filter({"item_id": sid}))
    return {"ok": True}


@api_router.post("/stock/movement")
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


@api_router.get("/stock/{sid}/movements")
async def list_movements(sid: str, limit: int = 50, scope: BranchScope = Depends(branch_scope)):
    docs = await db.stock_movements.find(scope.filter({"item_id": sid}), {"_id": 0}).sort("created_at", -1).to_list(limit)
    return docs


# ============ Cash Closing ============
async def _compute_day_totals(tid: str, branch_id: Optional[str], d: str):
    q_bills: dict = {"tenant_id": tid, "created_at": {"$gte": f"{d}T00:00:00", "$lt": f"{d}T23:59:59.999999+00:00"}}
    if branch_id: q_bills["branch_id"] = branch_id
    bills = await db.bills.find(q_bills, {"_id": 0}).to_list(3000)
    services_net = sum(b.get("services_net", b.get("grand_total", 0) - b.get("tip_amount", 0)) for b in bills)
    tip_total = sum(b.get("tip_amount", 0) for b in bills)
    tip_qr = sum(b.get("tip_qr_total", b.get("tip_amount", 0) if b.get("tip_via") == "qr" else 0) for b in bills)
    cash_sales = sum(b.get("cash_amount", 0) for b in bills) - tip_qr
    upi_sales = sum(b.get("qr_amount", 0) for b in bills) + tip_qr
    q_exp: dict = {"tenant_id": tid, "date": d}
    if branch_id: q_exp["branch_id"] = branch_id
    exps = await db.expenses.find(q_exp, {"_id": 0}).to_list(500)
    total_expenses = sum(e["amount"] for e in exps)
    return {
        "bills_count": len(bills),
        "total_revenue": round(services_net, 2),
        "cash_sales": round(cash_sales, 2),
        "upi_sales": round(upi_sales, 2),
        "tips": round(tip_total, 2),
        "total_expenses": round(total_expenses, 2),
    }


@api_router.get("/cash-closing/summary")
async def cash_closing_summary(date: Optional[str] = None, scope: BranchScope = Depends(branch_scope_required)):
    tid = scope.tenant_id
    d = date or today_str()
    totals = await _compute_day_totals(tid, scope.branch_id, d)
    prev = await db.cash_closings.find_one(
        {"tenant_id": tid, "branch_id": scope.branch_id, "date": {"$lt": d}},
        sort=[("date", -1)], projection={"_id": 0},
    )
    suggested_opening = prev["actual_closing"] if prev else 0
    existing = await db.cash_closings.find_one({"tenant_id": tid, "branch_id": scope.branch_id, "date": d}, projection={"_id": 0})
    return {"date": d, **totals, "suggested_opening": round(suggested_opening, 2), "existing_closing": existing}


@api_router.post("/cash-closing")
async def create_cash_closing(body: CashClosingIn, scope: BranchScope = Depends(branch_scope_required)):
    tid = scope.tenant_id
    d = body.date or today_str()
    totals = await _compute_day_totals(tid, scope.branch_id, d)

    opening = round(float(body.opening_balance or 0), 2)
    cash_exp = round(float(body.cash_expenses or 0), 2)
    actual = round(float(body.actual_closing or 0), 2)
    expected = round(opening + totals["cash_sales"] - cash_exp, 2)
    difference = round(actual - expected, 2)

    doc = {
        "id": str(uuid.uuid4()),
        "tenant_id": tid,
        "branch_id": scope.branch_id,
        "date": d,
        "opening_balance": opening,
        "cash_sales": totals["cash_sales"],
        "upi_sales": totals["upi_sales"],
        "total_revenue": totals["total_revenue"],
        "total_expenses": totals["total_expenses"],
        "cash_expenses": cash_exp,
        "tips": totals["tips"],
        "bills_count": totals["bills_count"],
        "expected_closing": expected,
        "actual_closing": actual,
        "difference": difference,
        "notes": body.notes or "",
        "submitted_by": scope.user["id"],
        "submitted_by_name": scope.user["name"],
        "submitted_at": now_iso(),
    }
    await db.cash_closings.replace_one({"tenant_id": tid, "branch_id": scope.branch_id, "date": d}, doc, upsert=True)
    return doc


@api_router.get("/cash-closing")
async def list_cash_closings(limit: int = 30, scope: BranchScope = Depends(branch_scope)):
    docs = await db.cash_closings.find(scope.filter(), {"_id": 0}).sort("date", -1).to_list(limit)
    return docs


@api_router.delete("/cash-closing/{cid}")
async def delete_cash_closing(cid: str, scope: BranchScope = Depends(branch_scope_admin)):
    result = await db.cash_closings.delete_one(scope.filter({"id": cid}))
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ============ Reports ============
@api_router.get("/reports/summary")
async def reports_summary(scope: BranchScope = Depends(branch_scope)):
    tid = scope.tenant_id
    today = today_str()
    month = datetime.now(timezone.utc).strftime("%Y-%m")

    q_bills = scope.filter()
    all_bills = await db.bills.find(q_bills, {"_id": 0}).to_list(10000)

    def revenue(b):
        return b.get("services_net", b.get("grand_total", 0) - b.get("tip_amount", 0))

    today_bills = [b for b in all_bills if b["created_at"].startswith(today)]
    month_bills = [b for b in all_bills if b["created_at"].startswith(month)]

    today_total = sum(revenue(b) for b in today_bills)
    today_count = len(today_bills)
    month_total = sum(revenue(b) for b in month_bills)
    month_count = len(month_bills)

    def tip_qr_of(b):
        if "tip_qr_total" in b: return b.get("tip_qr_total", 0)
        return b.get("tip_amount", 0) if b.get("tip_via") == "qr" else 0
    today_cash = sum(b.get("cash_amount", 0) for b in today_bills) - sum(tip_qr_of(b) for b in today_bills)
    today_qr = sum(b.get("qr_amount", 0) for b in today_bills) + sum(tip_qr_of(b) for b in today_bills)
    today_tips = sum(b.get("tip_amount", 0) for b in today_bills)

    per_beautician: dict = {}
    for b in month_bills:
        line_totals = []
        for it in b["items"]:
            eff = it.get("effective_discount_pct", it.get("discount_pct", 0)) or 0
            lt = it["price"] * (1 - eff / 100.0)
            line_totals.append(lt)
        gross = sum(line_totals) or 1
        rev = revenue(b)
        for it, lt in zip(b["items"], line_totals):
            name = it["beautician_name"] or "Unassigned"
            share = (lt / gross) * rev
            per_beautician.setdefault(name, {"name": name, "amount": 0.0, "bills": 0, "tips": 0.0})
            per_beautician[name]["amount"] += share
            per_beautician[name]["bills"] += 1
        if b.get("tip_amount", 0) > 0 and b.get("tip_beautician_name"):
            n = b["tip_beautician_name"]
            per_beautician.setdefault(n, {"name": n, "amount": 0.0, "bills": 0, "tips": 0.0})
            per_beautician[n]["tips"] += b["tip_amount"]

    per_beautician_list = sorted(
        [{"name": v["name"], "amount": round(v["amount"], 2), "bills": v["bills"], "tips": round(v["tips"], 2)} for v in per_beautician.values()],
        key=lambda x: x["amount"] + x["tips"], reverse=True
    )

    all_exp = await db.expenses.find(scope.filter(), {"_id": 0}).to_list(20000)
    today_exp = sum(e["amount"] for e in all_exp if e["date"] == today)
    month_exp = sum(e["amount"] for e in all_exp if e["date"].startswith(month))
    exp_by_cat_today: dict = {}
    for e in all_exp:
        if e["date"] != today: continue
        exp_by_cat_today[e["category"]] = exp_by_cat_today.get(e["category"], 0) + e["amount"]

    stock_docs = await db.stock_items.find(scope.filter(), {"_id": 0}).to_list(500)
    low_stock = [
        {"id": s["id"], "name": s["name"], "current_qty": s.get("current_qty", 0), "min_qty": s.get("min_qty", 0), "unit": s.get("unit", "piece")}
        for s in stock_docs if s.get("current_qty", 0) <= s.get("min_qty", 0)
    ]

    expiring_members = []
    # Members are tenant-scoped — any role can see expiring list
    mem_docs = await db.members.find({"tenant_id": tid, "active": True}, {"_id": 0}).to_list(1000)
    for m in mem_docs:
        m2 = _member_status(m)
        if m2["status"] in ("expiring_soon", "expired"):
            expiring_members.append({
                "id": m2["id"], "name": m2["name"], "phone": m2["phone"],
                "status": m2["status"], "days_left": m2.get("days_left"),
                "expires_at": m2.get("expires_at"),
            })
    expiring_members.sort(key=lambda x: x.get("days_left") if x.get("days_left") is not None else 9999)

    return {
        "today": {
            "total": round(today_total, 2), "count": today_count,
            "cash": round(today_cash, 2), "qr": round(today_qr, 2),
            "tips": round(today_tips, 2),
            "expenses": round(today_exp, 2),
            "net": round(today_total - today_exp, 2),
            "expenses_by_category": [
                {"category": k, "amount": round(v, 2)} for k, v in sorted(exp_by_cat_today.items(), key=lambda x: -x[1])
            ],
        },
        "month": {
            "total": round(month_total, 2), "count": month_count,
            "expenses": round(month_exp, 2),
            "net": round(month_total - month_exp, 2),
        },
        "per_beautician_month": per_beautician_list,
        "low_stock": low_stock,
        "expiring_members": expiring_members,
    }


@api_router.get("/reports/daily")
async def reports_daily(days: int = 30, scope: BranchScope = Depends(branch_scope)):
    if scope.user.get("role") == "staff":
        days = min(days, 2)
    all_bills = await db.bills.find(scope.filter(), {"_id": 0}).to_list(20000)
    all_exp = await db.expenses.find(scope.filter(), {"_id": 0}).to_list(20000)
    by_day: dict = {}
    for b in all_bills:
        day = b["created_at"][:10]
        by_day.setdefault(day, {"date": day, "total": 0.0, "count": 0, "cash": 0.0, "qr": 0.0, "tips": 0.0, "expenses": 0.0})
        rev = b.get("services_net", b.get("grand_total", 0) - b.get("tip_amount", 0))
        by_day[day]["total"] += rev
        by_day[day]["count"] += 1
        tip_qr = b.get("tip_qr_total", b.get("tip_amount", 0) if b.get("tip_via") == "qr" else 0)
        tip = b.get("tip_amount", 0)
        by_day[day]["cash"] += b.get("cash_amount", 0) - tip_qr
        by_day[day]["qr"] += b.get("qr_amount", 0) + tip_qr
        by_day[day]["tips"] += tip
    for e in all_exp:
        day = e["date"]
        by_day.setdefault(day, {"date": day, "total": 0.0, "count": 0, "cash": 0.0, "qr": 0.0, "tips": 0.0, "expenses": 0.0})
        by_day[day]["expenses"] += e["amount"]
    rows = sorted(by_day.values(), key=lambda x: x["date"], reverse=True)[:days]
    for r in rows:
        r["total"] = round(r["total"], 2)
        r["cash"] = round(r["cash"], 2)
        r["qr"] = round(r["qr"], 2)
        r["tips"] = round(r["tips"], 2)
        r["expenses"] = round(r["expenses"], 2)
        r["net"] = round(r["total"] - r["expenses"], 2)
    return rows


@api_router.get("/reports/range")
async def reports_range(
    preset: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    scope: BranchScope = Depends(branch_scope),
):
    tid = scope.tenant_id
    today = datetime.now(timezone.utc).date()

    if preset == "today":
        d_from = d_to = today
    elif preset == "yesterday":
        d_from = d_to = today - timedelta(days=1)
    elif preset == "week":
        d_from = today - timedelta(days=6); d_to = today
    elif preset == "month":
        d_from = today.replace(day=1); d_to = today
    elif preset == "last_month":
        first_this = today.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        d_from = last_prev.replace(day=1); d_to = last_prev
    else:
        try:
            d_from = datetime.strptime(from_date, "%Y-%m-%d").date() if from_date else today
            d_to = datetime.strptime(to_date, "%Y-%m-%d").date() if to_date else today
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date format (use YYYY-MM-DD)")

    if d_from > d_to:
        d_from, d_to = d_to, d_from

    if scope.user.get("role") == "staff":
        earliest = today - timedelta(days=1)
        if d_from < earliest: d_from = earliest
        if d_to < earliest: d_to = earliest

    from_str = d_from.strftime("%Y-%m-%d")
    to_str = d_to.strftime("%Y-%m-%d")

    bills = await db.bills.find(
        scope.filter({"created_at": {"$gte": f"{from_str}T00:00:00", "$lt": f"{to_str}T23:59:59.999999+00:00"}}),
        {"_id": 0},
    ).to_list(20000)
    exps = await db.expenses.find(
        scope.filter({"date": {"$gte": from_str, "$lte": to_str}}),
        {"_id": 0},
    ).to_list(20000)

    by_day: dict = {}
    cur = d_from
    while cur <= d_to:
        by_day[cur.strftime("%Y-%m-%d")] = {"date": cur.strftime("%Y-%m-%d"), "total": 0.0, "count": 0, "cash": 0.0, "qr": 0.0, "tips": 0.0, "expenses": 0.0}
        cur = cur + timedelta(days=1)

    for b in bills:
        day = b["created_at"][:10]
        if day not in by_day: continue
        rev = b.get("services_net", b.get("grand_total", 0) - b.get("tip_amount", 0))
        by_day[day]["total"] += rev
        by_day[day]["count"] += 1
        tip_via = b.get("tip_via")
        tip = b.get("tip_amount", 0)
        by_day[day]["cash"] += b.get("cash_amount", 0) - (tip if tip_via == "qr" else 0)
        by_day[day]["qr"] += b.get("qr_amount", 0) + (tip if tip_via == "qr" else 0)
        by_day[day]["tips"] += tip
    for e in exps:
        if e["date"] in by_day: by_day[e["date"]]["expenses"] += e["amount"]

    rows = sorted(by_day.values(), key=lambda x: x["date"], reverse=True)
    for r in rows:
        r["total"] = round(r["total"], 2)
        r["cash"] = round(r["cash"], 2)
        r["qr"] = round(r["qr"], 2)
        r["tips"] = round(r["tips"], 2)
        r["expenses"] = round(r["expenses"], 2)
        r["net"] = round(r["total"] - r["expenses"], 2)

    totals = {
        "total": round(sum(r["total"] for r in rows), 2),
        "count": sum(r["count"] for r in rows),
        "cash": round(sum(r["cash"] for r in rows), 2),
        "qr": round(sum(r["qr"] for r in rows), 2),
        "tips": round(sum(r["tips"] for r in rows), 2),
        "expenses": round(sum(r["expenses"] for r in rows), 2),
        "net": round(sum(r["net"] for r in rows), 2),
    }
    return {"from": from_str, "to": to_str, "days": len(rows), "totals": totals, "rows": rows}


# ============ Platform Admin (SaaS-level) ============
@api_router.get("/platform/tenants")
async def platform_list_tenants(user=Depends(require_platform_admin)):
    docs = await db.tenants.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    for d in docs:
        d["subscription"] = tenant_status(d)
        d["user_count"] = await db.users.count_documents({"tenant_id": d["id"]})
        d["bills_count"] = await db.bills.count_documents({"tenant_id": d["id"]})
    return docs


@api_router.get("/platform/stats")
async def platform_stats(user=Depends(require_platform_admin)):
    tenant_count = await db.tenants.count_documents({})
    active = await db.tenants.count_documents({"is_active": True, "subscription_status": {"$in": ["active", "trialing"]}})
    expired = await db.tenants.count_documents({"subscription_status": "expired"})
    users = await db.users.count_documents({})
    bills = await db.bills.count_documents({})
    return {"tenants": tenant_count, "active_tenants": active, "expired_tenants": expired, "users": users, "bills": bills}


@api_router.put("/platform/tenants/{tid}")
async def platform_update_tenant(tid: str, body: TenantUpdate, user=Depends(require_platform_admin)):
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        tenant = await load_tenant(tid)
        return {"tenant": tenant}
    updates["updated_at"] = now_iso()
    tenant = await db.tenants.find_one_and_update({"id": tid}, {"$set": updates}, return_document=True, projection={"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {"tenant": tenant}


class PlatformSubscriptionUpdate(BaseModel):
    subscription_status: Optional[Literal["trialing", "active", "expired", "suspended", "cancelled"]] = None
    subscription_plan: Optional[str] = None
    extend_days: Optional[int] = None
    is_active: Optional[bool] = None


@api_router.post("/platform/tenants/{tid}/subscription")
async def platform_set_subscription(tid: str, body: PlatformSubscriptionUpdate, user=Depends(require_platform_admin)):
    tenant = await load_tenant(tid)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    updates: dict = {"updated_at": now_iso()}
    if body.subscription_status is not None:
        updates["subscription_status"] = body.subscription_status
    if body.subscription_plan is not None:
        updates["subscription_plan"] = body.subscription_plan
    if body.is_active is not None:
        updates["is_active"] = bool(body.is_active)
    if body.extend_days:
        current_end = tenant.get("subscription_end_date") or tenant.get("trial_end_date") or datetime.now(timezone.utc).isoformat()
        try:
            end_dt = datetime.fromisoformat(current_end.replace("Z", "+00:00"))
        except Exception:
            end_dt = datetime.now(timezone.utc)
        if end_dt < datetime.now(timezone.utc):
            end_dt = datetime.now(timezone.utc)
        new_end = end_dt + timedelta(days=body.extend_days)
        updates["subscription_end_date"] = new_end.isoformat()
        updates["subscription_status"] = updates.get("subscription_status", "active")
        if not tenant.get("subscription_start_date"):
            updates["subscription_start_date"] = datetime.now(timezone.utc).isoformat()
    await db.tenants.update_one({"id": tid}, {"$set": updates})
    tenant2 = await load_tenant(tid)
    return {"tenant": tenant2, "subscription": tenant_status(tenant2)}


# ============ Seed (legacy demo API — still tenant-aware) ============
@api_router.post("/seed")
async def seed_data():
    """Legacy endpoint kept for compatibility. Creates the default Glow Up tenant only if empty."""
    await ensure_glow_up_tenant()
    return {"ok": True}


@api_router.get("/")
async def root():
    return {"message": "ParlourPilot SaaS API", "status": "ok"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============ Startup: Migration + Seed + Indexes ============
GLOW_UP_TENANT_ID = "glowup-tenant-0001"


async def ensure_indexes():
    """Create tenant-scoped indexes on all collections."""
    try:
        await db.tenants.create_index("id", unique=True)
        await db.tenants.create_index("slug", unique=True)
        await db.branches.create_index("id", unique=True)
        await db.branches.create_index([("tenant_id", 1), ("name", 1)])
        await db.users.create_index("id", unique=True)
        await db.users.create_index([("email", 1)])
        await db.users.create_index([("tenant_id", 1), ("email", 1)])
        await db.bills.create_index([("tenant_id", 1), ("branch_id", 1), ("created_at", -1)])
        await db.bills.create_index([("tenant_id", 1), ("branch_id", 1), ("bill_no", 1)])
        await db.services.create_index([("tenant_id", 1), ("branch_id", 1), ("name", 1)])
        await db.beauticians.create_index([("tenant_id", 1), ("branch_id", 1), ("name", 1)])
        await db.members.create_index([("tenant_id", 1), ("phone", 1)])
        await db.expenses.create_index([("tenant_id", 1), ("branch_id", 1), ("date", -1)])
        await db.stock_items.create_index([("tenant_id", 1), ("branch_id", 1), ("name", 1)])
        await db.stock_movements.create_index([("tenant_id", 1), ("branch_id", 1), ("created_at", -1)])
        await db.cash_closings.create_index([("tenant_id", 1), ("branch_id", 1), ("date", -1)])
        logger.info("Indexes ensured")
    except Exception as e:
        logger.warning(f"Index creation warning: {e}")


GLOW_UP_MAIN_BRANCH_ID = "glowup-branch-main"


async def ensure_glow_up_tenant():
    """Create the default 'Glow Up Unisex Salon' tenant + Main Branch and backfill existing data."""
    existing = await db.tenants.find_one({"id": GLOW_UP_TENANT_ID})
    if not existing:
        now = datetime.now(timezone.utc)
        far_future = (now + timedelta(days=365 * 10)).isoformat()
        doc = {
            "id": GLOW_UP_TENANT_ID,
            "business_name": "Glow Up Unisex Salon",
            "slug": "glow-up-unisex-salon",
            "logo": None,
            "owner_name": "Salon Admin",
            "email": "admin@glowup.com",
            "phone": "",
            "address": "Sullia",
            "city": "Sullia",
            "state": "Karnataka",
            "country": "India",
            "postal_code": "",
            "website": "",
            "currency": "INR",
            "timezone": "Asia/Kolkata",
            "tax_enabled": False,
            "tax_number": "",
            "tax_percentage": 0.0,
            "invoice_prefix": "GLOW",
            "receipt_header": "",
            "receipt_footer": "Thank you! Powered by ParlourPilot",
            "member_discount_pct": DEFAULT_MEMBER_DISCOUNT_PCT,
            "member_min_price": DEFAULT_MEMBER_MIN_PRICE,
            "subscription_plan": "professional",
            "subscription_status": "active",
            "trial_start_date": now.isoformat(),
            "trial_end_date": far_future,
            "subscription_start_date": now.isoformat(),
            "subscription_end_date": far_future,
            "is_active": True,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await db.tenants.insert_one(doc)
        logger.info("Created default Glow Up tenant")

    # Ensure Main Branch exists for Glow Up
    if not await db.branches.find_one({"id": GLOW_UP_MAIN_BRANCH_ID}):
        await db.branches.insert_one({
            "id": GLOW_UP_MAIN_BRANCH_ID,
            "tenant_id": GLOW_UP_TENANT_ID,
            "name": "Main Branch (Sullia)",
            "address": "Sullia",
            "city": "Sullia",
            "state": "Karnataka",
            "country": "India",
            "postal_code": "",
            "phone": "",
            "email": "admin@glowup.com",
            "logo": None,
            "tax_enabled": False,
            "tax_number": "",
            "tax_percentage": 0.0,
            "invoice_prefix": "GLOW",
            "receipt_header": "",
            "receipt_footer": "",
            "is_head": True,
            "parent_branch_id": None,
            "active": True,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        })
        logger.info("Created default Main Branch for Glow Up")

    # Backfill tenant_id + branch_id on existing docs
    collections_tenant = ["users", "members", "password_resets"]
    for c in collections_tenant:
        res = await db[c].update_many({"tenant_id": {"$exists": False}}, {"$set": {"tenant_id": GLOW_UP_TENANT_ID}})
        if res.modified_count:
            logger.info(f"Backfilled tenant_id on {res.modified_count} docs in {c}")

    # Branch-scoped collections
    branch_collections = ["bills", "services", "beauticians", "expenses", "stock_items", "stock_movements", "cash_closings"]
    for c in branch_collections:
        res = await db[c].update_many(
            {"tenant_id": {"$exists": False}}, {"$set": {"tenant_id": GLOW_UP_TENANT_ID, "branch_id": GLOW_UP_MAIN_BRANCH_ID}}
        )
        if res.modified_count:
            logger.info(f"Backfilled tenant_id+branch_id on {res.modified_count} docs in {c}")
        # Also add branch_id where missing (for docs that already had tenant_id)
        res2 = await db[c].update_many(
            {"tenant_id": GLOW_UP_TENANT_ID, "branch_id": {"$exists": False}},
            {"$set": {"branch_id": GLOW_UP_MAIN_BRANCH_ID}},
        )
        if res2.modified_count:
            logger.info(f"Backfilled branch_id on {res2.modified_count} docs in {c}")

    # Backfill user.branch_id for users lacking it
    await db.users.update_many(
        {"tenant_id": GLOW_UP_TENANT_ID, "branch_id": {"$exists": False}, "role": {"$ne": "platform_admin"}},
        {"$set": {"branch_id": GLOW_UP_MAIN_BRANCH_ID}},
    )

    # Ensure users have is_active flag
    await db.users.update_many({"is_active": {"$exists": False}}, {"$set": {"is_active": True}})


async def seed_initial_users():
    """Seed default admin/staff for Glow Up tenant only if no users exist yet."""
    if await db.users.count_documents({}) > 0:
        return
    admin_pw = os.environ.get("ADMIN_SEED_PASSWORD")
    staff_pw = os.environ.get("STAFF_SEED_PASSWORD")

    if admin_pw:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "tenant_id": GLOW_UP_TENANT_ID,
            "branch_id": GLOW_UP_MAIN_BRANCH_ID,
            "name": "Salon Admin",
            "email": "admin@glowup.com",
            "password_hash": hash_password(admin_pw),
            "role": "admin",
            "is_active": True,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        })
    if staff_pw:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "tenant_id": GLOW_UP_TENANT_ID,
            "branch_id": GLOW_UP_MAIN_BRANCH_ID,
            "name": "Front Desk",
            "email": "staff@glowup.com",
            "password_hash": hash_password(staff_pw),
            "role": "staff",
            "is_active": True,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        })

    beauticians = [
        {"name": "Ravi Kumar", "role": "Barber"},
        {"name": "Suresh Naik", "role": "Barber"},
        {"name": "Mahesh Shetty", "role": "Barber"},
        {"name": "Anitha Rao", "role": "Beautician"},
        {"name": "Deepa Bhat", "role": "Beautician"},
        {"name": "Latha Poojari", "role": "Beautician"},
        {"name": "Kavya Salian", "role": "Stylist"},
        {"name": "Priya Hegde", "role": "Stylist"},
    ]
    for b in beauticians:
        if not await db.beauticians.find_one({"tenant_id": GLOW_UP_TENANT_ID, "name": b["name"]}):
            await db.beauticians.insert_one({
                "id": str(uuid.uuid4()),
                "tenant_id": GLOW_UP_TENANT_ID,
                "name": b["name"],
                "role": b["role"],
                "phone": "",
                "active": True,
                "created_at": now_iso(),
            })

    services = [
        {"name": "Haircut (Men)", "price": 150, "category": "Hair"},
        {"name": "Haircut (Women)", "price": 350, "category": "Hair"},
        {"name": "Kids Haircut", "price": 120, "category": "Hair"},
        {"name": "Beard Trim", "price": 100, "category": "Hair"},
        {"name": "Shave", "price": 80, "category": "Hair"},
        {"name": "Hair Color", "price": 800, "category": "Hair"},
        {"name": "Head Massage", "price": 200, "category": "Spa"},
        {"name": "Facial (Basic)", "price": 500, "category": "Skin"},
        {"name": "Facial (Gold)", "price": 1200, "category": "Skin"},
        {"name": "Threading (Eyebrow)", "price": 60, "category": "Threading"},
        {"name": "Threading (Upper Lip)", "price": 40, "category": "Threading"},
        {"name": "Waxing (Half Arm)", "price": 250, "category": "Waxing"},
        {"name": "Waxing (Full Arm)", "price": 400, "category": "Waxing"},
        {"name": "Waxing (Legs)", "price": 500, "category": "Waxing"},
        {"name": "Manicure", "price": 350, "category": "Nails"},
        {"name": "Pedicure", "price": 450, "category": "Nails"},
        {"name": "Bridal Makeup", "price": 5000, "category": "Bridal"},
    ]
    for s in services:
        if not await db.services.find_one({"tenant_id": GLOW_UP_TENANT_ID, "name": s["name"]}):
            await db.services.insert_one({
                "id": str(uuid.uuid4()),
                "tenant_id": GLOW_UP_TENANT_ID,
                "name": s["name"],
                "price": float(s["price"]),
                "category": s["category"],
                "active": True,
                "created_at": now_iso(),
            })


async def seed_platform_admin():
    """Seed platform_admin user (SaaS operator) if PLATFORM_ADMIN_EMAIL & PWD are set."""
    email = os.environ.get("PLATFORM_ADMIN_EMAIL")
    pw = os.environ.get("PLATFORM_ADMIN_PASSWORD")
    if not (email and pw):
        return
    email = email.lower().strip()
    existing = await db.users.find_one({"email": email, "role": "platform_admin"})
    if existing:
        return
    await db.users.insert_one({
        "id": str(uuid.uuid4()),
        "tenant_id": None,
        "name": "Platform Admin",
        "email": email,
        "password_hash": hash_password(pw),
        "role": "platform_admin",
        "is_active": True,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    })
    logger.info(f"Seeded platform_admin: {email}")


@app.on_event("startup")
async def startup():
    try:
        await ensure_indexes()
        await ensure_glow_up_tenant()
        await seed_initial_users()
        await seed_platform_admin()
        logger.info("Startup migration + seed complete")
    except Exception as e:
        logger.error(f"Startup error: {e}", exc_info=True)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
