# GLOW UP UNISEX Salon Billing — PRD

## Overview
Mobile-first billing app for GLOW UP UNISEX Salon (Sullia). Expo + FastAPI + MongoDB.

## Roles
- **Admin**: full access (users, services, staff, bills, reports)
- **Staff**: billing + view services/staff/history

## Core Features
1. **Auth**: JWT-based login (bcrypt), roles admin/staff. Seeded on first run.
2. **Dashboard**: today revenue, month revenue, top beauticians, quick actions.
3. **New Bill**: multi-service invoice; each item has service, price, discount %, beautician; payment modes: Cash / QR / Split (cash+QR must total).
4. **Bill Detail**: full breakdown, share as PDF via expo-print + expo-sharing.
5. **History**: search + chip filters (All / Today / Cash / QR / Split).
6. **Manage → Services**: CRUD (name, price, category, active).
7. **Manage → Beauticians**: CRUD (name, role, phone, active). 8 pre-seeded.
8. **Manage → Users** (admin): add admin/staff.
9. **Reports**: daily revenue (30 days) with mini bar chart.

## Seeded Data
- 2 users (admin/staff), 8 beauticians, 17 services covering hair/skin/spa/nails/waxing/bridal.

## Non-Goals (v1)
- Push notifications, appointments, inventory, customer loyalty program.
