"""
Async LLM worker process.

Runs as a completely separate Python process from the FastAPI server:
    python -m workers.llm_worker

Responsibilities:
  1. Initialize its own asyncpg pool and embedding model at startup.
     These resources are exclusive to the worker — the API process no longer
     holds them.
  2. Create (or verify) the Redis consumer group.
  3. Poll the Redis Stream using XREADGROUP in a loop.
  4. For each job: run the full RAG pipeline (embed → retrieve → prompt → generate).
  5. Publish each generated token to the job's Redis pub/sub channel.
  6. Acknowledge the message with XACK after completion.
  7. Update the job status key in Redis throughout processing.

Redis Streams vs. pub/sub for the job queue:
    The job queue uses Redis Streams (XADD/XREADGROUP/XACK), NOT pub/sub.
    Reason: Streams are persistent. If the worker is not running when a job is
    submitted, the job waits in the stream until the worker starts and reads it.
    pub/sub is ephemeral — a message published when no subscribers are listening
    is lost forever. For a job queue, durability is non-negotiable.

    The token delivery back to the SSE endpoint uses pub/sub (PUBLISH/SUBSCRIBE).
    Reason: tokens are time-sensitive streaming data, not durable records. Once
    the SSE client has received a token and displayed it, there is no reason to
    store it. pub/sub is the correct tool for ephemeral real-time fan-out.

Consumer groups:
    The worker uses XREADGROUP rather than plain XREAD. Consumer groups provide:
      - Exactly-once delivery: each job is delivered to exactly one worker.
      - Pending acknowledgement: if a worker crashes mid-job, the message stays
        "pending" in the group and can be reclaimed on worker restart.
      - Horizontal scaling: multiple workers in the same group share load.
        (Week 5 adds a second worker container to demonstrate this.)

Worker restart behaviour:
    On startup, the worker checks for its own pending messages — jobs that were
    delivered to this consumer name in a previous run but never acknowledged
    (because the worker crashed). It reclaims and reprocesses them before
    reading new jobs.

Error handling:
    Per-job errors (LLM failure, DB failure) are caught, published as an SSE
    "error" event, and acknowledged. The worker continues processing.
    Connection-level errors (Redis or DB unreachable) trigger a restart loop
    with exponential backoff — the worker retries connection indefinitely.
"""
from __future__ import annotations

from pipeline.cache import write_cache_entry
from pipeline.retrieval import retrieve_docs, retrieve_cached_answer

import asyncio
import hashlib
import json
import os
import signal
import time
from typing import Any

import asyncpg
import pgvector.asyncpg
import redis.asyncio as aioredis
import structlog
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer

from api.logging_config import configure_logging
from pipeline.llm import get_llm
from pipeline.rag_prompt import RAG_PROMPT

load_dotenv()
configure_logging()

log = structlog.get_logger(__name__)

# ── Configuration (read once at module import) ────────────────────────────────

STREAM_KEY = os.getenv("REDIS_STREAM_KEY", "jobs")
GROUP_NAME = os.getenv("REDIS_CONSUMER_GROUP", "qna-workers")
CONSUMER_NAME = os.getenv("REDIS_CONSUMER_NAME", "worker-1")
JOB_TTL = int(os.getenv("JOB_TTL_SECONDS", "300"))
SIMILARITY_THRESHOLD = float(os.getenv("SIMILARITY_THRESHOLD", "0.20"))
TOP_K = int(os.getenv("TOP_K_RESULTS", "3"))

# XREADGROUP block timeout in milliseconds.
# 5000ms: the worker blocks for up to 5 seconds waiting for a new message.
# If no message arrives, the loop continues (allowing clean shutdown on
# KeyboardInterrupt between polls). A longer value reduces CPU usage but
# increases shutdown delay.
BLOCK_MS = 5000

# ── Graceful shutdown ─────────────────────────────────────────────────────────
# Set to True when SIGTERM or SIGINT is received. The poll loop checks this flag
# between XREADGROUP calls and exits cleanly after the current job completes.
# Docker sends SIGTERM on `docker compose down` / `docker stop`. Without an
# explicit handler, SIGTERM kills the process immediately (unlike SIGINT which
# raises KeyboardInterrupt in Python). With this handler the worker finishes
# its current job before stopping — no jobs left in the PEL mid-generation.
_shutdown_requested = False


