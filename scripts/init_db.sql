-- Enable the pgvector extension.
-- On Neon, this extension is pre-installed — the CREATE EXTENSION statement
-- simply activates it for this database. IF NOT EXISTS makes it idempotent.
CREATE EXTENSION IF NOT EXISTS vector;

-- Stores enterprise knowledge base documents as text + vector embeddings.
CREATE TABLE IF NOT EXISTS enterprise_docs (
    id          SERIAL PRIMARY KEY,
    content     TEXT        NOT NULL,
    metadata    JSONB       DEFAULT '{}',
    embedding   vector(384)
);

-- Stores past query/answer pairs for the Week 4 semantic cache.
-- Created now so Week 4 has no migration to run.
CREATE TABLE IF NOT EXISTS semantic_cache (
    id              SERIAL PRIMARY KEY,
    question        TEXT        NOT NULL,
    answer          TEXT        NOT NULL,
    embedding       vector(384),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    hit_count       INT         DEFAULT 0
);

-- NOTE: No ivfflat index is created here. See the explanation below.
-- For development with a small dataset, PostgreSQL's sequential scan
-- is both faster and more correct than an approximate index.