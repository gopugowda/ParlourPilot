"""
Seed a full demo dataset for the QA Verify Salon tenant so that Dashboard,
Reports, Staff Performance and Stock screens all light up with realistic,
multi-coloured charts and tables.

Usage:
    cd /app/backend && python3 scripts/seed_qa_demo.py

What it does (idempotent — safe to re-run):
1. Extends the tenant's subscription by 12 months.
2. Resets the owner password to `Gopi_1511`.
3. WIPES tenant-scoped services / stock_items / bills / attendance_logs
   / beauticians (except owner-linked) / non-owner staff users.
4. Creates 2 extra branches (total 3) for multi-branch analytics.
5. Seeds 25 services (Hair 10 / Skin 7 / Nails 4 / Massage 4) with item
   codes 001-025, mixed variable-price flag and Ladies/Men/Unisex.
6. Creates 6 staff users + their beautician profiles across branches.
7. Backdates 15 days of attendance (Mon–Sat, occasional overtime).
8. Backdates ~60 bills across 15 days, 3 branches, 4 payment modes.
9. Adds 15 stock items, ~4 of them below `min_qty` to trigger alerts.

Kept as pure Motor writes (no HTTP) because backend routes deliberately
force `date`/`billing_date` to "today" for staff writes — direct Mongo
inserts are the only way to backdate cleanly for demo purposes.
"""
import asyncio
import os
import random
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

# Load /app/backend/.env — MUST happen before importing `core`.
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402
from core import hash_password  # noqa: E402


# ---------- Configuration ----------
OWNER_EMAIL = "demo@parlourpilot.com"
NEW_OWNER_PASSWORD = "Gopi_1511"

IST = timezone(timedelta(hours=5, minutes=30))
NOW_UTC = datetime.now(timezone.utc)
NOW_IST = NOW_UTC.astimezone(IST)
TODAY_STR = NOW_IST.strftime("%Y-%m-%d")

# Deterministic-ish randomness — same seed → same dataset. Nice for QA.
random.seed(1511)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _uid() -> str:
    return str(uuid.uuid4())


# ---------- Static content the fake data draws from ----------
SERVICES = [
    # (code, name, category, price, additional_price, gender)
    ("001", "Ladies Haircut",             "Hair",    500,  0,   "ladies"),
    ("002", "Men Haircut",                "Hair",    250,  0,   "men"),
    ("003", "Kids Haircut",               "Hair",    200,  0,   "unisex"),
    ("004", "Hair Wash & Blow Dry",       "Hair",    350,  0,   "ladies"),
    ("005", "Hair Colour (Global)",       "Hair",   1500, 800,  "ladies"),  # variable
    ("006", "Highlights / Balayage",      "Hair",   2500, 1500, "ladies"),  # variable
    ("007", "Keratin Smoothing",          "Hair",   4500, 2000, "ladies"),  # variable
    ("008", "Beard Trim & Shape",         "Hair",    150,  0,   "men"),
    ("009", "Head Massage",               "Hair",    300,  0,   "unisex"),
    ("010", "Hair Spa",                   "Hair",    700, 300,  "ladies"),  # variable

    ("011", "Classic Facial",             "Skin",    600,  0,   "ladies"),
    ("012", "Gold Facial",                "Skin",   1200,  0,   "ladies"),
    ("013", "Anti-Aging Facial",          "Skin",   1800, 500,  "ladies"),  # variable
    ("014", "Cleanup",                    "Skin",    400,  0,   "ladies"),
    ("015", "Waxing Full Arms",           "Skin",    250,  0,   "ladies"),
    ("016", "Waxing Full Legs",           "Skin",    400,  0,   "ladies"),
    ("017", "Threading",                  "Skin",     50,  0,   "ladies"),

    ("018", "Manicure",                   "Nails",   400,  0,   "unisex"),
    ("019", "Pedicure",                   "Nails",   500,  0,   "unisex"),
    ("020", "Gel Nail Extensions",        "Nails",  1500, 500,  "ladies"),  # variable
    ("021", "Nail Art (per finger)",      "Nails",   100,  0,   "ladies"),

    ("022", "Swedish Full-Body Massage",  "Massage", 1500, 0,   "unisex"),
    ("023", "Deep Tissue Massage",        "Massage", 1800, 500, "unisex"),  # variable
    ("024", "Aromatherapy Massage",       "Massage", 2000, 0,   "unisex"),
    ("025", "Foot Reflexology",           "Massage",  800, 0,   "unisex"),
]

