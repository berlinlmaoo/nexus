import { DateField } from "@/components/DateField";
import { EscClose } from "@/hooks/use-escape";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useEdgeFade } from "@/hooks/use-edge-fade";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, Plus, Sparkles, X } from "lucide-react";
import { useAutofillMarks } from "@/components/gideon/AutofillPanel";
import { useLang } from "@/lib/lang";
import { optionColor, propDef, type PropDef, type TaskGroup, type ViewConfig } from "@/lib/project-views";
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
import { cn } from "@/lib/utils";
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
export function ProjectTableView({ project, groups, groupBy, subGroupBy, buildGroups, cfg, defs, columns, canEditColumns, onColumnsChange, collapsed, onToggleGroup, onOpen, onCreateInGroup }: {
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

  const [addOpen, setAddOpen] = useState(false);
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
  const setCf = async (fieldId: string, taskId: string, value: unknown) => {
    try { await nexusApi.setCustomFieldValue(fieldId, taskId, value); invalidate(); qc.invalidateQueries({ queryKey: ["gideon-autofill", projectId] }); } catch { toast.error(t("Couldn't save the change")); }
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
  const gridTemplate = `minmax(240px,2fr) ${columns.map((k) => (colW[k] ? `${colW[k]}px` : "minmax(160px,1fr)")).join(" ")} 40px`;
  const rowIn = (gKey: string | null, subKey: string | null) => (task: NexusTask) => row(task, mover.enabled && gKey !== null && canDragTask(task, projectId)
    ? <DragHandle onDragStart={(e) => mover.startDrag(e, task, gKey, subKey)} onDragEnd={mover.endDrag} className="group-hover:opacity-100" />
    : null);
  const row = (task: NexusTask, handle: ReactNode = null) => (
    <div key={task.id} {...bulk.bindRow(task)} className={cn("group grid items-stretch border-b border-border text-sm hover:bg-muted/40", bulk.isSelected(task.id) && "bg-accent")} style={{ gridTemplateColumns: gridTemplate }}>
      <NameCell key={task.title} task={task} handle={handle} onRename={(title) => patchTask(task.id, { title })} onOpen={() => onOpen(task)} />
      {columns.map((key) => (
        <div key={key} className="relative flex min-w-0 items-center border-l border-border px-1.5 py-1 [&>*]:min-w-0 [&>*]:flex-1">
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
  const edgeFade = useEdgeFade(scrollRef, [columns.length]);
  const groupRow = (g: TaskGroup, by: string | null, key: string, depth: number) => (
    <div className={cn("sticky left-0 flex items-center border-b border-border bg-card px-1.5 py-1", depth > 0 && "pl-6")}>
      <GroupHeader group={g} groupBy={by} defs={defs} cfg={cfg} collapsed={collapsed.has(key)} onToggle={() => onToggleGroup(key)} />
    </div>
  );

  return (
    <div data-touch-drag-root="" className="px-4 py-3 md:px-8">
      {/* Phone: the table is its own vertical scroller, as tall as the screen between the pinned project header
          and the tab bar. A sticky header row only sticks inside the box that scrolls, and this box already
          scrolls sideways, so with the page doing the vertical scrolling the column names left with the first
          rows (UI tour run 12, WM3). */}
      {/* Desktop too (UI tour run 13, W-D1): the table scrolls inside a box as tall as the screen under the
          project header, so the column names stay pinned past the first screen. The edge that has more columns
          fades (W-D2: "Kategori" ended hard at the edge). Phone: the box runs down to the tab bar (W-M23). */}
      <div ref={scrollRef} className={cn("overflow-auto overscroll-x-contain rounded-lg border border-border max-h-[max(20rem,calc(100dvh-10rem))] max-md:max-h-[max(16rem,calc(100dvh-var(--tabbar-room)-8rem))]", edgeFade)}>
        {/* Width from the columns' minimums, never from cell contents (perf pass, 12 Oct 2026): with min-w-max a
            row that loaded wider content widened every column and the header jumped. */}
        <div className="w-full" style={{ minWidth: 240 + columns.reduce((n, k) => n + (colW[k] ?? 160), 0) + 40 }}>
          {/* Header row */}
          <div className="sticky top-0 z-[1] grid items-stretch border-b border-border bg-card text-xs text-muted-foreground" style={{ gridTemplateColumns: gridTemplate }}>
            <div className="flex items-center gap-1.5 px-3 py-2"><PropIcon def={propDef(defs, "title")} />{t("Name")}</div>
            {columns.map((key) => {
              const def = propDef(defs, key);
              return (
                <div key={key} className="group relative flex items-center justify-between gap-1 border-l border-border px-3 py-2">
                  <span className="flex min-w-0 items-center gap-1.5" title={propLabel(def)}><PropIcon def={def} /><span className="truncate">{propLabel(def)}</span>{key.startsWith("cf:") && ai.aiFields.has(key.slice(3)) && <Sparkles aria-label={t("AI Autofill")} className="h-3 w-3 shrink-0 text-primary" />}</span>
                  {canEditColumns && <button type="button" onClick={() => setColumns(columns.filter((c) => c !== key))} title={t("Hide column")} aria-label={t("Hide column")} className="tap-area opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:hidden"><X className="h-3 w-3" /></button>}
                  {/* Drag the edge to resize; double-click puts the column back to its shared width. */}
                  <span role="separator" aria-orientation="vertical" aria-label={t("Resize column")} title={t("Drag to resize, double-click to reset")}
                    onPointerDown={(e) => startResize(e, key)} onDoubleClick={() => resetWidth(key)}
                    className="absolute -right-1 top-0 z-[2] h-full w-2 cursor-col-resize touch-none after:absolute after:inset-y-1 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded after:bg-transparent hover:after:bg-[color:var(--accent-foreground)]/50" />
                </div>
              );
            })}
            <div className="border-l border-border">
              <Popover open={addOpen} onOpenChange={setAddOpen}>
                <PopoverTrigger asChild>
                  <button type="button" title={t("Add column")} aria-label={t("Add column")} disabled={!canEditColumns} className="grid h-full w-full place-items-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-1">
                  <div className="max-h-64 overflow-y-auto">
                    {available.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted-foreground">{t("Every property is already a column.")}</p>}
                    {available.map((a) => (
                      <button key={a.key} type="button" onClick={() => { setColumns([...columns, a.key]); setAddOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
                        <PropIcon def={a} /> {propLabel(a)}
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => { setAddOpen(false); setAddingField(true); }} className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-border px-2 py-2 text-left text-sm font-medium text-[color:var(--accent-foreground)] hover:bg-muted"><Plus className="h-3.5 w-3.5" /> {t("New custom field")}</button>
                </PopoverContent>
              </Popover>
            </div>
          </div>

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
                    return <div key={k} {...subZone.props} className={cn(subZone.isOver && dropRing)}>{groupRow(s, subGroupBy, k, 1)}{!collapsed.has(k) && <><Incremental items={s.tasks} first={40} step={25} keyOf={(x) => x.id} render={rowIn(g.key, s.key)} />{newRow(k, g.key, s.key)}</>}</div>;
                  })
                  : <>{g.tasks.length ? <Incremental items={g.tasks} first={40} step={25} keyOf={(x) => x.id} render={rowIn(g.key, null)} /> : null}{newRow(g.key, g.key, null)}</>)}
              </div>
            );
          })}
        </div>
      </div>

      {addingField && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 dark:bg-scrim p-4 backdrop-blur-sm" onClick={() => setAddingField(false)}>
      <EscClose onClose={() => setAddingField(false)} />
          <div role="dialog" aria-modal="true" aria-label={t("New field")} className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <FieldEditor saving={createField.isPending} onSave={(p) => createField.mutate(p)} onCancel={() => setAddingField(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

function questXp(task: NexusTask): number {
  return (task.quests ?? []).reduce((s, q) => s + (q.xpReward ?? 0), 0);
}

function NameCell({ task, handle, onRename, onOpen }: { task: NexusTask; handle?: ReactNode; onRename: (title: string) => void; onOpen: () => void }) {
  const { t } = useLang();
  const [title, setTitle] = useState(task.title);
  const done = task.status === "DONE";
  const xp = questXp(task);
  const filteredOut = useFilteredOut(task.id);
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5 px-2 py-1.5", handle && "gap-1 pl-0.5")}>
      {handle}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => { const t = title.trim(); if (t && t !== task.title) onRename(t); else if (!t) setTitle(task.title); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        title={task.title}
        // An ellipsis where the name is cut (UI tour run 7: phone names stopped mid-word with no sign).
        className={cn("min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium outline-none hover:border-border focus:border-primary focus:bg-background", done && "text-muted-foreground line-through")}
      />
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
  let body: ReactNode = <span className="text-muted-foreground/60">—</span>;
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
  setCf: (fieldId: string, taskId: string, value: unknown) => void;
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
      return <MultiSelectCell field={def} value={Array.isArray(value) ? (value as string[]) : []} onSet={(v) => setCf(def.id, task.id, v)} />;
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
    return <DateField value={d || null} onChange={(v) => patchTask(task.id, { dueDate: v })} ariaLabel={t("Due date")} />;
  }
  if (colKey === "start") {
    const d = task.startDate ? localYmd(task.startDate) : "";
    return <DateField value={d || null} onChange={(v) => patchTask(task.id, { startDate: v } as Parameters<typeof nexusApi.updateTask>[1])} ariaLabel={t("Start date")} />;
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
    return <span className="block truncate px-1.5 py-1 text-sm text-muted-foreground">{v ? new Date(v).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : "—"}</span>;
  }
  if (colKey === "subtasks") {
    const subs = task.subtasks ?? [];
    return <span className="block px-1.5 py-1 text-sm tabular-nums text-muted-foreground">{subs.length ? `${subs.filter((x) => x.status === "DONE").length}/${subs.length}` : "—"}</span>;
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
        <button className="flex w-full min-w-0 items-center gap-1 rounded-md border border-transparent px-1 py-1 text-left hover:border-border">
          {selected.length === 0 ? (
            <span className="flex-1 text-xs text-muted-foreground">—</span>
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
        <button className="flex w-full items-center gap-1 rounded-md border border-transparent px-1 py-1 text-left hover:border-border">
          {current.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
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
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
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
