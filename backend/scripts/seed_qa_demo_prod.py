"""
Seed demo dataset into the PRODUCTION ParlourPilot backend at
https://parlourpilot.com — the mobile app's real API host.

Uses the HTTP API only (no direct Mongo). Idempotent-ish: on each run
it wipes existing tenant data via DELETE endpoints before re-inserting.

What's seeded (matches the user's spec):
  1. Owner email flipped to `demo@parlourpilot.com` (password stays `Gopi_1511`).
  2. 3 branches total (Head + 2 new: Indiranagar, Whitefield).
  3. 25 services — Hair 10 / Skin 7 / Nails 4 / Massage 4 (codes 001-025),
     mix of variable-price + fixed, Ladies/Men/Unisex.
  4. 6 staff members (users + beautician profiles) spread across branches,
     realistic salary/target/commission.
  5. 15 stock items with 4 flagged as low-stock.
  6. ~60 backdated bills over the last 15 days × 3 branches × 4 payment modes.

⚠️  Attendance is NOT backdated — the API enforces "today" for check-in /
    check-out actions. If you need 15-day attendance history for demos,
    ask a dev to run a direct-DB script (production Mongo access
    required — not available from this container).

Run:  cd /app/backend && python3 scripts/seed_qa_demo_prod.py
"""
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests

# ---------- Configuration ----------
BASE = "https://parlourpilot.com"
LOGIN_EMAIL = "qa_verify_owner@parlourpilot-qa.com"  # current login email
LOGIN_PASSWORD = "Gopi_1511"
TARGET_EMAIL = "demo@parlourpilot.com"                # rename to this

IST = timezone(timedelta(hours=5, minutes=30))
NOW_UTC = datetime.now(timezone.utc)
NOW_IST = NOW_UTC.astimezone(IST)

random.seed(1511)  # deterministic fixtures


# ---------- HTTP helpers ----------
class Client:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.token: Optional[str] = None
        self.branch_id: Optional[str] = None

    def _headers(self) -> Dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        if self.branch_id:
            h["X-Branch-Id"] = self.branch_id
        return h

    def request(self, method: str, path: str, *, json=None, params=None) -> Any:
        url = f"{self.base}{path}"
        for attempt in range(3):
            try:
                r = requests.request(method, url, headers=self._headers(),
                                     json=json, params=params, timeout=30)
                if r.status_code >= 500 and attempt < 2:
                    time.sleep(1)
                    continue
                if r.status_code >= 400:
                    raise RuntimeError(f"{method} {path} → {r.status_code}: {r.text[:300]}")
                if r.text:
                    try:
                        return r.json()
                    except ValueError:
                        return r.text
                return None
            except requests.RequestException:
                if attempt >= 2:
                    raise
                time.sleep(1)
        raise RuntimeError("unreachable")

    def get(self, p, **kw):    return self.request("GET",    p, **kw)
    def post(self, p, **kw):   return self.request("POST",   p, **kw)
    def put(self, p, **kw):    return self.request("PUT",    p, **kw)
    def delete(self, p, **kw): return self.request("DELETE", p, **kw)


# ---------- Static content ----------
SERVICES = [
    ("001", "Ladies Haircut",             "Hair",    500,  0,   "ladies"),
    ("002", "Men Haircut",                "Hair",    250,  0,   "men"),
    ("003", "Kids Haircut",               "Hair",    200,  0,   "unisex"),
    ("004", "Hair Wash & Blow Dry",       "Hair",    350,  0,   "ladies"),
    ("005", "Hair Colour (Global)",       "Hair",   1500, 800,  "ladies"),
    ("006", "Highlights / Balayage",      "Hair",   2500, 1500, "ladies"),
    ("007", "Keratin Smoothing",          "Hair",   4500, 2000, "ladies"),
    ("008", "Beard Trim & Shape",         "Hair",    150,  0,   "men"),
    ("009", "Head Massage",               "Hair",    300,  0,   "unisex"),
    ("010", "Hair Spa",                   "Hair",    700, 300,  "ladies"),

    ("011", "Classic Facial",             "Skin",    600,  0,   "ladies"),
    ("012", "Gold Facial",                "Skin",   1200,  0,   "ladies"),
    ("013", "Anti-Aging Facial",          "Skin",   1800, 500,  "ladies"),
    ("014", "Cleanup",                    "Skin",    400,  0,   "ladies"),
    ("015", "Waxing Full Arms",           "Skin",    250,  0,   "ladies"),
    ("016", "Waxing Full Legs",           "Skin",    400,  0,   "ladies"),
    ("017", "Threading",                  "Skin",     50,  0,   "ladies"),

    ("018", "Manicure",                   "Nails",   400,  0,   "unisex"),
    ("019", "Pedicure",                   "Nails",   500,  0,   "unisex"),
    ("020", "Gel Nail Extensions",        "Nails",  1500, 500,  "ladies"),
    ("021", "Nail Art (per finger)",      "Nails",   100,  0,   "ladies"),

    ("022", "Swedish Full-Body Massage",  "Massage", 1500, 0,   "unisex"),
    ("023", "Deep Tissue Massage",        "Massage", 1800, 500, "unisex"),
    ("024", "Aromatherapy Massage",       "Massage", 2000, 0,   "unisex"),
    ("025", "Foot Reflexology",           "Massage",  800, 0,   "unisex"),
]

