import { useRef } from "react";
import { cn } from "@/lib/utils";
import { EdgeArrows } from "@/components/EdgeArrows";
import { useLang } from "@/lib/lang";
import type { PipelineSummary } from "@/lib/pipeline";
import { useMoneyFmt } from "./presentation";

type Tile = { label: string; value: string; full?: string; sub: string; subFull?: string; warn?: string; zero: boolean; tone?: "bad" | "warn" | "good"; kind: "money" | "count" };

/**
 * The instrument strip (the GM's "instruments"): readings over every deal of the project, never the
 * filtered view, so filtering the board never changes the numbers people quote.
 *
 * Compact on purpose (owner, 9 Oct 2026: "UI UX ini rapihin dong" — the strip had grown into a tall card
 * with the numbers floating in it). Every tile is the same three lines and the strip never stretches to its
 * parent: one row of eight on a wide screen, money above counts (5 + 3) on a narrower one, and a row that
 * scrolls sideways on a phone. Hairline dividers come from the 1px gap over the border colour, so they stay
 * right in every arrangement. A reading of zero is drawn quietly instead of in bold. "Real profit" (Control
 * Tower v6, 14 Oct 2026) = Σ (net value − real cost) over the deals not Lost that have cost lines and a
 * net value; red below zero. Deals with costs but no net value are left out and named in a small warning
 * line under the tile (lib/pipeline.ts summarize).
 */
export function PipelineKpis({ s }: { s: PipelineSummary }) {
  const { t, tn, lang } = useLang();
  const scroller = useRef<HTMLDivElement>(null);
  const { fmtIdr, fmtIdrFull, hidden } = useMoneyFmt();
  // Presenting: every money tile reads "Rp ••••" in the same quiet tone, so neither a zero nor a red
  // (negative / overdue) tile gives a figure away.
  const money = (n: number) => ({ value: fmtIdr(n, lang), full: fmtIdrFull(n, lang), zero: hidden || !n });
  const tiles: Tile[] = [
    { kind: "money", label: t("Open pipeline"), ...money(s.openValue), sub: tn(s.openCount, "{n} open deal", "{n} open deals") },
    { kind: "money", label: t("Weighted forecast"), ...money(s.weightedValue), sub: t("Value × probability") },
    { kind: "money", label: t("Won"), ...money(s.wonValue), sub: t("{n} active · {lost} lost", { n: s.activeCount, lost: s.lostCount }) },
    {
      kind: "money", label: t("Receivable"), ...money(s.receivable),
      sub: s.receivableOverdue > 0 ? t("{amount} overdue", { amount: fmtIdr(s.receivableOverdue, lang) }) : t("None overdue"),
      // Short on purpose: eight tiles share a 1440 screen (QA final 19 Oct, D-7); the long line is the tooltip.
      subFull: s.receivableOverdue > 0 ? undefined : t("Nothing overdue"),
      tone: s.receivableOverdue > 0 ? "bad" : undefined,
    },
    {
      kind: "money", label: t("Real profit"), ...money(s.realProfit ?? 0),
      full: `${fmtIdrFull(s.realProfit ?? 0, lang)} · ${t("Real cost")} ${fmtIdrFull(s.realCost ?? 0, lang)}`,
      sub: t("{n}/{total} with costs", { n: s.costDealCount ?? 0, total: s.costEligibleCount ?? 0 }),
      subFull: t("{n} of {total} deals have costs", { n: s.costDealCount ?? 0, total: s.costEligibleCount ?? 0 }),
      warn: (s.costNoNetCount ?? 0) > 0 ? t("{n} deals have costs but no net value", { n: s.costNoNetCount }) : undefined,
      tone: (s.realProfit ?? 0) < 0 ? "bad" : undefined,
    },
    { kind: "count", label: t("Critical"), value: String(s.criticalCount), zero: !s.criticalCount, sub: tn(s.attentionCount, "{n} needs attention", "{n} need attention"), tone: s.criticalCount > 0 ? "bad" : undefined },
    { kind: "count", label: t("Ready to execute"), value: String(s.readyCount), zero: !s.readyCount, sub: t("{n} blocked", { n: s.blockedCount }), tone: s.blockedCount > 0 ? "warn" : s.readyCount > 0 ? "good" : undefined },
    { kind: "count", label: t("Deliverables on track"), value: String(s.deliverablesOnTrack), zero: !s.deliverablesOnTrack, sub: t("{n} completed", { n: s.deliverablesDone }) },
  ];
  if (hidden) for (const tile of tiles) if (tile.kind === "money") { tile.tone = undefined; tile.warn = undefined; }
  return (
    <section data-pl="kpis" aria-label={t("Pipeline at a glance")} className="relative overflow-hidden rounded-xl border border-border bg-border">
      <div ref={scroller} className="overflow-x-auto overscroll-x-contain [scrollbar-width:none] sm:overflow-visible">
        <dl className="flex w-max min-w-full items-stretch gap-px sm:grid sm:w-auto sm:grid-cols-30 xl:grid-cols-8">
          {tiles.map((tile) => (
            // Each tile is a subgrid of the strip's rows (sm and up), so a label that takes two lines moves the
            // readings of its whole row down with it and the numbers stay level.
            <div
              key={tile.label}
              className={cn(
                "min-w-[9.75rem] flex-1 bg-card px-4 py-3 sm:row-span-4 sm:grid sm:min-w-0 sm:grid-rows-subgrid sm:gap-y-0",
                tile.kind === "money" ? "sm:col-span-6" : "sm:col-span-10",
                "xl:col-span-1",
              )}
            >
              {/* Never cut ("Deliverables on t…" at 1440, QA final #2 pre-run, P-2): wraps between words onto a
                  second line instead. */}
              <dt className="line-clamp-2 break-words text-xs font-medium text-muted-foreground [text-wrap:balance]">{tile.label}</dt>
              <dd
                title={tile.full}
                className={cn(
                  "mt-1 truncate text-xl font-semibold leading-7 tracking-tight tabular-nums",
                  tile.zero && "text-muted-foreground/70",
                  !tile.zero && tile.tone === "bad" && "text-red-700 dark:text-red-300",
                  !tile.zero && tile.tone === "warn" && "text-amber-700 dark:text-amber-300",
                  !tile.zero && tile.tone === "good" && "text-emerald-700 dark:text-emerald-300",
                )}
              >
                {tile.value}
              </dd>
              <dd title={tile.subFull ?? tile.sub} className="mt-0.5 truncate text-xs tabular-nums text-muted-foreground">{tile.sub}</dd>
              {tile.warn && (
                <dd title={tile.warn} className="mt-0.5 truncate text-xs tabular-nums text-amber-700 dark:text-amber-300">
                  {tile.warn}
                </dd>
              )}
            </div>
          ))}
        </dl>
      </div>
      {/* Phone: the row goes on past the edge — say so with an arrow, not only a faint fade (the third tile read
          "Won Rp" cut at the screen edge, visual QA 24 Oct). */}
      <EdgeArrows target={scroller} className="inset-y-0 sm:hidden" />
    </section>
  );
}
