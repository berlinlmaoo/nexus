import { useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
