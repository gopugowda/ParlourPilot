import os, requests, json, time, sys
B = os.environ.get('BASE', 'https://salon-invoice-app.preview.emergentagent.com').rstrip('/')
ts = int(time.time())
email = f'wa-iter26-{ts}@resend.dev'
pw = 'Testpass1!'

# signup
r = requests.post(f'{B}/api/tenants/signup', json={
    'business_name': f'WA Iter26 {ts}',
    'owner_name': 'Owner', 'email': email, 'owner_email': email, 'password': pw,
    'phone': '9880012345',
})
print('signup', r.status_code)
if r.status_code >= 400:
    print(r.text); sys.exit(1)
d = r.json(); token = d['token']; tid = d['tenant']['id']
print('tenant_id', tid)
H = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

# get branches
b = requests.get(f'{B}/api/branches', headers=H).json()
branch_id = b[0]['id']
print('branch', branch_id)
H['X-Branch-Id'] = branch_id

# create service
s = requests.post(f'{B}/api/services', headers=H, json={
    'name': 'Haircut', 'price': 1000, 'duration_min': 30,
}).json()
print('service', s.get('id'))
s2 = requests.post(f'{B}/api/services', headers=H, json={
    'name': 'Facial', 'price': 1000, 'duration_min': 45,
}).json()
print('service2', s2.get('id'))

# create beautician
bt = requests.post(f'{B}/api/beauticians', headers=H, json={
    'name': 'Rita', 'commission_pct': 20,
}).json()
print('beautician', bt.get('id'))

# create member with 200 flat discount? simpler: use discount_amount on bill
# Try creating a bill directly with subtotal 2000, discount 200, tip 100, payment_mode qr
payload = {
    'customer_name': 'Ravi',
    'customer_phone': '9880012345',
    'items': [
        {'service_id': s['id'], 'service_name': 'Haircut', 'qty': 1, 'price': 1000, 'total': 1000, 'discount_pct': 10, 'beautician_id': bt['id'], 'beautician_name': 'Rita'},
        {'service_id': s2['id'], 'service_name': 'Facial', 'qty': 1, 'price': 1000, 'total': 1000, 'discount_pct': 10, 'beautician_id': bt['id'], 'beautician_name': 'Rita'},
    ],
    'is_member': False,
    'qr_amount': 1900,
    'tip_amount': 100,
    'tip_via': 'qr',
    'tip_beautician_id': None,
    'payment_mode': 'qr',
}
r = requests.post(f'{B}/api/bills', headers=H, json=payload)
print('bill', r.status_code, r.text[:400])
if r.status_code >= 400:
    sys.exit(1)
bill = r.json()
print('bill_id', bill['id'], 'subtotal', bill.get('subtotal'), 'discount', bill.get('discount'), 'services_net', bill.get('services_net'), 'grand_total', bill.get('grand_total'), 'payment_mode', bill.get('payment_mode'))

# Save context
open('/app/test_reports/tmp/wa_ctx.json', 'w').write(json.dumps({
    'base': B, 'email': email, 'password': pw, 'token': token,
    'tenant_id': tid, 'branch_id': branch_id, 'bill_id': bill['id'],
    'bill': bill,
}))
