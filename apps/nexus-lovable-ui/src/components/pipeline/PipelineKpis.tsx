import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { PipelineSummary } from "@/lib/pipeline";
import { fmtIdr, fmtIdrFull } from "./pipeline-ui";

type Tile = { label: string; value: string; full?: string; sub: string; zero: boolean; tone?: "bad" | "warn" | "good"; kind: "money" | "count" };

/**
 * The instrument strip (the GM's "instruments"): readings over every deal of the project, never the
 * filtered view, so filtering the board never changes the numbers people quote.
 *
 * Compact on purpose (owner, 9 Oct 2026: "UI UX ini rapihin dong" — the strip had grown into a tall card
 * with the numbers floating in it). Every tile is the same three lines and the strip never stretches to its
 * parent: one row of seven on a wide screen, money above counts (4 + 3) on a narrower one, and a row that
 * scrolls sideways on a phone. Hairline dividers come from the 1px gap over the border colour, so they stay
 * right in every arrangement. A reading of zero is drawn quietly instead of in bold.
 */
export function PipelineKpis({ s }: { s: PipelineSummary }) {
  const { t, lang } = useLang();
  const money = (n: number) => ({ value: fmtIdr(n, lang), full: fmtIdrFull(n, lang), zero: !n });
  const tiles: Tile[] = [
    { kind: "money", label: t("Open pipeline"), ...money(s.openValue), sub: t("{n} deals in play", { n: s.openCount }) },
    { kind: "money", label: t("Weighted forecast"), ...money(s.weightedValue), sub: t("Value × probability") },
    { kind: "money", label: t("Won"), ...money(s.wonValue), sub: t("{n} active · {lost} lost", { n: s.activeCount, lost: s.lostCount }) },
    {
      kind: "money", label: t("Receivable"), ...money(s.receivable),
      sub: s.receivableOverdue > 0 ? t("{amount} overdue", { amount: fmtIdr(s.receivableOverdue, lang) }) : t("Nothing overdue"),
      tone: s.receivableOverdue > 0 ? "bad" : undefined,
    },
    { kind: "count", label: t("Critical"), value: String(s.criticalCount), zero: !s.criticalCount, sub: t("{n} need attention", { n: s.attentionCount }), tone: s.criticalCount > 0 ? "bad" : undefined },
    { kind: "count", label: t("Ready to execute"), value: String(s.readyCount), zero: !s.readyCount, sub: t("{n} blocked", { n: s.blockedCount }), tone: s.blockedCount > 0 ? "warn" : s.readyCount > 0 ? "good" : undefined },
    { kind: "count", label: t("Deliverables on track"), value: String(s.deliverablesOnTrack), zero: !s.deliverablesOnTrack, sub: t("{n} completed", { n: s.deliverablesDone }) },
  ];
  return (
    <section data-pl="kpis" aria-label={t("Pipeline at a glance")} className="relative overflow-hidden rounded-2xl border border-border bg-border shadow-soft">
      <div className="overflow-x-auto overscroll-x-contain [scrollbar-width:none] sm:overflow-visible">
        <dl className="flex w-max min-w-full items-stretch gap-px sm:grid sm:w-auto sm:grid-cols-12 xl:grid-cols-7">
          {tiles.map((tile) => (
            <div
              key={tile.label}
              className={cn(
                "min-w-[9.75rem] flex-1 bg-card px-4 py-3 sm:min-w-0",
                tile.kind === "money" ? "sm:col-span-3" : "sm:col-span-4",
                "xl:col-span-1",
              )}
            >
              <dt className="truncate text-xs font-medium text-muted-foreground">{tile.label}</dt>
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
              <dd className="mt-0.5 truncate text-xs tabular-nums text-muted-foreground">{tile.sub}</dd>
            </div>
          ))}
        </dl>
      </div>
      {/* Phone: the row goes on past the edge — say so. */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-linear-to-l from-card to-transparent sm:hidden" />
    </section>
  );
}
