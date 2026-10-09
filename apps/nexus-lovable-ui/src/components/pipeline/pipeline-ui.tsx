import { cn } from "@/lib/utils";
import { useLang, type Lang } from "@/lib/lang";
import {
  daysOverdueOf,
  healthOf,
  phasesOf,
  stageGroupOf,
  type HealthKey,
  type HealthReason,
  type PhaseKey,
  type PhaseState,
  type StageGroup,
} from "@/lib/pipeline";
import type { PipelineDeal, PipelineDealPatch } from "@/lib/pipeline-api";

/**
 * Shared bits of the Pipeline Dashboard (owner, 9 Oct 2026): money and date formats, the labels of the
 * GM's vocabulary, the health pill and the six-dot phase track. Stored values are the GM's English keys;
 * only what is shown is translated (id-pipeline.ts).
 */

/** Compact rupiah for cards and KPIs: Rp950Jt / Rp1,2M (id) or Rp950M / Rp1.2B (en) — the GM's fmtIDR. */
export function fmtIdr(n: number | null | undefined, lang: Lang): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  const abs = Math.abs(n);
  const suf = lang === "en" ? { b: "B", m: "M", k: "K" } : { b: "M", m: "Jt", k: "Rb" };
  let v = abs;
  let s = "";
  if (abs >= 1e9) { v = abs / 1e9; s = suf.b; }
  else if (abs >= 1e6) { v = abs / 1e6; s = suf.m; }
  else if (abs >= 1e3) { v = abs / 1e3; s = suf.k; }
  const digits = s && v < 100 ? (v < 10 ? 1 : 0) : 0;
  const num = new Intl.NumberFormat(lang === "en" ? "en-GB" : "id-ID", { maximumFractionDigits: digits }).format(v);
  return `${n < 0 ? "-" : ""}Rp${num}${s}`;
}

/** Full rupiah: Rp950.000.000. */
export function fmtIdrFull(n: number | null | undefined, lang: Lang): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return `${n < 0 ? "-" : ""}Rp${new Intl.NumberFormat(lang === "en" ? "en-GB" : "id-ID").format(Math.abs(Math.round(n)))}`;
}

export function fmtPct(p: number): string {
  return `${Math.round((p || 0) * 100)}%`;
}

/** "4 Okt 2026" / "4 Oct 2026"; "–" for none. */
export function fmtDay(iso: string | null | undefined, locale: string): string {
  if (!iso) return "–";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

/** The Indonesian names the GM gave three stages; every other key reads the same in both languages. */
export function useVocabLabels() {
  const { t } = useLang();
  return {
    stage: (k: string) => t(k),
    risk: (k: string) => (k === "Aman" ? t("On track") : t(k)),
    link: (k: string) => (k === "Kontrak" ? t("Contract") : k === "Lainnya" ? t("Other link") : k === "SPK" ? t("SPK (Work Order)") : k),
    plain: (k: string) => k,
  };
}

export const HEALTH_ORDER: HealthKey[] = ["CRITICAL", "ATTENTION", "HEALTHY", "NOT_STARTED"];

export const HEALTH_LABEL: Record<HealthKey, string> = {
  CRITICAL: "Critical",
  ATTENTION: "Attention",
  HEALTHY: "Healthy",
  NOT_STARTED: "Not started",
  NONE: "Lost",
};

/** Text + soft background per health, from the app's semantic tokens (both themes). */
export const HEALTH_TONE: Record<HealthKey, string> = {
  CRITICAL: "bg-destructive/10 text-red-700 dark:bg-destructive/15 dark:text-red-300",
  ATTENTION: "bg-warning/15 text-amber-800 dark:text-amber-300",
  HEALTHY: "bg-success/10 text-emerald-700 dark:text-emerald-300",
  NOT_STARTED: "bg-muted text-muted-foreground",
  NONE: "bg-muted text-muted-foreground",
};

export const HEALTH_DOT: Record<HealthKey, string> = {
  CRITICAL: "bg-destructive",
  ATTENTION: "bg-warning",
  HEALTHY: "bg-success",
  NOT_STARTED: "bg-muted-foreground/50",
  NONE: "bg-muted-foreground/30",
};

export function HealthPill({ health, className }: { health: HealthKey; className?: string }) {
  const { t } = useLang();
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold", HEALTH_TONE[health], className)}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", HEALTH_DOT[health])} />
      {t(HEALTH_LABEL[health])}
    </span>
  );
}

