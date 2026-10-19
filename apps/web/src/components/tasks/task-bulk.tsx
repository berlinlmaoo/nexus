import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { modKey } from "@/lib/keyboard";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { enGB, id as idLocale } from "date-fns/locale";
import { CalendarDays, Check, CheckSquare, ChevronLeft, ChevronRight, CircleDot, Copy, CopyPlus, Flag, FolderInput, Link2, ListChecks, SlidersHorizontal, Trash2, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { CopyToProjectDialog } from "@/components/tasks/CopyToProjectDialog";
import { StatusPill } from "@/components/tasks/StatusPicker";
import { DateField } from "@/components/DateField";
import { Calendar } from "@/components/ui/calendar";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { nexusApi, statusLabel, type NexusProject, type NexusTask } from "@/lib/nexus-api";
import { celebrate } from "@/components/Celebration";
import { t as tt, tn as ttn, useLang } from "@/lib/lang";
import { useSubmitGuard } from "@/hooks/use-submit-guard";
import { friendlyError, pushUndo, undoLast } from "@/lib/task-undo";
import { beginTaskWrite, holdProject, patchTaskInCaches, settleTaskWrite } from "@/lib/task-cache";
import { orderedOptions, usesStatusOptions } from "@/lib/status-options";
import { COLOR_PRESETS, optionColor } from "@/lib/project-views";

/**
 * Multi-select + bulk actions for task cards across ALL project views (Board / List / Calendar / Timeline /
 * Gallery, and the Table's rows). On in every project since 11 Oct 2026 (owner).
 *
 * Cards opt in by spreading `bulk.bindCard(task, () => onOpen(task))` — a PLAIN function (not a hook) so
 * it's safe to call inside `.map()`. Table rows use `bulk.bindRow(task)`, which leaves plain clicks to
 * the row's own cells. Selecting:
 *  - ⌘/Ctrl+click toggles one task; Shift+click selects everything between the last clicked task and
 *    this one, in the order the cards are on screen (`data-bulk-task`); ⌘/Ctrl+A selects every card on
 *    screen (bug hunt C-BUG-14, 12 Oct 2026);
 *  - right-click (desktop) or long-press (mobile) opens the context menu; on a task that is part of the
 *    selection its actions act on the whole selection;
 *  - once anything is selected, plain clicks on cards toggle too, and a floating action bar appears.
 *    Esc clears the selection (or closes the menu first).
 * The selection only ever holds tasks the view shows (`visibleIds`): a search or filter that hides a
 * selected task drops it, so Delete / Duplicate never touch a task you can't see (C-BUG-4).
 * Bulk edits (Notion's "Edit property", C-BUG-15): status, priority, assignee, due date. Every bulk action
 * has Undo (toast + ⌘/Ctrl+Z, lib/task-undo.ts, C-BUG-16). Buttons run once per click (useSubmitGuard).
 */

type CardProps = {
  "data-bulk-task": string;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onTouchStart?: (e: React.TouchEvent) => void;
  onTouchEnd?: (e: React.TouchEvent) => void;
  onTouchMove?: (e: React.TouchEvent) => void;
};
type RowProps = {
  "data-bulk-task": string;
  onClickCapture: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
};
type BulkCtx = {
  enabled: boolean;
  selecting: boolean;
  isSelected: (id: string) => boolean;
  /** The selected task ids (a multi-drag moves them all), and a way to drop the selection. */
  selectedIds: string[];
  clear: () => void;
  bindCard: (task: NexusTask, onOpen: () => void) => CardProps;
  bindRow: (task: NexusTask) => RowProps;
};
const DEFAULT: BulkCtx = {
  enabled: false,
  selecting: false,
  isSelected: () => false,
  selectedIds: [],
  clear: () => {},
  bindCard: (task, onOpen) => ({ "data-bulk-task": task.id, onClick: () => onOpen() }),
  bindRow: (task) => ({ "data-bulk-task": task.id, onClickCapture: () => {}, onContextMenu: () => {} }),
};
const Ctx = createContext<BulkCtx | null>(null);
export function useTaskBulk(): BulkCtx { return useContext(Ctx) ?? DEFAULT; }

const LONG_PRESS_MS = 480;
const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"] as const;

/** Task ids in the order their cards are on screen (a task shown twice counts once). */
function onScreenOrder(): string[] {
  const seen = new Set<string>();
  for (const el of document.querySelectorAll<HTMLElement>("[data-bulk-task]")) {
    const id = el.dataset.bulkTask;
    if (id && !id.startsWith("draft-")) seen.add(id);
  }
  return [...seen];
}

/** A right-click inside a text field keeps the browser's own menu (paste, spelling). */
function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']");
}

/** A popup / dialog is on screen: page-level shortcuts (⌘A, ⌘Z) are its business then. */
function dialogOpen(): boolean {
  for (const el of document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')) {
    if (el.offsetParent !== null || el.getClientRects().length) return true;
  }
  return false;
}