STAFF = [
    ("Priya Sharma",   "priya.sharma@qa-salon.com",   "9990001101", "Senior Stylist",    28000, 60000, 8,  "10:00", "20:00"),
    ("Rahul Menon",    "rahul.menon@qa-salon.com",    "9990001102", "Barber",            22000, 45000, 7,  "10:00", "20:00"),
    ("Anjali Verma",   "anjali.verma@qa-salon.com",   "9990001103", "Beautician",        24000, 50000, 7,  "10:00", "20:00"),
    ("Meera Iyer",     "meera.iyer@qa-salon.com",     "9990001104", "Nail Artist",       20000, 35000, 10, "11:00", "20:00"),
    ("Suresh Kumar",   "suresh.kumar@qa-salon.com",   "9990001105", "Massage Therapist", 25000, 40000, 6,  "10:00", "19:00"),
    ("Neha Kapoor",    "neha.kapoor@qa-salon.com",    "9990001106", "Junior Stylist",    18000, 30000, 5,  "10:00", "19:00"),
]

STOCK = [
    ("L'Oreal Majirel Colour 5.0",       "piece",  12, 5,  550),
    ("L'Oreal Majirel Colour 7.3",       "piece",   3, 5,  550),  # low
    ("Wella Koleston Colour 6/0",        "piece",   8, 4,  600),
    ("Schwarzkopf Bond Enforcer 30ml",   "piece",  15, 6,  1200),
    ("Matrix Biolage Shampoo 1L",        "bottle",  4, 3,  850),
    ("Matrix Biolage Conditioner 1L",    "bottle",  2, 3,  900),  # low
    ("O3+ Facial Kit (5-step)",          "kit",    10, 4,  1500),
    ("VLCC Bleach Cream 300g",           "tub",     6, 3,  350),
    ("Rica Wax Brazilian 800ml",         "tin",     1, 2,  1100), # low
    ("Rica Wax Chocolate 800ml",         "tin",     4, 2,  1050),
    ("OPI Nail Polish (Assorted)",       "piece",  22, 10, 600),
    ("Sara Gel Base Coat",               "bottle",  5, 3,  450),
    ("Biotique Almond Massage Oil 200ml","bottle",  2, 3,  400),  # low
    ("Aroma Magic Lavender Oil 20ml",    "bottle",  9, 4,  350),
    ("Disposable Head Caps (Pack 100)",  "pack",    8, 3,  250),
]


# ---------- Steps ----------
def login(c: Client) -> Dict[str, Any]:
    print(f"[login] {LOGIN_EMAIL}")
    r = c.post("/api/auth/login", json={"email": LOGIN_EMAIL, "password": LOGIN_PASSWORD})
    c.token = r["token"]
    return r["user"]


def wipe_tenant(c: Client, uid: str, head_branch_id: str) -> None:
    """Delete existing services / stock / bills / staff (except owner) / branches (except head)."""
    print("[wipe]")

    # Services
    svcs = c.get("/api/services") or []
    for s in svcs:
        c.delete(f"/api/services/{s['id']}")
    print(f"       services      -{len(svcs)}")

    # Stock
    stock = c.get("/api/stock") or []
    for s in stock:
        c.delete(f"/api/stock/{s['id']}")
    print(f"       stock         -{len(stock)}")

    # Bills — use unfiltered list (limit=1000 covers our use). Guard against missing route.
    try:
        bills = c.get("/api/bills", params={"limit": 1000}) or []
    except Exception:
        bills = []
    for b in bills:
        try:
            c.delete(f"/api/bills/{b['id']}")
        except Exception as e:
            print(f"       (bill del skipped: {e})")
    print(f"       bills         -{len(bills)}")

    # Team (except owner)
    team = c.get("/api/team") or []
    non_owner = [t for t in team if t.get("user_id") != uid]
    for t in non_owner:
        try:
            c.delete(f"/api/team?user_id={t['user_id']}")
        except Exception as e:
            print(f"       (team del skipped: {e})")
    print(f"       staff         -{len(non_owner)}")

    # Branches (except head)
    branches = c.get("/api/branches") or []
    extras = [b for b in branches if b["id"] != head_branch_id]
    for b in extras:
        try:
            c.delete(f"/api/branches/{b['id']}")
        except Exception as e:
            print(f"       (branch del skipped: {e})")
    print(f"       branches      -{len(extras)}")


