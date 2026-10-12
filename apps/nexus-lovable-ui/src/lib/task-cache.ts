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

/** Put a not-yet-saved card at the top of a section, so a new task shows the moment Enter is pressed. */
export function insertDraftTask(qc: QueryClient, projectId: string, listId: string, task: NexusTask): () => void {
  const key = ["nexus", "project", projectId];
  const data = qc.getQueryData<NexusProject>(key);
  if (!data?.taskLists?.some((l) => l.id === listId)) return () => {};
  qc.setQueryData<NexusProject>(key, { ...data, taskLists: data.taskLists.map((l) => (l.id === listId ? { ...l, tasks: [task, ...(l.tasks ?? [])] } : l)) });
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