STAFF = [
    # (name, email, phone, role, basic_salary, target, commission, work_start, work_end)
    ("Priya Sharma",   "priya.sharma@qa-salon.com",   "9990001101", "Senior Stylist", 28000, 60000, 8,  "10:00", "20:00"),
    ("Rahul Menon",    "rahul.menon@qa-salon.com",    "9990001102", "Barber",         22000, 45000, 7,  "10:00", "20:00"),
    ("Anjali Verma",   "anjali.verma@qa-salon.com",   "9990001103", "Beautician",     24000, 50000, 7,  "10:00", "20:00"),
    ("Meera Iyer",     "meera.iyer@qa-salon.com",     "9990001104", "Nail Artist",    20000, 35000, 10, "11:00", "20:00"),
    ("Suresh Kumar",   "suresh.kumar@qa-salon.com",   "9990001105", "Massage Therapist", 25000, 40000, 6, "10:00", "19:00"),
    ("Neha Kapoor",    "neha.kapoor@qa-salon.com",    "9990001106", "Junior Stylist", 18000, 30000, 5,  "10:00", "19:00"),
]

STOCK = [
    # (name, unit, current_qty, min_qty, unit_cost)
    ("L'Oreal Majirel Colour 5.0",      "piece", 12, 5,  550),
    ("L'Oreal Majirel Colour 7.3",      "piece", 3,  5,  550),   # low
    ("Wella Koleston Colour 6/0",       "piece", 8,  4,  600),
    ("Schwarzkopf Bond Enforcer 30ml",  "piece", 15, 6,  1200),
    ("Matrix Biolage Shampoo 1L",       "bottle",4,  3,  850),
    ("Matrix Biolage Conditioner 1L",   "bottle",2,  3,  900),   # low
    ("O3+ Facial Kit (5-step)",         "kit",   10, 4,  1500),
    ("VLCC Bleach Cream 300g",          "tub",   6,  3,  350),
    ("Rica Wax Brazilian 800ml",        "tin",   1,  2,  1100),  # low
    ("Rica Wax Chocolate 800ml",        "tin",   4,  2,  1050),
    ("OPI Nail Polish (Assorted)",      "piece", 22, 10, 600),
    ("Sara Gel Base Coat",              "bottle",5,  3,  450),
    ("Biotique Almond Massage Oil 200ml","bottle",2, 3,  400),   # low
    ("Aroma Magic Lavender Oil 20ml",   "bottle",9,  4,  350),
    ("Disposable Head Caps (Pack of 100)","pack",8,  3,  250),
]


async def wipe_existing(db, tid, owner_uid, head_branch_id):
    """Clear tenant-scoped demo data before re-seeding."""
    print(f"[wipe] tenant={tid}")

    r = await db.services.delete_many({"tenant_id": tid})
    print(f"       services      -{r.deleted_count}")

    r = await db.stock_items.delete_many({"tenant_id": tid})
    print(f"       stock_items   -{r.deleted_count}")

    r = await db.bills.delete_many({"tenant_id": tid})
    print(f"       bills         -{r.deleted_count}")

    r = await db.attendance_logs.delete_many({"tenant_id": tid})
    print(f"       attendance    -{r.deleted_count}")

    # Keep owner's beautician doc if it exists (linked by user_id).
    r = await db.beauticians.delete_many({
        "tenant_id": tid,
        "user_id": {"$ne": owner_uid},
    })
    print(f"       beauticians   -{r.deleted_count}")

    # Also drop any beautician doc that isn't tied to a user at all (legacy).
    r = await db.beauticians.delete_many({
        "tenant_id": tid,
        "$or": [{"user_id": {"$exists": False}}, {"user_id": None}],
    })
    print(f"       beauticians⁺  -{r.deleted_count}")

    # Delete all non-owner users in this tenant.
    r = await db.users.delete_many({
        "tenant_id": tid,
        "id": {"$ne": owner_uid},
    })
    print(f"       users         -{r.deleted_count}")

    # Clean out any extra branches so branch-count assertions stay predictable.
    r = await db.branches.delete_many({
        "tenant_id": tid,
        "id": {"$ne": head_branch_id},
    })
    print(f"       branches      -{r.deleted_count}")


async def extend_subscription(db, tid):
    end = (NOW_UTC + timedelta(days=365)).isoformat()
    await db.tenants.update_one(
        {"id": tid},
        {"$set": {
            "subscription_status": "active",
            "subscription_plan": "growth",
            "plan_tier": "growth",
            "subscription_start_date": NOW_UTC.isoformat(),
            "subscription_end_date": end,
            "is_active": True,
            "updated_at": NOW_UTC.isoformat(),
        }},
    )
    print(f"[subscription] extended to {end}")


