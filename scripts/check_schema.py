import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv()

async def check():
    conn = await asyncpg.connect(os.getenv("POSTGRES_DSN"))
    rows = await conn.fetch(
        "SELECT column_name, data_type, column_default "
        "FROM information_schema.columns "
        "WHERE table_name = 'semantic_cache' "
        "ORDER BY ordinal_position"
    )
    print("semantic_cache columns:")
    for r in rows:
        print(f"  {r['column_name']:<20s} {r['data_type']:<20s} default={r['column_default']}")
    count = await conn.fetchval("SELECT COUNT(*) FROM semantic_cache")
    print(f"semantic_cache rows: {count}")
    await conn.close()

asyncio.run(check())