type MenuState = { task: NexusTask; x: number; y: number; touch: boolean };
type Member = { id: string; name: string; avatar?: string | null };
type EditKind = "status" | "priority" | "assignee" | "due";

export function TaskBulkProvider({ projectId, visibleIds, children }: {
  projectId: string;
  /** The tasks the view shows right now; a selected task outside it is dropped from the selection. */
  visibleIds?: ReadonlySet<string>;
  children: ReactNode;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [datePopup, setDatePopup] = useState<{ ids: string[] } | null>(null);
  const [copyIds, setCopyIds] = useState<string[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const lpTimer = useRef<number | undefined>(undefined);
  const lpFired = useRef(false);
  const lpStart = useRef({ x: 0, y: 0 });
  const lastTouchEnd = useRef(0);
  // The last task clicked into the selection: the other end of a Shift+click range.
  const anchor = useRef<string | null>(null);
  const [runGuard, busy] = useSubmitGuard();
  // The project payload is already cached by the page; this only reads it (sections, members, tasks).
  const project = useQuery({ queryKey: ["nexus", "project", projectId], queryFn: () => nexusApi.project(projectId), staleTime: 30_000 });
  // Deleting tasks needs Can edit or Full access (Notion levels, owner 13 Oct 2026); Can comment / Can view
  // aren't offered a Delete the server would refuse. Unknown (older server) = shown, as before.
  const lvl = project.data?.viewerAccessLevel;
  const canDelete = lvl ? lvl === "FULL" || lvl === "EDIT" : project.data?.viewerCanManage !== false;

  const selecting = selected.size > 0;
  const refresh = useCallback(() => { settleTaskWrite(qc, projectId); qc.invalidateQueries({ queryKey: ["dashboard"] }); }, [qc, projectId]);

  // Prune: a task the view no longer shows (search, filter, another view) leaves the selection.
  useEffect(() => {
    if (!visibleIds) return;
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      let gone = false;
      for (const id of prev) if (!visibleIds.has(id)) { gone = true; break; }
      if (!gone) return prev;
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      if (anchor.current && !next.has(anchor.current)) anchor.current = null;
      return next;
    });
  }, [visibleIds]);

  const toggle = useCallback((id: string) => {
    anchor.current = id;
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);
  const selectRange = useCallback((id: string) => {
    const order = onScreenOrder();
    const from = anchor.current ? order.indexOf(anchor.current) : -1;
    const to = order.indexOf(id);
    if (from < 0 || to < 0) { toggle(id); return; }
    const [lo, hi] = from < to ? [from, to] : [to, from];
    setSelected((prev) => { const next = new Set(prev); for (let i = lo; i <= hi; i++) next.add(order[i]); return next; });
    window.getSelection()?.removeAllRanges(); // Shift+click also selects the text in between
  }, [toggle]);
  const clear = useCallback(() => { anchor.current = null; setSelected(new Set()); }, []);
  const selectAll = useCallback(() => {
    const ids = onScreenOrder();
    if (!ids.length) return false;
    setSelected(new Set(ids));
    window.getSelection()?.removeAllRanges();
    return true;
  }, []);

  /** ⌘/Ctrl+click and Shift+click select instead of opening. True when the click was used. */
  const modifierClick = useCallback((e: React.MouseEvent, id: string): boolean => {
    if (e.shiftKey) { selectRange(id); return true; }
    if (e.metaKey || e.ctrlKey) { toggle(id); return true; }
    return false;
  }, [selectRange, toggle]);

  // Esc: the menu first, then the selection.
  useEffect(() => {
    if (!selecting && !menu && !datePopup && !confirmDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (menu) { e.preventDefault(); setMenu(null); return; }
      if (confirmDelete) { e.preventDefault(); setConfirmDelete(null); return; }
      if (datePopup) { e.preventDefault(); setDatePopup(null); return; }
      if (!copyIds) clear();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selecting, menu, datePopup, copyIds, confirmDelete, clear]);

  // A selection goes before a tooltip: a hover tooltip on a card used to swallow the first Esc (Radix
  // dismisses it and marks the key handled), so the selection needed a second Esc (QA B51). This runs in
  // the capture phase, ahead of Radix. Open menus, popovers, dialogs and text fields still get Esc first.
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || menu || datePopup || confirmDelete || copyIds) return;
      if (isEditable(e.target) || dialogOpen()) return;
      if (document.querySelector("[data-radix-popper-content-wrapper]:not(:has([role='tooltip']))")) return;
      e.preventDefault();
      clear();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selecting, menu, datePopup, confirmDelete, copyIds, clear]);

  // ⌘/Ctrl+A selects every task on screen; ⌘/Ctrl+Z undoes the last task action (Notion). Text fields and
  // open dialogs keep the browser's own meaning.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== "a" && k !== "z") return;
      if (isEditable(e.target) || dialogOpen()) return;
      if (k === "a") { if (selectAll()) e.preventDefault(); return; }
      if (!e.shiftKey && undoLast()) e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectAll]);

  // ── task lookups for the bulk edits (their Undo needs the values from before) ──
  const taskMap = useCallback((): Map<string, NexusTask> => {
    const m = new Map<string, NexusTask>();
    const data = qc.getQueryData<NexusProject>(["nexus", "project", projectId]);
    for (const l of data?.taskLists ?? []) for (const task of l.tasks ?? []) m.set(task.id, { ...task, taskListId: task.taskListId ?? l.id });
    for (const [, arr] of qc.getQueriesData<NexusTask[]>({ queryKey: ["nexus", "project-calendar-tasks", projectId] })) {
      if (Array.isArray(arr)) for (const task of arr) if (!m.has(task.id)) m.set(task.id, task);
    }
    return m;
  }, [qc, projectId]);
  const sections = useMemo(() => orderedOptions(project.data?.taskLists ?? []), [project.data?.taskLists]);
  const statusOptions = usesStatusOptions(sections);
  const members: Member[] = useMemo(
    () => (project.data?.members ?? []).map((m) => ({ id: (m.userId || m.user?.id) ?? "", name: m.user?.name ?? m.user?.email ?? "", avatar: m.user?.avatar ?? null })).filter((m) => m.id),
    [project.data?.members],
  );

  const afterBulk = () => { clear(); setMenu(null); setDatePopup(null); };

  const duplicate = (ids: string[], dueDate?: string | null) => runGuard(async () => {
    const copies: string[] = [];
    let failed = 0;
    let why: string | undefined;
    for (const id of ids) {
      try { const r = await nexusApi.duplicateTask(id, dueDate); if (r?.task?.id) copies.push(r.task.id); }
      catch (e) { failed++; why ??= friendlyError(e); }
    }
    refresh();
    afterBulk();
    if (failed) toast.error(ttn(failed, "Couldn't duplicate {n} task", "Couldn't duplicate {n} tasks"), { description: why });
    if (copies.length) {
      pushUndo(ttn(copies.length, "Task duplicated", "{n} tasks duplicated"), async () => {
        for (const id of copies) await nexusApi.deleteTask(id).catch(() => null);
        refresh();
      });
    }
  });

  const remove = (ids: string[]) => runGuard(async () => {
    setConfirmDelete(null);
    await holdProject(qc, projectId);
    // Gone from the board at once; a task the server refuses comes back with the refetch.
    const snapshot = qc.getQueryData<NexusProject>(["nexus", "project", projectId]);
    const gone = new Set(ids);
    if (snapshot?.taskLists) qc.setQueryData<NexusProject>(["nexus", "project", projectId], { ...snapshot, taskLists: snapshot.taskLists.map((l) => ({ ...l, tasks: (l.tasks ?? []).filter((x) => !gone.has(x.id)) })) });
    afterBulk();
    const end = beginTaskWrite();
    const auditIds: string[] = [];
    let ok = 0;
    let failed = 0;
    let why: string | undefined;
    for (const id of ids) {
      try { const r = await nexusApi.deleteTask(id); ok++; if (r?.auditLogId) auditIds.push(r.auditLogId); }
      catch (e) { failed++; why ??= friendlyError(e); }
    }
    end();
    refresh();
    if (failed) toast.error(ttn(failed, "Couldn't delete {n} task", "Couldn't delete {n} tasks"), { description: why });
    if (ok) {
      const label = ttn(ok, "Task deleted", "{n} tasks deleted");
      if (auditIds.length) {
        pushUndo(label, async () => {
          const r = await nexusApi.undoDeleteTasks(auditIds);
          refresh();
          if (r.failed?.length) toast.error(ttn(r.failed.length, "Couldn't bring back {n} task. It's still in Control Room → Audit.", "Couldn't bring back {n} tasks. They're still in Control Room → Audit."));
        });
      } else celebrate(label);
    }
  });

  /** One bulk property edit: optimistic, one undo entry, refetch at the end. */
  const edit = (ids: string[], kind: EditKind, value: string | null) => runGuard(async () => {
    const map = taskMap();
    const tasks = ids.map((id) => map.get(id)).filter((x): x is NexusTask => !!x && !x.id.startsWith("draft-") && !(x.taskList?.projectId && x.taskList.projectId !== projectId));
    afterBulk();
    if (!tasks.length) return;
    await holdProject(qc, projectId);
    const end = beginTaskWrite();
    const rollbacks: Array<() => void> = [];
    let failed = 0;
    let why: string | undefined;
    const note = (e: unknown, n = 1) => { failed += n; why ??= friendlyError(e); };
    let undo: (() => Promise<void>) | null = null;
    let label = "";
    try {
      if (kind === "status" && value) {
        const target = sections.find((s) => s.id === value);
        for (const task of tasks) rollbacks.push(patchTaskInCaches(qc, task.id, target?.taskStatus ? { status: target.taskStatus } : {}, { moveToListId: value }));
        try { const r = await nexusApi.batchMoveTasks({ taskIds: tasks.map((x) => x.id), taskListId: value, projectContextId: projectId }); if (r.failed?.length) note(r.failed[0]?.error, r.failed.length); }
        catch (e) { note(e, tasks.length); }
        label = ttn(tasks.length, "Status changed", "Status changed on {n} tasks");
        const before = groupBy(tasks, (x) => JSON.stringify({ l: x.taskListId ?? x.taskList?.id ?? "", s: x.status || "TODO" }));
        undo = async () => {
          for (const [k, list] of before) {
            const { l, s } = JSON.parse(k) as { l: string; s: string };
            await nexusApi.batchMoveTasks({ taskIds: list.map((x) => x.id), ...(l ? { taskListId: l, projectContextId: projectId } : {}), status: s });
          }
        };
      } else if (kind === "priority" && value) {
        for (const task of tasks) rollbacks.push(patchTaskInCaches(qc, task.id, { priority: value }));
        try { const r = await nexusApi.batchMoveTasks({ taskIds: tasks.map((x) => x.id), priority: value }); if (r.failed?.length) note(r.failed[0]?.error, r.failed.length); }
        catch (e) { note(e, tasks.length); }
        label = ttn(tasks.length, "Priority changed", "Priority changed on {n} tasks");
        const before = groupBy(tasks, (x) => x.priority || "NONE");
        undo = async () => { for (const [p, list] of before) await nexusApi.batchMoveTasks({ taskIds: list.map((x) => x.id), priority: p }); };
      } else if (kind === "assignee" && value) {
        const added: string[] = [];
        for (const task of tasks) {
          if ((task.assignees ?? []).some((a) => a.user?.id === value)) continue;
          try { await nexusApi.addAssignee(task.id, value); added.push(task.id); } catch (e) { note(e); }
        }
        label = ttn(tasks.length, "Assigned 1 task", "Assigned {n} tasks");
        undo = async () => { for (const id of added) await nexusApi.removeAssignee(id, value); };
      } else if (kind === "due") {
        for (const task of tasks) rollbacks.push(patchTaskInCaches(qc, task.id, { dueDate: value }));
        const changed: NexusTask[] = [];
        for (const task of tasks) {
          try { await nexusApi.updateTask(task.id, { dueDate: value }); changed.push(task); } catch (e) { note(e); }
        }
        label = value ? ttn(tasks.length, "Due date set", "Due date set on {n} tasks") : ttn(tasks.length, "Due date cleared", "Due date cleared on {n} tasks");
        undo = async () => { for (const task of changed) await nexusApi.updateTask(task.id, { dueDate: task.dueDate ?? null }); };
      }
    } finally {
      end();
    }
    if (failed === tasks.length) rollbacks.reverse().forEach((r) => r());
    refresh();
    if (failed) toast.error(ttn(failed, "Couldn't update {n} task", "Couldn't update {n} tasks"), { description: why });
    if (undo && failed < tasks.length) {
      const run = undo;
      pushUndo(label, async () => { await holdProject(qc, projectId); const e2 = beginTaskWrite(); try { await run(); } finally { e2(); refresh(); } });
    }
  });

  const openMenu = useCallback((task: NexusTask, x: number, y: number, touch = false) => setMenu({ task, x, y, touch }), []);

  const bindCard = useCallback((task: NexusTask, onOpen: () => void): CardProps => ({
    "data-bulk-task": task.id,
    onClick: (e) => {
      if (lpFired.current) { lpFired.current = false; e.preventDefault(); e.stopPropagation(); return; } // swallow the click that follows a long-press
      if (modifierClick(e, task.id)) { e.preventDefault(); e.stopPropagation(); return; }
      if (selected.size > 0) { e.preventDefault(); e.stopPropagation(); toggle(task.id); return; }
      onOpen();
    },
    onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); openMenu(task, e.clientX, e.clientY); },
    onTouchStart: (e) => {
      const touch = e.touches[0];
      lpStart.current = { x: touch.clientX, y: touch.clientY };
      lpFired.current = false;
      window.clearTimeout(lpTimer.current);
      lpTimer.current = window.setTimeout(() => { lpFired.current = true; if (navigator.vibrate) navigator.vibrate(8); openMenu(task, touch.clientX, touch.clientY, true); }, LONG_PRESS_MS);
    },
    // The finger lifting after a long-press must not become a click on the menu's backdrop (C-BUG-20):
    // preventDefault cancels the compatibility mouse events; the backdrop also ignores a click right after.
    onTouchEnd: (e: React.TouchEvent) => { window.clearTimeout(lpTimer.current); lastTouchEnd.current = Date.now(); if (lpFired.current && e.cancelable) e.preventDefault(); },
    onTouchMove: (e: React.TouchEvent) => {
      window.clearTimeout(lpTimer.current);
      // Held, the menu opened, then the finger moves: that's a drag (views/touch-drag.ts) — close the menu.
      const tc = e.touches[0];
      if (lpFired.current && tc && Math.hypot(tc.clientX - lpStart.current.x, tc.clientY - lpStart.current.y) > 8) { lpFired.current = false; setMenu(null); }
    },
  }), [selected, toggle, modifierClick, openMenu]);

  // Table rows are full of inline editors, so a plain click stays theirs; only modifier clicks select.
  const bindRow = useCallback((task: NexusTask): RowProps => ({
    "data-bulk-task": task.id,
    onClickCapture: (e) => {
      if (isEditable(e.target) && !e.shiftKey && !e.metaKey && !e.ctrlKey) return;
      if (modifierClick(e, task.id)) { e.preventDefault(); e.stopPropagation(); }
    },
    onContextMenu: (e) => {
      if (isEditable(e.target)) return;
      e.preventDefault(); e.stopPropagation(); openMenu(task, e.clientX, e.clientY);
    },
  }), [modifierClick, openMenu]);

  const selectedIds = useMemo(() => [...selected], [selected]);
  const value = useMemo<BulkCtx>(() => ({ enabled: true, selecting, isSelected: (id) => selected.has(id), selectedIds, clear, bindCard, bindRow }), [selecting, selected, selectedIds, clear, bindCard, bindRow]);
  // The context menu acts on the whole selection when it was opened on a selected task.
  const menuIds = menu && selected.has(menu.task.id) ? selectedIds : menu ? [menu.task.id] : [];

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Room under the last card while the selection bar floats over the bottom of the page. */}
      {selecting && <div aria-hidden className="h-24" />}
      <BulkLayer
        canDelete={canDelete}
        menu={menu}
        menuIds={menuIds}
        onCloseMenu={(fromTouchOverlay) => {
          // A long-press menu: the finger lifting makes the browser click whatever is under it — the
          // overlay. That click must not close the menu it just opened (C-BUG-20).
          if (fromTouchOverlay && menu?.touch && Date.now() - lastTouchEnd.current < 700) return;
          setMenu(null);
        }}
        selectedIds={selectedIds}
        hideBar={!!copyIds}
        onBeginSelect={(task) => { anchor.current = task.id; setSelected((prev) => new Set(prev).add(task.id)); setMenu(null); }}
        onSelectAll={() => { selectAll(); setMenu(null); }}
        onDuplicateNow={(ids) => void duplicate(ids)}
        onDuplicateWithDate={(ids) => { setMenu(null); setDatePopup({ ids }); }}
        onDelete={(ids) => { setMenu(null); setConfirmDelete(ids); }}
        onCopyToProject={(ids) => { setMenu(null); setCopyIds(ids); }}
        onEdit={(ids, kind, v) => void edit(ids, kind, v)}
        onClear={clear}
        datePopup={datePopup}
        onCloseDate={() => setDatePopup(null)}
        onConfirmDate={(ids, dueDate) => void duplicate(ids, dueDate)}
        confirmDelete={confirmDelete}
        onCancelDelete={() => setConfirmDelete(null)}
        onConfirmDelete={(ids) => void remove(ids)}
        busy={busy}
        sections={sections}
        statusOptions={statusOptions}
        members={members}
      />
      {copyIds && (
        <CopyToProjectDialog
          taskIds={copyIds}
          sourceProjectId={projectId}
          onClose={() => setCopyIds(null)}
          onDone={() => { refresh(); clear(); }}
        />
      )}
    </Ctx.Provider>
  );
}