/** One reason, in the viewer's language. */
export function useReasonText() {
  const { t, tn } = useLang();
  return (r: HealthReason): string => {
    switch (r.code) {
      case "READINESS_BLOCKED": return t("Readiness blocked");
      case "EXECUTION_WITHOUT_CONTRACT": return t("Running without a fully executed contract");
      case "RECEIVABLE_OVERDUE": return tn(r.days ?? 0, "Receivable {n} day overdue", "Receivable {n} days overdue");
      case "DELIVERABLE_OVERDUE": return t("Deliverable overdue");
      case "NEGATIVE_CASH": return t("Cash position materially negative");
      case "READINESS_PARTIAL": return t("Partly ready");
      case "DELIVERABLE_AT_RISK": return t("Deliverable at risk");
      case "PAYMENT_PARTIAL": return t("Partly paid");
      case "PAYMENT_DUE": return t("Payment due");
      // Same words as the critical one; the pill's colour already says it is not critical yet (≤ 7 days).
      case "MINOR_OVERDUE": return tn(r.days ?? 0, "Receivable {n} day overdue", "Receivable {n} days overdue");
      case "BLOCKER": return t("Blocker: {text}", { text: r.text ?? "" });
      case "VREG_PENDING": return t("Vendor registration not approved yet");
      default: return String((r as { code?: unknown }).code ?? "");
    }
  };
}

export const PHASE_LABEL: Record<PhaseKey, string> = {
  commercial: "Commercial",
  contract: "Contract",
  readiness: "Readiness",
  deliverable: "Deliverable",
  payment: "Payment",
  closing: "Closing",
};

export const PHASE_STATE_LABEL: Record<PhaseState, string> = {
  done: "done",
  active: "in progress",
  pending: "not started",
  bad: "needs attention",
};

const PHASE_TONE: Record<PhaseState, string> = {
  done: "bg-success",
  active: "bg-info",
  pending: "bg-border",
  bad: "bg-destructive",
};

/** The six segments on a card: how far each line of work in the deal has come (the GM's stepper). */
export function PhaseTrack({ deal, className }: { deal: Pick<PipelineDeal, "phases">; className?: string }) {
  const { t } = useLang();
  const label = deal.phases.map((p) => `${t(PHASE_LABEL[p.key])}: ${t(PHASE_STATE_LABEL[p.state])}`).join(", ");
  return (
    <div role="img" aria-label={label} title={label} className={cn("grid grid-cols-6 gap-1", className)}>
      {deal.phases.map((p) => (
        <span key={p.key} className={cn("h-1 rounded-full", PHASE_TONE[p.state])} />
      ))}
    </div>
  );
}

export function phaseDotTone(state: PhaseState): string {
  return PHASE_TONE[state];
}

/** A stage group's mark in a column head. */
export const GROUP_TONE: Record<StageGroup, string> = {
  Pipeline: "bg-info",
  "Pre-Execution": "bg-warning",
  Execution: "bg-success",
  Closed: "bg-foreground/60",
  Lost: "bg-muted-foreground/40",
};

/** "Name" of a deal's BD or PM: the NEXUS user, else the free text, else null. */
export function personName(user: { name: string | null } | null, text: string | null): string | null {
  return user?.name?.trim() || text?.trim() || null;
}

/**
 * The deal as it will look once the server has the patch: an optimistic edit shows the right column,
 * health and phases at once. People objects are filled in from the directory by the caller.
 */
export function applyLocal(deal: PipelineDeal, patch: PipelineDealPatch, today: string): PipelineDeal {
  const next = { ...deal, ...patch } as PipelineDeal;
  next.stageGroup = stageGroupOf(next.stage);
  next.daysOverdue = daysOverdueOf(next, today);
  next.health = healthOf(next, today);
  next.phases = phasesOf(next);
  return next;
}
