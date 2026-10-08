// A small muted "Left · 10 Oct" / "Keluar · 10 Okt" next to someone who left the workspace (offboarding,
// owner 8 Oct 2026). The recaps — attendance board, deductions, Reports per crew, the member record —
// still list them for the periods they were part of, and say so with `leftAt` on the person.
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

/**
 * `leftAt` of a person object from those responses ("YYYY-MM-DD" or ISO), or null. Read loosely on
 * purpose: the field is additive and rides on several existing types (history user, roster row, report
 * person) without each of them having to declare it.
 */
export function leftAtOf(person: unknown): string | null {
  if (!person || typeof person !== "object") return null;
  const value = (person as { leftAt?: unknown }).leftAt;
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value : null;
}

/**
 * `leftAt` is the last working day, an attendance date (00:00 UTC of the Jakarta day), so it is
 * formatted in UTC — in the browser's own zone a viewer west of UTC would see the day before.
 */
export function LeftTag({ leftAt, className }: { leftAt?: string | null; className?: string }) {
  const { t, locale } = useLang();
  if (!leftAt) return null;
  const date = new Date(`${leftAt.slice(0, 10)}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <span
      title={t("Left the workspace — last working day {date}", { date })}
      className={cn("inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground", className)}
    >
      {t("Left · {date}", { date })}
    </span>
  );
}
