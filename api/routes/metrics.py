"""
Prometheus metrics endpoint — Week 5.

GET /metrics returns all registered metrics in Prometheus exposition format.
Prometheus scrapes this endpoint on a configurable interval (default: 15s).

Metric design:
  - Counters track totals that only go up (jobs submitted, cache outcomes).
  - Labels on CACHE_LOOKUPS allow PromQL to compute hit rate without knowing
    metric names in advance:
      rate(qna_cache_lookups_total{result="hit"}[5m])
      / rate(qna_cache_lookups_total[5m])
  - JOB_DURATION is a histogram so p50/p95/p99 latencies are queryable.

All metric objects are module-level singletons. Prometheus raises ValueError
if the same metric name is registered twice in one process — module-level
definition ensures a single instance per process lifetime regardless of how
many times the module is imported.

Worker-side counters (CACHE_LOOKUPS, JOB_DURATION) are imported by
workers/llm_worker.py and incremented there. Each process has its own
in-process Prometheus registry — the worker's increments do not appear in
the API's /metrics output. For a production multi-process setup, use a
Prometheus Pushgateway or run a metrics server inside the worker process.
For Week 5, API-side counters (JOBS_SUBMITTED, SSE_CONNECTIONS) are
sufficient for a meaningful cache hit rate dashboard.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import Response
from prometheus_client import (
    Counter,
    Histogram,
    CONTENT_TYPE_LATEST,
    generate_latest,
)

router = APIRouter()

# ── Counters ──────────────────────────────────────────────────────────────────

JOBS_SUBMITTED = Counter(
    "qna_jobs_submitted_total",
    "Total number of RAG jobs submitted via POST /api/query.",
)

# result label values: "hit", "miss", "guardrail"
CACHE_LOOKUPS = Counter(
    "qna_cache_lookups_total",
    "Total semantic cache lookups, labelled by result.",
    ["result"],
)

SSE_CONNECTIONS = Counter(
    "qna_sse_connections_total",
    "Total SSE stream connections opened via GET /api/query/{job_id}/stream.",
)

# ── Histograms ────────────────────────────────────────────────────────────────

# Buckets span the observed latency range for this system:
#   <0.1s  → cache hits (local Postgres)
#   0.1–1.5s → cache hits (Neon cloud, ~1s RTT)
#   1.5–5s → cold pipeline (embed + retrieve + LLM)
#   5–10s  → slow LLM or high DB latency
JOB_DURATION = Histogram(
    "qna_job_duration_seconds",
    "End-to-end job processing time in the worker, in seconds.",
    buckets=[0.05, 0.1, 0.25, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0, 7.5, 10.0],
)


@router.get(
    "/metrics",
    summary="Prometheus metrics",
    description=(
        "Returns all registered Prometheus metrics in text exposition format. "
        "Scrape with Prometheus at 15s interval. "
        "Restrict access at the network level in production."
    ),
    include_in_schema=False,
)
async def metrics() -> Response:
    return Response(
        content=generate_latest(),
        media_type=CONTENT_TYPE_LATEST,
    )
