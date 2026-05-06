import asyncio
import asyncpg
import pgvector.asyncpg
import os
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

load_dotenv()


async def debug(question: str) -> None:
    conn = await asyncpg.connect(os.getenv("POSTGRES_DSN"))
    await pgvector.asyncpg.register_vector(conn)

    model = SentenceTransformer(os.getenv("EMBED_MODEL", "all-MiniLM-L6-v2"))
    emb = model.encode(question, normalize_embeddings=True).tolist()

    # Raw query with no threshold filter — returns the top 3 closest documents
    # regardless of similarity score. If this returns 0 rows, the table is empty.
    rows = await conn.fetch(
        "SELECT content, 1 - (embedding <=> $1::vector) AS similarity "
        "FROM enterprise_docs "
        "ORDER BY embedding <=> $1::vector "
        "LIMIT 3",
        emb,
    )

    if not rows:
        print("No rows returned. The enterprise_docs table is likely empty.")
        print("Re-run: python scripts/seed_docs.py")
    else:
        print(f"Top matches for: '{question}'\n")
        for r in rows:
            print(f"  similarity={r['similarity']:.4f}  {r['content'][:80]}...")

    await conn.close()


if __name__ == "__main__":
    import sys
    question = " ".join(sys.argv[1:]) or "How does the on-call rotation work?"
    asyncio.run(debug(question))