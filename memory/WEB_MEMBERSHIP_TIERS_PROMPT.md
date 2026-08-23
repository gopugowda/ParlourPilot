# Web App Parity Prompt — Membership Tiers on Salon Settings

Paste this to the ParlourPilot **web app** agent.

## Goal
Add a **Membership Tiers** section to the Salon Settings page. This exists on mobile and needs to mirror on web so tiers stay in sync across clients (they already share the same MongoDB and tenant document).

## Where it lives
Salon Settings screen → new section **below** "Member pricing" and **above** "Automated report emails".

## Backend
Already supported. `TenantUpdate.member_tiers: Optional[list] = None` (list of objects) is accepted on `PUT /api/tenants/me`. No new endpoints required.

## Data shape (each tier)
```json
{
  "id": "regular",
  "name": "Regular",
  "discount_pct": 10,
  "min_price": 100
}
```
- `id` — stable slug/uuid string (used to link members to tiers)
- `name` — human label shown to staff
- `discount_pct` — 0–100 float, overrides Default member discount % for this tier
- `min_price` — minimum service ₹ for the discount to apply

## UI spec (match existing Salon Settings card style)
- Section title: **Membership tiers**
- Description: "Assign a tier to each member for a custom % and min price. Order shown to staff when creating a member."
- Header right: **+ Add tier** button (secondary, brand color outline)
- Rows table:
  - Cols: `Name` (60%), `Discount %` (15%), `Min price ₹` (15%), Actions (delete)
  - Each row inline-editable
- Empty state (if list is empty): centered muted text "No tiers yet — tap Add tier."
- Default seed when tenant has no tiers yet:
  ```js
  [
    { id: "regular", name: "Regular", discount_pct: 10, min_price: 100 },
    { id: "student", name: "Student", discount_pct: 20, min_price: 100 }
  ]
  ```
- New tier button generates id like `tier_${Date.now()}` and default `{ name: 'New Tier', discount_pct: 15, min_price: 100 }`.

## Save flow
Include `member_tiers: [...]` in the same `PUT /api/tenants/me` payload used by the existing Save button. Do not create a separate save endpoint.

## Members screen linkage (already exists on mobile — mirror on web)
On the Member add/edit modal, add a **Tier** dropdown (options = tenant.member_tiers). When a tier is picked, auto-fill the member's discount_pct and min_price from that tier, but let the user override per-member. Store `member.tier_id` on the member document.

## Acceptance checklist
- Membership tiers section visible on Salon Settings between Member pricing and Automated report emails.
- Add tier / edit inline / delete work.
- Save persists to `tenant.member_tiers`.
- Refresh reloads tiers from server.
- Members screen shows a tier picker that pre-fills discount/min-price.
- Mobile users see the same tiers immediately (shared backend confirmed).
