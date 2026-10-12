import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { CalendarDays, Loader2, Lock, Search } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { ApiError, nexusApi, type CalendarSettingsPayload } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { CAL_SWITCH, FOCUS_PILL, SWATCH_EDGE, TOUCH_ROW } from "./bits";

/**
 * Control Room › Calendar (BoD / One Above All): which projects are private (staff outside them see
 * "Internal task" without a title). Server: GET/PATCH /api/admin/calendar-settings; takes effect on the
 * next request. A task's division is not set here: its PIC's card in the IP & Division Chart, else the
 * project's folder/name (automatic; the per-folder/per-project override was removed on 12 Oct 2026).
 */

type Payload = CalendarSettingsPayload;
type Project = Payload["projects"][number];

const KEY = ["nexus", "calendar-settings"] as const;

type SaveVars = {
  /** Project being saved, for its spinner. */
  rowId: string;
  body: Parameters<typeof nexusApi.updateCalendarSettings>[0];
  /** The switch position to show while a privacy toggle is in flight. */
  privateTo?: boolean;
  done: (data: Payload) => string;
};

const fold = (s: string) => s.toLocaleLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const NAVY_ICON = "grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cal-accent text-cal-accent-foreground";
// The border turns accent on focus (that is the visible focus, ≥3:1); the faint ring only softens it.
const INPUT = "w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-base outline-none transition placeholder:text-muted-foreground focus:border-cal-accent focus:ring-2 focus:ring-cal-accent/15 sm:text-sm";
const CARD = "min-w-0 space-y-4 rounded-2xl border border-border bg-card p-4 shadow-soft md:p-5";
// While a save is in flight the controls are aria-disabled, never disabled: a disabled control drops the
// keyboard focus it has (Chrome moves it to <body>), so every save threw the keyboard back to the top of
// the page. Their handlers ignore input meanwhile; the look is the same as disabled.
const BUSY = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

export function CalendarSettingsAdmin() {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: nexusApi.calendarSettings, retry: false });

  const save = useMutation<Payload, Error, SaveVars>({
    mutationFn: (v: SaveVars) => nexusApi.updateCalendarSettings(v.body),
    onSuccess: (data, v) => {
      qc.setQueryData(KEY, data);
      // This screen, and every open calendar (whatever its query key under "calendar…"), so a private
      // project shows on the next look without a reload.
      qc.invalidateQueries({
        predicate: (query) => {
          const [ns, k] = query.queryKey as unknown[];
          return ns === "nexus" && typeof k === "string" && (k === "calendar" || k.startsWith("calendar-"));
        },
      });
      toast.success(v.done(data));
    },
    onError: (e) => toast.error(t("Couldn't save."), { description: e instanceof ApiError && lang === "id" ? e.message : t("Try again") }),
  });

  if (q.isLoading) return <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-soft">{t("Loading…")}</div>;
  if (q.isError || !q.data) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center shadow-soft">
        <CalendarDays className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
        <div className="text-lg font-bold">{t("Couldn't load the calendar settings.")}</div>
        {q.error instanceof ApiError && lang === "id" && <p className="mt-2 text-sm text-muted-foreground">{q.error.message}</p>}
        <button type="button" onClick={() => { if (!q.isFetching) void q.refetch(); }} aria-disabled={q.isFetching || undefined}
          className={cn("mt-4 inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-semibold transition hover:bg-accent aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-background", TOUCH_ROW, FOCUS_PILL)}>
          {q.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t("Try again")}
        </button>
      </div>
    );
  }

  return <PrivateProjects data={q.data} save={save} />;
}

type Save = UseMutationResult<Payload, Error, SaveVars>;

// ── Private projects ────────────────────────────────────────────────────────────────────────────────

