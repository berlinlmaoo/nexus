import { useCallback, useRef, useState } from "react";

/**
 * Undo/redo for the spreadsheet.
 *
 * Every mutation pushes an entry that knows how to reverse itself AND how to do itself again. Nothing
 * is diffed after the fact: the caller captures the previous values at the moment it has them, which
 * is the only point where they're reliably known (a refetch can land at any time).
 *
 * This is what makes destructive actions safe enough to hand to everyone — before it existed, column
 * delete had to be gated to LEAD because there was no way back.
 */
export type UndoEntry = {
  /** Shown in the toast, e.g. "hapus 3 baris". */
  label: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
};

const LIMIT = 50;

export function useSheetUndo() {
  const past = useRef<UndoEntry[]>([]);
  const future = useRef<UndoEntry[]>([]);
  // Depth is state (not a ref) purely so the toolbar buttons can enable/disable.
  const [depth, setDepth] = useState({ undo: 0, redo: 0 });
  const busy = useRef(false);

  const sync = () => setDepth({ undo: past.current.length, redo: future.current.length });

  const push = useCallback((entry: UndoEntry) => {
    // An undo that's itself the result of undoing must not be recorded, or undo/redo ping-pongs.
    if (busy.current) return;
    past.current.push(entry);
    if (past.current.length > LIMIT) past.current.shift();
    // Any fresh edit invalidates the redo branch — same as every editor.
    future.current = [];
    sync();
  }, []);

  const run = useCallback(async (from: "past" | "future") => {
    const src = from === "past" ? past : future;
    const dst = from === "past" ? future : past;
    const entry = src.current.pop();
    if (!entry) return null;
    busy.current = true;
    try {
      await (from === "past" ? entry.undo() : entry.redo());
      dst.current.push(entry);
      return entry.label;
    } finally {
      busy.current = false;
      sync();
    }
  }, []);

  const undo = useCallback(() => run("past"), [run]);
  const redo = useCallback(() => run("future"), [run]);
  const clear = useCallback(() => { past.current = []; future.current = []; sync(); }, []);

  return { push, undo, redo, clear, canUndo: depth.undo > 0, canRedo: depth.redo > 0 };
}
