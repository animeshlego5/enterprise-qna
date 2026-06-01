/**
 * API client for the Enterprise QnA backend.
 *
 * Two functions:
 *   submitQuery()  — POST /api/query → returns job_id
 *   streamAnswer() — GET /api/query/{job_id}/stream → async iterator of SSE events
 *
 * streamAnswer() uses fetch() + ReadableStream rather than the native EventSource
 * API. This allows future addition of Authorization headers, works with the
 * Next.js proxy rewrites, and gives us typed event objects rather than raw
 * MessageEvent strings.
 */

export interface QueryRequest {
  question: string;
  top_k?: number;
  similarity_threshold?: number;
}

export interface JobSubmitResponse {
  job_id: string;
  stream_url: string;
  status: string;
}

export interface MetadataEvent {
  event: "metadata";
  data: {
    cache_hit: boolean;
    similarity?: number;
    cached_question?: string;
    docs_retrieved: number | null;
    documents: Array<{ content: string; similarity: number }>;
    embed_ms: number;
    cache_lookup_ms: number;
    retrieve_ms: number | null;
  };
}

export interface TokenEvent {
  event: "token";
  data: string;
}

export interface DoneEvent {
  event: "done";
  data: string;
}

export interface ErrorEvent {
  event: "error";
  data: string;
}

export interface GuardrailEvent {
  event: "guardrail";
  data: string;
}

export type SSEEvent =
  | MetadataEvent
  | TokenEvent
  | DoneEvent
  | ErrorEvent
  | GuardrailEvent;

const API_BASE = "";  // Empty string: all requests go through Next.js rewrites.

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Ingest / document management ─────────────────────────────────────────────

export interface IngestResponse {
  filename: string;
  pages_read: number;
  chunks_stored: number;
}

export interface DocumentInfo {
  source: string;
  chunk_count: number;
}

export async function uploadPdf(file: File, token?: string): Promise<IngestResponse> {
  const body = new FormData();
  body.append("file", file);

  const response = await fetch(`${API_BASE}/api/ingest`, {
    method: "POST",
    headers: authHeaders(token),
    body,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail ?? `Upload failed: HTTP ${response.status}`);
  }

  return response.json();
}

export async function listDocuments(token?: string): Promise<DocumentInfo[]> {
  const response = await fetch(`${API_BASE}/api/documents`, {
    headers: authHeaders(token),
  });
  if (!response.ok) throw new Error(`Failed to load documents: HTTP ${response.status}`);
  return response.json();
}

export async function submitQuery(
  request: QueryRequest,
  token?: string,
): Promise<JobSubmitResponse> {
  const response = await fetch(`${API_BASE}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.detail ?? `Job submission failed: HTTP ${response.status}`
    );
  }

  return response.json();
}

/**
 * Async generator that streams SSE events for a given job_id.
 *
 * Parses the raw SSE text format (lines starting with "event:" and "data:")
 * into typed SSEEvent objects. Yields events until "done", "error", or
 * "guardrail" is received, then returns.
 *
 * Usage:
 *   for await (const event of streamAnswer(jobId)) {
 *     if (event.event === "token") appendToken(event.data);
 *   }
 */
export async function* streamAnswer(jobId: string, token?: string): AsyncGenerator<SSEEvent> {
  const response = await fetch(`${API_BASE}/api/query/${jobId}/stream`, {
    headers: { Accept: "text/event-stream", ...authHeaders(token) },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.detail ?? `Stream connection failed: HTTP ${response.status}`
    );
  }

  if (!response.body) {
    throw new Error("Response body is null — SSE stream unavailable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // SSE format:
  //   event: token\n
  //   data: Based\n
  //   \n
  // Each "message" is separated by a blank line.
  // We accumulate lines in `buffer` and parse on blank lines.

  let currentEvent = "";
  let currentData = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";  // Last element may be incomplete — keep in buffer.

    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        currentData = line.slice(5).trim();
      } else if (line === "" && currentEvent && currentData) {
        // Blank line = end of one SSE message. Parse and yield.
        let parsedData: unknown = currentData;
        try {
          parsedData = JSON.parse(currentData);
        } catch {
          // Not JSON (e.g., token events are plain strings). Keep as string.
        }

        const sseEvent = {
          event: currentEvent,
          data: parsedData,
        } as SSEEvent;

        yield sseEvent;

        if (["done", "error", "guardrail"].includes(currentEvent)) {
          reader.cancel();
          return;
        }

        currentEvent = "";
        currentData = "";
      }
    }
  }
}
