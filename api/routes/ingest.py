"""
PDF ingestion endpoints.

POST /api/ingest
    Accepts a PDF file via multipart/form-data.
    Extracts text page-by-page using pypdf, splits into overlapping chunks,
    embeds each chunk with the same all-MiniLM-L6-v2 model used by the worker,
    and batch-inserts the vectors into enterprise_docs.

    The embedding model is lazy-loaded on first upload and cached for the
    lifetime of the API process. This avoids the 90MB/500ms overhead on startup
    while still serving infrequent ingestion requests efficiently.

GET /api/documents
    Returns the distinct PDF filenames and their chunk counts from enterprise_docs,
    filtered to rows that carry a "source" key in the metadata JSONB column.
"""

from __future__ import annotations

import asyncio
import io
import json
import os
from typing import Any

import asyncpg
import structlog
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

from api.dependencies import get_pool

log = structlog.get_logger(__name__)
router = APIRouter()

# ── Module-level model singleton ──────────────────────────────────────────────
# The API process deliberately does not load the model at startup (see main.py).
# For ingestion we load it lazily on the first upload and reuse it thereafter.
# asyncio.Lock prevents concurrent uploads from loading the model twice.

_embed_model: SentenceTransformer | None = None
_model_lock: asyncio.Lock | None = None  # created lazily to avoid import-time issues

MODEL_NAME  = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
CHUNK_SIZE  = int(os.getenv("INGEST_CHUNK_SIZE", "600"))
CHUNK_OVERLAP = int(os.getenv("INGEST_CHUNK_OVERLAP", "100"))
MAX_FILE_MB = int(os.getenv("INGEST_MAX_FILE_MB", "10"))


def _get_lock() -> asyncio.Lock:
    global _model_lock
    if _model_lock is None:
        _model_lock = asyncio.Lock()
    return _model_lock


async def _load_embed_model() -> SentenceTransformer:
    global _embed_model
    if _embed_model is not None:
        return _embed_model
    async with _get_lock():
        if _embed_model is None:
            log.info("ingest_model_loading", model=MODEL_NAME)
            loop = asyncio.get_event_loop()
            _embed_model = await loop.run_in_executor(
                None, lambda: SentenceTransformer(MODEL_NAME)
            )
            log.info("ingest_model_ready", model=MODEL_NAME)
    return _embed_model


# ── Text chunking ─────────────────────────────────────────────────────────────

def _chunk_text(text: str) -> list[str]:
    """
    Split text into overlapping fixed-size chunks, breaking at sentence/newline
    boundaries where possible.
    """
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + CHUNK_SIZE, len(text))
        chunk = text[start:end]
        # If not at the end, prefer breaking at a natural boundary
        if end < len(text):
            search_zone = chunk[len(chunk) // 2:]
            for sep in (". ", "\n\n", "\n", ". "):
                idx = search_zone.rfind(sep)
                if idx != -1:
                    cut = len(chunk) // 2 + idx + len(sep)
                    chunk = chunk[:cut]
                    break
        chunk = chunk.strip()
        if len(chunk) >= 50:
            chunks.append(chunk)
        advance = len(chunk) - CHUNK_OVERLAP
        start += advance if advance > 0 else len(chunk)
    return chunks


def _extract_pages(pdf_bytes: bytes, filename: str) -> list[dict[str, Any]]:
    """Synchronous extraction — called via run_in_executor."""
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(pdf_bytes))
    items: list[dict[str, Any]] = []
    chunk_index = 0

    for page_num, page in enumerate(reader.pages, start=1):
        raw = (page.extract_text() or "").strip()
        if not raw:
            continue
        for chunk in _chunk_text(raw):
            items.append({
                "content": chunk,
                "metadata": {
                    "source": filename,
                    "page": page_num,
                    "chunk_index": chunk_index,
                },
            })
            chunk_index += 1

    return items


# ── Response models ───────────────────────────────────────────────────────────

class IngestResponse(BaseModel):
    filename: str
    pages_read: int
    chunks_stored: int


class DocumentInfo(BaseModel):
    source: str
    chunk_count: int


# ── POST /api/ingest ─────────────────────────────────────────────────────────

@router.post(
    "/ingest",
    response_model=IngestResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a PDF to the knowledge base",
    description=(
        "Accepts a PDF file, extracts its text, splits it into overlapping "
        "chunks, embeds each chunk, and stores the vectors in enterprise_docs. "
        "The uploaded document will immediately be available for retrieval."
    ),
)
async def ingest_pdf(
    file: UploadFile = File(..., description="PDF file to ingest"),
    pool: asyncpg.Pool = Depends(get_pool),
) -> IngestResponse:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only PDF files are accepted.",
        )

    pdf_bytes = await file.read()

    if len(pdf_bytes) > MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File size exceeds the {MAX_FILE_MB} MB limit.",
        )

    filename = file.filename
    log.info("ingest_start", filename=filename, bytes=len(pdf_bytes))

    # Extract + chunk (CPU-bound)
    loop = asyncio.get_event_loop()
    try:
        chunks = await loop.run_in_executor(None, _extract_pages, pdf_bytes, filename)
    except Exception as exc:
        log.error("ingest_extract_failed", filename=filename, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Could not extract text from PDF: {exc}",
        )

    if not chunks:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No extractable text found in the PDF.",
        )

    # Embed (CPU-bound, lazy-load model)
    model = await _load_embed_model()
    texts = [c["content"] for c in chunks]

    embeddings: list[list[float]] = await loop.run_in_executor(
        None,
        lambda: model.encode(texts, normalize_embeddings=True, batch_size=32).tolist(),
    )

    # Batch insert
    pages_seen: set[int] = {c["metadata"]["page"] for c in chunks}
    async with pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO enterprise_docs (content, metadata, embedding)
            VALUES ($1, $2::jsonb, $3::vector)
            """,
            [
                (c["content"], json.dumps(c["metadata"]), embeddings[i])
                for i, c in enumerate(chunks)
            ],
        )

    log.info(
        "ingest_complete",
        filename=filename,
        chunks=len(chunks),
        pages=len(pages_seen),
    )

    return IngestResponse(
        filename=filename,
        pages_read=len(pages_seen),
        chunks_stored=len(chunks),
    )


# ── GET /api/documents ────────────────────────────────────────────────────────

@router.get(
    "/documents",
    response_model=list[DocumentInfo],
    summary="List documents in the knowledge base",
    description="Returns all PDF filenames and their chunk counts from enterprise_docs.",
)
async def list_documents(
    pool: asyncpg.Pool = Depends(get_pool),
) -> list[DocumentInfo]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT metadata->>'source' AS source, COUNT(*) AS chunk_count
            FROM   enterprise_docs
            WHERE  metadata->>'source' IS NOT NULL
            GROUP  BY metadata->>'source'
            ORDER  BY source
            """
        )
    return [DocumentInfo(source=r["source"], chunk_count=r["chunk_count"]) for r in rows]
