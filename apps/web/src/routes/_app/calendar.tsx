import { useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { nexusApi } from "@/lib/nexus-api";
import { CalendarPage, type CalSearch } from "@/components/calendar/CalendarPage";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[\w-]{1,64}$/;

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
}
/** A comma list of ids; anything else is dropped. */
function ids(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const ok = s.split(",").filter((x) => ID.test(x)).slice(0, 50);
  return ok.length ? ok.join(",") : undefined;
}

/**
 * /calendar — the master calendar (replaces Team Calendar; /master-calendar redirects here). Everything
 * on screen is in the URL so it can be shared and survives a reload:
 * ?date=YYYY-MM-DD&view=people&lens=person&focus=<unit>&scope=me|division&unit=…&person=…&project=…
 * &prio=…&done=0&overdue=1&task=<id>. Unknown values are dropped; a broken date falls back to today.
 */
export const Route = createFileRoute("/_app/calendar")({
  validateSearch: (s: Record<string, unknown>): CalSearch => {
    const date = str(s.date);
    const scope = str(s.scope);
    const task = str(s.task);
    const focus = str(s.focus);
    return {
      date: date && DAY.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? date : undefined,
      view: str(s.view) === "people" ? "people" : undefined,
      lens: str(s.lens) === "person" ? "person" : undefined,
      focus: focus && ID.test(focus) ? focus : undefined,
      scope: scope === "me" || scope === "division" ? scope : undefined,
      unit: ids(s.unit),
      person: ids(s.person),
      project: ids(s.project),
      prio: ids(s.prio),
      done: str(s.done) === "0" ? "0" : undefined,
      overdue: str(s.overdue) === "1" ? "1" : undefined,
      task: task && ID.test(task) ? task : undefined,
    };
  },
  // Start the calendar's three requests while the page's own code is still downloading (and, with
  // intent preloading, when the link is hovered). Not awaited: the page draws its skeleton and the
  // queries pick these results up. Keys and options must match CalendarPage's useQuery calls. The grid
  // maths come in dynamically so the calendar's core stays out of the app's entry chunk (the API client
  // is in it already).
  loaderDeps: ({ search }) => ({ date: search.date }),
  loader: ({ context, deps }) => {
    const qc = context.queryClient;
    void import("@/lib/calendar/core").then(({ gridRange }) => {
      // Today in WIB (UTC+7), as components/calendar/bits.wibToday.
      const r = gridRange(deps.date ?? new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10));
      void qc.prefetchQuery({ queryKey: ["nexus", "calendar-tasks", "structure"], queryFn: nexusApi.calendarStructure, staleTime: 5 * 60_000 });
      void qc.prefetchQuery({ queryKey: ["nexus", "calendar-tasks", "items", r.from, r.to], queryFn: () => nexusApi.calendarItems(r.from, r.to), staleTime: 60_000 });
      void qc.prefetchQuery({ queryKey: ["nexus", "calendar-tasks", "overdue"], queryFn: nexusApi.calendarOverdue, staleTime: 60_000 });
    }).catch(() => { /* the page fetches for itself */ });
  },
  component: CalendarRoute,
});

function CalendarRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/calendar" });
  const setSearch = useCallback((patch: Partial<CalSearch>) => {
    void navigate({
      search: (prev: CalSearch) => {
        const next: Record<string, unknown> = { ...prev, ...patch };
        for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === "") delete next[k];
        return next as CalSearch;
      },
      // Opening a task is a step Back can undo; everything else replaces the entry.
      replace: !patch.task,
    });
  }, [navigate]);
  return <CalendarPage search={search} setSearch={setSearch} />;
}
