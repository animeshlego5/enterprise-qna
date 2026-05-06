"""
Week 1 RAG pipeline: Query → Embed → Retrieve → Prompt → Stream.

This is the foundational inference engine. Subsequent weeks build around it:

  Week 2: run_pipeline() becomes a FastAPI request handler. EMBED_MODEL
          becomes a lifespan-managed startup dependency. asyncpg.connect()
          becomes asyncpg.create_pool(). print() becomes structured logging.

  Week 3: Gemini invocation moves into an async LLM worker. FastAPI enqueues
          jobs to Redis Streams. Tokens stream back through Redis pub/sub to
          FastAPI's SSE endpoint.

  Week 4: A semantic cache check is inserted between Stage 1 and Stage 2.
          Queries with a near-match in semantic_cache (cosine > 0.92) return
          in ~8ms without touching Gemini.

  Week 5: Containerized. Prometheus metrics added. Grafana dashboard built.
          The timing numbers you record this week become the "before" numbers
          in your resume bullet point.

RECORD YOUR [Timing] OUTPUT FROM EVERY TEST RUN.
These are your Week 4 baseline. The story on your resume is:
"reduced p95 query latency from Xms (cold pipeline) to ~8ms (semantic cache)"
— you need the X to tell that story.
"""

import asyncio
import asyncpg
import pgvector.asyncpg  # Must be imported to register the vector codec
import os
import time
from sentence_transformers import SentenceTransformer
from langchain_core.prompts import ChatPromptTemplate
from dotenv import load_dotenv

from pipeline.llm import get_llm

load_dotenv()

# ─────────────────────────────────────────────────────────────────────────────
# Module-level singleton — initialized once at process startup
# ─────────────────────────────────────────────────────────────────────────────

# SentenceTransformer takes ~500ms to initialize on first call (loads the model
# from disk into memory). Initialized once at module import time, subsequent
# queries pay only the inference cost (~20–80ms on CPU).
# Instantiating inside run_pipeline() would pay the 500ms penalty on every
# query — the same mistake that kills performance in production inference servers.
EMBED_MODEL = SentenceTransformer(os.getenv("EMBED_MODEL", "all-MiniLM-L6-v2"))

# ─────────────────────────────────────────────────────────────────────────────
# RAG Prompt Template
# ─────────────────────────────────────────────────────────────────────────────

# ChatPromptTemplate is the correct LangChain API for chat models.
# Chat models (Gemini 2.5 Flash, Claude, GPT-4) expect structured message lists,
# not raw strings. ChatPromptTemplate formats your prompt as a
# [SystemMessage, HumanMessage] pair — the native input format.
#
# Using PromptTemplate (raw-string variant) with a chat model works, but it
# bypasses the system message mechanism. The model receives the system prompt
# as part of the human turn, which degrades guardrail behavior — the model is
# less reliably constrained to the provided context.
#
# The system message is your core safety contract.
# "ONLY the provided context" + "do not use training data" are the two sentences
# that make this an enterprise tool rather than a hallucination machine.
# These WILL be tested explicitly in exit validation. If the hallucination test
# fails, your primary safety guarantee has failed.
RAG_PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        (
            "You are a precise enterprise AI assistant. "
            "Answer the user's question using ONLY the information in the context below. "
            "If the context does not contain enough information to fully answer the question, "
            "respond with exactly: "
            "'I do not have that information in the enterprise knowledge base.' "
            "Do not infer, extrapolate, guess, or draw on your training data. "
            "Your answer must be fully traceable to the provided context."
        ),
    ),
    (
        "human",
        "Context:\n{context}\n\nQuestion: {question}",
    ),
])


# ─────────────────────────────────────────────────────────────────────────────
# Vector retrieval
# ─────────────────────────────────────────────────────────────────────────────

