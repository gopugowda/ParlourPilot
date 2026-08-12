# ParlourPilot Web App — New Emergent Project Prompt

Use this prompt when creating a **new Emergent Full Stack App** project to build the web version of ParlourPilot with a public marketing landing page + authenticated dashboard.

---

## 📋 Copy-paste this prompt

```
Build ParlourPilot Web — a multi-tenant SaaS salon management platform.

This is a companion web app for our existing Expo mobile app. Both must share
the SAME MongoDB Atlas database so users log in seamlessly across mobile and web.

============================================================
TECH STACK
============================================================
- Frontend: Next.js 14 (App Router) + TypeScript + TailwindCSS + shadcn/ui
- Backend: FastAPI + Motor (async MongoDB) + JWT auth (python-jose) + Passlib bcrypt
- Database: shared MongoDB Atlas cluster (I will provide MONGO_URL + DB_NAME)
- Email: Resend (I will provide RESEND_API_KEY, sender support@parlourpilot.com)
- Payments: Razorpay (I will provide test + live keys)
- Charts: recharts

============================================================
PUBLIC LANDING PAGE (`/`) — MANDATORY
============================================================
Marketing home for parlourpilot.com. Include the following sections in order:

1. NAV BAR
   - Logo (left) · Features · Pricing · FAQ · Sign In · Start Free Trial (CTA)
   - Sticky on scroll, transparent → white with subtle shadow after 40px scroll

2. HERO
   - Headline: "The complete SaaS platform for modern salons"
   - Sub: "Manage bookings, billing, staff performance, and inventory —
     all in one place. Works on mobile and web."
   - CTAs: Start Free Trial (→ /signup) · See Live Demo
   - Right side: elegant screenshot of the dashboard on a MacBook

3. TRUST BAR — "Trusted by 500+ salons across India"
   Fake but realistic logos (salon-y names) in a gray strip

4. FEATURES — 6 cards with icons (2 rows × 3 cols on desktop, stacked on mobile):
   • Multi-Branch Management — Run all your salon branches from one dashboard
   • Appointments & Bookings — Calendar view, SMS/WhatsApp reminders, waitlist
   • POS & Billing — Fast invoicing with cash+UPI split, tips, discounts
   • Staff Performance — Top-performer badges, payroll-ready reports
   • Inventory & Expenses — Real-time stock, category-tagged expenses
   • Customer Loyalty — Points, memberships, birthday offers

5. HOW IT WORKS — 3 steps with numbered circles
   1. Sign up for a free 7-day trial
   2. Add your services, staff, and branches (5 minutes)
   3. Start billing and tracking performance instantly

6. SCREENSHOT SHOWCASE
   3 device mockups (phone/tablet/desktop) with feature callouts

7. PRICING — 3 tiers pulled from backend `/api/plans`
   - Starter (Free trial 7 days)
   - Pro (₹999/branch/month)
   - Enterprise (Custom)
   Each card lists included features + CTA

8. TESTIMONIALS — 3 fake but realistic quotes with avatar + salon name

9. FAQ — accordion with 6 questions
   - Can I import my existing customer data?
   - Do you offer training or setup help?
   - What happens after my 7-day trial?
   - Can I use it on my phone?
   - Is my data secure?
   - Can I cancel anytime?

10. FINAL CTA — Full-width dark strip: "Ready to grow your salon business?
    Start your 7-day free trial → no credit card required"

11. FOOTER
    - Left: logo + tagline
    - Cols: Product (Features, Pricing, Mobile App) · Company (About, Contact) ·
      Legal (Privacy, Terms, Refunds) · Social (Twitter/X, Instagram)
    - Bottom bar: © 2026 ParlourPilot. All rights reserved.
      "Available on iOS + Android" app store badges
      Contact: support@parlourpilot.com

Use warm salon-inspired branding:
- Brand red:  #C42032
- Cream:      #F5F2EA
- Gold:       #E8C87A
- Surface:    #FFFFFF
- Ink:        #1A1A1A
- Muted:      #6B6862
Typography: Fraunces (serif) for headers, Inter (sans) for body.
Rounded corners: xl (12px) for cards, full pill for CTAs.

============================================================
AUTH FLOWS
============================================================
- /signup   — 7-day free trial signup form (POST /api/tenants/signup)
- /login    — Email + password with "Forgot password?" modal → OTP flow
              (POST /api/auth/forgot-password + /api/auth/reset-password)
- JWT stored in httpOnly cookie (secure, sameSite lax)
- After login → redirect to /app (dashboard)

============================================================
AUTHENTICATED APP (/app/*) — SIDEBAR SHELL
============================================================
Left sidebar on desktop (240px), collapsible drawer on tablet, bottom-nav on mobile.
All /app/* routes require valid JWT. Screens to build:

1.  Dashboard          /app                     Today's stats, revenue/count, top services
2.  New Bill           /app/new-bill            Multi-line service picker, beautician assign,
                                                discounts, member lookup, tips, cash/QR split
3.  Bill History       /app/bills               Table + filter + click → detail + email invoice
4.  Bill Detail        /app/bills/[id]          Formatted receipt + Print + Share + Email
5.  Appointments       /app/appointments        Calendar + list + booking form
6.  Staff Performance  /app/staff-performance   Period chips, top performer, bar chart,
                                                staff ranking with bars, CSV/PDF export
7.  Daily Report       /app/reports             Date range picker, trend chart, expense
                                                breakdown, export options
8.  Beauticians        /app/beauticians         CRUD table
9.  Services           /app/services            CRUD table with categories, member pricing
10. Members            /app/members             Loyalty customers, points, discounts
11. Expenses           /app/expenses            Category-tagged expense log
12. Stock              /app/stock               Inventory items + movements
13. Cash Closing       /app/cash-closing        End-of-day reconciliation
14. Branches           /app/branches            Multi-branch switcher + subscription per branch
15. Users              /app/users               Owner/admin can add staff, reset passwords
16. Salon Settings     /app/settings            Business name, currency, tax, logo, brand color
17. Subscription       /app/subscription        Current plan, Razorpay renew, Cancel button
                                                with confirmation modal showing exact expiry
18. Platform Admin     /platform                Super-admin: tenant list, tenant detail,
                                                platform users, CSV export, cancellation badges

============================================================
BACKEND CONTRACT
============================================================
Every endpoint is under /api/*. Mirror the routes exactly:

- /api/auth/*              login, signup, forgot-password, reset-password
- /api/tenants/*           tenant CRUD, subscription, cancel-subscription (POST + DELETE)
- /api/bills/*             CRUD + /api/bills/{id}/email (Resend invoice)
- /api/services/*
- /api/beauticians/*
- /api/members/*
- /api/expenses/*
- /api/stock/*
- /api/appointments/*
- /api/reports/summary
- /api/reports/range
- /api/reports/staff-performance
- /api/platform/*          super-admin only
- /api/payments/razorpay/* Razorpay integration
- /api/health              GET → 200

Password reset flow uses 6-digit OTP via email, 15-min TTL, 5-attempt lock,
3-req/10-min rate limit. Never leak OTPs for unknown emails.

Cancel Subscription is a SOFT cancellation — sets cancellation_requested_at
without changing subscription_status; tenant retains full access until
subscription_end_date is reached.

============================================================
DESIGN SYSTEM
============================================================
Colors:
  brand:      #C42032
  cream:      #F5F2EA
  surface:    #FFFFFF
  ink:        #1A1A1A
  muted:      #6B6862
  gold:       #E8C87A
  success:    #16A34A
  warning:    #F59E0B
  error:      #DC2626

Typography:
  Headings:   Fraunces (serif, weight 600–800)
  Body:       Inter (sans, weight 400–700)

Radius:
  card:       12px (rounded-xl)
  pill:       999px (rounded-full)

Shadows:
  subtle:     shadow-sm on cards
  raised:     shadow-md on modals

Fully responsive with breakpoints at md:768px and lg:1024px.

============================================================
DELIVERABLES
============================================================
- Landing page live at parlourpilot.com root
- App dashboard live at parlourpilot.com/app
- Backend deployed with public URL
- Ready to map custom domain www.parlourpilot.com via CNAME
- All secrets stored in .env (never hardcoded in code)
- GET /api/health returns 200 for K8s probes
- ESLint clean (no react/no-unescaped-entities errors)
- Root .gitignore does NOT exclude .env files (they need to be in deploy context)
```

