/**
 * Displays a single retrieved document with its similarity score.
 * Shown in the metadata panel below the answer.
 */

interface DocumentCardProps {
  content: string;
  similarity: number;
  index: number;
}

export function DocumentCard({ content, similarity, index }: DocumentCardProps) {
  const pct = Math.round(similarity * 100);
  // Colour the similarity score: green above 80%, amber above 60%, red below.
  const scoreColour =
    pct >= 80 ? "text-emerald-400" : pct >= 60 ? "text-amber-400" : "text-red-400";

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 text-sm">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-xs text-zinc-500">doc [{index}]</span>
        <span className={`font-mono text-xs font-semibold ${scoreColour}`}>
          {pct}% match
        </span>
      </div>
      <p className="leading-relaxed text-zinc-300 line-clamp-3">{content}</p>
    </div>
  );
}
