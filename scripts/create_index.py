import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv()


async def create_index() -> None:
    conn = await asyncpg.connect(os.getenv("POSTGRES_DSN"))

    try:
        row_count = await conn.fetchval("SELECT COUNT(*) FROM enterprise_docs")
        print(f"Current row count: {row_count}")

        # ivfflat requires at least `lists` rows to build.
        # Rule of thumb: lists = max(row_count // 1000, 10)
        # Do not run on a table with fewer rows than your lists value.
        lists = max(row_count // 1000, 10)
        print(f"Building ivfflat index with lists={lists}...")

        await conn.execute(f"""
            CREATE INDEX IF NOT EXISTS enterprise_docs_embedding_idx
            ON enterprise_docs
            USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = {lists})
        """)
        print("Index created. Queries will now use ANN search instead of sequential scan.")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(create_index())