def rename_owner(c: Client, uid: str) -> None:
    """Update the owner's login email to the demo address."""
    try:
        c.put(f"/api/auth/users/{uid}", json={"email": TARGET_EMAIL})
        print(f"[owner] email → {TARGET_EMAIL}")
    except Exception as e:
        # If already set, skip silently.
        if "Email already in use" in str(e):
            print(f"[owner] email already {TARGET_EMAIL}")
        else:
            raise


def create_branches(c: Client, head_id: str) -> List[Dict[str, Any]]:
    print("[branches] creating extras…")
    extras = [
        {
            "name": "Indiranagar Branch",
            "invoice_prefix": "INR",
            "address": "100ft Rd, Indiranagar, Bangalore",
            "city": "Bangalore", "state": "Karnataka",
            "phone": "9999900002",
            "latitude": 12.9784, "longitude": 77.6408,
            "geofence_radius_m": 150,
        },
        {
            "name": "Whitefield Branch",
            "invoice_prefix": "WFD",
            "address": "Phoenix Marketcity, Whitefield, Bangalore",
            "city": "Bangalore", "state": "Karnataka",
            "phone": "9999900003",
            "latitude": 12.9982, "longitude": 77.7472,
            "geofence_radius_m": 150,
        },
    ]
    created = [c.post("/api/branches", json=b) for b in extras]
    # Also pretty up the head branch.
    c.put(f"/api/branches/{head_id}", json={
        "name": "MG Road Branch",
        "invoice_prefix": "MGR",
        "address": "MG Road, Bangalore",
        "city": "Bangalore", "state": "Karnataka",
        "latitude": 12.9756, "longitude": 77.6050,
        "geofence_radius_m": 150,
    })
    all_branches = [{"id": head_id, "name": "MG Road Branch"}] + \
                   [{"id": b["id"], "name": b["name"]} for b in created]
    print(f"[branches] total {len(all_branches)}: {[b['name'] for b in all_branches]}")
    return all_branches


def create_services(c: Client, head_branch_id: str) -> List[Dict[str, Any]]:
    """Services get created against the Head branch — they're visible across branches."""
    c.branch_id = head_branch_id
    out = []
    for code, name, cat, price, addl, gender in SERVICES:
        r = c.post("/api/services", json={
            "name": f"{code} - {name}",
            "price": float(price),
            "additional_price": float(addl),
            "gender": gender,
            "category": cat,
            "active": True,
        })
        out.append(r)
    c.branch_id = None
    print(f"[services] +{len(out)}")
    return out


