"""
Pydantic v2 request and response schemas for the Enterprise QnA API.

Every field has an explicit type, description, and constraint where applicable.
FastAPI uses these schemas to:
  1. Validate and coerce incoming JSON request bodies.
  2. Generate the OpenAPI specification (accessible at /docs).
  3. Provide editor autocompletion in route handlers via type hints.

Pydantic v2 validation is strict by default — a string passed where a float
is expected will raise a validation error rather than silently coercing.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator, ConfigDict


class QueryRequest(BaseModel):
    """Request body for POST /api/query."""

    model_config = ConfigDict(
        # Reject any extra fields not declared here.
        # Prevents clients from injecting undeclared fields that could
        # interfere with downstream processing or logging.
        extra="forbid",
        # Populate schema examples in /docs.
        json_schema_extra={
            "example": {
                "question": "What was our Q3 revenue?",
                "top_k": 3,
                "similarity_threshold": 0.20,
            }
        },
    )

    question: str = Field(
        ...,
        min_length=3,
        max_length=1000,
        description=(
            "The user's natural language question. "
            "Max 1000 characters to prevent prompt injection via oversized inputs. "
            "The embedding model (all-MiniLM-L6-v2) silently truncates inputs "
            "beyond 256 tokens — the 1000-character cap is a conservative proxy "
            "for that boundary."
        ),
    )

    top_k: int = Field(
        default=3,
        ge=1,
        le=10,
        description=(
            "Maximum number of documents to retrieve. Overrides TOP_K_RESULTS "
            "from .env for this specific request. Bounded at 10 to prevent "
            "context window exhaustion in the LLM prompt."
        ),
    )

    similarity_threshold: float = Field(
        default=0.20,
        ge=0.0,
        le=1.0,
        description=(
            "Minimum cosine similarity for a retrieved document to qualify as "
            "context. Overrides SIMILARITY_THRESHOLD from .env for this request. "
            "Raise to filter out loosely related documents. "
            "Lower if relevant queries return zero results."
        ),
    )

    @field_validator("question")
    @classmethod
    def strip_and_validate_question(cls, v: str) -> str:
        """Strip leading/trailing whitespace and reject blank-after-strip inputs."""
        stripped = v.strip()
        if not stripped:
            raise ValueError("Question must contain non-whitespace characters.")
        return stripped


class RetrievedDocument(BaseModel):
    """A single document returned from pgvector similarity search."""

    content: str = Field(..., description="The document text.")
    similarity: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Cosine similarity score (0.0 = no overlap, 1.0 = identical).",
    )


class HealthResponse(BaseModel):
    """Response body for GET /health."""

    status: str = Field(..., description="'healthy' or 'degraded'.")
    database: str = Field(..., description="'connected' or error message.")
    embed_model: str = Field(..., description="Name of the loaded embedding model.")
    version: str = Field(..., description="API version string.")


class SSEEvent(BaseModel):
    """
    Envelope for all SSE data payloads.

    Every token, metadata event, and error is wrapped in this structure.
    The `event` field maps to SSE's `event:` line, allowing clients to
    dispatch on event type using addEventListener() rather than parsing
    the data field first.

    SSE Event Types used in this API:
        "token"    — a single generated text token
        "metadata" — retrieval stats sent before generation begins
        "done"     — signals the stream is complete (data: "[DONE]")
        "error"    — pipeline error with message (stream ends after this)
        "guardrail"— no documents retrieved; LLM was not called
    """

    event: str = Field(
        ...,
        description="SSE event type discriminator.",
    )
    data: str = Field(
        ...,
        description="Event payload. JSON string for 'metadata', raw text for 'token'.",
    )

# ── Week 3 changes ─────────────────────────


class JobSubmitResponse(BaseModel):
    """
    Response body for POST /api/query (Week 3+).

    The endpoint no longer returns an SSE stream directly. It returns this
    JSON object immediately, allowing the client to open the SSE connection
    on a separate request — decoupling job submission from result streaming.
    """

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "job_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                "stream_url": "/api/query/3fa85f64-5717-4562-b3fc-2c963f66afa6/stream",
                "status": "queued",
            }
        }
    )

    job_id: str = Field(..., description="UUID identifying this job. Use to open the SSE stream.")
    stream_url: str = Field(
        ...,
        description="Relative URL of the SSE stream endpoint for this job.",
    )
    status: str = Field(
        default="queued",
        description="Initial job status. Always 'queued' on submission.",
    )


class JobStatus:
    """Job status values stored in Redis as job:{job_id}:status."""

    QUEUED = "queued"
    PROCESSING = "processing"
    DONE = "done"
    ERROR = "error"