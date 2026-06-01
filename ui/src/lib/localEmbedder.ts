// Lazy singleton wrapper around @huggingface/transformers.
// The model (~25 MB quantized ONNX) is downloaded once and cached by the browser.
// All calls are async; the first call triggers the download.

export type EmbedderStatus = "idle" | "loading" | "ready" | "error";
export type ProgressCb = (pct: number, file: string) => void;

let _pipeline: unknown = null;
let _loadPromise: Promise<unknown> | null = null;
let _status: EmbedderStatus = "idle";

const MODEL = "Xenova/all-MiniLM-L6-v2";

export function getEmbedderStatus(): EmbedderStatus {
  return _status;
}

export async function loadEmbedder(onProgress?: ProgressCb): Promise<void> {
  if (_pipeline) return;
  if (_loadPromise) { await _loadPromise; return; }

  _status = "loading";
  _loadPromise = (async () => {
    // Dynamic import keeps transformers.js out of the server bundle entirely.
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

  const pipe = _pipeline as (
    input: string[],
    opts: { pooling: string; normalize: boolean }
  ) => Promise<{ data: Float32Array; dims: number[] }>;

  const output = await pipe(texts, { pooling: "mean", normalize: true });
  const dim = output.dims[output.dims.length - 1]; // 384
  const result: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    result.push(Array.from(output.data.slice(i * dim, (i + 1) * dim)));
  }
  return result;
}
