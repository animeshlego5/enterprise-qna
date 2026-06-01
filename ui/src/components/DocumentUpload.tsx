"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadPdf, listDocuments, DocumentInfo } from "@/lib/api";

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; filename: string }
  | { kind: "success"; filename: string; pages: number; chunks: number }
  | { kind: "error"; message: string };

export function DocumentUpload() {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchDocs = useCallback(async () => {
    try {
      setDocs(await listDocuments());
    } catch {
      // silently ignore — backend may not be running in dev
    }
  }, []);

  useEffect(() => {
    if (open) fetchDocs();
  }, [open, fetchDocs]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        setUploadState({ kind: "error", message: "Only PDF files are supported." });
        return;
      }
      setUploadState({ kind: "uploading", filename: file.name });
      try {
        const result = await uploadPdf(file);
        setUploadState({
          kind: "success",
          filename: result.filename,
          pages: result.pages_read,
          chunks: result.chunks_stored,
        });
        await fetchDocs();
      } catch (err) {
        setUploadState({
          kind: "error",
          message: err instanceof Error ? err.message : "Upload failed.",
        });
      }
    },
    [fetchDocs]
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const totalChunks = docs.reduce((sum, d) => sum + d.chunk_count, 0);

  return (
    <div className="w-full max-w-3xl mb-5">
      {/* Collapsible header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-claude-border bg-claude-surface px-5 py-3 text-sm text-claude-muted transition-colors hover:bg-claude-surface2 hover:text-claude-text"
      >
        <div className="flex items-center gap-2.5">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-claude-accent">
            <path d="M4 4h12v12H4z" strokeLinejoin="round" />
            <path d="M7 8h6M7 11h4" strokeLinecap="round" />
          </svg>
          <span className="font-medium text-claude-text">Knowledge Base</span>
          {docs.length > 0 && (
            <span className="rounded-full bg-claude-accent/10 px-2 py-0.5 text-xs font-semibold text-claude-accent ring-1 ring-claude-accent/20">
              {docs.length} {docs.length === 1 ? "doc" : "docs"} · {totalChunks} chunks
            </span>
          )}
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {/* Expanded panel */}
      {open && (
        <div className="mt-1.5 rounded-xl border border-claude-border bg-claude-surface p-5 space-y-4">
          {/* Document list */}
          {docs.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-widest text-claude-subtle">
                Uploaded documents
              </p>
              <ul className="divide-y divide-claude-border rounded-lg border border-claude-border overflow-hidden">
                {docs.map((doc) => (
                  <li key={doc.source} className="flex items-center justify-between bg-claude-surface2 px-4 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0 text-claude-accent">
                        <path d="M3 2h7l3 3v9H3z" strokeLinejoin="round" />
                        <path d="M10 2v3h3" strokeLinejoin="round" />
                      </svg>
                      <span className="truncate text-sm text-claude-text">{doc.source}</span>
                    </div>
                    <span className="ml-4 shrink-0 text-xs text-claude-subtle font-mono">
                      {doc.chunk_count} chunks
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Upload zone */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-claude-subtle">
              Add a document
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={onInputChange}
            />
            <div
              onClick={() => uploadState.kind !== "uploading" && inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 transition-colors ${
                dragging
                  ? "border-claude-accent bg-claude-accent/5"
                  : uploadState.kind === "uploading"
                  ? "cursor-wait border-claude-border bg-claude-surface2 opacity-70"
                  : "border-claude-border bg-claude-surface2 hover:border-claude-border-hi hover:bg-claude-surface"
              }`}
            >
              {uploadState.kind === "uploading" ? (
                <>
                  <div className="flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-claude-accent [animation-delay:0ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-claude-accent [animation-delay:150ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-claude-accent [animation-delay:300ms]" />
                  </div>
                  <p className="text-sm text-claude-muted">
                    Uploading <span className="font-medium text-claude-text">{uploadState.filename}</span>…
                  </p>
                </>
              ) : (
                <>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-claude-subtle">
                    <path d="M12 16V4M7 9l5-5 5 5" />
                    <path d="M3 17v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
                  </svg>
                  <div className="text-center">
                    <p className="text-sm font-medium text-claude-text">
                      Drop a PDF here or{" "}
                      <span className="text-claude-accent">click to browse</span>
                    </p>
                    <p className="mt-0.5 text-xs text-claude-subtle">Up to 10 MB</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Upload result feedback */}
          {uploadState.kind === "success" && (
            <div className="flex items-start gap-3 rounded-lg border border-claude-success/30 bg-claude-success/8 px-4 py-3 text-sm text-claude-success">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="mt-0.5 shrink-0">
                <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm3.07 5.43-3.5 4a.5.5 0 0 1-.74.02l-1.5-1.5a.5.5 0 0 1 .7-.7l1.12 1.12 3.14-3.6a.5.5 0 0 1 .78.63z" />
              </svg>
              <span>
                <span className="font-semibold">{uploadState.filename}</span> ingested —{" "}
                {uploadState.pages} {uploadState.pages === 1 ? "page" : "pages"},{" "}
                {uploadState.chunks} chunks added to the knowledge base.
              </span>
            </div>
          )}

          {uploadState.kind === "error" && (
            <div className="flex items-start gap-3 rounded-lg border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-700">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="mt-0.5 shrink-0">
                <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-.75 3.75h1.5v4.5h-1.5v-4.5zm.75 6.5a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75z" />
              </svg>
              <span>{uploadState.message}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