function groupBy<T>(list: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of list) { const k = key(x); const arr = m.get(k) ?? []; arr.push(x); m.set(k, arr); }
  return m;
}

type Section = NexusProject["taskLists"] extends Array<infer S> | undefined ? S : never;

function BulkLayer({ canDelete, menu, menuIds, onCloseMenu, selectedIds, hideBar, onBeginSelect, onSelectAll, onDuplicateNow, onDuplicateWithDate, onDelete, onCopyToProject, onEdit, onClear, datePopup, onCloseDate, onConfirmDate, confirmDelete, onCancelDelete, onConfirmDelete, busy, sections, statusOptions, members }: {
  menu: MenuState | null;
  menuIds: string[];
  onCloseMenu: (fromTouchOverlay?: boolean) => void;
  selectedIds: string[];
  hideBar: boolean;
  onBeginSelect: (t: NexusTask) => void;
  onSelectAll: () => void;
  onDuplicateNow: (ids: string[]) => void;
  onDuplicateWithDate: (ids: string[]) => void;
  onDelete: (ids: string[]) => void;
  canDelete: boolean;
  onCopyToProject: (ids: string[]) => void;
  onEdit: (ids: string[], kind: EditKind, value: string | null) => void;
  onClear: () => void;
  datePopup: { ids: string[] } | null;
  onCloseDate: () => void;
  onConfirmDate: (ids: string[], dueDate: string | null) => void;
  confirmDelete: string[] | null;
  onCancelDelete: () => void;
  onConfirmDelete: (ids: string[]) => void;
  busy: boolean;
  sections: Section[];
  statusOptions: boolean;
  members: Member[];
}) {
  const reduce = useReducedMotion();
  const { t } = useLang();
  const [barEdit, setBarEdit] = useState(false);
  useEffect(() => { if (selectedIds.length === 0) setBarEdit(false); }, [selectedIds.length]);
  if (typeof document === "undefined") return null;
  const editProps = { sections, statusOptions, members };
  return createPortal(
    <>
      {/* context menu */}
      <AnimatePresence>
        {menu && (
          <>
            <div className="fixed inset-0 z-[93]" onClick={() => onCloseMenu(true)} onContextMenu={(e) => { e.preventDefault(); onCloseMenu(); }} />
            <ContextMenu key={menu.task.id} menu={menu} count={menuIds.length} reduce={reduce}
              onSelect={() => onBeginSelect(menu.task)}
              onSelectAll={onSelectAll}
              onDuplicate={() => { onDuplicateNow(menuIds); onCloseMenu(); }}
              onDuplicateDate={() => onDuplicateWithDate(menuIds)}
              onCopyLink={() => { navigator.clipboard?.writeText(`${window.location.origin}/tasks/${menu.task.id}`); celebrate(tt("Link copied")); onCloseMenu(); }}
              onCopyToProject={() => onCopyToProject(menuIds)}
              onDelete={canDelete ? () => onDelete(menuIds) : undefined}
              onEdit={(kind, v) => onEdit(menuIds, kind, v)}
              busy={busy}
              {...editProps}
            />
          </>
        )}
      </AnimatePresence>

      {/* floating selection bar */}
      <AnimatePresence>
        {selectedIds.length > 0 && !hideBar && !confirmDelete && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            role="toolbar"
            aria-label={t("Selected tasks")}
            className="fixed bottom-5 left-1/2 z-[94] flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-1.5 overflow-x-auto rounded-2xl border border-border bg-popover px-2 py-2 shadow-pop"
          >
            <span className="shrink-0 px-2 text-sm font-bold tabular-nums">{t("{n} selected", { n: selectedIds.length })}</span>
            <div className="relative shrink-0">
              <button disabled={busy} onClick={() => setBarEdit((o) => !o)} aria-expanded={barEdit} className={cn("inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-accent disabled:opacity-50", barEdit && "bg-accent")}><SlidersHorizontal className="h-3.5 w-3.5" /> {t("Edit")}</button>
            </div>
            <button disabled={busy} onClick={() => onDuplicateNow(selectedIds)} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-accent disabled:opacity-50"><Copy className="h-3.5 w-3.5" /> {t("Duplicate")}</button>
            <button disabled={busy} onClick={() => onDuplicateWithDate(selectedIds)} title={t("Duplicate + set due date")} aria-label={t("Duplicate + set due date")} className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"><CalendarDays className="h-4 w-4" /></button>
            <button disabled={busy} onClick={() => onCopyToProject(selectedIds)} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-accent disabled:opacity-50"><FolderInput className="h-3.5 w-3.5" /> {t("Copy to project")}</button>
            {canDelete && <button disabled={busy} onClick={() => onDelete(selectedIds)} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> {t("Delete")}</button>}
            <button onClick={onClear} className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent" aria-label={t("Cancel")}><X className="h-4 w-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {barEdit && selectedIds.length > 0 && !hideBar && !confirmDelete && (
          <>
            <div className="fixed inset-0 z-[94]" onClick={() => setBarEdit(false)} />
            <motion.div
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 500, damping: 34 }}
              className="fixed bottom-[4.75rem] left-1/2 z-[95] w-64 -translate-x-1/2 rounded-xl border border-border bg-popover p-1 text-foreground shadow-pop"
            >
              <EditPanel {...editProps} count={selectedIds.length} busy={busy} onPick={(kind, v) => { setBarEdit(false); onEdit(selectedIds, kind, v); }} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* optional due-date popup */}
      <AnimatePresence>
        {datePopup && <DatePopup ids={datePopup.ids} reduce={reduce} busy={busy} onClose={onCloseDate} onConfirm={onConfirmDate} />}
      </AnimatePresence>
      <AnimatePresence>
        {confirmDelete && <ConfirmDelete ids={confirmDelete} reduce={reduce} busy={busy} onCancel={onCancelDelete} onConfirm={onConfirmDelete} />}
      </AnimatePresence>
    </>,
    document.body,
  );
}

