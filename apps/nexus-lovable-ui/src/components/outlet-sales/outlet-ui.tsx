import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang, type Lang } from "@/lib/lang";
import type { Bilingual, OutletEvent, OutletForm, OutletStatus } from "@/lib/outlet-sales-api";

/**
 * Shared bits of the Outlet Sales Dashboard (owner, 10 Oct 2026, for Ryan): number and date formats in
 * Ryan's shape ("Rp8.000.000 / Rp20.000.000 (40%)", "Minggu, 4 Oktober"), the status pill, the month
 * switcher, and the event's detail as Ryan listed it. Labels of the form come from the server (`form`).
 */

// id-ID grouping in both languages (12 Oct 2026: "Rp100,000,000" in English read like dollars).
const nf = (_lang: Lang) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/** "Rp8.000.000", in both languages. "—" for nothing filled. */
export function rupiah(n: number | null | undefined, lang: Lang): string {
  if (n === null || n === undefined) return "—";
  return `Rp${nf(lang).format(Math.round(n))}`;
}

/** "3.000". "—" for nothing filled. */
export function count(n: number | null | undefined, lang: Lang): string {
  if (n === null || n === undefined) return "—";
  return nf(lang).format(n);
}

/**
 * Ryan's "actual / target (pct%)": "Rp8.000.000 / Rp20.000.000 (40%)". No target → the actual alone;
 * a target but nothing filled → "— / Rp20.000.000". pct comes from the server (rounded down).
 */
export function vsTarget(actual: number | null, target: number | null, pct: number | null, fmt: (n: number | null) => string): string {
  if (target === null || target === undefined) return fmt(actual);
  return `${fmt(actual)} / ${fmt(target)}${pct !== null ? ` (${pct}%)` : ""}`;
}

function dateOf(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/** "Minggu, 4 Oktober" / "Sunday, 4 October" — Ryan's Hari/Tanggal. The year only when it is not this one. */
export function dayLong(iso: string, locale: string, thisYear?: string): string {
  const d = dateOf(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const weekday = d.toLocaleDateString(locale, { weekday: "long" });
  const dm = d.toLocaleDateString(locale, { day: "numeric", month: "long" });
  const year = thisYear && iso.slice(0, 4) !== thisYear ? ` ${iso.slice(0, 4)}` : "";
  return `${weekday}, ${dm}${year}`;
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

/** The company's day (WIB) on this device's clock, until the server's `today` has arrived. */
export function wibToday(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
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

function Row({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(7.5rem,40%)_1fr] gap-x-3 py-1.5 text-sm">
      <dt className={cn("text-muted-foreground", strong && "font-medium text-foreground")}>{label}</dt>
      <dd className={cn("min-w-0 break-words tabular-nums", strong && "font-semibold")}>{children}</dd>
    </div>
  );
}

function Answer({ text }: { text: string }) {
  const { t } = useLang();
  return text ? <span className="whitespace-pre-wrap">{text}</span> : <span className="text-muted-foreground/70">{t("Not filled")}</span>;
}

/**
 * One event exactly as Ryan listed it: Nama event, Hari/Tanggal, Sales, Pax, RSVP – TOTAL and its four
 * parts, HOSTING – TOTAL and its three, Hal yang berhasil (Apa / Kenapa berhasil / Gimana biar bisa
 * terulang lagi), Hal yang gagal (Apa / Kenapa gagal / Gimana biar tidak kejadian lagi). Labels from the
 * server's form, in the interface language.
 */
export function EventDetail({ event, form, today, onEdit }: { event: OutletEvent; form: OutletForm; today: string; onEdit?: () => void }) {
  const { t, lang, locale } = useLang();
  const fields = new Map(form.sections.flatMap((s) => s.fields).map((f) => [f.key, f]));
  const label = (key: string, fallback: string) => pick(fields.get(key as never)?.label, lang) || fallback;
  const section = (key: string) => form.sections.find((s) => s.key === key);
  const money = (n: number | null) => rupiah(n, lang);
  const num = (n: number | null) => count(n, lang);
  const total = (key: "rsvp" | "hosting") => {
    const s = section(key);
    if (!s) return null;
    const value = key === "rsvp" ? event.rsvpTotal : event.hostingTotal;
    return (
      <div className="border-t border-border/70 py-1">
        <Row label={pick(s.title, lang)} strong>{num(value)}</Row>
        <dl className="pl-3">
          {s.fields.map((f) => <Row key={f.key} label={pick(f.label, lang)}>{num(event[f.key] as number | null)}</Row>)}
        </dl>
      </div>
    );
  };
  const story = (key: "success" | "fail") => {
    const s = section(key);
    if (!s) return null;
    return (
      <div className="border-t border-border/70 py-1">
        <p className="pt-1.5 text-sm font-medium">{pick(s.title, lang)}</p>
        <dl className="pl-3">
          {s.fields.map((f) => <Row key={f.key} label={pick(f.label, lang)}><Answer text={String(event[f.key] ?? "")} /></Row>)}
        </dl>
      </div>
    );
  };
  const who = event.reportedBy ?? event.updatedBy;
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <header className="mb-1 flex items-start justify-between gap-3">
        <StatusPill status={event.status} />
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-[opacity,transform] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-[44px]",
              event.status === "REPORTED" ? "border border-border bg-background hover:bg-muted" : "bg-primary text-primary-foreground hover:opacity-90",
            )}
          >
            <PencilLine aria-hidden className="h-4 w-4" />
            {event.status === "REPORTED" ? t("Edit report") : t("Fill report")}
          </button>
        )}
      </header>
      <dl>
        <Row label={label("name", "Event name")}><span className="font-semibold">{event.name}</span></Row>
        <Row label={label("date", "Day/Date")}>{dayLong(event.date, locale, today.slice(0, 4))}</Row>
        <Row label={label("sales", "Sales")}>{vsTarget(event.sales, event.salesTarget, event.salesPct, money)}</Row>
        <Row label={label("pax", "Pax")}>{vsTarget(event.pax, event.paxTarget, event.paxPct, num)}</Row>
      </dl>
      {total("rsvp")}
      {total("hosting")}
      {story("success")}
      {story("fail")}
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