def _handle_signal(signum: int, frame: object) -> None:
    global _shutdown_requested
    _shutdown_requested = True


signal.signal(signal.SIGTERM, _handle_signal)
signal.signal(signal.SIGINT, _handle_signal)


# ── Resource initialization ───────────────────────────────────────────────────

async def _create_redis_client() -> aioredis.Redis:
    """Create and verify the Redis client."""
    redis_url = os.getenv("REDIS_URL")
    if not redis_url:
        raise EnvironmentError("REDIS_URL is not set in .env")

    client = aioredis.from_url(redis_url, decode_responses=True)
    await client.ping()
    log.info("worker_redis_ready")
    return client


async def _create_db_pool() -> asyncpg.Pool:
    """Create and verify the asyncpg connection pool."""
    postgres_dsn = os.getenv("POSTGRES_DSN")
    if not postgres_dsn:
        raise EnvironmentError("POSTGRES_DSN is not set in .env")

    pool = await asyncpg.create_pool(
        postgres_dsn,
        min_size=int(os.getenv("POOL_MIN_SIZE", "1")),
        max_size=int(os.getenv("POOL_MAX_SIZE", "5")),
        setup=pgvector.asyncpg.register_vector,
    )
    async with pool.acquire() as conn:
        await conn.fetchval("SELECT 1")
    log.info("worker_db_pool_ready")
    return pool


def _load_embed_model() -> SentenceTransformer:
    """
    Load the sentence-transformers model.

    This is the only place in Week 3 where the embedding model is initialized.
    The API process no longer holds this resource.

    SentenceTransformer initialization is synchronous and blocking (~500ms).
    It is called once at worker startup, not inside the async processing loop.
    Calling it inside the async loop would block the event loop for 500ms on
    every job — exactly the pattern we are eliminating with this architecture.
    """
    model_name = os.getenv("EMBED_MODEL", "all-MiniLM-L6-v2")
    log.info("worker_embed_model_loading", model=model_name)
    model = SentenceTransformer(model_name)
    log.info("worker_embed_model_ready", model=model_name)
    return model


async def _ensure_consumer_group(redis_client: aioredis.Redis) -> None:
    """
    Create the Redis consumer group if it does not already exist.

    XGROUP CREATE with MKSTREAM:
      - Creates the consumer group on the stream.
      - MKSTREAM creates the stream itself if it does not exist yet
        (e.g., first worker startup before any jobs are submitted).
      - The '0' ID argument means: the group starts reading from the very
        beginning of the stream. This ensures pending messages from a previous
        worker run are visible to the new group.

    ResponseError with 'BUSYGROUP':
      Redis raises this error if the group already exists. This is the normal
      case for restarts — we catch and ignore it.
    """
    try:
        await redis_client.xgroup_create(
            STREAM_KEY,
            GROUP_NAME,
            id="0",
            mkstream=True,
        )
        log.info(
            "consumer_group_created",
            stream=STREAM_KEY,
            group=GROUP_NAME,
        )
    except aioredis.ResponseError as exc:
        if "BUSYGROUP" in str(exc):
            log.info(
                "consumer_group_exists",
                stream=STREAM_KEY,
                group=GROUP_NAME,
            )
        else:
            raise


async def _reclaim_pending_messages(redis_client: aioredis.Redis) -> None:
    """
    Reclaim and reprocess messages that were delivered to this consumer in a
    previous run but never acknowledged (because the worker crashed).

    XPENDING_RANGE returns messages in the pending entries list (PEL) for
    this consumer. XCLAIM reassigns them to this consumer with a min-idle-time
    of 0 (reclaim immediately, regardless of how long they've been pending).

    This is the mechanism that makes the consumer group pattern durable:
    no job is lost when a worker crashes mid-processing.
    """
    try:
        pending = await redis_client.xpending_range(
            STREAM_KEY,
            GROUP_NAME,
            min="-",
            max="+",
            count=10,
            consumername=CONSUMER_NAME,
        )
    except aioredis.ResponseError:
        # Stream may not exist yet on the very first startup.
        return

    if not pending:
        return

    log.warning(
        "pending_messages_found",
        count=len(pending),
        consumer=CONSUMER_NAME,
        note="These were in-flight when the worker last stopped. Reclaiming.",
    )

    for entry in pending:
        message_id = entry["message_id"]
        await redis_client.xclaim(
            STREAM_KEY,
            GROUP_NAME,
            CONSUMER_NAME,
            min_idle_time=0,
            message_ids=[message_id],
        )
        log.info("pending_message_reclaimed", message_id=message_id)


