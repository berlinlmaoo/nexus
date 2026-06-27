import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CalendarDays, CheckSquare, Copy, CopyPlus, Link2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { nexusApi, type NexusTask } from "@/lib/nexus-api";
import { celebrate } from "@/components/Celebration";

/**
 * Multi-select + duplicate for task cards across ALL project views (Board / List / Calendar / Timeline).
 * Gated by the project's `enableTaskBatchDuplicate` flag ("Task duplicate mode" toggle).
 *
 * Cards opt in by spreading `bulk.bindCard(task, () => onOpen(task))` — a PLAIN function (not a hook) so
 * it's safe to call inside `.map()`. Right-click (desktop) or long-press (mobile) opens the context menu;
 * once anything is selected, clicking cards toggles selection and a floating action bar appears.
 * Duplicate copies in place (same list); an OPTIONAL due-date popup overrides the copies' due date.
 */

type CardProps = {
  onClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onTouchStart?: (e: React.TouchEvent) => void;
  onTouchEnd?: () => void;
  onTouchMove?: () => void;
};
type BulkCtx = {
  enabled: boolean;
  selecting: boolean;
  isSelected: (id: string) => boolean;
  bindCard: (task: NexusTask, onOpen: () => void) => CardProps;
};
const DEFAULT: BulkCtx = { enabled: false, selecting: false, isSelected: () => false, bindCard: (_t, onOpen) => ({ onClick: () => onOpen() }) };
const Ctx = createContext<BulkCtx | null>(null);
export function useTaskBulk(): BulkCtx { return useContext(Ctx) ?? DEFAULT; }

const LONG_PRESS_MS = 480;

export function TaskBulkProvider({ projectId, enabled, children }: { projectId: string; enabled: boolean; children: ReactNode }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ task: NexusTask; x: number; y: number } | null>(null);
  const [datePopup, setDatePopup] = useState<{ ids: string[] } | null>(null);
  const lpTimer = useRef<number | undefined>(undefined);
  const lpFired = useRef(false);

  const selecting = selected.size > 0;
  const refresh = useCallback(() => { qc.invalidateQueries({ queryKey: ["nexus", "project", projectId] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); }, [qc, projectId]);

  const toggle = useCallback((id: string) => setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; }), []);
  const clear = useCallback(() => setSelected(new Set()), []);

  const dupMut = useMutation({
    mutationFn: async ({ ids, dueDate }: { ids: string[]; dueDate?: string | null }) => { for (const id of ids) await nexusApi.duplicateTask(id, dueDate); return ids.length; },
    onSuccess: (n) => { refresh(); clear(); setDatePopup(null); celebrate(n > 1 ? `${n} tasks duplicated` : "Task duplicated"); },
  });
  const delMut = useMutation({
    mutationFn: async (ids: string[]) => { for (const id of ids) await nexusApi.deleteTask(id); return ids.length; },
    onSuccess: (n) => { refresh(); clear(); setMenu(null); celebrate(n > 1 ? `${n} tasks deleted` : "Task deleted"); },
  });

  const bindCard = useCallback((task: NexusTask, onOpen: () => void): CardProps => {
    if (!enabled) return { onClick: () => onOpen() };
    return {
      onClick: (e) => {
        if (lpFired.current) { lpFired.current = false; e.preventDefault(); e.stopPropagation(); return; } // swallow the click that follows a long-press
        if (selected.size > 0) { e.preventDefault(); e.stopPropagation(); toggle(task.id); return; }
        onOpen();
      },
      onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); setMenu({ task, x: e.clientX, y: e.clientY }); },
      onTouchStart: (e) => {
        const t = e.touches[0];
        lpFired.current = false;
        window.clearTimeout(lpTimer.current);
        lpTimer.current = window.setTimeout(() => { lpFired.current = true; if (navigator.vibrate) navigator.vibrate(8); setMenu({ task, x: t.clientX, y: t.clientY }); }, LONG_PRESS_MS);
      },
      onTouchEnd: () => window.clearTimeout(lpTimer.current),
      onTouchMove: () => window.clearTimeout(lpTimer.current),
    };
  }, [enabled, selected, toggle]);

  const value = useMemo<BulkCtx>(() => ({ enabled, selecting, isSelected: (id) => selected.has(id), bindCard }), [enabled, selecting, selected, bindCard]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {enabled && (
        <BulkLayer
          menu={menu}
          onCloseMenu={() => setMenu(null)}
          selectedIds={[...selected]}
          onBeginSelect={(t) => { setSelected((prev) => new Set(prev).add(t.id)); setMenu(null); }}
          onDuplicateNow={(ids) => dupMut.mutate({ ids })}
          onDuplicateWithDate={(ids) => { setMenu(null); setDatePopup({ ids }); }}
          onDelete={(ids) => delMut.mutate(ids)}
          onClear={clear}
          datePopup={datePopup}
          onCloseDate={() => setDatePopup(null)}
          onConfirmDate={(ids, dueDate) => dupMut.mutate({ ids, dueDate })}
          busy={dupMut.isPending || delMut.isPending}
        />
      )}
    </Ctx.Provider>
  );
}

