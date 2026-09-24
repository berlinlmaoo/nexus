// Formatting + period helpers for "Reports per crew". Kept pure so the web and the iOS build show the
// SAME numbers: one decimal at most (multi-assignee tasks are split, so 2.5 happens), ".0" dropped,
// percentages rounded to whole points, and a ratio with no denominator shown as "—" rather than 0%.
import { ApiError, type ReportRatio } from "@/lib/nexus-api";

export const REPORT_TIMEZONE = "Asia/Jakarta";
const CUTOFF_DAY = 27; // attendance period = 28th of the previous month → 27th of the key's month

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 2 → "2", 2.5 → "2.5", 2.04 → "2", 1020 → "1,020", null → "—". */
export function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const r = Math.round(n * 10) / 10;
  return (r === 0 ? 0 : r).toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** Whole-point percentage, or null when there is nothing to divide by. */
export function ratioPct(r: ReportRatio | null | undefined): number | null {
  if (!r || !r.den) return null;
  return Math.round((r.num / r.den) * 100);
}

export function fmtPct(r: ReportRatio | null | undefined): string {
  const p = ratioPct(r);
  return p == null ? "—" : `${p}%`;
}

export function fmtRatio(r: ReportRatio | null | undefined): string {
  if (!r || !r.den) return "no data";
  return `${fmtNum(r.num)}/${fmtNum(r.den)}`;
}

/** Minutes as hours with one decimal, like iOS: 492 → "8.2 h", null → "—". */
export function fmtHours(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  return `${fmtNum(minutes / 60)} h`;
}

export function fmtDays(d: number | null | undefined): string {
  if (d == null || !Number.isFinite(d)) return "—";
  return `${fmtNum(d)}d`;
}

const jakartaDay = new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** "2026-09-12" stays as is; a full ISO instant becomes the office-clock (WIB) day it falls on. */
export function toDayKey(s: string | null | undefined): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : jakartaDay.format(d);
}

/** "2026-09-12" (or an ISO instant, read on the office clock) → "12 Sep". */
export function fmtDayKey(raw: string | null | undefined, withYear = false): string {
  const key = toDayKey(raw);
  if (!key) return raw || "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  if (!m) return key;
  const label = `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
  return withYear ? `${label} ${m[1]}` : label;
}

/** "28 Aug – 27 Sep" for a period the server returned. The last day is from + (days − 1): the
 *  contract doesn't pin down whether `to` is the last day or the instant after it; `days` is. */
export function periodRangeLabel(p: { from: string; to: string; days: number } | null | undefined): string | null {
  if (!p) return null;
  const fromKey = toDayKey(p.from);
  const m = fromKey ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromKey) : null;
  if (!m) return null;
  let endKey = p.to;
  if (p.days >= 1) {
    const end = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + p.days - 1));
    endKey = end.toISOString().slice(0, 10);
  }
  return `${fmtDayKey(p.from)} – ${fmtDayKey(endKey)}`;
}

function todayKey(): string {
  return jakartaDay.format(new Date()); // en-CA formats as YYYY-MM-DD
}

/** The attendance period ("YYYY-MM", 28→27) that today falls in, on the office clock. */
export function currentPeriodKey(): string {
  const [y, m, d] = todayKey().split("-").map(Number);
  let year = y;
  let month = m;
  if (d > CUTOFF_DAY) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

function shiftKey(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** "2026-09" → "28 Aug – 27 Sep" (years added when the period is not in the current year). */
export function periodLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const startMonth = m === 1 ? 12 : m - 1;
  const startYear = m === 1 ? y - 1 : y;
  const thisYear = Number(currentPeriodKey().slice(0, 4));
  const showYear = startYear !== thisYear || y !== thisYear;
  const from = `${CUTOFF_DAY + 1} ${MONTHS[startMonth - 1]}${showYear ? ` ${startYear}` : ""}`;
  const to = `${CUTOFF_DAY} ${MONTHS[m - 1]}${showYear ? ` ${y}` : ""}`;
  return `${from} – ${to}`;
}

/** Current period + the 5 before it, newest first. */
export function periodOptions(): { key: string; label: string; isCurrent: boolean }[] {
  const cur = currentPeriodKey();
  return Array.from({ length: 6 }, (_, i) => {
    const key = shiftKey(cur, -i);
    return { key, label: periodLabel(key), isCurrent: i === 0 };
  });
}

export function isPeriodKey(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** The `code` a 403 carries (REPORT_OUT_OF_SCOPE / REPORT_SELF_ONLY), if any. */
export function reportErrorCode(e: unknown): string | null {
  if (e instanceof ApiError && e.payload && typeof e.payload === "object" && "code" in e.payload) {
    const code = (e.payload as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

export function reportErrorStatus(e: unknown): number | null {
  return e instanceof ApiError ? e.status : null;
}

/** Don't hammer the server on 4xx (scope / bad period / not found) — those won't fix themselves. */
export function reportRetry(count: number, e: unknown): boolean {
  if (e instanceof ApiError && e.status >= 400 && e.status < 500) return false;
  return count < 2;
}

export const ROLE_LABEL: Record<string, string> = { ONE_ABOVE_ALL: "One Above All", BOD: "BoD", MANAGER: "Manager", STAFF: "Staff" };

/** Search params shared by /reports and /reports/$userId. */
export type ReportsSearch = { period?: string; tab?: "me" | "team" };

/** Plain-English message for a failed report request. */
export function errorMessage(e: unknown): string {
  const code = reportErrorCode(e);
  if (code === "REPORT_OUT_OF_SCOPE") return "This report is outside what you can see. Managers see their direct reports; BoD sees everyone.";
  if (code === "REPORT_SELF_ONLY") return "You can only see your own report.";
  const status = reportErrorStatus(e);
  if (status === 401) return "Your session has ended. Sign in again to see reports.";
  if (status === 400) return "That period isn't valid. Pick another one from the list.";
  if (status === 404) return "We couldn't find that person in this workspace.";
  return e instanceof Error && e.message ? e.message : "Something went wrong. Try again in a moment.";
}
