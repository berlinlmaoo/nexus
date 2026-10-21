import { AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { COLOR_PRESETS } from "@/lib/project-views";
import { useLang, type Lang } from "@/lib/lang";
import {
  daysOverdueOf,
  healthOf,
  marginOf,
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
import { formatRupiah, MINUS } from "@/lib/number-format";

/**
 * Shared bits of the Pipeline Dashboard (owner, 9 Oct 2026): money and date formats, the labels of the
 * GM's vocabulary, the health pill and the six-dot phase track. Stored values are the GM's English keys;
 * only what is shown is translated (id-pipeline.ts).
 */

/** Compact rupiah for cards and KPIs: Rp 950Jt / Rp 1,2M (id) or Rp 950M / Rp 1.2B (en) — the GM's fmtIDR. */
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
  return `${n < 0 ? MINUS : ""}Rp ${num}${s}`;
}

/**
 * Full rupiah: Rp 950.000.000 — always grouped the Indonesian way (dots), in both languages (pipeline UI
 * pass, 12 Oct 2026: "Rp1,000,000,000" in English read like dollars). `_lang` stays for the callers.
 */
export function fmtIdrFull(n: number | null | undefined, _lang?: Lang): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  return formatRupiah(n);
}

/** id-ID digit grouping (1.250.000), for every amount on the pipeline whatever the interface language. */
export const IDR_GROUPING = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/**
 * Sentence case for a label shown on screen (Notion-style labels, 12 Oct 2026): "Fully Executed" →
 * "Fully executed", "Waiting BAST" stays "Waiting BAST" (an all-caps word is an acronym), "N/A" stays.
 * Display only — the stored values are the GM's keys and never change.
 */
export function sentenceCase(s: string): string {
  if (!s) return s;
  let first = true;
  return s.replace(/[\p{L}][\p{L}'’]*/gu, (w) => {
    const out = first ? w : w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase();
    first = false;
    return out;
  });
}

export function fmtPct(p: number): string {
  return `${Math.round((p || 0) * 100)}%`;
}

/** Margin colour: red below zero, green above (the KPI strip's tones). */
export function marginTone(margin: number | null | undefined): string {
  if (margin === null || margin === undefined || margin === 0) return "";
  return margin < 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300";
}

