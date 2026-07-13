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

    grand_total = round(services_net + tip_amount, 2)

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
        "tip_amount": tip_amount,
        "tip_via": tip_via,
        "tip_beautician_id": body.tip_beautician_id if tip_amount > 0 else None,
        "tip_beautician_name": (body.tip_beautician_name or "") if tip_amount > 0 else "",
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

    # Cash counter net = services cash in - tip paid out to beautician when tip via QR
    today_cash = sum(b.get("cash_amount", 0) for b in today_bills) \
        - sum(b.get("tip_amount", 0) for b in today_bills if b.get("tip_via") == "qr")
    today_qr = sum(b.get("qr_amount", 0) for b in today_bills) \
        + sum(b.get("tip_amount", 0) for b in today_bills if b.get("tip_via") == "qr")
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
    }


@api_router.get("/reports/daily")
async def reports_daily(days: int = 30, user=Depends(get_current_user)):
    all_bills = await db.bills.find({}, {"_id": 0}).to_list(20000)
    all_exp = await db.expenses.find({}, {"_id": 0}).to_list(20000)
    by_day: dict = {}
    for b in all_bills:
        day = b["created_at"][:10]
        by_day.setdefault(day, {"date": day, "total": 0.0, "count": 0, "cash": 0.0, "qr": 0.0, "tips": 0.0, "expenses": 0.0})
        rev = b.get("services_net", b.get("grand_total", 0) - b.get("tip_amount", 0))
        by_day[day]["total"] += rev
        by_day[day]["count"] += 1
        tip_via = b.get("tip_via")
        tip = b.get("tip_amount", 0)
        by_day[day]["cash"] += b.get("cash_amount", 0) - (tip if tip_via == "qr" else 0)
        by_day[day]["qr"] += b.get("qr_amount", 0) + (tip if tip_via == "qr" else 0)
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
