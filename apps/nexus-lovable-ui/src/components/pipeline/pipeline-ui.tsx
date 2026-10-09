import { AlertTriangle, Check } from "lucide-react";
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
  type TermStatus,
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

/** "4 Okt" / "4 Oct": a date on a card, where the year is this one or the next. */
export function fmtDayShort(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
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

// Amber for a phase under way, like the GM's board (owner, 9 Oct 2026: green done, amber in progress, red
// problem, grey not started) — blue read as "info", not as "being worked on".
const PHASE_TONE: Record<PhaseState, string> = {
  done: "bg-success",
  active: "bg-warning",
  pending: "bg-border",
  bad: "bg-destructive",
};

/**
 * The six segments on a card: how far each line of work in the deal has come (the GM's stepper). On every
 * deal, an open one included — six grey segments say "nothing has started yet", which is worth seeing
 * (owner, 9 Oct 2026). The hover / screen-reader text names each phase with its detail line.
 */
export function PhaseTrack({ deal, className }: { deal: PipelineDeal; className?: string }) {
  const { t } = useLang();
  const detail = usePhaseDetail();
  const label = deal.phases.map((p) => `${t(PHASE_LABEL[p.key])}: ${detail(deal, p.key)}`).join(" · ");
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

/**
 * The line under each phase — the GM's node details ("Deal won", "Fully executed", "Siap eksekusi",
 * "Overdue 12 hari", "Belum dimulai"), in one place for the card's hover text and the deal's stepper.
 * The state itself comes from the server (lib/pipeline.ts phasesOf); this only words it. Overdue without
 * a day count says "Payment overdue", never "Overdue 0 days" (owner, 9 Oct 2026).
 */
export function usePhaseDetail() {
  const { t, tn } = useLang();
  return (deal: PipelineDeal, key: PhaseKey): string => {
    switch (key) {
      case "commercial": {
        const g = stageGroupOf(deal.stage);
        return g === "Pipeline" || g === "Lost" ? t(deal.stage) : t("Deal won");
      }
      case "contract":
        if (deal.contractStatus === "Fully Executed") return t("Fully executed");
        if (deal.contractStatus === "Cancelled") return t("Contract cancelled");
        if (!deal.contractStatus || deal.contractStatus === "Not Started") return t("Not started");
        return deal.contractStatus;
      case "readiness":
        if (deal.readiness === "Ready") return t("Ready to execute");
        if (deal.readiness === "Blocked") return t("Readiness blocked");
        if (deal.readiness === "Partial") return t("Partly ready");
        return t("Not yet relevant");
      case "deliverable":
        if (deal.deliverableStatus === "Completed" || deal.deliverableStatus === "Approved") return t("Deliverable done");
        if (deal.deliverableRisk === "Overdue") return t("Deliverable overdue");
        if (deal.deliverableRisk === "At Risk") return t("Deliverable at risk");
        if (!deal.deliverableStatus || deal.deliverableStatus === "Not Started") return t("Not started");
        return deal.deliverableStatus;
      case "payment": {
        const status = dealPayment(deal).status;
        if (status === "Paid") return t("Fully paid");
        if (status === "Overdue") return deal.daysOverdue > 0 ? tn(deal.daysOverdue, "Overdue {n} day", "Overdue {n} days") : t("Payment overdue");
        if (status === "Partial") return t("Partly paid");
        if (status === "Due") return t("Payment due");
        if (status === "Upcoming") return t("Upcoming due");
        return t("Not yet billed");
      }
      case "closing":
        if (deal.closingStatus === "Closed") return "Closed";
        if (!deal.closingStatus || deal.closingStatus === "Not Ready") return t("Not started");
        return deal.closingStatus;
      default:
        return "";
    }
  };
}

/**
 * The deal's blocker as a banner (owner, 9 Oct 2026: "kalo ada blocker harusnya masuk ke tampilan 1"):
 * red on a critical deal, amber otherwise; full text up to `lines` lines.
 */
export function BlockerBanner({ deal, lines, className }: { deal: Pick<PipelineDeal, "blocker" | "health">; lines?: 2; className?: string }) {
  const { t } = useLang();
  const text = deal.blocker?.trim();
  if (!text) return null;
  const critical = deal.health.key === "CRITICAL";
  return (
    <p
      title={lines ? text : undefined}
      className={cn(
        "flex items-start gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold",
        critical ? "bg-destructive/10 text-red-700 dark:bg-destructive/15 dark:text-red-300" : "bg-warning/15 text-amber-800 dark:text-amber-300",
        className,
      )}
    >
      <AlertTriangle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
      <span className="sr-only">{t("Blocker")}: </span>
      <span className={cn("min-w-0 break-words", lines === 2 && "line-clamp-2")}>{text}</span>
    </p>
  );
}

const STEP_MARK: Record<PhaseState, string> = {
  done: "bg-success text-white",
  active: "border-2 border-warning bg-card",
  pending: "border-2 border-border bg-card",
  bad: "bg-destructive text-white",
};

/**
 * "Phase progress": the six phases top to bottom, each with its mark (green check, amber ring, red !, grey
 * ring) and its detail line — the GM's PROGRES FASE — on every deal, open ones too. The phase the blocker
 * holds up carries the blocker text under it, so the problem sits where it belongs (owner, 9 Oct 2026).
 */
export function PhaseStepper({ deal, className }: { deal: PipelineDeal; className?: string }) {
  const { t } = useLang();
  const detail = usePhaseDetail();
  const blocker = deal.blocker?.trim();
  return (
    <section aria-label={t("Phase progress")} className={cn("rounded-xl border border-border px-3 py-3", className)}>
      <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{t("Phase progress")}</h3>
      <ol>
        {deal.phases.map((p, i) => {
          const last = i === deal.phases.length - 1;
          return (
            <li key={p.key} className="relative flex gap-3 pb-3 last:pb-0">
              {!last && <span aria-hidden className={cn("absolute left-[9px] top-6 bottom-0 w-0.5 rounded-full", p.state === "done" ? "bg-success/60" : "bg-border")} />}
              <span aria-hidden className={cn("relative mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-2xs font-bold", STEP_MARK[p.state])}>
                {p.state === "done" ? <Check className="h-3 w-3" strokeWidth={3} /> : p.state === "bad" ? "!" : null}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-5">
                  {t(PHASE_LABEL[p.key])}
                  <span className="sr-only">: {t(PHASE_STATE_LABEL[p.state])}</span>
                </p>
                <p className={cn("text-xs", p.state === "bad" ? "font-medium text-red-700 dark:text-red-300" : "text-muted-foreground")}>{detail(deal, p.key)}</p>
                {p.blocked && blocker && (
                  <p className="mt-1 flex items-start gap-1 text-xs font-semibold text-red-700 dark:text-red-300">
                    <AlertTriangle aria-hidden className="mt-px h-3 w-3 shrink-0" />
                    <span className="min-w-0 break-words">{blocker}</span>
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
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
  next.phases = phasesOf(next, today);
  return next;
}

/**
 * The deal's payment as every screen shows it (owner, 9 Oct 2026: "perlu per termin"): from its terms when
 * it has any, else the manual fields. `fromTerms` says which, so a manual field can be shown read-only.
 */
export function dealPayment(d: PipelineDeal): { fromTerms: boolean; status: string; outstanding: number; dueDate: string | null } {
  const s = d.termSummary;
  return s
    ? { fromTerms: true, status: s.paymentStatus, outstanding: s.outstanding, dueDate: s.nextDueDate }
    : { fromTerms: false, status: d.paymentStatus, outstanding: d.outstandingReceivable, dueDate: d.paymentDueDate };
}

/** A term status pill's colors: paid green, overdue red, partly paid / invoiced amber / blue. */
export const TERM_TONE: Record<TermStatus, string> = {
  Paid: "bg-success/15 text-emerald-800 dark:text-emerald-200",
  Overdue: "bg-destructive/10 text-red-800 dark:text-red-200",
  Partial: "bg-warning/15 text-amber-900 dark:text-amber-200",
  Invoiced: "bg-info/15 text-sky-900 dark:text-sky-200",
  "Not Invoiced": "bg-muted text-muted-foreground",
};
