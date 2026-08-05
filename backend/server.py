from fastapi import FastAPI, APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt as pyjwt


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT config
JWT_SECRET = os.environ.get('JWT_SECRET', 'glowup-salon-super-secret-key-change-me-in-prod')
JWT_ALG = 'HS256'
JWT_EXP_HOURS = 24 * 7  # 7 days

app = FastAPI(title="GLOW UP Salon Billing API")
api_router = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)


# ============ Utility ============
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_password(pwd: str) -> str:
    return bcrypt.hashpw(pwd.encode(), bcrypt.gensalt()).decode()


def verify_password(pwd: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pwd.encode(), hashed.encode())
    except Exception:
        return False


def create_token(user_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "role": role,
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
        return user
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


async def require_admin(user=Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ============ Models ============
class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Literal["admin", "staff"] = "staff"


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[Literal["admin", "staff"]] = None


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
    role: Optional[str] = "Stylist"  # e.g. Barber, Beautician, Stylist
    phone: Optional[str] = ""
    active: bool = True


class ServiceIn(BaseModel):
    name: str
    price: float
    category: Optional[str] = "General"
    active: bool = True


class BillItem(BaseModel):
    service_id: Optional[str] = None
    service_name: str
    price: float
    discount_pct: float = 0
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
    joined_at: Optional[str] = None  # YYYY-MM-DD
    expires_at: Optional[str] = None  # YYYY-MM-DD
    notes: Optional[str] = ""
    active: bool = True


EXPENSE_CATEGORIES = ["Material", "Utilities", "Rent", "Salary", "Maintenance", "Other"]


class ExpenseIn(BaseModel):
    category: str = "Other"
    description: str
    amount: float
    date: Optional[str] = None  # YYYY-MM-DD; defaults to today
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
    unit_cost: Optional[float] = None  # only for purchase
    notes: Optional[str] = ""


class CashClosingIn(BaseModel):
    date: Optional[str] = None  # YYYY-MM-DD; defaults today
    opening_balance: float = 0
    cash_expenses: float = 0
    actual_closing: float = 0
    notes: Optional[str] = ""


# ============ Helpers ============
MEMBER_DISCOUNT_PCT = 10.0
MEMBER_MIN_PRICE = 100.0


def apply_member_discount(items: List[BillItem], is_member: bool) -> List[dict]:
    """Return list of item dicts with effective_discount_pct + member_applied flag."""
    out = []
    for it in items:
        base = it.model_dump()
        member_pct = MEMBER_DISCOUNT_PCT if (is_member and it.price > MEMBER_MIN_PRICE) else 0.0
        eff = max(float(it.discount_pct or 0), member_pct)
        base["effective_discount_pct"] = round(eff, 2)
        base["member_applied"] = member_pct > 0 and member_pct >= (it.discount_pct or 0)
        out.append(base)
    return out


def compute_bill_totals(items_effective: List[dict]):
    subtotal = 0.0
    total_discount = 0.0
    for it in items_effective:
        line_gross = it["price"]
        line_disc = line_gross * (it.get("effective_discount_pct", 0) or 0) / 100.0
        subtotal += line_gross
        total_discount += line_disc
    services_net = round(subtotal - total_discount, 2)
    return round(subtotal, 2), round(total_discount, 2), services_net


# ============ Auth Routes ============
@api_router.post("/auth/register")
async def register(body: UserCreate, user=Depends(require_admin)):
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_doc = {
        "id": str(uuid.uuid4()),
        "name": body.name,
        "email": body.email.lower(),
        "password_hash": hash_password(body.password),
        "role": body.role,
        "created_at": now_iso(),
    }
    await db.users.insert_one(user_doc)
    return {"id": user_doc["id"], "name": user_doc["name"], "email": user_doc["email"], "role": user_doc["role"]}


@api_router.post("/auth/login")
async def login(body: LoginReq):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(user["id"], user["role"])
    return {
        "token": token,
        "user": {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"]},
    }


@api_router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return user


@api_router.get("/auth/users")
async def list_users(user=Depends(require_admin)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(500)
    return users


@api_router.put("/auth/users/{uid}")
async def update_user(uid: str, body: UserUpdate, user=Depends(require_admin)):
    target = await db.users.find_one({"id": uid}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    updates: dict = {}
    if body.name is not None: updates["name"] = body.name.strip()
    if body.email is not None:
        email_lower = body.email.lower()
        existing = await db.users.find_one({"email": email_lower, "id": {"$ne": uid}})
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")
        updates["email"] = email_lower
    if body.role is not None:
        # Prevent demoting the last admin
        if target["role"] == "admin" and body.role != "admin":
            admin_count = await db.users.count_documents({"role": "admin"})
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot demote the last admin")
        updates["role"] = body.role
    if not updates:
        return {k: v for k, v in target.items() if k != "password_hash"}
    result = await db.users.find_one_and_update(
        {"id": uid}, {"$set": updates},
        return_document=True, projection={"_id": 0, "password_hash": 0},
    )
    return result


@api_router.delete("/auth/users/{uid}")
async def delete_user(uid: str, user=Depends(require_admin)):
    if uid == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    target = await db.users.find_one({"id": uid})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["role"] == "admin":
        admin_count = await db.users.count_documents({"role": "admin"})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last admin")
    await db.users.delete_one({"id": uid})
    return {"ok": True}


@api_router.post("/auth/users/{uid}/reset-password")
async def admin_reset_password(uid: str, body: PasswordReset, user=Depends(require_admin)):
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    target = await db.users.find_one({"id": uid})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    await db.users.update_one({"id": uid}, {"$set": {"password_hash": hash_password(body.new_password)}})
    return {"ok": True}


@api_router.post("/auth/forgot-password")
async def forgot_password(body: ForgotPasswordReq):
    """Generate a password reset token. Returns token directly (no email service configured)."""
    email = body.email.lower()
    target = await db.users.find_one({"email": email})
    if not target:
        # Return generic ok to avoid email enumeration, but include no token
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
    # In production this would be emailed. For now returned inline so user can copy-paste.
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
    await db.users.update_one({"id": doc["user_id"]}, {"$set": {"password_hash": hash_password(body.new_password)}})
    await db.password_resets.update_one({"token": body.token}, {"$set": {"used": True, "used_at": now_iso()}})
    return {"ok": True}


# ============ Beauticians ============
@api_router.get("/beauticians")
async def list_beauticians(user=Depends(get_current_user)):
    docs = await db.beauticians.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    return docs


@api_router.post("/beauticians")
async def create_beautician(body: BeauticianIn, user=Depends(require_admin)):
    doc = {
        "id": str(uuid.uuid4()),
        "name": body.name,
        "role": body.role or "Stylist",
        "phone": body.phone or "",
        "active": body.active,
        "created_at": now_iso(),
    }
    await db.beauticians.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@api_router.put("/beauticians/{bid}")
async def update_beautician(bid: str, body: BeauticianIn, user=Depends(require_admin)):
    result = await db.beauticians.find_one_and_update(
        {"id": bid},
        {"$set": {"name": body.name, "role": body.role, "phone": body.phone or "", "active": body.active}},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Beautician not found")
    return result


@api_router.delete("/beauticians/{bid}")
async def delete_beautician(bid: str, user=Depends(require_admin)):
    result = await db.beauticians.delete_one({"id": bid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ============ Services ============
@api_router.get("/services")
async def list_services(user=Depends(get_current_user)):
    docs = await db.services.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    return docs


@api_router.post("/services")
async def create_service(body: ServiceIn, user=Depends(require_admin)):
    doc = {
        "id": str(uuid.uuid4()),
        "name": body.name,
        "price": float(body.price),
        "category": body.category or "General",
        "active": body.active,
        "created_at": now_iso(),
    }
    await db.services.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@api_router.put("/services/{sid}")
async def update_service(sid: str, body: ServiceIn, user=Depends(require_admin)):
    result = await db.services.find_one_and_update(
        {"id": sid},
        {"$set": {"name": body.name, "price": float(body.price), "category": body.category, "active": body.active}},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Service not found")
    return result


@api_router.delete("/services/{sid}")
async def delete_service(sid: str, user=Depends(require_admin)):
    result = await db.services.delete_one({"id": sid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ============ Bills ============
async def _next_bill_number() -> str:
    now = datetime.now(timezone.utc)
    prefix = now.strftime("%Y%m%d")
    count = await db.bills.count_documents({"bill_no": {"$regex": f"^{prefix}"}})
    return f"{prefix}-{count + 1:04d}"


@api_router.post("/bills")
async def create_bill(body: BillCreate, user=Depends(get_current_user)):
    if not body.items:
        raise HTTPException(status_code=400, detail="At least one service required")

    items_eff = apply_member_discount(body.items, body.is_member)
    subtotal, discount, services_net = compute_bill_totals(items_eff)

    # Aggregate per-line tips from items (each item can carry tip_amount + tip_via)
    line_tip_total = sum(float(it.get("tip_amount", 0) or 0) for it in items_eff)
    line_tip_qr = sum(float(it.get("tip_amount", 0) or 0) for it in items_eff if it.get("tip_via") == "qr")
    line_tip_cash = line_tip_total - line_tip_qr

    # Validate payment amounts (services only; tip handled separately)
    if body.payment_mode == "cash":
        cash_amt = services_net
        qr_amt = 0.0
    elif body.payment_mode == "qr":
        cash_amt = 0.0
        qr_amt = services_net
    else:  # split
        cash_amt = round(body.cash_amount, 2)
        qr_amt = round(body.qr_amount, 2)
        if abs((cash_amt + qr_amt) - services_net) > 0.01:
            raise HTTPException(status_code=400, detail=f"Split amounts must total {services_net}")

    tip_amount = round(max(0.0, float(body.tip_amount or 0)), 2)
    tip_via = body.tip_via if tip_amount > 0 else None
    if tip_amount > 0 and tip_via not in ("cash", "qr"):
        raise HTTPException(status_code=400, detail="tip_via required when tip_amount > 0")

    # Combine bill-level tip with per-line tips (per-line takes precedence via items)
    total_tip_amount = round(tip_amount + line_tip_total, 2)
    total_tip_qr = round((tip_amount if tip_via == "qr" else 0) + line_tip_qr, 2)
    total_tip_cash = round(total_tip_amount - total_tip_qr, 2)

    grand_total = round(services_net + total_tip_amount, 2)

    bill = {
        "id": str(uuid.uuid4()),
        "bill_no": await _next_bill_number(),
        "customer_name": body.customer_name or "Walk-in",
        "customer_phone": body.customer_phone or "",
        "items": items_eff,
        "subtotal": subtotal,
        "discount": discount,
        "services_net": services_net,
        "is_member": bool(body.is_member),
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
        "created_by": user["id"],
        "created_by_name": user["name"],
        "created_at": now_iso(),
    }
    await db.bills.insert_one(bill)
    return {k: v for k, v in bill.items() if k != "_id"}


@api_router.get("/bills")
async def list_bills(
    limit: int = 100,
    date: Optional[str] = None,  # YYYY-MM-DD
    payment_mode: Optional[str] = None,
    user=Depends(get_current_user),
):
    query: dict = {}
    # Staff can only see today's bills
    if user.get("role") == "staff":
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        query["created_at"] = {"$gte": f"{today}T00:00:00", "$lt": f"{today}T23:59:59.999999+00:00"}
    elif date:
        query["created_at"] = {"$gte": f"{date}T00:00:00", "$lt": f"{date}T23:59:59.999999+00:00"}
    if payment_mode and payment_mode != "all":
        query["payment_mode"] = payment_mode
    docs = await db.bills.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return docs


@api_router.put("/bills/{bid}")
async def update_bill(bid: str, body: BillCreate, user=Depends(require_admin)):
    """Admin-only edit for an existing processed bill. Preserves bill_no & created_at."""
    existing = await db.bills.find_one({"id": bid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Bill not found")
    if not body.items:
        raise HTTPException(status_code=400, detail="At least one service required")

    items_eff = apply_member_discount(body.items, body.is_member)
    subtotal, discount, services_net = compute_bill_totals(items_eff)

    line_tip_total = sum(float(it.get("tip_amount", 0) or 0) for it in items_eff)
    line_tip_qr = sum(float(it.get("tip_amount", 0) or 0) for it in items_eff if it.get("tip_via") == "qr")

    if body.payment_mode == "cash":
        cash_amt = services_net; qr_amt = 0.0
    elif body.payment_mode == "qr":
        cash_amt = 0.0; qr_amt = services_net
    else:
        cash_amt = round(body.cash_amount, 2); qr_amt = round(body.qr_amount, 2)
        if abs((cash_amt + qr_amt) - services_net) > 0.01:
            raise HTTPException(status_code=400, detail=f"Split amounts must total {services_net}")

    tip_amount = round(max(0.0, float(body.tip_amount or 0)), 2)
    tip_via = body.tip_via if tip_amount > 0 else None
    total_tip_amount = round(tip_amount + line_tip_total, 2)
    total_tip_qr = round((tip_amount if tip_via == "qr" else 0) + line_tip_qr, 2)
    total_tip_cash = round(total_tip_amount - total_tip_qr, 2)
    grand_total = round(services_net + total_tip_amount, 2)

    update = {
        "customer_name": body.customer_name or existing.get("customer_name", "Walk-in"),
        "customer_phone": body.customer_phone or "",
        "items": items_eff,
        "subtotal": subtotal,
        "discount": discount,
        "services_net": services_net,
        "is_member": bool(body.is_member),
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
        "edited_by": user["id"],
        "edited_by_name": user["name"],
        "edited_at": now_iso(),
    }
    result = await db.bills.find_one_and_update(
        {"id": bid}, {"$set": update},
        return_document=True, projection={"_id": 0},
    )
    return result


@api_router.get("/bills/{bid}")
async def get_bill(bid: str, user=Depends(get_current_user)):
    doc = await db.bills.find_one({"id": bid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Bill not found")
    # Staff can only view today's bills
    if user.get("role") == "staff":
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if not doc["created_at"].startswith(today):
            raise HTTPException(status_code=403, detail="Staff can only view today's bills")
    return doc


@api_router.delete("/bills/{bid}")
async def delete_bill(bid: str, user=Depends(require_admin)):
    result = await db.bills.delete_one({"id": bid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ============ Members ============
def _member_status(m: dict) -> dict:
    """Attach computed status: active | expired | expiring_soon | inactive."""
    m = dict(m)
    if not m.get("active"):
        m["status"] = "inactive"
        m["days_left"] = None
        return m
    exp = m.get("expires_at")
    if not exp:
        m["status"] = "active"
        m["days_left"] = None
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
        m["status"] = "active"
        m["days_left"] = None
    return m


@api_router.get("/members")
async def list_members(user=Depends(get_current_user)):
    docs = await db.members.find({}, {"_id": 0}).sort("name", 1).to_list(1000)
    return [_member_status(m) for m in docs]


@api_router.get("/members/lookup")
async def lookup_member(phone: str, user=Depends(get_current_user)):
    """Find an active membership by phone number. Used by New Bill auto-detect."""
    phone_clean = (phone or "").strip()
    if len(phone_clean) < 4:
        return {"found": False}
    doc = await db.members.find_one({"phone": phone_clean}, {"_id": 0})
    if not doc:
        return {"found": False}
    m = _member_status(doc)
    return {
        "found": True,
        "member": m,
        "is_active_member": m["status"] in ("active", "expiring_soon"),
    }


@api_router.post("/members")
async def create_member(body: MemberIn, user=Depends(require_admin)):
    phone_clean = body.phone.strip()
    if await db.members.find_one({"phone": phone_clean}):
        raise HTTPException(status_code=400, detail="Phone already registered as member")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
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
        "name": body.name.strip(),
        "phone": phone_clean,
        "joined_at": joined,
        "expires_at": expires,
        "notes": body.notes or "",
        "active": body.active,
        "created_at": now_iso(),
    }
    await db.members.insert_one(doc)
    return _member_status({k: v for k, v in doc.items() if k != "_id"})


@api_router.put("/members/{mid}")
async def update_member(mid: str, body: MemberIn, user=Depends(require_admin)):
    result = await db.members.find_one_and_update(
        {"id": mid},
        {"$set": {
            "name": body.name.strip(), "phone": body.phone.strip(),
            "joined_at": body.joined_at, "expires_at": body.expires_at,
            "notes": body.notes or "", "active": body.active,
        }},
        return_document=True, projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Member not found")
    return _member_status(result)


@api_router.delete("/members/{mid}")
async def delete_member(mid: str, user=Depends(require_admin)):
    result = await db.members.delete_one({"id": mid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ============ Expenses ============
@api_router.get("/expenses/categories")
async def expense_categories(user=Depends(get_current_user)):
    return EXPENSE_CATEGORIES


@api_router.get("/expenses")
async def list_expenses(
    date: Optional[str] = None,
    month: Optional[str] = None,
    limit: int = 200,
    user=Depends(get_current_user),
):
    query: dict = {}
    # Staff can only see today's expenses
    if user.get("role") == "staff":
        query["date"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    elif date:
        query["date"] = date
    elif month:
        query["date"] = {"$regex": f"^{month}"}
    docs = await db.expenses.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return docs


@api_router.post("/expenses")
async def create_expense(body: ExpenseIn, user=Depends(get_current_user)):
    if not (body.amount and body.amount > 0):
        raise HTTPException(status_code=400, detail="Amount must be > 0")
    if not body.description.strip():
        raise HTTPException(status_code=400, detail="Description required")
    cat = body.category if body.category in EXPENSE_CATEGORIES else "Other"
    d = body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    doc = {
        "id": str(uuid.uuid4()),
        "category": cat,
        "description": body.description.strip(),
        "amount": round(float(body.amount), 2),
        "date": d,
        "notes": body.notes or "",
        "created_by": user["id"],
        "created_by_name": user["name"],
        "created_at": now_iso(),
    }
    await db.expenses.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@api_router.put("/expenses/{eid}")
async def update_expense(eid: str, body: ExpenseIn, user=Depends(require_admin)):
    if not (body.amount and body.amount > 0):
        raise HTTPException(status_code=400, detail="Amount must be > 0")
    cat = body.category if body.category in EXPENSE_CATEGORIES else "Other"
    result = await db.expenses.find_one_and_update(
        {"id": eid},
        {"$set": {
            "category": cat, "description": body.description.strip(),
            "amount": round(float(body.amount), 2),
            "date": body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "notes": body.notes or "",
        }},
        return_document=True, projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Expense not found")
    return result


@api_router.delete("/expenses/{eid}")
async def delete_expense(eid: str, user=Depends(require_admin)):
    result = await db.expenses.delete_one({"id": eid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ============ Stock / Inventory ============
@api_router.get("/stock/units")
async def stock_units(user=Depends(get_current_user)):
    return STOCK_UNITS


@api_router.get("/stock")
async def list_stock(user=Depends(get_current_user)):
    docs = await db.stock_items.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    for d in docs:
        d["low_stock"] = d.get("current_qty", 0) <= d.get("min_qty", 0)
    return docs


@api_router.get("/stock/low")
async def list_low_stock(user=Depends(get_current_user)):
    docs = await db.stock_items.find({}, {"_id": 0}).to_list(500)
    return [d for d in docs if d.get("current_qty", 0) <= d.get("min_qty", 0)]


@api_router.post("/stock")
async def create_stock(body: StockItemIn, user=Depends(require_admin)):
    if await db.stock_items.find_one({"name": body.name.strip()}):
        raise HTTPException(status_code=400, detail="Item with this name already exists")
    doc = {
        "id": str(uuid.uuid4()),
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
async def update_stock(sid: str, body: StockItemIn, user=Depends(require_admin)):
    result = await db.stock_items.find_one_and_update(
        {"id": sid},
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
async def delete_stock(sid: str, user=Depends(require_admin)):
    result = await db.stock_items.delete_one({"id": sid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    await db.stock_movements.delete_many({"item_id": sid})
    return {"ok": True}


@api_router.post("/stock/movement")
async def create_stock_movement(body: StockMovementIn, user=Depends(get_current_user)):
    item = await db.stock_items.find_one({"id": body.item_id}, {"_id": 0})
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
    else:  # adjust — set qty to body.qty absolute
        new_qty = round(float(body.qty), 2)
        unit_cost = 0
        total_cost = 0

    update = {"current_qty": new_qty}
    if body.type == "purchase" and unit_cost > 0:
        update["unit_cost"] = unit_cost
    await db.stock_items.update_one({"id": body.item_id}, {"$set": update})

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    mv = {
        "id": str(uuid.uuid4()),
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
        "created_by": user["id"],
        "created_by_name": user["name"],
        "created_at": now_iso(),
    }
    await db.stock_movements.insert_one(mv)

    # Auto-create Material expense on purchase
    expense_created = None
    if body.type == "purchase" and total_cost > 0:
        exp = {
            "id": str(uuid.uuid4()),
            "category": "Material",
            "description": f"{item['name']} x{body.qty}{item['unit']}",
            "amount": total_cost,
            "date": today,
            "notes": f"Auto from stock purchase",
            "created_by": user["id"],
            "created_by_name": user["name"],
            "created_at": now_iso(),
            "stock_movement_id": mv["id"],
        }
        await db.expenses.insert_one(exp)
        expense_created = {k: v for k, v in exp.items() if k != "_id"}

    return {"movement": {k: v for k, v in mv.items() if k != "_id"}, "expense": expense_created, "new_qty": new_qty}


@api_router.get("/stock/{sid}/movements")
async def list_movements(sid: str, limit: int = 50, user=Depends(get_current_user)):
    docs = await db.stock_movements.find({"item_id": sid}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return docs



# ============ Cash Closing ============
async def _compute_day_totals(d: str):
    """Compute totals for a given date (UTC yyyy-mm-dd)."""
    bills = await db.bills.find(
        {"created_at": {"$gte": f"{d}T00:00:00", "$lt": f"{d}T23:59:59.999999+00:00"}},
        {"_id": 0},
    ).to_list(3000)
    services_net = sum(b.get("services_net", b.get("grand_total", 0) - b.get("tip_amount", 0)) for b in bills)
    tip_total = sum(b.get("tip_amount", 0) for b in bills)
    tip_qr = sum(b.get("tip_qr_total", b.get("tip_amount", 0) if b.get("tip_via") == "qr" else 0) for b in bills)
    cash_sales = sum(b.get("cash_amount", 0) for b in bills) - tip_qr
    upi_sales = sum(b.get("qr_amount", 0) for b in bills) + tip_qr
    exps = await db.expenses.find({"date": d}, {"_id": 0}).to_list(500)
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
async def cash_closing_summary(date: Optional[str] = None, user=Depends(get_current_user)):
    d = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    totals = await _compute_day_totals(d)

    # Suggested opening = previous day's actual closing
    prev = await db.cash_closings.find_one({"date": {"$lt": d}}, sort=[("date", -1)], projection={"_id": 0})
    suggested_opening = prev["actual_closing"] if prev else 0

    existing = await db.cash_closings.find_one({"date": d}, projection={"_id": 0})

    return {
        "date": d,
        **totals,
        "suggested_opening": round(suggested_opening, 2),
        "existing_closing": existing,
    }


@api_router.post("/cash-closing")
async def create_cash_closing(body: CashClosingIn, user=Depends(get_current_user)):
    d = body.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    totals = await _compute_day_totals(d)

    opening = round(float(body.opening_balance or 0), 2)
    cash_exp = round(float(body.cash_expenses or 0), 2)
    actual = round(float(body.actual_closing or 0), 2)
    expected = round(opening + totals["cash_sales"] - cash_exp, 2)
    difference = round(actual - expected, 2)

    doc = {
        "id": str(uuid.uuid4()),
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
        "submitted_by": user["id"],
        "submitted_by_name": user["name"],
        "submitted_at": now_iso(),
    }
    # One closing per date — upsert
    await db.cash_closings.replace_one({"date": d}, doc, upsert=True)
    return doc


@api_router.get("/cash-closing")
async def list_cash_closings(limit: int = 30, user=Depends(get_current_user)):
    docs = await db.cash_closings.find({}, {"_id": 0}).sort("date", -1).to_list(limit)
    return docs


@api_router.delete("/cash-closing/{cid}")
async def delete_cash_closing(cid: str, user=Depends(require_admin)):
    result = await db.cash_closings.delete_one({"id": cid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ============ Reports ============
@api_router.get("/reports/summary")
async def reports_summary(user=Depends(get_current_user)):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    month = datetime.now(timezone.utc).strftime("%Y-%m")

    all_bills = await db.bills.find({}, {"_id": 0}).to_list(10000)

    def revenue(b):
        # Salon revenue excludes tips
        return b.get("services_net", b.get("grand_total", 0) - b.get("tip_amount", 0))

    today_bills = [b for b in all_bills if b["created_at"].startswith(today)]
    month_bills = [b for b in all_bills if b["created_at"].startswith(month)]

    today_total = sum(revenue(b) for b in today_bills)
    today_count = len(today_bills)
    month_total = sum(revenue(b) for b in month_bills)
    month_count = len(month_bills)

    # Cash counter net = services cash in - tips paid out to beauticians via QR
    def tip_qr_of(b):
        # Prefer aggregate field, fallback to bill-level tip_via
        if "tip_qr_total" in b: return b.get("tip_qr_total", 0)
        return b.get("tip_amount", 0) if b.get("tip_via") == "qr" else 0
    today_cash = sum(b.get("cash_amount", 0) for b in today_bills) \
        - sum(tip_qr_of(b) for b in today_bills)
    today_qr = sum(b.get("qr_amount", 0) for b in today_bills) \
        + sum(tip_qr_of(b) for b in today_bills)
    today_tips = sum(b.get("tip_amount", 0) for b in today_bills)

    # Per beautician (month) — services revenue distribution
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
        # Tips attributed to the tip beautician
        if b.get("tip_amount", 0) > 0 and b.get("tip_beautician_name"):
            n = b["tip_beautician_name"]
            per_beautician.setdefault(n, {"name": n, "amount": 0.0, "bills": 0, "tips": 0.0})
            per_beautician[n]["tips"] += b["tip_amount"]

    per_beautician_list = sorted(
        [{"name": v["name"], "amount": round(v["amount"], 2), "bills": v["bills"], "tips": round(v["tips"], 2)} for v in per_beautician.values()],
        key=lambda x: x["amount"] + x["tips"], reverse=True
    )

    # Expenses
    all_exp = await db.expenses.find({}, {"_id": 0}).to_list(20000)
    today_exp = sum(e["amount"] for e in all_exp if e["date"] == today)
    month_exp = sum(e["amount"] for e in all_exp if e["date"].startswith(month))
    exp_by_cat_today: dict = {}
    for e in all_exp:
        if e["date"] != today:
            continue
        exp_by_cat_today[e["category"]] = exp_by_cat_today.get(e["category"], 0) + e["amount"]

    # Low stock alert
    stock_docs = await db.stock_items.find({}, {"_id": 0}).to_list(500)
    low_stock = [
        {"id": s["id"], "name": s["name"], "current_qty": s.get("current_qty", 0), "min_qty": s.get("min_qty", 0), "unit": s.get("unit", "piece")}
        for s in stock_docs if s.get("current_qty", 0) <= s.get("min_qty", 0)
    ]

    # Expiring members alert (only if admin)
    expiring_members = []
    if user.get("role") == "admin":
        mem_docs = await db.members.find({"active": True}, {"_id": 0}).to_list(1000)
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
async def reports_daily(days: int = 30, user=Depends(get_current_user)):
    # Staff can only see last 2 days
    if user.get("role") == "staff":
        days = min(days, 2)
    all_bills = await db.bills.find({}, {"_id": 0}).to_list(20000)
    all_exp = await db.expenses.find({}, {"_id": 0}).to_list(20000)
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
    preset: Optional[str] = None,  # today|yesterday|week|month|last_month|custom
    from_date: Optional[str] = None,  # YYYY-MM-DD
    to_date: Optional[str] = None,
    user=Depends(get_current_user),
):
    """Aggregated report for a date range. Staff limited to last 2 days."""
    today = datetime.now(timezone.utc).date()

    if preset == "today":
        d_from = d_to = today
    elif preset == "yesterday":
        d_from = d_to = today - timedelta(days=1)
    elif preset == "week":
        d_from = today - timedelta(days=6)
        d_to = today
    elif preset == "month":
        d_from = today.replace(day=1)
        d_to = today
    elif preset == "last_month":
        first_this = today.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        d_from = last_prev.replace(day=1)
        d_to = last_prev
    else:  # custom
        try:
            d_from = datetime.strptime(from_date, "%Y-%m-%d").date() if from_date else today
            d_to = datetime.strptime(to_date, "%Y-%m-%d").date() if to_date else today
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date format (use YYYY-MM-DD)")

    if d_from > d_to:
        d_from, d_to = d_to, d_from

    # Staff clamp: only allow last 2 days
    if user.get("role") == "staff":
        earliest = today - timedelta(days=1)  # today + yesterday
        if d_from < earliest:
            d_from = earliest
        if d_to < earliest:
            d_to = earliest

    from_str = d_from.strftime("%Y-%m-%d")
    to_str = d_to.strftime("%Y-%m-%d")

    # Fetch bills in range
    bills = await db.bills.find(
        {"created_at": {"$gte": f"{from_str}T00:00:00", "$lt": f"{to_str}T23:59:59.999999+00:00"}},
        {"_id": 0},
    ).to_list(20000)
    exps = await db.expenses.find(
        {"date": {"$gte": from_str, "$lte": to_str}},
        {"_id": 0},
    ).to_list(20000)

    # Aggregate per day
    by_day: dict = {}
    cur = d_from
    while cur <= d_to:
        by_day[cur.strftime("%Y-%m-%d")] = {"date": cur.strftime("%Y-%m-%d"), "total": 0.0, "count": 0, "cash": 0.0, "qr": 0.0, "tips": 0.0, "expenses": 0.0}
        cur = cur + timedelta(days=1)

    for b in bills:
        day = b["created_at"][:10]
        if day not in by_day:
            continue
        rev = b.get("services_net", b.get("grand_total", 0) - b.get("tip_amount", 0))
        by_day[day]["total"] += rev
        by_day[day]["count"] += 1
        tip_via = b.get("tip_via")
        tip = b.get("tip_amount", 0)
        by_day[day]["cash"] += b.get("cash_amount", 0) - (tip if tip_via == "qr" else 0)
        by_day[day]["qr"] += b.get("qr_amount", 0) + (tip if tip_via == "qr" else 0)
        by_day[day]["tips"] += tip
    for e in exps:
        if e["date"] in by_day:
            by_day[e["date"]]["expenses"] += e["amount"]

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

    return {
        "from": from_str,
        "to": to_str,
        "days": len(rows),
        "totals": totals,
        "rows": rows,
    }


@api_router.get("/members/expiring")
async def members_expiring(days: int = 30, user=Depends(require_admin)):
    """Members expiring within the next `days` days (or already expired)."""
    docs = await db.members.find({"active": True}, {"_id": 0}).to_list(1000)
    result = []
    for m in docs:
        m2 = _member_status(m)
        if m2["status"] in ("expiring_soon", "expired"):
            result.append(m2)
    result.sort(key=lambda x: x.get("days_left") if x.get("days_left") is not None else 9999)
    return result



# ============ Seed ============
@api_router.post("/seed")
async def seed_data():
    """Idempotent seed for demo data. Safe to call multiple times."""
    created = {"users": 0, "beauticians": 0, "services": 0}

    # Admin
    if not await db.users.find_one({"email": "admin@glowup.com"}):
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "name": "Salon Admin",
            "email": "admin@glowup.com",
            "password_hash": hash_password("admin123"),
            "role": "admin",
            "created_at": now_iso(),
        })
        created["users"] += 1

    if not await db.users.find_one({"email": "staff@glowup.com"}):
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "name": "Front Desk",
            "email": "staff@glowup.com",
            "password_hash": hash_password("staff123"),
            "role": "staff",
            "created_at": now_iso(),
        })
        created["users"] += 1

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
        if not await db.beauticians.find_one({"name": b["name"]}):
            await db.beauticians.insert_one({
                "id": str(uuid.uuid4()),
                "name": b["name"],
                "role": b["role"],
                "phone": "",
                "active": True,
                "created_at": now_iso(),
            })
            created["beauticians"] += 1

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
        if not await db.services.find_one({"name": s["name"]}):
            await db.services.insert_one({
                "id": str(uuid.uuid4()),
                "name": s["name"],
                "price": float(s["price"]),
                "category": s["category"],
                "active": True,
                "created_at": now_iso(),
            })
            created["services"] += 1

    return {"seeded": created, "ok": True}


@api_router.get("/")
async def root():
    return {"message": "GLOW UP Salon Billing API", "status": "ok"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def startup_seed():
    try:
        # Auto-seed on startup so demo is always ready
        if await db.users.count_documents({}) == 0:
            await seed_data()
            logger.info("Initial seed complete")
    except Exception as e:
        logger.error(f"Seed error: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
