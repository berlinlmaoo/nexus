import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { NexusProject, NexusTask } from "@/lib/nexus-api";

/**
 * Optimistic task edits (perf pass, 12 Oct 2026). A click on a card's circle, a drag to another column,
 * a status picked in the task popup or a rename lands on screen at once: the change is written into every
 * cached copy of the task first, and the server's answer (a refetch of the project) confirms it a moment
 * later. On an error the snapshot comes back.
 *
 * Copies of a task in the cache:
 *  - ["nexus","project",<id>]                → taskLists[].tasks[] (Board, List, Table, Calendar, Timeline)
 *  - ["nexus","project-calendar-tasks",<id>] → a flat array (subtasks, Calendar)
 *  - ["task",<taskId>]                       → the popup's detail
 */
export type TaskPatch = Partial<NexusTask>;

type Snapshot = Array<[QueryKey, unknown]>;

/**
 * Where the server puts a Done task whose Done tick is undone (owner, 27 Oct 2026, option B; the rule is
 * lib/status-sections.ts undoneTarget): the status and section it had right before Done, when known, else To Do
 * where it is. For the optimistic step only; the refetch after the write shows what the server did.
 */
export function undonePlacement(task: Pick<NexusTask, "statusBeforeDone" | "taskListIdBeforeDone">): { status: string; listId: string | null } {
  const before = task.statusBeforeDone;
  if (!before || before === "DONE" || before === "CANCELLED") return { status: "TODO", listId: null };
  return { status: before, listId: task.taskListIdBeforeDone ?? null };
}

function patchTaskObj(t: NexusTask, patch: TaskPatch): NexusTask {
  return { ...t, ...patch };
}

/**
 * Apply `patch` to task `taskId` everywhere it is cached. `moveToListId` also moves it into that section of
 * the project payload (a drag between status columns, or a status change that the server answers by moving
 * the card). Returns a rollback.
 */
export function patchTaskInCaches(qc: QueryClient, taskId: string, patch: TaskPatch, opts: { moveToListId?: string | null } = {}): () => void {
  const snap: Snapshot = [];
  const remember = (key: QueryKey, data: unknown) => snap.push([key, data]);

  for (const [key, data] of qc.getQueriesData<NexusProject>({ queryKey: ["nexus", "project"] })) {
    if (key.length !== 3 || !data?.taskLists) continue;
    let found: NexusTask | null = null;
    for (const l of data.taskLists) { const t = l.tasks?.find((x) => x.id === taskId); if (t) { found = t; break; } }
    if (!found) continue;
    remember(key, data);
    const next = patchTaskObj(found, patch);
    const target = opts.moveToListId && data.taskLists.some((l) => l.id === opts.moveToListId) ? opts.moveToListId : null;
    qc.setQueryData<NexusProject>(key, {
      ...data,
      taskLists: data.taskLists.map((l) => {
        const has = l.tasks?.some((x) => x.id === taskId);
        if (target && l.id === target && !has) {
          const moved = { ...next, taskListId: target, taskList: next.taskList ? { ...next.taskList, id: target, name: l.name } : next.taskList };
          return { ...l, tasks: [moved, ...(l.tasks ?? [])] };
        }
        if (!has) return l;
        if (target && l.id !== target) return { ...l, tasks: (l.tasks ?? []).filter((x) => x.id !== taskId) };
        return { ...l, tasks: (l.tasks ?? []).map((x) => (x.id === taskId ? next : x)) };
      }),
    });
  }

  for (const [key, data] of qc.getQueriesData<NexusTask[]>({ queryKey: ["nexus", "project-calendar-tasks"] })) {
    if (!Array.isArray(data) || !data.some((x) => x.id === taskId)) continue;
    remember(key, data);
    qc.setQueryData<NexusTask[]>(key, data.map((x) => (x.id === taskId ? { ...patchTaskObj(x, patch), ...(opts.moveToListId ? { taskListId: opts.moveToListId } : {}) } : x)));
  }

  const detailKey = ["task", taskId];
  const detail = qc.getQueryData<NexusTask>(detailKey);
  if (detail) {
    remember(detailKey, detail);
    qc.setQueryData<NexusTask>(detailKey, patchTaskObj(detail, patch));
  }

  return () => { for (const [key, data] of snap) qc.setQueryData(key, data); };
}

