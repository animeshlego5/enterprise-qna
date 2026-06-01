# Enterprise QnA — Full Documentation

> **Author:** Animesh Gosain — [Portfolio](https://animeshlego5.github.io/) · [GitHub](https://github.com/animeshlego5/enterprise-qna)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Project Structure](#4-project-structure)
5. [Database Schema](#5-database-schema)
6. [RAG Pipeline](#6-rag-pipeline)
7. [Semantic Cache](#7-semantic-cache)
8. [PDF Ingestion](#8-pdf-ingestion)
9. [API Reference](#9-api-reference)
10. [Frontend & UI System](#10-frontend--ui-system)
11. [Configuration Reference](#11-configuration-reference)
12. [Running Locally](#12-running-locally)
13. [Docker Deployment](#13-docker-deployment)
14. [Monetization & Tier Architecture](#14-monetization--tier-architecture)
15. [Roadmap](#15-roadmap)

---

## 1. Project Overview

Enterprise QnA is a **Retrieval-Augmented Generation (RAG)** system that lets users ask natural language questions answered from a private document knowledge base. It is designed around two operating modes:

| Mode | Who it's for | Where processing happens | Cost to operator |
|---|---|---|---|
| **Local / Free** *(planned)* | Anyone with their own LLM API key | User's browser | $0 |
| **Backend / Paid** *(current)* | Users who want zero setup | Server (FastAPI + worker) | Hosting + LLM tokens |

The current codebase implements the **backend mode** in full. The local mode is the next major milestone (see [§15 Roadmap](#15-roadmap)).

### What it does (backend mode)

1. User uploads a PDF → it is chunked, embedded, and stored in a pgvector database.
2. User asks a question → the question is embedded and the most semantically similar chunks are retrieved.
3. Retrieved chunks are injected into a prompt sent to Google Gemini.
4. The answer streams token-by-token back to the browser via Server-Sent Events.
5. The Q&A pair is cached semantically so identical (or near-identical) future questions are served from cache without an LLM call.

---

## 2. Architecture

### 2.1 Current — Server-Side (Backend Mode)

```
Browser (Next.js UI)
│
│  POST /api/query          (HTTP 202)
│  GET  /api/query/:id/stream  (SSE)
│  POST /api/ingest         (multipart upload)
│  GET  /api/documents
│
▼
FastAPI (api/)
│  ├── validates request
│  ├── generates job_id
│  ├── writes job:{id}:status to Redis
│  └── XADD → Redis Stream "jobs"
│
▼
Redis Streams ──────────────────────────────────────────────────────────┐
                                                                        │ XREADGROUP
                                                              LLM Workers (workers/)
                                                                        │
                                                             ┌──────────▼──────────┐
                                                             │  1. embed question   │
                                                             │  2. check cache      │
                                                             │  3. retrieve docs    │
                                                             │  4. build prompt     │
                                                             │  5. stream to LLM    │
                                                             │  6. PUBLISH tokens   │
                                                             │  7. write cache      │
                                                             └──────────┬──────────┘
                                                                        │
                                                              Redis pub/sub channel
                                                              job:{id}
                                                                        │
FastAPI SSE endpoint subscribes ◄───────────────────────────────────────┘
        │
        └── token-by-token → Browser (EventSource)
```

**Why the async job queue pattern?**
The API process returns in ~8ms. The LLM call takes 2–10s. Decoupling them means:
- The HTTP request/response cycle is instant.
- Multiple workers can run concurrently, scaling horizontally by adding containers.
- If the SSE connection drops, the job continues. The client can reconnect.

### 2.2 Planned — Hybrid (Local + Backend)

```
 ┌─────────────────────────────────────────────────────┐
 │                  User's Browser                     │
 │                                                     │
 │  ┌───────────────────┐   ┌──────────────────────┐  │
 │  │  Has backend token │   │  Has own LLM API key │  │
 │  │  (paid tier)       │   │  (free / local tier)  │  │
 │  └────────┬──────────┘   └──────────┬───────────┘  │
 │           │ fetch /api/*             │               │
 │           │                         ▼               │
 │           │              ┌──────────────────────┐   │
 │           │              │  Transformers.js      │   │
 │           │              │  (ONNX WebWorker)     │   │
 │           │              │  Embed chunks & query │   │
 │           │              └──────────┬───────────┘   │
 │           │                         │               │
 │           │              ┌──────────▼───────────┐   │
 │           │              │  IndexedDB            │   │
 │           │              │  {text, embedding,    │   │
 │           │              │   source, page}       │   │
 │           │              └──────────┬───────────┘   │
 │           │                         │               │
 │           │              ┌──────────▼───────────┐   │
 │           │              │  JS cosine similarity │   │
 │           │              │  top-k retrieval      │   │
 │           │              └──────────┬───────────┘   │
 │           │                         │               │
 │           │              ┌──────────▼───────────┐   │
 │           │              │  fetch(LLM API)       │   │
 │           │              │  OpenAI / Gemini key  │   │
 │           │              └──────────┬───────────┘   │
 │           │                         │               │
 └───────────┼─────────────────────────┼───────────────┘
             │                         │
             ▼                         ▼
     FastAPI backend             Streamed answer
     (paid tier path)            rendered in UI
```

---

## 3. Tech Stack

### Backend
| Layer | Technology | Purpose |
|---|---|---|
| Web framework | **FastAPI 0.136** | Async HTTP, OpenAPI docs, dependency injection |
| ASGI server | **Uvicorn** | Production-grade async server |
| Message queue | **Redis Streams** (Upstash) | Durable job queue, exactly-once delivery |
| Token streaming | **Redis pub/sub** | Ephemeral real-time fan-out to SSE |
| Database | **PostgreSQL** (Neon) | Document storage, semantic cache |
| Vector extension | **pgvector** | Cosine similarity search (`<=>` operator) |
| DB driver | **asyncpg** | Async PostgreSQL driver |
| Embedding model | **all-MiniLM-L6-v2** | 384-dim sentence embeddings (Hugging Face) |
| LLM | **Google Gemini 2.5 Flash** | Answer generation |
| LLM framework | **LangChain** | Prompt templates, streaming |
| PDF extraction | **pypdf 6.12** | Text extraction from uploaded PDFs |
| Structured logging | **structlog** | JSON-ready structured logs |
| Metrics | **prometheus_client** | Prometheus exposition |
| Validation | **Pydantic v2** | Request/response schemas |

### Frontend
| Layer | Technology | Purpose |
|---|---|---|
| Framework | **Next.js 16** (App Router) | React SSR/SSG, `/api` rewrites as backend proxy |
| Styling | **Tailwind CSS v4** | Utility-first, CSS-first `@theme` configuration |
| Font | **Inter** (Google Fonts) | Claude-style humanist sans-serif |
| Language | **TypeScript** | Type safety across all components |

### Infrastructure
| Concern | Tool |
|---|---|
| Containerisation | Docker (separate `Dockerfile.api`, `Dockerfile.worker`, `Dockerfile.ui`) |
| Orchestration | `docker-compose.yml` (API + 2 workers + UI) |
| Managed Redis | Upstash (serverless Redis, TLS required) |
| Managed Postgres | Neon (serverless Postgres, pgvector built-in) |

---

## 4. Project Structure

```
enterprise-qna/
│
├── api/                          # FastAPI application
│   ├── main.py                   # App factory, lifespan, CORS, router registration
│   ├── dependencies.py           # DI providers: pool, redis, embed_model
│   ├── models.py                 # Pydantic schemas (request/response)
│   ├── logging_config.py         # structlog setup (console/JSON toggle)
│   └── routes/
│       ├── health.py             # GET /health — DB liveness check
│       ├── query.py              # POST /api/query, GET /api/query/:id/stream
│       ├── ingest.py             # POST /api/ingest, GET /api/documents
│       └── metrics.py            # GET /metrics — Prometheus exposition
│
├── pipeline/                     # Pure async RAG pipeline (no FastAPI deps)
│   ├── retrieval.py              # retrieve_docs(), retrieve_cached_answer()
│   ├── cache.py                  # write_cache_entry(), distributed lock
│   ├── llm.py                    # get_llm() — LangChain Gemini client
│   ├── rag_prompt.py             # System + human prompt templates
│   └── query.py                  # CLI entrypoint (Week 1/2 legacy)
│
├── workers/
│   └── llm_worker.py             # Async worker: XREADGROUP → RAG → PUBLISH
│
├── scripts/                      # One-off utility scripts
│   ├── init_db.sql               # CREATE TABLE enterprise_docs, semantic_cache
│   ├── seed_docs.py              # Seeds 6 sample enterprise documents
│   ├── apply_schema.py           # Runs init_db.sql against Neon
│   ├── check_connection.py       # Verifies DB connectivity
│   ├── check_redis.py            # Verifies Redis connectivity
│   ├── clear_cache.py            # Truncates semantic_cache table
│   └── create_index.py           # Creates ivfflat index (for large datasets)
│
├── ui/                           # Next.js frontend
│   └── src/
│       ├── app/
│       │   ├── layout.tsx        # Root layout, font loading, metadata
│       │   ├── page.tsx          # Home page: header, DocumentUpload, QueryForm, footer
│       │   └── globals.css       # Tailwind v4 @import + @theme color/font tokens
│       ├── components/
│       │   ├── QueryForm.tsx     # Chat-style input, job submission, SSE consumption
│       │   ├── AnswerStream.tsx  # Streaming answer panel, metadata bar
│       │   ├── DocumentCard.tsx  # Individual retrieved source chunk card
│       │   └── DocumentUpload.tsx # Collapsible KB panel, drag-drop PDF upload
│       └── lib/
│           └── api.ts            # Typed fetch wrappers for all backend endpoints
│
├── Dockerfile.api                # API container image
├── Dockerfile.worker             # Worker container image
├── Dockerfile.ui                 # Next.js container image
├── docker-compose.yml            # Multi-service orchestration
├── requirements.txt              # Python dependencies (pinned)
├── DOCUMENTATION.md              # This file
└── .env                          # Local secrets (not committed)
```

---

## 5. Database Schema

```sql
-- pgvector extension (pre-installed on Neon)
CREATE EXTENSION IF NOT EXISTS vector;

-- Knowledge base documents + their vector embeddings
CREATE TABLE enterprise_docs (
    id        SERIAL PRIMARY KEY,
    content   TEXT        NOT NULL,           -- chunk text
    metadata  JSONB       DEFAULT '{}',        -- {source, page, chunk_index} for PDFs
    embedding vector(384)                     -- all-MiniLM-L6-v2 output
);

-- Semantic cache for previously answered questions
CREATE TABLE semantic_cache (
    id          SERIAL PRIMARY KEY,
    question    TEXT        NOT NULL,
    answer      TEXT        NOT NULL,
    embedding   vector(384),                  -- embedding of the question
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    hit_count   INT         DEFAULT 0         -- incremented on each cache hit
);
```

**Index note:** No `ivfflat` index is created by default. For datasets under ~10,000 rows, PostgreSQL's sequential scan (`ORDER BY embedding <=> $1`) is faster than the approximate index. Run `scripts/create_index.py` when row count exceeds ~10k.

### Metadata format for uploaded PDFs

Rows inserted by `POST /api/ingest` carry structured metadata:
```json
{
  "source": "quarterly_report.pdf",
  "page": 3,
  "chunk_index": 12
}
```

Rows seeded by `scripts/seed_docs.py` have `metadata = {}` (no source field). The `GET /api/documents` endpoint filters to rows where `metadata->>'source' IS NOT NULL`.

---

## 6. RAG Pipeline

Every query goes through these stages inside `workers/llm_worker.py`:

```
Question (text)
       │
       ▼
1. Embed query
   model.encode(question, normalize_embeddings=True)
   → 384-dim float list
       │
       ▼
2. Semantic cache lookup (pipeline/retrieval.py)
   SELECT ... FROM semantic_cache ORDER BY embedding <=> $1 LIMIT 3
   threshold: 0.92 similarity
       │
   ┌───┴───┐
   │ HIT   │ → stream cached answer (8ms total), skip steps 3–5
   │ MISS  │ → continue
   └───┬───┘
       │
       ▼
3. Document retrieval (pipeline/retrieval.py)
   SELECT content, 1-(embedding<=>$1) AS sim
   FROM enterprise_docs ORDER BY embedding<=>$1 LIMIT top_k
   Python-side filter: similarity > threshold (default 0.20)
       │
   ┌───┴───────────┐
   │ 0 docs above  │ → emit "guardrail" SSE event, skip LLM call
   │ threshold     │
   │ ≥1 doc above  │ → continue
   └───┬───────────┘
       │
       ▼
4. Prompt construction (pipeline/rag_prompt.py)
   System: "Answer ONLY using provided context."
   Human:  "Context:\n{docs}\n\nQuestion: {question}"
       │
       ▼
5. LLM generation (Google Gemini 2.5 Flash)
   llm.astream(messages) — async iterator of token chunks
       │
       ▼
6. Token streaming
   Each token → PUBLISH job:{id} → SSE endpoint → browser
       │
       ▼
7. Cache write (pipeline/cache.py)
   After stream ends: INSERT INTO semantic_cache
   Distributed lock prevents duplicate writes under concurrent workers
```

### Guardrail

If no document exceeds the similarity threshold, the LLM is **never called**. The worker emits a `guardrail` SSE event with a "no relevant information found" message. This prevents hallucination on out-of-scope questions.

---

## 7. Semantic Cache

The cache stores every successfully answered Q&A pair as a vector embedding of the question. Future questions with cosine similarity ≥ 0.92 to a cached question are served the stored answer without calling the LLM.

**Why 0.92?** High enough that paraphrases of the same question get a cache hit, but low enough that semantically different questions don't.

**Distributed lock** (in `pipeline/cache.py`): When two workers pick up the same question simultaneously, both will miss the cache and both try to write. A Redis `SET NX PX 30000` lock on `lock:cache:{question_hash[:16]}` ensures only one writes. The other checks the cache again after releasing.

**Cache inspection:** Run `scripts/clear_cache.py` to reset. The `hit_count` column tracks how many times each cached answer has been reused.

---

## 8. PDF Ingestion

Handled by `api/routes/ingest.py`.

### Upload flow

```
POST /api/ingest (multipart/form-data)
       │
       ▼
Validate: file must end in .pdf, max 10 MB
       │
       ▼
pypdf.PdfReader → extract text page by page
       │
       ▼
_chunk_text(): split each page into ~600-char overlapping chunks
  - Prefers breaking at ". " / "\n\n" / "\n" boundaries
  - 100-char overlap between adjacent chunks
  - Minimum chunk size: 50 chars (tiny fragments discarded)
       │
       ▼
all-MiniLM-L6-v2.encode(chunks, normalize_embeddings=True)
  (model lazy-loaded on first upload, cached in-process)
  (runs in ThreadPoolExecutor — non-blocking to event loop)
       │
       ▼
asyncpg executemany → INSERT INTO enterprise_docs
  content   = chunk text
  metadata  = {source: filename, page: N, chunk_index: N}
  embedding = 384-dim vector
       │
       ▼
Return: {filename, pages_read, chunks_stored}
```

**Chunking rationale:** `all-MiniLM-L6-v2` has a 256-token input limit (~300–400 chars). Chunks at 600 chars with 100-char overlap stay safely under the limit while preserving context across chunk boundaries.

---

## 9. API Reference

Base URL: `http://localhost:8000` (dev) or via the Next.js proxy at `/api/*`

### `GET /health`
Checks database connectivity.

**Response 200**
```json
{
  "status": "healthy",
  "database": "connected",
  "embed_model": "none (worker-only)",
  "version": "3.0.0"
}
```

---

### `POST /api/query`
Submits a question for async processing. Returns immediately.

**Request**
```json
{
  "question": "What was Q3 revenue?",
  "top_k": 3,
  "similarity_threshold": 0.20
}
```

| Field | Type | Default | Constraints |
|---|---|---|---|
| `question` | string | required | 3–1000 chars |
| `top_k` | int | `3` | 1–10 |
| `similarity_threshold` | float | `0.20` | 0.0–1.0 |

**Response 202**
```json
{
  "job_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "stream_url": "/api/query/3fa85f64.../stream",
  "status": "queued"
}
```

---

### `GET /api/query/{job_id}/stream`
Opens an SSE stream for the given job. Events are forwarded from Redis pub/sub as the worker generates them.

**SSE Events**

| Event | Data | Description |
|---|---|---|
| `metadata` | JSON object | Sent first; contains retrieval stats |
| `token` | plain string | One generated token; repeats until done |
| `done` | `"[DONE]"` | Stream complete |
| `guardrail` | JSON | No relevant docs found; LLM not called |
| `error` | JSON `{message}` | Pipeline error |

**`metadata` payload (cache miss)**
```json
{
  "cache_hit": false,
  "docs_retrieved": 3,
  "documents": [
    {"content": "...", "similarity": 0.742}
  ],
  "embed_ms": 34,
  "cache_lookup_ms": 12,
  "retrieve_ms": 48
}
```

**`metadata` payload (cache hit)**
```json
{
  "cache_hit": true,
  "similarity": 0.9631,
  "cached_question": "What was Q3 revenue?",
  "docs_retrieved": null,
  "documents": [],
  "embed_ms": 31,
  "cache_lookup_ms": 8,
  "retrieve_ms": null
}
```

Returns **404** if `job_id` does not exist or has expired (TTL: 300s).

---

### `POST /api/ingest`
Uploads a PDF and ingests it into the knowledge base.

**Request:** `multipart/form-data`, field name `file`.

**Constraints:** `.pdf` extension required, max 10 MB.

**Response 201**
```json
{
  "filename": "quarterly_report.pdf",
  "pages_read": 12,
  "chunks_stored": 47
}
```

**Errors:**
- `422` — not a PDF, or no extractable text
- `413` — file exceeds 10 MB limit

---

### `GET /api/documents`
Lists all PDFs in the knowledge base with their chunk counts.

**Response 200**
```json
[
  {"source": "annual_report.pdf", "chunk_count": 83},
  {"source": "product_roadmap.pdf", "chunk_count": 29}
]
```

Only documents ingested via `POST /api/ingest` appear here (seed data is excluded).

---

### `GET /metrics`
Prometheus metrics exposition in text format.

| Metric | Type | Description |
|---|---|---|
| `qna_jobs_submitted_total` | Counter | Total questions submitted |
| `qna_cache_lookups_total{result}` | Counter | `hit` / `miss` / `guardrail` |
| `qna_sse_connections_total` | Counter | Total SSE connections opened |
| `qna_job_duration_seconds` | Histogram | End-to-end job latency |

---

## 10. Frontend & UI System

### Design system

The UI uses **Claude's light-mode visual language** — warm cream backgrounds, terracotta accents, and Inter as the primary typeface.

All colors are defined as Tailwind v4 `@theme` custom properties in `ui/src/app/globals.css`:

| Token | Value | Usage |
|---|---|---|
| `--color-claude-bg` | `#faf9f5` | Page background |
| `--color-claude-surface` | `#ffffff` | Cards, input areas |
| `--color-claude-surface2` | `#f5f2ec` | Secondary surfaces, kbd hints |
| `--color-claude-border` | `#e5e0d8` | Default borders |
| `--color-claude-border-hi` | `#d0c9bf` | Focus/hover borders |
| `--color-claude-text` | `#1a1614` | Primary text |
| `--color-claude-muted` | `#6b6360` | Secondary text |
| `--color-claude-subtle` | `#a09890` | Placeholder, hints |
| `--color-claude-accent` | `#da7756` | Buttons, links, icons (terracotta) |
| `--color-claude-accent-dim` | `#c26040` | Accent hover state |
| `--color-claude-success` | `#1e8a57` | Cache-hit badge, match indicators |
| `--color-claude-info` | `#2d6fa3` | Live-generation badge |

### Components

| Component | File | Description |
|---|---|---|
| `DocumentUpload` | `components/DocumentUpload.tsx` | Collapsible knowledge base panel. Lists uploaded docs, drag-drop PDF upload zone, upload feedback. |
| `QueryForm` | `components/QueryForm.tsx` | Chat-style textarea with submit button, keyboard hints. Drives the full query → stream lifecycle. |
| `AnswerStream` | `components/AnswerStream.tsx` | Renders streaming answer with blinking cursor, metadata bar (cache hit/miss, timing), and retrieved document list. |
| `DocumentCard` | `components/DocumentCard.tsx` | Single retrieved chunk card with source index and similarity score badge. |

### API client

`ui/src/lib/api.ts` exports typed wrappers for all backend endpoints:

```typescript
submitQuery(request: QueryRequest): Promise<JobSubmitResponse>
streamAnswer(jobId: string): AsyncGenerator<SSEEvent>
uploadPdf(file: File): Promise<IngestResponse>
listDocuments(): Promise<DocumentInfo[]>
```

All requests go through Next.js rewrites at `next.config.js` — `/api/*` is proxied to `http://localhost:8000` in dev and `http://api:8000` in Docker.

---

## 11. Configuration Reference

All configuration lives in `.env` (never committed). Copy `.env.example` to `.env`.

### Required

| Variable | Example | Description |
|---|---|---|
| `POSTGRES_DSN` | `postgresql://user:pass@host/db?sslmode=require` | Neon connection string (non-pooled) |
| `REDIS_URL` | `rediss://default:token@host:6380` | Upstash TLS URL |
| `GOOGLE_API_KEY` | `AIzaSy...` | Google Gemini API key |

### Optional (with defaults)

| Variable | Default | Description |
|---|---|---|
| `EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | Sentence-transformers model name |
| `TOP_K_RESULTS` | `3` | Default docs to retrieve per query |
| `SIMILARITY_THRESHOLD` | `0.20` | Default minimum cosine similarity |
| `CACHE_THRESHOLD` | `0.92` | Minimum similarity for a cache hit |
| `REDIS_STREAM_KEY` | `jobs` | Redis Stream name for the job queue |
| `REDIS_CONSUMER_GROUP` | `qna-workers` | Consumer group name |
| `REDIS_CONSUMER_NAME` | `worker-1` | Unique name per worker instance |
| `JOB_TTL_SECONDS` | `300` | Redis TTL for job status keys |
| `STREAM_TIMEOUT_SECONDS` | `120` | Max SSE wait before timeout error |
| `POOL_MIN_SIZE` | `1` | asyncpg pool minimum connections |
| `POOL_MAX_SIZE` | `5` | asyncpg pool maximum connections |
| `INGEST_CHUNK_SIZE` | `600` | Target chars per PDF chunk |
| `INGEST_CHUNK_OVERLAP` | `100` | Overlap chars between chunks |
| `INGEST_MAX_FILE_MB` | `10` | Upload size limit |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `LOG_FORMAT` | `console` | `console` or `json` |
| `LOG_LEVEL` | `info` | Logging verbosity |
| `HOST` | `0.0.0.0` | Uvicorn bind address |
| `PORT` | `8000` | Uvicorn port |

---

## 12. Running Locally

### Prerequisites

- Python 3.12+
- Node.js 20+
- A Neon account (free tier) with `init_db.sql` applied
- An Upstash Redis instance (free tier)
- A Google AI Studio API key (Gemini)

### Backend

```bash
# 1. Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Copy and fill in environment variables
cp .env.example .env
# Edit .env with your Neon DSN, Upstash Redis URL, and Google API key

# 4. Apply database schema
python scripts/apply_schema.py

# 5. (Optional) Seed sample documents
python scripts/seed_docs.py

# 6. Start the API server
python -m api.main

# 7. Start a worker (new terminal)
python -m workers.llm_worker
```

### Frontend

```bash
cd ui
npm install
npm run dev
# Open http://localhost:3000
```

---

## 13. Docker Deployment

```bash
# Build and start all services (API + 2 workers + UI)
docker-compose up --build

# Scale workers (e.g., 4 workers)
docker-compose up --build --scale worker-1=1 --scale worker-2=1
# (Add more worker-N services in docker-compose.yml for true scaling)

# View logs
docker-compose logs -f api
docker-compose logs -f worker-1

# Stop everything
docker-compose down
```

**Service startup order:** Docker health checks ensure the API is healthy before workers start. Workers wait for the API because they share the same Redis consumer group, and the group is created by the first process to run.

**Horizontal worker scaling:** Add additional `worker-N` entries in `docker-compose.yml`, each with a unique `REDIS_CONSUMER_NAME`. Each worker independently reads from the `jobs` stream. Redis consumer groups guarantee each job is processed exactly once regardless of the number of workers.

---

## 14. Monetization & Tier Architecture

### The model

| | Free / Local Tier | Paid / Backend Tier |
|---|---|---|
| **Processing** | Browser (WebWorker) | Server (FastAPI + worker) |
| **Embeddings** | Transformers.js ONNX | all-MiniLM-L6-v2 (server GPU/CPU) |
| **Vector store** | Browser IndexedDB | PostgreSQL pgvector (Neon) |
| **LLM** | User's own API key | Google Gemini (operator's key) |
| **Knowledge base** | Per-device (IndexedDB) | Cloud (shared DB per user) |
| **Account required** | No | Yes |
| **Cost to operator** | $0 | Hosting + LLM tokens |
| **Cost to user** | $0 (+ own LLM costs) | Subscription |

### User identification design

Users are distinguished by a **bearer token** stored in the browser (`localStorage`). The token is issued after successful payment and encodes the user's subscription tier.

**Planned `users` table:**

```sql
CREATE TABLE users (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email                   TEXT        UNIQUE NOT NULL,
    api_token               TEXT        UNIQUE NOT NULL,  -- SHA-256 hashed
    tier                    TEXT        NOT NULL DEFAULT 'free',  -- 'free' | 'paid'
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    subscription_expires_at TIMESTAMPTZ
);
```

**How gating works:**

1. The frontend checks `localStorage` for a backend token on load.
2. If a token exists → send `Authorization: Bearer <token>` on all `/api/*` requests → backend mode.
3. If no token → prompt the user to enter their own LLM API key → local mode.
4. A FastAPI middleware / dependency (`verify_backend_token`) validates the token on protected routes:
   - `POST /api/query` → requires valid paid token
   - `POST /api/ingest` → requires valid paid token (or allow free tier for local uploads)
   - `GET /api/documents` → requires valid token

**Token lifecycle:**
- Issued via a `POST /api/auth/login` or `POST /api/auth/token` endpoint after email verification or OAuth.
- Validated by hashing the incoming token and comparing to the `api_token` column.
- Expired when `subscription_expires_at < NOW()`.

**Payment integration (planned):** Stripe webhooks update the `tier` and `subscription_expires_at` columns when a subscription is activated, renewed, or cancelled.

### Frontend detection logic (planned)

```typescript
// ui/src/lib/mode.ts
export type AppMode = "backend" | "local";

export function detectMode(): AppMode {
  const token = localStorage.getItem("backend_token");
  return token ? "backend" : "local";
}
```

The `QueryForm` and `DocumentUpload` components will branch on this at render time — backend mode talks to `/api/*`, local mode talks to IndexedDB + the user's LLM API.

---

## 15. Roadmap

### Phase 1 — Local / Free Tier (browser-side RAG)

The goal is a zero-backend mode: the entire RAG pipeline runs in the user's browser using their own LLM API key.

**Libraries:**
- [`pdfjs-dist`](https://www.npmjs.com/package/pdfjs-dist) — PDF text extraction in browser
- [`@huggingface/transformers`](https://www.npmjs.com/package/@huggingface/transformers) v3 — `all-MiniLM-L6-v2` as quantized ONNX, runs in a WebWorker
- `idb` — typed IndexedDB wrapper for vector storage
- Direct `fetch()` to OpenAI / Gemini / any OpenAI-compatible API

**Implementation plan:**

1. **`useEmbedder` hook** — lazy-loads the ONNX model in a WebWorker, exposes `embed(texts): Float32Array[]`
2. **`useKnowledgeBase` hook** — CRUD over IndexedDB (`{id, text, embedding, source, page}`), cosine similarity search
3. **`LocalQueryForm`** — same UI as backend form but drives the local pipeline:
   - Embed question → search IndexedDB → build prompt → stream from user's LLM API key
4. **`LocalDocumentUpload`** — same drag-drop UI but processes PDF in the browser with `pdfjs-dist`
5. **Mode selector** in settings panel — user chooses backend (enters subscription token) or local (enters LLM API key)

**Storage budget estimate:**
- 100-page PDF ≈ 400 chunks × 384 dims × 4 bytes ≈ **600 KB** in IndexedDB
- Model download: ~25 MB quantized (cached by browser after first use)
- Brute-force cosine search over 1000 vectors: < 5 ms in JS

**CORS note:** OpenAI and Google Gemini APIs support browser CORS requests. Anthropic's API currently requires a server-side proxy. A minimal `/api/proxy` endpoint (no auth required, just relays) can bridge this for Anthropic users.

### Phase 2 — Authentication & Payments

1. `POST /api/auth/register` — email + password or OAuth (GitHub / Google)
2. `POST /api/auth/login` — returns a signed JWT or opaque token
3. Stripe integration — webhook updates `users.tier` on payment events
4. Backend route middleware — `Depends(require_paid_user)` on gated endpoints
5. Frontend account panel — shows current tier, subscription expiry, manage billing link

### Phase 3 — Per-User Knowledge Bases (backend tier)

Add a `user_id` foreign key to `enterprise_docs`:

```sql
ALTER TABLE enterprise_docs ADD COLUMN user_id UUID REFERENCES users(id);
```

Queries filter by the authenticated user's `user_id` so each paid user has an isolated knowledge base. Admin users can see all rows.

### Phase 4 — Production Hardening

- ivfflat index auto-creation when `enterprise_docs` exceeds 10k rows
- Rate limiting per user (`slowapi` or Redis-based token bucket)
- PDF virus scanning before ingestion (ClamAV or cloud API)
- Structured audit log: which user asked what, when
- Grafana dashboard connected to `/metrics`
- Multi-region Redis (Upstash global) for low-latency SSE anywhere

---

*Last updated: 2026-06-02*
