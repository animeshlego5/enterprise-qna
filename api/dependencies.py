"""
FastAPI dependency injection providers.

FastAPI's dependency injection system calls these functions and injects their
return values into route handlers. Dependencies can be:
  - Simple callables (synchronous or async functions)
  - Callable classes with __call__
  - Generator functions (for resources requiring cleanup)

The pool and embed model are application-level singletons initialized in the
lifespan context manager (api/main.py). They are stored on app.state, and
these dependencies extract them from the request's app.state.

Why app.state over module-level globals:
  Module-level globals are initialized at import time. The lifespan context
  manager initializes resources at startup time, after configuration has been
  loaded and validated. Storing them on app.state ties their lifetime to the
  application instance — critical for testing, where you create fresh app
  instances with fresh state rather than sharing module-level state between
  test cases (which causes order-dependent test failures).
"""

from __future__ import annotations
import redis.asyncio as aioredis
import asyncpg
from fastapi import Request
from sentence_transformers import SentenceTransformer


def get_pool(request: Request) -> asyncpg.Pool:
    """
    Inject the application's asyncpg connection pool.

    The pool is initialized in the lifespan context manager and stored at
    app.state.pool. Route handlers that need database access declare this
    as a dependency.

    Usage in a route:
        @router.post("/query")
        async def query_endpoint(
            pool: asyncpg.Pool = Depends(get_pool),
            ...
        ):
            async with pool.acquire() as conn:
                results = await retrieve_docs(conn, ...)

    The pool.acquire() context manager checks out a connection from the pool,
    uses it for the duration of the `async with` block, and returns it to the
    pool on exit. The connection is not closed — it is returned to the pool
    for the next request to reuse. This is the core benefit of pooling.
    """
    pool: asyncpg.Pool = request.app.state.pool
    if pool is None:
        raise RuntimeError(
            "Connection pool is not initialized. "
            "This indicates a lifespan startup failure. Check server logs."
        )
    return pool


def get_embed_model(request: Request) -> SentenceTransformer:
    """
    Inject the sentence-transformers embedding model.

    The model is loaded once at startup and stored at app.state.embed_model.
    SentenceTransformer is not thread-safe for concurrent write access but is
    safe for concurrent read access (inference only). The GIL prevents true
    parallelism in CPython anyway — concurrent encode() calls serialize on
    the GIL and execute sequentially, which is correct behavior.

    For high-concurrency production deployments, the embedding step should
    be offloaded to a dedicated process pool (via asyncio.run_in_executor with
    a ProcessPoolExecutor). That optimization is out of scope for Week 2 — the
    Week 3 async worker architecture addresses it more cleanly.

    Usage in a route:
        @router.post("/query")
        async def query_endpoint(
            embed_model: SentenceTransformer = Depends(get_embed_model),
            ...
        ):
            embedding = embed_model.encode(question, normalize_embeddings=True)
    """
    model: SentenceTransformer = request.app.state.embed_model
    if model is None:
        raise RuntimeError(
            "Embedding model is not initialized. "
            "This indicates a lifespan startup failure. Check server logs."
        )
    return model

def get_redis(request: Request) -> aioredis.Redis:
    """
    Inject the application's Redis client.

    The client is initialized in the lifespan context manager and stored at
    app.state.redis. It is a single persistent connection (not a pool) because:

        1. Upstash free tier's connection limit is 100. A pool is unnecessary here.
        2. The Redis client is async-safe for concurrent use — multiple coroutines
            can share one connection. Unlike asyncpg (which requires exclusive
            connection use per query), redis-py's async client multiplexes commands
            over a single connection using asyncio's event loop coordination.

    The pub/sub subscriber in the SSE route creates its own dedicated connection
    (via redis_client.pubsub()) because pub/sub requires an exclusive connection
    state — you cannot interleave pub/sub subscriptions with regular commands on
    the same connection object.
    """
    client: aioredis.Redis = request.app.state.redis
    if client is None:
        raise RuntimeError(
            "Redis client is not initialized. "
            "This indicates a lifespan startup failure. Check server logs."
        )
    return client