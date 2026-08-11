#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Iteration 10 UI fixes:
  1. Members screen: Add explicit Active / Expired filter chips (staff can also view/filter members by status)
  2. Bill detail badge: fix hardcoded "MEMBER · 10% off". Must reflect the actual per-member discount %
     (e.g. show "MEMBER · 20% off" when a member has a 20% override, or the salon default otherwise)
  3. Shared bill PDF: show the salon/branch logo on the invoice
  4. Branches management: allow uploading a logo per branch
  5. Salon Settings: split into Company (tenant-level) + Branch (per-branch with dropdown selector).
     Branch dropdown must switch the form context and let admin save per-branch: logo, address,
     phone, email, tax, invoice prefix, receipt header/footer
  6. Users management: admin can assign a specific branch to each user/staff during create/edit

frontend:
  - task: "Members Active/Expired/Expiring filter chips"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/manage/members.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Added Active/Expiring/Expired chips with counts; filter logic updated. Backend already returns computed status for each member."

  - task: "Bill detail badge dynamic member discount %"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/bill/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Replaced hardcoded '10% off' with bill.member_discount_pct_applied ?? tenant.member_discount_pct. Applied to both the in-app badge and the PDF header badge."

  - task: "Bill PDF shows salon/branch logo + branch-specific branding"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/bill/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "PDF now includes logo (branch logo -> tenant logo fallback), branch name subtitle, and prefers branch-level address/phone/email/tax/receipt header+footer over tenant."

  - task: "Branch logo upload in Branches management"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/manage/branches.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Added ImagePicker-based logo upload to the create/edit branch modal. Logo is sent to POST/PUT /api/branches which already accepts 'logo' field (base64 data URI). Row also shows a thumbnail."

  - task: "Branch-level Salon Settings with branch dropdown"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/manage/salon-settings.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Rewrote screen: Company (tenant) section for business_name/owner/website/default logo/member discount; Branch section with modal dropdown selector to switch between branches — per-branch: logo, address, city, state, postal, phone, email, tax, invoice_prefix, receipt header/footer. Save calls PUT /branches/{id}."

  - task: "Users: assign branch to staff/admin"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/manage/users.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Add/Edit user modal now shows branch selector list. Staff MUST have a branch (validated client-side); admins can be All Branches or a specific home branch. User row also shows the assigned branch name. Uses existing backend fields UserCreate.branch_id & UserUpdate.branch_id."

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 10
  run_ui: false

test_plan:
  current_focus:
    - "Members Active/Expired/Expiring filter chips"
    - "Bill detail badge dynamic member discount %"
    - "Bill PDF shows salon/branch logo + branch-specific branding"
    - "Branch logo upload in Branches management"
    - "Branch-level Salon Settings with branch dropdown"
    - "Users: assign branch to staff/admin"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      Iteration 10 UI-focused changes are in. All fixes are frontend-only; the backend
      already exposed the fields (branch.logo, branch tax/address/prefix/receipt fields,
      UserCreate/UserUpdate.branch_id, bill.member_discount_pct_applied).
      Please verify:
        1) Members screen shows 4 chips (All/Active/Expiring/Expired) and filters correctly.
           Staff role (staff@glowup.com/staff123) should also see and use these filters.
        2) Create a bill for a member with a 20% override — the bill detail badge should read
           "MEMBER · 20% off" (not 10%). Share → PDF should also show 20%.
        3) The shared PDF must render the logo. Configure a branch logo via Manage → Branches
           edit and verify it appears. If branch logo empty, tenant logo should show.
        4) Manage → Branches modal has a logo picker; saving persists via PUT /branches/{id}.
        5) Salon Settings screen: Company section saves via PUT /tenants/me. Branch section
           has a dropdown to pick a branch; changing branch loads fresh values; Save Branch
           calls PUT /branches/{id} and updates fields (logo, address, tax, prefix, footer).
        6) Users screen: creating/editing a user now shows a branch chooser. Staff role must
           require a branch; admin can be 'All Branches'. Persisted via /auth/register &
           /auth/users/{id}.
      Test credentials: /app/memory/test_credentials.md — Glow Up owner (admin@glowup.com/admin123)
      and staff (staff@glowup.com/staff123).

user_problem_statement: |
  Iteration 11 mixed FE+BE changes:
  1. Staff account: hide "Add Member" empty CTA button (staff is read-only for members)
  2. Per-branch subscription: main salon ₹999/mo or ₹9999/yr; extra branch ₹888/mo or ₹8888/yr.
     Add Branch → checkout flow (mock payment) → branch is created ONLY after "payment" success.
     Currency selector on checkout with live FX conversion for the SaaS price.
  3. Platform admin: reset/change any tenant user's password (defaults to owner)
  4. Appointment/Booking module: staff & admin can create/modify/cancel. Dashboard shows
     Today's + Weekly counts + upcoming preview. Branch-scoped.
  5. Bills/invoices/expenses: allow salon to pick display currency symbol (no FX). Static list
     of ~20 major currencies.

