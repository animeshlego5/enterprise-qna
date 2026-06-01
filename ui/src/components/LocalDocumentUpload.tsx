"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { extractPdfPages } from "@/lib/localPdf";
import { chunkText } from "@/lib/localChunker";
import { embedTexts, loadEmbedder } from "@/lib/localEmbedder";
import { addChunks, listSources, deleteSource, SourceInfo } from "@/lib/localDb";
import type { LocalSettings } from "@/lib/appMode";

type UploadState =
  | { kind: "idle" }
  | { kind: "extracting"; filename: string }
  | { kind: "embedding"; filename: string; done: number; total: number }
  | { kind: "success"; filename: string; pages: number; chunks: number }
  | { kind: "error"; message: string };

export function LocalDocumentUpload({ settings }: { settings: LocalSettings }) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setSources(await listSources());
  }, []);

  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  // Pre-warm the embedder when the panel opens
  useEffect(() => {
    if (open) loadEmbedder().catch(() => {});
  }, [open]);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setUploadState({ kind: "error", message: "Only PDF files are supported." });
      return;
    }

    try {
      setUploadState({ kind: "extracting", filename: file.name });
      const pages = await extractPdfPages(file);

      // Chunk all pages
      const allChunks: { text: string; page: number; chunkIndex: number }[] = [];
      let idx = 0;
      for (const { page, text } of pages) {
        for (const chunk of chunkText(text)) {
          allChunks.push({ text: chunk, page, chunkIndex: idx++ });
        }
      }

      if (allChunks.length === 0) {
        setUploadState({ kind: "error", message: "No extractable text found in PDF." });
        return;
      }

      // Embed in batches of 32
      const BATCH = 32;
      const embeddings: number[][] = [];
      for (let i = 0; i < allChunks.length; i += BATCH) {
        setUploadState({
          kind: "embedding",
          filename: file.name,
          done: i,
          total: allChunks.length,
        });
        const batch = allChunks.slice(i, i + BATCH).map(c => c.text);
        const embs = await embedTexts(batch);
        embeddings.push(...embs);
      }

      // Store in IndexedDB
      await addChunks(
        allChunks.map((c, i) => ({
          text: c.text,
          embedding: embeddings[i],
          source: file.name,
          page: c.page,
          chunkIndex: c.chunkIndex,
          addedAt: new Date(),
        }))
      );

      setUploadState({
        kind: "success",
        filename: file.name,
        pages: pages.length,
        chunks: allChunks.length,
      });
      await refresh();
    } catch (err) {
      setUploadState({
        kind: "error",
        message: err instanceof Error ? err.message : "Upload failed.",
      });
    }
  }, [refresh]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const onDelete = async (source: string) => {
    await deleteSource(source);
    await refresh();
  };

  const totalChunks = sources.reduce((s, d) => s + d.chunkCount, 0);
  const isProcessing = uploadState.kind === "extracting" || uploadState.kind === "embedding";

  return (
    <div className="w-full max-w-3xl mb-5">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-claude-border bg-claude-surface px-5 py-3 text-sm transition-colors hover:bg-claude-surface2"
      >
        <div className="flex items-center gap-2.5">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-claude-accent">
            <path d="M4 4h12v12H4z" strokeLinejoin="round" />
            <path d="M7 8h6M7 11h4" strokeLinecap="round" />
          </svg>
          <span className="font-medium text-claude-text">Local Knowledge Base</span>
          {sources.length > 0 && (
            <span className="rounded-full bg-claude-accent/10 px-2 py-0.5 text-xs font-semibold text-claude-accent ring-1 ring-claude-accent/20">
              {sources.length} {sources.length === 1 ? "doc" : "docs"} · {totalChunks} chunks
            </span>
          )}
        </div>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          className={`transition-transform duration-200 text-claude-subtle ${open ? "rotate-180" : ""}`}>
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="mt-1.5 rounded-xl border border-claude-border bg-claude-surface p-5 space-y-4">
          <p className="text-xs text-claude-subtle">
            Documents are stored in your browser — nothing is uploaded to a server.
          </p>

          {/* Source list */}
          {sources.length > 0 && (
            <ul className="divide-y divide-claude-border rounded-lg border border-claude-border overflow-hidden">
              {sources.map(doc => (
                <li key={doc.source} className="flex items-center justify-between bg-claude-surface2 px-4 py-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0 text-claude-accent">
                      <path d="M3 2h7l3 3v9H3z" strokeLinejoin="round" />
                      <path d="M10 2v3h3" strokeLinejoin="round" />
                    </svg>
                    <span className="truncate text-sm text-claude-text">{doc.source}</span>
                  </div>
                  <div className="ml-4 flex items-center gap-3 shrink-0">
                    <span className="text-xs text-claude-subtle font-mono">{doc.chunkCount} chunks</span>
                    <button onClick={() => onDelete(doc.source)}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors">✕</button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Drop zone */}
          <div>
            <input ref={inputRef} type="file" accept=".pdf" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
            <div
              onClick={() => !isProcessing && inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 transition-colors ${
                dragging ? "border-claude-accent bg-claude-accent/5"
                  : isProcessing ? "cursor-wait border-claude-border bg-claude-surface2 opacity-70"
                  : "border-claude-border bg-claude-surface2 hover:border-claude-border-hi"
              }`}
            >
              {uploadState.kind === "extracting" && (
                <>
                  <div className="flex gap-1">
                    {[0, 150, 300].map(d => (
                      <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-claude-accent" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </div>
                  <p className="text-sm text-claude-muted">Extracting text from <span className="font-medium text-claude-text">{uploadState.filename}</span>…</p>
                </>
              )}
              {uploadState.kind === "embedding" && (
                <>
                  <div className="w-full max-w-xs">
                    <div className="mb-1 flex justify-between text-xs text-claude-muted">
                      <span>Embedding chunks</span>
                      <span>{uploadState.done}/{uploadState.total}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-claude-border overflow-hidden">
                      <div
                        className="h-full rounded-full bg-claude-accent transition-all duration-300"
                        style={{ width: `${Math.round((uploadState.done / uploadState.total) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-claude-muted">{uploadState.filename}</p>
                </>
              )}
              {(uploadState.kind === "idle" || uploadState.kind === "success" || uploadState.kind === "error") && (
                <>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-claude-subtle">
                    <path d="M12 16V4M7 9l5-5 5 5" /><path d="M3 17v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
                  </svg>
                  <div className="text-center">
                    <p className="text-sm font-medium text-claude-text">
                      Drop a PDF or <span className="text-claude-accent">click to browse</span>
                    </p>
                    <p className="mt-0.5 text-xs text-claude-subtle">Processed entirely in your browser · Up to 50 MB</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Feedback */}
          {uploadState.kind === "success" && (
            <div className="flex items-start gap-3 rounded-lg border border-claude-success/30 bg-claude-success/8 px-4 py-3 text-sm text-claude-success">
              <span className="mt-0.5 shrink-0">✓</span>
              <span>
                <span className="font-semibold">{uploadState.filename}</span> — {uploadState.pages} pages, {uploadState.chunks} chunks added to local KB.
              </span>
            </div>
          )}
          {uploadState.kind === "error" && (
            <div className="flex items-start gap-3 rounded-lg border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span className="mt-0.5 shrink-0">!</span>
              <span>{uploadState.message}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
