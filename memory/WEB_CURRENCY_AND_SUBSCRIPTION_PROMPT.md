# Web App Parity Prompt — Currency Symbol + Subscription Pricing

Paste this to the ParlourPilot **web app** agent to bring the web UI in sync with mobile. Backend is untouched — this is a frontend/display change only.

---

## 1) Global currency symbol parity

Every price shown in the app must respect the salon's chosen currency symbol (`tenant.currency_symbol`). Nothing should be hardcoded to `₹`.

Places to audit and update:
- Dashboard KPI cards, revenue counters, donut chart center total + legend, mini/line chart Y-axis labels
- Bills / New Bill: item price, tip, discount, cash/card/UPI/split fields, "flat X% off above ₹100" hint text
- Bill detail HTML/PDF: subtotal, discount, tax, tip, grand total, split breakdown
- Bill History table + row totals
- Members screen: "min price" chip + WhatsApp renewal templates
- Services list: base price, suggested add-on
- Expenses: amount input label + all totals
- Cash Closing: expected drawer, expenses, difference (including a "0" fallback)
- Staff Performance / Reports: all revenue, cash, upi/qr, expenses, net, comparison rows
- WhatsApp deep-link invoice message

**Tip**: read the symbol once from tenant context (e.g. `useCurrencySymbol()` or `tenant?.currency_symbol || '₹'`) and inject via template literal instead of hardcoding.

---

## 2) Subscription pricing logic

The Checkout page (both new tenant subscription and add-branch add-on) must show ONE of two price columns based on `tenant.currency`:

- If `tenant.currency === 'INR'` → show `₹` prices:
  - Tenant plan: **₹999/mo · ₹9,999/yr**
  - Branch add-on: **₹888/mo · ₹8,888/yr**

- If `tenant.currency` is ANY other value → show flat `$` prices:
  - Tenant plan: **$12/mo · $120/yr**
  - Branch add-on: **$10/mo · $100/yr**

Notes:
- Use the `$` symbol regardless of the salon's own currency symbol (this rule is subscription-only; the rest of the app still uses their local symbol).
- **REMOVE** any live FX picker, currency dropdown, and FX rate API call from the Checkout page. Pricing is now binary and deterministic.
- The Razorpay `createOrder` call still sends the same INR base amount (999 / 9999 / 888 / 8888). Only the `display_currency` field switches between `"INR"` and `"USD"`, and `display_amount` becomes the flat USD number when applicable.
- The pay button label follows the display currency, e.g. `"Pay $12 with Razorpay"`.

---

## 3) Payment disclosure

Add an info/note card below the amount preview on the Checkout page (yellow/warning styling, small text):

> ℹ️ **Note**: All subscription payments are processed in INR. Your local currency symbol is used for your salon's internal reporting only. International bank conversion rates may apply.

Also update the signup screen's pricing hint to:
> "Starts at ₹999/mo (₹9,999/yr) — or $12/mo ($120/yr) for international salons."

---

## Acceptance checklist

- [ ] Change `tenant.currency` to EUR / GBP / USD / AED in Salon Settings → every `₹` across Dashboard, New Bill, History, Members, Services, Expenses, Reports, Cash Closing, Bill PDF, WhatsApp templates now shows the new symbol.
- [ ] Change `tenant.currency` to INR → all displays revert to `₹`.
- [ ] On Checkout for an INR salon: sees ₹999 / ₹9,999 (tenant) or ₹888 / ₹8,888 (branch), pay button says `"Pay ₹… with Razorpay"`, disclosure card present.
- [ ] On Checkout for a non-INR salon: sees $12 / $120 (or $10 / $100 for branch), pay button says `"Pay $12 with Razorpay"`, disclosure card present. No FX picker anywhere.
- [ ] Signup pricing hint reflects the new copy.
- [ ] Razorpay `createOrder` still receives the correct INR amount in every case (verify with a test transaction).