backend:
  - task: "Platform admin password reset endpoint"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "POST /api/platform/tenants/{tid}/reset-password with body {user_id?, email?, new_password}. Also added GET /api/platform/tenants/{tid}/users to list tenant users. Only platform_admin can call."

  - task: "Branch checkout (mock payment) endpoint"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "POST /api/branches/checkout accepts {plan: monthly|yearly, branch: BranchIn, amount_inr?, display_amount?, display_currency?, payment_reference?}. Creates a NON-head branch with subscription_status=active and subscription_end_date = now + 30d/365d. Records a mock payment doc in `payments` collection. Also added GET /api/pricing returning INR prices for main and branch."

  - task: "Appointments CRUD + stats"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "GET/POST/PUT/DELETE /api/appointments (branch-scoped), GET /api/appointments/stats returns {today, week, upcoming[5]}. Staff & admin can create/modify (uses get_current_user_active dependency). Branch scoping enforced via X-Branch-Id."

  - task: "Currency symbol on tenant"
    implemented: true
    working: "NA"
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Added `currency_symbol` to TenantUpdate model. Existing `currency` field also kept. Frontend derives symbol from CURRENCY_CHOICES table when saving."

frontend:
  - task: "Members: hide Add CTA for staff"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/manage/members.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Empty-state Add button now shows only for admin, and only when list is empty. Header Add is a lock icon for staff. Filter chips work for staff and admin alike."

  - task: "Platform Admin: reset user password UI"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/platform.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Added Reset Password button on each tenant card → modal shows list of users in the tenant (radio select, defaults to owner/admin), new password + confirm. Calls resetPassword API. Displays success alert with target email/role."

  - task: "Branch checkout screen with live FX"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/checkout.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "New route /checkout?type=branch. Fetches live FX rates from open.er-api.com (INR base). Shows plan cards Monthly ₹888/Yearly ₹8888. Currency picker with 10 majors — display amount auto-computes (₹888 * rate). Auto-detects locale to pre-select currency. MOCK payment simulated with a 1.5s delay, then POST /branches/checkout to create the branch. On success shows alert and redirects to /manage/branches. Fallback FX table if API unreachable."

  - task: "Branches: Add Branch routes to checkout"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/manage/branches.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "openAdd() now navigates to /checkout?type=branch instead of opening the create modal. Existing edit modal is unchanged (works for editing). Also updated pricing box to show both main (₹999/₹9999) and extra branch (₹888/₹8888) rates."

  - task: "Salon Settings: currency picker for bill display"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/manage/salon-settings.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Company Info card now has a Currency selector (₹, $, €, etc.) with a scrollable picker of 20 major currencies. On save it persists `currency` code and `currency_symbol` to tenant. AuthContext applies the symbol globally via setCurrencySymbol() so fmtINR() throughout the app shows the chosen symbol without touching individual files."

  - task: "Appointments screen (staff + admin)"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/manage/appointments.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "New /manage/appointments screen. Filter chips: Today / This Week / All Upcoming. Rows grouped by date, show time-of-day + duration + status chip (booked/in_progress/completed/canceled/no_show). Tap status chip to cycle. Editor modal for new/edit with fields: customer name/phone, date/time (plain text YYYY-MM-DD and HH:MM for cross-platform), duration, beautician chips, services multi-select (with prices), status pills, notes. Uses appointmentApi.list/create/update/remove. Both admin and staff can access via Manage tab entry."

  - task: "Dashboard Schedule widget"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/(tabs)/index.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "New Schedule card between Quick Actions and This Month. Shows Today count / Next 7d count / New button, plus a preview of next up-to-3 upcoming appointments. Loads via appointmentApi.stats(). Available to both admin and staff."

metadata:
  created_by: "main_agent"
  version: "1.1"
  test_sequence: 11
  run_ui: false

