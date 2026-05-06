import asyncio
import asyncpg
import pgvector.asyncpg
import os
from dotenv import load_dotenv

load_dotenv()


async def verify() -> None:
    conn = await asyncpg.connect(os.getenv("POSTGRES_DSN"))
    await pgvector.asyncpg.register_vector(conn)

    try:
        count = await conn.fetchval("SELECT COUNT(*) FROM enterprise_docs")
        print(f"Rows in enterprise_docs: {count}\n")

        rows = await conn.fetch(
            "SELECT id, LEFT(content, 65) AS preview FROM enterprise_docs ORDER BY id"
        )
        for r in rows:
            print(f"  [{r['id']}] {r['preview']}...")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(verify())