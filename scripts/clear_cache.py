import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv()

async def clear():
    conn = await asyncpg.connect(os.getenv("POSTGRES_DSN"))
    n = await conn.fetchval("SELECT COUNT(*) FROM semantic_cache")
    print(f"Rows before clear: {n}")
    await conn.execute("DELETE FROM semantic_cache")
    await conn.execute("ALTER SEQUENCE semantic_cache_id_seq RESTART WITH 1")
    n2 = await conn.fetchval("SELECT COUNT(*) FROM semantic_cache")
    print(f"Rows after clear: {n2}")
    await conn.close()

asyncio.run(clear())