# ── Job processing ────────────────────────────────────────────────────────────

async def _publish_event(
    redis_client: aioredis.Redis,
    channel: str,
    event: str,
    data: Any,
) -> None:
    """
    Publish one SSE event to the job's pub/sub channel.

    The channel name is `job:{job_id}`. The SSE endpoint's async generator
    is subscribed to this channel and forwards each published message as an
    SSE event to the HTTP client.

    The payload is a JSON-serialized dict with "event" and "data" keys —
    the same structure that EventSourceResponse expects from its generator.
    """
    payload = json.dumps({"event": event, "data": data})
    await redis_client.publish(channel, payload)


async def _process_job(
    redis_client: aioredis.Redis,
    pool: asyncpg.Pool,
    embed_model: SentenceTransformer,
    message_id: str,
    fields: dict[str, str],
) -> None:
    """
    Run the full RAG pipeline for one job, with semantic cache check.

    Stages:
      1. Embed      — always runs (embedding needed for cache lookup)
      2. Cache hit? — cosine similarity against semantic_cache
          └── HIT:  replay cached answer as token stream, write DONE, return
          └── MISS: continue to stages 3–6
      3. Retrieve   — vector search against enterprise_docs
      4. Prompt     — format RAG prompt with retrieved context
      5. Generate   — stream tokens from Gemini, accumulate full answer
      6. Cache write — write question + answer + embedding to semantic_cache

    The embedding from Stage 1 is reused in both Stage 2 (cache lookup) and
    Stage 6 (cache write). Single computation, two uses.
    """
    job_id = fields["job_id"]
    question = fields["question"]
    top_k = int(fields.get("top_k", str(TOP_K)))
    similarity_threshold = float(fields.get("similarity_threshold", str(SIMILARITY_THRESHOLD)))
    channel = f"job:{job_id}"

    cache_threshold = float(os.getenv("SEMANTIC_CACHE_THRESHOLD", "0.92"))
    cache_top_k = int(os.getenv("SEMANTIC_CACHE_TOP_K", "3"))

    structlog.contextvars.bind_contextvars(
        job_id=job_id,
        question=question[:80],
        message_id=message_id,
    )

    log.info("job_processing_start")
    await redis_client.set(f"job:{job_id}:status", "processing", ex=JOB_TTL)

    t_start = time.perf_counter()
    lock_acquired: bool = False
    # Lock coordinates: SHA-256 of the question text (first 16 hex chars) so
    # the key is deterministic across workers and fits comfortably in Redis.
    question_hash = hashlib.sha256(question.encode()).hexdigest()[:16]
    lock_key = f"lock:cache:{question_hash}"
    lock_value = CONSUMER_NAME  # Unique per worker container.
    lock_ttl_ms = 30_000        # 30s — must exceed worst-case pipeline time.

    try:
        # ── Stage 1: Embed ────────────────────────────────────────────────────
        t0 = time.perf_counter()
        embedding: list[float] = embed_model.encode(
            question,
            normalize_embeddings=True,
        ).tolist()
        embed_ms = (time.perf_counter() - t0) * 1000
        log.info("stage_embed_complete", latency_ms=round(embed_ms, 1))

        # ── Stage 2: Distributed lock + semantic cache lookup ─────────────────
        # Atomic SET NX PX: only one worker can hold the lock per question.
        # Prevents two concurrent workers from both missing the cache and
        # calling the LLM twice for the same question.
        lock_acquired = bool(await redis_client.set(
            lock_key, lock_value, nx=True, px=lock_ttl_ms,
        ))

        if not lock_acquired:
            # Another worker is processing this question right now. Wait briefly,
            # then re-check the cache — it should be populated by then.
            log.info("lock_contended", lock_key=lock_key)
            await asyncio.sleep(0.1)
            t_retry = time.perf_counter()
            async with pool.acquire() as conn:
                cache_result = await retrieve_cached_answer(
                    conn, embedding, threshold=cache_threshold, top_k=cache_top_k,
                )
            cache_lookup_ms = (time.perf_counter() - t_retry) * 1000
            if cache_result is not None:
                cached_question, cached_answer, similarity = cache_result
                log.info("lock_contended_cache_hit", similarity=round(similarity, 4))
                await _publish_event(redis_client, channel, "metadata", json.dumps({
                    "cache_hit": True,
                    "similarity": round(similarity, 4),
                    "cached_question": cached_question,
                    "embed_ms": round(embed_ms, 1),
                    "cache_lookup_ms": round(cache_lookup_ms, 1),
                    "docs_retrieved": None,
                    "documents": [],
                    "retrieve_ms": None,
                }))
                words = cached_answer.split(" ")
                for i, word in enumerate(words):
                    token = word if i == len(words) - 1 else word + " "
                    if token:
                        await _publish_event(redis_client, channel, "token", token)
                total_ms = (time.perf_counter() - t_start) * 1000
                log.info("job_cache_hit_complete", total_ms=round(total_ms, 1))
                await redis_client.set(f"job:{job_id}:status", "done", ex=JOB_TTL)
                await _publish_event(redis_client, channel, "done", "[DONE]")
                return
            # Still a miss after waiting — other worker hit guardrail or errored.
            # Fall through to run the full pipeline without holding the lock.
            log.info("lock_contended_still_miss")

        t_cache = time.perf_counter()
        async with pool.acquire() as conn:
            cache_result = await retrieve_cached_answer(
                conn,
                embedding,
                threshold=cache_threshold,
                top_k=cache_top_k,
            )
        cache_lookup_ms = (time.perf_counter() - t_cache) * 1000
        log.info("stage_cache_lookup_complete", latency_ms=round(cache_lookup_ms, 1))

        if cache_result is not None:
            cached_question, cached_answer, similarity = cache_result

            log.info(
                "cache_hit_serving",
                similarity=round(similarity, 4),
                cached_question_preview=cached_question[:80],
                cache_lookup_ms=round(cache_lookup_ms, 1),
            )

            await _publish_event(
                redis_client,
                channel,
                "metadata",
                json.dumps({
                    "cache_hit": True,
                    "similarity": round(similarity, 4),
                    "cached_question": cached_question,
                    "embed_ms": round(embed_ms, 1),
                    "cache_lookup_ms": round(cache_lookup_ms, 1),
                    "docs_retrieved": None,
                    "documents": [],
                    "retrieve_ms": None,
                }),
            )

            words = cached_answer.split(" ")
            for i, word in enumerate(words):
                token = word if i == len(words) - 1 else word + " "
                if token:
                    await _publish_event(redis_client, channel, "token", token)

            total_ms = (time.perf_counter() - t_start) * 1000
            log.info(
                "job_cache_hit_complete",
                embed_ms=round(embed_ms, 1),
                cache_lookup_ms=round(cache_lookup_ms, 1),
                total_ms=round(total_ms, 1),
            )

            await redis_client.set(f"job:{job_id}:status", "done", ex=JOB_TTL)
            await _publish_event(redis_client, channel, "done", "[DONE]")
            return  # ← Early return. Stages 3–6 do not run.

        # ── Cache miss: continue with full pipeline ───────────────────────────

        log.info(
            "cache_miss",
            cache_lookup_ms=round(cache_lookup_ms, 1),
            threshold=cache_threshold,
        )

        # ── Stage 3: Retrieve ─────────────────────────────────────────────────
        t1 = time.perf_counter()
        async with pool.acquire() as conn:
            results = await retrieve_docs(
                conn, embedding, top_k, similarity_threshold
            )
        retrieve_ms = (time.perf_counter() - t1) * 1000
        log.info(
            "stage_retrieve_complete",
            latency_ms=round(retrieve_ms, 1),
            docs_retrieved=len(results),
        )

        # ── Guardrail ─────────────────────────────────────────────────────────
        if not results:
            log.info("guardrail_triggered", reason="no_docs_above_threshold")
            await _publish_event(
                redis_client,
                channel,
                "guardrail",
                json.dumps({
                    "message": (
                        "I do not have that information in the enterprise "
                        "knowledge base."
                    ),
                    "docs_retrieved": 0,
                    "similarity_threshold": similarity_threshold,
                }),
            )
            await redis_client.set(f"job:{job_id}:status", "done", ex=JOB_TTL)
            # Guardrail responses are NOT written to the cache.
            # Caching "I don't know" would cause future semantically similar
            # questions — which might actually be answerable after the knowledge
            # base is updated — to receive stale "I don't know" answers.
            return

        # ── Stage 4: Build prompt ─────────────────────────────────────────────
        docs_text = "\n\n".join(
            f"[{i}] {content}" for i, (content, _) in enumerate(results, 1)
        )
        messages = RAG_PROMPT.format_messages(context=docs_text, question=question)

        # Publish metadata — cache_hit=False signals a live generation.
        await _publish_event(
            redis_client,
            channel,
            "metadata",
            json.dumps({
                "cache_hit": False,
                "docs_retrieved": len(results),
                "documents": [
                    {"content": content[:200], "similarity": round(score, 4)}
                    for content, score in results
                ],
                "embed_ms": round(embed_ms, 1),
                "cache_lookup_ms": round(cache_lookup_ms, 1),
                "retrieve_ms": round(retrieve_ms, 1),
            }),
        )

        # ── Stage 5: Stream generation ────────────────────────────────────────
        llm = get_llm(streaming=False)
        t2 = time.perf_counter()
        token_count = 0
        answer_tokens: list[str] = []  # Accumulate for cache write.

        async for chunk in llm.astream(messages):
            if chunk.content:
                token_count += 1
                answer_tokens.append(chunk.content)
                await _publish_event(redis_client, channel, "token", chunk.content)

        generation_ms = (time.perf_counter() - t2) * 1000
        total_ms = (time.perf_counter() - t_start) * 1000

        log.info(
            "job_processing_complete",
            embed_ms=round(embed_ms, 1),
            cache_lookup_ms=round(cache_lookup_ms, 1),
            retrieve_ms=round(retrieve_ms, 1),
            generation_ms=round(generation_ms, 1),
            total_ms=round(total_ms, 1),
            tokens_generated=token_count,
        )

        await redis_client.set(f"job:{job_id}:status", "done", ex=JOB_TTL)
        await _publish_event(redis_client, channel, "done", "[DONE]")

        # ── Stage 6: Write to cache ───────────────────────────────────────────
        # Runs AFTER publishing done — the client sees the complete answer
        # before the cache write happens. Cache write latency does not affect
        # the user's perceived response time.
        if answer_tokens:
            full_answer = "".join(answer_tokens)
            try:
                async with pool.acquire() as conn:
                    await write_cache_entry(conn, question, full_answer, embedding)
            except Exception as cache_exc:
                # Cache write failure is non-fatal.
                # The client already received the answer. Log the error and
                # continue — the next request for this question will be a
                # cache miss and run the full pipeline again. Acceptable.
                log.warning(
                    "cache_write_failed",
                    error=str(cache_exc),
                    note="Non-fatal. Next request for this question will be a cache miss.",
                )

    except Exception as exc:
        log.error("job_processing_failed", error=str(exc), exc_info=True)
        await redis_client.set(f"job:{job_id}:status", "error", ex=JOB_TTL)
        await _publish_event(
            redis_client,
            channel,
            "error",
            json.dumps({
                "message": "Worker failed to process this job.",
                "detail": str(exc),
                "job_id": job_id,
            }),
        )

    finally:
        # Release the distributed lock only if we acquired it and still own it.
        if lock_acquired:
            current_holder = await redis_client.get(lock_key)
            if current_holder == lock_value:
                await redis_client.delete(lock_key)
                log.info("lock_released", lock_key=lock_key)
            else:
                log.warning("lock_expired_before_release", lock_key=lock_key)

        await redis_client.xack(STREAM_KEY, GROUP_NAME, message_id)
        log.info("message_acknowledged", message_id=message_id)
        structlog.contextvars.clear_contextvars()

