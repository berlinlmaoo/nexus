import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang, type Lang } from "@/lib/lang";
import type { Bilingual, OutletEvent, OutletForm, OutletItem, OutletReportConfig, OutletStatus } from "@/lib/outlet-sales-api";
import { formatCount, formatRupiah } from "@/lib/number-format";

/**
 * Shared bits of the Outlet Sales Dashboard (owner, 10 Oct 2026, for Ryan): number and date formats in
 * Ryan's shape ("Rp 8.000.000 / Rp 20.000.000 (40%)", "Minggu 4 Okt"), the status pill, the month
 * switcher, and the event's detail as Ryan listed it. Labels of the form come from the server (`form`).
 */

// id-ID grouping in both languages (12 Oct 2026: "Rp100,000,000" in English read like dollars), and a
// space after "Rp" like every other amount in the app (UI tour run 13, W-B2). `_lang` stays for the callers.

/** "Rp 8.000.000", in both languages. "—" for nothing filled. */
export function rupiah(n: number | null | undefined, _lang: Lang): string {
  if (n === null || n === undefined) return "—";
  return formatRupiah(n);
}

/** "3.000". "—" for nothing filled. */
export function count(n: number | null | undefined, _lang: Lang): string {
  if (n === null || n === undefined) return "—";
  return formatCount(n);
}

/**
 * Ryan's "actual / target (pct%)": "Rp 8.000.000 / Rp 20.000.000 (40%)". No target → the actual alone;
 * a target but nothing filled → "— / Rp 20.000.000". pct comes from the server (rounded down).
 */
export function vsTarget(actual: number | null, target: number | null, pct: number | null, fmt: (n: number | null) => string): string {
  if (target === null || target === undefined) return fmt(actual);
  return `${fmt(actual)} / ${fmt(target)}${pct !== null ? ` (${pct}%)` : ""}`;
}

