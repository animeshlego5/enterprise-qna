"use client";

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
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-claude-border bg-claude-surface px-5 py-3 text-sm text-claude-muted">
          {metadata.cache_hit ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-claude-success/10 px-2.5 py-1 font-semibold text-claude-success ring-1 ring-claude-success/20">
                <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M6 1a5 5 0 1 0 0 10A5 5 0 0 0 6 1zm2.2 3.7L5.5 8l-1.7-1.7.7-.7 1 1 2-2.3.7.4z" />
                </svg>
                Cache hit
              </span>
              <Dot />
              <span>similarity {metadata.similarity?.toFixed(3)}</span>
              <Dot />
              <Timing label="embed" ms={metadata.embed_ms} />
              <Dot />
              <Timing label="lookup" ms={metadata.cache_lookup_ms} />
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-claude-info/10 px-2.5 py-1 font-semibold text-claude-info ring-1 ring-claude-info/20">
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="6" cy="6" r="5" />
                  <path d="M6 5.5v3M6 4h.01" strokeLinecap="round" />
                </svg>
                Live generation
              </span>
              <Dot />
              <span>{metadata.docs_retrieved} docs retrieved</span>
              <Dot />
              <Timing label="embed" ms={metadata.embed_ms} />
              {metadata.retrieve_ms != null && (
                <>
                  <Dot />
                  <Timing label="retrieve" ms={metadata.retrieve_ms} />
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Answer panel */}
      {(answer || isStreaming) && (
        <div className="rounded-xl border border-claude-border bg-claude-surface p-6">
          {/* Claude-style "Assistant" label */}
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-claude-accent/20 ring-1 ring-claude-accent/30">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-claude-accent">
                <path d="M3 6c0-1.7 1.3-3 3-3s3 1.3 3 3-1.3 3-3 3" strokeLinecap="round" />
                <circle cx="6" cy="6" r="1" fill="currentColor" />
              </svg>
            </div>
            <span className="text-sm font-medium text-claude-muted">Assistant</span>
          </div>

          <p className="whitespace-pre-wrap leading-relaxed text-claude-text text-base">
            {answer}
            {isStreaming && (
              <span className="ml-0.5 inline-block h-4 w-0.5 animate-cursor-blink rounded-sm bg-claude-accent align-middle" />
            )}
          </p>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-base text-red-300 ring-1 ring-red-500/20">
          <span className="font-semibold text-red-200">Error</span>
          <span className="mx-1.5 text-red-400">·</span>
          {error}
        </div>
      )}

      {/* Guardrail / no results */}
      {isComplete && !answer && !error && (
        <div className="rounded-xl border border-claude-border bg-claude-surface/50 p-5 text-base italic text-claude-muted">
          No relevant information found in the knowledge base for this question.
        </div>
      )}

      {/* Retrieved documents */}
      {metadata && !metadata.cache_hit && metadata.documents.length > 0 && (
        <div className="space-y-3 pt-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-claude-subtle">
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

function Dot() {
  return <span className="text-claude-border-hi">·</span>;
}

function Timing({ label, ms }: { label: string; ms: number }) {
  return (
    <span>
      {label}{" "}
      <span className="font-mono text-claude-text">{ms}ms</span>
    </span>
  );
}
