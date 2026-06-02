// Lazy singleton wrapper around @huggingface/transformers.
// The model (~25 MB quantized ONNX) is downloaded once and cached by the browser.
// All calls are async; the first call triggers the download.

export type EmbedderStatus = "idle" | "loading" | "ready" | "error";
export type ProgressCb = (pct: number, file: string) => void;

let _pipeline: unknown = null;
let _loadPromise: Promise<unknown> | null = null;
let _status: EmbedderStatus = "idle";

const MODEL = "Xenova/all-MiniLM-L6-v2";
const DIM = 384;

export function getEmbedderStatus(): EmbedderStatus {
  return _status;
}

export async function loadEmbedder(onProgress?: ProgressCb): Promise<void> {
  if (_pipeline) return;
  if (_loadPromise) { await _loadPromise; return; }

  _status = "loading";
  _loadPromise = (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    _pipeline = await pipeline("feature-extraction", MODEL, {
      progress_callback: (p: { status: string; progress?: number; file?: string }) => {
        if (p.status === "progress" && onProgress) {
          onProgress(p.progress ?? 0, p.file ?? "");
        }
      },
    });
    _status = "ready";
  })().catch((err) => {
    _status = "error";
    _loadPromise = null;
    throw err;
  });

  await _loadPromise;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!_pipeline) await loadEmbedder();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipe = _pipeline as any;

  // Embed one text at a time — avoids batch dimension ambiguity in
  // @huggingface/transformers v4 (array input may return array of Tensors
  // rather than a single batched Tensor, breaking the offset math below).
  const results: number[][] = [];
  for (const text of texts) {
    const out = await pipe(text, { pooling: "mean", normalize: true });
    // out is a Tensor; .data is Float32Array, .dims is [1, DIM] or [DIM]
    const raw = out.data as Float32Array;
    // Always take the first DIM floats — safe for both shape variants
    results.push(Array.from(raw.slice(0, DIM)));
  }
  return results;
}
