"""
Semantic cache write operations.

This module handles inserting new question-answer pairs into the semantic_cache
table. Reading from the cache (lookup) lives in pipeline/retrieval.py alongside
the enterprise_docs retrieval, since both are read operations on pgvector tables.

Separation rationale:
  - retrieval.py: read-only operations on pgvector tables
  - cache.py: write operations on semantic_cache
  - The worker imports from both; routes import from neither (the cache is
    invisible at the HTTP layer)
"""

from __future__ import annotations

import asyncpg
import structlog

log = structlog.get_logger(__name__)


async def write_cache_entry(
    conn: asyncpg.Connection,
    question: str,
    answer: str,
    embedding: list[float],
) -> int:
    """
    Insert a question-answer pair into the semantic cache.

    Returns the new row's id. The id is logged but not used by the caller —
    it is useful for debugging (you can query semantic_cache WHERE id = X to
    inspect a specific entry).

    Args:
        conn:      An asyncpg connection (acquired from the pool by the caller).
        question:  The original question text. Stored for human-readable inspection.
        answer:    The complete generated answer (all tokens concatenated).
        embedding: The L2-normalized query embedding vector (list of floats).
                   Must be 384-dimensional for all-MiniLM-L6-v2.

    Why embedding is the caller's responsibility:
        The worker has already computed the embedding in Stage 1. Recomputing
        it here would double the embedding cost per cache miss. The caller
        passes the pre-computed embedding — single computation, two uses
        (cache lookup attempt + cache write on miss).

    Idempotency note:
        There is no UPSERT or deduplication here. If two workers process
        identical questions concurrently (before either has written to the
        cache), both will insert a row. This results in a duplicate entry,
        which is harmless — subsequent queries will match the first row
        returned by the similarity search (both have equal similarity scores).
        The probability of this race is low in a single-worker setup. Week 5
        adds a distributed lock for the multi-worker case.
    """
    row_id: int = await conn.fetchval(
        """
        INSERT INTO semantic_cache (question, answer, embedding)
        VALUES ($1, $2, $3)
        RETURNING id
        """,
        question,
        answer,
        embedding,
    )
    log.info(
        "cache_entry_written",
        cache_id=row_id,
        question_preview=question[:80],
        answer_length=len(answer),
    )
    return row_id