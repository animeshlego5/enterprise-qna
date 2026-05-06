"""
Health check endpoint: GET /health

Returns the operational status of the API and its dependencies.
Used by:
  - Docker health checks (Week 5: HEALTHCHECK instruction in Dockerfile)
  - Kubernetes liveness/readiness probes (if you ever deploy to k8s)
  - Load balancer health checks
  - Your own monitoring dashboards

A health endpoint must be fast (no LLM calls, minimal DB round-trip)
and must not return 200 OK if a critical dependency is unavailable.
Returning 200 when the database is down would cause a load balancer to
route traffic to a broken instance — the worst possible outcome for a
health check.

HTTP status codes:
  200 — All dependencies healthy. Ready to serve requests.
  503 — One or more critical dependencies unavailable. Not ready.
"""

from __future__ import annotations

import os

import asyncpg
import structlog
from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse

from api.dependencies import get_pool
from api.models import HealthResponse

log = structlog.get_logger(__name__)

router = APIRouter()


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="API health check",
    description=(
        "Returns 200 with database status and embed model name when healthy. "
        "Returns 503 when a critical dependency is unavailable."
    ),
)
async def health_check(
    pool: asyncpg.Pool = Depends(get_pool),
) -> JSONResponse:
    """
    Verify database connectivity and return system status.

    Performs a lightweight SELECT 1 ping against the connection pool.
    Does not call the LLM — LLM availability is not checked here because
    Gemini API calls are billable and the free-tier rate limit (10 RPM)
    must not be consumed by health check polling.
    """
    db_status = "connected"
    http_status = status.HTTP_200_OK

    try:
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
    except Exception as exc:
        db_status = f"error: {type(exc).__name__}: {exc}"
        http_status = status.HTTP_503_SERVICE_UNAVAILABLE
        log.error("health_check_db_failure", error=str(exc))

    embed_model_name = os.getenv("EMBED_MODEL", "all-MiniLM-L6-v2")

    response_body = HealthResponse(
        status="healthy" if http_status == 200 else "degraded",
        database=db_status,
        embed_model=embed_model_name,
        version="2.0.0",
    )

    log.info(
        "health_check",
        status=response_body.status,
        database=db_status,
    )

    return JSONResponse(
        content=response_body.model_dump(),
        status_code=http_status,
    )