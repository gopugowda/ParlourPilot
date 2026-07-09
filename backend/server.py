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
    notes: Optional[str] = ""


# ============ Helpers ============
def compute_bill_totals(items: List[BillItem]):
    subtotal = 0.0
    total_discount = 0.0
    for it in items:
        line_gross = it.price
        line_disc = line_gross * (it.discount_pct or 0) / 100.0
        subtotal += line_gross
        total_discount += line_disc
    grand_total = round(subtotal - total_discount, 2)
    return round(subtotal, 2), round(total_discount, 2), grand_total


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
async def create_beautician(body: BeauticianIn, user=Depends(get_current_user)):
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
async def update_beautician(bid: str, body: BeauticianIn, user=Depends(get_current_user)):
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
async def delete_beautician(bid: str, user=Depends(get_current_user)):
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
async def create_service(body: ServiceIn, user=Depends(get_current_user)):
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
async def update_service(sid: str, body: ServiceIn, user=Depends(get_current_user)):
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
async def delete_service(sid: str, user=Depends(get_current_user)):
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

    subtotal, discount, grand_total = compute_bill_totals(body.items)

    # Validate payment amounts
    if body.payment_mode == "cash":
        cash_amt = grand_total
        qr_amt = 0
    elif body.payment_mode == "qr":
        cash_amt = 0
        qr_amt = grand_total
    else:  # split
        cash_amt = round(body.cash_amount, 2)
        qr_amt = round(body.qr_amount, 2)
        if abs((cash_amt + qr_amt) - grand_total) > 0.01:
            raise HTTPException(status_code=400, detail=f"Split amounts must total {grand_total}")

    bill = {
        "id": str(uuid.uuid4()),
        "bill_no": await _next_bill_number(),
        "customer_name": body.customer_name or "Walk-in",
        "customer_phone": body.customer_phone or "",
        "items": [it.model_dump() for it in body.items],
        "subtotal": subtotal,
        "discount": discount,
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
    if date:
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
    return doc


@api_router.delete("/bills/{bid}")
async def delete_bill(bid: str, user=Depends(require_admin)):
    result = await db.bills.delete_one({"id": bid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ============ Reports ============
@api_router.get("/reports/summary")
async def reports_summary(user=Depends(get_current_user)):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    month = datetime.now(timezone.utc).strftime("%Y-%m")

    all_bills = await db.bills.find({}, {"_id": 0}).to_list(10000)

    today_total = sum(b["grand_total"] for b in all_bills if b["created_at"].startswith(today))
    today_count = sum(1 for b in all_bills if b["created_at"].startswith(today))
    month_total = sum(b["grand_total"] for b in all_bills if b["created_at"].startswith(month))
    month_count = sum(1 for b in all_bills if b["created_at"].startswith(month))

    today_cash = sum(b["cash_amount"] for b in all_bills if b["created_at"].startswith(today))
    today_qr = sum(b["qr_amount"] for b in all_bills if b["created_at"].startswith(today))

    # Per beautician (month)
    per_beautician: dict = {}
    for b in all_bills:
        if not b["created_at"].startswith(month):
            continue
        # Distribute grand_total proportionally across items by (price*(1-disc%))
        line_totals = []
        for it in b["items"]:
            lt = it["price"] * (1 - it.get("discount_pct", 0) / 100.0)
            line_totals.append(lt)
        gross = sum(line_totals) or 1
        for it, lt in zip(b["items"], line_totals):
            name = it["beautician_name"] or "Unassigned"
            share = (lt / gross) * b["grand_total"]
            per_beautician.setdefault(name, {"name": name, "amount": 0.0, "bills": 0})
            per_beautician[name]["amount"] += share
            per_beautician[name]["bills"] += 1

    per_beautician_list = sorted(
        [{"name": v["name"], "amount": round(v["amount"], 2), "bills": v["bills"]} for v in per_beautician.values()],
        key=lambda x: x["amount"], reverse=True
    )

    return {
        "today": {"total": round(today_total, 2), "count": today_count, "cash": round(today_cash, 2), "qr": round(today_qr, 2)},
        "month": {"total": round(month_total, 2), "count": month_count},
        "per_beautician_month": per_beautician_list,
    }


@api_router.get("/reports/daily")
async def reports_daily(days: int = 30, user=Depends(get_current_user)):
    all_bills = await db.bills.find({}, {"_id": 0}).to_list(20000)
    by_day: dict = {}
    for b in all_bills:
        day = b["created_at"][:10]
        by_day.setdefault(day, {"date": day, "total": 0.0, "count": 0, "cash": 0.0, "qr": 0.0})
        by_day[day]["total"] += b["grand_total"]
        by_day[day]["count"] += 1
        by_day[day]["cash"] += b["cash_amount"]
        by_day[day]["qr"] += b["qr_amount"]
    rows = sorted(by_day.values(), key=lambda x: x["date"], reverse=True)[:days]
    for r in rows:
        r["total"] = round(r["total"], 2)
        r["cash"] = round(r["cash"], 2)
        r["qr"] = round(r["qr"], 2)
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
