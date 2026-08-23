"""Unified Team Management — merges Users + Beauticians into a single API.

Each row = 1 user login + 1 staff profile linked by `user_id` on the beautician.
Login identifier may be email OR phone (auto-detect in /auth/login).
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
import re, uuid

from core import (
    db, now_iso, hash_password, tenant_id_of, require_admin_active,
)

router = APIRouter()


def _digits(v: Optional[str]) -> str:
    return re.sub(r"\D+", "", v or "")


class TeamMemberIn(BaseModel):
    user_id: Optional[str] = None
    beautician_id: Optional[str] = None
    name: str
    email: Optional[str] = ""
    password: Optional[str] = ""
    access_level: Optional[str] = "staff"  # 'owner' | 'admin' | 'staff'
    branch_id: Optional[str] = None
    is_active: Optional[bool] = True
    role: Optional[str] = "Stylist"
    phone: Optional[str] = ""
    employee_id: Optional[str] = ""
    basic_salary: Optional[float] = 0.0
    work_start: Optional[str] = ""
    work_end: Optional[str] = ""
    week_off: Optional[List[str]] = None
    commission_pct: Optional[float] = 0.0
    monthly_target: Optional[float] = 0.0
    address: Optional[str] = ""
    id_type: Optional[str] = ""
    id_number: Optional[str] = ""


async def _find_owner_uid(tid: str) -> Optional[str]:
    """Earliest-created admin/owner in the tenant → treated as the salon owner."""
    docs = await db.users.find(
        {"tenant_id": tid, "role": {"$in": ["admin", "owner"]}},
        {"_id": 0, "id": 1, "created_at": 1},
    ).sort("created_at", 1).to_list(1)
    return docs[0]["id"] if docs else None


def _row(user: Optional[dict], beaut: Optional[dict], owner_uid: Optional[str]) -> dict:
    u = user or {}
    b = beaut or {}
    access = None
    if u:
        r = u.get("role")
        if u.get("id") == owner_uid or r == "owner":
            access = "owner"
        elif r == "admin":
            access = "admin"
        else:
            access = "staff"
    is_active = (
        bool(u.get("is_active", True)) if u
        else bool(b.get("active", True))
    )
    return {
        "id": (u.get("id") or b.get("id") or ""),
        "user_id": u.get("id"),
        "beautician_id": b.get("id"),
        "name": (u.get("name") or b.get("name") or ""),
        "email": (u.get("email") or b.get("email") or ""),
        "phone": (b.get("phone") or u.get("phone") or ""),
        "has_login": bool(u),
        "access_level": access,
        "branch_id": (b.get("branch_id") or u.get("branch_id")),
        "is_active": is_active,
        "role": (b.get("role") or ("Owner" if access == "owner" else "Staff")),
        "employee_id": b.get("employee_id", "") or "",
        "basic_salary": float(b.get("basic_salary", 0) or 0),
        "work_start": b.get("work_start", "") or "",
        "work_end": b.get("work_end", "") or "",
        "week_off": b.get("week_off", []) or [],
        "commission_pct": float(b.get("commission_pct", 0) or 0),
        "monthly_target": float(b.get("monthly_target", 0) or 0),
        "address": b.get("address", "") or "",
        "id_type": b.get("id_type", "") or "",
        "id_number": b.get("id_number", "") or "",
        "is_owner_locked": access == "owner",
    }


# ============ GET /team ============
@router.get("/team")
async def list_team(user=Depends(require_admin_active)):
    tid = tenant_id_of(user)
    users = await db.users.find({"tenant_id": tid}, {"_id": 0}).to_list(500)
    beauts = await db.beauticians.find({"tenant_id": tid}, {"_id": 0}).to_list(500)
    owner_uid = await _find_owner_uid(tid)

    # Link beauticians to users: prefer stored user_id, else email match.
    beaut_by_uid: Dict[str, dict] = {}
    beaut_by_email: Dict[str, dict] = {}
    for b in beauts:
        if b.get("user_id"):
            beaut_by_uid[b["user_id"]] = b
        if b.get("email"):
            beaut_by_email[str(b["email"]).lower()] = b

    used_bids = set()
    rows: List[dict] = []
    for u in users:
        b = beaut_by_uid.get(u["id"])
        if not b and u.get("email"):
            b = beaut_by_email.get(str(u["email"]).lower())
        if b:
            used_bids.add(b["id"])
            # Backfill link so the next request is cheap.
            if not b.get("user_id"):
                await db.beauticians.update_one(
                    {"id": b["id"], "tenant_id": tid},
                    {"$set": {"user_id": u["id"], "updated_at": now_iso()}},
                )
                b["user_id"] = u["id"]
        rows.append(_row(u, b, owner_uid))

    # Legacy profile-only beauticians (no login yet).
    for b in beauts:
        if b["id"] in used_bids:
            continue
        rows.append(_row(None, b, owner_uid))

    # Owner first, then admins, then staff, then no-login.
    def _sort_key(r: dict):
        rank = 0 if r["access_level"] == "owner" else 1 if r["access_level"] == "admin" else 2 if r["has_login"] else 3
        return (rank, (r["name"] or "").lower())
    rows.sort(key=_sort_key)
    return rows


# ============ POST /team ============
@router.post("/team")
async def create_team_member(body: TeamMemberIn, user=Depends(require_admin_active)):
    tid = tenant_id_of(user)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    identifier_email = (body.email or "").strip().lower()
    identifier_phone = _digits(body.phone)
    if not identifier_email and not identifier_phone:
        raise HTTPException(status_code=400, detail="Email or phone is required")
    if not body.password or len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    # Uniqueness within tenant
    if identifier_email:
        dup = await db.users.find_one({"tenant_id": tid, "email": identifier_email})
        if dup:
            raise HTTPException(status_code=400, detail="Email already registered in this salon")
    if identifier_phone:
        dup = await db.users.find_one({"tenant_id": tid, "phone": identifier_phone})
        if dup:
            raise HTTPException(status_code=400, detail="Phone already registered in this salon")

    role = "admin" if body.access_level == "admin" else "staff"
    branch_id = body.branch_id
    if role == "staff" and not branch_id:
        head = await db.branches.find_one({"tenant_id": tid, "is_head": True})
        branch_id = head["id"] if head else None

    now = now_iso()
    uid = str(uuid.uuid4())
    bid = str(uuid.uuid4())

    user_doc = {
        "id": uid,
        "tenant_id": tid,
        "branch_id": branch_id,
        "name": name,
        "email": identifier_email or "",
        "phone": identifier_phone or "",
        "password_hash": hash_password(body.password),
        "role": role,
        "is_active": bool(body.is_active if body.is_active is not None else True),
        "created_at": now,
        "updated_at": now,
    }
    await db.users.insert_one(user_doc)

    beaut_doc = {
        "id": bid,
        "tenant_id": tid,
        "user_id": uid,
        "name": name,
        "email": identifier_email or "",
        "phone": identifier_phone or "",
        "role": body.role or "Stylist",
        "employee_id": body.employee_id or "",
        "basic_salary": float(body.basic_salary or 0),
        "branch_id": branch_id,
        "work_start": body.work_start or "",
        "work_end": body.work_end or "",
        "week_off": body.week_off or [],
        "commission_pct": float(body.commission_pct or 0),
        "monthly_target": float(body.monthly_target or 0),
        "address": body.address or "",
        "id_type": body.id_type or "",
        "id_number": body.id_number or "",
        "active": bool(body.is_active if body.is_active is not None else True),
        "created_at": now,
        "updated_at": now,
    }
    await db.beauticians.insert_one(beaut_doc)

    owner_uid = await _find_owner_uid(tid)
    return _row(user_doc, beaut_doc, owner_uid)


# ============ PUT /team ============
@router.put("/team")
async def update_team_member(body: TeamMemberIn, user=Depends(require_admin_active)):
    tid = tenant_id_of(user)
    if not body.user_id and not body.beautician_id:
        raise HTTPException(status_code=400, detail="user_id or beautician_id required")

    owner_uid = await _find_owner_uid(tid)
    existing_user: Optional[dict] = None
    existing_beaut: Optional[dict] = None

    if body.user_id:
        existing_user = await db.users.find_one({"id": body.user_id, "tenant_id": tid}, {"_id": 0})
        if not existing_user:
            raise HTTPException(status_code=404, detail="User not found")
    if body.beautician_id:
        existing_beaut = await db.beauticians.find_one({"id": body.beautician_id, "tenant_id": tid}, {"_id": 0})
        if not existing_beaut:
            raise HTTPException(status_code=404, detail="Staff profile not found")

    # Follow beautician → user link if user_id wasn't sent.
    if existing_beaut and not existing_user and existing_beaut.get("user_id"):
        existing_user = await db.users.find_one({"id": existing_beaut["user_id"], "tenant_id": tid}, {"_id": 0})

    identifier_email = (body.email or "").strip().lower()
    identifier_phone = _digits(body.phone)
    name = (body.name or "").strip() or (existing_user or existing_beaut or {}).get("name", "")

    # Access level & owner lock
    is_owner_target = bool(existing_user and (existing_user.get("id") == owner_uid or existing_user.get("role") == "owner"))
    if is_owner_target:
        # Owner cannot change access_level.
        role = existing_user.get("role", "admin")
        is_active = True  # can't deactivate owner
    else:
        role = "admin" if body.access_level == "admin" else "staff"
        is_active = bool(body.is_active) if body.is_active is not None else (
            existing_user.get("is_active", True) if existing_user else existing_beaut.get("active", True)
        )

    branch_id = body.branch_id
    if branch_id is None:
        if existing_beaut and existing_beaut.get("branch_id"):
            branch_id = existing_beaut["branch_id"]
        elif existing_user and existing_user.get("branch_id"):
            branch_id = existing_user["branch_id"]
    if role == "staff" and not branch_id:
        head = await db.branches.find_one({"tenant_id": tid, "is_head": True})
        branch_id = head["id"] if head else None

    now = now_iso()

    # ---- Update existing user OR create login for legacy profile ----
    if existing_user:
        u_updates: Dict[str, Any] = {
            "name": name,
            "role": role,
            "branch_id": branch_id,
            "is_active": is_active,
            "updated_at": now,
        }
        # Email change: dedupe within tenant.
        if identifier_email and identifier_email != (existing_user.get("email") or ""):
            dup = await db.users.find_one(
                {"tenant_id": tid, "email": identifier_email, "id": {"$ne": existing_user["id"]}}
            )
            if dup:
                raise HTTPException(status_code=400, detail="Email already registered in this salon")
            u_updates["email"] = identifier_email
        # Phone change: dedupe.
        if identifier_phone and identifier_phone != (existing_user.get("phone") or ""):
            dup = await db.users.find_one(
                {"tenant_id": tid, "phone": identifier_phone, "id": {"$ne": existing_user["id"]}}
            )
            if dup:
                raise HTTPException(status_code=400, detail="Phone already registered in this salon")
            u_updates["phone"] = identifier_phone
        # Prevent demoting the last admin
        if existing_user.get("role") in ("admin", "owner") and role == "staff" and not is_owner_target:
            admin_count = await db.users.count_documents({"tenant_id": tid, "role": {"$in": ["admin", "owner"]}})
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot demote the last owner/admin")
        # Password (optional)
        if body.password:
            if len(body.password) < 6:
                raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
            u_updates["password_hash"] = hash_password(body.password)
        await db.users.update_one({"id": existing_user["id"], "tenant_id": tid}, {"$set": u_updates})
        existing_user = {**existing_user, **u_updates}
    elif (identifier_email or identifier_phone) and body.password:
        # Legacy profile-only → create login
        if len(body.password) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        if identifier_email:
            dup = await db.users.find_one({"tenant_id": tid, "email": identifier_email})
            if dup:
                raise HTTPException(status_code=400, detail="Email already registered in this salon")
        if identifier_phone:
            dup = await db.users.find_one({"tenant_id": tid, "phone": identifier_phone})
            if dup:
                raise HTTPException(status_code=400, detail="Phone already registered in this salon")
        uid = str(uuid.uuid4())
        existing_user = {
            "id": uid,
            "tenant_id": tid,
            "branch_id": branch_id,
            "name": name,
            "email": identifier_email or "",
            "phone": identifier_phone or "",
            "password_hash": hash_password(body.password),
            "role": role,
            "is_active": is_active,
            "created_at": now,
            "updated_at": now,
        }
        await db.users.insert_one(existing_user)
        if existing_beaut:
            await db.beauticians.update_one(
                {"id": existing_beaut["id"], "tenant_id": tid},
                {"$set": {"user_id": uid, "updated_at": now}},
            )
            existing_beaut["user_id"] = uid

    # ---- Update or create beautician profile ----
    def _pick(new, old, default=None):
        return new if new is not None and new != "" else (old if old is not None else default)

    if existing_beaut:
        b_updates: Dict[str, Any] = {
            "name": name,
            "email": identifier_email or existing_beaut.get("email", "") or (existing_user.get("email", "") if existing_user else ""),
            "phone": identifier_phone or existing_beaut.get("phone", "") or (existing_user.get("phone", "") if existing_user else ""),
            "role": body.role or existing_beaut.get("role", "Stylist"),
            "employee_id": body.employee_id if body.employee_id is not None else existing_beaut.get("employee_id", ""),
            "basic_salary": float(body.basic_salary) if body.basic_salary is not None else float(existing_beaut.get("basic_salary", 0) or 0),
            "branch_id": branch_id,
            "work_start": body.work_start if body.work_start is not None else existing_beaut.get("work_start", ""),
            "work_end": body.work_end if body.work_end is not None else existing_beaut.get("work_end", ""),
            "week_off": body.week_off if body.week_off is not None else existing_beaut.get("week_off", []),
            "commission_pct": float(body.commission_pct) if body.commission_pct is not None else float(existing_beaut.get("commission_pct", 0) or 0),
            "monthly_target": float(body.monthly_target) if body.monthly_target is not None else float(existing_beaut.get("monthly_target", 0) or 0),
            "address": body.address if body.address is not None else existing_beaut.get("address", ""),
            "id_type": body.id_type if body.id_type is not None else existing_beaut.get("id_type", ""),
            "id_number": body.id_number if body.id_number is not None else existing_beaut.get("id_number", ""),
            "active": is_active,
            "updated_at": now,
        }
        if existing_user:
            b_updates["user_id"] = existing_user["id"]
        await db.beauticians.update_one(
            {"id": existing_beaut["id"], "tenant_id": tid}, {"$set": b_updates}
        )
        existing_beaut = {**existing_beaut, **b_updates}
    elif existing_user:
        # User-only row (rare) → create matching profile
        bid = str(uuid.uuid4())
        existing_beaut = {
            "id": bid,
            "tenant_id": tid,
            "user_id": existing_user["id"],
            "name": name,
            "email": identifier_email or (existing_user.get("email", "")),
            "phone": identifier_phone or (existing_user.get("phone", "")),
            "role": body.role or "Stylist",
            "employee_id": body.employee_id or "",
            "basic_salary": float(body.basic_salary or 0),
            "branch_id": branch_id,
            "work_start": body.work_start or "",
            "work_end": body.work_end or "",
            "week_off": body.week_off or [],
            "commission_pct": float(body.commission_pct or 0),
            "monthly_target": float(body.monthly_target or 0),
            "address": body.address or "",
            "id_type": body.id_type or "",
            "id_number": body.id_number or "",
            "active": is_active,
            "created_at": now,
            "updated_at": now,
        }
        await db.beauticians.insert_one(existing_beaut)

    return _row(existing_user, existing_beaut, owner_uid)


# ============ DELETE /team ============
@router.delete("/team")
async def delete_team_member(
    user_id: Optional[str] = Query(None),
    beautician_id: Optional[str] = Query(None),
    user=Depends(require_admin_active),
):
    tid = tenant_id_of(user)
    if not user_id and not beautician_id:
        raise HTTPException(status_code=400, detail="user_id or beautician_id required")

    owner_uid = await _find_owner_uid(tid)
    target_user = None
    if user_id:
        target_user = await db.users.find_one({"id": user_id, "tenant_id": tid})
        if not target_user:
            # not a hard error — beautician may still be deletable
            pass

    # Owner protection
    if target_user and (target_user.get("id") == owner_uid or target_user.get("role") == "owner"):
        raise HTTPException(status_code=400, detail="Cannot delete the salon owner")

    # Last-admin protection
    if target_user and target_user.get("role") in ("admin", "owner"):
        n_admins = await db.users.count_documents({"tenant_id": tid, "role": {"$in": ["admin", "owner"]}})
        if n_admins <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last owner/admin")

    if beautician_id:
        await db.beauticians.delete_one({"id": beautician_id, "tenant_id": tid})
    if user_id:
        await db.users.delete_one({"id": user_id, "tenant_id": tid})
        # cleanup any beautician still linked to this user
        await db.beauticians.delete_many({"tenant_id": tid, "user_id": user_id})

    return {"ok": True}
