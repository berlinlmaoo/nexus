import { DateField } from "@/components/DateField";
import { EscClose } from "@/hooks/use-escape";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useEdgeFade } from "@/hooks/use-edge-fade";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, Plus, Sparkles, X } from "lucide-react";
import { useAutofillMarks } from "@/components/gideon/AutofillPanel";
import { useLang } from "@/lib/lang";
import { COLUMN_CALC_LABEL, columnCalcValue, columnCalcsFor, optionColor, propDef, type ColumnCalc, type PropDef, type TaskGroup, type ViewConfig } from "@/lib/project-views";
import { NumberFieldSettings } from "@/components/projects/number-field";
import { PropIcon, usePropLabel } from "@/components/projects/views/view-controls";
import { GroupHeader } from "@/components/projects/views/view-layouts";
import { StatusPicker } from "@/components/tasks/StatusPicker";
import { SelectPicker } from "@/components/SelectPicker";
import { usesStatusOptions } from "@/lib/status-options";
import {
  nexusApi,
  statusLabel,
  type NexusCustomField,
  type NexusCustomFieldOptions,
  type NexusProject,
  type NexusTask,
  type NexusUser,
} from "@/lib/nexus-api";
import { CustomFieldInput } from "@/components/tasks/TaskDetailPanel";
import { FieldEditor } from "@/components/projects/ProjectCustomFieldsManager";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, glueDash } from "@/lib/utils";
import { Avatar, useUserLookup } from "@/components/Avatar";
import { useTaskBulk } from "@/components/tasks/task-bulk";
import { toast } from "sonner";
import { Incremental } from "@/components/projects/views/incremental";
import { InlineTaskDraft } from "@/components/projects/views/inline-draft";
import { FilterHint, useFilteredOut } from "@/components/projects/views/filter-hint";
import { holdProject, patchTaskInCaches } from "@/lib/task-cache";
import { canDragTask, DragHandle, useGroupMove } from "@/components/projects/views/group-move";
import { useTouchDrag } from "@/components/projects/views/touch-drag";
import { useProjectCanEdit } from "@/components/projects/project-access";
import { EdgeArrows } from "@/components/EdgeArrows";

const TASK_STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"];
const TASK_PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"];

// Parse a raw serialized custom-field value into the shape CustomFieldInput expects.
function parseCfValue(type: string, raw: string): unknown {
  const t = (type || "").toUpperCase();
  if (!raw) return t === "MULTI_SELECT" || t === "FILE" ? [] : t === "PLACE" ? { label: "", mapUrl: "" } : "";
  if (t === "MULTI_SELECT" || t === "FILE") { try { return JSON.parse(raw); } catch { return []; } }
  if (t === "PLACE") { try { return JSON.parse(raw); } catch { return { label: raw, mapUrl: "" }; } }
  return raw;
}

type GroupBuilder = (tasks: NexusTask[], by: string | null, opts?: { keepHidden?: boolean; keepEmpty?: boolean }) => TaskGroup[];

/**
 * A Table view (Notion-style). Since saved views (owner, 12 Oct 2026) the columns are the VIEW's visible
 * properties, in its order (Name is always first), and rows come grouped as the view groups them. The
 * old per-project column list (Project.tableColumns) seeded the built-in Table view and is no longer
 * written.
 */