function PrivateProjects({ data, save }: { data: Payload; save: Save }) {
  const { t, locale } = useLang();
  const [query, setQuery] = useState("");
  const [onlyPrivate, setOnlyPrivate] = useState(false);

  const prefixes = data.settings.privateNamePrefixes;
  const prefixNames = useMemo(() => {
    const names = prefixes.map((p) => p.charAt(0).toLocaleUpperCase() + p.slice(1));
    try {
      return new Intl.ListFormat(locale, { style: "long", type: "disjunction" }).format(names);
    } catch {
      return names.join(" / ");
    }
  }, [prefixes, locale]);
  const byPrefix = (p: Project) => prefixes.some((x) => p.name.trim().toLowerCase().startsWith(x));

  const privateCount = data.projects.filter((p) => p.private).length;
  const shown = useMemo(() => {
    const needle = fold(query.trim());
    return data.projects.filter((p) => (!onlyPrivate || p.private) && (!needle || fold(p.name).includes(needle)));
  }, [data.projects, query, onlyPrivate]);

  const toggle = (p: Project, on: boolean) =>
    save.mutate({
      rowId: p.id,
      body: { projectId: p.id, private: on },
      privateTo: on,
      done: () => (on ? t("{name} is now private", { name: p.name }) : t("{name} is no longer private", { name: p.name })),
    });

  return (
    <section className={CARD}>
      <div className="flex items-start gap-3">
        <span className={NAVY_ICON}><Lock className="h-4 w-4" /></span>
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold tracking-tight">{t("Private projects")}</h2>
          <p className="mt-1 max-w-prose text-xs text-muted-foreground">
            {t("Staff outside these projects see their tasks as “Internal task”, without the title. BoD and Managers see everything.")}
            {prefixes.length > 0 && <> {t("Projects whose name starts with {names} are private automatically.", { names: prefixNames })}</>}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search projects")} aria-label={t("Search projects")} className={INPUT} />
        </div>
        <button type="button" onClick={() => setOnlyPrivate((v) => !v)} aria-pressed={onlyPrivate}
          className={cn("inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-full border px-3 py-1.5 text-xs font-semibold transition sm:self-auto", TOUCH_ROW, FOCUS_PILL,
            onlyPrivate ? "border-cal-accent bg-cal-accent text-cal-accent-foreground" : "border-border bg-background text-muted-foreground hover:border-cal-accent/40 hover:text-foreground")}>
          <Lock aria-hidden className="h-3 w-3" /> {t("Private only ({n})", { n: privateCount })}
        </button>
      </div>

      {data.projects.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t("No projects yet.")}</p>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("Nothing matches.")}</p>
      ) : (
        // The card spans the whole tab: on a wide screen the projects flow into two or three columns, so a
        // switch is never a screen's width away from its name.
        <ul className="-mx-1 grid max-h-[min(65vh,640px)] content-start gap-x-8 overflow-y-auto overscroll-contain px-1 md:grid-cols-2 2xl:grid-cols-3">
          {shown.map((p) => {
            const saving = save.isPending && save.variables?.rowId === p.id;
            const checked = saving && save.variables?.privateTo !== undefined ? save.variables.privateTo : p.private;
            const why = p.private
              ? p.privateBy === "prefix" ? t("by name") : p.privateBy === "list" ? t("set by hand") : null
              : byPrefix(p) ? t("turned off by hand") : null;
            return (
              // The row is the switch's label, like the Calendar's filter switches: the whole row (at least
              // 44px on a touch screen) flips it, not only the 36x20px switch.
              <li key={p.id} className="border-b border-border/60">
                <label className={cn("flex cursor-pointer items-center gap-3 py-2.5", TOUCH_ROW)}>
                  <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", SWATCH_EDGE)} style={{ background: p.color || "var(--cal-todo)" }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium [overflow-wrap:anywhere]">{p.name}</span>
                    {why && (
                      <span className={cn("mt-0.5 inline-flex items-center gap-1 text-2xs", p.private ? "font-semibold text-cal-accent" : "text-muted-foreground")}>
                        {p.private && <Lock className="h-2.5 w-2.5" />} {why}
                      </span>
                    )}
                  </span>
                  {saving && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
                  <Switch checked={checked} onCheckedChange={(v) => { if (!save.isPending) toggle(p, v); }} aria-disabled={save.isPending || undefined}
                    aria-label={p.name} className={cn(CAL_SWITCH, BUSY)} />
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
