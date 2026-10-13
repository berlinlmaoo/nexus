import { useEffect, useMemo, useRef } from "react";
import { CalendarPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import type { OutletEvent, OutletMonthResponse } from "@/lib/outlet-sales-api";
import { EventDetail, STATUS_DOT, dayLong, monthLabel } from "./outlet-ui";

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The 42 days shown for a month: Monday first, six weeks, as the NEXUS Calendar. */
function monthDays(month: string): string[] {
  const first = `${month}-01`;
  const dow = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const start = addDays(first, -dow);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/**
 * The outlet's month (Ryan, 10 Oct 2026: "ketika pencet sebuah tanggal, di bawah muncul details"): a
 * Monday-first grid with each day's events (names on a wide screen, dots on a phone, coloured by status),
 * and below it the chosen day's events in Ryan's order, each with Fill / Edit report. A day of the
 * previous or next month switches to that month.
 */
export function OutletCalendar({
  data, selected, onSelect, onEdit, onAdd,
}: {
  data: OutletMonthResponse;
  selected: string | null;
  onSelect: (day: string) => void;
  onEdit: (e: OutletEvent) => void;
  onAdd: (day: string) => void;
}) {
  const { t, tn, locale } = useLang();
  const days = useMemo(() => monthDays(data.month), [data.month]);
  const byDay = useMemo(() => {
    const m = new Map<string, OutletEvent[]>();
    for (const e of data.events) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [data.events]);
  // No day chosen yet: today when it is in this month, else the month's first night, else the 1st.
  const day = selected && selected.slice(0, 7) === data.month
    ? selected
    : data.today.slice(0, 7) === data.month ? data.today : data.events[0]?.date ?? `${data.month}-01`;
  const dayEvents = byDay.get(day) ?? [];
  const weekdays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(`2026-10-${String(5 + i).padStart(2, "0")}T00:00:00`).toLocaleDateString(locale, { weekday: "short" })),
    [locale],
  );
  const panelRef = useRef<HTMLElement>(null);
  const picked = useRef(false);
  useEffect(() => {
    if (!picked.current) return;
    picked.current = false;
    // On a phone the panel is below the fold: bring it up after a tap.
    if (window.matchMedia("(max-width: 767px)").matches) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [day]);

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label={monthLabel(data.month, locale)} className="overflow-clip rounded-xl border border-border bg-card">
        <div aria-hidden className="grid grid-cols-7 border-b border-border bg-muted/40">
          {weekdays.map((w) => (
            <div key={w} className="truncate px-1 py-2 text-center text-xs font-medium text-muted-foreground sm:px-2 sm:text-left">{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const inMonth = d.slice(0, 7) === data.month;
            const evs = inMonth ? byDay.get(d) ?? [] : [];
            const isSel = d === day;
            const isToday = d === data.today;
            const label = [
              dayLong(d, locale, data.today.slice(0, 4)),
              evs.length ? `${tn(evs.length, "1 event", "{n} events")}: ${evs.map((e) => e.name).join(", ")}` : t("No events"),
              isToday ? t("Today") : "",
            ].filter(Boolean).join(", ");
            return (
              <button
                key={d}
                type="button"
                aria-pressed={isSel}
                aria-label={label}
                onClick={() => { picked.current = true; onSelect(d); }}
                className={cn(
                  "relative flex min-h-[3.5rem] min-w-0 flex-col items-stretch gap-1 border-border p-1 text-left transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:min-h-[6.5rem] sm:p-1.5",
                  i % 7 !== 6 && "border-r",
                  i < 35 && "border-b",
                  inMonth ? "bg-card hover:bg-muted/40" : "bg-muted/30 text-muted-foreground/60",
                  isSel && "bg-primary/5 ring-2 ring-inset ring-primary",
                )}
              >
                <span
                  className={cn(
                    "grid h-6 w-6 place-items-center self-center rounded-full text-xs tabular-nums sm:self-start",
                    isToday && "bg-primary font-semibold text-primary-foreground",
                  )}
                >
                  {Number(d.slice(8))}
                </span>
                {evs.length > 0 && (
                  <>
                    {/* A phone: one dot per night (three at most), coloured by status. */}
                    <span aria-hidden className="flex justify-center gap-0.5 sm:hidden">
                      {evs.slice(0, 3).map((e) => <span key={e.id} className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[e.status])} />)}
                    </span>
                    <span aria-hidden className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                      {evs.slice(0, 2).map((e) => (
                        <span key={e.id} className="flex min-w-0 items-center gap-1 rounded-md bg-muted/70 px-1.5 py-0.5 text-[11px] font-medium leading-tight text-foreground">
                          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[e.status])} />
                          <span className="truncate">{e.name}</span>
                        </span>
                      ))}
                      {evs.length > 2 && <span className="px-1.5 text-[11px] text-muted-foreground">{t("+{n} more", { n: evs.length - 2 })}</span>}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <section ref={panelRef} aria-labelledby="os-day" className="scroll-mt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 id="os-day" className="text-base font-semibold">{dayLong(day, locale, data.today.slice(0, 4))}</h3>
          <button
            type="button"
            onClick={() => onAdd(day)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[44px]"
          >
            <CalendarPlus aria-hidden className="h-4 w-4" /> {t("Add event on this day")}
          </button>
        </div>
        {dayEvents.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card/60 px-4 py-6 text-center text-sm text-muted-foreground">
            {t("No event on this day. Add one to fill its report after the night.")}
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {dayEvents.map((e) => <EventDetail key={e.id} event={e} form={data.form} today={data.today} onEdit={() => onEdit(e)} />)}
          </div>
        )}
      </section>
    </div>
  );
}