export function ProjectTableView({ project, groups, groupBy, subGroupBy, buildGroups, cfg, defs, columns, canEditColumns, onColumnsChange, onCalcsChange, collapsed, onToggleGroup, onOpen, onCreateInGroup }: {
  project: NexusProject;
  groups: TaskGroup[];
  groupBy: string | null;
  subGroupBy: string | null;
  buildGroups: GroupBuilder;
  cfg: ViewConfig;
  defs: PropDef[];
  columns: string[];
  canEditColumns: boolean;
  onColumnsChange: (cols: string[]) => void;
  /** The footer's calculations (Notion's "Calculate"), saved with the view. Absent = read-only footer. */
  onCalcsChange?: (calcs: Record<string, ColumnCalc>) => void;
  collapsed: Set<string>;
  onToggleGroup: (key: string) => void;
  onOpen: (task: NexusTask) => void;
  /** "+ New task" under a group (Notion's table; bug hunt C-BUG-19). Absent = no row. */
  onCreateInGroup?: (groupKey: string | null, subKey: string | null, p: { title: string; dueDate: string | null }) => Promise<NexusTask | null>;
}) {
  const projectId = project.id;
  const [draft, setDraft] = useState<string | null>(null);
  const canEdit = useProjectCanEdit();
  const newRow = (id: string, gKey: string | null, subKey: string | null) => !onCreateInGroup || !canEdit ? null : draft === id
    // The row's divider runs the table's full width (QA S-26: it stopped at ~930 px with the sticky part).
    ? <div data-table-new-row="" className="border-b border-border/70"><div className="sticky left-0 max-w-[min(100%,640px)] [&>*]:border-b-0"><InlineTaskDraft variant="row" onCreate={(p) => onCreateInGroup(gKey, subKey, p)} onExpand={onOpen} onClose={() => setDraft(null)} /></div></div>
    : (
      <div data-table-new-row="" className="border-b border-border/70">
      <button type="button" onClick={() => setDraft(id)} className="sticky left-0 flex h-9 w-full max-w-[min(100%,640px)] items-center gap-2 px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground">
        <Plus className="h-4 w-4" />{t("New task")}
      </button>
      </div>
    );
  const qc = useQueryClient();
  const { t } = useLang();
  const propLabel = usePropLabel();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["nexus", "project", projectId] });
    qc.invalidateQueries({ queryKey: ["nexus", "project-calendar-tasks", projectId] });
  };

  const membersQ = useQuery({ queryKey: ["nexus", "project-members", projectId], queryFn: () => nexusApi.projectMembers(projectId), staleTime: 60_000, retry: false });
  const members = useMemo(() => {
    const raw = membersQ.data;
    const arr = Array.isArray(raw) ? raw : raw?.members ?? [];
    return arr.map((m) => m.user).filter(Boolean) as NexusUser[];
  }, [membersQ.data]);

  const cfDefsQ = useQuery({ queryKey: ["nexus", "project-custom-fields", projectId], queryFn: () => nexusApi.projectCustomFields(projectId), staleTime: 60_000, retry: false });
  const cfDefs = useMemo(() => cfDefsQ.data?.fields ?? [], [cfDefsQ.data]);
  const cfById = useMemo(() => new Map(cfDefs.map((f) => [f.id, f])), [cfDefs]);

  const setColumns = (next: string[]) => {
    if (!canEditColumns) { toast(t("Only project members can change a shared view. Make a personal copy to set it up your way.")); return; }
    onColumnsChange(next);
  };

  // Which header's "+" menu is open: with groups every group repeats the column names (Notion), each with its own "+".
  const [addOpen, setAddOpenKey] = useState<string | null>(null);
  const [addingField, setAddingField] = useState(false);
  const createField = useMutation({
    mutationFn: (p: { name: string; type: string; options: NexusCustomFieldOptions | null }) => nexusApi.createCustomField(projectId, p),
    onSuccess: (res) => {
      setAddingField(false);
      qc.invalidateQueries({ queryKey: ["nexus", "project-custom-fields", projectId] });
      const id = res?.field?.id;
      if (id) setColumns([...columns, `cf:${id}`]);
    },
    onError: (e) => toast.error(t("Couldn't create the field"), { description: e instanceof Error ? e.message : undefined }),
  });

  const available = defs.filter((d) => d.key !== "title" && !d.hidden && !columns.includes(d.key));

  // task edit helpers (invalidate on success — the table refetches the project)
  // Optimistic (perf pass, 12 Oct 2026): the cell shows the new value at once; an error puts the old one back.
  const patchTask = async (taskId: string, payload: Parameters<typeof nexusApi.updateTask>[1]) => {
    await holdProject(qc, projectId);
    const { title, status, priority, dueDate, tags } = payload as Partial<NexusTask>;
    const patch = Object.fromEntries(Object.entries({ title, status, priority, dueDate, tags, startDate: (payload as { startDate?: string | null }).startDate }).filter(([, v]) => v !== undefined));
    const rollback = Object.keys(patch).length ? patchTaskInCaches(qc, taskId, patch, { moveToListId: payload.taskListId }) : null;
    try { await nexusApi.updateTask(taskId, payload); invalidate(); } catch (e) { rollback?.(); toast.error(t("Couldn't save the change"), { description: e instanceof Error ? e.message : undefined }); }
  };
  const toggleAssignee = async (taskId: string, userId: string, has: boolean) => {
    try { has ? await nexusApi.removeAssignee(taskId, userId) : await nexusApi.addAssignee(taskId, userId); invalidate(); } catch { toast.error(t("Couldn't save the change")); }
  };
  const setCf = async (fieldId: string, taskId: string, value: unknown, prev?: unknown) => {
    try { await nexusApi.saveCustomFieldValue(fieldId, taskId, value, prev); invalidate(); qc.invalidateQueries({ queryKey: ["gideon-autofill", projectId] }); } catch { toast.error(t("Couldn't save the change")); }
  };
  // ✨ on AI Autofill columns and on the values GIDEON wrote (a person's edit makes a value theirs again).
  const ai = useAutofillMarks(projectId);

  // Multi-select (owner, 11 Oct 2026): ⌘/Ctrl+click or Shift+click a row, right-click for Duplicate.
  const bulk = useTaskBulk();
  const sections = useMemo(() => [...(project.taskLists ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)), [project.taskLists]);

  // Rows drag between groups by their grip (multi-drag, 12 Oct 2026), when the grouping can be written by a drop.
  const sub = groupBy && subGroupBy && subGroupBy !== groupBy ? subGroupBy : null;
  const viewTasks = useMemo(() => groups.flatMap((g) => g.tasks), [groups]);
  const mover = useGroupMove({ project, defs, groupBy, sub, viewTasks });
  // Phone/iPad: hold the row's grip, then drag (views/touch-drag.ts), like Board and List.
  useTouchDrag();
  const dropRing = "ring-2 ring-inset ring-[color:var(--accent-foreground)]/40";

  // Column widths a person dragged (UI tour run 9: "Tanggal Pe…" could not be read). Per project, in this
  // browser only: a width is a reading preference, not project data. Untouched columns keep sharing the space.
  const widthKey = `nexus.table-col-widths.${projectId}`;
  const [colW, setColW] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(widthKey) ?? "{}") as Record<string, number>; } catch { return {}; }
  });
  const startResize = (e: React.PointerEvent, key: string) => {
    e.preventDefault(); e.stopPropagation();
    const cell = (e.currentTarget as HTMLElement).parentElement;
    const startX = e.clientX;
    const startW = cell?.getBoundingClientRect().width ?? 140;
    let last = startW;
    const move = (ev: PointerEvent) => { last = Math.round(Math.min(640, Math.max(90, startW + ev.clientX - startX))); setColW((w) => ({ ...w, [key]: last })); };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      setColW((w) => { const next = { ...w, [key]: last }; try { localStorage.setItem(widthKey, JSON.stringify(next)); } catch { /* private mode */ } return next; });
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const resetWidth = (key: string) => setColW((w) => { const next = { ...w }; delete next[key]; try { localStorage.setItem(widthKey, JSON.stringify(next)); } catch { /* private mode */ } return next; });
  // A column is at least as wide as its name (UI tour run 14, WD-1: "Tanggal Pengg…" could not be read).
  // Phone: a narrower Name column, so the next column peeks in past Assignee and the table reads as one
  // that scrolls sideways (WM-9: Name and Assignee filled the box exactly and looked like the whole table).
  // Run 19 (R19-WM-4, Notion): the Name column is the widest on a phone too, about 55% of the screen, so two-line
  // names read whole; the next column still peeks in and the rest scroll sideways.
  const isPhone = useIsMobile();
  // UI round 19 Oct 2026 (U-9, like Notion mobile): on a phone the Name column is frozen and narrow (120 px, title on
  // two lines with an ellipsis), so the other columns scroll under it and more of them show. Desktop unchanged.
  // A name wraps between words and never breaks one ("Menung / gu", Q-1, as iOS): the column is at least as wide
  // as the longest single word among the rows, plus the cell's paddings, grip and open arrow, up to a cap.
  const fontsReady = useFontsReady();
  const longestWord = useMemo(() => longestWordWidth(viewTasks.map((x) => x.title), isPhone ? 13 : 14),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewTasks, isPhone, fontsReady]);
  const nameChrome = (isPhone ? 38 : 50) + (mover.enabled ? (isPhone ? 30 : 18) : 0);
  const nameCap = isPhone ? Math.max(120, Math.round((typeof window === "undefined" ? 390 : window.innerWidth) * 0.55)) : 480;
  const nameW = Math.min(nameCap, Math.max(isPhone ? 120 : 280, Math.ceil(longestWord * 1.04 + nameChrome)));
  const frozen = isPhone ? "sticky left-0 z-[1] border-r border-border bg-card" : "";
  const colMin = (k: string) => colW[k] ?? Math.min(280, Math.max(160, Math.ceil(64 + propLabel(propDef(defs, k)).length * 6.8)));
  const gridTemplate = `${isPhone ? `${nameW}px` : `minmax(${nameW}px,2fr)`} ${columns.map((k) => (colW[k] ? `${colW[k]}px` : `minmax(${colMin(k)}px,1fr)`)).join(" ")} 40px`;
  const rowIn = (gKey: string | null, subKey: string | null) => (task: NexusTask) => row(task, mover.enabled && gKey !== null && canDragTask(task, projectId)
    ? <DragHandle onDragStart={(e) => mover.startDrag(e, task, gKey, subKey)} onDragEnd={mover.endDrag} className="group-hover:opacity-100" />
    : null);
  const row = (task: NexusTask, handle: ReactNode = null) => (
    // One row height for every row (UI tour run 14, WD-11: a link or file cell made some rows taller), and a cell
    // never grows the row. From md a denser 36px row with the name on one line, as Notion (UI tour run 20, R20-WD-7:
    // rows were ~48px); a phone keeps two lines of name.
    <div key={task.id} {...bulk.bindRow(task)} className={cn("group grid h-12 md:h-9 snap-start items-stretch border-b border-border text-sm hover:bg-muted/40", bulk.isSelected(task.id) && "bg-accent")} style={{ gridTemplateColumns: gridTemplate }}>
      <NameCell key={task.title} task={task} handle={handle} onRename={(title) => patchTask(task.id, { title })} onOpen={() => onOpen(task)} className={cn(frozen, isPhone && bulk.isSelected(task.id) && "bg-accent")} />
      {columns.map((key) => (
        <div key={key} className="relative flex min-w-0 items-center overflow-hidden border-l border-border px-1.5 py-1 [&>*]:min-w-0 [&>*]:flex-1">
          {key.startsWith("cf:") && ai.isMarked(key.slice(3), task.id) && <Sparkles aria-label={t("Filled by GIDEON")} className="pointer-events-none absolute right-1 top-1 h-3 w-3 text-primary/70" />}
          <Cell colKey={key} task={task} members={members} cfById={cfById} sections={sections} projectId={projectId} patchTask={patchTask} toggleAssignee={toggleAssignee} setCf={setCf} />
        </div>
      ))}
      <div className="grid place-items-center border-l border-border">
        <button type="button" onClick={() => onOpen(task)} title={t("Open")} aria-label={t("Open")} className="text-muted-foreground hover:text-foreground"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const edgeFade = useEdgeFade(scrollRef, [columns.length], true);
  const groupRow = (g: TaskGroup, by: string | null, key: string, depth: number) => (
    // w-fit: a heading as wide as the whole table could not stay pinned, so it scrolled away sideways and left a
    // blank band between the groups (QA 16 Oct 2026, phone and any table wider than the screen).
    <div className={cn("sticky left-0 flex w-fit snap-start items-center bg-card px-0.5 pb-1.5 pt-4", depth > 0 && "pl-6 pt-2")}>
      <GroupHeader group={g} groupBy={by} defs={defs} cfg={cfg} collapsed={collapsed.has(key)} onToggle={() => onToggleGroup(key)} />
    </div>
  );

  // The column names. Ungrouped: once, pinned at the top. Grouped: under each group's heading, as Notion repeats
  // them, pinned while that group scrolls by (a sticky row only sticks inside its own group).
  // Notion's column names: 14px in the page's grey, a type glyph before each, on the open canvas (no boxed card
  // around the table, 16 Oct 2026 pass).
  const headerRow = (hk: string) => (
          <div key={`head-${hk}`} className={cn("sticky top-0 z-[1] grid h-9 items-stretch border-b border-border bg-card text-sm text-muted-foreground", hk !== "all" && "border-t")} style={{ gridTemplateColumns: gridTemplate }}>
            <div className={cn("flex items-center gap-1.5 py-2", isPhone ? "z-[2] px-2" : "px-3", frozen)}><PropIcon def={propDef(defs, "title")} />{t("Name")}</div>
            {columns.map((key) => {
              const def = propDef(defs, key);
              return (
                <div key={key} className="group relative flex items-center justify-between gap-1 border-l border-border px-3 py-2">
                  {(() => {
                    const label = <span className="flex min-w-0 items-center gap-1.5" title={propLabel(def)}><PropIcon def={def} /><span className="truncate">{propLabel(def)}</span>{key.startsWith("cf:") && ai.aiFields.has(key.slice(3)) && <Sparkles aria-label={t("AI Autofill")} className="h-3 w-3 shrink-0 text-primary" />}</span>;
                    // A number field's name opens its Number settings (format, decimals, Show as), as in Notion.
                    const field = key.startsWith("cf:") ? cfById.get(key.slice(3)) : undefined;
                    if (!field || (field.type ?? "").toUpperCase() !== "NUMBER" || !canEditColumns) return label;
                    return <NumberHeaderSettings field={field} projectId={projectId}>{label}</NumberHeaderSettings>;
                  })()}
                  {canEditColumns && <button type="button" onClick={() => setColumns(columns.filter((c) => c !== key))} title={t("Hide column")} aria-label={t("Hide column")} className="tap-area opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:hidden"><X className="h-3 w-3" /></button>}
                  {/* Drag the edge to resize; double-click puts the column back to its shared width. */}
                  <span role="separator" aria-orientation="vertical" aria-label={t("Resize column")} title={t("Drag to resize, double-click to reset")}
                    onPointerDown={(e) => startResize(e, key)} onDoubleClick={() => resetWidth(key)}
                    className="absolute -right-1 top-0 z-[2] h-full w-2 cursor-col-resize touch-none after:absolute after:inset-y-1 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded after:bg-transparent hover:after:bg-[color:var(--accent-foreground)]/50" />
                </div>
              );
            })}
            <div className="border-l border-border">
              <Popover open={addOpen === hk} onOpenChange={(o) => setAddOpenKey(o ? hk : null)}>
                <PopoverTrigger asChild>
                  <button type="button" title={t("Add column")} aria-label={t("Add column")} disabled={!canEditColumns} className="grid h-full w-full place-items-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-1">
                  <div className="max-h-64 overflow-y-auto">
                    {available.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t("Every property is already a column.")}</p>}
                    {available.map((a) => (
                      <button key={a.key} type="button" onClick={() => { setColumns([...columns, a.key]); setAddOpenKey(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
                        <PropIcon def={a} /> {propLabel(a)}
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => { setAddOpenKey(null); setAddingField(true); }} className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-border px-2 py-2 text-left text-sm font-medium text-[color:var(--accent-foreground)] hover:bg-muted"><Plus className="h-3.5 w-3.5" /> {t("New custom field")}</button>
                </PopoverContent>
              </Popover>
            </div>
          </div>
  );
  return (
    <div data-touch-drag-root="" className="nx-gx py-3">
      {/* Phone: the table is its own vertical scroller, as tall as the screen between the pinned project header
          and the tab bar. A sticky header row only sticks inside the box that scrolls, and this box already
          scrolls sideways, so with the page doing the vertical scrolling the column names left with the first
          rows (UI tour run 12, WM3). */}
      {/* Desktop too (UI tour run 13, W-D1): the table scrolls inside a box as tall as the screen under the
          project header, so the column names stay pinned past the first screen. The edge that has more columns
          fades (W-D2: "Kategori" ended hard at the edge). Phone: the box runs down to the tab bar (W-M23). */}
      {/* Rows snap whole under the pinned column names (UI tour run 15, R15-WB-1 / R15-WM-3); the header row
          has a set height so the snap offset is exact. */}
      <div className="relative">
      {/* The header's right end says when more columns lie that way (UI tour run 20, R20-WM-6: a glyph sliver of
          the third column's name sat at the edge); the rows keep their fade. */}
      <EdgeArrows target={scrollRef} sides="right" className="right-0 top-px h-[35px]" />
      <div ref={scrollRef} data-snap-box style={{ "--snap-box-head": "36px" } as CSSProperties} className={cn("overflow-auto overscroll-x-contain", !groupBy && "border-t border-border", "max-h-[max(20rem,calc(100dvh-10rem))] max-md:max-h-[max(16rem,calc(100dvh-var(--tabbar-room)-8rem))]", edgeFade)}>
        {/* Width from the columns' minimums, never from cell contents (perf pass, 12 Oct 2026): with min-w-max a
            row that loaded wider content widened every column and the header jumped. */}
        <div className="w-full" style={{ minWidth: nameW + columns.reduce((n, k) => n + colMin(k), 0) + 40 }}>
          {!groupBy && headerRow("all")}

          {groups.map((g) => {
            if (!groupBy) return <div key={g.key}><Incremental items={g.tasks} first={40} step={25} keyOf={(x) => x.id} render={(task) => row(task)} />{newRow("all", null, null)}</div>;
            const subs = subGroupBy && subGroupBy !== groupBy ? buildGroups(g.tasks, subGroupBy, { keepHidden: true }).filter((x) => x.tasks.length > 0) : null;
            const zone = mover.dropZone(g.key, null);
            return (
              <div key={g.key} {...zone.props} className={cn(zone.isOver && dropRing)}>
                {groupRow(g, groupBy, g.key, 0)}
                {!collapsed.has(g.key) && (subs
                  ? subs.map((s) => {
                    const k = `${g.key}/${s.key}`;
                    const subZone = mover.dropZone(g.key, s.key);
                    return <div key={k} {...subZone.props} className={cn(subZone.isOver && dropRing)}>{groupRow(s, subGroupBy, k, 1)}{!collapsed.has(k) && <>{headerRow(k)}<Incremental items={s.tasks} first={40} step={25} keyOf={(x) => x.id} render={rowIn(g.key, s.key)} />{newRow(k, g.key, s.key)}</>}</div>;
                  })
                  : <>{headerRow(g.key)}{g.tasks.length ? <Incremental items={g.tasks} first={40} step={25} keyOf={(x) => x.id} render={rowIn(g.key, null)} /> : null}{newRow(g.key, g.key, null)}</>)}
              </div>
            );
          })}

          {/* Footer: a calculation per column (Notion's "Calculate"). Sum, Average… keep the number's format. */}
          {/* A short fade above it, so a row cut by the footer fades out instead of ending in half a line (R15-WM-3). */}
          <div className="sticky bottom-0 z-[1] grid items-stretch border-t border-border bg-card text-xs text-muted-foreground before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-4 before:bg-gradient-to-t before:from-card before:to-transparent before:content-['']" style={{ gridTemplateColumns: gridTemplate }}>
            <div className={frozen} />
            {columns.map((key) => (
              <FooterCalc key={key} def={propDef(defs, key)} tasks={viewTasks} calc={cfg.columnCalcs?.[key]} readOnly={!onCalcsChange || !canEditColumns}
                onPick={(c) => {
                  const next = { ...(cfg.columnCalcs ?? {}) };
                  if (c) next[key] = c; else delete next[key];
                  onCalcsChange?.(next);
                }} />
            ))}
            <div />
          </div>
        </div>
      </div>
      </div>

      {addingField && (
        <div className="fixed inset-0 z-50 grid grid-cols-1 place-items-center bg-foreground/30 dark:bg-scrim p-4 backdrop-blur-sm" onClick={() => setAddingField(false)}>
      <EscClose onClose={() => setAddingField(false)} />
          <div role="dialog" aria-modal="true" aria-label={t("New field")} className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <FieldEditor saving={createField.isPending} onSave={(p) => createField.mutate(p)} onCancel={() => setAddingField(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Bumps once the web fonts have loaded, so a measurement taken with the fallback font is redone in Inter. */
function useFontsReady(): boolean {
  const [ready, setReady] = useState(() => typeof document === "undefined" || document.fonts?.status === "loaded");
  useEffect(() => {
    if (ready || typeof document === "undefined" || !document.fonts) return;
    let live = true;
    document.fonts.ready.then(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, [ready]);
  return ready;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** The widest single word (as the name cell draws it, dash glued to the next word) across titles, in px. */
function longestWordWidth(titles: string[], px: number): number {
  if (typeof document === "undefined") return 0;
  if (measureCtx === undefined) measureCtx = document.createElement("canvas").getContext("2d");
  const ctx = measureCtx;
  if (!ctx) return 0;
  ctx.font = `400 ${px}px ${getComputedStyle(document.body).fontFamily}`;
  const seen = new Set<string>();
  let max = 0;
  for (const title of titles) {
    for (const word of glueDash(title ?? "").split(/[ \t\n]+/)) {
      if (!word || seen.has(word)) continue;
      seen.add(word);
      max = Math.max(max, ctx.measureText(word).width);
    }
  }
  return max;
}

function questXp(task: NexusTask): number {
  return (task.quests ?? []).reduce((s, q) => s + (q.xpReward ?? 0), 0);
}

function NameCell({ task, handle, onRename, onOpen, className }: { task: NexusTask; handle?: ReactNode; onRename: (title: string) => void; onOpen: () => void; className?: string }) {
  const { t } = useLang();
  const [title, setTitle] = useState(task.title);
  const [editing, setEditing] = useState(false);
  const done = task.status === "DONE";
  const xp = questXp(task);
  const filteredOut = useFilteredOut(task.id);
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5 px-2 py-1 max-md:px-1", handle && "gap-1 pl-0.5", className)}>
      {handle}
      {editing ? (
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => { setEditing(false); const t = title.trim(); if (t && t !== task.title) onRename(t); else if (!t) setTitle(task.title); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setTitle(task.title); setEditing(false); } }}
          aria-label={t("Name")}
          className="min-w-0 flex-1 rounded-md border border-primary bg-background px-1.5 py-1 text-sm font-medium outline-none"
        />
      ) : (
        // The name wraps to two lines before it is cut (UI tour run 14, WB-12: names that start alike,
        // "REIMBURSE PATS SPOR…", read the same on every row). A click edits it, as the field did.
        <button
          type="button"
          onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; setEditing(true); }}
          title={task.title}
          // Breaks between words only, never inside one (Q-1: the column is sized to the longest word), and a
          // spaced dash stays with the word after it, so a clamp never ends on "–…" (UI tour run 17, R17-WM-2).
          className={cn("line-clamp-2 md:line-clamp-1 min-w-0 flex-1 rounded-md border border-transparent px-1.5 py-0.5 text-left text-sm leading-snug [overflow-wrap:normal] [word-break:normal] [hyphens:none] hover:border-border max-md:px-1 max-md:text-[13px]", done && "text-muted-foreground line-through")}
        >
          {glueDash(title)}
        </button>
      )}
      {filteredOut && <FilterHint />}
      {xp > 0 && <span title={t("Quest XP")} className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">+{xp} XP</span>}
      <button onClick={onOpen} aria-label={t("Open")} title={t("Open")} className="shrink-0 text-muted-foreground/0 transition-colors hover:text-primary group-hover:text-muted-foreground"><ChevronRight className="h-3.5 w-3.5" /></button>
    </div>
  );
}

/**
 * A "Created by" field (CREATED) in the table, read-only and plain like the other cells (UI tour run 11, WD-2).
 * It held a boxed input showing "04 May 2026 • 19:19" on some rows and a name on others (a Notion import keeps
 * the requester's name as text; a task made here stores its creation time). Now: whoever is known, as plain
 * name text (the task's creator for a timestamp, the imported name otherwise; UI tour run 12, WD3: no avatar
 * pill, it read as an editable person picker); a bare date only when nobody is, short ("15 Apr", the year only
 * when it is not this one). One line, so rows keep their height.
 */
function CreatedCell({ raw, task, members }: { raw: string; task: NexusTask; members: NexusUser[] }) {
  const { locale } = useLang();
  const directory = useUserLookup();
  const text = raw.trim();
  const when = /^\d{4}-\d{2}-\d{2}/.test(text) ? new Date(text) : null;
  const isTime = !!when && !Number.isNaN(when.getTime());
  const byName = !isTime && text ? members.find((m) => (m.name ?? "").trim().toLowerCase() === text.toLowerCase()) : undefined;
  const creatorId = task.creatorId ?? null;
  const creator = creatorId ? members.find((m) => m.id === creatorId) ?? (directory.get(creatorId) ? { id: creatorId, ...directory.get(creatorId)! } : null) : null;
  const person = isTime ? creator : byName ?? (text ? { id: "", name: text, avatar: null } : null);
  // Empty cells are blank (decision 21, UI tour run 20, R20-WD-7); only the summary row says "—".
  let body: ReactNode = null;
  if (person?.name) {
    body = (
      <span className="truncate text-sm" title={isTime ? `${person.name} · ${when!.toLocaleString(locale, { timeZone: "Asia/Jakarta" })}` : person.name}>{person.name}</span>
    );
  } else if (isTime) {
    const sameYear = when!.getFullYear() === new Date().getFullYear();
    body = <span className="truncate text-sm tabular-nums">{when!.toLocaleDateString(locale, { timeZone: "Asia/Jakarta", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })}</span>;
  }
  return <div className="flex min-h-8 min-w-0 items-center whitespace-nowrap px-1.5">{body}</div>;
}

function Cell({ colKey, task, members, cfById, sections, projectId, patchTask, toggleAssignee, setCf }: {
  colKey: string;
  task: NexusTask;
  members: NexusUser[];
  cfById: Map<string, NexusCustomField>;
  sections: NonNullable<NexusProject["taskLists"]>;
  projectId: string;
  patchTask: (taskId: string, payload: Parameters<typeof nexusApi.updateTask>[1]) => void;
  toggleAssignee: (taskId: string, userId: string, has: boolean) => void;
  setCf: (fieldId: string, taskId: string, value: unknown, prev?: unknown) => void;
}) {
  const { t, locale } = useLang();
  // Cells read as text until hovered (Notion): no select chevrons, no "mm/dd/yyyy" in empty dates.

  if (colKey.startsWith("cf:")) {
    const def = cfById.get(colKey.slice(3));
    if (!def) return null;
    const rawCfv = (task.customFieldValues ?? []).find((c) => c.customFieldId === def.id);
    const raw = typeof rawCfv?.value === "string" ? rawCfv.value : "";
    const value = parseCfValue(def.type ?? "", raw);
    // MULTI_SELECT (e.g. TALENT) can hold many options — rendered inline it stretches the whole table
    // to the right. In the Table view collapse it to a compact summary + dropdown instead.
    if ((def.type ?? "").toUpperCase() === "MULTI_SELECT") {
      return <MultiSelectCell field={def} value={Array.isArray(value) ? (value as string[]) : []} onSet={(v) => setCf(def.id, task.id, v, value)} />;
    }
    if ((def.type ?? "").toUpperCase() === "CREATED") return <CreatedCell raw={raw} task={task} members={members} />;
    // key by the persisted raw value so the editor re-seeds its internal state after a save+refetch
    // (CustomFieldInput only reads field.value on mount). No focus loss: values only change on blur/select.
    return <CustomFieldInput key={raw} field={{ ...def, value: value as NexusCustomField["value"] }} projectId={projectId} hideLabel onSet={(v) => setCf(def.id, task.id, v)} />;
  }

  if (colKey === "status") {
    return (
      <SelectPicker value={task.status ?? "TODO"} onChange={(v) => patchTask(task.id, { status: v })} ariaLabel={t("Status")} className="w-full" options={TASK_STATUSES.map((s) => ({ value: s, label: statusLabel(s), color: optionColor("status", s, []) }))} />
    );
  }
  if (colKey === "priority") {
    return (
      <SelectPicker value={task.priority ?? "NONE"} onChange={(v) => patchTask(task.id, { priority: v })} ariaLabel={t("Priority")} className="w-full" options={TASK_PRIORITIES.map((p) => ({ value: p, label: statusLabel(p), color: optionColor("priority", p, []) }))} />
    );
  }
  if (colKey === "dueDate" || colKey === "due") {
    const d = task.dueDate ? localYmd(task.dueDate) : "";
    return <DateField value={d || null} onChange={(v) => patchTask(task.id, { dueDate: v })} ariaLabel={t("Due date")} placeholder="" />;
  }
  if (colKey === "start") {
    const d = task.startDate ? localYmd(task.startDate) : "";
    return <DateField value={d || null} onChange={(v) => patchTask(task.id, { startDate: v } as Parameters<typeof nexusApi.updateTask>[1])} ariaLabel={t("Start date")} placeholder="" />;
  }
  if (colKey === "section") {
    const current = task.taskListId ?? task.taskList?.id ?? "";
    // Status options (owner, 12 Oct 2026): the Notion picker; picking one moves the task there.
    if (usesStatusOptions(sections)) {
      return <StatusPicker projectId={projectId} sections={sections} value={current} onPick={(id) => patchTask(task.id, { taskListId: id, projectContextId: projectId } as Parameters<typeof nexusApi.updateTask>[1])} />;
    }
    return (
      <SelectPicker value={current} onChange={(v) => patchTask(task.id, { taskListId: v, projectContextId: projectId } as Parameters<typeof nexusApi.updateTask>[1])} ariaLabel={t("Section")} className="w-full" options={sections.map((s) => ({ value: s.id, label: s.name }))} />
    );
  }
  if (colKey === "created" || colKey === "updated") {
    const v = colKey === "created" ? task.createdAt : task.updatedAt;
    return <span className="block truncate px-1.5 py-1 text-sm text-muted-foreground">{v ? new Date(v).toLocaleDateString(locale, { day: "numeric", month: "short", ...(new Date(v).getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) }) : ""}</span>;
  }
  if (colKey === "subtasks") {
    const subs = task.subtasks ?? [];
    return <span className="block px-1.5 py-1 text-sm tabular-nums text-muted-foreground">{subs.length ? `${subs.filter((x) => x.status === "DONE").length}/${subs.length}` : ""}</span>;
  }
  if (colKey === "comments") return <span className="block px-1.5 py-1 text-sm tabular-nums text-muted-foreground">{task._count?.comments ?? 0}</span>;
  if (colKey === "assignee") return <AssigneeCell task={task} members={members} onToggle={(uid, has) => toggleAssignee(task.id, uid, has)} />;
  if (colKey === "tags") return <TagsCell task={task} onSave={(tags) => patchTask(task.id, { tags })} />;
  return null;
}

/** A stored date as the LOCAL day (a WIB midnight is the previous day in UTC). */
function localYmd(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Options list for a select/multi-select custom field (mirrors customFieldChoices in TaskDetailPanel).
function cfChoices(options: NexusCustomField["options"]): string[] {
  if (!options) return [];
  if (Array.isArray(options)) return options.map(String);
  const o = options as { options?: unknown[]; choices?: unknown[] };
  if (Array.isArray(o.options)) return o.options.map(String);
  if (Array.isArray(o.choices)) return o.choices.map(String);
  return [];
}

// Compact MULTI_SELECT cell for the Table view: a summary trigger (first pick + "+N") that opens a
// checklist popover — so a field with many options (e.g. TALENT) doesn't stretch the table sideways.
function MultiSelectCell({ field, value, onSet }: { field: NexusCustomField; value: string[]; onSet: (v: string[]) => void }) {
  const { t } = useLang();
  const choices = cfChoices(field.options);
  const selected = value.filter(Boolean);
  const toggle = (c: string) => onSet(selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c]);
  // Show any selected values even if they're no longer in the option list, so nothing silently disappears.
  const extra = selected.filter((s) => !choices.includes(s));
  const list = [...choices, ...extra];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button aria-label={field.name} className="flex w-full min-w-0 items-center gap-1 rounded-md border border-transparent px-1 py-1 text-left hover:border-border">
          {selected.length === 0 ? (
            <span className="flex-1" />
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary" title={selected.join(", ")}>{selected[0]}</span>
              {selected.length > 1 && <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-bold text-muted-foreground">+{selected.length - 1}</span>}
            </>
          )}
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-64 w-56 overflow-y-auto p-1">
        {list.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t("No options.")}</p>}
        {list.map((c) => {
          const on = selected.includes(c);
          return (
            <button key={c} onClick={() => toggle(c)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent">
              <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{on && <Check className="h-3 w-3" />}</span>
              <span className="truncate">{c}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function AssigneeCell({ task, members, onToggle }: { task: NexusTask; members: NexusUser[]; onToggle: (userId: string, has: boolean) => void }) {
  const { t } = useLang();
  const current = (task.assignees ?? []).map((a) => a.user).filter(Boolean) as NexusUser[];
  const currentIds = new Set(current.map((u) => u.id));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button aria-label={t("Assignee")} className="flex w-full items-center gap-1 rounded-md border border-transparent px-1 py-1 text-left hover:border-border">
          {current.length === 0 ? (
            <span className="h-6" />
          ) : (
            <span className="flex items-center -space-x-1.5">
              {current.slice(0, 3).map((u) => <Avatar key={u.id} userId={u.id} name={u.name} avatar={u.avatar} size={24} className="ring-card" />)}
              {current.length > 3 && <span className="grid h-6 w-6 place-items-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground ring-2 ring-card">+{current.length - 3}</span>}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-56 w-52 overflow-y-auto p-1">
        {members.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t("No members.")}</p>}
        {members.map((u) => {
          const has = currentIds.has(u.id);
          return (
            <button key={u.id} onClick={() => onToggle(u.id, has)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent">
              <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", has ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{has && <Check className="h-3 w-3" />}</span>
              <Avatar userId={u.id} name={u.name} avatar={u.avatar} size={24} className="shrink-0 ring-0" />
              <span className="truncate">{u.name ?? u.email ?? t("Member")}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

function TagsCell({ task, onSave }: { task: NexusTask; onSave: (tags: string[]) => void }) {
  const { t } = useLang();
  // Local accumulator so rapid add/remove (before the refetch lands) can't clobber an in-flight save
  // by reading a stale task.tags. Seeded once; this user's edits accumulate locally + persist each.
  const [tags, setTags] = useState<string[]>(() => (task.tags ?? []).filter(Boolean));
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    setDraft("");
    if (t && !tags.includes(t)) { const next = [...tags, t]; setTags(next); onSave(next); }
  };
  const remove = (t: string) => { const next = tags.filter((x) => x !== t); setTags(next); onSave(next); };
  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {tag}
          <button aria-label={t("Remove tag {name}", { name: tag })} onClick={() => remove(tag)} className="hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        onBlur={add}
        placeholder={tags.length === 0 ? t("Add…") : ""}
        className="min-w-[3rem] flex-1 border-none bg-transparent px-1 py-0.5 text-xs outline-none"
      />
    </div>
  );
}

/** A column's footer: "Calculate" until one is picked, then e.g. "Sum Rp 6.000.000". */
function FooterCalc({ def, tasks, calc, readOnly, onPick }: { def: PropDef | undefined; tasks: NexusTask[]; calc: ColumnCalc | undefined; readOnly: boolean; onPick: (c: ColumnCalc | null) => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const options = columnCalcsFor(def);
  const active = calc && def && options.includes(calc) ? calc : undefined;
  const value = active && def ? columnCalcValue(tasks, active, def) : "";
  const shown = active
    ? <span className="flex min-w-0 items-baseline justify-end gap-1.5"><span className="shrink-0 text-[10px] uppercase tracking-wide">{t(COLUMN_CALC_LABEL[active].short)}</span><span className="truncate text-sm tabular-nums text-foreground">{value || "—"}</span></span>
    : <span className="opacity-0 transition-opacity group-hover/foot:opacity-100 pointer-coarse:opacity-60">{t("Calculate")}</span>;
  if (readOnly || !def || options.length === 0) return <div className="flex min-w-0 items-center justify-end border-l border-border px-3 py-1.5">{active ? shown : null}</div>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="group/foot flex min-w-0 items-center justify-end border-l border-border px-3 py-1.5 text-right hover:bg-muted" aria-label={`${t("Calculate")}: ${def.builtin ? t(def.label) : def.label}`}>{shown}</button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-52 p-1">
        {([null, ...options] as Array<ColumnCalc | null>).map((c) => (
          <button key={c ?? "none"} type="button" onClick={() => { onPick(c); setOpen(false); }} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
            <span>{c ? t(COLUMN_CALC_LABEL[c].name) : t("None")}</span>
            {(c ?? undefined) === active && <Check className="h-3.5 w-3.5" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** A number column's header: its name opens the field's Number settings, saved at once for every view. */
function NumberHeaderSettings({ field, projectId, children }: { field: NexusCustomField; projectId: string; children: ReactNode }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [opts, setOpts] = useState<unknown>(field.options ?? null);
  const save = useMutation({
    mutationFn: (options: Record<string, unknown> | null) => nexusApi.updateCustomField(field.id, { options: options as NexusCustomFieldOptions | null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nexus", "project-custom-fields", projectId] });
      qc.invalidateQueries({ queryKey: ["project-custom-fields", projectId] });
      // Task payloads carry each value's field options (legacy Rupiah reading): refresh the project too.
      qc.invalidateQueries({ predicate: (q) => q.queryKey.map(String).some((k) => k === projectId) });
    },
    onError: (e) => { setOpts(field.options ?? null); toast.error(t("Couldn't save the property"), { description: e instanceof Error ? e.message : undefined }); },
  });
  return (
    <Popover onOpenChange={(o) => { if (o) setOpts(field.options ?? null); }}>
      <PopoverTrigger asChild>
        <button type="button" className="-mx-1 flex min-w-0 items-center rounded px-1 py-0.5 text-left hover:bg-muted hover:text-foreground" title={t("Edit property")}>{children}</button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1.5">
        <p className="px-2 pb-1 pt-0.5 text-xs font-medium text-muted-foreground">{field.name}</p>
        <NumberFieldSettings value={opts} onChange={(o) => { setOpts(o); save.mutate(o); }} />
      </PopoverContent>
    </Popover>
  );
}
