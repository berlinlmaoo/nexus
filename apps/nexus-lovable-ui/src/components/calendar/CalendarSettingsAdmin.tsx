import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { CalendarDays, ChevronRight, Folder, FolderOpen, Loader2, Lock, Network, Search } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ApiError, nexusApi, type CalendarSettingsPayload } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

/**
 * Control Room › Calendar (BoD / One Above All): the Calendar's AppSetting "calendar" that is set by
 * hand — which projects are private (staff outside them see "Internal task" without a title) and which
 * Bagan card a project or folder belongs to (where a task with no PIC in the Bagan goes). Server:
 * GET/PATCH /api/admin/calendar-settings; takes effect on the next request.
 */

type Payload = CalendarSettingsPayload;
type Project = Payload["projects"][number];
type FolderRow = Payload["folders"][number];
type Unit = Payload["units"][number];

const KEY = ["nexus", "calendar-settings"] as const;
/** Radix Select cannot hold an empty value: "Automatic" (no entry in the map) is this sentinel. */
const AUTO = "__auto";
const NO_FOLDER = "__none";

type SaveVars = {
  /** Row being saved (project or folder id), for its spinner. */
  rowId: string;
  body: Parameters<typeof nexusApi.updateCalendarSettings>[0];
  /** The switch position to show while a privacy toggle is in flight. */
  privateTo?: boolean;
  done: (data: Payload) => string;
};

const fold = (s: string) => s.toLocaleLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

const NAVY_ICON = "grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#1e3a5f] text-white dark:bg-[#9fb6d6] dark:text-[#0f1b2d]";
const INPUT = "w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-base outline-none transition placeholder:text-muted-foreground/70 focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/15 sm:text-sm dark:focus:border-[#9fb6d6]";
const CARD = "min-w-0 space-y-4 rounded-2xl border border-border bg-card p-4 shadow-soft md:p-5";