function dateOf(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/**
 * "Minggu 4 Okt" / "Sunday 4 Oct" — Ryan's Hari/Tanggal and the day headers, in the app's one day-header
 * format (UI tour run 13: "Wednesday 14 Oct", no comma, short month, as the Calendar). The year only when
 * it is not this one.
 */
export function dayLong(iso: string, locale: string, thisYear?: string): string {
  const d = dateOf(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const weekday = d.toLocaleDateString(locale, { weekday: "long" });
  const dm = d.toLocaleDateString(locale, { day: "numeric", month: "short" }).replace(/\.$/, "");
  const year = thisYear && iso.slice(0, 4) !== thisYear ? ` ${iso.slice(0, 4)}` : "";
  return `${weekday} ${dm}${year}`;
}

/** "Min, 4 Okt" / "Sun, 4 Oct" — on a card. */
export function dayShort(iso: string, locale: string): string {
  const d = dateOf(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString(locale, { weekday: "short" })}, ${d.toLocaleDateString(locale, { day: "numeric", month: "short" })}`;
}

/** "Oktober 2026" / "October 2026". */
export function monthLabel(month: string, locale: string): string {
  return dateOf(`${month}-01`).toLocaleDateString(locale, { month: "long", year: "numeric" });
}

export function shiftMonthKey(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * A night's report opens on the night itself (WIB), as the server's rule (lib/outlet-sales.ts reportOpen;
 * UI tour run 13, W-B5): "YYYY-MM-DD" strings compare as dates.
 */
export function reportOpen(date: string, today: string): boolean {
  return date <= today;
}

/** The company's day (WIB) on this device's clock, until the server's `today` has arrived. */
export function wibToday(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

// ── The outlet's own breakdown (owner, 14 Oct 2026) ──

const LEGACY_IDS = ["rsvpWalkIn", "rsvpTeam", "rsvpPr", "rsvpEo", "hostingTeam", "hostingPr", "hostingEo"] as const;
const LEGACY_LABELS: Record<string, string> = {
  rsvpWalkIn: "Walk-in RSVP", rsvpTeam: "RSVP Team", rsvpPr: "RSVP PR", rsvpEo: "RSVP EO",
  hostingTeam: "Hosting Team", hostingPr: "Hosting PR", hostingEo: "Hosting EO",
};

/** The original seven items, for an answer that has no `config` (a server older than this client). */
export function defaultOutletConfig(): OutletReportConfig {
  return {
    version: 1,
    rsvp: LEGACY_IDS.slice(0, 4).map((id) => ({ id, label: LEGACY_LABELS[id] })),
    hosting: LEGACY_IDS.slice(4).map((id) => ({ id, label: LEGACY_LABELS[id] })),
    communities: [],
  };
}

/** One breakdown figure of a report by item id; the original items also from their old keys. */
export function figureOf(event: OutletEvent | null | undefined, id: string): number | null {
  if (!event) return null;
  const v = event.values?.[id];
  if (typeof v === "number") return v;
  if ((LEGACY_IDS as readonly string[]).includes(id)) {
    const old = (event as unknown as Record<string, unknown>)[id];
    return typeof old === "number" ? old : null;
  }
  return null;
}

/** The items a report shows: the active ones, and an archived one only when this report has a figure for it. */
export function visibleItems(items: OutletItem[], event: OutletEvent | null | undefined): OutletItem[] {
  return items.filter((i) => !i.archived || figureOf(event, i.id) !== null);
}

/** The sum of what was filled; null when nothing was (the server's sumFilled). */
export function sumOf(values: (number | null | undefined)[]): number | null {
  let any = false;
  let total = 0;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    any = true;
    total += v;
  }
  return any ? total : null;
}

export function pick(b: Bilingual | undefined, lang: Lang): string {
  if (!b) return "";
  return lang === "en" ? b.en : b.id;
}

export const STATUS_ORDER: OutletStatus[] = ["UPCOMING", "WAITING_REPORT", "REPORTED"];
export const STATUS_LABEL: Record<OutletStatus, string> = {
  UPCOMING: "Upcoming",
  WAITING_REPORT: "Waiting report",
  REPORTED: "Reported",
};
/** The status dot: quiet for what is ahead, amber for what is owed, green for done. */
export const STATUS_DOT: Record<OutletStatus, string> = {
  UPCOMING: "bg-sky-500",
  WAITING_REPORT: "bg-amber-500",
  REPORTED: "bg-emerald-500",
};

export function StatusPill({ status, className }: { status: OutletStatus; className?: string }) {
  const { t } = useLang();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        status === "WAITING_REPORT"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200"
          : status === "REPORTED"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
            : "border-border bg-card text-muted-foreground",
        className,
      )}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
      {t(STATUS_LABEL[status])}
    </span>
  );
}

/** ‹ Oktober 2026 › with "This month" when another month is shown. */
export function MonthSwitcher({ month, today, onChange }: { month: string; today: string; onChange: (m: string) => void }) {
  const { t, locale } = useLang();
  const current = today.slice(0, 7);
  const btn = "grid h-9 w-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:h-11 pointer-coarse:w-11";
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={btn} onClick={() => onChange(shiftMonthKey(month, -1))} aria-label={t("Previous month")}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <h2 className="min-w-[9.5rem] text-center text-base font-semibold capitalize tabular-nums" aria-live="polite">{monthLabel(month, locale)}</h2>
      <button type="button" className={btn} onClick={() => onChange(shiftMonthKey(month, 1))} aria-label={t("Next month")}>
        <ChevronRight className="h-4 w-4" />
      </button>
      {month !== current && (
        <button
          type="button"
          onClick={() => onChange(current)}
          className="ml-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[40px]"
        >
          {t("This month")}
        </button>
      )}
    </div>
  );
}

/**
 * What a calendar cell's small marks mean, in one line under the grid, drawn with the same glyphs as the
 * cells (UI tour run 13, W-B11: the target ring, the note mark and the dots had no key).
 */
export function MarkerLegend({ items }: { items: { mark: ReactNode; label: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-flex items-center">{i.mark}</span>
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** A bar for "how much of the target": capped at full, green once the target is reached. */
export function Meter({ pct, label }: { pct: number | null; label: string }) {
  const value = pct === null ? 0 : Math.min(100, pct);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct === null ? undefined : value}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-300 ease-out", pct !== null && pct >= 100 ? "bg-emerald-500" : "bg-primary")}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

/**
 * One label and its value. Figures sit in one right-aligned column whatever their depth: a part is indented
 * by its label only, so its number lines up under its total's (UI tour run 13, W-B13).
 */
function Row({ label, children, strong, depth = 0, text }: { label: string; children: ReactNode; strong?: boolean; depth?: 0 | 1 | 2; text?: boolean; besideFigures?: boolean }) {
  // A written answer goes under its question, so the one value column stays the right-aligned figures
  // (UI tour run 14, R14-WM-13: "Not filled" sat left-aligned in the middle of that column on a phone). The
  // wide card does the same now (UI tour run 15, R15-WD-2: beside the figures the answers were the only
  // values not on the right edge).
  return (
    <div className={cn("grid gap-x-3 py-1.5 text-sm", text ? "grid-cols-1 gap-y-0.5" : "grid-cols-[minmax(7.5rem,40%)_1fr]")}>
      <dt className={cn("text-muted-foreground", depth === 1 && "pl-3", depth === 2 && "pl-6", strong && "font-medium text-foreground")}>{label}</dt>
      <dd className={cn("min-w-0 break-words tabular-nums", !text && "text-right", text && depth === 1 && "pl-3", text && depth === 2 && "pl-6", strong && "font-semibold")}>{children}</dd>
    </div>
  );
}

function Answer({ text }: { text: string }) {
  const { t } = useLang();
  return text ? <span className="whitespace-pre-wrap">{text}</span> : <span className="text-muted-foreground/70">{t("Not filled")}</span>;
}

/**
 * One event exactly as Ryan listed it: Nama event, Hari/Tanggal, Sales, Pax, RSVP total and its four
 * parts, Hosting total and its three, Hal yang berhasil (Apa / Kenapa berhasil / Gimana biar bisa
 * terulang lagi), Hal yang gagal (Apa / Kenapa gagal / Gimana biar tidak kejadian lagi). Labels from the
 * server's form, in the interface language.
 */
export function EventDetail({
  event, form, config, today, onEdit, wide,
}: {
  event: OutletEvent; form: OutletForm; config?: OutletReportConfig; today: string; onEdit?: () => void;
  /** The only event of its day on a wide panel: the figures and the stories side by side (W-D17). */
  wide?: boolean;
}) {
  const { t, lang, locale } = useLang();
  const cfg = config ?? defaultOutletConfig();
  const fields = new Map(form.sections.flatMap((s) => s.fields).map((f) => [f.key, f]));
  const label = (key: string, fallback: string) => pick(fields.get(key as never)?.label, lang) || fallback;
  const section = (key: string) => form.sections.find((s) => s.key === key);
  const money = (n: number | null) => rupiah(n, lang);
  const num = (n: number | null) => count(n, lang);
  const total = (key: "rsvp" | "hosting") => {
    const items = visibleItems(key === "rsvp" ? cfg.rsvp : cfg.hosting, event);
    const value = key === "rsvp" ? event.rsvpTotal : event.hostingTotal;
    // "RSVP total", sentence case like the Overview's (the server's form still says "RSVP – TOTAL").
    return (
      <dl className="border-t border-border/70 py-1">
        <Row label={key === "rsvp" ? t("RSVP total") : t("Hosting total")} strong>{num(value)}</Row>
        {items.map((i) => (
          <Row key={i.id} depth={1} label={i.archived ? `${i.label} · ${t("archived")}` : i.label}>{num(figureOf(event, i.id))}</Row>
        ))}
      </dl>
    );
  };
  const communities = () => {
    const list = cfg.communities.filter((c) => !c.archived || event.communityTotals?.[c.id] != null);
    if (list.length === 0) return null;
    return (
      <dl className="border-t border-border/70 py-1">
        <Row label={t("Communities total")} strong>{num(event.communityTotal ?? null)}</Row>
        {list.map((c) => {
          const subs = visibleItems(c.items, event);
          const own = figureOf(event, c.id);
          return (
            <div key={c.id}>
              <Row depth={1} label={c.archived ? `${c.name} · ${t("archived")}` : c.name} strong={c.mode === "breakdown" && subs.length > 0}>
                {num(event.communityTotals?.[c.id] ?? null)}
              </Row>
              {c.mode === "breakdown" && subs.map((i) => <Row key={i.id} depth={2} label={i.archived ? `${i.label} · ${t("archived")}` : i.label}>{num(figureOf(event, i.id))}</Row>)}
              {c.mode === "breakdown" && own !== null && <Row depth={2} label={t("Total only")}>{num(own)}</Row>}
            </div>
          );
        })}
      </dl>
    );
  };
  const story = (key: "success" | "fail") => {
    const s = section(key);
    if (!s) return null;
    return (
      <div className="border-t border-border/70 py-1">
        <p className="pt-1.5 text-sm font-medium">{pick(s.title, lang)}</p>
        <dl>
          {s.fields.map((f) => <Row key={f.key} depth={1} text besideFigures={wide} label={pick(f.label, lang)}><Answer text={String(event[f.key] ?? "")} /></Row>)}
        </dl>
      </div>
    );
  };
  const who = event.reportedBy ?? event.updatedBy;
  // A night after today: its report opens on the night itself (W-B5).
  const notYet = !reportOpen(event.date, today);
  const hasReport = event.status === "REPORTED" || event.rsvpTotal != null || event.hostingTotal != null;
  const captionId = `os-not-yet-${event.id}`;
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <header className="mb-1 flex items-start justify-between gap-3">
        <StatusPill status={event.status} />
        {onEdit && (
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={onEdit}
              disabled={notYet}
              aria-describedby={notYet ? captionId : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-[opacity,transform] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 pointer-coarse:min-h-[44px]",
                event.status === "REPORTED" || notYet ? "border border-border bg-background enabled:hover:bg-muted" : "bg-primary text-primary-foreground hover:opacity-90",
              )}
            >
              <PencilLine aria-hidden className="h-4 w-4" />
              {event.status === "REPORTED" ? t("Edit report") : t("Fill report")}
            </button>
            {notYet && <p id={captionId} className="text-right text-xs text-muted-foreground">{t("Reports open on the night itself.")}</p>}
          </div>
        )}
      </header>
      {/* Name, date, sales and pax always; the rest once something is reported. A night with nothing reported says
          so in one line instead of ~20 rows of "—" and "Not filled", as the apps do (UI tour run 15, iPad Q-IB20). */}
      <div className={cn(wide && hasReport && "lg:grid lg:grid-cols-2 lg:gap-x-8")}>
        <div className="min-w-0">
          <dl>
            <Row label={label("name", "Event name")}><span className="font-semibold">{event.name}</span></Row>
            {/* "Date", not the form question's "Day/Date": the answer is one date (iPhone run 14 N-28). */}
            <Row label={t("Date")}>{dayLong(event.date, locale, today.slice(0, 4))}</Row>
            <Row label={label("sales", "Sales")}>{vsTarget(event.sales, event.salesTarget, event.salesPct, money)}</Row>
            <Row label={label("pax", "Pax")}>{vsTarget(event.pax, event.paxTarget, event.paxPct, num)}</Row>
          </dl>
          {hasReport && total("rsvp")}
          {hasReport && total("hosting")}
          {hasReport && communities()}
          {!hasReport && !notYet && <p className="pt-2 text-sm text-muted-foreground">{t("No report yet. Fill report to add the figures.")}</p>}
        </div>
        {hasReport && (
          <div className="min-w-0">
            {story("success")}
            {story("fail")}
          </div>
        )}
      </div>
      {who && (
        <p className="mt-2 border-t border-border/70 pt-2 text-xs text-muted-foreground">
          {event.reportedBy
            ? t("Reported by {name}", { name: event.reportedBy.name ?? "?" })
            : t("Last changed by {name}", { name: who.name ?? "?" })}
          {" · "}
          {new Date(event.reportedBy && event.reportedAt ? event.reportedAt : event.updatedAt).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </p>
      )}
    </article>
  );
}