# ── Main polling loop ─────────────────────────────────────────────────────────

async def _run_worker(
    redis_client: aioredis.Redis,
    pool: asyncpg.Pool,
    embed_model: SentenceTransformer,
) -> None:
    """
    Main polling loop. Reads jobs from the Redis Stream and processes them.

    XREADGROUP semantics:
      - GROUP {GROUP_NAME}: read as part of this consumer group.
      - {CONSUMER_NAME}: this specific consumer's identity.
      - COUNT 1: read one message at a time. The worker processes jobs
        sequentially — it does not parallelize within a single process.
        Horizontal scaling (multiple worker processes) handles parallelism.
      - BLOCK {BLOCK_MS}: if no messages are available, block for up to
        BLOCK_MS milliseconds before returning None. This prevents busy-waiting
        (a tight loop hammering Redis with empty reads).
      - STREAMS {STREAM_KEY} '>': the '>' ID means "give me messages not yet
        delivered to any consumer in this group." This is the standard pattern
        for reading new jobs. To re-read pending messages, use '0' instead.

    The loop runs until KeyboardInterrupt (Ctrl-C) or an unhandled exception
    propagates up to the caller.
    """
    log.info(
        "worker_poll_loop_started",
        stream=STREAM_KEY,
        group=GROUP_NAME,
        consumer=CONSUMER_NAME,
    )

    while not _shutdown_requested:
        try:
            # XREADGROUP returns: [(stream_key, [(message_id, fields), ...])]
            # or None if the block timeout expires with no messages.
            response = await redis_client.xreadgroup(
                groupname=GROUP_NAME,
                consumername=CONSUMER_NAME,
                streams={STREAM_KEY: ">"},
                count=1,
                block=BLOCK_MS,
            )

            if not response:
                # Block timeout expired, no new messages. Loop continues.
                # This is the normal idle state — not an error.
                continue

            # response is a list of (stream_key, messages) tuples.
            # With COUNT=1 and one stream, there is exactly one message.
            for _stream_name, stream_messages in response:
                for message_id, fields in stream_messages:
                    if _shutdown_requested:
                        # SIGTERM arrived while we were blocked in XREADGROUP.
                        # Leave the message in the PEL — another worker or the
                        # next restart will reclaim it via _reclaim_pending_messages.
                        log.info(
                            "worker_shutdown_before_job",
                            message_id=message_id,
                            note="Job left in PEL for redelivery.",
                        )
                        return
                    log.info(
                        "message_received",
                        message_id=message_id,
                        job_id=fields.get("job_id", "unknown"),
                    )
                    await _process_job(
                        redis_client=redis_client,
                        pool=pool,
                        embed_model=embed_model,
                        message_id=message_id,
                        fields=fields,
                    )

        except (KeyboardInterrupt, asyncio.CancelledError):
            log.info("worker_poll_loop_stopping")
            break

        except aioredis.RedisError as exc:
            log.error("redis_error_in_poll_loop", error=str(exc))
            await asyncio.sleep(2)

        except asyncpg.PostgresError as exc:
            log.error("db_error_in_poll_loop", error=str(exc))
            await asyncio.sleep(2)

    log.info("worker_poll_loop_exited", shutdown_requested=_shutdown_requested)