function ContextMenu({ menu, count, reduce, onSelect, onSelectAll, onDuplicate, onDuplicateDate, onCopyLink, onCopyToProject, onDelete, onEdit, busy, sections, statusOptions, members }: {
  menu: MenuState; count: number; reduce: boolean | null;
  onSelect: () => void; onSelectAll: () => void; onDuplicate: () => void; onDuplicateDate: () => void; onCopyLink: () => void; onCopyToProject: () => void; onDelete?: () => void;
  onEdit: (kind: EditKind, v: string | null) => void; busy: boolean;
  sections: Section[]; statusOptions: boolean; members: Member[];
}) {
  const { t, tn } = useLang();
  const [sub, setSub] = useState<EditKind | null>(null);
  const W = 224, H = sub ? 380 : 420;
  const many = count > 1;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - W - 8));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - H - 8));
  return (
    <motion.div
      role="menu"
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: -6 }}
      transition={{ type: "spring", stiffness: 500, damping: 34 }}
      style={{ left, top, transformOrigin: "top left" }}
      className="fixed z-[95] max-h-[calc(100dvh-1rem)] w-56 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-foreground shadow-pop"
    >
      {sub ? (
        <EditPanel sections={sections} statusOptions={statusOptions} members={members} count={count} busy={busy} start={sub} onBack={() => setSub(null)} onPick={onEdit} />
      ) : (
        <>
          <div className="truncate px-2 py-1.5 text-[11px] font-semibold text-muted-foreground">{many ? tn(count, "{n} task selected", "{n} tasks selected") : menu.task.title || t("Task")}</div>
          {!many && <MenuRow icon={CheckSquare} label={t("Select multiple")} onClick={onSelect} />}
          <MenuRow icon={ListChecks} label={t("Select all")} hint={modKey("A")} onClick={onSelectAll} />
          <hr className="my-1 border-border" />
          <MenuRow icon={CircleDot} label={t("Status")} more onClick={() => setSub("status")} />
          <MenuRow icon={Flag} label={t("Priority")} more onClick={() => setSub("priority")} />
          <MenuRow icon={UserPlus} label={t("Assign to")} more onClick={() => setSub("assignee")} />
          <MenuRow icon={CalendarDays} label={t("Due date")} more onClick={() => setSub("due")} />
          <hr className="my-1 border-border" />
          <MenuRow icon={Copy} label={t("Duplicate")} onClick={onDuplicate} disabled={busy} />
          <MenuRow icon={CopyPlus} label={t("Duplicate + date…")} onClick={onDuplicateDate} />
          <MenuRow icon={FolderInput} label={t("Copy to project")} onClick={onCopyToProject} />
          {!many && <MenuRow icon={Link2} label={t("Copy link")} onClick={onCopyLink} />}
          {onDelete && <hr className="my-1 border-border" />}
          {onDelete && <MenuRow icon={Trash2} label={t("Delete")} onClick={onDelete} danger disabled={busy} />}
        </>
      )}
    </motion.div>
  );
}

