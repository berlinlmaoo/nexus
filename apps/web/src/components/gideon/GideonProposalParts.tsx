import { GideonMark } from "./GideonMark";
import { useLang } from "@/lib/lang";

/** The buttons on every approval card (Notion AI: a quiet Discard, a solid Apply). */
export const PROPOSAL_DISCARD = "inline-flex h-7 items-center rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
export const PROPOSAL_APPLY = "inline-flex h-7 items-center gap-1 rounded-full px-3.5 text-xs font-semibold transition-colors bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50";

/**
 * The top of an approval card, Notion AI style: GIDEON's mark, what it wants to do, and whether it is
 * waiting for you.
 */
export function ProposalHead({ open, title, summary }: { open: boolean; title: string; summary: string }) {
  const { t } = useLang();
  return (
    <div className="flex items-start gap-2.5 px-3 pb-2 pt-2.5">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border bg-background"><GideonMark className="h-3.5 w-3.5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium" title={summary}>{open ? title : summary}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {open && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
          {open ? t("Waiting for your approval") : title}
        </span>
      </span>
    </div>
  );
}

/**
 * A row's day in the reader's language ("Fri 23 Oct" / "Jum 23 Okt"), keeping the WIB time the server put after it;
 * the server's English label when there is no day. (Same rule as the panel's change card.)
 */
export function diffDayText(label: string | null | undefined, day: string | null | undefined, locale: string): string | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return label ?? null;
  const d = new Date(`${day}T12:00:00Z`);
  const sameYear = day.slice(0, 4) === String(new Date().getFullYear());
  const text = d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" }).replace(/,/g, "");
  const time = label?.match(/\b\d{2}:\d{2}$/)?.[0];
  return time ? `${text} ${time}` : text;
}