def create_staff(c: Client, branches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Create user + beautician-profile combos, one per STAFF entry."""
    out = []
    for i, (name, email, phone, role, salary, target, comm, ws, we) in enumerate(STAFF):
        bid = branches[i % len(branches)]["id"]
        payload = {
            "name": name,
            "email": email,
            "phone": phone,
            "password": "staff123",
            "access_level": "staff",
            "branch_id": bid,
            "is_active": True,
            "role": role,
            "employee_id": f"EMP{i+1:03d}",
            "basic_salary": float(salary),
            "monthly_target": float(target),
            "commission_pct": float(comm),
            "work_start": ws,
            "work_end": we,
            "week_off": ["Sunday"],
        }
        try:
            r = c.post("/api/team", json=payload)
            out.append({**r, "branch_id": bid, "name": name})
        except Exception as e:
            print(f"       (staff {name} skipped: {e})")
    print(f"[staff] +{len(out)} across {len(branches)} branches")
    return out


def create_stock(c: Client, head_branch_id: str) -> None:
    c.branch_id = head_branch_id
    n = 0
    for name, unit, cur, minq, cost in STOCK:
        c.post("/api/stock", json={
            "name": name, "unit": unit,
            "current_qty": float(cur), "min_qty": float(minq),
            "unit_cost": float(cost), "notes": "",
        })
        n += 1
    c.branch_id = None
    low = sum(1 for _, _, cur, minq, _ in STOCK if cur <= minq)
    print(f"[stock] +{n} items ({low} low-stock alerts)")


def create_bills(c: Client, services: List[Dict[str, Any]],
                 staff: List[Dict[str, Any]], branches: List[Dict[str, Any]]) -> None:
    """~60 bills spread over 15 days × 3 branches × mixed payment modes."""
    customer_names = [
        "Ananya", "Rohit", "Sneha", "Vikram", "Kavya", "Aditya", "Divya",
        "Nikhil", "Ishaan", "Riya", "Aarav", "Meera", "Karan", "Pooja",
        "Aryan", "Tanya", "Sanjay", "Bhavna", "Jatin", "Ritika", "Manoj",
        "Sonia", "Varun", "Deepa", "Yash", "Preeti",
    ]
    today_local = NOW_IST.date()
    total_created = 0
    payment_counts = {"cash": 0, "qr": 0, "card": 0, "split": 0}

    # Look up beautician_id for each staff (needed for line items). The
    # /team response gives us `beautician_id`.
    for i in range(60):
        day_off = random.randint(0, 14)
        d = today_local - timedelta(days=day_off)
        billing_date = d.strftime("%Y-%m-%d")
        branch = random.choice(branches)
        c.branch_id = branch["id"]

        # Prefer staff assigned to this branch
        branch_staff = [s for s in staff if s.get("branch_id") == branch["id"]] or staff

        n_items = random.randint(2, 5)
        picked = random.sample(services, n_items)

        items = []
        for svc in picked:
            st = random.choice(branch_staff)
            price = float(svc["price"])
            if svc.get("variable_price") and random.random() < 0.5:
                price += random.choice([200, 300, 500, 800])
            disc = random.choice([0, 0, 0, 5, 10])
            items.append({
                "service_id": svc["id"],
                "service_name": svc["name"],
                "service_gender": svc.get("gender"),
                "price": price,
                "discount_pct": disc,
                "tax_percentage": 0.0,
                "beautician_id": st.get("beautician_id"),
                "beautician_name": st.get("name"),
                "tip_amount": 0.0,
                "tip_via": None,
            })

        subtotal = sum(it["price"] * (1 - it["discount_pct"] / 100.0) for it in items)
        grand_total = round(subtotal, 2)

        mode_pick = random.random()
        payload: Dict[str, Any] = {
            "customer_name": random.choice(customer_names),
            "customer_phone": f"98{random.randint(10000000, 99999999)}",
            "items": items,
            "is_member": False,
            "billing_date": billing_date,
        }
        if mode_pick < 0.35:
            payload["payment_mode"] = "cash"
        elif mode_pick < 0.65:
            payload["payment_mode"] = "qr"
        elif mode_pick < 0.85:
            payload["payment_mode"] = "card"
        else:
            payload["payment_mode"] = "split"
            cash = round(grand_total * 0.4, 2)
            qr = round(grand_total * 0.4, 2)
            card = round(grand_total - cash - qr, 2)
            payload.update({"cash_amount": cash, "qr_amount": qr, "card_amount": card})

        try:
            c.post("/api/bills", json=payload)
            total_created += 1
            payment_counts[payload["payment_mode"]] += 1
        except Exception as e:
            print(f"       (bill {i+1} skipped: {e})")

    c.branch_id = None
    print(f"[bills] +{total_created}  breakdown={payment_counts}")


def main() -> int:
    c = Client(BASE)
    me = login(c)
    tid = me["tenant_id"]
    uid = me["id"]

    branches = c.get("/api/branches")
    head = next((b for b in branches if b.get("is_head")), None)
    if not head:
        print("No head branch — aborting.", file=sys.stderr)
        return 1
    head_id = head["id"]

    print(f"[tenant] {tid}  head_branch={head_id}")

    wipe_tenant(c, uid, head_id)
    rename_owner(c, uid)  # rename AFTER wipe (uses uid we already have)

    all_branches = create_branches(c, head_id)
    services = create_services(c, head_id)
    staff = create_staff(c, all_branches)
    create_stock(c, head_id)
    create_bills(c, services, staff, all_branches)

    print("\n✅ Production seed complete.")
    print(f"    Login: {TARGET_EMAIL} / {LOGIN_PASSWORD}")
    print(f"    Tenant: {tid}")
    print(f"    Branches: {[b['name'] for b in all_branches]}")
    print("\n⚠️  Attendance was NOT backdated (API forces today). If you need")
    print("    historic attendance, run a direct-Mongo insert on production.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
