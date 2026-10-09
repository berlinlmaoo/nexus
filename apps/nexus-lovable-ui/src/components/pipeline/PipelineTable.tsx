import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import {
  CONTRACT_STATUS_OPTIONS,
  DELIVERABLE_RISK_OPTIONS,
  PAYMENT_STATUS_OPTIONS,
  PIPELINE_STAGES,
  PROBABILITY_OPTIONS,
} from "@/lib/pipeline";
import type { PipelineDeal, PipelineDealPatch } from "@/lib/pipeline-api";
import { CELL, DateField, MoneyField, SelectField } from "./fields";
import { HEALTH_ORDER, HealthPill, fmtIdr, fmtPct, personName, useVocabLabels } from "./pipeline-ui";

type SortKey = "code" | "name" | "stage" | "probability" | "netValue" | "outstandingReceivable" | "daysOverdue" | "nextActionDate" | "health" | "pm";

/**
 * The table: every deal on one row, the fields people update most edited right in the cell (saved on
 * pick or when leaving the cell). The name column stays put while the rest scrolls sideways. Totals at
 * the foot are over the rows shown. Everything else is in the deal's drawer (click the name).
 */
export function PipelineTable({
  deals, onOpen, onPatch, canEdit,
}: {
  deals: PipelineDeal[];
  onOpen: (id: string) => void;
  onPatch: (id: string, patch: PipelineDealPatch) => void;
  canEdit: boolean;
}) {
  const { t, lang, locale } = useLang();
  const labels = useVocabLabels();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "stage", dir: 1 });

  const rows = useMemo(() => {
    const stageIx = (s: string) => {
      const i = (PIPELINE_STAGES as readonly string[]).indexOf(s);
      return i < 0 ? 99 : i;
    };
    const val = (d: PipelineDeal): string | number => {
      switch (sort.key) {
        case "stage": return stageIx(d.stage);
        case "health": return HEALTH_ORDER.indexOf(d.health.key) < 0 ? 9 : HEALTH_ORDER.indexOf(d.health.key);
        case "pm": return (personName(d.pm, d.pmName) ?? "￿").toLowerCase();
        case "nextActionDate": return d.nextActionDate ?? "9999";
        case "name": return d.name.toLowerCase();
        case "code": return d.code;
        default: return d[sort.key] as number;
      }
    };
    return [...deals].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return c * sort.dir || a.code.localeCompare(b.code);
    });
  }, [deals, sort]);

  const totals = useMemo(() => ({
    net: rows.reduce((s, d) => s + (d.netValue || 0), 0),
    outstanding: rows.reduce((s, d) => s + (d.outstandingReceivable || 0), 0),
  }), [rows]);

  // A function, not a component: a component defined in here would remount on every sort, and the
  // header button just pressed would lose keyboard focus.
  const th = (k: SortKey, children: string, className?: string) => {
    const on = sort.key === k;
    return (
      <th key={k} scope="col" aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={cn("whitespace-nowrap px-2 py-2 text-left font-semibold", className)}>
        <button
          type="button"
          onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : 1 }))}
          className="inline-flex items-center gap-1 rounded text-2xs uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {children}
          {on ? (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
        </button>
      </th>
    );
  };

  const plainTh = (label: string, className?: string) => (
    <th scope="col" className={cn("whitespace-nowrap px-2 py-2 text-left text-2xs font-semibold uppercase tracking-wider text-muted-foreground", className)}>{label}</th>
  );

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft [scrollbar-width:thin]">
      <table className="w-full min-w-[72rem] border-collapse text-sm">
        <thead className="border-b border-border bg-muted/40">
          <tr>
            {th("code", t("Code"), "hidden w-24 pl-4 sm:table-cell")}
            {th("name", t("Deal"), "sticky left-0 z-10 min-w-56 bg-muted")}
            {th("stage", t("Stage"), "min-w-48")}
            {th("probability", t("Prob."), "w-24")}
            {th("netValue", t("Net value"), "min-w-40 text-right")}
            {plainTh(t("Contract"), "min-w-40")}
            {plainTh(t("Deliverable"), "min-w-32")}
            {plainTh(t("Payment"), "min-w-32")}
            {th("outstandingReceivable", t("Receivable"), "min-w-40")}
            {th("daysOverdue", t("Overdue"), "w-20")}
            {plainTh(t("Next action"), "min-w-56")}
            {th("nextActionDate", t("By"), "min-w-36")}
            {th("pm", "PM", "min-w-32")}
            {th("health", t("Health"), "pr-4")}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} className="group border-b border-border/70 last:border-b-0 hover:bg-muted/30">
              <td className="hidden whitespace-nowrap pl-4 pr-2 text-xs tabular-nums text-muted-foreground sm:table-cell">{d.code}</td>
              <td className="sticky left-0 z-10 bg-card px-2 py-1.5 group-hover:bg-muted">
                <button
                  type="button"
                  onClick={() => onOpen(d.id)}
                  className="block max-w-40 truncate sm:max-w-72 rounded text-left font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  title={d.name}
                >
                  {d.name || t("Untitled deal")}
                </button>
                <span className="block max-w-40 truncate sm:max-w-72 text-xs text-muted-foreground">{d.brand || "–"}</span>
              </td>
              <td className="px-1"><SelectField cell className="min-w-[11.5rem]" label={t("Stage")} value={d.stage} options={PIPELINE_STAGES} labelOf={labels.stage} disabled={!canEdit} onCommit={(v) => onPatch(d.id, { stage: v })} /></td>
              <td className="px-1"><SelectField cell className="min-w-[5.5rem]" label={t("Probability")} value={d.probability} options={PROBABILITY_OPTIONS as readonly number[]} labelOf={fmtPct} disabled={!canEdit} onCommit={(v) => onPatch(d.id, { probability: v })} /></td>
              <td className="px-1"><MoneyField cell className="min-w-[9rem]" label={t("Net value")} value={d.netValue} disabled={!canEdit} onCommit={(v) => onPatch(d.id, { netValue: v })} /></td>
              <td className="px-1"><SelectField cell className="min-w-[9.5rem]" label={t("Contract status")} value={d.contractStatus} options={CONTRACT_STATUS_OPTIONS} disabled={!canEdit} onCommit={(v) => onPatch(d.id, { contractStatus: v })} /></td>
              <td className="px-1"><SelectField cell className="min-w-[7rem]" label={t("Deliverable risk")} value={d.deliverableRisk} options={DELIVERABLE_RISK_OPTIONS} labelOf={labels.risk} disabled={!canEdit} onCommit={(v) => onPatch(d.id, { deliverableRisk: v })} /></td>
              <td className="px-1"><SelectField cell className="min-w-[7rem]" label={t("Payment status")} value={d.paymentStatus} options={PAYMENT_STATUS_OPTIONS} disabled={!canEdit} onCommit={(v) => onPatch(d.id, { paymentStatus: v })} /></td>
              <td className="px-1"><MoneyField cell className="min-w-[9rem]" label={t("Outstanding receivable")} value={d.outstandingReceivable} disabled={!canEdit} onCommit={(v) => onPatch(d.id, { outstandingReceivable: v })} /></td>
              <td className={cn("px-2 text-right tabular-nums", d.daysOverdue > 7 ? "font-semibold text-red-700 dark:text-red-300" : d.daysOverdue > 0 ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground")}>
                {d.daysOverdue > 0 ? t("{n}d", { n: d.daysOverdue }) : "–"}
              </td>
              <td className="px-1">
                <NextActionCell value={d.nextAction} disabled={!canEdit} label={t("Next action")} onCommit={(v) => onPatch(d.id, { nextAction: v })} />
              </td>
              <td className="px-1"><DateField cell className="min-w-[8.5rem]" label={t("Next action date")} value={d.nextActionDate} disabled={!canEdit} onCommit={(v) => onPatch(d.id, { nextActionDate: v })} /></td>
              <td className="max-w-40 truncate px-2 text-muted-foreground">{personName(d.pm, d.pmName) ?? "–"}</td>
              <td className="pr-4">{d.health.key !== "NONE" ? <HealthPill health={d.health.key} /> : <span className="text-xs text-muted-foreground">–</span>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-border bg-muted/40 text-sm font-semibold tabular-nums">
          <tr>
            <td className="hidden pl-4 sm:table-cell" />
            <td className="sticky left-0 z-10 bg-muted px-2 py-2">{t("{n} deals", { n: rows.length })}</td>
            <td colSpan={2} />
            <td className="px-2 text-right" title={new Intl.NumberFormat(locale).format(totals.net)}>{fmtIdr(totals.net, lang)}</td>
            <td colSpan={3} />
            <td className="px-2 text-right">{fmtIdr(totals.outstanding, lang)}</td>
            <td colSpan={5} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function NextActionCell({ value, onCommit, label, disabled }: { value: string; onCommit: (v: string) => void; label: string; disabled: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="text"
      aria-label={label}
      value={draft ?? value}
      disabled={disabled}
      maxLength={500}
      placeholder="–"
      onFocus={() => setDraft(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { const v = (draft ?? value).trim(); setDraft(null); if (v !== value) onCommit(v); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLElement).blur();
        if (e.key === "Escape") { setDraft(value); requestAnimationFrame(() => (e.target as HTMLElement).blur()); }
      }}
      className={cn(CELL, "min-w-[12rem]")}
    />
  );
}
