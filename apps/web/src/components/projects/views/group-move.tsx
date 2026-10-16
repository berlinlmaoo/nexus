import { useCallback, useRef, useState, type DragEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { useTaskBulk } from "@/components/tasks/task-bulk";
import { nexusApi, type NexusProject, type NexusTask } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { EMPTY_GROUP, propDef, sectionIdOf, taskValues, type PropDef } from "@/lib/project-views";
import { beginTaskWrite, holdProject, patchTaskInCaches, settleTaskWrite } from "@/lib/task-cache";
import { friendlyError, pushUndo } from "@/lib/task-undo";
import { cn } from "@/lib/utils";

/**
 * Moving tasks between the groups of a view by dragging (Board columns and rows, List and Table groups).
 *
 * Multi-drag (Notion/Linear, owner 12 Oct 2026): dragging a card that is part of the selection
 * (components/tasks/task-bulk.tsx) moves every selected task shown in the view; dragging a card that is
 * not selected moves just that card and drops the selection. All of them land in the cache at once
 * (one rollback), the groupings that are a task field (section/status column, status, priority) go to the
 * server as ONE POST /api/tasks/batch-move per target value, the others (assignee, tags, custom fields)
 * keep their per-task writes. A toast says how many moved, with Undo.
 */

/** Which group properties a card can be dragged between (the drop writes the new value). */
export function droppable(by: string | null | undefined, defs: PropDef[]): boolean {
  if (!by) return false;
  if (by === "section" || by === "status" || by === "priority" || by === "assignee" || by === "tags") return true;
  const d = propDef(defs, by);
  return !!d && !d.builtin && (d.kind === "select" || d.kind === "multi" || d.kind === "person");
}

/** Move a task from one group to another of property `by`: the write that makes it belong there. */
export async function moveToGroup(task: NexusTask, by: string, from: string, to: string, defs: PropDef[], projectId: string) {
  if (from === to) return;
  const none = to === EMPTY_GROUP;
  if (by === "section") return nexusApi.updateTask(task.id, { taskListId: to, projectContextId: projectId } as Parameters<typeof nexusApi.updateTask>[1]);
  if (by === "status") return nexusApi.updateTask(task.id, { status: to });
  if (by === "priority") return nexusApi.updateTask(task.id, { priority: to });
  if (by === "assignee") {
    if (from !== EMPTY_GROUP) await nexusApi.removeAssignee(task.id, from);
    if (!none) await nexusApi.addAssignee(task.id, to);
    return;
  }
  // Tags and multi / people values move relative to what is stored (race audit 16 Oct 2026, M13): the whole
  // list from this screen's copy undid what someone else added meanwhile.
  if (by === "tags") {
    return nexusApi.updateTask(task.id, { ...(from !== EMPTY_GROUP ? { removeTags: [from] } : {}), ...(none ? {} : { addTags: [to] }) });
  }
  const def = propDef(defs, by);
  if (!def || !by.startsWith("cf:")) return;
  const fieldId = by.slice(3);
  if (def.kind === "select") return nexusApi.setCustomFieldValue(fieldId, task.id, none ? "" : to);
  if (def.kind === "person" || def.kind === "multi") {
    return nexusApi.editCustomFieldValues(fieldId, task.id, { ...(from !== EMPTY_GROUP ? { removeValues: [from] } : {}), ...(none ? {} : { addValues: [to] }) });
  }
  const list = taskValues(task, by).filter((x) => x !== from);
  const next = none ? list : Array.from(new Set([...list, to]));
  return nexusApi.setCustomFieldValue(fieldId, task.id, next[0] ?? "");
}

/** Undo of moveToGroup for the groupings that aren't a plain task field: put the task's old value back. */
async function restoreGroup(orig: NexusTask, by: string, from: string, to: string) {
  if (by === "assignee") {
    const had = taskValues(orig, "assignee");
    if (to !== EMPTY_GROUP && !had.includes(to)) await nexusApi.removeAssignee(orig.id, to);
    if (from !== EMPTY_GROUP && from !== to) await nexusApi.addAssignee(orig.id, from);
    return;
  }
  if (by === "tags") {
    const had = orig.tags ?? [];
    return nexusApi.updateTask(orig.id, { ...(to !== EMPTY_GROUP && !had.includes(to) ? { removeTags: [to] } : {}), ...(from !== EMPTY_GROUP ? { addTags: [from] } : {}) });
  }
  if (!by.startsWith("cf:")) return;
  const fieldId = by.slice(3);
  const raw = (orig.customFieldValues ?? []).find((c) => c.customFieldId === fieldId)?.value;
  return nexusApi.setCustomFieldValue(fieldId, orig.id, typeof raw === "string" ? raw : raw == null ? "" : JSON.stringify(raw));
}

/** Linked tasks from other projects and not-yet-saved drafts stay where they are. */
export function canDragTask(task: NexusTask, projectId: string): boolean {
  if (task.id.startsWith("draft-")) return false;
  return !(task.taskList?.projectId && task.taskList.projectId !== projectId);
}

type BatchPayload = { taskListId?: string; status?: string; priority?: string; projectContextId?: string };

/** The batch-move fields that put a task into group `to` of `by`; null when `by` isn't a task field. */
function directPayload(by: string, to: string, projectId: string): BatchPayload | null {
  if (to === EMPTY_GROUP) return null;
  if (by === "section") return { taskListId: to, projectContextId: projectId };
  if (by === "status") return { status: to };
  if (by === "priority") return { priority: to };
  return null;
}
const isDirect = (by: string) => by === "section" || by === "status" || by === "priority";

/** The group a task is in for `by`; `hint` (the dragged card's group) wins when the task is in it too. */
function groupOf(task: NexusTask, by: string, hint: string | null): string {
  const vals = taskValues(task, by);
  if (hint !== null && (vals.includes(hint) || (hint === EMPTY_GROUP && vals.length === 0))) return hint;
  return vals[0] ?? EMPTY_GROUP;
}

/**
 * The drag image of a multi-drag: the dragged card's title on a stack of cards, with the count. Built off
 * screen from the theme's tokens (light and dark), handed to the browser, and removed right after.
 */
export function setStackDragImage(e: DragEvent, count: number, title: string) {
  if (typeof document === "undefined" || typeof e.dataTransfer?.setDragImage !== "function") return;
  const root = document.createElement("div");
  root.setAttribute("aria-hidden", "true");
  root.className = "text-foreground";
  root.style.cssText = "position:fixed;top:-400px;left:-400px;width:236px;height:60px;pointer-events:none;";
  const card = (offset: number, opacity: number) => {
    const d = document.createElement("div");
    d.className = "absolute rounded-lg border border-border bg-card shadow-[0_2px_8px_rgba(15,15,15,0.12)]";
    d.style.cssText = `left:${offset}px;top:${offset}px;width:220px;height:44px;opacity:${opacity};`;
    return d;
  };
  root.append(card(10, 0.55), card(5, 0.8));
  const front = card(0, 1);
  front.className += " flex items-center gap-2 px-2.5";
  const label = document.createElement("span");
  label.className = "min-w-0 flex-1 truncate text-sm font-medium";
  label.textContent = title;
  const badge = document.createElement("span");
  badge.className = "grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground";
  badge.textContent = String(count);
  front.append(label, badge);
  root.append(front);
  document.body.appendChild(root);
  e.dataTransfer.setDragImage(root, 20, 20);
  window.setTimeout(() => root.remove(), 0);
}

export type TaskDrag = { taskId: string; ids: string[]; from: string; fromRow: string | null };
type Item = { task: NexusTask; from: string; fromRow: string | null; group: boolean; row: boolean };

/**
 * Drag state + the move itself for one view. `groupBy`/`sub` are the view's grouping and sub-grouping
 * (null when none); `viewTasks` are the tasks the view shows, in screen order (the selection is moved in
 * that order, so the cards keep their order in the new column).
 */
export function useGroupMove({ project, defs, groupBy, sub, viewTasks }: {
  project: NexusProject; defs: PropDef[]; groupBy: string | null; sub: string | null; viewTasks: NexusTask[];
}) {
  const qc = useQueryClient();
  const { t, tn } = useLang();
  const bulk = useTaskBulk();
  const [drag, setDragState] = useState<TaskDrag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const canGroup = droppable(groupBy, defs);
  const canRow = !!sub && droppable(sub, defs);
  /** A handle is worth showing: the view is grouped by something a drop can write. */
  const enabled = canGroup || canRow;

  // Stable callbacks (memoised cards): the latest values are read through a ref.
  const live = useRef({ bulk, viewTasks, project, defs, groupBy, sub, canGroup, canRow, drag });
  live.current = { bulk, viewTasks, project, defs, groupBy, sub, canGroup, canRow, drag };
  const setDrag = (d: TaskDrag | null) => { live.current.drag = d; setDragState(d); };

  const startDrag = useCallback((e: DragEvent | null, task: NexusTask, from: string, fromRow: string | null) => {
    const { bulk: b, viewTasks: shown, project: p } = live.current;
    let ids = [task.id];
    if (b.isSelected(task.id) && b.selectedIds.length > 1) {
      const sel = new Set(b.selectedIds);
      const seen = new Set<string>();
      ids = shown.filter((x) => sel.has(x.id) && canDragTask(x, p.id) && !seen.has(x.id) && !!seen.add(x.id)).map((x) => x.id);
      if (!ids.includes(task.id)) ids.unshift(task.id);
    } else if (b.selectedIds.length > 0) {
      b.clear();
    }
    if (e) {
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", task.title); } catch { /* some browsers refuse during dragstart */ }
      if (ids.length > 1) setStackDragImage(e, ids.length, task.title);
    }
    setDrag({ taskId: task.id, ids, from, fromRow });
  }, []);
  const endDrag = useCallback(() => { setDrag(null); setOver(null); }, []);

  const canDropAt = (to: string, toRow: string | null) =>
    !!drag && (canGroup || to === drag.from) && (toRow === null || canRow || toRow === drag.fromRow);

  const run = async (items: Item[], to: string, toRow: string | null) => {
    const { project: p, defs: ds, groupBy: by, sub: sb } = live.current;
    // One batch call per distinct set of fields (normally one), per-task writes for the rest.
    const calls = new Map<string, { payload: BatchPayload; ids: string[] }>();
    const perTask: Array<() => Promise<unknown>> = [];
    const perTaskIds: string[] = [];
    for (const it of items) {
      const payload: BatchPayload = {
        ...(it.group && by && isDirect(by) ? directPayload(by, to, p.id) : null),
        ...(it.row && sb && toRow !== null && isDirect(sb) ? directPayload(sb, toRow, p.id) : null),
      };
      if (Object.keys(payload).length) {
        const k = JSON.stringify(payload);
        const c = calls.get(k) ?? { payload, ids: [] };
        c.ids.push(it.task.id);
        calls.set(k, c);
      }
      if (it.group && by && !isDirect(by)) { perTask.push(() => moveToGroup(it.task, by, it.from, to, ds, p.id)); perTaskIds.push(it.task.id); }
      if (it.row && sb && toRow !== null && !isDirect(sb)) { perTask.push(() => moveToGroup(it.task, sb, it.fromRow ?? EMPTY_GROUP, toRow, ds, p.id)); perTaskIds.push(it.task.id); }
    }
    const failed = new Map<string, string>();
    for (const { payload, ids } of calls.values()) {
      try {
        const res = await nexusApi.batchMoveTasks({ taskIds: ids, ...payload });
        for (const f of res.failed ?? []) failed.set(f.id, f.error);
      } catch (e) {
        for (const id of ids) failed.set(id, friendlyError(e) ?? "");
      }
    }
    for (let i = 0; i < perTask.length; i++) {
      try { await perTask[i](); } catch (e) { failed.set(perTaskIds[i], friendlyError(e) ?? ""); }
    }
    return failed;
  };

  /** Write the cache as if the move were done; returns the rollback. */
  const optimistic = (items: Item[], to: string, toRow: string | null): (() => void) => {
    const { project: p, groupBy: by, sub: sb } = live.current;
    const undo: Array<() => void> = [];
    const apply = (task: NexusTask, key: string, value: string) => {
      if (value === EMPTY_GROUP) return;
      if (key === "section") {
        const target = (p.taskLists ?? []).find((l) => l.id === value);
        undo.push(patchTaskInCaches(qc, task.id, target?.taskStatus ? { status: target.taskStatus } : {}, { moveToListId: value }));
      } else if (key === "status") undo.push(patchTaskInCaches(qc, task.id, { status: value }));
      else if (key === "priority") undo.push(patchTaskInCaches(qc, task.id, { priority: value }));
    };
    // Each moved card goes on top of its new column: last first, so they keep their order there.
    for (const it of [...items].reverse()) {
      if (it.group && by) apply(it.task, by, to);
      if (it.row && sb && toRow !== null) apply(it.task, sb, toRow);
    }
    return () => undo.reverse().forEach((u) => u());
  };

  const undoMove = async (items: Item[], to: string, toRow: string | null) => {
    const { project: p, groupBy: by, sub: sb } = live.current;
    await holdProject(qc, p.id);
    const end = beginTaskWrite();
    // The direct fields go back exactly as they were (section AND status, so a status column's move is undone too).
    const calls = new Map<string, { payload: BatchPayload; ids: string[] }>();
    const perTask: Array<() => Promise<unknown>> = [];
    for (const it of items) {
      const keys = [it.group && by ? by : null, it.row && sb ? sb : null].filter(Boolean) as string[];
      const payload: BatchPayload = {};
      if (keys.some((k) => k === "section" || k === "status")) {
        const listId = sectionIdOf(it.task);
        if (listId) { payload.taskListId = listId; payload.projectContextId = p.id; }
        payload.status = it.task.status || "TODO";
      }
      if (keys.includes("priority")) payload.priority = it.task.priority || "NONE";
      if (Object.keys(payload).length) {
        patchTaskInCaches(qc, it.task.id, { status: it.task.status, priority: it.task.priority }, { moveToListId: payload.taskListId });
        const k = JSON.stringify(payload);
        const c = calls.get(k) ?? { payload, ids: [] };
        c.ids.push(it.task.id);
        calls.set(k, c);
      }
      if (it.group && by && !isDirect(by)) perTask.push(() => restoreGroup(it.task, by, it.from, to));
      if (it.row && sb && toRow !== null && !isDirect(sb)) perTask.push(() => restoreGroup(it.task, sb, it.fromRow ?? EMPTY_GROUP, toRow));
    }
    let failed = 0;
    for (const { payload, ids } of calls.values()) {
      try { failed += (await nexusApi.batchMoveTasks({ taskIds: ids, ...payload })).failed?.length ?? 0; } catch { failed += ids.length; }
    }
    for (const f of perTask) { try { await f(); } catch { failed++; } }
    end();
    settleTaskWrite(qc, p.id);
    if (failed) toast.error(t("Couldn't undo the move"));
  };

  /** Drop the dragged card(s) into group `to` (and sub-group row `toRow`, when the view has rows). */
  const drop = useCallback((to: string, toRow: string | null) => {
    const d = live.current.drag;
    setDrag(null);
    setOver(null);
    const { viewTasks: shown, groupBy: by, sub: sb, canGroup: cg, canRow: cr, project: p } = live.current;
    if (!d || !by) return;
    if (!((cg || to === d.from) && (toRow === null || cr || toRow === d.fromRow))) return;
    const byId = new Map(shown.map((x) => [x.id, x]));
    const items: Item[] = [];
    for (const id of d.ids) {
      const task = byId.get(id);
      if (!task) continue;
      const lead = id === d.taskId;
      const from = lead ? d.from : groupOf(task, by, d.from);
      const fromRow = sb ? (lead ? d.fromRow : groupOf(task, sb, d.fromRow)) : null;
      // A task-field grouping has no "empty" value to write (every task has a section, status, priority).
      const group = cg && from !== to && !(isDirect(by) && to === EMPTY_GROUP);
      const row = !!sb && cr && toRow !== null && fromRow !== toRow && !(isDirect(sb) && toRow === EMPTY_GROUP);
      if (group || row) items.push({ task, from, fromRow, group, row });
    }
    if (!items.length) return;
    void (async () => {
      await holdProject(qc, p.id);
      const end = beginTaskWrite();
      const rollback = optimistic(items, to, toRow);
      const failed = await run(items, to, toRow).finally(end);
      if (failed.size === items.length) rollback();
      settleTaskWrite(qc, p.id);
      const ok = items.filter((it) => !failed.has(it.task.id));
      if (failed.size) {
        const why = [...failed.values()].find(Boolean);
        toast.error(tn(failed.size, "Couldn't move the task", "Couldn't move {n} tasks"), { description: why || undefined });
      }
      // Undo from the toast or with Ctrl/⌘+Z (lib/task-undo.ts).
      if (ok.length) pushUndo(tn(ok.length, "Task moved", "Moved {n} tasks"), () => undoMove(ok, to, toRow));
    })();
  }, [qc, t, tn]);

  /** Handlers for a drop zone (a List/Table group or sub-group); `isOver` while a valid drag hovers it. */
  const dropZone = (to: string, toRow: string | null) => {
    const id = `${toRow ?? ""}::${to}`;
    const ok = canDropAt(to, toRow);
    return {
      isOver: ok && over === id,
      props: {
        onDragOver: (e: DragEvent) => { if (!ok) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; if (over !== id) setOver(id); },
        onDragLeave: (e: DragEvent) => { if (e.currentTarget.contains(e.relatedTarget as Node | null)) return; setOver((o) => (o === id ? null : o)); },
        onDrop: (e: DragEvent) => { if (!ok) return; e.preventDefault(); e.stopPropagation(); drop(to, toRow); },
      },
    };
  };

  return { drag, enabled, canGroup, canRow, startDrag, endDrag, canDropAt, drop, dropZone };
}

/** The grip a List/Table row is dragged by (shown on hover; always on touch screens). */
export function DragHandle({ onDragStart, onDragEnd, className }: { onDragStart: (e: DragEvent) => void; onDragEnd: () => void; className?: string }) {
  const { t } = useLang();
  return (
    <span
      draggable
      onDragStart={(e) => { e.stopPropagation(); onDragStart(e); }}
      onDragEnd={onDragEnd}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      title={t("Drag to move")}
      aria-hidden
      className={cn("grid h-6 w-4 shrink-0 cursor-grab place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground active:cursor-grabbing pointer-coarse:h-9 pointer-coarse:w-7 pointer-coarse:opacity-60 pointer-coarse:[-webkit-touch-callout:none] pointer-coarse:select-none", className)}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </span>
  );
}
