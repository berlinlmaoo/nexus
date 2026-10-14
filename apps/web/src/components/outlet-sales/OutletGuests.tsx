import { useState } from "react";
import { ChevronRight, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { EmptyAction, EmptyState } from "@/components/EmptyState";
import type { OutletGuestLine, OutletGuests } from "@/lib/outlet-sales-api";
import { count, monthLabel } from "./outlet-ui";

/**
 * The Overview's Guest overview (owner, 14 Oct 2026, after a meeting with Ryan): for the month shown, RSVP
 * total with its items, Hosting total with its items, and Communities — the grand total and each
 * community's, a Breakdown community opening onto its own items. The numbers are the server's
 * (summarizeGuests in lib/outlet-sales.ts); the items and their order are the outlet's Report settings.
 * It replaces the old counts strip and the month's event list.
 */
export function GuestOverview({
  guests, month, onFill, canSetup, onSetup,
}: {
  guests: OutletGuests;
  month: string;
  onFill: () => void;
  canSetup: boolean;
  onSetup: () => void;
}) {
  const { t, tn, locale } = useLang();
  const monthName = monthLabel(month, locale);
  if (guests.reportCount === 0) {
    return (
      <section aria-labelledby="os-guests" className="rounded-xl border border-border bg-card">
        <h3 id="os-guests" className="border-b border-border px-4 py-3 text-sm font-semibold">{t("Guests · {month}", { month: monthName })}</h3>
        <EmptyState
          icon={Users}
          compact
          title={t("No guest numbers for {month} yet", { month: monthName })}
          message={t("They come from each night's report. Fill one in and RSVP, hosting and community totals add up here.")}
          action={
            <>
              <EmptyAction onClick={onFill}>{t("Fill a report")}</EmptyAction>
              {canSetup && (
                <button
                  type="button"
                  onClick={onSetup}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[44px]"
                >
                  {t("Report settings")}
                </button>
              )}
            </>
          }
        />
      </section>
    );
  }
  return (
    <section aria-labelledby="os-guests" className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-3">
        <h3 id="os-guests" className="text-sm font-semibold">{t("Guests · {month}", { month: monthName })}</h3>
        <p className="text-xs text-muted-foreground">{tn(guests.reportCount, "From 1 report", "From {n} reports")}</p>
      </header>
      <div className="grid divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
        <Group title={t("RSVP total")} total={guests.rsvp.total} lines={guests.rsvp.items} empty={t("No RSVP items. Add them in Report settings.")} />
        <Group title={t("Hosting total")} total={guests.hosting.total} lines={guests.hosting.items} empty={t("No hosting items. Add them in Report settings.")} />
        <Communities guests={guests} />
      </div>
    </section>
  );
}

function Group({ title, total, lines, empty }: { title: string; total: number; lines: OutletGuestLine[]; empty: string }) {
  const { lang } = useLang();
  return (
    <div className="flex min-w-0 flex-col gap-3 p-4">
      <Total title={title} value={count(total, lang)} />
      {lines.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lines.map((l) => <Line key={l.id} line={l} of={total} />)}
        </ul>
      )}
    </div>
  );
}

function Total({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <p className="mt-0.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
    </div>
  );
}

/** One item: its name and figure, and a hairline showing its share of the group. */
function Line({ line, of, inset }: { line: OutletGuestLine; of: number; inset?: boolean }) {
  const { t, lang } = useLang();
  const share = of > 0 ? Math.round((line.total * 100) / of) : 0;
  return (
    <li className={cn("min-w-0", inset && "pl-5")}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={cn("min-w-0 truncate", line.archived && "text-muted-foreground")}>
          {line.label}
          {line.archived && <span className="ml-1.5 text-xs text-muted-foreground">· {t("archived")}</span>}
        </span>
        <span className="shrink-0 font-medium tabular-nums">{count(line.total, lang)}</span>
      </div>
      <div aria-hidden className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary/40 transition-[width] duration-300 ease-out" style={{ width: `${share}%` }} />
      </div>
    </li>
  );
}

function Communities({ guests }: { guests: OutletGuests }) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const list = guests.communities.items;
  const total = guests.communities.total;
  return (
    <div className="flex min-w-0 flex-col gap-3 p-4">
      <Total title={t("Communities")} value={count(total, lang)} />
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("No communities yet. Add the ones that come in Report settings.")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((c) => {
            const expandable = c.mode === "breakdown" && c.items.length > 0;
            const isOpen = !!open[c.id];
            const share = total > 0 ? Math.round((c.total * 100) / total) : 0;
            return (
              <li key={c.id} className="min-w-0">
                {expandable ? (
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))}
                    className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-baseline justify-between gap-3 rounded-md px-1.5 py-0.5 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[40px] pointer-coarse:items-center"
                  >
                    <span className={cn("flex min-w-0 items-center gap-1", c.archived && "text-muted-foreground")}>
                      <ChevronRight aria-hidden className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150", isOpen && "rotate-90")} />
                      <span className="truncate">{c.name}</span>
                      {c.archived && <span className="text-xs text-muted-foreground">· {t("archived")}</span>}
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">{count(c.total, lang)}</span>
                  </button>
                ) : (
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className={cn("min-w-0 truncate", c.archived && "text-muted-foreground")}>
                      {c.name}
                      {c.archived && <span className="ml-1.5 text-xs text-muted-foreground">· {t("archived")}</span>}
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">{count(c.total, lang)}</span>
                  </div>
                )}
                <div aria-hidden className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary/40 transition-[width] duration-300 ease-out" style={{ width: `${share}%` }} />
                </div>
                {expandable && isOpen && (
                  <ul className="mt-2 flex flex-col gap-2">
                    {c.items.map((i) => <Line key={i.id} line={i} of={c.total} inset />)}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