---

## 🚀 After the new project is created — checklist

### 1. Set up shared MongoDB Atlas
You have two paths:

**A. Simple (recommended)** — Ask Emergent Support (support@emergent.sh) for
the Atlas `MONGO_URL` your current deployed backend uses. Paste it into the
new web project's `MONGO_URL` secret. Both apps share data instantly.

**B. Cleaner** — Sign up at https://cloud.mongodb.com → create a free M0 cluster →
copy the connection string → update BOTH:
   - Current mobile project → Secrets → set `MONGO_URL`
   - New web project → Secrets → set `MONGO_URL`

### 2. Copy secrets to new project

```
RESEND_API_KEY=re_b1VybCAd_4gM45rySPH5iM278Qv5WymRZ
RESEND_FROM_EMAIL=support@parlourpilot.com
RESEND_FROM_NAME=ParlourPilot
EMAIL_FROM_NAME=ParlourPilot

RAZORPAY_KEY_ID=<your razorpay key>
RAZORPAY_KEY_SECRET=<your razorpay secret>
RAZORPAY_WEBHOOK_SECRET=<your webhook secret>

JWT_SECRET=<generate a new 64-char random string, e.g., openssl rand -hex 32>
JWT_ALG=HS256

ADMIN_SEED_PASSWORD=<pick a strong one>
STAFF_SEED_PASSWORD=<pick a strong one>
PLATFORM_ADMIN_PASSWORD=<pick a strong one>

MONGO_URL=<from step 1>
DB_NAME=parlourpilot
```

