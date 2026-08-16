"""Startup: index creation, tenant/user migration, and seeding."""
import os, uuid
from datetime import datetime, timezone, timedelta
from core import db, logger, now_iso, hash_password, DEFAULT_MEMBER_DISCOUNT_PCT, DEFAULT_MEMBER_MIN_PRICE

GLOW_UP_TENANT_ID = "glowup-tenant-0001"
GLOW_UP_MAIN_BRANCH_ID = "glowup-branch-main"


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
        # Backdated-billing: reports key off billing_date, so keep it indexed.
        await db.bills.create_index([("tenant_id", 1), ("branch_id", 1), ("billing_date", -1)])
        await db.services.create_index([("tenant_id", 1), ("branch_id", 1), ("name", 1)])
        await db.beauticians.create_index([("tenant_id", 1), ("branch_id", 1), ("name", 1)])
        await db.members.create_index([("tenant_id", 1), ("phone", 1)])
        await db.expenses.create_index([("tenant_id", 1), ("branch_id", 1), ("date", -1)])
        await db.stock_items.create_index([("tenant_id", 1), ("branch_id", 1), ("name", 1)])
        await db.stock_movements.create_index([("tenant_id", 1), ("branch_id", 1), ("created_at", -1)])
        await db.cash_closings.create_index([("tenant_id", 1), ("branch_id", 1), ("date", -1)])
        # Razorpay payment collections
        await db.pending_orders.create_index("razorpay_order_id", unique=True)
        await db.pending_orders.create_index([("tenant_id", 1), ("status", 1), ("created_at", -1)])
        await db.processed_webhooks.create_index("event_id", unique=True)
        await db.payments.create_index([("tenant_id", 1), ("created_at", -1)])
        logger.info("Indexes ensured")
    except Exception as e:
        logger.warning(f"Index creation warning: {e}")


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

    if not await db.branches.find_one({"id": GLOW_UP_MAIN_BRANCH_ID}):
        await db.branches.insert_one({
            "id": GLOW_UP_MAIN_BRANCH_ID,
            "tenant_id": GLOW_UP_TENANT_ID,
            "name": "Main Branch (Sullia)",
            "address": "Sullia", "city": "Sullia", "state": "Karnataka",
            "country": "India", "postal_code": "",
            "phone": "", "email": "admin@glowup.com", "logo": None,
            "tax_enabled": False, "tax_number": "", "tax_percentage": 0.0,
            "invoice_prefix": "GLOW", "receipt_header": "", "receipt_footer": "",
            "is_head": True, "parent_branch_id": None, "active": True,
            "created_at": now_iso(), "updated_at": now_iso(),
        })
        logger.info("Created default Main Branch for Glow Up")

    collections_tenant = ["users", "members", "password_resets"]
    for c in collections_tenant:
        res = await db[c].update_many({"tenant_id": {"$exists": False}}, {"$set": {"tenant_id": GLOW_UP_TENANT_ID}})
        if res.modified_count:
            logger.info(f"Backfilled tenant_id on {res.modified_count} docs in {c}")

    branch_collections = ["bills", "services", "beauticians", "expenses", "stock_items", "stock_movements", "cash_closings"]
    for c in branch_collections:
        res = await db[c].update_many(
            {"tenant_id": {"$exists": False}}, {"$set": {"tenant_id": GLOW_UP_TENANT_ID, "branch_id": GLOW_UP_MAIN_BRANCH_ID}}
        )
        if res.modified_count:
            logger.info(f"Backfilled tenant_id+branch_id on {res.modified_count} docs in {c}")
        res2 = await db[c].update_many(
            {"tenant_id": GLOW_UP_TENANT_ID, "branch_id": {"$exists": False}},
            {"$set": {"branch_id": GLOW_UP_MAIN_BRANCH_ID}},
        )
        if res2.modified_count:
            logger.info(f"Backfilled branch_id on {res2.modified_count} docs in {c}")

    await db.users.update_many(
        {"tenant_id": GLOW_UP_TENANT_ID, "branch_id": {"$exists": False}, "role": {"$ne": "platform_admin"}},
        {"$set": {"branch_id": GLOW_UP_MAIN_BRANCH_ID}},
    )
    await db.users.update_many({"is_active": {"$exists": False}}, {"$set": {"is_active": True}})


async def seed_initial_users():
    """Seed default admin/staff for Glow Up tenant only if the Glow Up tenant has no users yet.

    NOTE: The previous guard `count > 0: return` bailed out because the
    platform_admin user is created before this function runs on fresh DBs.
    Scope the check to the tenant to avoid skipping the demo seed.
    """
    if await db.users.count_documents({"tenant_id": GLOW_UP_TENANT_ID}) > 0:
        return
    admin_pw = os.environ.get("ADMIN_SEED_PASSWORD")
    staff_pw = os.environ.get("STAFF_SEED_PASSWORD")

    if admin_pw:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "tenant_id": GLOW_UP_TENANT_ID, "branch_id": GLOW_UP_MAIN_BRANCH_ID,
            "name": "Salon Admin", "email": "admin@glowup.com",
            "password_hash": hash_password(admin_pw),
            "role": "admin", "is_active": True,
            "created_at": now_iso(), "updated_at": now_iso(),
        })
    if staff_pw:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "tenant_id": GLOW_UP_TENANT_ID, "branch_id": GLOW_UP_MAIN_BRANCH_ID,
            "name": "Front Desk", "email": "staff@glowup.com",
            "password_hash": hash_password(staff_pw),
            "role": "staff", "is_active": True,
            "created_at": now_iso(), "updated_at": now_iso(),
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
                "name": b["name"], "role": b["role"], "phone": "", "active": True,
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
                "name": s["name"], "price": float(s["price"]), "category": s["category"],
                "active": True, "created_at": now_iso(),
            })


async def seed_platform_admin():
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
        "name": "Platform Admin", "email": email,
        "password_hash": hash_password(pw),
        "role": "platform_admin", "is_active": True,
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    logger.info(f"Seeded platform_admin: {email}")


async def backfill_billing_date():
    """Ensure every legacy bill carries a `billing_date` derived from `created_at[:10]`.

    Idempotent: only touches bills without a billing_date. Fully-forward-compatible with
    the web app which already writes billing_date verbatim.
    """
    try:
        # Uses aggregation pipeline update (Mongo 4.2+): sets billing_date = substr(created_at,0,10).
        res = await db.bills.update_many(
            {"billing_date": {"$exists": False}},
            [{"$set": {"billing_date": {"$substrBytes": [{"$ifNull": ["$created_at", ""]}, 0, 10]}}}],
        )
        if res.modified_count:
            logger.info(f"Backfilled billing_date on {res.modified_count} legacy bills")
    except Exception as e:
        logger.warning(f"billing_date backfill skipped: {e}")


async def run_startup():
    try:
        await ensure_indexes()
        await backfill_billing_date()
        # Demo seed is opt-in — set `ENABLE_DEMO_SEED=true` in .env to seed the
        # Glow Up demo tenant + services + beauticians. Default off so
        # production Atlas DBs stay clean.
        if (os.environ.get("ENABLE_DEMO_SEED", "false").lower() == "true"):
            await ensure_glow_up_tenant()
            await seed_initial_users()
        else:
            logger.info("Demo seed disabled (ENABLE_DEMO_SEED != true) — skipping Glow Up seed")
        # Platform admin always seeded when PLATFORM_ADMIN_PASSWORD is set — needed for SaaS ops
        await seed_platform_admin()
        logger.info("Startup migration + seed complete")
    except Exception as e:
        logger.error(f"Startup error: {e}", exc_info=True)
