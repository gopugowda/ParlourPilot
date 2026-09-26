# ParlourPilot Mobile — PRD

## Overview
Mobile-first multi-tenant SaaS salon/parlour management app built with Expo (React Native). Functional mirror of the ParlourPilot web app. Consumes the shared FastAPI + MongoDB backend at `parlourpilot.com` (production) / `staff-portal-331.preview.emergentagent.com` (preview). No parallel mobile-only business logic.

## Roles (mirror web)
- **Owner** — full access; only role that can access Payroll & Salary, Reports, Branches, Business Settings, Subscription.
- **Admin / Manager** — day-to-day ops + full HR / Leave. Cannot see owner financials or payroll.
- **Staff** — billing + attendance punch + `My Leave` self-service.

## Core Modules
1. **Auth**: JWT + tenant + branch, currency & brand color loaded on login. Owner-vs-Admin gate via `is_owner` + `permissions`.
2. **Dashboard**: today revenue, month revenue, top performers, appointments, quick actions.
3. **New Bill**: multi-service invoice; discounts; member auto-price; tax; multi-tender.
4. **History**: search + chip filters; export/share PDF.
5. **Appointments**: booking calendar + slot picker.
6. **Members**: yearly membership tier + auto-discount.
7. **Services**: CRUD price list.
8. **Team Management**: staff profiles + logins + branch + role + commission + target.
9. **Attendance**: GPS geofence-gated punch (Leaflet WebView map) + admin logs + report.
10. **HR / Leave** (Admin+): Daily Attendance, Leave Requests (approve/reject/cancel), Balances & History (per employee), Holidays (public + restricted), Employee Calendar, Leave Types + Policies, Audit Trail.
11. **Payroll & Salary** (Owner-only): Team Basic Salary, Salary Structure (recurring components), Variable Earnings (month-specific bonuses/incentives), Payroll Runs (create → calculate → approve → finalize), Payslip viewer, Monthly Export (CSV + PDF + email-to-me).
12. **My Leave** (Staff self-service): balances, request time off, calendar, RH selection.
13. **Stock / Expenses / Cash Closing**: standard ops.
14. **Reports** (Owner): sales, gender split, staff performance.
15. **Payroll Report** (Owner): branded PDF payslip export.
16. **Notifications**: in-app inbox with bell icon.
17. **Branches / Business Settings / Subscription** (Owner): tenant config, currency (51 ISO options), number & date format.

## Design Rules
- Mobile is a UI mirror; all business logic (calculations, permissions, tenant/branch isolation) lives on the shared backend.
- No new schema, no parallel HR/Payroll/Commission engines.
- Currency and number formatting via `theme/index.ts` (`fmtMoney`, `_localeHint`).

## Tech Stack
- Expo Router (file-based routing)
- react-native-calendars (date/month pickers)
- react-native-webview + Leaflet (geofence map, avoids Google Maps SDK)
- expo-print + expo-sharing (PDF & CSV export)
- AsyncStorage / SecureStore (tokens)

## Non-Goals (present iteration)
- Push notifications (only on user request).
- Native Google Maps.
- Client-side payroll calculations.

## Refactors (technical only)
- **Appointments screen split** (Sep 2026): `app/manage/appointments.tsx` shrunk from 855 → 284 lines. Extracted `AppointmentRow`, `AppointmentEditor`, `AppointmentDateTimePicker`, `AppointmentFiltersSheet`, `LabeledInput`, plus shared `types.ts` / `styles.ts` under `src/components/appointments/`. Purely mechanical — no behaviour change.

## iOS Production Fixes (Sep 2026 — physical iPhone 15 testing)
- **Add Expense → Staff Member dropdown invisible on iOS**: moved the Staff Picker and Date Picker `<Modal>`s from being siblings of the Editor `<Modal>` to nested overlays inside it. Root cause: on iOS a sibling Modal presents *behind* the currently-open Modal. File: `app/(tabs)/expenses.tsx`.
- **New Bill → Billing date picker blank on iPhone 15**: `<DateTimePicker>` now uses `display="inline"` + `themeVariant="light"` + explicit `textColor`/`accentColor`. Root cause: default spinner text inherited system dark appearance → white text on white sheet. Added a Cancel/Done row. File: `app/(tabs)/new-bill.tsx`.
- **Add/Edit Team Member sheet missing close control**: added a top-right × close button inside the sheet. File: `app/manage/beauticians.tsx`.
- **New Bill / Expenses / History tabs missing top nav**: added a subtle `home-outline` button in the header (matches the existing pattern already used in `/manage/beauticians`). Files: `app/(tabs)/new-bill.tsx`, `app/(tabs)/expenses.tsx`, `app/(tabs)/history.tsx`.
- **Consistency audit**: only `expenses.tsx` had the actual sibling-modal-while-open bug. All other multi-Modal screens (`stock`, `salon-settings`, `hr`, `report`) open their Modals mutually-exclusively, so no fix needed there.

