# Web App Parity Prompt — Configurable Check-in Radius on Branch Geofence

Paste this to the ParlourPilot **web app** agent.

## Goal
Expose the **Check-in radius (metres)** field in the Branch add/edit modal, under the Attendance geofence section. Right now the web app uses a hard-coded 100m; mobile lets admins configure it per branch. The backend field already exists.

## Where it lives
Branches page → Add branch / Edit branch modal → **Attendance geofence** section → new field **below Latitude/Longitude row**.

## Backend
Already supported. `BranchIn` model accepts `geofence_radius_m: Optional[int] = None`. The `PUT /branches/{id}` endpoint keeps the value in `branches` collection. `POST /attendance/action` reads it to enforce the geofence at check-in.

## UI spec
Below the Latitude / Longitude grid row add:

```
Field label: "Check-in radius (metres, default 100)"
Input:       numeric, min 10, max 5000, placeholder "100"
Field ID:    geofence_radius_m
```

## Behaviour
- **Empty** → save as `null` → backend treats as **disabled** (no gating) when latitude/longitude are also null; when coords are set but radius is null the server defaults to 100m.
- **Number** → save as integer → server enforces exact distance in `POST /attendance/action`.
- Update the existing helper text under the section:
  - Old: "Staff can only check in within 100m of these coordinates. Leave blank to disable GPS gating for this branch."
  - New: "Staff can only check in within {radius || 100}m of these coordinates. Leave blank to disable GPS gating for this branch." (interpolate the live value from the form).

## Save
Include `geofence_radius_m` in the same PUT payload the modal already sends.

## Acceptance checklist
- New numeric field visible in Add branch and Edit branch modals.
- Saved value round-trips (edit → save → reopen shows same number).
- Server enforces the new radius on `POST /attendance/action` (staff punch-in outside the radius returns 403 with correct distance).
- Blank field disables gating (returns 200 without geofence check).
- Mobile app already saves this field to `branches.geofence_radius_m` — the two clients should stay in sync.
