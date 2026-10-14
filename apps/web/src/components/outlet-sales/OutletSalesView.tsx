import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Info, Link2, Loader2, PencilLine, Plus, Settings2, Store, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { useRealtime, useRealtimeRoom } from "@/lib/realtime";
import { EmptyAction, EmptyState } from "@/components/EmptyState";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  outletApi, outletFormLink, outletKey, outletMonthKey, type OutletEvent, type OutletMonthResponse, type OutletStatus,
} from "@/lib/outlet-sales-api";
import {
  EventDetail, Meter, MonthSwitcher, STATUS_DOT, STATUS_LABEL, STATUS_ORDER, count, dayShort, monthLabel, rupiah, vsTarget, wibToday,
} from "./outlet-ui";
import { GuestOverview } from "./OutletGuests";
import { OutletReportSettings } from "./OutletReportSettings";
import { OutletCalendar } from "./OutletCalendar";
import { OutletReportForm, type FormTarget } from "./OutletReportForm";

export type OutletView = "overview" | "calendar" | "board" | "form";

/** Error text from a refused write: the server's message when it sent one. */
export function errorText(error: unknown, fallback: string): string {
  const payload = (error as { payload?: { error?: unknown } } | null)?.payload;
  return typeof payload?.error === "string" ? payload.error : fallback;
}

/**
 * An Outlet Sales Dashboard project (owner, 10 Oct 2026, for Ryan): one outlet, its month at a glance
 * (Overview: sales and pax against the month's target), its nights on a Calendar (a day opens the
 * night's report below, in Ryan's order), a Board by status (Upcoming · Waiting report · Reported,
 * derived, not dragged), and the report Form the team fills after each night. The four are tabs of the
 * project page sharing one month; a colleague's change arrives live (`outlet-sales-changed`).
 */
