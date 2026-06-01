interface DocumentCardProps {
  content: string;
  similarity: number;
  index: number;
}

export function DocumentCard({ content, similarity, index }: DocumentCardProps) {
  const pct = Math.round(similarity * 100);
  const scoreColor =
    pct >= 80
      ? "text-claude-success bg-claude-success/10 ring-claude-success/20"
      : pct >= 60
      ? "text-amber-400 bg-amber-400/10 ring-amber-400/20"
      : "text-red-400 bg-red-400/10 ring-red-400/20";

  return (
    <div className="group rounded-xl border border-claude-border bg-claude-surface p-5 text-base transition-colors hover:border-claude-border-hi hover:bg-claude-surface2">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-claude-surface2 font-mono text-xs font-semibold text-claude-muted ring-1 ring-claude-border">
            {index}
          </span>
          <span className="text-sm text-claude-subtle">Source document</span>
        </div>
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-semibold ring-1 ${scoreColor}`}>
          {pct}% match
        </span>
      </div>
      <p className="line-clamp-3 leading-relaxed text-claude-muted">{content}</p>
    </div>
  );
}
