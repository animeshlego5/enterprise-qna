# Enterprise QnA — Full Documentation

> **Author:** Animesh Gosain — [Portfolio](https://animeshlego5.github.io/) · [GitHub](https://github.com/animeshlego5/enterprise-qna)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Project Structure](#4-project-structure)
5. [Database Schema](#5-database-schema)
6. [RAG Pipeline — Cloud Mode](#6-rag-pipeline--cloud-mode)
7. [RAG Pipeline — Local Mode](#7-rag-pipeline--local-mode)
8. [Semantic Cache](#8-semantic-cache)
9. [PDF Ingestion](#9-pdf-ingestion)
10. [API Reference](#10-api-reference)
11. [Frontend & UI System](#11-frontend--ui-system)
12. [Configuration Reference](#12-configuration-reference)
13. [Setup Guide — What You Need to Do](#13-setup-guide--what-you-need-to-do)
14. [Docker Deployment](#14-docker-deployment)
15. [Monetization & Tier Architecture](#15-monetization--tier-architecture)
16. [Roadmap](#16-roadmap)

---

## 1. Project Overview

Enterprise QnA is a **Retrieval-Augmented Generation (RAG)** system that lets users ask natural language questions answered from a private document knowledge base. Both operating modes are fully implemented:

| Mode | Who it's for | Where processing happens | Cost to operator |
|---|---|---|---|
| **Local / Free** | Anyone with their own LLM API key | User's browser | **$0** |
| **Cloud / Paid** | Signed-in users (Clerk) | Server (FastAPI + worker) | Hosting + LLM tokens |

The app automatically selects the mode based on sign-in state. Signed-in users get the cloud backend; everyone else gets the local pipeline. Signed-in users can also override to local mode from the Settings panel.

### Local mode — what it does

1. User uploads a PDF → text is extracted in the browser (pdfjs-dist), chunked, and embedded using `all-MiniLM-L6-v2` running as ONNX directly in the browser (`@huggingface/transformers`).
2. Embeddings and text are stored in the browser's IndexedDB — nothing leaves the device.
3. User asks a question → the question is embedded in the browser, cosine similarity search finds relevant chunks in IndexedDB.
4. The matched chunks are sent as context to the user's own LLM API (OpenAI, Gemini, or Anthropic).
5. The answer streams token-by-token into the UI.

### Cloud mode — what it does

1. User signs in via Clerk (Google, GitHub, or email).
2. User uploads a PDF → it is chunked, embedded, and stored in a pgvector database on the server.
3. User asks a question → the Clerk session token is forwarded with the request; the server validates it.
4. The RAG pipeline runs on the server: embed → semantic cache → vector search → Gemini → stream.
5. The answer streams token-by-token via Server-Sent Events.

---

## 2. Architecture

### 2.1 Local / Free Mode (browser-side RAG)

```
User's Browser — nothing leaves the device
│
├── pdfjs-dist (CDN worker)
│   └── Extract text page by page from PDF
│
├── @huggingface/transformers (ONNX, lazy download ~25 MB)
│   └── Embed chunks + query → 384-dim Float32Array
│
├── IndexedDB (via idb)
│   └── Store {text, embedding, source, page} per chunk
│   └── Brute-force cosine similarity search at query time
│
└── fetch() → User's own LLM API key
    ├── OpenAI  /v1/chat/completions  (stream: true)
    ├── Gemini  /v1beta/models/:model:streamGenerateContent
    └── Anthropic /v1/messages (anthropic-dangerous-direct-browser-access: true)
```

### 2.2 Cloud / Paid Mode (server-side RAG)

```
Browser (Next.js UI)
│
│  Clerk session token → Authorization: Bearer <jwt>
│  POST /api/query          (HTTP 202, requires auth if CLERK_JWKS_URL set)
│  GET  /api/query/:id/stream  (SSE)
│  POST /api/ingest         (multipart upload, requires auth if CLERK_JWKS_URL set)
│  GET  /api/documents
│
▼
FastAPI (api/)
│  ├── verify_backend_access() — validates Clerk RS256 JWT via PyJWT + JWKS
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
                                                             │  2. check sem.cache  │
                                                             │  3. retrieve docs    │
                                                             │  4. build prompt     │
                                                             │  5. stream to Gemini │
                                                             │  6. PUBLISH tokens   │
                                                             │  7. write cache      │
                                                             └──────────┬──────────┘
                                                                        │
                                                              Redis pub/sub  job:{id}
                                                                        │
FastAPI SSE endpoint subscribes ◄───────────────────────────────────────┘
        │
        └── token-by-token → Browser
```

### 2.3 Mode detection in the browser

`AppShell` (client component) checks Clerk's `isSignedIn`:

```
isSignedIn === true AND forceLocal === false
    → cloud mode: DocumentUpload + QueryForm (sends Bearer token)

isSignedIn === false OR forceLocal === true
    → local mode: LocalDocumentUpload + LocalQueryForm (uses API key from settings)
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
| LLM | **Google Gemini 2.5 Flash** | Cloud-mode answer generation |
| LLM framework | **LangChain** | Prompt templates, streaming |
| PDF extraction | **pypdf 6.12** | Server-side text extraction from PDFs |
| Auth | **PyJWT 2.13** | Clerk RS256 JWT verification via JWKS |
| Structured logging | **structlog** | JSON-ready structured logs |
| Metrics | **prometheus_client** | Prometheus exposition |
| Validation | **Pydantic v2** | Request/response schemas |

### Frontend
| Layer | Technology | Purpose |
|---|---|---|
| Framework | **Next.js 16** (App Router, Turbopack) | React SSR/SSG, `/api` proxy rewrites |
| Auth | **@clerk/nextjs 7** | Sign-in/out, session token, `useAuth` hook |
| Styling | **Tailwind CSS v4** | CSS-first `@theme` color tokens |
| Font | **Inter** (Google Fonts) | Claude-style humanist sans-serif |
| Language | **TypeScript** | Type safety across all components |
| Browser embeddings | **@huggingface/transformers 4** | ONNX `all-MiniLM-L6-v2` in browser |
| Browser PDF | **pdfjs-dist 6** | Client-side PDF text extraction |
| Browser vector store | **idb 8** | Typed IndexedDB wrapper for embeddings |

### Infrastructure
| Concern | Tool |
|---|---|
| Containerisation | Docker (`Dockerfile.api`, `Dockerfile.worker`, `Dockerfile.ui`) |
| Orchestration | `docker-compose.yml` (API + 2 workers + UI) |
| Managed Redis | Upstash (serverless Redis, TLS required) |
| Managed Postgres | Neon (serverless Postgres, pgvector built-in) |
| Auth provider | Clerk (free tier sufficient) |

---

## 4. Project Structure

```
enterprise-qna/
│
├── api/                              # FastAPI application
│   ├── main.py                       # App factory, lifespan, CORS, router registration
│   ├── dependencies.py               # DI providers: pool, redis, verify_backend_access
│   ├── models.py                     # Pydantic schemas (request/response)
│   ├── logging_config.py             # structlog setup
│   └── routes/
│       ├── health.py                 # GET /health
│       ├── query.py                  # POST /api/query, GET /api/query/:id/stream
│       ├── ingest.py                 # POST /api/ingest, GET /api/documents
│       └── metrics.py                # GET /metrics (Prometheus)
│
├── pipeline/                         # Pure async RAG pipeline (no FastAPI deps)
│   ├── retrieval.py                  # retrieve_docs(), retrieve_cached_answer()
│   ├── cache.py                      # write_cache_entry(), distributed lock
│   ├── llm.py                        # get_llm() — LangChain Gemini client
│   ├── rag_prompt.py                 # System + human prompt templates
│   └── query.py                      # CLI entrypoint (legacy)
│
├── workers/
│   └── llm_worker.py                 # Async worker: XREADGROUP → RAG → PUBLISH
│
├── scripts/                          # One-off utility scripts
│   ├── init_db.sql                   # CREATE TABLE enterprise_docs, semantic_cache
│   ├── seed_docs.py                  # Seeds 6 sample enterprise documents
│   ├── apply_schema.py               # Runs init_db.sql against Neon
│   ├── check_connection.py           # Verifies DB connectivity
│   ├── check_redis.py                # Verifies Redis connectivity
│   ├── clear_cache.py                # Truncates semantic_cache
│   └── create_index.py               # Creates ivfflat index (for large datasets)
│
├── ui/                               # Next.js frontend
│   └── src/
│       ├── proxy.ts                  # Clerk auth proxy (Next.js 16 convention)
│       ├── app/
│       │   ├── layout.tsx            # Root layout: ClerkProvider, fonts, metadata
│       │   ├── page.tsx              # Home page: AuthNav, header, AppShell, footer
│       │   └── globals.css           # Tailwind v4 @import + @theme tokens
│       ├── components/
│       │   ├── AppShell.tsx          # Mode detection: cloud vs local branch
│       │   ├── AuthNav.tsx           # Clerk sign-in button / UserButton
│       │   ├── ModeSelector.tsx      # Settings panel: provider, API key, model
│       │   ├── QueryForm.tsx         # Cloud: job submit + SSE stream
│       │   ├── AnswerStream.tsx      # Streaming answer + metadata bar
│       │   ├── DocumentCard.tsx      # Retrieved chunk card (cloud mode)
│       │   ├── DocumentUpload.tsx    # Cloud: drag-drop PDF → /api/ingest
│       │   ├── LocalQueryForm.tsx    # Local: embed → IndexedDB → LLM stream
│       │   └── LocalDocumentUpload.tsx # Local: PDF → pdfjs → embedder → IndexedDB
│       └── lib/
│           ├── api.ts                # Typed fetch wrappers for backend endpoints
│           ├── appMode.ts            # LocalSettings type + localStorage I/O
│           ├── localChunker.ts       # Text chunking (mirrors Python backend logic)
│           ├── localDb.ts            # IndexedDB schema, addChunks, searchChunks
│           ├── localEmbedder.ts      # @huggingface/transformers lazy singleton
│           ├── localPdf.ts           # pdfjs-dist page extraction
│           └── localLlm.ts           # OpenAI / Gemini / Anthropic SSE streaming
│
├── Dockerfile.api                    # API container image
├── Dockerfile.worker                 # Worker container image
├── Dockerfile.ui                     # Next.js container image
├── docker-compose.yml                # Multi-service orchestration
├── requirements.txt                  # Python dependencies (pinned)
├── DOCUMENTATION.md                  # This file
└── .env                              # Backend secrets (not committed)
```

---

## 5. Database Schema

```sql
-- pgvector extension (pre-installed on Neon)
CREATE EXTENSION IF NOT EXISTS vector;

-- Cloud knowledge base: documents + vector embeddings
CREATE TABLE enterprise_docs (
    id        SERIAL PRIMARY KEY,
    content   TEXT        NOT NULL,
    metadata  JSONB       DEFAULT '{}',   -- {source, page, chunk_index} for PDFs
    embedding vector(384)                 -- all-MiniLM-L6-v2 output
);

-- Semantic cache: previously answered Q&A pairs
CREATE TABLE semantic_cache (
    id          SERIAL PRIMARY KEY,
    question    TEXT        NOT NULL,
    answer      TEXT        NOT NULL,
    embedding   vector(384),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    hit_count   INT         DEFAULT 0
);
```

**Index note:** No `ivfflat` index by default. Sequential scan is faster for < ~10k rows. Run `scripts/create_index.py` when the table grows beyond that.

---

## 6. RAG Pipeline — Cloud Mode

Every cloud query runs through these stages in `workers/llm_worker.py`:

```
Question (text) + Clerk JWT (validated by API before enqueue)
       │
       ▼
1. Embed query — all-MiniLM-L6-v2 on server GPU/CPU (~20–80ms)
       │
       ▼
2. Semantic cache lookup (pipeline/retrieval.py)
   threshold: 0.92 similarity
   ├── HIT  → stream cached answer (~8ms total), skip steps 3–5
   └── MISS → continue
       │
       ▼
3. Document retrieval — pgvector cosine similarity
   SELECT content, 1-(embedding<=>$1) AS sim FROM enterprise_docs
   ORDER BY embedding<=>$1 LIMIT top_k
   Python filter: similarity > threshold (default 0.20)
   ├── 0 docs → emit "guardrail" event, no LLM call
   └── ≥1 doc → continue
       │
       ▼
4. Prompt construction
   System: "Answer ONLY using provided context."
   Human:  "Context:\n{docs}\n\nQuestion: {question}"
       │
       ▼
5. Gemini 2.5 Flash streaming → PUBLISH tokens → SSE → browser
       │
       ▼
6. Cache write (after stream) — INSERT INTO semantic_cache
   Distributed Redis lock prevents duplicate writes
```

---

## 7. RAG Pipeline — Local Mode

Runs entirely in the browser; no server required beyond the initial page load.

```
Question (text)  +  IndexedDB (populated by LocalDocumentUpload)
       │
       ▼
1. Load embedder (first time only)
   @huggingface/transformers — downloads Xenova/all-MiniLM-L6-v2 ONNX
   ~25 MB download, cached in browser Cache API after first use
   Shows download progress bar in UI
       │
       ▼
2. Embed question → 384-dim Float32Array
       │
       ▼
3. Cosine similarity search over all IndexedDB chunks
   Brute-force dot product (both vectors L2-normalized)
   Threshold: 0.20  |  Top-k: 3
   ├── 0 results → "Upload documents first" error
   └── results → build context string
       │
       ▼
4. Stream from user's LLM API
   Provider selection: OpenAI | Gemini | Anthropic
   API key from ModeSelector settings (localStorage)

   OpenAI:    POST https://api.openai.com/v1/chat/completions
   Gemini:    POST https://generativelanguage.googleapis.com/...?alt=sse
   Anthropic: POST https://api.anthropic.com/v1/messages
              (uses anthropic-dangerous-direct-browser-access: true header)
       │
       ▼
5. Tokens stream directly into LocalQueryForm UI
```

---

## 8. Semantic Cache

Cloud mode only. The cache stores every successfully answered Q&A pair as a vector embedding of the question. Future questions with cosine similarity ≥ 0.92 serve the stored answer without an LLM call.

**Distributed lock** (`pipeline/cache.py`): Redis `SET NX PX 30000` on `lock:cache:{question_hash[:16]}` prevents duplicate writes when multiple workers process the same question simultaneously.

**Cache inspection:** Run `scripts/clear_cache.py` to reset. The `hit_count` column tracks reuse.

---

## 9. PDF Ingestion

### Cloud mode — `POST /api/ingest`

```
multipart/form-data (PDF, max 10 MB)
  → pypdf extracts text page by page
  → _chunk_text(): ~600 chars, 100-char overlap, natural break points
  → all-MiniLM-L6-v2.encode() in ThreadPoolExecutor (non-blocking)
  → asyncpg executemany → INSERT INTO enterprise_docs
  ← {filename, pages_read, chunks_stored}
```

### Local mode — `LocalDocumentUpload`

```
File picker / drag-drop (PDF, client-side, up to ~50 MB practical)
  → pdfjs-dist (CDN worker) extracts text page by page
  → localChunker.chunkText(): same algorithm as server (~600 chars, 100 overlap)
  → @huggingface/transformers: batch embed (32 chunks at a time)
     shows live progress bar: "Embedding 64/200 chunks"
  → idb: addChunks() → INSERT into IndexedDB chunks store
  ← success message with page count and chunk count
```

---

## 10. API Reference

Base URL: `http://localhost:8000` (dev) or via the Next.js proxy at `/api/*`.

**Authentication:** Routes marked `[auth]` require `Authorization: Bearer <clerk_jwt>` when `CLERK_JWKS_URL` is configured in the backend `.env`. If `CLERK_JWKS_URL` is not set, all routes are open (development mode).

---

### `GET /health`
```json
{ "status": "healthy", "database": "connected", "embed_model": "none (worker-only)", "version": "3.0.0" }
```

---

### `POST /api/query` `[auth]`

**Request**
```json
{ "question": "What was Q3 revenue?", "top_k": 3, "similarity_threshold": 0.20 }
```
**Response 202**
```json
{ "job_id": "uuid", "stream_url": "/api/query/uuid/stream", "status": "queued" }
```
Returns **401** if auth is enabled and no/invalid token is provided.

---

### `GET /api/query/{job_id}/stream`

SSE events:

| Event | Data | Notes |
|---|---|---|
| `metadata` | JSON | Retrieval stats (cache hit/miss, timings, docs) |
| `token` | plain string | Repeats per generated token |
| `done` | `"[DONE]"` | Stream complete |
| `guardrail` | JSON | No relevant docs; LLM not called |
| `error` | JSON `{message}` | Pipeline error |

---

### `POST /api/ingest` `[auth]`

`multipart/form-data`, field `file`. Returns **201**:
```json
{ "filename": "report.pdf", "pages_read": 12, "chunks_stored": 47 }
```
Returns **422** (not PDF / no text), **413** (> 10 MB), **401/403** (bad auth).

---

### `GET /api/documents`
```json
[{ "source": "report.pdf", "chunk_count": 47 }]
```
Only shows docs uploaded via `/api/ingest` (not seed data).

---

### `GET /metrics`
Prometheus text exposition. Metrics: `qna_jobs_submitted_total`, `qna_cache_lookups_total{result}`, `qna_sse_connections_total`, `qna_job_duration_seconds`.

---

## 11. Frontend & UI System

### Design system

Claude-inspired light-mode palette defined as Tailwind v4 `@theme` tokens in `ui/src/app/globals.css`:

| Token | Value | Usage |
|---|---|---|
| `--color-claude-bg` | `#faf9f5` | Page background |
| `--color-claude-surface` | `#ffffff` | Cards, input areas |
| `--color-claude-surface2` | `#f5f2ec` | Secondary surfaces |
| `--color-claude-border` | `#e5e0d8` | Default borders |
| `--color-claude-border-hi` | `#d0c9bf` | Focus/hover borders |
| `--color-claude-text` | `#1a1614` | Primary text |
| `--color-claude-muted` | `#6b6360` | Secondary text |
| `--color-claude-subtle` | `#a09890` | Placeholders, hints |
| `--color-claude-accent` | `#da7756` | Buttons, links, icons |
| `--color-claude-accent-dim` | `#c26040` | Accent hover |
| `--color-claude-success` | `#1e8a57` | Success badges |
| `--color-claude-info` | `#2d6fa3` | Info badges |

### Components

| Component | Mode | Description |
|---|---|---|
| `AppShell` | Both | Detects sign-in state, renders cloud or local branch |
| `AuthNav` | Both | Clerk sign-in button (modal) or UserButton |
| `ModeSelector` | Both | Collapsible settings: provider, API key, model, cloud toggle |
| `QueryForm` | Cloud | Job submission, SSE consumption, answer display |
| `AnswerStream` | Cloud | Streaming answer panel with metadata bar |
| `DocumentCard` | Cloud | Retrieved chunk card with similarity score |
| `DocumentUpload` | Cloud | Drag-drop PDF → `/api/ingest` |
| `LocalQueryForm` | Local | Embed → IndexedDB search → LLM stream |
| `LocalDocumentUpload` | Local | PDF → pdfjs → embedder → IndexedDB |

### API client (`ui/src/lib/api.ts`)

All functions accept an optional `token` (Clerk JWT) forwarded as `Authorization: Bearer`:

```typescript
submitQuery(request, token?)   → Promise<JobSubmitResponse>
streamAnswer(jobId, token?)    → AsyncGenerator<SSEEvent>
uploadPdf(file, token?)        → Promise<IngestResponse>
listDocuments(token?)          → Promise<DocumentInfo[]>
```

---

## 12. Configuration Reference

### Backend — `<project-root>/.env`

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTGRES_DSN` | ✅ | — | Neon connection string |
| `REDIS_URL` | ✅ | — | Upstash TLS URL (`rediss://...`) |
| `GOOGLE_API_KEY` | ✅ | — | Google Gemini API key |
| `CLERK_JWKS_URL` | ⭐ | unset | If set, enables JWT auth on backend routes. Format: `https://<your-clerk-domain>/.well-known/jwks.json` |
| `EMBEDDING_MODEL` | | `all-MiniLM-L6-v2` | Sentence-transformers model |
| `TOP_K_RESULTS` | | `3` | Docs retrieved per query |
| `SIMILARITY_THRESHOLD` | | `0.20` | Minimum cosine similarity |
| `CACHE_THRESHOLD` | | `0.92` | Semantic cache hit threshold |
| `REDIS_STREAM_KEY` | | `jobs` | Redis Stream name |
| `REDIS_CONSUMER_GROUP` | | `qna-workers` | Consumer group |
| `REDIS_CONSUMER_NAME` | | `worker-1` | Unique per worker |
| `JOB_TTL_SECONDS` | | `300` | Redis TTL for job keys |
| `STREAM_TIMEOUT_SECONDS` | | `120` | Max SSE wait time |
| `POOL_MIN_SIZE` / `POOL_MAX_SIZE` | | `1` / `5` | asyncpg pool size |
| `INGEST_CHUNK_SIZE` | | `600` | Target chars per PDF chunk |
| `INGEST_CHUNK_OVERLAP` | | `100` | Overlap chars between chunks |
| `INGEST_MAX_FILE_MB` | | `10` | Server-side upload limit |
| `CORS_ORIGINS` | | `http://localhost:3000` | Comma-separated allowed origins |
| `LOG_FORMAT` | | `console` | `console` or `json` |

### Frontend — `ui/.env.local` *(create this file — it is gitignored)*

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | ⭐ for cloud mode | Clerk publishable key (`pk_test_...`) |
| `CLERK_SECRET_KEY` | ⭐ for cloud mode | Clerk secret key (`sk_test_...`) |

Example `ui/.env.local`:
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxx
CLERK_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxx
```

---

## 13. Setup Guide — What You Need to Do

### Local mode (free) — minimal setup

**No server required. No account needed.**

1. Clone the repo and install frontend dependencies:
   ```bash
   cd ui && npm install
   npm run dev
   ```
2. Open `http://localhost:3000`.
3. Click **Settings** → choose your LLM provider (OpenAI, Gemini, or Anthropic) → paste your API key → Save.
4. Open **Local Knowledge Base** → drop in a PDF. Wait for embedding to finish (progress bar shows).
5. Type a question and press Enter. The answer streams directly in your browser.

**That's it.** No `.env` files, no database, no Redis. The embedding model downloads once (~25 MB) and is cached by the browser.

---

### Cloud mode (backend) — full setup

#### Step 1: Clerk

1. Create a free account at [clerk.com](https://clerk.com).
2. Create a new application (choose any name). Enable the sign-in methods you want (Google, GitHub, Email).
3. From the Clerk dashboard, go to **API Keys** and copy:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (starts with `pk_test_`)
   - `CLERK_SECRET_KEY` (starts with `sk_test_`)
4. Find your **JWKS URL**: in the Clerk dashboard go to **API Keys** → scroll down → copy the JWKS URL (format: `https://<your-domain>.clerk.accounts.dev/.well-known/jwks.json`).

#### Step 2: Create `ui/.env.local`

This file does **not** exist in the repo — create it at `ui/.env.local`:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

#### Step 3: Configure the backend `.env`

Add `CLERK_JWKS_URL` to `<project-root>/.env`:

```
CLERK_JWKS_URL=https://<your-domain>.clerk.accounts.dev/.well-known/jwks.json
```

Also make sure these are set (required for the backend to run):

```
POSTGRES_DSN=postgresql://user:pass@host/db?sslmode=require
REDIS_URL=rediss://default:token@host:6380
GOOGLE_API_KEY=AIzaSy...
```

#### Step 4: Set up the database

1. Create a free [Neon](https://neon.tech) Postgres database.
2. Create a free [Upstash](https://upstash.com) Redis database.
3. Apply the schema:
   ```bash
   python -m venv .venv && .venv\Scripts\activate   # Windows
   pip install -r requirements.txt
   python scripts/apply_schema.py
   ```

#### Step 5: Run the backend

```bash
# Terminal 1 — API server
python -m api.main

# Terminal 2 — LLM worker
python -m workers.llm_worker
```

#### Step 6: Run the frontend

```bash
cd ui && npm run dev
# Open http://localhost:3000 — click "Sign in for cloud mode"
```

---

## 14. Docker Deployment

```bash
# Build and start all services (API + 2 workers + UI)
docker-compose up --build

# Add CLERK_JWKS_URL to .env before building for auth to work in Docker
# The UI reads NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY at build time — add it to .env too

# View logs
docker-compose logs -f api
docker-compose logs -f worker-1

# Stop
docker-compose down
```

**Note for Docker + Clerk:** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is embedded at Next.js build time. Add it to `.env` (the docker-compose `env_file`) so the UI container picks it up during `docker-compose up --build`.

---

## 15. Monetization & Tier Architecture

### Current implementation

| | Free / Local | Cloud / Signed-in |
|---|---|---|
| **Processing** | Browser (ONNX + JS) | Server (FastAPI + worker) |
| **Embeddings** | @huggingface/transformers | all-MiniLM-L6-v2 (server) |
| **Vector store** | Browser IndexedDB (per-device) | PostgreSQL pgvector (Neon) |
| **LLM** | User's own API key | Google Gemini (operator's key) |
| **Auth** | None needed | Clerk (any sign-in method) |
| **Cost to operator** | $0 | Hosting + Gemini tokens |
| **Cost to user** | $0 (+ own LLM costs) | Free while Clerk free tier holds |

### How auth gating works

1. Frontend (`AppShell`) calls `useAuth()` from Clerk to check sign-in state.
2. If signed in, calls `getToken()` to get a fresh Clerk session JWT (RS256, short-lived).
3. All `/api/*` backend calls include `Authorization: Bearer <jwt>`.
4. Backend `verify_backend_access()` dependency (`api/dependencies.py`):
   - If `CLERK_JWKS_URL` is not set → open access (dev mode, no auth).
   - If set → fetch Clerk JWKS, verify JWT signature and expiry via `PyJWT.PyJWKClient`.
   - Invalid/expired → HTTP 401/403.
5. Any successfully authenticated Clerk user gets full cloud access.

### Path to real monetization (future)

To charge for cloud access, add a Clerk `publicMetadata.tier` check inside `verify_backend_access()`:

```python
payload = jwt.decode(token, signing_key.key, algorithms=["RS256"])
tier = payload.get("publicMetadata", {}).get("tier", "free")
if tier != "paid":
    raise HTTPException(402, "Upgrade to paid tier to use cloud processing.")
```

Then set `tier: "paid"` in the Clerk dashboard for users who have paid. No Stripe integration is planned — billing is managed manually for now.

---

## 16. Roadmap

### ✅ Phase 1 — Local / Free Tier (DONE)

- [x] Browser PDF extraction via `pdfjs-dist`
- [x] Browser embeddings via `@huggingface/transformers` v4 (ONNX)
- [x] IndexedDB vector store via `idb`
- [x] JS cosine similarity search
- [x] OpenAI, Gemini, Anthropic streaming from browser
- [x] `LocalDocumentUpload` with embedding progress bar
- [x] `LocalQueryForm` with source card display
- [x] `ModeSelector` settings panel

### ✅ Phase 2 — Authentication (DONE, via Clerk)

- [x] Clerk integration (`@clerk/nextjs` v7)
- [x] `proxy.ts` (Next.js 16 auth proxy convention)
- [x] `AuthNav` (sign-in modal + UserButton)
- [x] `AppShell` auto-mode detection
- [x] Backend RS256 JWT verification (`PyJWT` + JWKS)
- [x] Optional gating (`CLERK_JWKS_URL` env var)
- [ ] Tier metadata check in `verify_backend_access()` for real monetization

### Phase 3 — Per-User Knowledge Bases

Each paid user gets their own isolated cloud knowledge base:

```sql
ALTER TABLE enterprise_docs ADD COLUMN user_id TEXT;
-- user_id = Clerk user sub claim from JWT payload
```

Queries filter by `user_id` extracted from the verified JWT. Admin sees all rows.

### Phase 4 — Production Hardening

- ivfflat index auto-creation when `enterprise_docs` > 10k rows
- Rate limiting per Clerk user (Redis token bucket)
- PDF virus scanning before ingestion
- Structured audit log (user, question, timestamp)
- Grafana dashboard wired to `/metrics`
- Multi-region Upstash Redis for global low-latency SSE

---

*Last updated: 2026-06-02*