/** Put a not-yet-saved card at the top (or end) of a section, so a new task shows the moment Enter is pressed. */
export function insertDraftTask(qc: QueryClient, projectId: string, listId: string, task: NexusTask, placement: "top" | "bottom" = "top"): () => void {
  const key = ["nexus", "project", projectId];
  const data = qc.getQueryData<NexusProject>(key);
  if (!data?.taskLists?.some((l) => l.id === listId)) return () => {};
  qc.setQueryData<NexusProject>(key, { ...data, taskLists: data.taskLists.map((l) => (l.id === listId ? { ...l, tasks: placement === "top" ? [task, ...(l.tasks ?? [])] : [...(l.tasks ?? []), task] } : l)) });
  return () => {
    const cur = qc.getQueryData<NexusProject>(key);
    if (cur?.taskLists) qc.setQueryData<NexusProject>(key, { ...cur, taskLists: cur.taskLists.map((l) => ({ ...l, tasks: (l.tasks ?? []).filter((x) => x.id !== task.id) })) });
  };
}

/** Stop refetches already in flight for a project, so an older answer can't overwrite the optimistic copy. */
export async function holdProject(qc: QueryClient, projectId: string | null | undefined) {
  if (!projectId) return;
  await Promise.all([
    qc.cancelQueries({ queryKey: ["nexus", "project", projectId] }),
    qc.cancelQueries({ queryKey: ["nexus", "project-calendar-tasks", projectId] }),
  ]);
}

/**
 * After a task write: refetch what shows that project now, and only mark the rest of the task-ish lists
 * (My Tasks, Dashboard, Calendar…) stale so they refetch when next opened — instead of refetching every
 * query whose key mentions "task" or "project" while the person is still looking at the board.
 */
export function settleTaskWrite(qc: QueryClient, projectId: string | null | undefined, taskId?: string) {
  if (projectId) {
    void qc.invalidateQueries({ queryKey: ["nexus", "project", projectId] });
    void qc.invalidateQueries({ queryKey: ["nexus", "project-calendar-tasks", projectId] });
  }
  if (taskId) void qc.invalidateQueries({ queryKey: ["task", taskId] });
  void qc.invalidateQueries({
    predicate: (q) => q.queryKey.map(String).some((k) => k.includes("task") || k.includes("dashboard")),
    refetchType: "none",
  });
}

/**
 * Task writes this tab is making right now (a multi-drag's batch move). While one runs, the realtime
 * burst of `task-updated` events it causes does not refetch the project (lib/realtime.tsx): a refetch
 * mid-batch would show half the tasks back in their old column for a moment. The write's own settle
 * refetches once at the end. Returns the "done" call (safe to call twice).
 */
let writesInFlight = 0;
export function beginTaskWrite(): () => void {
  writesInFlight++;
  let ended = false;
  return () => { if (!ended) { ended = true; writesInFlight--; } };
}
export function taskWriteInFlight(): boolean { return writesInFlight > 0; }

/** True when every cached copy of the task in a project payload already has these values (nothing to patch). */
export function taskCachesMatch(qc: QueryClient, taskId: string, patch: TaskPatch): boolean {
  const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  let seen = false;
  for (const [key, data] of qc.getQueriesData<NexusProject>({ queryKey: ["nexus", "project"] })) {
    if (key.length !== 3 || !data?.taskLists) continue;
    for (const l of data.taskLists) {
      const t = l.tasks?.find((x) => x.id === taskId);
      if (!t) continue;
      seen = true;
      for (const [k, v] of Object.entries(patch)) if (!same((t as Record<string, unknown>)[k], v)) return false;
    }
  }
  return seen;
}

// ---------------------------------------------------------------- remote task events (realtime bug 5)
//
// Someone else's task-created / task-updated / task-deleted used to refetch every query whose key contained
// "task" or "project" — the project payload, its views, custom fields, the project list, folders and pins:
// seven requests per event per open board, ~0.7-0.9 s before the card moved, and app CPU from 5% to 76% with
// six boards open (RT-13/RT-17, 13 Oct 2026). Now the event's own payload is written into the cached project
// (the server sends the full task: lib/socket-emitter.ts); a query is refetched only when the cache cannot
// be patched from it (a task this cache never had, a card moved in from another project).