async def reset_owner_password(db, owner_uid):
    await db.users.update_one(
        {"id": owner_uid},
        {"$set": {
            "password_hash": hash_password(NEW_OWNER_PASSWORD),
            "updated_at": NOW_UTC.isoformat(),
        }},
    )
    print(f"[owner] password reset → {NEW_OWNER_PASSWORD!r}")


async def seed_branches(db, tid, head_branch_id):
    """Ensure exactly 3 branches — Head + 2 extras — for multi-branch analytics."""
    extras = [
        {
            "id": _uid(), "tenant_id": tid, "name": "Indiranagar Branch",
            "is_head": False, "invoice_prefix": "INR",
            "address": "100ft Rd, Indiranagar, Bangalore",
            "phone": "9999900002",
            "latitude": 12.9784, "longitude": 77.6408,
            "geofence_radius_m": 150,
            "is_active": True, "created_at": NOW_UTC.isoformat(),
        },
        {
            "id": _uid(), "tenant_id": tid, "name": "Whitefield Branch",
            "is_head": False, "invoice_prefix": "WFD",
            "address": "Phoenix Marketcity, Whitefield, Bangalore",
            "phone": "9999900003",
            "latitude": 12.9982, "longitude": 77.7472,
            "geofence_radius_m": 150,
            "is_active": True, "created_at": NOW_UTC.isoformat(),
        },
    ]
    await db.branches.insert_many(extras)
    # Also make sure the head branch has an invoice_prefix so bill numbers look pro.
    await db.branches.update_one(
        {"id": head_branch_id},
        {"$set": {
            "name": "MG Road Branch",
            "invoice_prefix": "MGR",
            "address": "MG Road, Bangalore",
            "latitude": 12.9756,
            "longitude": 77.6050,
            "geofence_radius_m": 150,
        }},
    )
    branches = [{"id": head_branch_id, "name": "MG Road Branch"}] + \
               [{"id": b["id"], "name": b["name"]} for b in extras]
    print(f"[branches] head + {len(extras)} → total {len(branches)}")
    return branches


async def seed_services(db, tid, head_branch_id):
    docs = []
    for code, name, category, price, addl, gender in SERVICES:
        svc_type = "Ladies" if gender == "ladies" else "Men" if gender == "men" else "Unisex"
        docs.append({
            "id": _uid(),
            "tenant_id": tid,
            "branch_id": head_branch_id,   # services live on head branch (all-branch visibility)
            "name": f"{code} - {name}",
            "price": float(price),
            "service_type": svc_type,
            "variable_price": addl > 0,
            "additional_price": float(addl),
            "gender": gender,
            "category": category,
            "tax_percentage": 0.0,
            "active": True,
            "item_code": code,
            "created_at": NOW_UTC.isoformat(),
        })
    await db.services.insert_many(docs)
    print(f"[services] +{len(docs)}  (Hair 10 / Skin 7 / Nails 4 / Massage 4)")
    return docs


async def seed_staff(db, tid, branches):
    """Insert user + beautician doc pairs across branches."""
    user_docs, beaut_docs = [], []
    per_branch = [branches[i % len(branches)]["id"] for i in range(len(STAFF))]
    for (name, email, phone, role, salary, target, commission, wstart, wend), bid in zip(STAFF, per_branch):
        uid = _uid()
        bdid = _uid()
        user_docs.append({
            "id": uid,
            "tenant_id": tid,
            "branch_id": bid,
            "name": name,
            "email": email,
            "phone": phone,
            "password_hash": hash_password("staff123"),
            "role": "staff",
            "is_active": True,
            "created_at": NOW_UTC.isoformat(),
            "updated_at": NOW_UTC.isoformat(),
        })
        beaut_docs.append({
            "id": bdid,
            "tenant_id": tid,
            "user_id": uid,
            "name": name,
            "email": email,
            "phone": phone,
            "role": role,
            "employee_id": f"EMP{len(user_docs):03d}",
            "basic_salary": float(salary),
            "branch_id": bid,
            "work_start": wstart,
            "work_end": wend,
            "week_off": ["Sunday"],
            "commission_pct": float(commission),
            "monthly_target": float(target),
            "address": "",
            "id_type": "",
            "id_number": "",
            "active": True,
            "created_at": NOW_UTC.isoformat(),
            "updated_at": NOW_UTC.isoformat(),
        })
    await db.users.insert_many(user_docs)
    await db.beauticians.insert_many(beaut_docs)
    print(f"[staff] +{len(user_docs)} users + beautician profiles across {len(branches)} branches")
    return list(zip(user_docs, beaut_docs))


