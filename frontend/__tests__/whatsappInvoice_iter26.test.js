/**
 * Iteration 26 - Retest of iter25 minor findings:
 *   1. Discount line renders when bill.discount is present (not just bill.discount_amount)
 *   2. Subtotal uses bill.subtotal (pre-discount) instead of bill.services_net
 *   3. payment_mode is title-cased and 'qr' becomes 'UPI'
 *
 * Simulates the exact payload assembly done in
 * /app/frontend/app/bill/[id].tsx and /app/frontend/app/(tabs)/history.tsx.
 */
const path = require('path');
const Module = require('module');

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'react-native') return path.join(__dirname, '__rn_stub.js');
  return originalResolve.call(this, request, parent, ...rest);
};

require('sucrase/register');
const { buildWhatsAppInvoiceMessage, sendWhatsAppInvoice } =
  require(path.resolve(__dirname, '..', 'src/utils/whatsappInvoice.ts'));

let pass = 0, fail = 0;
function ok(name, cond, extra='') {
  if (cond) { pass++; console.log('PASS', name); }
  else      { fail++; console.log('FAIL', name, extra); }
}

// ---------- Mirrors the payment_mode mapping used in the callers ----------
function mapPaymentMode(pm) {
  if (!pm) return null;
  return pm === 'qr' ? 'UPI' : pm.charAt(0).toUpperCase() + pm.slice(1);
}

// ---------- Simulates the payload built in bill/[id].tsx and history.tsx ----------
function buildMsgFromBill(bill, tenant = { business_name: 'Test Salon' }) {
  const items = (bill.items || []).map(it => ({
    name: it.service_name || 'Service',
    qty: it.qty || 1,
    price: Number(it.total ?? it.price ?? 0),
  }));
  return buildWhatsAppInvoiceMessage({
    businessName: tenant.business_name,
    billNo: bill.bill_no,
    dateStr: '12 Aug 2026, 04:32 PM',
    customerName: bill.customer_name,
    items,
    subtotal: bill.subtotal ?? bill.services_net,
    discount: bill.discount ?? bill.discount_amount,
    tax: bill.tax_amount,
    tip: bill.tip_amount,
    grandTotal: bill.grand_total || 0,
    paymentMode: mapPaymentMode(bill.payment_mode),
  });
}

// ============================================================
// TEST 1 - Bill with subtotal=2000, discount=200, tip=100, payment_mode='qr'
// ============================================================
{
  const bill = {
    bill_no: 'INV-042',
    customer_name: 'Ravi',
    customer_phone: '9880012345',
    items: [{ service_name: 'Haircut', qty: 1, total: 1000 },
            { service_name: 'Facial',  qty: 1, total: 1000 }],
    subtotal: 2000,
    discount: 200,
    services_net: 1800,   // post-discount (backend-computed)
    tip_amount: 100,
    grand_total: 1900,    // 2000 - 200 + 100
    payment_mode: 'qr',
  };
  const msg = buildMsgFromBill(bill);
  ok('T1 discount line renders', msg.includes('Discount: -₹200.00'), msg);
  ok('T1 subtotal is PRE-discount 2000', msg.includes('Subtotal: ₹2,000.00'), msg);
  ok('T1 subtotal is NOT services_net 1800', !msg.includes('Subtotal: ₹1,800.00'));
  ok('T1 tip line present', msg.includes('Tip: ₹100.00'));
  ok('T1 total is grand_total 1900', msg.includes('*Total: ₹1,900.00*'));
  ok('T1 payment mode UPI (not qr)', msg.includes('_Paid via UPI_'));
  ok('T1 no lowercase qr', !msg.includes('_Paid via qr_'));
}

// ============================================================
// TEST 2 - payment_mode 'cash'
// ============================================================
{
  const bill = {
    bill_no: 'INV-043', customer_name: 'Neha',
    items: [{ service_name: 'Manicure', qty: 1, total: 500 }],
    subtotal: 500, grand_total: 500, payment_mode: 'cash',
  };
  const msg = buildMsgFromBill(bill);
  ok('T2 Paid via Cash', msg.includes('_Paid via Cash_'), msg);
  ok('T2 no lowercase cash', !msg.includes('_Paid via cash_'));
}

