// Port of the Python chunking algorithm in api/routes/ingest.py.
// Splits text into overlapping chunks, preferring natural break points.

const CHUNK_SIZE = 600;
const OVERLAP = 100;
const MIN_CHUNK = 50;

export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);
    let chunk = text.slice(start, end);

    // Prefer breaking at a sentence/paragraph boundary in the back half
    if (end < text.length) {
      const zone = chunk.slice(Math.floor(chunk.length / 2));
      for (const sep of [". ", "\n\n", "\n"]) {
        const idx = zone.lastIndexOf(sep);
        if (idx !== -1) {
          chunk = chunk.slice(0, Math.floor(chunk.length / 2) + idx + sep.length);
          break;
        }
      }
    }

    chunk = chunk.trim();
    if (chunk.length >= MIN_CHUNK) chunks.push(chunk);

    const advance = chunk.length - OVERLAP;
    start += advance > 0 ? advance : chunk.length;
  }

  return chunks;
}
