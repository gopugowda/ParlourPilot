"""GPS-gated attendance / punch-clock.

Endpoints (all under /api, Bearer auth):
  GET  /attendance/config       → branch geofence + shift window + user role
  POST /attendance/action       → check_in | check_out | break_start | break_end
  GET  /attendance/me/today     → status + today's logs for the logged-in staffer
  GET  /attendance/logs         → admin: raw logs (filter by date/user)
  GET  /attendance/summary      → admin: worked hours + overtime + breaks per staff

Gating rules:
  - owner/admin: never geofenced (server-side rule)
  - staff: check_in must be within `check_in_radius_m` of the branch geofence
  - if branch has no lat/long OR `geofence_radius_m` is null → no gating

Data model: `attendance_logs` collection = one doc per punch event.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta
import math, uuid

from core import (
    db, now_iso, tenant_id_of, get_current_user, require_admin_active,
)

router = APIRouter()

ACTIONS = {"check_in", "check_out", "break_start", "break_end"}
DEFAULT_CHECK_IN_RADIUS = 100
DEFAULT_AUTO_LOGOUT_RADIUS = 1000


# ============ Helpers ============
def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in meters."""
    R = 6371000.0
    to_rad = lambda d: d * math.pi / 180.0
    dlat = to_rad(lat2 - lat1)
    dlon = to_rad(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(to_rad(lat1)) * math.cos(to_rad(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def _today_date_str(tzoffset_min: int = 0) -> str:
    """Local date YYYY-MM-DD (UTC-based to stay deterministic across pods)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def _resolve_branch_for_user(user: dict) -> Optional[dict]:
    """Pick the branch: staff → their branch, admin/owner → head branch (fallback: first)."""
    tid = tenant_id_of(user)
    bid = user.get("branch_id")
    if bid:
        b = await db.branches.find_one({"id": bid, "tenant_id": tid}, {"_id": 0})
        if b:
            return b
    b = await db.branches.find_one({"tenant_id": tid, "is_head": True}, {"_id": 0})
    if b:
        return b
    return await db.branches.find_one({"tenant_id": tid}, {"_id": 0})


async def _my_beautician(user: dict) -> Optional[dict]:
    tid = tenant_id_of(user)
    b = await db.beauticians.find_one({"tenant_id": tid, "user_id": user["id"]}, {"_id": 0})
    if b:
        return b
    if user.get("email"):
        return await db.beauticians.find_one(
            {"tenant_id": tid, "email": str(user["email"]).lower()}, {"_id": 0}
        )
    return None


def _work_hours(beaut: Optional[dict], branch: Optional[dict]) -> Dict[str, str]:
    ws = (beaut or {}).get("work_start") or (branch or {}).get("work_start") or ""
    we = (beaut or {}).get("work_end") or (branch or {}).get("work_end") or ""
    return {"work_start": ws or "", "work_end": we or ""}


async def _today_logs(tid: str, uid: str) -> List[dict]:
    date = _today_date_str()
    cur = db.attendance_logs.find(
        {"tenant_id": tid, "user_id": uid, "date": date}, {"_id": 0}
    ).sort("timestamp", 1)
    return await cur.to_list(500)


def _current_status(logs: List[dict]) -> str:
    """Given today's logs sorted ascending, return current state."""
    state = "out"
    for l in logs:
        a = l.get("action")
        if a == "check_in":
            state = "in"
        elif a == "check_out":
            state = "out"
        elif a == "break_start":
            if state == "in":
                state = "break"
        elif a == "break_end":
            if state == "break":
                state = "in"
    return state


def _access_level(user: dict) -> str:
    r = user.get("role")
    if r == "owner":
        return "owner"
    if r == "admin":
        return "admin"
    return "staff"


# ============ GET /attendance/config ============
@router.get("/attendance/config")
async def attendance_config(user=Depends(get_current_user)):
    branch = await _resolve_branch_for_user(user)
    beaut = await _my_beautician(user)
    work = _work_hours(beaut, branch)
    access = _access_level(user)
    # gating_active = branch has both lat/long AND is a geofence-enabled branch
    lat = (branch or {}).get("latitude")
    lon = (branch or {}).get("longitude")
    radius = (branch or {}).get("geofence_radius_m") or DEFAULT_CHECK_IN_RADIUS
    gating_active = bool(lat is not None and lon is not None and access == "staff")
    return {
        "branch_id": (branch or {}).get("id"),
        "branch_name": (branch or {}).get("name") or "",
        "latitude": lat,
        "longitude": lon,
        "check_in_radius_m": int(radius) if radius else DEFAULT_CHECK_IN_RADIUS,
        "auto_logout_radius_m": int((branch or {}).get("auto_logout_radius_m") or DEFAULT_AUTO_LOGOUT_RADIUS),
        "gating_active": gating_active,
        "work_start": work["work_start"],
        "work_end": work["work_end"],
        "role": access,
    }


# ============ POST /attendance/action ============
class ActionBody(BaseModel):
    action: str = Field(..., description="check_in|check_out|break_start|break_end")
    latitude: Optional[float] = None
    longitude: Optional[float] = None


@router.post("/attendance/action")
async def attendance_action(body: ActionBody, user=Depends(get_current_user)):
    if body.action not in ACTIONS:
        raise HTTPException(status_code=400, detail="Invalid action")

    tid = tenant_id_of(user)
    uid = user["id"]
    branch = await _resolve_branch_for_user(user)
    access = _access_level(user)

    # ---- State validation ----
    logs = await _today_logs(tid, uid)
    state = _current_status(logs)
    if body.action == "check_in" and state == "in":
        raise HTTPException(status_code=400, detail="You're already checked in.")
    if body.action == "check_in" and state == "break":
        raise HTTPException(status_code=400, detail="You're on a break — end break instead of checking in.")
    if body.action == "check_out" and state == "out":
        raise HTTPException(status_code=400, detail="You're not checked in.")
    if body.action == "break_start" and state != "in":
        raise HTTPException(status_code=400, detail="Start a shift before taking a break.")
    if body.action == "break_end" and state != "break":
        raise HTTPException(status_code=400, detail="No break in progress.")

    # ---- Geofence (check_in only, staff only) ----
    distance_m: Optional[float] = None
    within_geofence: Optional[bool] = None
    b_lat = (branch or {}).get("latitude")
    b_lon = (branch or {}).get("longitude")
    radius = int((branch or {}).get("geofence_radius_m") or DEFAULT_CHECK_IN_RADIUS)
    gating_active = access == "staff" and b_lat is not None and b_lon is not None

    if body.action == "check_in" and gating_active:
        if body.latitude is None or body.longitude is None:
            raise HTTPException(status_code=400, detail="Location required — enable GPS and check in from the salon.")
        distance_m = _haversine(float(b_lat), float(b_lon), float(body.latitude), float(body.longitude))
        within_geofence = distance_m <= radius
        if not within_geofence:
            raise HTTPException(
                status_code=403,
                detail=f"You must be within {radius}m of the salon to check in. You're about {int(distance_m)}m away.",
            )
    elif body.latitude is not None and body.longitude is not None and b_lat is not None and b_lon is not None:
        # Store distance for audit even when not gating (admins, check_out, breaks)
        distance_m = _haversine(float(b_lat), float(b_lon), float(body.latitude), float(body.longitude))
        within_geofence = distance_m <= radius

    # ---- Write log ----
    log_id = str(uuid.uuid4())
    now = now_iso()
    doc = {
        "id": log_id,
        "tenant_id": tid,
        "user_id": uid,
        "user_name": user.get("name", ""),
        "user_role": access,
        "branch_id": (branch or {}).get("id"),
        "date": _today_date_str(),
        "action": body.action,
        "timestamp": now,
        "latitude": body.latitude,
        "longitude": body.longitude,
        "distance_m": distance_m,
        "within_geofence": within_geofence,
    }
    await db.attendance_logs.insert_one(doc)
    out = {k: v for k, v in doc.items() if k != "_id"}
    return out


# ============ GET /attendance/me/today ============
@router.get("/attendance/me/today")
async def attendance_me_today(user=Depends(get_current_user)):
    tid = tenant_id_of(user)
    logs = await _today_logs(tid, user["id"])
    return {"status": _current_status(logs), "logs": logs}


# ============ GET /attendance/logs (admin) ============
@router.get("/attendance/logs")
async def attendance_logs(
    date: Optional[str] = Query(None, description="YYYY-MM-DD (defaults to today)"),
    user_id: Optional[str] = Query(None),
    user=Depends(require_admin_active),
):
    tid = tenant_id_of(user)
    q: Dict[str, Any] = {"tenant_id": tid}
    q["date"] = date or _today_date_str()
    if user_id:
        q["user_id"] = user_id
    cur = db.attendance_logs.find(q, {"_id": 0}).sort("timestamp", 1)
    return await cur.to_list(2000)


# ============ GET /attendance/summary (admin) ============
def _compute_worked_seconds(logs: List[dict]) -> Dict[str, float]:
    """Given a chronologically-sorted list of a single user's logs across a period,
    compute total worked seconds (excluding breaks), break seconds, and detect any
    unclosed shifts."""
    worked = 0.0
    breaks = 0.0
    state = "out"
    shift_start: Optional[datetime] = None
    break_start: Optional[datetime] = None
    for l in logs:
        ts_raw = l.get("timestamp")
        if not ts_raw:
            continue
        try:
            ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
        except Exception:
            continue
        a = l.get("action")
        if a == "check_in":
            if state == "out":
                shift_start = ts
                state = "in"
        elif a == "check_out":
            if state in ("in", "break"):
                # If still on break, close the break first
                if state == "break" and break_start:
                    breaks += (ts - break_start).total_seconds()
                    break_start = None
                if shift_start:
                    # subtract cumulative breaks that happened during this shift
                    worked += (ts - shift_start).total_seconds()
                shift_start = None
                state = "out"
        elif a == "break_start":
            if state == "in":
                break_start = ts
                state = "break"
        elif a == "break_end":
            if state == "break" and break_start:
                breaks += (ts - break_start).total_seconds()
                break_start = None
                state = "in"
    # subtract breaks from worked (since we added the whole shift span above)
    worked -= breaks
    if worked < 0:
        worked = 0.0
    return {"worked_seconds": worked, "break_seconds": breaks}


@router.get("/attendance/summary")
async def attendance_summary(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    user=Depends(require_admin_active),
):
    tid = tenant_id_of(user)
    if not from_:
        # default: last 7 days
        end = datetime.now(timezone.utc).date()
        start = end - timedelta(days=6)
        from_ = start.isoformat()
        to = to or end.isoformat()
    if not to:
        to = _today_date_str()

    cur = db.attendance_logs.find(
        {"tenant_id": tid, "date": {"$gte": from_, "$lte": to}}, {"_id": 0}
    ).sort([("user_id", 1), ("timestamp", 1)])
    logs = await cur.to_list(20000)

    # Group by user
    per_user: Dict[str, List[dict]] = {}
    names: Dict[str, str] = {}
    for l in logs:
        uid = l.get("user_id")
        if not uid:
            continue
        per_user.setdefault(uid, []).append(l)
        if l.get("user_name") and uid not in names:
            names[uid] = l["user_name"]

    # Compute per-user hours + overtime + days worked
    # Overtime = worked_hours - (days_worked * 8h) if positive
    rows = []
    for uid, ll in per_user.items():
        # split by date for days-worked count
        dates = sorted(set(l.get("date") for l in ll if l.get("date")))
        totals = _compute_worked_seconds(ll)
        worked_h = totals["worked_seconds"] / 3600.0
        breaks_h = totals["break_seconds"] / 3600.0
        base = len(dates) * 8.0
        overtime_h = max(0.0, worked_h - base)
        rows.append({
            "user_id": uid,
            "name": names.get(uid) or "",
            "hours": round(worked_h, 2),
            "break_hours": round(breaks_h, 2),
            "overtime_hours": round(overtime_h, 2),
            "days_worked": len(dates),
        })
    rows.sort(key=lambda r: r["hours"], reverse=True)
    return {"from": from_, "to": to, "rows": rows}
