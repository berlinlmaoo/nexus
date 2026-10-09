import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { PipelineSummary } from "@/lib/pipeline";
import { fmtIdr, fmtIdrFull } from "./pipeline-ui";

type Tile = { label: string; value: string; full?: string; sub: string; tone?: "bad" | "warn" | "good" };

/**
 * The instrument strip (the GM's "instruments"): one row of readings over every deal of the project,
 * never the filtered view, so filtering the board never changes the numbers people quote. On a phone the
 * row scrolls sideways instead of wrapping into a wall of tiles.
 */
export function PipelineKpis({ s }: { s: PipelineSummary }) {
  const { t, lang } = useLang();
  const tiles: Tile[] = [
    { label: t("Open pipeline"), value: fmtIdr(s.openValue, lang), full: fmtIdrFull(s.openValue, lang), sub: t("{n} deals in play", { n: s.openCount }) },
    { label: t("Weighted forecast"), value: fmtIdr(s.weightedValue, lang), full: fmtIdrFull(s.weightedValue, lang), sub: t("Value × probability") },
    { label: t("Won"), value: fmtIdr(s.wonValue, lang), full: fmtIdrFull(s.wonValue, lang), sub: t("{n} active · {lost} lost", { n: s.activeCount, lost: s.lostCount }) },
    {
      label: t("Receivable"), value: fmtIdr(s.receivable, lang), full: fmtIdrFull(s.receivable, lang),
      sub: t("{amount} overdue", { amount: fmtIdr(s.receivableOverdue, lang) }), tone: s.receivableOverdue > 0 ? "bad" : undefined,
    },
    { label: t("Critical"), value: String(s.criticalCount), sub: t("{n} need attention", { n: s.attentionCount }), tone: s.criticalCount > 0 ? "bad" : undefined },
    { label: t("Ready to execute"), value: String(s.readyCount), sub: t("{n} blocked", { n: s.blockedCount }), tone: s.blockedCount > 0 ? "warn" : s.readyCount > 0 ? "good" : undefined },
    { label: t("Deliverables on track"), value: String(s.deliverablesOnTrack), sub: t("{n} completed", { n: s.deliverablesDone }) },
  ];
  return (
    <section aria-label={t("Pipeline at a glance")} className="overflow-x-auto overscroll-x-contain [scrollbar-width:thin]">
      <dl className="grid min-w-max grid-flow-col auto-cols-[minmax(9.5rem,1fr)] divide-x divide-border rounded-2xl border border-border bg-card shadow-soft md:min-w-0">
        {tiles.map((tile) => (
          <div key={tile.label} className="px-4 py-3">
            <dt className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{tile.label}</dt>
            <dd
              title={tile.full}
              className={cn(
                "mt-1 text-xl font-semibold tabular-nums tracking-tight",
                tile.tone === "bad" && "text-red-700 dark:text-red-300",
                tile.tone === "warn" && "text-amber-700 dark:text-amber-300",
                tile.tone === "good" && "text-emerald-700 dark:text-emerald-300",
              )}
            >
              {tile.value}
            </dd>
            <dd className="mt-0.5 text-xs text-muted-foreground tabular-nums">{tile.sub}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
