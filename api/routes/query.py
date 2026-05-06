"""
Query endpoints — Week 3.

Two endpoints replace the single Week 2 SSE endpoint:

POST /api/query
    Validates the request, generates a job_id, pushes the job onto the Redis
    Stream, sets a status key, and returns {job_id, stream_url} as JSON.
    Response time: ~8–15ms. The LLM is never touched.

GET /api/query/{job_id}/stream
    Opens an SSE connection. Subscribes to the Redis pub/sub channel for this
    job_id and forwards events as they are published by the worker.
    The worker publishes: metadata, token, done, error, guardrail events —
    identical to the event types the Week 2 inline pipeline emitted.
    The client-facing SSE protocol is unchanged. Only the delivery path changes.

This separation means the HTTP client can implement retry logic independently:
if the SSE connection drops, it reconnects to /api/query/{job_id}/stream
without re-submitting the job. The job continues processing in the worker
regardless of whether the SSE client is connected.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from collections.abc import AsyncIterator

import redis.asyncio as aioredis
import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from sse_starlette.sse import EventSourceResponse

from api.dependencies import get_pool, get_redis
from api.models import JobSubmitResponse, JobStatus, QueryRequest

log = structlog.get_logger(__name__)

router = APIRouter()


# ── POST /api/query ───────────────────────────────────────────────────────────

@router.post(
    "/query",
    response_model=JobSubmitResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit a question for async processing",
    description=(
        "Validates the question, enqueues it as a job in the Redis Stream, "
        "and returns a job_id immediately. Use the returned stream_url to open "
        "an SSE connection and receive the answer token-by-token.\n\n"
        "**HTTP 202 Accepted** — the request has been accepted for processing "
        "but is not yet complete. This is the semantically correct status code "
        "for async job submission. HTTP 200 would imply the work is done."
    ),
)
async def submit_query(
    body: QueryRequest,
    redis_client: aioredis.Redis = Depends(get_redis),
) -> JobSubmitResponse:
    """
    Enqueue a RAG job.

    Steps:
      1. Generate a unique job_id (UUID4).
      2. SET job:{job_id}:status = "queued" with TTL.
         This key serves two purposes:
           a) The SSE endpoint checks it to verify the job exists before
              subscribing — fast-fail instead of hanging for 120s.
           b) It signals whether the job is queued, processing, done, or errored.
      3. XADD to the Redis Stream — this is the durable job record.
         The stream persists the job even if the worker is not running yet.
      4. Return {job_id, stream_url, status: "queued"}.

    Note: get_embed_model is not a dependency here. The API process no longer
    runs the pipeline. This endpoint does zero ML work.
    """
    job_id = str(uuid.uuid4())
    stream_key = os.getenv("REDIS_STREAM_KEY", "jobs")
    ttl = int(os.getenv("JOB_TTL_SECONDS", "300"))

    structlog.contextvars.bind_contextvars(
        job_id=job_id,
        question=body.question[:80],
    )

    log.info(
        "job_submitting",
        top_k=body.top_k,
        similarity_threshold=body.similarity_threshold,
    )

    # Set status key first. If XADD fails, the status key is orphaned (harmless).
    # If status key is set after XADD, the worker could theoretically process the
    # job before the status key is written — the SSE endpoint would then return 404.
    # Write status first: correct ordering.
    await redis_client.set(
        f"job:{job_id}:status",
        JobStatus.QUEUED,
        ex=ttl,
    )

    # XADD pushes the job onto the stream.
    # Redis Streams store each message as a set of field-value pairs (flat dict).
    # All values must be strings — int/float fields are serialized here and
    # deserialized by the worker.
    # The '*' argument tells Redis to auto-generate the message ID (timestamp-based).
    await redis_client.xadd(
        stream_key,
        {
            "job_id": job_id,
            "question": body.question,
            "top_k": str(body.top_k),
            "similarity_threshold": str(body.similarity_threshold),
        },
    )

    log.info("job_submitted", stream_key=stream_key)
    structlog.contextvars.clear_contextvars()

    return JobSubmitResponse(
        job_id=job_id,
        stream_url=f"/api/query/{job_id}/stream",
        status=JobStatus.QUEUED,
    )


# ── GET /api/query/{job_id}/stream ───────────────────────────────────────────

async def _job_sse_generator(
    job_id: str,
    redis_client: aioredis.Redis,
) -> AsyncIterator[dict]:
    """
    Async generator that subscribes to the job's pub/sub channel and yields
    SSE event dicts as the worker publishes them.

    Event types (published by workers/llm_worker.py, forwarded here verbatim):
        "metadata"  — retrieval stats, emitted before token generation starts
        "token"     — one token of the generated answer
        "done"      — stream complete sentinel, "[DONE]"
        "error"     — worker-side error, stream ends
        "guardrail" — no docs above threshold, LLM not called, stream ends

    Design note — subscribe before checking status:
        The generator subscribes to the pub/sub channel BEFORE checking job
        status. If the check happened first and the worker published "done"
        between the check and the subscribe, the client would miss all events.
        Subscribe first eliminates this race condition: events published after
        the subscription are guaranteed to be received.

    Timeout:
        If the worker does not publish a terminal event (done/error/guardrail)
        within STREAM_TIMEOUT_SECONDS, the generator yields an error event and
        closes. This handles the case where the worker crashes after accepting
        a job but before processing it.
    """
    channel = f"job:{job_id}"
    timeout_seconds = int(os.getenv("STREAM_TIMEOUT_SECONDS", "120"))

    structlog.contextvars.bind_contextvars(job_id=job_id)

    # Create a dedicated pub/sub connection.
    # Pub/sub requires an exclusive connection — see api/dependencies.py for
    # the explanation of why this cannot share the main redis_client connection.
    pubsub = redis_client.pubsub()
    await pubsub.subscribe(channel)
    log.info("sse_subscribed", channel=channel, timeout_seconds=timeout_seconds)

    try:
        # asyncio.timeout() raises asyncio.TimeoutError if the entire block
        # does not complete within timeout_seconds. This is Python 3.11+.
        async with asyncio.timeout(timeout_seconds):
            async for raw_message in pubsub.listen():
                # pub/sub listen() yields several message types:
                #   "subscribe"   — confirmation of subscription (ignore)
                #   "unsubscribe" — confirmation of unsubscription (ignore)
                #   "message"     — actual data published by the worker (handle)
                if raw_message["type"] != "message":
                    continue

                # The worker publishes JSON strings.
                # decode_responses=True on the client means data is already str.
                event_data: dict = json.loads(raw_message["data"])
                yield event_data

                # Terminal events: stop listening after these.
                # "done" and "error" signal normal/abnormal completion.
                # "guardrail" means the worker ran but found no relevant docs.
                if event_data.get("event") in ("done", "error", "guardrail"):
                    log.info(
                        "sse_terminal_event_received",
                        event_type=event_data.get("event"),
                    )
                    break

    except asyncio.TimeoutError:
        log.warning(
            "sse_stream_timeout",
            timeout_seconds=timeout_seconds,
            channel=channel,
        )
        yield {
            "event": "error",
            "data": json.dumps({
                "message": (
                    f"Stream timed out after {timeout_seconds}s. "
                    "The worker may have failed to process this job. "
                    "Check worker logs."
                ),
                "job_id": job_id,
            }),
        }

    finally:
        # Always unsubscribe and close the pub/sub connection.
        # Without this, the connection leaks — Upstash counts it against
        # your connection limit until it times out server-side.
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()
        structlog.contextvars.clear_contextvars()
        log.info("sse_connection_closed", channel=channel)


@router.get(
    "/query/{job_id}/stream",
    summary="Stream job results via SSE",
    description=(
        "Opens a Server-Sent Events stream for the given job_id. "
        "Events are forwarded from the Redis pub/sub channel as the worker "
        "publishes them. Connect immediately after POST /api/query to avoid "
        "missing early token events.\n\n"
        "Returns **404** if the job_id does not exist or has expired "
        f"(TTL: JOB_TTL_SECONDS seconds)."
    ),
    status_code=status.HTTP_200_OK,
)
async def stream_job_result(
    job_id: str,
    redis_client: aioredis.Redis = Depends(get_redis),
) -> EventSourceResponse:
    """
    GET /api/query/{job_id}/stream

    Fast-fail: verify the job exists in Redis before opening the SSE connection.
    Without this check, a client with an invalid job_id would receive an open
    SSE connection that hangs silently for STREAM_TIMEOUT_SECONDS before getting
    a timeout error — a poor developer experience.

    The check reads job:{job_id}:status. If the key does not exist:
      - The job was never submitted (invalid job_id), OR
      - The job's TTL has expired (client connected too late)
    Either way, 404 is the correct response.
    """
    status_val = await redis_client.get(f"job:{job_id}:status")
    if status_val is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Job '{job_id}' not found. "
                "It may have expired or the job_id is invalid. "
                f"Jobs expire after JOB_TTL_SECONDS={os.getenv('JOB_TTL_SECONDS', '300')} seconds."
            ),
        )

    log.info("sse_stream_opening", job_id=job_id, current_status=status_val)

    return EventSourceResponse(
        _job_sse_generator(job_id=job_id, redis_client=redis_client),
        media_type="text/event-stream",
        ping=15,
    )