function BulkLayer({ menu, onCloseMenu, selectedIds, onBeginSelect, onDuplicateNow, onDuplicateWithDate, onDelete, onClear, datePopup, onCloseDate, onConfirmDate, busy }: {
  menu: { task: NexusTask; x: number; y: number } | null;
  onCloseMenu: () => void;
  selectedIds: string[];
  onBeginSelect: (t: NexusTask) => void;
  onDuplicateNow: (ids: string[]) => void;
  onDuplicateWithDate: (ids: string[]) => void;
  onDelete: (ids: string[]) => void;
  onClear: () => void;
  datePopup: { ids: string[] } | null;
  onCloseDate: () => void;
  onConfirmDate: (ids: string[], dueDate: string | null) => void;
  busy: boolean;
}) {
  const reduce = useReducedMotion();
  if (typeof document === "undefined") return null;
  return createPortal(
    <>
      {/* context menu */}
      <AnimatePresence>
        {menu && (
          <>
            <div className="fixed inset-0 z-[93]" onClick={onCloseMenu} onContextMenu={(e) => { e.preventDefault(); onCloseMenu(); }} />
            <ContextMenu key={menu.task.id} menu={menu} reduce={reduce}
              onSelect={() => onBeginSelect(menu.task)}
              onDuplicate={() => { onDuplicateNow([menu.task.id]); onCloseMenu(); }}
              onDuplicateDate={() => onDuplicateWithDate([menu.task.id])}
              onCopyLink={() => { navigator.clipboard?.writeText(`${window.location.origin}/tasks/${menu.task.id}`); celebrate("Link copied"); onCloseMenu(); }}
              onDelete={() => onDelete([menu.task.id])}
            />
          </>
        )}
      </AnimatePresence>

      {/* floating selection bar */}
      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            className="fixed bottom-5 left-1/2 z-[94] flex -translate-x-1/2 items-center gap-1.5 rounded-2xl border border-border bg-popover px-2 py-2 shadow-pop"
          >
            <span className="px-2 text-sm font-bold tabular-nums">{selectedIds.length} selected</span>
            <button disabled={busy} onClick={() => onDuplicateNow(selectedIds)} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-accent disabled:opacity-50"><Copy className="h-3.5 w-3.5" /> Duplicate</button>
            <button disabled={busy} onClick={() => onDuplicateWithDate(selectedIds)} title="Duplicate + set due date" className="grid h-8 w-8 place-items-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"><CalendarDays className="h-4 w-4" /></button>
            <button disabled={busy} onClick={() => { if (window.confirm(`Delete ${selectedIds.length} task${selectedIds.length === 1 ? '' : 's'}?`)) onDelete(selectedIds); }} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
            <button onClick={onClear} className="grid h-8 w-8 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent" aria-label="Cancel"><X className="h-4 w-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* optional due-date popup */}
      <AnimatePresence>
        {datePopup && <DatePopup ids={datePopup.ids} reduce={reduce} busy={busy} onClose={onCloseDate} onConfirm={onConfirmDate} />}
      </AnimatePresence>
    </>,
    document.body,
  );
}