async def main() -> None:
    """
    Worker entry point.

    Initialization order:
      1. Redis client — needed for consumer group setup and pending message check
      2. DB pool — needed for vector retrieval during job processing
      3. Embedding model — needed for query embedding during job processing
      4. Consumer group setup — idempotent, safe to run on every startup
      5. Pending message reclaim — re-processes any in-flight jobs from a crash
      6. Poll loop — blocks indefinitely until Ctrl-C

    Shutdown (Ctrl-C / SIGINT on Windows):
      KeyboardInterrupt propagates from the poll loop, which catches and
      re-raises it. The finally block closes pool and Redis client cleanly.
      In-flight _process_job calls complete before the pool is closed because
      the loop exits cleanly only between messages (during the BLOCK wait).
    """
    log.info("worker_starting", consumer=CONSUMER_NAME, group=GROUP_NAME)

    redis_client: aioredis.Redis | None = None
    pool: asyncpg.Pool | None = None

    try:
        redis_client = await _create_redis_client()
        pool = await _create_db_pool()
        embed_model = _load_embed_model()

        await _ensure_consumer_group(redis_client)
        await _reclaim_pending_messages(redis_client)

        log.info("worker_ready")
        await _run_worker(redis_client, pool, embed_model)

    except EnvironmentError as exc:
        log.error("worker_config_error", error=str(exc))
        raise

    finally:
        log.info("worker_teardown_begin")
        if pool is not None:
            await pool.close()
            log.info("worker_db_pool_closed")
        if redis_client is not None:
            await redis_client.aclose()
            log.info("worker_redis_closed")
        log.info("worker_stopped")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        # asyncio.run() propagates KeyboardInterrupt after cancelling all tasks.
        # The finally block in main() has already run at this point.
        pass