/**
 * Node-based unit test for whatsappInvoice helper.
 * Uses ts-node to import the TS file directly. We stub 'react-native' so the
 * helper's imports (Alert, Linking, Platform) do not fail under plain node.
 */
const path = require('path');
const Module = require('module');

// Stub 'react-native' before requiring the helper
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'react-native') return path.join(__dirname, '__rn_stub.js');
  return originalResolve.call(this, request, parent, ...rest);
};

require('sucrase/register');

const helper = require(path.resolve(__dirname, '..', 'src/utils/whatsappInvoice.ts'));
const { normalisePhoneForWhatsApp, buildWhatsAppInvoiceMessage, sendWhatsAppInvoice } = helper;

let pass = 0, fail = 0;
const results = [];
function assertEq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, ok, actual, expected });
  if (ok) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, 'expected=', expected, 'actual=', actual); }
}
function assertTrue(name, cond, note='') {
  results.push({ name, ok: !!cond, note });
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, note); }
}

// ---- Phone normalisation edge cases ----
assertEq('phone: 10-digit', normalisePhoneForWhatsApp('9876543210'), '919876543210');
assertEq('phone: +91 spaced', normalisePhoneForWhatsApp('+91 98765 43210'), '919876543210');
assertEq('phone: (91)prefix', normalisePhoneForWhatsApp('(91)9876543210'), '919876543210');
assertEq('phone: 0-prefixed', normalisePhoneForWhatsApp('09876543210'), '919876543210');
assertEq('phone: US +1', normalisePhoneForWhatsApp('+1 (555) 123-4567'), '15551234567');
assertEq('phone: abc', normalisePhoneForWhatsApp('abc'), null);
assertEq('phone: empty', normalisePhoneForWhatsApp(''), null);
assertEq('phone: null', normalisePhoneForWhatsApp(null), null);
assertEq('phone: undefined', normalisePhoneForWhatsApp(undefined), null);

// ---- Message builder validation ----
const msg = buildWhatsAppInvoiceMessage({
  businessName: 'Test Salon',
  billNo: 'INV-001',
  dateStr: '12 Aug 2026, 04:32 PM',
  customerName: 'Ravi',
  items: [
    { name: 'Haircut', qty: 1, price: 500 },
    { name: 'Facial', qty: 2, price: 800 },
  ],
  subtotal: 2100,
  discount: 100,
  tax: 50,
  tip: 30,
  grandTotal: 2080,
  paymentMode: 'Cash',
});
assertTrue('msg: business name bold', msg.includes('*Test Salon*'));
assertTrue('msg: invoice number', msg.includes('Invoice #INV-001'));
assertTrue('msg: date', msg.includes('12 Aug 2026, 04:32 PM'));
assertTrue('msg: customer greeting', msg.includes('Hi Ravi,'));
assertTrue('msg: services header', msg.includes('*Services*'));
assertTrue('msg: bullet char', msg.includes('•'));
assertTrue('msg: item haircut', msg.includes('Haircut'));
assertTrue('msg: item facial with qty', msg.includes('Facial × 2'));
assertTrue('msg: subtotal shows', msg.includes('Subtotal:'));
assertTrue('msg: discount', msg.includes('Discount: -₹100.00'));
assertTrue('msg: tax shown', msg.includes('Tax: ₹50.00'));
assertTrue('msg: tip shown', msg.includes('Tip: ₹30.00'));
assertTrue('msg: total bold', msg.includes('*Total: ₹2,080.00*'));
assertTrue('msg: payment mode italics', msg.includes('_Paid via Cash_'));
assertTrue('msg: thank you line', msg.includes('appreciate your business'));
assertTrue('msg: rupee symbol', msg.includes('₹'));

// Optional-line suppression: no discount/tax/tip
const msg2 = buildWhatsAppInvoiceMessage({
  businessName: 'S', billNo: 1, dateStr: 'now', customerName: 'X',
  items: [{ name: 'A', price: 100 }], grandTotal: 100,
});
assertTrue('msg2: no subtotal (== grand)', !msg2.includes('Subtotal:'));
assertTrue('msg2: no discount', !msg2.includes('Discount:'));
assertTrue('msg2: no tax', !msg2.includes('Tax:'));
assertTrue('msg2: no tip', !msg2.includes('Tip:'));
assertTrue('msg2: no payment mode', !msg2.includes('Paid via'));
assertTrue('msg2: has total', msg2.includes('*Total: ₹100.00*'));

// ---- sendWhatsAppInvoice empty phone / invalid ----
(async () => {
  const rnStub = require(path.join(__dirname, '__rn_stub.js'));
  rnStub.__reset();
  const okEmpty = await sendWhatsAppInvoice({ phone: '', message: 'hi' });
  assertEq('send: empty phone returns false', okEmpty, false);
  assertTrue('send: empty phone alerted', rnStub.__alerts.length === 1);
  assertTrue('send: no URL opened', rnStub.__opened.length === 0);

  rnStub.__reset();
  const okBad = await sendWhatsAppInvoice({ phone: 'abc', message: 'hi' });
  assertEq('send: invalid phone returns false', okBad, false);
  assertTrue('send: invalid phone alerted', rnStub.__alerts.length === 1);

  rnStub.__reset();
  const okValid = await sendWhatsAppInvoice({ phone: '9876543210', message: 'hello world' });
  assertEq('send: valid phone returns true', okValid, true);
  assertTrue('send: URL opened', rnStub.__opened.length === 1);
  const url = rnStub.__opened[0];
  assertTrue('send: url starts with wa.me', url.startsWith('https://wa.me/919876543210?text='));
  assertTrue('send: url encoded text', url.includes(encodeURIComponent('hello world')));

  console.log(`\n===== RESULTS: ${pass} passed, ${fail} failed =====`);
  process.exit(fail === 0 ? 0 : 1);
})();
