"use client";

import { useState, useRef } from "react";
import { submitQuery, streamAnswer, MetadataEvent } from "@/lib/api";
import { AnswerStream } from "./AnswerStream";

export function QueryForm() {
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

    // Reset state for new query.
    setTokens([]);
    setMetadata(null);
    setIsComplete(false);
    setError(null);
    setJobId(null);
    setIsStreaming(true);
    abortRef.current = false;

    try {
      // Step 1: Submit the job.
      const job = await submitQuery({ question });
      setJobId(job.job_id);

      // Step 2: Open the SSE stream.
      for await (const event of streamAnswer(job.job_id)) {
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
    <div className="w-full max-w-2xl">
      {/* Input area */}
      <div className="relative">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question about the enterprise knowledge base..."
          rows={3}
          disabled={isStreaming}
          className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 pr-24 text-sm text-zinc-100 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={!question.trim() || isStreaming}
          className="absolute bottom-3 right-3 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isStreaming ? "…" : "Ask"}
        </button>
      </div>

      {/* Job ID (dev info) */}
      {jobId && (
        <p className="mt-1 font-mono text-xs text-zinc-600">
          job: {jobId}
        </p>
      )}

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
