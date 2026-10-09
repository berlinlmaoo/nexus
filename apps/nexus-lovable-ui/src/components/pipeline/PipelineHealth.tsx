import type { ReactNode } from "react";
import { AlertTriangle, CalendarClock, CircleCheck, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { daysBetween } from "@/lib/pipeline";
import type { PipelineDeal } from "@/lib/pipeline-api";
import { HealthPill, dealPayment, fmtDay, fmtIdr, personName, useReasonText, useVocabLabels } from "./pipeline-ui";
import { bySeverity } from "./PipelineBoard";

/**
 * Health: what needs someone today. The GM's health groups (Critical, Attention) with the reasons spelled
 * out, then three working lists — next actions by when they are due, payments that are late, and every
 * blocker — so a weekly review can run top to bottom without opening each deal. Healthy and not-started
 * deals are only counted here; they live on the board.
 */
export function PipelineHealth({ deals, today, onOpen }: { deals: PipelineDeal[]; today: string; onOpen: (id: string) => void }) {
  const { t, tn, lang, locale } = useLang();
  const reason = useReasonText();
  const labels = useVocabLabels();
  const live = deals.filter((d) => d.stageGroup !== "Lost" && d.stageGroup !== "Closed");
  const flagged = deals.filter((d) => d.health.key === "CRITICAL" || d.health.key === "ATTENTION").sort(bySeverity);
  const healthy = deals.filter((d) => d.health.key === "HEALTHY").length;
  const notStarted = deals.filter((d) => d.health.key === "NOT_STARTED").length;

  const actions = live
    .filter((d) => d.nextActionDate && daysBetween(today, d.nextActionDate) <= 7)
    .sort((a, b) => (a.nextActionDate! < b.nextActionDate! ? -1 : 1));
  const overdueActions = actions.filter((d) => d.nextActionDate! < today);
  const todayActions = actions.filter((d) => d.nextActionDate === today);
  const weekActions = actions.filter((d) => d.nextActionDate! > today);
  // A deal paid per term counts only what is past due, not the terms still to come (owner, 9 Oct 2026).
  const lateAmount = (d: PipelineDeal) => (d.termSummary ? d.termSummary.overdueOutstanding : d.outstandingReceivable);
  const late = deals.filter((d) => d.daysOverdue > 0 && lateAmount(d) > 0).sort((a, b) => b.daysOverdue - a.daysOverdue);
  const blockers = live.filter((d) => d.blocker).sort(bySeverity);

  const DealLink = ({ d }: { d: PipelineDeal }) => (
    <button type="button" onClick={() => onOpen(d.id)} className="min-w-0 truncate rounded text-left text-sm font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
      {d.name || t("Untitled deal")}
    </button>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <Panel
        icon={<AlertTriangle className="h-4 w-4" />}
        title={t("Needs attention")}
        meta={t("{healthy} healthy · {open} not started", { healthy, open: notStarted })}
      >
        {flagged.length === 0 ? (
          <Calm text={t("Nothing critical and nothing waiting on attention. Deals in execution are on track.")} />
        ) : (
          <ul className="divide-y divide-border">
            {flagged.map((d) => (
              <li key={d.id} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:gap-3">
                <HealthPill health={d.health.key} className="w-fit sm:mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <DealLink d={d} />
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtIdr(d.netValue, lang)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{d.code} · {labels.stage(d.stage)}{personName(d.pm, d.pmName) ? ` · PM ${personName(d.pm, d.pmName)}` : ""}</p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {d.health.reasons.map((r, i) => (
                      <li key={i} className={cn("max-w-full truncate rounded-md px-1.5 py-0.5 text-xs", d.health.key === "CRITICAL" ? "bg-destructive/10 text-red-700 dark:text-red-300" : "bg-warning/15 text-amber-800 dark:text-amber-300")}>
                        {reason(r)}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="flex flex-col gap-4">
        <Panel icon={<CalendarClock className="h-4 w-4" />} title={t("Next actions")} meta={t("Due within 7 days")}>
          {actions.length === 0 ? (
            <Calm text={t("No next action is due this week. Give each live deal a next step and a date, and it shows up here.")} />
          ) : (
            <div className="divide-y divide-border">
              {([
                [t("Overdue"), overdueActions, "text-red-700 dark:text-red-300"],
                [t("Today"), todayActions, "text-foreground"],
                [t("This week"), weekActions, "text-muted-foreground"],
              ] as const).filter(([, list]) => list.length > 0).map(([label, list, tone]) => (
                <div key={label} className="px-4 py-2.5">
                  <h4 className={cn("text-2xs font-semibold uppercase tracking-wider", tone)}>{label}</h4>
                  <ul className="mt-1 space-y-2">
                    {list.map((d) => (
                      <li key={d.id} className="min-w-0">
                        <div className="flex items-baseline justify-between gap-3">
                          <DealLink d={d} />
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtDay(d.nextActionDate, locale)}</span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{d.nextAction || t("No next action written")}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel icon={<Wallet className="h-4 w-4" />} title={t("Late payments")} meta={late.length ? fmtIdr(late.reduce((s, d) => s + lateAmount(d), 0), lang) : undefined}>
          {late.length === 0 ? (
            <Calm text={t("No receivable is past its due date.")} />
          ) : (
            <ul className="divide-y divide-border">
              {late.map((d) => (
                <li key={d.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <DealLink d={d} />
                    <p className="text-xs text-muted-foreground">{dealPayment(d).status} · {fmtIdr(lateAmount(d), lang)}</p>
                  </div>
                  <span className={cn("shrink-0 text-sm font-semibold tabular-nums", d.daysOverdue > 7 ? "text-red-700 dark:text-red-300" : "text-amber-800 dark:text-amber-300")}>
                    {tn(d.daysOverdue, "{n} day", "{n} days")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel icon={<AlertTriangle className="h-4 w-4" />} title={t("Blockers")} meta={blockers.length ? String(blockers.length) : undefined}>
          {blockers.length === 0 ? (
            <Calm text={t("No live deal has a blocker written down.")} />
          ) : (
            <ul className="divide-y divide-border">
              {blockers.map((d) => (
                <li key={d.id} className="px-4 py-2.5">
                  <DealLink d={d} />
                  <p className="text-xs text-amber-800 dark:text-amber-300">{d.blocker}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Panel({ icon, title, meta, children }: { icon: ReactNode; title: string; meta?: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><span className="text-muted-foreground">{icon}</span>{title}</h3>
        {meta && <span className="text-xs tabular-nums text-muted-foreground">{meta}</span>}
      </header>
      {children}
    </section>
  );
}

function Calm({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 px-4 py-4 text-sm text-muted-foreground">
      <CircleCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      {text}
    </p>
  );
}
