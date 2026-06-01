"use client";

/**
 * Renders the streaming answer and metadata panel.
 *
 * Props:
 *   tokens       — accumulated token strings so far
 *   metadata     — the metadata event payload (null until received)
 *   isStreaming  — true while the SSE stream is open
 *   isComplete   — true after "done" or "guardrail" is received
 *   error        — error message string if an error event was received
 */

import { MetadataEvent } from "@/lib/api";
import { DocumentCard } from "./DocumentCard";

interface AnswerStreamProps {
  tokens: string[];
  metadata: MetadataEvent["data"] | null;
  isStreaming: boolean;
  isComplete: boolean;
  error: string | null;
}

export function AnswerStream({
  tokens,
  metadata,
  isStreaming,
  isComplete,
  error,
}: AnswerStreamProps) {
  const answer = tokens.join("");

  return (
    <div className="mt-6 space-y-4">
      {/* Metadata bar */}
      {metadata && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800/60 px-3 py-2 text-xs text-zinc-400">
          {metadata.cache_hit ? (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-400 font-semibold">
                ⚡ Cache hit
              </span>
              <span>similarity: {metadata.similarity?.toFixed(4)}</span>
              <span className="text-zinc-600">·</span>
              <span>embed {metadata.embed_ms}ms</span>
              <span className="text-zinc-600">·</span>
              <span>lookup {metadata.cache_lookup_ms}ms</span>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-blue-400 font-semibold">
                🔍 Live generation
              </span>
              <span>{metadata.docs_retrieved} docs retrieved</span>
              <span className="text-zinc-600">·</span>
              <span>embed {metadata.embed_ms}ms</span>
              <span className="text-zinc-600">·</span>
              <span>retrieve {metadata.retrieve_ms}ms</span>
            </>
          )}
        </div>
      )}

      {/* Answer text */}
      {(answer || isStreaming) && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
          <p className="whitespace-pre-wrap leading-relaxed text-zinc-100">
            {answer}
            {isStreaming && (
              <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-zinc-400 align-middle" />
            )}
          </p>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/50 p-4 text-sm text-red-300">
          <span className="font-semibold">Error: </span>
          {error}
        </div>
      )}

      {/* Guardrail state (no answer, no error — shown when answer is empty after complete) */}
      {isComplete && !answer && !error && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 text-sm text-zinc-400 italic">
          No relevant information found in the knowledge base for this question.
        </div>
      )}

      {/* Retrieved documents (only shown on cache miss) */}
      {metadata && !metadata.cache_hit && metadata.documents.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Retrieved context
          </p>
          {metadata.documents.map((doc, i) => (
            <DocumentCard
              key={i}
              content={doc.content}
              similarity={doc.similarity}
              index={i + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