function ContextMenu({ menu, reduce, onSelect, onDuplicate, onDuplicateDate, onCopyLink, onDelete }: {
  menu: { task: NexusTask; x: number; y: number }; reduce: boolean | null;
  onSelect: () => void; onDuplicate: () => void; onDuplicateDate: () => void; onCopyLink: () => void; onDelete: () => void;
}) {
  const W = 208, H = 240;
  const left = Math.min(menu.x, window.innerWidth - W - 8);
  const top = Math.min(menu.y, window.innerHeight - H - 8);
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: -6 }}
      transition={{ type: "spring", stiffness: 500, damping: 34 }}
      style={{ left, top, transformOrigin: "top left" }}
      className="fixed z-[95] w-52 rounded-xl border border-border bg-popover p-1 text-foreground shadow-pop"
    >
      <div className="truncate px-2 py-1.5 text-[11px] font-semibold text-muted-foreground">{menu.task.title || "Task"}</div>
      <MenuRow icon={CheckSquare} label="Select multiple" onClick={onSelect} />
      <MenuRow icon={Copy} label="Duplicate" onClick={onDuplicate} />
      <MenuRow icon={CopyPlus} label="Duplicate + date…" onClick={onDuplicateDate} />
      <MenuRow icon={Link2} label="Copy link" onClick={onCopyLink} />
      <hr className="my-1 border-border" />
      <HoldDelete onConfirm={onDelete} />
    </motion.div>
  );
}

function MenuRow({ icon: Icon, label, onClick }: { icon: typeof Copy; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent active:scale-[0.98]">
      <span>{label}</span> <Icon className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

/** Press-and-hold to confirm delete (ported from the inline-dropdown reference, our tokens). */
function HoldDelete({ onConfirm }: { onConfirm: () => void }) {
  const [pct, setPct] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const start = () => {
    const t0 = performance.now();
    const tick = () => {
      const p = Math.min(100, ((performance.now() - t0) / 800) * 100);
      setPct(p);
      if (p >= 100) { stop(); onConfirm(); } else timer.current = requestAnimationFrame(tick);
    };
    timer.current = requestAnimationFrame(tick);
  };
  const stop = () => { if (timer.current) cancelAnimationFrame(timer.current); setPct(0); };
  return (
    <button
      onMouseDown={start} onMouseUp={stop} onMouseLeave={stop} onTouchStart={start} onTouchEnd={stop}
      className="relative flex w-full select-none items-center justify-between overflow-hidden rounded-lg px-2 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10"
    >
      <span className="relative z-10">{pct > 0 ? "Hold to delete…" : "Delete"}</span>
      <Trash2 className="relative z-10 h-4 w-4" />
      <span className="absolute inset-y-0 left-0 bg-destructive/20" style={{ width: `${pct}%` }} />
    </button>
  );
}

function DatePopup({ ids, reduce, busy, onClose, onConfirm }: { ids: string[]; reduce: boolean | null; busy: boolean; onClose: () => void; onConfirm: (ids: string[], dueDate: string | null) => void }) {
  const [date, setDate] = useState("");
  return (
    <div className="fixed inset-0 z-[96] grid place-items-center p-4">
      <motion.div className="absolute inset-0 bg-black/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 340, damping: 30 }}
        className="relative z-10 w-full max-w-sm rounded-3xl border border-border bg-card p-5 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><CopyPlus className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1"><div className="font-display text-lg font-bold tracking-tight">Duplicate {ids.length} task{ids.length === 1 ? '' : 's'}</div><div className="text-xs text-muted-foreground">Set a new due date for the copies (optional).</div></div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4">
          <label className="mb-1 block text-xs font-semibold text-muted-foreground">Copy's due date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-primary" />
          <p className="mt-1 text-[11px] text-muted-foreground">Leave blank = keep the task's original date.</p>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button disabled={busy} onClick={onClose} className="rounded-xl px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50">Cancel</button>
          <button disabled={busy} onClick={() => onConfirm(ids, date ? new Date(date).toISOString() : null)} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"><CopyPlus className="h-4 w-4" /> Duplicate</button>
        </div>
      </motion.div>
    </div>
  );
}