export function OutletSalesView({
  projectId, view, onView, initial,
}: {
  projectId: string;
  view: OutletView;
  onView: (v: OutletView) => void;
  /** From a link: ?date= (the calendar's day) and ?event= (the form or the calendar opens on it). */
  initial?: { date?: string; eventId?: string };
}) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => (initial?.date ?? wibToday()).slice(0, 7));
  const [selected, setSelected] = useState<string | null>(initial?.date ?? null);
  const [formTarget, setFormTarget] = useState<FormTarget>(() => (initial?.eventId ? { eventId: initial.eventId } : { date: initial?.date }));
  const [openId, setOpenId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const q = useQuery({
    queryKey: outletMonthKey(projectId, month),
    queryFn: () => outletApi.month(projectId, month),
    retry: false,
    placeholderData: keepPreviousData,
  });

  useRealtimeRoom(`project:${projectId}`);
  const { socket } = useRealtime();
  useEffect(() => {
    if (!socket) return;
    const onChanged = (payload?: { projectId?: unknown }) => {
      if (payload?.projectId === projectId) qc.invalidateQueries({ queryKey: outletKey(projectId) });
    };
    socket.on("outlet-sales-changed", onChanged);
    return () => { socket.off("outlet-sales-changed", onChanged); };
  }, [socket, projectId, qc]);

  const data = q.data;
  const today = data?.today ?? wibToday();
  const all = useMemo(() => [...(data?.events ?? []), ...(data?.waitingEarlier ?? [])], [data]);
  const openEvent = all.find((e) => e.id === openId) ?? null;

  const openForm = (target: FormTarget) => {
    setOpenId(null);
    setFormTarget(target);
    onView("form");
  };
  const copyLink = async (eventId?: string | null) => {
    try {
      await navigator.clipboard.writeText(outletFormLink(projectId, eventId));
      toast.success(t("Form link copied. Anyone in this project can open it in NEXUS."));
    } catch {
      toast.error(t("The link wasn't copied. Copy it from the address bar instead."));
    }
  };

  if (q.isLoading) {
    return (
      <div className="space-y-4 p-4 md:p-8" aria-busy="true" aria-label={t("Loading the outlet")}>
        <div className="h-10 w-64 animate-pulse rounded-xl bg-muted" />
        <div className="grid gap-3 md:grid-cols-2">{[0, 1].map((i) => <div key={i} className="h-36 animate-pulse rounded-xl bg-muted" />)}</div>
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }
  if (q.isError || !data) {
    const code = (q.error as { status?: number } | null)?.status;
    return (
      <div className="p-4 md:p-8">
        <EmptyState
          icon={Store}
          tone="muted"
          title={code === 403 ? t("This outlet is for its project members") : t("The outlet didn't load")}
          message={code === 403 ? t("Ask the Project Owner or a BoD to add you to the project.") : t("Check your connection, then try again.")}
          action={code === 403 ? undefined : <EmptyAction onClick={() => q.refetch()}>{t("Try again")}</EmptyAction>}
        />
      </div>
    );
  }

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <MonthSwitcher month={month} today={today} onChange={(m) => { setMonth(m); setSelected(null); }} />
      {/* Labelled on a phone too (UI tour run 13, W-M13: bare icons); the row wraps when it must. */}
      <div className="flex flex-wrap items-center gap-2">
        {(data.canManageSettings ?? data.canManageTargets) && (
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:h-11"
          >
            <Settings2 aria-hidden className="h-4 w-4" />
            {t("Report settings")}
          </button>
        )}
        <button
          type="button"
          onClick={() => copyLink()}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:h-11"
        >
          <Link2 aria-hidden className="h-4 w-4" />
          {t("Copy form link")}
        </button>
        <button
          type="button"
          onClick={() => openForm({ date: selected ?? undefined })}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:h-11"
        >
          <Plus aria-hidden className="h-4 w-4" /> {t("Add event")}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 p-4 md:p-8" aria-busy={q.isFetching || undefined}>
      {view !== "form" && toolbar}
      {view === "overview" && (
        <Overview
          data={data}
          projectId={projectId}
          onFill={(e) => openForm({ eventId: e.id })}
          onAdd={() => openForm({})}
          onSetup={() => setSettingsOpen(true)}
        />
      )}
      {view === "calendar" && (
        <OutletCalendar
          data={data}
          selected={selected}
          onSelect={(day) => {
            if (day.slice(0, 7) !== month) setMonth(day.slice(0, 7));
            setSelected(day);
          }}
          onEdit={(e) => openForm({ eventId: e.id })}
          onAdd={(day) => openForm({ date: day })}
          projectId={projectId}
        />
      )}
      {view === "board" && <Board data={data} onOpen={setOpenId} onAdd={() => openForm({})} />}
      {view === "form" && (
        <OutletReportForm
          projectId={projectId}
          data={data}
          target={formTarget}
          onTarget={setFormTarget}
          onCopyLink={copyLink}
          onDone={(e) => {
            setMonth(e.date.slice(0, 7));
            setSelected(e.date);
            onView("calendar");
          }}
        />
      )}

      <Sheet open={!!openEvent} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg [&>button:first-of-type]:hidden">
          {openEvent && (
            <>
              <header className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
                <SheetTitle className="min-w-0 truncate text-base font-semibold">{openEvent.name}</SheetTitle>
                <SheetDescription className="sr-only">{t("The night's report, as the team filled it.")}</SheetDescription>
                <button type="button" onClick={() => setOpenId(null)} aria-label={t("Close")} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-[44px]">
                  <X className="h-4 w-4" />
                </button>
              </header>
              <div className="flex-1 overflow-y-auto overscroll-contain p-4">
                <EventDetail event={openEvent} form={data.form} config={data.config} today={today} onEdit={() => openForm({ eventId: openEvent.id })} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      <OutletReportSettings projectId={projectId} open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────────────────────────────

function Overview({
  data, projectId, onFill, onAdd, onSetup,
}: {
  data: OutletMonthResponse; projectId: string; onFill: (e: OutletEvent) => void; onAdd: () => void; onSetup: () => void;
}) {
  const { t, tn, lang, locale } = useLang();
  const s = data.summary;
  const [editing, setEditing] = useState(false);
  const waiting = [...data.events.filter((e) => e.status === "WAITING_REPORT"), ...data.waitingEarlier];
  const salesHint = data.form.sections.flatMap((x) => x.fields).find((f) => f.key === "sales")?.hint;
  const paxHint = data.form.sections.flatMap((x) => x.fields).find((f) => f.key === "pax")?.hint;
  const monthName = monthLabel(data.month, locale);
  return (
    <>
      <section aria-label={t("This month against target")} className="grid gap-3 md:grid-cols-2">
        <Gauge
          title={t("Sales · {month}", { month: monthName })}
          hint={salesHint ? (lang === "en" ? salesHint.en : salesHint.id) : undefined}
          actual={rupiah(s.sales, lang)}
          target={s.salesTarget === null ? null : rupiah(s.salesTarget, lang)}
          pct={s.salesPct}
        />
        <Gauge
          title={t("Pax · {month}", { month: monthName })}
          hint={paxHint ? (lang === "en" ? paxHint.en : paxHint.id) : undefined}
          actual={count(s.pax, lang)}
          target={s.paxTarget === null ? null : count(s.paxTarget, lang)}
          pct={s.paxPct}
        />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>
          {data.target?.updatedBy
            ? t("Target set by {name}", { name: data.target.updatedBy.name ?? "?" })
            : t("No target for {month} yet.", { month: monthName })}
          {" "}
          {!data.canManageTargets && !data.target && t("The Project Owner or a BoD sets it.")}
        </p>
        {data.canManageTargets && !editing && (
          // An outlined button, not bare bold text: it has to read as something to click (UI tour run 13, W-B12).
          <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[40px]">
            <PencilLine aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            {data.target ? t("Change target") : t("Set target")}
          </button>
        )}
      </div>
      {editing && <TargetEditor projectId={projectId} data={data} onClose={() => setEditing(false)} />}

      {waiting.length > 0 && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
            <Info aria-hidden className="h-4 w-4" />
            {tn(waiting.length, "1 night is waiting for its report", "{n} nights are waiting for their report")}
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {waiting.slice(0, 8).map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => onFill(e)} className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-card px-3 py-1 text-xs font-medium transition-colors hover:bg-amber-500/10 focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[36px]">
                  <span className="tabular-nums text-muted-foreground">{dayShort(e.date, locale)}</span> {e.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Owner, 14 Oct 2026: one Guest overview replaces the counts strip and the month's event list. */}
      {data.guests ? (
        <GuestOverview
          guests={data.guests}
          month={data.month}
          onFill={() => {
            const next = waiting[0] ?? data.events.find((e) => e.status !== "REPORTED");
            if (next) onFill(next);
            else onAdd();
          }}
          canSetup={!!(data.canManageSettings ?? data.canManageTargets)}
          onSetup={onSetup}
        />
      ) : null}
    </>
  );
}

/** Ryan's reading: "2.000.000 / 2.000.000 (100%)", with its bar. No target: the actual and "—". */
function Gauge({ title, hint, actual, target, pct }: { title: string; hint?: string; actual: string; target: string | null; pct: number | null }) {
  const { t } = useLang();
  return (
    <article className="rounded-xl border border-border bg-card p-4 md:p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 tabular-nums">
        <span className="text-2xl font-semibold tracking-tight md:text-3xl">{actual}</span>
        <span className="text-base text-muted-foreground">/ {target ?? "—"}</span>
        {pct !== null && (
          <span className={cn("rounded-full px-2 py-0.5 text-sm font-semibold", pct >= 100 ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : "bg-primary/10 text-primary")}>
            {pct}%
          </span>
        )}
      </p>
      <div className="mt-3"><Meter pct={pct} label={title} /></div>
      {target === null && <p className="mt-2 text-xs text-muted-foreground">{t("No target for this month")}</p>}
    </article>
  );
}

function digitsOf(v: string): number | null {
  const d = v.replace(/\D/g, "");
  return d ? Number(d) : null;
}

function TargetEditor({ projectId, data, onClose }: { projectId: string; data: OutletMonthResponse; onClose: () => void }) {
  const { t, lang, locale } = useLang();
  const qc = useQueryClient();
  const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "" : new Intl.NumberFormat("id-ID").format(n));
  const [sales, setSales] = useState(fmt(data.target?.salesTarget));
  const [pax, setPax] = useState(fmt(data.target?.paxTarget));
  const save = useMutation({
    mutationFn: () => outletApi.putTarget(projectId, { month: data.month, salesTarget: digitsOf(sales), paxTarget: digitsOf(pax) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: outletKey(projectId) });
      toast.success(t("Target for {month} saved.", { month: monthLabel(data.month, locale) }));
      onClose();
    },
    onError: (error) => toast.error(errorText(error, t("The target wasn't saved. Try again."))),
  });
  const input = "h-10 w-full rounded-xl border border-border bg-background px-3 text-right text-sm tabular-nums outline-none transition-colors hover:border-control-border focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30 pointer-coarse:h-11";
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
      className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
    >
      <label className="text-xs font-medium text-muted-foreground">
        {t("Sales target for {month}", { month: monthLabel(data.month, locale) })}
        <span className="relative mt-1 block">
          <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs">Rp</span>
          <input inputMode="numeric" value={sales} onChange={(e) => setSales(fmt(digitsOf(e.target.value)))} className={cn(input, "pl-9")} />
        </span>
      </label>
      <label className="text-xs font-medium text-muted-foreground">
        {t("Pax target for {month}", { month: monthLabel(data.month, locale) })}
        <input inputMode="numeric" value={pax} onChange={(e) => setPax(fmt(digitsOf(e.target.value)))} placeholder="—" className={cn(input, "mt-1")} />
      </label>
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="h-10 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground pointer-coarse:h-11">{t("Cancel")}</button>
        <button type="submit" disabled={save.isPending} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-60 pointer-coarse:h-11">
          {save.isPending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Check aria-hidden className="h-4 w-4" />}
          {t("Save target")}
        </button>
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-3">{t("Leave a box empty for no target. The month's total is the sum of its events' actual figures.")}</p>
    </form>
  );
}

// ── Board ─────────────────────────────────────────────────────────────────────────────────────────────

const EMPTY_COLUMN: Record<OutletStatus, string> = {
  UPCOMING: "Nothing planned ahead in this month.",
  WAITING_REPORT: "Every night that's over has its report.",
  REPORTED: "No reports in this month yet.",
};

/**
 * The month's events by status — the columns come from the rules (lib/outlet-sales.ts statusOf), so a
 * card moves by itself when its night is over or its report is filled; there is nothing to drag. Older
 * nights still waiting for a report join the middle column, with their date.
 */
function Board({ data, onOpen, onAdd }: { data: OutletMonthResponse; onOpen: (id: string) => void; onAdd: () => void }) {
  const { t, lang, locale } = useLang();
  if (data.events.length === 0 && data.waitingEarlier.length === 0) {
    return (
      <EmptyState
        icon={Store}
        title={t("No events this month yet")}
        message={t("Add the nights you have planned. After each one, the team fills its report and the totals above update.")}
        action={<EmptyAction onClick={onAdd}>{t("Add event")}</EmptyAction>}
      />
    );
  }
  const cols: Record<OutletStatus, OutletEvent[]> = { UPCOMING: [], WAITING_REPORT: [], REPORTED: [] };
  for (const e of data.events) cols[e.status].push(e);
  cols.WAITING_REPORT.push(...data.waitingEarlier);
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {STATUS_ORDER.map((status) => (
        <section key={status} aria-labelledby={`os-col-${status}`} className="flex min-w-0 flex-col rounded-xl border border-border bg-muted/30 p-2">
          <h3 id={`os-col-${status}`} className="flex items-center gap-2 px-2 py-1.5 text-sm font-semibold">
            <span aria-hidden className={cn("h-2 w-2 rounded-full", STATUS_DOT[status])} />
            {t(STATUS_LABEL[status])}
            <span className="ml-auto text-xs font-medium tabular-nums text-muted-foreground">{cols[status].length}</span>
          </h3>
          {cols[status].length === 0 ? (
            <p className="px-2 pb-3 pt-1 text-xs text-muted-foreground">{t(EMPTY_COLUMN[status])}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {cols[status].map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => onOpen(e.id)} className="w-full rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-control-border focus-visible:outline-2 focus-visible:outline-ring">
                    <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
                      <span>{dayShort(e.date, locale)}{e.date.slice(0, 4) !== data.month.slice(0, 4) && ` ${e.date.slice(0, 4)}`}</span>
                      {e.status === "WAITING_REPORT" && e.missing.length > 0 && (
                        <span className="text-amber-800 dark:text-amber-200">
                          {e.missing.length === 2 ? t("Sales and pax missing") : e.missing[0] === "sales" ? t("Sales missing") : t("Pax missing")}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block truncate text-sm font-semibold">{e.name}</span>
                    <span className="mt-1.5 grid gap-0.5 text-xs tabular-nums text-muted-foreground">
                      <span>{t("Sales")}: <span className="text-foreground">{vsTarget(e.sales, e.salesTarget, e.salesPct, (n) => rupiah(n, lang))}</span></span>
                      <span>{t("Pax")}: <span className="text-foreground">{vsTarget(e.pax, e.paxTarget, e.paxPct, (n) => count(n, lang))}</span></span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