type RemoteTask = Record<string, unknown> & { id: string };
type TaskListCache = NonNullable<NexusProject["taskLists"]>[number];

/** Keys of an event payload that are not card fields (or that the cache keeps in its own shape). */
const NOT_CARD_FIELDS = new Set(["taskList", "_count", "subtasks", "customFieldValues", "taskProjects", "creator", "project", "comments", "attachments", "listOrder", "parent", "followers", "dependencies"]);

function cardFields(task: RemoteTask): TaskPatch {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(task)) if (!NOT_CARD_FIELDS.has(k)) out[k] = v;
  return out as TaskPatch;
}

/** The board's order (server: position, createdAt, id). */
function before(a: NexusTask, b: NexusTask): boolean {
  const pa = typeof a.position === "number" ? a.position : 0;
  const pb = typeof b.position === "number" ? b.position : 0;
  if (pa !== pb) return pa < pb;
  const ca = a.createdAt ?? "", cb = b.createdAt ?? "";
  if (ca !== cb) return ca < cb;
  return a.id < b.id;
}

/** Insert without re-sorting anyone else: before the first card that comes after it (drafts stay put). */
function insertOrdered(tasks: NexusTask[], task: NexusTask): NexusTask[] {
  const i = tasks.findIndex((t) => !t.id.startsWith("draft-") && before(task, t));
  return i < 0 ? [...tasks, task] : [...tasks.slice(0, i), task, ...tasks.slice(i)];
}

/** Custom field values in the cache's shape (the nested definition comes from the project). */
function withFieldDefs(data: NexusProject, values: unknown): NexusTask["customFieldValues"] | undefined {
  if (!Array.isArray(values)) return undefined;
  const defs = new Map(((data as { customFields?: Array<{ id: string; name?: string; type?: string; options?: unknown }> }).customFields ?? []).map((f) => [f.id, f]));
  return values
    .filter((v): v is { customFieldId: string; value: string } => !!v && typeof (v as { customFieldId?: unknown }).customFieldId === "string")
    .map((v) => {
      const def = defs.get(v.customFieldId);
      return { customFieldId: v.customFieldId, value: v.value ?? "", ...(def ? { customField: { name: def.name, type: def.type, options: def.options as never } } : {}) };
    });
}

export type RemoteApplyResult = {
  /** Project caches that could not be patched from the event: refetch these (only these). */
  refetchProjects: Set<string>;
  /** Some flat task list (Calendar, Sheet's task column, subtasks) may be missing the change: refetch if on screen. */
  touchedProjects: Set<string>;
  /** Subtask event: the parent's subtasks/detail queries should refresh. */
  parentIds: Set<string>;
};

/**
 * An event older than what this tab already holds (race audit 16 Oct 2026, M20): two edits of one task a
 * moment apart can announce themselves in the opposite order, and applying the older one last put stale
 * values back on screen. Compared by the row's updatedAt; an event or a card without one is applied as before.
 */
export function isStaleTaskEvent(cached: { updatedAt?: string | null } | null | undefined, incoming: object): boolean {
  const at = (incoming as { updatedAt?: unknown }).updatedAt;
  const a = typeof cached?.updatedAt === "string" ? Date.parse(cached.updatedAt) : NaN;
  const b = typeof at === "string" ? Date.parse(at) : NaN;
  return Number.isFinite(a) && Number.isFinite(b) && b < a;
}

const emptyResult = (): RemoteApplyResult => ({ refetchProjects: new Set(), touchedProjects: new Set(), parentIds: new Set() });

/**
 * Apply a remote `task-created` / `task-updated` payload to every cached project, the flat task lists and the
 * open popup. Returns what still has to be refetched.
 */
