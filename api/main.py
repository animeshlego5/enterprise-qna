"""
FastAPI application entry point.

Week 3 additions to lifespan:
  - redis.asyncio client initialized at startup, stored at app.state.redis
  - Redis connectivity verified with a PING before accepting requests
  - Redis client closed cleanly on shutdown

The FastAPI router is also updated to import from the new api/routes/query.py,
which now handles job submission and SSE streaming by job_id rather than
inline pipeline execution.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

import asyncpg
import pgvector.asyncpg
import redis.asyncio as aioredis
import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer

from api.logging_config import configure_logging
configure_logging()

log = structlog.get_logger(__name__)

from api.routes import health, query as query_router

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    Manage application-wide resource lifecycle.

    Startup order:
      1. asyncpg pool  — database layer, required for health check
      2. Redis client  — queue layer, required for job submission
      3. Embedding model — ML layer, required for... wait.

    Week 3 change: the embedding model is NO LONGER initialized in FastAPI's
    lifespan. The API process no longer runs the pipeline — the worker does.
    Initializing the model here would waste ~90MB of RAM and ~500ms of startup
    time in the API process for a resource it never uses.

    The embedding model now lives exclusively in the worker process
    (workers/llm_worker.py), where it belongs.
    """
    # ── Startup ──────────────────────────────────────────────────────────────
    log.info("startup_begin", service="enterprise-qna-api", version="3.0.0")

    # asyncpg pool (unchanged from Week 2)
    postgres_dsn = os.getenv("POSTGRES_DSN")
    if not postgres_dsn:
        raise EnvironmentError("POSTGRES_DSN is not set in .env")

    pool_min = int(os.getenv("POOL_MIN_SIZE", "1"))
    pool_max = int(os.getenv("POOL_MAX_SIZE", "5"))

    log.info("pool_initializing", min_size=pool_min, max_size=pool_max)
    pool = await asyncpg.create_pool(
        postgres_dsn,
        min_size=pool_min,
        max_size=pool_max,
        setup=pgvector.asyncpg.register_vector,
    )
    async with pool.acquire() as conn:
        await conn.fetchval("SELECT 1")
    log.info("pool_ready")
    app.state.pool = pool

    # Redis client (new in Week 3)
    redis_url = os.getenv("REDIS_URL")
    if not redis_url:
        raise EnvironmentError("REDIS_URL is not set in .env")

    log.info("redis_initializing", url_prefix=redis_url[:30] + "...")
    redis_client = aioredis.from_url(
        redis_url,
        # decode_responses=True: all Redis responses are returned as str,
        # not bytes. Without this, every field value from XREADGROUP,
        # every GET result, and every pub/sub message["data"] would be
        # bytes requiring .decode("utf-8") calls throughout the codebase.
        decode_responses=True,
    )

    # Verify connectivity with a PING.
    # from_url() does not open a connection — it constructs the client.
    # The connection is established on the first command. PING here ensures
    # the URL is valid and Upstash is reachable before any requests are served.
    ping_result = await redis_client.ping()
    if not ping_result:
        raise RuntimeError("Redis PING returned False. Check REDIS_URL in .env.")
    log.info("redis_ready")
    app.state.redis = redis_client

    # Embedding model: NOT initialized here in Week 3.
    # The API process no longer runs the RAG pipeline.
    # See workers/llm_worker.py for model initialization.
    app.state.embed_model = None  # Explicit None — DI will raise if accidentally called.

    log.info("startup_complete", service="enterprise-qna-api", version="3.0.0")

    # ── Yield: server is live ─────────────────────────────────────────────────
    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    log.info("shutdown_begin")
    await pool.close()
    await redis_client.aclose()
    log.info("shutdown_complete")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Enterprise QnA API",
        description=(
            "RAG-based question answering over an enterprise knowledge base. "
            "Jobs are queued via Redis Streams and processed by an async worker. "
            "Answers stream token-by-token over Server-Sent Events via Redis pub/sub."
        ),
        version="3.0.0",
        lifespan=lifespan,
        redoc_url=None,
    )

    raw_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000")
    allowed_origins = [o.strip() for o in raw_origins.split(",") if o.strip()]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Accept", "Cache-Control"],
    )

    app.include_router(health.router, tags=["Health"])
    app.include_router(query_router.router, prefix="/api", tags=["Query"])

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "api.main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        reload=True,
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
    )