import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv()

SQL_FILE = "scripts/init_db.sql"


async def run_schema() -> None:
    conn = await asyncpg.connect(os.getenv("POSTGRES_DSN"))

    with open(SQL_FILE, "r", encoding="utf-8") as f:
        sql = f.read()

    try:
        # asyncpg's execute() supports multiple semicolon-separated statements
        # via PostgreSQL's simple query protocol. The entire SQL file is sent
        # as one string and all statements execute in sequence.
        await conn.execute(sql)
        print("Schema applied successfully.\n")

        # Verify tables were created
        tables = await conn.fetch("""
            SELECT tablename
            FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename;
        """)
        print("Tables in database:")
        for row in tables:
            print(f"  ✓ {row['tablename']}")

    except Exception as e:
        print(f"Schema error: {e}")
        raise
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run_schema())