export function applyRemoteTask(qc: QueryClient, kind: "created" | "updated", task: RemoteTask): RemoteApplyResult {
  const res = emptyResult();
  const patch = cardFields(task);
  const homeProject = typeof (task.taskList as { projectId?: unknown } | undefined)?.projectId === "string" ? (task.taskList as { projectId: string }).projectId : null;
  if (homeProject) res.touchedProjects.add(homeProject);
  const targetListId = typeof task.taskListId === "string" ? task.taskListId : null;
  const parentId = typeof task.parentId === "string" ? task.parentId : null;

  for (const [key, data] of qc.getQueriesData<NexusProject>({ queryKey: ["nexus", "project"] })) {
    if (key.length !== 3 || !data?.taskLists) continue;
    const pid = String(key[2]);
    if (parentId) {
      // A subtask: its parent card's "done/total" chip.
      let hit = false;
      const lists = data.taskLists.map((l) => {
        if (!l.tasks?.some((t) => t.id === parentId)) return l;
        hit = true;
        return { ...l, tasks: l.tasks.map((t) => {
          if (t.id !== parentId) return t;
          const subs = t.subtasks ?? [];
          const has = subs.some((s) => s.id === task.id);
          const row = { id: task.id, status: (task.status as string | null | undefined) ?? subs.find((s) => s.id === task.id)?.status ?? "TODO" };
          return { ...t, subtasks: has ? subs.map((s) => (s.id === task.id ? { ...s, ...row } : s)) : [...subs, row] };
        }) };
      });
      if (hit) { qc.setQueryData<NexusProject>(key, { ...data, taskLists: lists }); res.touchedProjects.add(pid); }
      continue;
    }

    let foundList: TaskListCache | null = null;
    let found: NexusTask | null = null;
    for (const l of data.taskLists) { const t = l.tasks?.find((x) => x.id === task.id); if (t) { foundList = l; found = t; break; } }
    const target = targetListId ? data.taskLists.find((l) => l.id === targetListId) ?? null : null;
    const order = task.listOrder as { taskListId?: unknown; ids?: unknown } | undefined;

    if (found && foundList) {
      if (isStaleTaskEvent(found, task)) continue;
      const next: NexusTask = { ...found, ...patch };
      if (Array.isArray(task.customFieldValues)) next.customFieldValues = withFieldDefs(data, task.customFieldValues);
      const moveTo = target && target.id !== foundList.id ? target : null;
      const leftProject = !target && targetListId && targetListId !== foundList.id && homeProject && homeProject !== pid;
      const repositioned = !moveTo && patch.position !== undefined && patch.position !== found.position;
      if (moveTo) next.taskList = { ...(found.taskList ?? {}), id: moveTo.id, name: moveTo.name };
      let lists = data.taskLists.map((l) => {
        if (l.id === foundList!.id) {
          if (moveTo || leftProject) return { ...l, tasks: (l.tasks ?? []).filter((x) => x.id !== task.id) };
          if (repositioned) return { ...l, tasks: insertOrdered((l.tasks ?? []).filter((x) => x.id !== task.id), next) };
          return { ...l, tasks: (l.tasks ?? []).map((x) => (x.id === task.id ? next : x)) };
        }
        if (moveTo && l.id === moveTo.id) return { ...l, tasks: insertOrdered((l.tasks ?? []).filter((x) => x.id !== task.id), next) };
        return l;
      });
      // A reorder sends the section's whole new order: place every card by it (not while this tab's own
      // batch move is still running — its settle refetches once at the end).
      if (order && typeof order.taskListId === "string" && Array.isArray(order.ids) && !taskWriteInFlight()) {
        const rank = new Map((order.ids as unknown[]).map((id, i) => [String(id), i]));
        lists = lists.map((l) => (l.id !== order.taskListId ? l : {
          ...l,
          tasks: [...(l.tasks ?? [])]
            .map((t) => (rank.has(t.id) ? { ...t, position: rank.get(t.id)! } : t))
            .sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER)),
        }));
      }
      qc.setQueryData<NexusProject>(key, { ...data, taskLists: lists });
      res.touchedProjects.add(pid);
      continue;
    }

    // Shown here as a linked task ("Also in projects"): its fields, never its place.
    const linked = data.taskLists.some((l) => l.taskProjects?.some((tp) => tp.task?.id === task.id));
    if (linked) {
      qc.setQueryData<NexusProject>(key, { ...data, taskLists: data.taskLists.map((l) => (!l.taskProjects?.some((tp) => tp.task?.id === task.id) ? l : {
        ...l, taskProjects: l.taskProjects!.map((tp) => (tp.task?.id === task.id ? { ...tp, task: { ...tp.task, ...patch } } : tp)),
      })) });
      res.touchedProjects.add(pid);
      continue;
    }

    if (target) {
      if (typeof task.title !== "string") { res.refetchProjects.add(pid); continue; }
      // New here (created, or moved in from another project): the payload is the full task.
      const card: NexusTask = {
        subtasks: [], quests: [], ...patch,
        customFieldValues: withFieldDefs(data, task.customFieldValues) ?? [],
        taskList: { id: target.id, name: target.name, projectId: pid },
      } as NexusTask;
      // This tab's own placeholder for the same new task (inline add): the real card replaces it.
      const lists = data.taskLists.map((l) => (l.id !== target.id ? l : {
        ...l,
        tasks: insertOrdered((l.tasks ?? []).filter((x) => x.id !== task.id && !(kind === "created" && x.id.startsWith("draft-") && x.title === card.title)), card),
      }));
      qc.setQueryData<NexusProject>(key, { ...data, taskLists: lists });
      res.touchedProjects.add(pid);
      // Values the server fills in after creating (custom fields) came along only from newer servers.
      if (!Array.isArray(task.customFieldValues) && ((data as { customFields?: unknown[] }).customFields?.length ?? 0) > 0) res.refetchProjects.add(pid);
      continue;
    }
    // Not in this cache and not for it: nothing to do (another project's event, or a task this board hides).
  }

  if (parentId) res.parentIds.add(parentId);

  // Flat lists (Calendar / Sheet task column) and the open popup: the fields that changed.
  for (const [key, data] of qc.getQueriesData<NexusTask[]>({ queryKey: ["nexus", "project-calendar-tasks"] })) {
    if (!Array.isArray(data) || !data.some((x) => x.id === task.id)) continue;
    qc.setQueryData<NexusTask[]>(key, data.map((x) => (x.id === task.id && !isStaleTaskEvent(x, task) ? { ...x, ...patch } : x)));
  }
  const detailKey = ["task", task.id];
  const detail = qc.getQueryData<NexusTask>(detailKey);
  if (detail && !isStaleTaskEvent(detail, task)) {
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (v === null || typeof v !== "object" || Array.isArray(v)) safe[k] = v;
    qc.setQueryData<NexusTask>(detailKey, { ...detail, ...safe, ...(Array.isArray(task.assignees) ? { assignees: task.assignees as NexusTask["assignees"] } : {}) });
  }
  return res;
}