export function CalendarSettingsAdmin() {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: nexusApi.calendarSettings, retry: false });

  const save = useMutation<Payload, Error, SaveVars>({
    mutationFn: (v: SaveVars) => nexusApi.updateCalendarSettings(v.body),
    onSuccess: (data, v) => {
      qc.setQueryData(KEY, data);
      // This screen, and every open calendar (whatever its query key under "calendar…"), so a private
      // project or a moved division shows on the next look without a reload.
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
        <button type="button" onClick={() => q.refetch()} disabled={q.isFetching}
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-semibold transition hover:bg-accent disabled:opacity-50">
          {q.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t("Try again")}
        </button>
      </div>
    );
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <PrivateProjects data={q.data} save={save} />
      <ProjectDivisions data={q.data} save={save} />
    </div>
  );
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
          <p className="mt-1 text-xs text-muted-foreground">
            {t("Staff outside these projects see their tasks as “Internal task”, without the title. BoD and Managers see everything.")}
            {prefixes.length > 0 && <> {t("Projects whose name starts with {names} are private automatically.", { names: prefixNames })}</>}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search projects")} aria-label={t("Search projects")} className={INPUT} />
        </div>
        <button type="button" onClick={() => setOnlyPrivate((v) => !v)} aria-pressed={onlyPrivate}
          className={cn("inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-full border px-3 py-1.5 text-xs font-semibold transition sm:self-auto",
            onlyPrivate ? "border-[#1e3a5f] bg-[#1e3a5f] text-white dark:border-[#9fb6d6] dark:bg-[#9fb6d6] dark:text-[#0f1b2d]" : "border-border bg-background text-muted-foreground hover:border-[#1e3a5f]/40 hover:text-foreground")}>
          <Lock className="h-3 w-3" /> {t("Private only ({n})", { n: privateCount })}
        </button>
      </div>

      {data.projects.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t("No projects yet.")}</p>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("Nothing matches.")}</p>
      ) : (
        <ul className="-mx-1 max-h-[min(60vh,560px)] divide-y divide-border overflow-y-auto overscroll-contain px-1">
          {shown.map((p) => {
            const saving = save.isPending && save.variables?.rowId === p.id;
            const checked = saving && save.variables?.privateTo !== undefined ? save.variables.privateTo : p.private;
            const why = p.private
              ? p.privateBy === "prefix" ? t("by name") : p.privateBy === "list" ? t("set by hand") : null
              : byPrefix(p) ? t("turned off by hand") : null;
            return (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/5" style={{ background: p.color || "#94a3b8" }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium" title={p.name}>{p.name}</div>
                  {why && (
                    <div className={cn("mt-0.5 inline-flex items-center gap-1 text-[11px]", p.private ? "font-semibold text-[#1e3a5f] dark:text-[#9fb6d6]" : "text-muted-foreground")}>
                      {p.private && <Lock className="h-2.5 w-2.5" />} {why}
                    </div>
                  )}
                </div>
                {saving && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
                <Switch checked={checked} onCheckedChange={(v) => toggle(p, v)} disabled={save.isPending} aria-label={p.name}
                  className="data-[state=checked]:bg-[#1e3a5f] dark:data-[state=checked]:bg-[#9fb6d6]" />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Project divisions ───────────────────────────────────────────────────────────────────────────────

type Tree = {
  roots: FolderRow[];
  kids: Map<string, FolderRow[]>;
  projectsIn: Map<string, Project[]>;
  loose: Project[];
  /** Projects in a folder and all its subfolders. */
  countIn: Map<string, number>;
};

function buildTree(data: Payload): Tree {
  const ids = new Set(data.folders.map((f) => f.id));
  const kids = new Map<string, FolderRow[]>();
  const roots: FolderRow[] = [];
  for (const f of data.folders) {
    if (f.parentFolderId && ids.has(f.parentFolderId) && f.parentFolderId !== f.id) kids.set(f.parentFolderId, [...(kids.get(f.parentFolderId) ?? []), f]);
    else roots.push(f);
  }
  roots.sort(byName);
  for (const list of kids.values()) list.sort(byName);
  const projectsIn = new Map<string, Project[]>();
  const loose: Project[] = [];
  for (const p of data.projects) {
    if (p.folderId && ids.has(p.folderId)) projectsIn.set(p.folderId, [...(projectsIn.get(p.folderId) ?? []), p]);
    else loose.push(p);
  }
  for (const list of projectsIn.values()) list.sort(byName);
  loose.sort(byName);
  const countIn = new Map<string, number>();
  const count = (id: string, seen: Set<string>): number => {
    if (countIn.has(id)) return countIn.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const n = (projectsIn.get(id)?.length ?? 0) + (kids.get(id) ?? []).reduce((s, k) => s + count(k.id, seen), 0);
    countIn.set(id, n);
    return n;
  };
  for (const f of data.folders) count(f.id, new Set());
  return { roots, kids, projectsIn, loose, countIn };
}

/** With a search: folders/projects to show. A folder that matches shows everything in it. */
function searchHits(tree: Tree, needle: string, looseLabel: string): { folders: Set<string>; projects: Set<string> } {
  const folders = new Set<string>();
  const projects = new Set<string>();
  const walk = (f: FolderRow, inMatch: boolean, seen: Set<string>): boolean => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    const all = inMatch || fold(f.name).includes(needle);
    let any = all;
    for (const p of tree.projectsIn.get(f.id) ?? []) if (all || fold(p.name).includes(needle)) { projects.add(p.id); any = true; }
    for (const k of tree.kids.get(f.id) ?? []) if (walk(k, all, seen)) any = true;
    if (any) folders.add(f.id);
    return any;
  };
  const seen = new Set<string>();
  for (const r of tree.roots) walk(r, false, seen);
  const looseAll = fold(looseLabel).includes(needle);
  for (const p of tree.loose) if (looseAll || fold(p.name).includes(needle)) projects.add(p.id);
  return { folders, projects };
}

function ProjectDivisions({ data, save }: { data: Payload; save: Save }) {
  const { t } = useLang();
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildTree(data), [data]);
  const unitsById = useMemo(() => new Map(data.units.map((u) => [u.id, u])), [data.units]);
  const needle = fold(query.trim());
  const noFolder = t("No folder");
  const hits = useMemo(() => (needle ? searchHits(tree, needle, noFolder) : null), [tree, needle, noFolder]);

  const folderUnits = data.settings.folderUnits;
  const projectUnits = data.settings.projectUnits;
  const unitName = (id: string | null | undefined) => (id && unitsById.get(id)?.name) || t("No division");

  const setFolder = (f: FolderRow, unitId: string | null) => {
    const next = { ...folderUnits };
    if (unitId) next[f.id] = unitId;
    else delete next[f.id];
    save.mutate({
      rowId: f.id,
      body: { folderUnits: next },
      done: () => (unitId ? t("{name} now goes to {unit}", { name: f.name, unit: unitName(unitId) }) : t("{name} is automatic again", { name: f.name })),
    });
  };
  const setProject = (p: Project, unitId: string | null) => {
    const next = { ...projectUnits };
    if (unitId) next[p.id] = unitId;
    else delete next[p.id];
    save.mutate({
      rowId: p.id,
      body: { projectUnits: next },
      done: (d) => {
        if (unitId) return t("{name} now goes to {unit}", { name: p.name, unit: unitName(unitId) });
        const now = d.projects.find((x) => x.id === p.id);
        return now?.unitId ? t("{name} is automatic again ({unit})", { name: p.name, unit: unitName(now.unitId) }) : t("{name} is automatic again", { name: p.name });
      },
    });
  };

  const allGroupIds = useMemo(() => [...data.folders.map((f) => f.id), NO_FOLDER], [data.folders]);
  const anyOpen = allGroupIds.some((id) => !closed.has(id));
  const isOpen = (id: string) => !!hits || !closed.has(id);
  const flip = (id: string) => setClosed((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const busyRow = save.isPending ? save.variables?.rowId : undefined;

  const renderProject = (p: Project, depth: number) => {
    if (hits && !hits.projects.has(p.id)) return null;
    const override = projectUnits[p.id] && unitsById.has(projectUnits[p.id]) ? projectUnits[p.id] : null;
    return (
      <Row key={p.id} depth={depth}>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/5" style={{ background: p.color || "#94a3b8" }} />
            <span className="truncate text-sm font-medium" title={p.name}>{p.name}</span>
            {busyRow === p.id && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-[18px] text-[11px]">
            <span className={cn("max-w-full truncate rounded-md px-1.5 py-0.5 font-semibold",
              p.unitId ? "bg-[#edf2f9] text-[#1e3a5f] dark:bg-[#1a2a41] dark:text-[#dce7f6]" : "bg-muted text-muted-foreground")}>
              {unitName(p.unitId)}
            </span>
            {p.unitBy && <span className={cn(p.unitBy === "top" ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{whyLabel(p.unitBy, t)}</span>}
          </div>
        </div>
        <UnitSelect value={override} units={data.units} disabled={save.isPending} onChange={(u) => setProject(p, u)} label={t("Division of {name}", { name: p.name })} />
      </Row>
    );
  };

  const renderFolder = (f: FolderRow, depth: number, seen: Set<string>): ReactNode => {
    if (seen.has(f.id) || (hits && !hits.folders.has(f.id))) return null;
    seen.add(f.id);
    const open = isOpen(f.id);
    const override = folderUnits[f.id] && unitsById.has(folderUnits[f.id]) ? folderUnits[f.id] : null;
    const n = tree.countIn.get(f.id) ?? 0;
    return (
      <div key={f.id}>
        <Row depth={depth} folder>
          <FolderToggle open={open} name={f.name} count={n} onClick={() => flip(f.id)} disabled={!!hits} busy={busyRow === f.id} />
          <UnitSelect value={override} units={data.units} disabled={save.isPending} onChange={(u) => setFolder(f, u)} label={t("Division of {name}", { name: f.name })} />
        </Row>
        {open && (
          <>
            {(tree.kids.get(f.id) ?? []).map((k) => renderFolder(k, depth + 1, seen))}
            {(tree.projectsIn.get(f.id) ?? []).map((p) => renderProject(p, depth + 1))}
          </>
        )}
      </div>
    );
  };

  const seen = new Set<string>();
  const folderNodes = tree.roots.map((r) => renderFolder(r, 0, seen));
  const looseShown = tree.loose.filter((p) => !hits || hits.projects.has(p.id));
  const nothing = hits && hits.folders.size === 0 && hits.projects.size === 0;

  return (
    <section className={CARD}>
      <div className="flex items-start gap-3">
        <span className={NAVY_ICON}><Network className="h-4 w-4" /></span>
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold tracking-tight">{t("Project divisions")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("A task with no PIC, or none of whose PICs is in the Bagan, goes to its project's division. It is worked out from the project folders — set it by hand here when it's wrong. A folder set by hand also covers its subfolders.")}
          </p>
        </div>
      </div>

      {data.units.length === 0 && (
        <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">{t("The Bagan has no cards yet, so there is no division to choose.")}</p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search folders and projects")} aria-label={t("Search folders and projects")} className={INPUT} />
        </div>
        {!hits && (
          <button type="button" onClick={() => setClosed(anyOpen ? new Set(allGroupIds) : new Set())}
            className="inline-flex shrink-0 items-center justify-center gap-1 self-start rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#1e3a5f] transition hover:bg-accent sm:self-auto dark:text-[#9fb6d6]">
            {anyOpen ? t("Collapse all") : t("Expand all")}
          </button>
        )}
      </div>

      {nothing ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t("Nothing matches.")}</p>
      ) : data.folders.length === 0 && data.projects.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t("No projects yet.")}</p>
      ) : (
        <div className="space-y-0.5">
          {folderNodes}
          {looseShown.length > 0 && (
            <div>
              <Row depth={0} folder>
                <FolderToggle open={isOpen(NO_FOLDER)} name={noFolder} count={tree.loose.length} onClick={() => flip(NO_FOLDER)} disabled={!!hits} muted />
              </Row>
              {isOpen(NO_FOLDER) && looseShown.map((p) => renderProject(p, 1))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function whyLabel(why: NonNullable<Project["unitBy"]>, t: (en: string) => string): string {
  switch (why) {
    case "project": return t("set by hand");
    case "folder": return t("folder set by hand");
    case "folder-name": return t("from the folder name");
    case "project-name": return t("from the project name");
    case "top": return t("not found — goes to the top card");
  }
}

/** One line of the tree: indented by depth; on a phone the select drops below the name, full width. */
function Row({ depth, folder, children }: { depth: number; folder?: boolean; children: ReactNode }) {
  return (
    <div style={{ "--d": Math.min(depth, 6) } as CSSProperties}
      className={cn("flex flex-col gap-2 py-2 pl-[calc(var(--d)*10px)] sm:flex-row sm:items-center sm:gap-3 sm:pl-[calc(var(--d)*20px)]",
        folder ? "rounded-xl" : "border-b border-border/60 last:border-b-0")}>
      {children}
    </div>
  );
}

function FolderToggle({ open, name, count, onClick, disabled, busy, muted }: { open: boolean; name: string; count: number; onClick: () => void; disabled?: boolean; busy?: boolean; muted?: boolean }) {
  const { tn } = useLang();
  const Icon = open ? FolderOpen : Folder;
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-expanded={open}
      className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg py-1 text-left transition hover:text-[#1e3a5f] disabled:cursor-default disabled:hover:text-inherit dark:hover:text-[#9fb6d6]">
      <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90", disabled && "opacity-0")} />
      <Icon className={cn("h-4 w-4 shrink-0", muted ? "text-muted-foreground" : "text-[#1e3a5f] dark:text-[#9fb6d6]")} />
      <span className={cn("truncate text-sm font-semibold", muted && "text-muted-foreground")} title={name}>{name}</span>
      <span className="shrink-0 text-[11px] font-medium text-muted-foreground">· {tn(count, "{n} project", "{n} projects")}</span>
      {busy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
    </button>
  );
}

function UnitSelect({ value, units, disabled, onChange, label }: { value: string | null; units: Unit[]; disabled?: boolean; onChange: (unitId: string | null) => void; label: string }) {
  const { t } = useLang();
  return (
    <Select value={value ?? AUTO} onValueChange={(v) => { if (v !== (value ?? AUTO)) onChange(v === AUTO ? null : v); }} disabled={disabled}>
      <SelectTrigger aria-label={label}
        className={cn("h-9 w-full min-w-0 rounded-lg bg-background text-xs sm:w-56 sm:shrink-0",
          value ? "border-[#1e3a5f]/50 font-semibold text-[#1e3a5f] dark:border-[#9fb6d6]/50 dark:text-[#9fb6d6]" : "text-muted-foreground")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value={AUTO} className="text-xs font-semibold">{t("Automatic")}</SelectItem>
        {units.map((u) => (
          <SelectItem key={u.id} value={u.id} className="text-xs" style={{ paddingLeft: 8 + Math.min(u.depth, 8) * 12 }}>{u.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
