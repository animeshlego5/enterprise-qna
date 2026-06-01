"use client";

import { useState, useRef } from "react";
import { submitQuery, streamAnswer, MetadataEvent } from "@/lib/api";
import { AnswerStream } from "./AnswerStream";

export function QueryForm({ token }: { token?: string } = {}) {
  const [question, setQuestion] = useState("");
  const [tokens, setTokens] = useState<string[]>([]);
  const [metadata, setMetadata] = useState<MetadataEvent["data"] | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const abortRef = useRef<boolean>(false);

  const handleSubmit = async () => {
    if (!question.trim() || isStreaming) return;

    setTokens([]);
    setMetadata(null);
    setIsComplete(false);
    setError(null);
    setJobId(null);
    setIsStreaming(true);
    abortRef.current = false;

    try {
      const job = await submitQuery({ question }, token);
      setJobId(job.job_id);

      for await (const event of streamAnswer(job.job_id, token)) {
        if (abortRef.current) break;

        switch (event.event) {
          case "metadata":
            setMetadata(event.data as MetadataEvent["data"]);
            break;
          case "token":
            setTokens((prev) => [...prev, event.data as string]);
            break;
          case "done":
            setIsComplete(true);
            break;
          case "guardrail":
            setIsComplete(true);
            break;
          case "error": {
            const errData = event.data as string;
            let message = errData;
            try {
              message = JSON.parse(errData).message ?? errData;
            } catch {}
            setError(message);
            setIsComplete(true);
            break;
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setIsComplete(true);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="w-full max-w-3xl">
      {/* Input area — Claude-style rounded input card */}
      <div className="rounded-2xl border border-claude-border bg-claude-surface shadow-lg shadow-black/20 transition-shadow focus-within:border-claude-border-hi focus-within:shadow-xl focus-within:shadow-black/30">
        {/* Textarea row — button is scoped inside here so it doesn't overlap the hint bar */}
        <div className="relative">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about the enterprise knowledge base…"
            rows={4}
            disabled={isStreaming}
            className="w-full resize-none rounded-t-2xl bg-transparent px-6 py-5 pr-20 text-base leading-relaxed text-claude-text placeholder-claude-subtle focus:outline-none disabled:opacity-60"
          />

          {/* Submit button — positioned inside the textarea section only */}
          <button
            onClick={handleSubmit}
            disabled={!question.trim() || isStreaming}
            aria-label="Submit question"
            className="absolute bottom-4 right-4 flex h-10 w-10 items-center justify-center rounded-xl bg-claude-accent text-white transition-all hover:bg-claude-accent-dim disabled:cursor-not-allowed disabled:opacity-30 disabled:bg-claude-muted"
          >
            {isStreaming ? (
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white [animation-delay:300ms]" />
              </span>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 14V2M2 8l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>

        {/* Hint bar */}
        <div className="flex items-center justify-between border-t border-claude-border px-5 py-2.5">
          <span className="text-sm text-claude-subtle">
            Press <kbd className="rounded bg-claude-surface2 px-1.5 py-0.5 font-mono text-xs text-claude-muted">Enter</kbd> to send
            &nbsp;·&nbsp;
            <kbd className="rounded bg-claude-surface2 px-1.5 py-0.5 font-mono text-xs text-claude-muted">Shift+Enter</kbd> for newline
          </span>
          {jobId && (
            <span className="font-mono text-xs text-claude-subtle">
              job: {jobId.slice(0, 8)}…
            </span>
          )}
        </div>
      </div>

      {/* Answer + metadata */}
      <AnswerStream
        tokens={tokens}
        metadata={metadata}
        isStreaming={isStreaming}
        isComplete={isComplete}
        error={error}
      />
    </div>
  );
}