// ============================================================
// TEST 3 - payment_mode 'split'
// ============================================================
{
  const bill = {
    bill_no: 'INV-044', customer_name: 'Amit',
    items: [{ service_name: 'Pedicure', qty: 1, total: 800 }],
    subtotal: 800, grand_total: 800, payment_mode: 'split',
  };
  const msg = buildMsgFromBill(bill);
  ok('T3 Paid via Split', msg.includes('_Paid via Split_'), msg);
  ok('T3 no lowercase split', !msg.includes('_Paid via split_'));
}

// ============================================================
// TEST 4 - Legacy field discount_amount still supported (fallback)
// ============================================================
{
  const bill = {
    bill_no: 'INV-045', customer_name: 'Sara',
    items: [{ service_name: 'Massage', qty: 1, total: 1500 }],
    subtotal: 1500,
    // no `discount` field; legacy `discount_amount` should fall through
    discount_amount: 150,
    services_net: 1350,
    grand_total: 1350,
    payment_mode: 'cash',
  };
  const msg = buildMsgFromBill(bill);
  ok('T4 legacy discount_amount still renders', msg.includes('Discount: -₹150.00'), msg);
  ok('T4 subtotal still 1500', msg.includes('Subtotal: ₹1,500.00'));
}

// ============================================================
// TEST 5 - Only services_net available (no subtotal on bill) -> fallback
// ============================================================
{
  const bill = {
    bill_no: 'INV-046', customer_name: 'Kunal',
    items: [{ service_name: 'Trim', qty: 1, total: 300 }],
    services_net: 300, grand_total: 300, payment_mode: 'cash',
    // note: no `subtotal` and no `discount` -> subtotal falls back to services_net
  };
  const msg = buildMsgFromBill(bill);
  // No discount → subtotal == grandTotal → line is suppressed by helper.
  ok('T5 no discount → no subtotal line', !msg.includes('Subtotal:'), msg);
  ok('T5 has total 300', msg.includes('*Total: ₹300.00*'));
}

// ============================================================
// TEST 6 - Empty phone still shows alert & no URL is opened
// ============================================================
(async () => {
  const rn = require(path.join(__dirname, '__rn_stub.js'));

  rn.__reset();
  const r1 = await sendWhatsAppInvoice({ phone: '', message: 'hi' });
  ok('T6 empty phone -> returns false', r1 === false);
  ok('T6 empty phone -> alert fired', rn.__alerts.length === 1);
  ok('T6 empty phone -> no URL opened', rn.__opened.length === 0);

  rn.__reset();
  const r2 = await sendWhatsAppInvoice({ phone: null, message: 'hi' });
  ok('T6 null phone -> returns false', r2 === false);
  ok('T6 null phone -> alert fired', rn.__alerts.length === 1);
  ok('T6 null phone -> no URL opened', rn.__opened.length === 0);

  // Valid phone still works with the T1 message
  const bill = {
    bill_no: 'INV-042', customer_name: 'Ravi', customer_phone: '9880012345',
    items: [{ service_name: 'Haircut', qty: 1, total: 1000 }],
    subtotal: 2000, discount: 200, tip_amount: 100, grand_total: 1900,
    payment_mode: 'qr',
  };
  const msg = buildMsgFromBill(bill);
  rn.__reset();
  const r3 = await sendWhatsAppInvoice({ phone: bill.customer_phone, message: msg });
  ok('T6 valid phone -> returns true', r3 === true);
  ok('T6 valid phone -> URL opened', rn.__opened.length === 1);
  const url = rn.__opened[0] || '';
  ok('T6 URL starts wa.me/91...', url.startsWith('https://wa.me/919880012345?text='));
  ok('T6 URL encodes UPI', url.includes(encodeURIComponent('_Paid via UPI_')));
  ok('T6 URL encodes discount', url.includes(encodeURIComponent('Discount: -₹200.00')));
  ok('T6 URL encodes subtotal 2000', url.includes(encodeURIComponent('Subtotal: ₹2,000.00')));

  console.log(`\n===== ITER26 RESULTS: ${pass} passed, ${fail} failed =====`);
  process.exit(fail === 0 ? 0 : 1);
})();
