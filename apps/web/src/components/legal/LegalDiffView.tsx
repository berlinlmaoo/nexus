import type { ReactNode } from "react";
import type { DiffSegment, ParagraphDiff } from "@/lib/legal-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

/** Words removed struck through in red, words added highlighted in green — one paragraph, before → after. */
export function SegmentsView({ segments }: { segments: DiffSegment[] }) {
  return (
    <span className="whitespace-pre-wrap">
      {segments.map((s, i) =>
        s.type === "same" ? <span key={i}>{s.text}</span>
          : s.type === "del" ? <del key={i} className="rounded-sm bg-red-500/15 text-red-700 decoration-red-500/70 dark:text-red-300">{s.text}</del>
            : <ins key={i} className="rounded-sm bg-emerald-500/15 text-emerald-800 no-underline dark:text-emerald-300">{s.text}</ins>,
      )}
    </span>
  );
}

/** Two versions as one flow: unchanged paragraphs folded, changes in full. */
export function LegalDiffView({ diff }: { diff: ParagraphDiff[] }) {
  const { t } = useLang();
  const changes = diff.filter((d) => d.type !== "same").length;
  if (!changes) return <p className="py-4 text-sm text-muted-foreground">{t("These versions have the same text.")}</p>;
  const rows: { key: string; node: ReactNode }[] = [];
  let folded = 0;
  const flush = (k: number) => {
    if (folded) rows.push({ key: `f${k}`, node: <div className="py-1 text-center text-xs text-muted-foreground">{t("{n} unchanged paragraphs", { n: folded })}</div> });
    folded = 0;
  };
  diff.forEach((d, k) => {
    if (d.type === "same") { folded++; return; }
    flush(k);
    const box = "rounded-md border px-3 py-2 text-sm";
    rows.push({
      key: `d${k}`,
      node:
        d.type === "changed" ? <div className={cn(box, "border-amber-500/40")}><SegmentsView segments={d.segments} /></div>
          : d.type === "added" ? <div className={cn(box, "border-emerald-500/40 bg-emerald-500/5")}><span className="mr-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">{t("Added")}</span><span className="whitespace-pre-wrap">{d.text}</span></div>
            : <div className={cn(box, "border-red-500/40 bg-red-500/5")}><span className="mr-1.5 text-xs font-medium text-red-700 dark:text-red-300">{t("Deleted")}</span><del className="whitespace-pre-wrap">{d.text}</del></div>,
    });
  });
  flush(diff.length);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t("{n} paragraphs changed", { n: changes })}</p>
      {rows.map((r) => <div key={r.key}>{r.node}</div>)}
    </div>
  );
}
