"""
Vector retrieval against Neon pgvector.

Extracted from pipeline/query.py to avoid circular imports when api/routes/query.py
and pipeline/query.py (CLI) both need retrieve_docs().

This module has no FastAPI dependencies — it is pure asyncpg + SQL. It can be
tested in isolation without an HTTP server.
"""

from __future__ import annotations

import structlog

import asyncpg

log = structlog.get_logger(__name__)


async def retrieve_docs(
    conn: asyncpg.Connection,
    query_embedding: list[float],
    top_k: int,
    similarity_threshold: float,
) -> list[tuple[str, float]]:
    """
    Cosine similarity search against enterprise_docs on Neon.

    Uses the <=> operator (cosine distance) ordered ascending (lowest distance
    first = most similar first). The similarity score returned is 1 - distance,
    so 1.0 is identical and 0.0 is orthogonal.

    The threshold filter happens in Python rather than SQL by design: we always
    fetch top_k rows (letting PostgreSQL use its ordering) and then filter by
    threshold. The alternative — a WHERE clause filter — would prevent PostgreSQL
    from using a future ivfflat index efficiently, because ivfflat is a
    scan-then-filter structure; adding a WHERE on a computed expression breaks
    the planner's ability to use the index's distance ordering.

    Args:
        conn: Active asyncpg connection or pool-acquired connection.
              register_vector() must have been called on this connection
              or the pool before this function is called.
        query_embedding: Normalized 384-dim float list. Must be produced by
                         the same model and normalize_embeddings=True setting
                         used during document seeding. Mismatched models produce
                         incomparable vectors — all similarity scores will be
                         meaningless (typically clustering around 0.0–0.3
                         regardless of semantic content).
        top_k: Number of candidates to fetch from pgvector before threshold filtering.
        similarity_threshold: Minimum cosine similarity (inclusive) for a document
                              to be included in the returned results.

    Returns:
        List of (content, similarity) tuples, ordered by similarity descending.
        Empty list if no documents exceed the threshold.

    Raises:
        asyncpg.PostgresError: On query execution failure. Caller is responsible
                               for handling — this function does not swallow DB errors.
    """
    rows = await conn.fetch(
        """
        SELECT
            content,
            1 - (embedding <=> $1::vector) AS similarity
        FROM enterprise_docs
        ORDER BY embedding <=> $1::vector
        LIMIT $2
        """,
        query_embedding,
        top_k,
    )

    results = [
        (row["content"], float(row["similarity"]))
        for row in rows
        if float(row["similarity"]) > similarity_threshold
    ]

    log.debug(
        "retrieval_complete",
        candidates_fetched=len(rows),
        docs_above_threshold=len(results),
        similarity_threshold=similarity_threshold,
        top_similarity=round(results[0][1], 4) if results else None,
    )

    return results