// IndexedDB schema for the local knowledge base.
// Each row is one text chunk with its 384-dim embedding.

import { openDB, DBSchema, IDBPDatabase } from "idb";

interface EqnaDB extends DBSchema {
  chunks: {
    key: number;
    value: {
      id?: number;
      text: string;
      embedding: number[];
      source: string;
      page: number;
      chunkIndex: number;
      addedAt: Date;
    };
    indexes: { "by-source": string };
  };
}

let _db: IDBPDatabase<EqnaDB> | null = null;

async function getDb(): Promise<IDBPDatabase<EqnaDB>> {
  if (_db) return _db;
  _db = await openDB<EqnaDB>("enterprise-qna", 1, {
    upgrade(db) {
      const store = db.createObjectStore("chunks", {
        keyPath: "id",
        autoIncrement: true,
      });
      store.createIndex("by-source", "source");
    },
  });
  return _db;
}

export interface Chunk {
  id?: number;
  text: string;
  embedding: number[];
  source: string;
  page: number;
  chunkIndex: number;
  addedAt: Date;
}

export interface SearchResult {
  text: string;
  source: string;
  page: number;
  score: number;
}

// ── dot product (both vectors are L2-normalised → equals cosine sim) ──────────
function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export async function addChunks(chunks: Omit<Chunk, "id">[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("chunks", "readwrite");
  await Promise.all(chunks.map((c) => tx.store.add(c)));
  await tx.done;
}

export async function searchChunks(
  queryEmbedding: number[],
  topK = 3,
): Promise<SearchResult[]> {
  const db = await getDb();
  const all = await db.getAll("chunks");
  if (all.length === 0) return [];
  // No threshold — always return the top-k most similar chunks.
  // The LLM will handle low-relevance context; hard thresholds cause
  // false-empty results when the question phrasing diverges from the doc.
  return all
    .map((c) => ({ text: c.text, source: c.source, page: c.page, score: dot(queryEmbedding, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export interface SourceInfo {
  source: string;
  chunkCount: number;
}

export async function listSources(): Promise<SourceInfo[]> {
  const db = await getDb();
  const all = await db.getAll("chunks");
  const counts: Record<string, number> = {};
  for (const c of all) counts[c.source] = (counts[c.source] ?? 0) + 1;
  return Object.entries(counts)
    .map(([source, chunkCount]) => ({ source, chunkCount }))
    .sort((a, b) => a.source.localeCompare(b.source));
}

export async function deleteSource(source: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("chunks", "readwrite");
  const index = tx.store.index("by-source");
  let cursor = await index.openCursor(IDBKeyRange.only(source));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function totalChunks(): Promise<number> {
  const db = await getDb();
  return db.count("chunks");
}