/** Apply a remote `task-deleted`: the card, linked copies, a parent's subtask chip and flat lists drop it. */
export function applyRemoteTaskDeleted(qc: QueryClient, taskId: string): RemoteApplyResult {
  const res = emptyResult();
  for (const [key, data] of qc.getQueriesData<NexusProject>({ queryKey: ["nexus", "project"] })) {
    if (key.length !== 3 || !data?.taskLists) continue;
    let hit = false;
    const lists = data.taskLists.map((l) => {
      const inTasks = l.tasks?.some((t) => t.id === taskId || t.subtasks?.some((s) => s.id === taskId));
      const inLinked = l.taskProjects?.some((tp) => tp.task?.id === taskId);
      if (!inTasks && !inLinked) return l;
      hit = true;
      return {
        ...l,
        ...(l.tasks ? { tasks: l.tasks.filter((t) => t.id !== taskId).map((t) => (t.subtasks?.some((s) => s.id === taskId) ? (res.parentIds.add(t.id), { ...t, subtasks: t.subtasks.filter((s) => s.id !== taskId) }) : t)) } : {}),
        ...(l.taskProjects ? { taskProjects: l.taskProjects.filter((tp) => tp.task?.id !== taskId) } : {}),
      };
    });
    if (hit) { qc.setQueryData<NexusProject>(key, { ...data, taskLists: lists }); res.touchedProjects.add(String(key[2])); }
  }
  for (const [key, data] of qc.getQueriesData<NexusTask[]>({ queryKey: ["nexus", "project-calendar-tasks"] })) {
    if (Array.isArray(data) && data.some((x) => x.id === taskId)) qc.setQueryData<NexusTask[]>(key, data.filter((x) => x.id !== taskId));
  }
  return res;
}
