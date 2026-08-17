"""Billing entitlements endpoint — plan tier, usage caps, upgrade eligibility.

Kept separate from `/tenants/me/subscription` so the mobile app can render its plan
card exactly like the web app without polluting the tenant payload.

Currently every tenant on this backend is on the "starter" tier (single plan). If/when
Growth/Legacy plans are introduced server-side, extend `_derive_plan_tier` accordingly.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from core import (
    db, get_current_user, tenant_id_of, load_tenant,
    tenant_status, SUBSCRIPTION_PLANS,
)

router = APIRouter()


def _derive_plan_tier(tenant: dict, subscription: dict) -> str:
    """All current tenants map to `starter`. Legacy grandfathered accounts are
    identified by an explicit `plan_tier` field on the tenant document."""
    return (tenant.get("plan_tier") or "starter").lower()


@router.get("/billing/entitlements")
async def get_billing_entitlements(user=Depends(get_current_user)):
    """Return the caller tenant's plan tier + usage caps + upgrade eligibility.

    Response shape (matches web spec so the mobile client can be UI-only):
        {
          plan_tier: "starter" | "growth" | "legacy",
          branch_count: int, branches_allowed: int,
          staff_count: int, staff_pool: int,
          can_upgrade: bool,
          grandfathered: bool,
          monthly_price_per_branch: number,
          yearly_price_per_branch: number,
          currency: "INR"
        }
    """
    if user.get("role") == "platform_admin":
        raise HTTPException(status_code=400, detail="Platform admins have no billing entitlements")
    tid = tenant_id_of(user)
    tenant = await load_tenant(tid)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    sub = tenant_status(tenant)
    plan_tier = _derive_plan_tier(tenant, sub)
    grandfathered = bool(tenant.get("grandfathered"))

    n_branches = await db.branches.count_documents({"tenant_id": tid, "active": True})
    n_staff = await db.users.count_documents({"tenant_id": tid, "is_active": True, "role": {"$in": ["staff", "admin", "owner"]}})

    # Sensible defaults for the starter tier; adjust when Growth is added server-side.
    caps = {
        "starter": {"branches_allowed": 1, "staff_pool": 5},
        "growth":  {"branches_allowed": 5, "staff_pool": 25},
        "legacy":  {"branches_allowed": 99, "staff_pool": 99},
    }.get(plan_tier, {"branches_allowed": 1, "staff_pool": 5})

    # Pricing per branch (monthly / yearly). Falls back to first plan in SUBSCRIPTION_PLANS.
    monthly_p = next((p for p in SUBSCRIPTION_PLANS if p.get("id") == "monthly"), SUBSCRIPTION_PLANS[0])
    yearly_p  = next((p for p in SUBSCRIPTION_PLANS if p.get("id") == "yearly"),  SUBSCRIPTION_PLANS[-1])

    return {
        "plan_tier": plan_tier,
        "plan_tier_label": {"starter": "Starter", "growth": "Growth", "legacy": "Legacy"}.get(plan_tier, "Starter"),
        "branch_count": n_branches,
        "branches_allowed": caps["branches_allowed"],
        "staff_count": n_staff,
        "staff_pool": caps["staff_pool"],
        "can_upgrade": plan_tier == "starter" and not grandfathered,
        "grandfathered": grandfathered,
        "monthly_price_per_branch": float(monthly_p.get("price_per_branch", monthly_p.get("price", 0))),
        "yearly_price_per_branch": float(yearly_p.get("price_per_branch", yearly_p.get("price", 0))),
        "currency": "INR",
    }