### 3. Port your backend code (optional — saves re-writing time)

From this current project, copy these files verbatim to the new web project:

- `/app/backend/routes/*.py` — every FastAPI router (auth, tenants, bills,
  reports, staff-performance, platform, payments, etc.)
- `/app/backend/core.py` — shared utilities + auth config
- `/app/backend/models.py` — Pydantic schemas
- `/app/backend/mailer.py` — Resend integration
- `/app/backend/startup.py` — DB indexes + seeding (guard the seed behind an
  `if ENABLE_SEED == "true"` env flag so production doesn't seed demo data)

### 4. Map your domain

Once deployed:
1. Emergent will show a "Custom Domain" section under Manage Publishing
2. Add `www.parlourpilot.com` and `parlourpilot.com`
3. Emergent gives you a CNAME target (something like `xxxxx.emergentagent.com`)
4. Go to Hostinger → DNS Zone Editor → add:
   ```
   Type: CNAME     Name: www          Target: <given target>
   Type: A/CNAME   Name: @            Target: <given target> (Hostinger supports ALIAS)
   ```
5. Wait 10-30 min for DNS propagation
6. Verify at https://dnschecker.org

---

## 🛑 Common gotchas (learned from this project's deploy)

1. **Do NOT `.gitignore` .env files** — Emergent deploy needs them in the build
   context. Keep secrets in .env but ensure they're included in the deploy.
2. **Add a `GET /` health handler** — K8s probes hit `/` on the backend; if all
   your routes are under `/api/*`, you'll see 404s in deploy logs. Add:
   ```python
   @app.get("/", include_in_schema=False)
   async def root_health():
       return {"ok": True, "service": "parlourpilot-web"}
   ```
3. **Fix ESLint `react/no-unescaped-entities` errors** — Replace literal `'` in
   JSX text with `&rsquo;`. These CAN block strict web builds.
4. **JWT payload contract** — Keep it identical to mobile:
   `{sub: user_id, role, tenant_id, exp}`. Both apps must decode the same shape.
5. **Resend "undeliverable" fallback** — For test emails Resend rejects with 422.
   Have your `/api/auth/forgot-password` surface `dev_otp` in the response only
   when `email_sent: false`, otherwise never leak the OTP.

---

**Saved: 2026-08-11**
Related files in this project:
- `/app/backend/mailer.py` — Resend integration to port
- `/app/backend/routes/` — all endpoints to port
- `/app/frontend/app/manage/staff-performance.tsx` — reference UI for Next.js port
- `/app/memory/test_credentials.md` — auth flow + credentials docs
