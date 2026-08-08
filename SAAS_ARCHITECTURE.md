# ParlourPilot — SaaS Architecture

## Overview

ParlourPilot is a **multi-tenant SaaS** platform for salons, parlours and beauty studios. A single ParlourPilot backend + database instance serves many independent salons ("tenants"), each with completely isolated data.

```
                    PARLOURPILOT
                         |
          +--------------+--------------+
          |              |              |
       Website        Mobile App      Backend API
          |              |              |
parlourpilot.com    Android/iOS    api.parlourpilot.com
                         |
                  Authentication (JWT)
                         |
                  Tenant Resolution (from JWT)
                         |
             +-----------+-----------+
             |           |           |
          Salon A     Salon B     Salon C
             |           |           |
          Users       Users       Users
          Customers   Customers   Customers
          Services    Services    Services
          Invoices    Invoices    Invoices
```

## Roles

| Role | Scope | Access |
|------|-------|--------|
| `platform_admin` | Global | View & manage all tenants, subscriptions, plans. No tenant assignment. |
| `admin` (owner) | Single tenant | Full access to their salon: manage settings, users, services, staff, members, bills, reports. |
| `staff` | Single tenant | Restricted: create bills, view today's data only. |

## Tenant Model

Each tenant record contains:
- **Identity**: `id`, `business_name`, `slug`, `logo`
- **Contact**: `email`, `phone`, `owner_name`, `website`
- **Address**: `address`, `city`, `state`, `country`, `postal_code`
- **Business Settings**: `currency`, `timezone`, `invoice_prefix`, `receipt_header`, `receipt_footer`
- **Tax**: `tax_enabled`, `tax_number`, `tax_percentage`
- **Membership**: `member_discount_pct`, `member_min_price` (tenant-configurable)
- **Subscription**: `subscription_plan`, `subscription_status`, `trial_start_date`, `trial_end_date`, `subscription_start_date`, `subscription_end_date`
- **Flags**: `is_active`

## Tenant Isolation (Security)

**Golden rule**: Every tenant-owned query MUST include `tenant_id` derived from the authenticated user's JWT — NEVER from request body.

### Enforcement
1. `get_current_user` (FastAPI dependency) extracts the JWT
2. `tenant_id_of(user)` returns the user's tenant_id (fails 403 if missing)
3. `tq(user, extra)` helper builds a MongoDB filter that always includes `tenant_id`
4. Every route handler uses `tq(user, {...})` for reads/updates/deletes
5. Every insert stamps `tenant_id: tenant_id_of(user)` explicitly

### Verified Tests
- Salon A cannot see Salon B's services (returns only their 17)
- Salon A cannot modify Salon B's records by manipulating IDs → HTTP 404
- Signup creates a completely empty new tenant
- Platform admin has global visibility (no tenant filter)

## Subscription Model

### States
- `trialing` — Free 7-day trial (new signups)
- `active` — Paid subscription active
- `expired` — Trial or subscription ended (blocks access)
- `suspended` — Platform admin manually disabled
- `cancelled` — Owner cancelled subscription

### Enforcement
- `check_subscription(user)` runs on every protected route
- Returns HTTP 402 if status is expired/suspended/cancelled
- Frontend listens for 402 and routes to `/subscription` screen
- Data is **preserved** across expiry — never deleted

### Trial Configuration
- Duration: **7 days** (constant `TRIAL_DAYS`)
- Applied automatically at signup
- Platform admin can extend via `/api/platform/tenants/{tid}/subscription`

## Database Collections

All tenant-owned collections have `tenant_id: str` field:
- `users` — { id, tenant_id (null for platform_admin), name, email, password_hash, role, is_active }
- `tenants` — Tenant profile + subscription
- `services` — { tenant_id, id, name, price, category, active }
- `beauticians` — { tenant_id, id, name, role, phone, active }
- `bills` — { tenant_id, id, bill_no, customer_*, items[], totals, payment_mode, tips }
- `members` — { tenant_id, id, name, phone, joined_at, expires_at }
- `expenses` — { tenant_id, id, category, description, amount, date }
- `stock_items` — { tenant_id, id, name, unit, current_qty, min_qty, unit_cost }
- `stock_movements` — { tenant_id, id, item_id, type, qty, ... }
- `cash_closings` — { tenant_id, id, date, opening, cash_sales, ... }
- `password_resets` — { token, user_id, email, expires_at }

## MongoDB Indexes

Created on startup by `ensure_indexes()`:
- `tenants.id` (unique)
- `tenants.slug` (unique)
- `users.id` (unique), `users.email`, `users.(tenant_id, email)`
- `bills.(tenant_id, created_at desc)`, `bills.(tenant_id, bill_no)`
- `services.(tenant_id, name)`
- `beauticians.(tenant_id, name)`
- `members.(tenant_id, phone)`
- `expenses.(tenant_id, date desc)`
- `stock_items.(tenant_id, name)`
- `stock_movements.(tenant_id, created_at desc)`
- `cash_closings.(tenant_id, date desc)`

## Authentication

### JWT Claims
```json
{
  "sub": "<user_id>",
  "role": "admin|staff|platform_admin",
  "tenant_id": "<tenant_id or null>",
  "exp": <unix_timestamp>
}
```

### Login Response
```json
{
  "token": "eyJhbGci...",
  "user": { "id", "tenant_id", "name", "email", "role" },
  "tenant": { ...full tenant object... },
  "subscription": { "status", "days_left", ... }
}
```

## API Endpoints

### Auth
- `POST /api/auth/login`
- `POST /api/auth/register` (admin creates staff within same tenant)
- `GET /api/auth/me` — user + tenant + subscription
- `GET /api/auth/users` — list tenant users
- `PUT /api/auth/users/{uid}` — update tenant user
- `DELETE /api/auth/users/{uid}` — delete tenant user
- `DELETE /api/auth/me` — self-delete (App Store review compliant)
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

### Tenants
- `POST /api/tenants/signup` — public, creates tenant + owner + 7-day trial
- `GET /api/tenants/me` — get current tenant profile
- `PUT /api/tenants/me` — update tenant profile (owner only)
- `GET /api/tenants/me/subscription` — subscription status

### Platform Admin
- `GET /api/platform/tenants` — list all tenants with stats
- `GET /api/platform/stats` — global platform stats
- `PUT /api/platform/tenants/{tid}` — edit any tenant
- `POST /api/platform/tenants/{tid}/subscription` — extend/suspend/change plan

### Tenant Resources (all auto-scoped by JWT tenant_id)
- Services, Beauticians, Bills, Members, Expenses, Stock, Cash Closing, Reports

## Frontend Flow

1. **Splash** → `/` redirects based on auth
2. **Login** → `/login`
3. **Signup** → `/signup` (new tenant, 7-day trial)
4. **Subscription Expired** → `/subscription` (renewal screen, data preserved)
5. **Platform Admin** → `/platform` (separate experience for SaaS operators)
6. **Tenant Dashboard** → `/(tabs)` (existing salon UX, now tenant-branded)

## Security Practices

- ✅ Bcrypt password hashing
- ✅ JWT-signed tokens (env-driven secret, no fallback)
- ✅ Tenant isolation enforced at backend (never trust frontend)
- ✅ Role-based access control (RBAC) on every route
- ✅ Input validation via Pydantic
- ✅ CORS with allowed origins
- ✅ Env-based secrets (no hardcoded credentials in source)
- ✅ Self-service account deletion (App Store compliant)
- ✅ Subscription checks on all tenant routes