async def retrieve_docs(
    conn: asyncpg.Connection,
    query_embedding: list[float],
    top_k: int,
    similarity_threshold: float,
) -> list[tuple[str, float]]:
    """
    Cosine similarity search against the enterprise_docs table on Neon.

    How the math works:
        <=> computes cosine DISTANCE: distance = 1 - cosine_similarity.
        ORDER BY distance ASC → most similar documents first (lowest distance).
        similarity = 1 - distance is computed for the threshold filter and logging.
        similarity of 1.0 = identical. 0.0 = no semantic overlap.

    The similarity_threshold filter is the mechanism that enforces the hallucination
    guardrail at the retrieval level: if no documents score above the threshold,
    the pipeline aborts before calling the LLM. The system cannot fabricate an
    answer from an empty context.

    Args:
        conn: Active asyncpg connection to Neon.
        query_embedding: Normalized 384-dim float vector of the user's query.
                         Must use the same model and normalize_embeddings=True
                         as was used in seed_docs.py — mixing models produces
                         incomparable vectors and meaningless similarity scores.
        top_k: Maximum documents to return.
        similarity_threshold: Minimum cosine similarity to include a document.

    Returns:
        List of (content, similarity_score) tuples, ordered by similarity descending.
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

    return [
        (row["content"], float(row["similarity"]))
        for row in rows
        if row["similarity"] > similarity_threshold
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Main pipeline
# ─────────────────────────────────────────────────────────────────────────────

async def run_pipeline(question: str) -> None:
    """
    Execute the complete RAG pipeline for a single user query.

    Prints per-stage timing for every run. Record these numbers —
    they are your Week 4 baseline.
    """
    t_pipeline_start = time.perf_counter()

    # ── Stage 1: Embed the query ───────────────────────────────────────────
    # Convert the raw question into a 384-dim float vector capturing its
    # semantic meaning. normalize_embeddings=True places the vector on the
    # unit hypersphere (L2 norm = 1.0), required for correct cosine similarity.
    t0 = time.perf_counter()
    embedding: list[float] = EMBED_MODEL.encode(
        question,
        normalize_embeddings=True,
    ).tolist()
    t_embed = time.perf_counter()
    print(f"[Timing] Stage 1 — Embedding:    {(t_embed - t0) * 1000:.1f}ms")

    # ── Stage 2: Vector retrieval from Neon ───────────────────────────────
    # asyncpg reads ?sslmode=require from the DSN automatically.
    # No ssl= keyword argument needed — the parameter in the URL handles it.
    #
    # Note on Neon cold starts: if the Neon compute has been idle for >5 minutes,
    # this connect() call may take 1–3 seconds longer than normal while the
    # compute instance wakes up. This is normal on the free tier. Run a warmup
    # query before recording your timing baseline. See exit validation below.
    similarity_threshold = float(os.getenv("SIMILARITY_THRESHOLD", "0.20"))
    top_k = int(os.getenv("TOP_K_RESULTS", "3"))

    try:
        conn = await asyncpg.connect(os.getenv("POSTGRES_DSN"))
        # Register the pgvector codec — same requirement as in seed_docs.py.
        # Without this, asyncpg cannot deserialize the vector column values
        # returned by the similarity query.
        await pgvector.asyncpg.register_vector(conn)
        results = await retrieve_docs(conn, embedding, top_k, similarity_threshold)
    except asyncpg.PostgresConnectionFailureError as e:
        print(f"\n[Error] Could not connect to Neon: {e}")
        print("Check that POSTGRES_DSN in .env is the direct (non-pooled) connection string.")
        return
    except asyncpg.PostgresError as e:
        print(f"\n[Error] Database query failed: {e}")
        return
    finally:
        await conn.close()

    t_retrieve = time.perf_counter()
    print(
        f"[Timing] Stage 2 — Retrieval:    {(t_retrieve - t_embed) * 1000:.1f}ms"
        f"  ({len(results)} docs above threshold)"
    )

    if not results:
        print(
            "\n[Guardrail] No documents met the similarity threshold. "
            "The LLM will not be called. The system will not fabricate an answer.\n"
            "This is correct behavior for off-topic queries.\n"
            "If this query should match, lower SIMILARITY_THRESHOLD in .env."
        )
        return

    # Log retrieved documents and similarity scores.
    # This output is critical for debugging unexpected or missing retrieval results.
    print(f"\n[Retrieved documents]")
    for i, (content, score) in enumerate(results, 1):
        print(f"  [{i}] similarity={score:.3f}  {content[:80]}...")

    # ── Stage 3: Prompt construction ──────────────────────────────────────
    # Assemble retrieved documents into a numbered context block.
    # Numbered format makes it easy to trace which document produced which
    # part of the answer. Week 4 will log document IDs here for cache analysis.
    docs_text = "\n\n".join(
        f"[{i}] {content}" for i, (content, _) in enumerate(results, 1)
    )
    messages = RAG_PROMPT.format_messages(context=docs_text, question=question)

    # ── Stage 4: Streamed LLM generation ──────────────────────────────────
    # StreamingStdOutCallbackHandler (attached inside get_llm()) intercepts
    # each generated token and writes it to stdout as it arrives.
    #
    # In Week 2 this is replaced by:
    #   async for chunk in llm.astream(messages):
    #       await sse_queue.put(chunk.content)
    # The astream() iterator interface is compatible with FastAPI's async
    # generator pattern for Server-Sent Events.
    print(f"\n{'═' * 64}")
    print(f"Model:    {os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')}")
    print(f"Question: {question}")
    print(f"{'═' * 64}")
    print("Answer: ", end="", flush=True)

    t_llm_start = time.perf_counter()
    llm = get_llm(streaming=True)
    llm.invoke(messages)
    t_llm_end = time.perf_counter()

    t_pipeline_end = time.perf_counter()
    print(f"\n\n{'─' * 64}")
    print(f"[Timing] Stage 4 — LLM generation:  {(t_llm_end - t_llm_start) * 1000:.0f}ms")
    print(f"[Timing] Total pipeline:             {(t_pipeline_end - t_pipeline_start) * 1000:.0f}ms")
    print(f"{'─' * 64}\n")


if __name__ == "__main__":
    import sys
    question = " ".join(sys.argv[1:]) or "What is our employee learning budget?"
    asyncio.run(run_pipeline(question))