function MenuRow({ icon: Icon, label, onClick, more, danger, disabled, hint }: { icon: typeof Copy; label: string; onClick: () => void; more?: boolean; danger?: boolean; disabled?: boolean; hint?: string }) {
  return (
    <button role="menuitem" type="button" disabled={disabled} onClick={onClick} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors active:scale-[0.98] disabled:opacity-50", danger ? "text-destructive hover:bg-destructive/10" : "hover:bg-accent")}>
      <Icon className={cn("h-4 w-4 shrink-0", danger ? "" : "text-muted-foreground")} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {/* A key hint means nothing on a touch screen (QA B44). */}
      {hint && <span className="text-[11px] text-muted-foreground pointer-coarse:hidden">{hint}</span>}
      {more && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
  );
}

/**
 * Notion's "Edit property" for a selection: pick the property, then its value. Status = the project's
 * status options (its board columns); priority; a project member to assign; a due date (or none).
 */
function EditPanel({ sections, statusOptions, members, count, busy, start = null, onBack, onPick }: {
  sections: Section[]; statusOptions: boolean; members: Member[]; count: number; busy: boolean;
  start?: EditKind | null; onBack?: () => void; onPick: (kind: EditKind, v: string | null) => void;
}) {
  const { t, tn, lang } = useLang();
  const [kind, setKind] = useState<EditKind | null>(start);
  const [q, setQ] = useState("");
  const back = () => { if (start && onBack) onBack(); else setKind(null); setQ(""); };
  const title = kind === "status" ? t("Status") : kind === "priority" ? t("Priority") : kind === "assignee" ? t("Assign to") : kind === "due" ? t("Due date") : tn(count, "Edit {n} task", "Edit {n} tasks");
  const row = "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50";
  const shownMembers = members.filter((m) => !q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div>
      <div className="flex items-center gap-1 px-1 py-1">
        {kind && <button type="button" onClick={back} aria-label={t("Back")} className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-accent"><ChevronLeft className="h-3.5 w-3.5" /></button>}
        <span className="truncate px-1 text-[11px] font-semibold text-muted-foreground">{title}</span>
      </div>
      {!kind && (
        <>
          <MenuRow icon={CircleDot} label={t("Status")} more onClick={() => setKind("status")} />
          <MenuRow icon={Flag} label={t("Priority")} more onClick={() => setKind("priority")} />
          <MenuRow icon={UserPlus} label={t("Assign to")} more onClick={() => setKind("assignee")} />
          <MenuRow icon={CalendarDays} label={t("Due date")} more onClick={() => setKind("due")} />
        </>
      )}
      {kind === "status" && (
        <div className="max-h-72 overflow-y-auto">
          {sections.map((s) => (
            <button key={s.id} type="button" disabled={busy} onClick={() => onPick("status", s.id)} className={row}>
              {statusOptions ? <StatusPill option={s} /> : <span className="truncate">{s.name}</span>}
            </button>
          ))}
        </div>
      )}
      {kind === "priority" && PRIORITIES.map((p) => {
        const c = COLOR_PRESETS[optionColor("priority", p, [])];
        return (
          <button key={p} type="button" disabled={busy} onClick={() => onPick("priority", p)} className={row}>
            <span className="inline-flex items-center gap-1.5 rounded-full px-2 text-xs font-medium leading-5" style={{ backgroundColor: c?.bg, color: c?.text }}>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c?.dot }} />{statusLabel(p)}
            </span>
          </button>
        );
      })}
      {kind === "assignee" && (
        <>
          <div className="p-1"><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search team members…")} className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-ring" /></div>
          <div className="max-h-60 overflow-y-auto">
            {shownMembers.map((m) => (
              <button key={m.id} type="button" disabled={busy} onClick={() => onPick("assignee", m.id)} className={row}>
                <Avatar userId={m.id} name={m.name} avatar={m.avatar} size={20} className="shrink-0" /><span className="truncate">{m.name}</span>
              </button>
            ))}
            {shownMembers.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("No matching members.")}</div>}
          </div>
        </>
      )}
      {kind === "due" && (
        <div>
          <Calendar mode="single" locale={lang === "id" ? idLocale : enGB} weekStartsOn={1} onSelect={(d) => { if (d) onPick("due", new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).toISOString()); }} className="p-1" />
          <button type="button" disabled={busy} onClick={() => onPick("due", null)} className={cn(row, "text-muted-foreground")}><X className="h-3.5 w-3.5" />{t("Remove due date")}</button>
        </div>
      )}
    </div>
  );
}

