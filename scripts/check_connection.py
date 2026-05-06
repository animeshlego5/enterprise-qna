import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv()

async def check():
    try:
        conn = await asyncpg.connect(os.getenv("POSTGRES_DSN"))
        version = await conn.fetchval("SELECT version()")
        print("Connection successful.")
        print(f"Server: {version[:60]}...")
        await conn.close()
    except Exception as e:
        print(f"Connection failed: {e}")
        print("Check that POSTGRES_DSN in .env is the direct (non-pooled) string.")

asyncio.run(check())