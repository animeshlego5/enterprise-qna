"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadEmbedder, embedTexts, getEmbedderStatus } from "@/lib/localEmbedder";
import { searchChunks, SearchResult } from "@/lib/localDb";
import { streamLocalLlm } from "@/lib/localLlm";
import type { LocalSettings } from "@/lib/appMode";

type QueryState =
  | { kind: "idle" }
  | { kind: "loading-model"; pct: number }
  | { kind: "embedding" }
  | { kind: "streaming" }
  | { kind: "done" }
  | { kind: "error"; message: string };

export function LocalQueryForm({ settings }: { settings: LocalSettings }) {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<QueryState>({ kind: "idle" });
  const [tokens, setTokens] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const abortRef = useRef(false);

  // Pre-warm the model whenever settings change (provider is still local)
  useEffect(() => {
    if (getEmbedderStatus() === "idle") {
      loadEmbedder((pct) => setState({ kind: "loading-model", pct }))
        .then(() => setState({ kind: "idle" }))
        .catch(() => setState({ kind: "error", message: "Failed to load embedding model." }));
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!question.trim() || state.kind === "streaming" || state.kind === "embedding") return;
    if (!settings.apiKey) {
      setState({ kind: "error", message: "Set your API key in Settings above first." });
      return;
    }

    setTokens([]);
    setResults([]);
    abortRef.current = false;

    try {
      // 1. Ensure model is ready
      if (getEmbedderStatus() !== "ready") {
        setState({ kind: "loading-model", pct: 0 });
        await loadEmbedder((pct) => setState({ kind: "loading-model", pct }));
      }

      // 2. Embed query
      setState({ kind: "embedding" });
      const [queryEmbedding] = await embedTexts([question]);

      // 3. Retrieve from IndexedDB
      const hits = await searchChunks(queryEmbedding);
      setResults(hits);

      if (hits.length === 0) {
        // searchChunks returns [] only when the DB is empty (no threshold filter)
        setState({ kind: "error", message: "Your local knowledge base is empty — upload a PDF first." });
        return;
      }

      // 4. Stream from LLM
      setState({ kind: "streaming" });
      const context = hits.map((h, i) => `[${i + 1}] ${h.text}`).join("\n\n");

      for await (const token of streamLocalLlm(
        settings.provider,
        settings.apiKey,
        settings.model,
        context,
        question
      )) {
        if (abortRef.current) break;
        setTokens(prev => [...prev, token]);
      }

      setState({ kind: "done" });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Unexpected error." });
    }
  }, [question, state.kind, settings]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  const isProcessing = state.kind === "streaming" || state.kind === "embedding" || state.kind === "loading-model";
  const answer = tokens.join("");

  return (
    <div className="w-full max-w-3xl">
      {/* Status bar for model loading */}
      {state.kind === "loading-model" && (
        <div className="mb-3 rounded-lg border border-claude-border bg-claude-surface2 px-4 py-2.5">
          <div className="flex items-center justify-between text-xs text-claude-muted mb-1.5">
            <span>Downloading embedding model (~25 MB, cached after first use)</span>
            <span>{Math.round(state.pct)}%</span>
          </div>
          <div className="h-1 w-full rounded-full bg-claude-border overflow-hidden">
            <div className="h-full rounded-full bg-claude-accent transition-all duration-300" style={{ width: `${state.pct}%` }} />
          </div>
        </div>
      )}

      {/* Input card */}
      <div className="rounded-2xl border border-claude-border bg-claude-surface shadow-sm transition-shadow focus-within:border-claude-border-hi focus-within:shadow-md">
        <div className="relative">
          <textarea
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about your uploaded documents…"
            rows={4}
            disabled={isProcessing}
            className="w-full resize-none rounded-t-2xl bg-transparent px-6 py-5 pr-20 text-base leading-relaxed text-claude-text placeholder-claude-subtle focus:outline-none disabled:opacity-60"
          />
          <button
            onClick={handleSubmit}
            disabled={!question.trim() || isProcessing}
            aria-label="Submit"
            className="absolute bottom-4 right-4 flex h-10 w-10 items-center justify-center rounded-xl bg-claude-accent text-white transition-all hover:bg-claude-accent-dim disabled:cursor-not-allowed disabled:opacity-30 disabled:bg-claude-muted"
          >
            {isProcessing ? (
              <span className="flex gap-1">
                {[0, 150, 300].map(d => (
                  <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-white" style={{ animationDelay: `${d}ms` }} />
                ))}
              </span>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 14V2M2 8l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
        <div className="flex items-center justify-between border-t border-claude-border px-5 py-2.5">
          <span className="text-sm text-claude-subtle">
            <kbd className="rounded bg-claude-surface2 px-1.5 py-0.5 font-mono text-xs text-claude-muted">Enter</kbd> to send &nbsp;·&nbsp;
            <kbd className="rounded bg-claude-surface2 px-1.5 py-0.5 font-mono text-xs text-claude-muted">Shift+Enter</kbd> for newline
          </span>
          <span className="text-xs text-claude-subtle font-mono">
            {state.kind === "embedding" && "Embedding…"}
            {state.kind === "streaming" && "Generating…"}
          </span>
        </div>
      </div>

      {/* Answer */}
      {(answer || state.kind === "streaming") && (
        <div className="mt-6 rounded-xl border border-claude-border bg-claude-surface p-6">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-claude-accent/20 ring-1 ring-claude-accent/30">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-claude-accent">
                <path d="M3 6c0-1.7 1.3-3 3-3s3 1.3 3 3-1.3 3-3 3" strokeLinecap="round" />
                <circle cx="6" cy="6" r="1" fill="currentColor" />
              </svg>
            </div>
            <span className="text-sm font-medium text-claude-muted">Local · {settings.provider} / {settings.model}</span>
          </div>
          <p className="whitespace-pre-wrap leading-relaxed text-claude-text text-base">
            {answer}
            {state.kind === "streaming" && (
              <span className="ml-0.5 inline-block h-4 w-0.5 animate-cursor-blink rounded-sm bg-claude-accent align-middle" />
            )}
          </p>
        </div>
      )}

      {/* Error */}
      {state.kind === "error" && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-base text-red-300">
          <span className="mt-0.5 shrink-0 font-semibold">!</span>
          <span>{state.message}</span>
        </div>
      )}

      {/* Retrieved sources */}
      {results.length > 0 && state.kind !== "error" && (
        <div className="mt-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-claude-subtle">Retrieved context</p>
          {results.map((r, i) => (
            <div key={i} className="rounded-xl border border-claude-border bg-claude-surface p-5 text-base">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-claude-surface2 font-mono text-xs font-semibold text-claude-muted ring-1 ring-claude-border">{i + 1}</span>
                  <span className="text-sm text-claude-subtle truncate max-w-[160px]">{r.source} · p{r.page}</span>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ring-1 ${
                  r.score >= 0.8 ? "text-claude-success bg-claude-success/10 ring-claude-success/20"
                  : r.score >= 0.6 ? "text-amber-300 bg-amber-400/10 ring-amber-400/20"
                  : "text-red-400 bg-red-400/10 ring-red-400/20"
                }`}>
                  {Math.round(r.score * 100)}% match
                </span>
              </div>
              <p className="line-clamp-3 leading-relaxed text-claude-muted">{r.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
