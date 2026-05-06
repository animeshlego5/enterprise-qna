import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv()

async def test():
    conn = await asyncpg.connect(os.getenv("POSTGRES_DSN"))

    result = await conn.fetch("SELECT 1;")
    print("✅ Connected successfully:", result)

    await conn.close()

asyncio.run(test())