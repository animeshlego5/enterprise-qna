import asyncio
import asyncpg
import pgvector.asyncpg  # Must be imported to register the vector codec
import os
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

load_dotenv()

# Mock enterprise knowledge base.
# In production, these would be chunks derived from PDFs, Confluence pages,
# Notion docs, or Slack threads — processed by an ingestion pipeline.
# Document chunking strategy (how large documents are split before embedding)
# is its own discipline and is out of scope for Week 1.
DOCS = [
    "Our Q3 2024 revenue was $4.2M, up 18% year-over-year driven by enterprise tier growth.",
    "The engineering team follows a two-week sprint cycle with planning on Mondays and retros on Fridays.",
    "Employee benefits include health, dental, vision, a $2000 annual learning budget, and flexible PTO.",
    "Our data retention policy requires all customer data to be deleted within 30 days of account closure.",
    "The on-call rotation uses PagerDuty with a one-week rotation schedule among senior engineers.",
    "Our API rate limit is 1000 requests per minute per API key for enterprise tier customers.",
]


async def seed() -> None:
    print("Loading sentence-transformers model...")
    # First run downloads from HuggingFace (~90MB). Subsequent runs load from
    # local cache in ~500ms.
    model = SentenceTransformer(os.getenv("EMBED_MODEL"))

    # Neon requires SSL. asyncpg reads the ?sslmode=require parameter from the
    # DSN automatically — no additional ssl= keyword argument needed.
    conn = await asyncpg.connect(os.getenv("POSTGRES_DSN"))

    # REQUIRED: Register the pgvector codec with this connection.
    # Without this call, asyncpg has no idea what the PostgreSQL `vector` type
    # is. It falls back to treating it as text, and passing a list[float] for
    # a text column raises: "expected str, got list".
    # This must be called on every new connection before any vector query or insert.
    await pgvector.asyncpg.register_vector(conn)

    try:
        await conn.execute("DELETE FROM enterprise_docs")
        print("Cleared existing documents.")

        # Batch encoding: all documents are embedded in a single forward pass.
        # Significantly faster than encoding one-at-a-time because PyTorch
        # executes a single matrix multiplication across the entire batch.
        print(f"Encoding {len(DOCS)} documents (batch)...")
        embeddings = model.encode(DOCS, normalize_embeddings=True)
        # normalize_embeddings=True: sets each vector's L2 norm to 1.0.
        # Required for correct cosine similarity semantics. Without it, longer
        # documents produce higher-magnitude vectors than shorter ones, introducing
        # a spurious length bias into your similarity rankings.

        for doc, emb in zip(DOCS, embeddings):
            await conn.execute(
                "INSERT INTO enterprise_docs (content, embedding) VALUES ($1, $2)",
                doc,
                emb.tolist(),
                # emb is a numpy.ndarray. emb.tolist() converts it to list[float].
                # After register_vector() is called above, asyncpg knows how to
                # serialize list[float] into PostgreSQL's vector type correctly.
            )
            print(f"  ✓ {doc[:72]}...")

        # Success message is INSIDE the try block, not finally.
        # If any insert fails, this line is never reached — you get the real
        # error instead of a false "Seeding complete" message that masks the failure.
        print(f"\nSeeding complete. {len(DOCS)} documents inserted.")

    except asyncpg.PostgresError as e:
        print(f"[Database Error] {e}")
        raise
    finally:
        # finally only closes the connection — it no longer prints a success
        # message, because finally always runs whether or not an exception occurred.
        await conn.close()


if __name__ == "__main__":
    asyncio.run(seed())