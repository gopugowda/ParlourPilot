import asyncio, os, sys, uuid
sys.path.insert(0, '/app/backend')
os.chdir('/app/backend')
from dotenv import load_dotenv; load_dotenv('/app/backend/.env')
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timezone

async def main():
    c = AsyncIOMotorClient(os.environ['MONGO_URL'])
    db = c[os.environ.get('DB_NAME', 'glowup_db')]
    tid = 'b4375f81-d72b-4567-89b5-1d42043b8fbc'
    bid = '4a513ca0-2b02-4822-96b6-9b889ac0aeb3'
    # Wipe any existing services on this tenant to keep the test clean
    await db.services.delete_many({'tenant_id': tid})
    now = datetime.now(timezone.utc).isoformat()
    seeds = [
        ('001', 'Hair Cut', 100, 'Unisex', 'General'),
        ('002', 'Shaving', 100, 'Men', 'Hair'),
        ('005', 'Hair Spa', 800, 'Ladies', 'Hair'),
    ]
    docs = []
    for code, name, price, stype, cat in seeds:
        docs.append({
            'id': str(uuid.uuid4()),
            'tenant_id': tid,
            'branch_id': bid,
            'name': name,
            'price': float(price),
            'item_code': code,
            'service_type': stype,
            'variable_price': False,
            'additional_price': 0.0,
            'gender': stype.lower(),
            'category': cat,
            'tax_percentage': 0.0,
            'active': True,
            'created_at': now,
        })
    await db.services.insert_many(docs)
    print(f'Inserted {len(docs)} test services with item codes.')
    c.close()

asyncio.run(main())