test_plan:
  current_focus:
    - "Platform admin password reset endpoint"
    - "Branch checkout (mock payment) endpoint"
    - "Appointments CRUD + stats"
    - "Currency symbol on tenant"
    - "Members: hide Add CTA for staff"
    - "Platform Admin: reset user password UI"
    - "Branch checkout screen with live FX"
    - "Branches: Add Branch routes to checkout"
    - "Salon Settings: currency picker for bill display"
    - "Appointments screen (staff + admin)"
    - "Dashboard Schedule widget"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      Iteration 11 is a large feature drop:
      • Platform admin password reset endpoint + UI (target user selectable within a tenant).
      • Branch checkout flow with mock payment + live FX conversion (base INR).
      • Full Appointments module (backend CRUD + stats; frontend list, editor, dashboard widget).
      • Currency selector for bills/invoices/expenses display (20 currencies, no FX).
      • Staff-side Add Member CTA removed.
      Please verify BOTH backend and frontend flows. Test credentials as before.
      A live FX API call to open.er-api.com is made from the checkout screen — this is a public
      no-key API. If it fails, the code falls back to an internal rate table so the UI still works.
      MOCK PAYMENT: the /branches/checkout endpoint accepts a `payment_reference` and inserts a
      record in `payments`. It does NOT integrate with any real gateway. Users should be informed.


  - task: "Forgot Password (OTP-based Self-Serve Reset) — iteration_19"
    implemented: true
    working: true
    file: "/app/backend/routes/auth.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          Wrote 16 pytest cases in /app/backend/tests/test_iter19_forgot_password.py — ALL PASS.
          Coverage:
            • POST /api/auth/forgot-password: OTP issuance for real user, no-leak/no-record for
              non-existent email, prior-OTP invalidation, rate-limit (>=3/10min → 429), invalid
              email format (422).
            • POST /api/auth/reset-password (OTP flow): wrong OTP (400 + attempts increments),
              invalid OTP format, no active OTP (400), expired OTP (400), 5-attempt lockout
              (429 + doc marked used+invalidated), weak password <6 (400), happy-path reset →
              login works, replay of same OTP blocked, missing fields (400).
            • Legacy token flow (backward compat): valid token reset, token reuse blocked,
              invalid token (400), expired token (400).
          Security verified: OTPs are SHA-256 hashed (no plain OTP in DB), hmac.compare_digest
          used for constant-time comparison, non-existent email creates no DB record and returns
          no dev_otp (no enumeration). dev_otp fallback only surfaces when Emergent Resend marks
          the destination as undeliverable (as expected for admin@glowup.com in preview env).
          Admin password fully restored to admin123 via module teardown fixture.


  - task: "Cancel Subscription (Pending Expiry) — iteration_20"
    implemented: true
    working: true
    file: "/app/backend/routes/tenants.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          Wrote 19 pytest cases in /app/backend/tests/test_iter20_cancel_subscription.py.
          18/19 PASS. Coverage:
            • POST /api/tenants/me/cancel-subscription (owner) — 200, subscription.status stays
              active/trialing, cancellation_pending=true, cancelled_by=email set on both tenant
              and subscription payload.
            • Idempotency — second POST returns already_cancelled=true, no state change.
            • GET /api/tenants/me/subscription surfaces cancellation_pending,
              cancellation_requested_at, cancelled_by.
            • Access preserved after cancel: GET /api/services, GET /api/bills,
              GET /api/tenants/me all return 200 with cancellation_pending=true.
            • RBAC: staff POST → 403; staff DELETE → 403; unauthenticated → 401/403.
            • Platform visibility: /api/platform/stats.cancelled_pending is int and reflects
              the cancelled tenant; /api/platform/tenants shows subscription.cancellation_pending=true
              for glowup-tenant-0001; /api/platform/tenants/{tid}/detail also carries the fields.
            • DELETE /api/tenants/me/cancel-subscription (owner) — 200, fields cleared;
              second DELETE → 400 "Subscription is not cancelled".
            • Cannot cancel expired tenant → 400 with detail mentioning expired.
            • Cleanup fixture guarantees glowup tenant is restored to non-cancelled state.

          FAILED / GAP (1): "Cannot cancel a suspended tenant" is NOT enforced. The endpoint uses
          require_admin (role check only) and tenant_status() maps only subscription_status/
          end_date → "expired", never "suspended". When platform admin flips is_active=false,
          the owner POST /cancel-subscription still returns 200. Root cause:
            - core.tenant_status() does not consider tenant.is_active
            - routes/tenants.py:203 uses require_admin (no check_subscription) so suspended
              tenants can still hit the endpoint
          Recommendation for main agent: either (a) switch dependency to require_admin_active
          which runs check_subscription (rejects is_active=False with 403 "Tenant is
          suspended"), or (b) add `if not tenant.get("is_active", True): raise 400 "Cannot
          cancel a suspended tenant"` at the top of cancel_my_subscription. Test was left in
          place to guard the fix.

          All other happy paths and edge cases pass. Test report:
          /app/test_reports/iteration_20.json, JUnit:
          /app/test_reports/pytest/pytest_iter20.xml.