/** "25%" / "-12%"; "–" without a net value. */
export function fmtMarginPct(p: number | null | undefined): string {
  return p === null || p === undefined || !Number.isFinite(p) ? "–" : `${Math.round(p * 100)}%`;
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
/** The English label of each contact role key (CONTACT_ROLES); translated with t(). */
const CONTACT_ROLE_LABEL: Record<string, string> = {
  Client: "Client", Vendor: "Vendor", Broker: "Broker", "PM (client side)": "PM (client side)", Finance: "Finance", Admin: "Admin", Other: "Other contact",
};

export function useVocabLabels() {
  const { t } = useLang();
  return {
    // Stage names are the GM's own wording: shown exactly as he wrote them (owner decision, 12 Oct 2026).
    stage: (k: string) => t(k),
    risk: (k: string) => sentenceCase(k === "Aman" ? t("On track") : t(k)),
    /** A status value of the GM's lists (contract, payment, closing …), as shown: sentence case. */
    status: (k: string | null | undefined) => (k ? sentenceCase(t(k)) : ""),
    link: (k: string) => (k === "Kontrak" ? t("Contract") : k === "Lainnya" ? t("Other link") : k === "SPK" ? t("SPK (Work Order)") : k === "Quotation" ? t("Quotation") : k === "Report" ? t("Report") : k),
    /** A project contact's role (v8): stored English keys, labelled per language. */
    contactRole: (k: string) => t(CONTACT_ROLE_LABEL[k] ?? k),
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

/**
 * Text + soft background per health, from the app's option palette (--st-*, the same nine Notion colours
 * as task status pills; both themes come from the tokens).
 */
export const HEALTH_TONE: Record<HealthKey, string> = {
  CRITICAL: "bg-[var(--st-red-bg)] text-[var(--st-red-fg)]",
  ATTENTION: "bg-[var(--st-yellow-bg)] text-[var(--st-yellow-fg)]",
  HEALTHY: "bg-[var(--st-green-bg)] text-[var(--st-green-fg)]",
  NOT_STARTED: "bg-[var(--st-gray-bg)] text-[var(--st-gray-fg)]",
  NONE: "bg-[var(--st-gray-bg)] text-[var(--st-gray-fg)]",
};

export const HEALTH_DOT: Record<HealthKey, string> = {
  CRITICAL: "bg-[var(--st-red-dot)]",
  ATTENTION: "bg-[var(--st-yellow-dot)]",
  HEALTHY: "bg-[var(--st-green-dot)]",
  NOT_STARTED: "bg-[var(--st-gray-dot)]",
  NONE: "bg-[var(--st-gray-dot)]",
};

/** Body text in a health's hue (a reason line, a late amount), readable on the card and the page. */
export const HEALTH_TEXT: Record<"CRITICAL" | "ATTENTION", string> = {
  CRITICAL: "text-red-700 dark:text-[var(--st-red-fg)]",
  ATTENTION: "text-amber-800 dark:text-[var(--st-yellow-fg)]",
};

export function HealthPill({ health, className }: { health: HealthKey; className?: string }) {
  const { t } = useLang();
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-medium leading-5", HEALTH_TONE[health], className)}>
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
  done: "bg-[var(--st-green-dot)]",
  active: "bg-[var(--st-yellow-dot)]",
  pending: "bg-border",
  bad: "bg-[var(--st-red-dot)]",
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
        return sentenceCase(deal.contractStatus);
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
        return sentenceCase(deal.deliverableStatus);
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
        return sentenceCase(deal.closingStatus);
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
        "flex items-start gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium",
        critical ? "bg-[var(--st-red-bg)] text-[var(--st-red-fg)]" : "bg-[var(--st-yellow-bg)] text-[var(--st-yellow-fg)]",
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
  done: "bg-[var(--st-green-dot)] text-white",
  active: "border-2 border-[var(--st-yellow-dot)] bg-card",
  pending: "border-2 border-border bg-card",
  bad: "bg-[var(--st-red-dot)] text-white",
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
    <section aria-label={t("Phase progress")} className={cn("rounded-lg border border-border px-3.5 py-3", className)}>
      <h3 className="mb-2.5 text-xs font-medium text-muted-foreground">{t("Phase progress")}</h3>
      <ol>
        {deal.phases.map((p, i) => {
          const last = i === deal.phases.length - 1;
          return (
            <li key={p.key} className="relative flex gap-3 pb-3 last:pb-0">
              {!last && <span aria-hidden className={cn("absolute left-[9px] top-6 bottom-0 w-0.5 rounded-full", p.state === "done" ? "bg-[var(--st-green-dot)]/60" : "bg-border")} />}
              <span aria-hidden className={cn("relative mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-2xs font-bold", STEP_MARK[p.state])}>
                {p.state === "done" ? <Check className="h-3 w-3" strokeWidth={3} /> : p.state === "bad" ? "!" : null}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-5">
                  {t(PHASE_LABEL[p.key])}
                  <span className="sr-only">: {t(PHASE_STATE_LABEL[p.state])}</span>
                </p>
                <p className={cn("text-xs", p.state === "bad" ? cn("font-medium", HEALTH_TEXT.CRITICAL) : "text-muted-foreground")}>{detail(deal, p.key)}</p>
                {p.blocked && blocker && (
                  <p className={cn("mt-1 flex items-start gap-1 text-xs font-medium", HEALTH_TEXT.CRITICAL)}>
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


/**
 * A stage group's colour, from the app's option palette (COLOR_PRESETS keys): the board's tinted columns
 * and pill headers, and every stage dot, share it — like a task board's status columns (12 Oct 2026).
 */
export const GROUP_COLOR: Record<StageGroup, "blue" | "orange" | "green" | "purple" | "gray"> = {
  Pipeline: "blue",
  "Pre-Execution": "orange",
  Execution: "green",
  Closed: "purple",
  Lost: "gray",
};

/** A stage group's dot (class), the same hue as its column. */
export const GROUP_TONE: Record<StageGroup, string> = {
  Pipeline: "bg-[var(--st-blue-dot)]",
  "Pre-Execution": "bg-[var(--st-orange-dot)]",
  Execution: "bg-[var(--st-green-dot)]",
  Closed: "bg-[var(--st-purple-dot)]",
  Lost: "bg-[var(--st-gray-dot)]",
};

/** A stage as a pill (the column header, the drawer header): tinted background, dot, sentence-case name. */
export function StagePill({ stage, className }: { stage: string; className?: string }) {
  const labels = useVocabLabels();
  const tone = COLOR_PRESETS[GROUP_COLOR[stageGroupOf(stage)] ?? "gray"];
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 rounded-full px-2 text-sm font-medium leading-6", className)} style={{ backgroundColor: tone.bg, color: tone.text }}>
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tone.dot }} />
      <span className="truncate">{labels.stage(stage)}</span>
    </span>
  );
}

/** "Name" of a deal's BD or PM: the NEXUS user, else the free text, else null. */
/**
 * The company (board) a deal is on, shown on every deal of All Pipelines (owner, 21 Oct 2026). Nothing on a
 * single board, where `source` is absent.
 */
export function SourceChip({ deal, className }: { deal: Pick<PipelineDeal, "source">; className?: string }) {
  if (!deal.source?.name) return null;
  // Every board is "Pipeline <Company>": the chip says the company, the full name is its tooltip.
  const short = deal.source.name.replace(/^pipeline\s+/i, "").trim() || deal.source.name;
  return (
    <span title={deal.source.name} className={cn("inline-flex max-w-full min-w-0 items-center rounded-full bg-primary/10 px-2 text-[11px] font-medium leading-5 text-primary", className)}>
      <span className="truncate">{short}</span>
    </span>
  );
}

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
  // Real cost & margin (14 Oct 2026): follow the lines and the net value at once, as the server will.
  const m = marginOf(next);
  next.costTotal = m.totalCost;
  next.margin = m.margin;
  next.marginPct = m.marginPct;
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

/** A term status pill's colours (option palette): paid green, overdue red, partly paid yellow, invoiced blue. */
export const TERM_TONE: Record<TermStatus, string> = {
  Paid: "bg-[var(--st-green-bg)] text-[var(--st-green-fg)]",
  Overdue: "bg-[var(--st-red-bg)] text-[var(--st-red-fg)]",
  Partial: "bg-[var(--st-yellow-bg)] text-[var(--st-yellow-fg)]",
  Invoiced: "bg-[var(--st-blue-bg)] text-[var(--st-blue-fg)]",
  "Not Invoiced": "bg-[var(--st-gray-bg)] text-[var(--st-gray-fg)]",
};