async def seed_attendance(db, tid, staff_pairs):
    """15 days of check-in / check-out logs per staffer, skipping Sundays."""
    logs = []
    today_local = NOW_IST.date()
    for u, b in staff_pairs:
        for delta in range(15):
            d = today_local - timedelta(days=delta)
            if d.weekday() == 6:  # Sunday off
                continue
            # Base shift 10:00–19:30. Random ±20 min jitter on check-in.
            ci_hour, ci_min = 10, random.randint(-15, 20)
            co_hour, co_min = 19, random.randint(-15, 35)
            # ~1 in 5 days become an overtime day
            overtime = random.random() < 0.20
            if overtime:
                co_hour, co_min = 21, random.randint(0, 45)

            ci = datetime(d.year, d.month, d.day, ci_hour, 0, tzinfo=IST) + timedelta(minutes=ci_min)
            co = datetime(d.year, d.month, d.day, co_hour, 0, tzinfo=IST) + timedelta(minutes=co_min)
            logs.append({
                "id": _uid(), "tenant_id": tid,
                "user_id": u["id"], "user_name": u["name"], "user_role": "staff",
                "branch_id": u["branch_id"], "date": d.strftime("%Y-%m-%d"),
                "action": "check_in", "timestamp": _iso(ci),
                "latitude": None, "longitude": None,
                "distance_m": None, "within_geofence": True,
            })
            logs.append({
                "id": _uid(), "tenant_id": tid,
                "user_id": u["id"], "user_name": u["name"], "user_role": "staff",
                "branch_id": u["branch_id"], "date": d.strftime("%Y-%m-%d"),
                "action": "check_out", "timestamp": _iso(co),
                "latitude": None, "longitude": None,
                "distance_m": None, "within_geofence": True,
            })
    await db.attendance_logs.insert_many(logs)
    print(f"[attendance] +{len(logs)} logs  ({len(logs)//2} shifts)")


async def seed_stock(db, tid, head_branch_id):
    docs = []
    for name, unit, cur, minq, cost in STOCK:
        docs.append({
            "id": _uid(),
            "tenant_id": tid,
            "branch_id": head_branch_id,
            "name": name,
            "unit": unit,
            "current_qty": float(cur),
            "min_qty": float(minq),
            "unit_cost": float(cost),
            "notes": "",
            "created_at": NOW_UTC.isoformat(),
        })
    await db.stock_items.insert_many(docs)
    low = [d for d in docs if d["current_qty"] <= d["min_qty"]]
    print(f"[stock] +{len(docs)} items  ({len(low)} low-stock alerts active)")


