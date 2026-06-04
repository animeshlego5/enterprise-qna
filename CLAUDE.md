# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Frontend (ui/)
```bash
cd ui
npm run dev      # dev server on :3000 (Turbopack)
npm run build    # production build
npm run lint     # ESLint
```

### Backend API
```bash
# From repo root, with .venv activated
uvicorn api.main:app --reload --port 8000
# or
python -m api.main
```

### Worker
```bash
python -m workers.llm_worker
```

### Docker (full stack)
```bash
docker compose up --build                                    # api + 2 workers
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up  # + Prometheus/Grafana
```

## Required Environment Variables

Create `.env` in the repo root (loaded by `dotenv` at startup):

```
POSTGRES_DSN=          # asyncpg DSN to Neon pgvector instance
REDIS_URL=             # Upstash Redis URL
OPENAI_API_KEY=        # or ANTHROPIC_API_KEY / GOOGLE_API_KEY depending on provider
CORS_ORIGINS=http://localhost:3000
CLERK_JWKS_URL=        # optional — omit for open access in dev
```

Frontend env goes in `ui/.env.local` (Clerk keys follow Next.js/Clerk conventions).

## Architecture

This is a **dual-mode RAG application**:

### Cloud Mode (signed-in users)
```
Browser → POST /api/query → Redis Stream (XADD)
                                  ↓
                          workers/llm_worker.py
                          (embed → pgvector retrieve → LLM generate)
                                  ↓
                          Redis pub/sub PUBLISH per token
                                  ↓
Browser ← SSE GET /api/query/{job_id}/stream ← Redis pub/sub SUBSCRIBE
```

- FastAPI (`api/`) handles HTTP only — no ML work. The embedding model is explicitly `None` on `app.state` after the Week 3 refactor.
- Workers (`workers/llm_worker.py`) own the embedding model and RAG pipeline. Run as separate processes; scale horizontally via `REDIS_CONSUMER_NAME` env var and Redis consumer groups.
- Pipeline logic lives in `pipeline/`: `retrieval.py` (pgvector cosine search), `cache.py` (semantic cache), `llm.py` (multi-provider LLM), `rag_prompt.py`.
- `api/dependencies.py` contains `verify_backend_access()` — the Clerk JWT gate. If `CLERK_JWKS_URL` is unset, auth is disabled (open access).

### Local Mode (no sign-in required)
Entirely browser-side, zero backend:
- `@huggingface/transformers` v4 runs `all-MiniLM-L6-v2` ONNX in-browser (lazy-loaded, download progress bar)
- `pdfjs-dist` v6 extracts PDF text client-side (CDN worker)
- `idb` v8 stores chunks + 384-dim embeddings in IndexedDB
- LLM calls go directly from browser to OpenAI/Gemini/Anthropic APIs using user-supplied keys

### Frontend structure (`ui/src/`)
- `app/layout.tsx` — root layout, Clerk provider, animated background orbs
- `app/page.tsx` — single page: header, `AppShell`, footer
- `components/AppShell.tsx` — mode router: checks Clerk auth state, renders cloud or local path
- `components/DocumentUpload.tsx` / `QueryForm.tsx` — cloud mode (calls `/api/ingest`, `/api/query`)
- `components/LocalDocumentUpload.tsx` / `LocalQueryForm.tsx` — local mode (browser-only)
- `lib/local*.ts` — local mode utilities: `localEmbedder`, `localDb`, `localChunker`, `localPdf`, `localLlm`

## CSS / Styling Notes

- **Tailwind v4** — uses `@import "tailwindcss"` and the `@theme {}` at-rule (not `tailwind.config.js` theme extension). IDE linters will warn about unknown `@theme` — ignore it, it works at runtime.
- Custom color tokens are defined in `globals.css` under `@theme` and consumed as `bg-claude-*`, `text-claude-*`, `border-claude-*` Tailwind utilities.
- The animated background (`globals.css` `.bg-orbs`) uses `mix-blend-mode: multiply` at `z-index: 1` — the orbs are a fixed overlay that blends with the page content.

## Next.js Version Warning

This project uses **Next.js 16.2.6**, which has breaking API and convention changes from earlier versions. Before writing any Next.js-specific code, consult `ui/node_modules/next/dist/docs/` for the current API. The App Router conventions, middleware API, and Clerk integration (`proxy.ts`) follow v16 patterns.