function ConfirmDelete({ ids, reduce, busy, onCancel, onConfirm }: { ids: string[]; reduce: boolean | null; busy: boolean; onCancel: () => void; onConfirm: (ids: string[]) => void }) {
  const { t, tn } = useLang();
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => { ok.current?.focus(); }, []);
  return (
    <div className="fixed inset-0 z-[96] grid grid-cols-1 place-items-center p-4">
      <motion.div className="absolute inset-0 bg-black/55 dark:bg-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCancel} />
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="bulk-delete-title"
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 340, damping: 30 }}
        className="relative z-10 w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl"
      >
        <div id="bulk-delete-title" className="text-base font-semibold">{tn(ids.length, "Delete {n} task?", "Delete {n} tasks?")}</div>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("You can undo this right after (Undo or Ctrl+Z). Later, Control Room → Audit can restore it for 90 days.")}</p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" disabled={busy} onClick={onCancel} className="rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50">{t("Cancel")}</button>
          <button ref={ok} type="button" disabled={busy} onClick={() => onConfirm(ids)} className="inline-flex items-center gap-1.5 rounded-xl bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-60"><Trash2 className="h-4 w-4" /> {t("Delete")}</button>
        </div>
      </motion.div>
    </div>
  );
}

function DatePopup({ ids, reduce, busy, onClose, onConfirm }: { ids: string[]; reduce: boolean | null; busy: boolean; onClose: () => void; onConfirm: (ids: string[], dueDate: string | null) => void }) {
  const { t, tn } = useLang();
  const [date, setDate] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-[96] grid grid-cols-1 place-items-center p-4">
      <motion.div className="absolute inset-0 bg-black/55 dark:bg-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        role="dialog"
        aria-modal="true"
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 340, damping: 30 }}
        className="relative z-10 w-full max-w-sm rounded-3xl border border-border bg-card p-5 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><CopyPlus className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1"><div className="font-display text-lg font-bold tracking-tight">{tn(ids.length, "Duplicate {n} task", "Duplicate {n} tasks")}</div><div className="text-xs text-muted-foreground">{t("Set a new due date for the copies (optional).")}</div></div>
          <button onClick={onClose} aria-label={t("Close")} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t("Copy's due date")}</span>
          {/* The app's date field (C-BUG-23): the day as text, a calendar on click; no mm/dd/yyyy. */}
          <DateField value={date} onChange={setDate} ariaLabel={t("Copy's due date")} placeholder={t("Keep the original date")} className="h-10 rounded-xl border border-border bg-background px-3 hover:border-ring/40 hover:bg-background" />
          <p className="mt-1 text-[11px] text-muted-foreground">{t("Leave blank = keep the task's original date.")}</p>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button disabled={busy} onClick={onClose} className="rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50">{t("Cancel")}</button>
          {/* A date-only value is the local day: noon keeps it on that day in every timezone. */}
          <button disabled={busy} onClick={() => { const m = date && /^(\d{4})-(\d{2})-(\d{2})$/.exec(date); onConfirm(ids, m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).toISOString() : null); }} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"><Check className="h-4 w-4" /> {t("Duplicate")}</button>
        </div>
      </motion.div>
    </div>
  );
}