async def seed_bills(db, tid, services, staff_pairs, branches):
    """~60 bills spread across 15 days × 3 branches × 4 payment modes."""
    customer_names = [
        "Ananya", "Rohit", "Sneha", "Vikram", "Kavya", "Aditya", "Divya",
        "Nikhil", "Ishaan", "Riya", "Aarav", "Meera", "Karan", "Pooja",
        "Aryan", "Tanya", "Sanjay", "Bhavna", "Jatin", "Ritika", "Manoj",
        "Sonia", "Varun", "Deepa", "Yash", "Preeti",
    ]
    bills, counters = [], {}
    today_local = NOW_IST.date()

    # Randomise date/branch distribution but keep totals aesthetic.
    for i in range(60):
        day_off = random.randint(0, 14)
        d = today_local - timedelta(days=day_off)
        billing_date = d.strftime("%Y-%m-%d")

        branch = random.choice(branches)
        # Staff at that branch (fallback to any if no match)
        branch_staff = [(u, b) for (u, b) in staff_pairs if u["branch_id"] == branch["id"]] or staff_pairs

        n_items = random.randint(2, 5)
        picked = random.sample(services, n_items)

        items = []
        subtotal = 0.0
        for svc in picked:
            u, b = random.choice(branch_staff)
            price = svc["price"]
            # Add extra for variable-price services ~half the time.
            if svc["variable_price"] and random.random() < 0.5:
                price += random.choice([200, 300, 500, 800])
            disc = random.choice([0, 0, 0, 5, 10])  # occasional discount
            items.append({
                "service_id": svc["id"],
                "service_name": svc["name"],
                "service_gender": svc["gender"],
                "price": float(price),
                "discount_pct": disc,
                "effective_discount_pct": disc,
                "tax_percentage": 0.0,
                "beautician_id": b["id"],
                "beautician_name": b["name"],
                "tip_amount": 0.0,
                "tip_via": None,
            })
            subtotal += price * (1 - disc / 100.0)

        subtotal = round(subtotal, 2)
        grand_total = subtotal  # no tax, no bill-level tip for simplicity

        # Payment mode distribution: Cash 35% / QR 30% / Card 20% / Split 15%.
        mode_pick = random.random()
        cash = qr = card = 0.0
        if mode_pick < 0.35:
            mode = "cash"; cash = grand_total
        elif mode_pick < 0.65:
            mode = "qr"; qr = grand_total
        elif mode_pick < 0.85:
            mode = "card"; card = grand_total
        else:
            mode = "split"
            # Split roughly 40/40/20 with rounding fixup.
            cash = round(grand_total * 0.4, 2)
            qr = round(grand_total * 0.4, 2)
            card = round(grand_total - cash - qr, 2)

        # Per-branch, per-day sequence counter → deterministic bill_no.
        key = (branch["id"], billing_date)
        counters[key] = counters.get(key, 0) + 1
        seq = counters[key]
        prefix = branch["name"][:3].upper()
        bill_no = f"{prefix}-{d.strftime('%y%m%d')}-{seq:03d}"

        created_at = datetime(d.year, d.month, d.day,
                              random.randint(11, 19), random.randint(0, 59),
                              tzinfo=IST)

        bills.append({
            "id": _uid(),
            "tenant_id": tid,
            "branch_id": branch["id"],
            "bill_no": bill_no,
            "customer_name": random.choice(customer_names),
            "customer_phone": f"98{random.randint(10000000, 99999999)}",
            "items": items,
            "subtotal": subtotal,
            "discount": 0.0,
            "tax_amount": 0.0,
            "services_net": subtotal,
            "is_member": False,
            "member_discount_pct_applied": 0.0,
            "tip_amount": 0.0,
            "tip_via": None,
            "tip_beautician_id": None,
            "tip_beautician_name": "",
            "tip_cash_total": 0.0,
            "tip_qr_total": 0.0,
            "tip_card_total": 0.0,
            "tip_owed_total": 0.0,
            "grand_total": grand_total,
            "payment_mode": mode,
            "cash_amount": cash,
            "qr_amount": qr,
            "card_amount": card,
            "split_v2": True,
            "notes": "",
            "created_by": staff_pairs[0][0]["id"],
            "created_by_name": staff_pairs[0][0]["name"],
            "created_at": _iso(created_at),
            "billing_date": billing_date,
        })

    await db.bills.insert_many(bills)
    modes = {}
    for b in bills:
        modes[b["payment_mode"]] = modes.get(b["payment_mode"], 0) + 1
    print(f"[bills] +{len(bills)}  breakdown={modes}  total_revenue={sum(b['grand_total'] for b in bills):.0f}")


async def main():
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ.get("DB_NAME", "ParlourPilot")
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    print(f"[connect] db={db_name}")

    owner = await db.users.find_one({"email": OWNER_EMAIL})
    if not owner:
        raise SystemExit(f"Owner {OWNER_EMAIL} not found — cannot seed.")
    tid = owner["tenant_id"]
    owner_uid = owner["id"]

    head = await db.branches.find_one({"tenant_id": tid, "is_head": True})
    if not head:
        raise SystemExit("Head branch missing — cannot seed.")
    head_branch_id = head["id"]

    await extend_subscription(db, tid)
    await reset_owner_password(db, owner_uid)
    await wipe_existing(db, tid, owner_uid, head_branch_id)

    branches = await seed_branches(db, tid, head_branch_id)
    services = await seed_services(db, tid, head_branch_id)
    staff_pairs = await seed_staff(db, tid, branches)
    await seed_attendance(db, tid, staff_pairs)
    await seed_stock(db, tid, head_branch_id)
    await seed_bills(db, tid, services, staff_pairs, branches)

    print("\n✅ Seed complete.")
    print(f"    Login: {OWNER_EMAIL} / {NEW_OWNER_PASSWORD}")
    print(f"    Tenant: {tid}")
    print(f"    Branches: {[b['name'] for b in branches]}")


if __name__ == "__main__":
    asyncio.run(main())
