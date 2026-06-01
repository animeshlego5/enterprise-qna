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


async def retrieve_cached_answer(
    conn: asyncpg.Connection,
    embedding: list[float],
    threshold: float = 0.92,
    top_k: int = 3,
) -> tuple[str, str, float] | None:
    """
    Look up a previously answered question in the semantic cache.

    Performs a cosine similarity search against all cached question embeddings.
    Returns the best match if its similarity score exceeds the threshold.

    Returns:
        (question, answer, similarity) if a match is found above threshold.
        None if no match is found.

    Args:
        conn:       asyncpg connection.
        embedding:  L2-normalized query embedding (384-dim for all-MiniLM-L6-v2).
        threshold:  Minimum cosine similarity to count as a hit (default: 0.92).
        top_k:      Number of nearest neighbours to retrieve before filtering
                    by threshold. We take the best match among top_k candidates.

    The query uses 1 - (embedding <=> $1) to convert cosine distance to cosine
    similarity. pgvector's <=> operator returns cosine distance (0 = identical,
    2 = opposite). We want similarity (1 = identical, -1 = opposite), so we
    subtract from 1.

    ORDER BY ... LIMIT top_k: fetches the top-k nearest neighbours.
    The Python-side filter (similarity >= threshold) then rejects any that are
    above the distance floor but below our semantic threshold. This two-stage
    approach is more readable and debuggable than embedding the threshold
    directly into the SQL WHERE clause — it also lets the IVFFlat index do its
    job (approximate scan) without a full table scan for threshold filtering.

    hit_count increment:
        On a hit, the matching row's hit_count is incremented atomically.
        This is done in a second query rather than inside the SELECT because
        we do not want to mutate the table until we are certain the threshold
        check passes in Python. A subquery UPDATE inside the SELECT could
        increment hit_count even for rows that fail the threshold test.
    """
    rows = await conn.fetch(
        """
        SELECT
            id,
            question,
            answer,
            1 - (embedding <=> $1::vector) AS similarity
        FROM semantic_cache
        ORDER BY embedding <=> $1::vector
        LIMIT $2
        """,
        embedding,
        top_k,
    )

    if not rows:
        return None

    # Find the best match above threshold.
    best = max(rows, key=lambda r: r["similarity"])
    if best["similarity"] < threshold:
        return None

    # Increment hit_count for this entry.
    await conn.execute(
        "UPDATE semantic_cache SET hit_count = hit_count + 1 WHERE id = $1",
        best["id"],
    )

    log.info(
        "cache_hit",
        cache_id=best["id"],
        similarity=round(best["similarity"], 4),
        question_preview=best["question"][:80],
    )

    return best["question"], best["answer"], best["similarity"]