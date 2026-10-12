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
 *
 * History is kept PER SHEET (tab): every entry's closures write through the page's "current sheet",
 * so an entry may only ever run while its own sheet is open. Switching tabs swaps the stacks, and
 * coming back to a tab brings its history back.
 *
 * `group(label, fn)` turns everything pushed while `fn` runs (a paste that grows the sheet, writes the
 * values and their formats) into ONE entry, so one Ctrl+Z undoes one user action, as in Sheets.
 */
export type UndoEntry = {
  /** Shown in the toast, e.g. "hapus 3 baris". */
  label: string;
  undo: () => void | Promise<void>;
  redo: () => void | Promise<void>;
};

const LIMIT = 50;

type Stacks = { past: UndoEntry[]; future: UndoEntry[] };

export function useSheetUndo(scope: string | null = null) {
  const stacks = useRef(new Map<string, Stacks>());
  const scopeRef = useRef(scope ?? "");
  scopeRef.current = scope ?? "";
  const cur = () => {
    let s = stacks.current.get(scopeRef.current);
    if (!s) { s = { past: [], future: [] }; stacks.current.set(scopeRef.current, s); }
    return s;
  };
  // Depth is state (not a ref) purely so the toolbar buttons can enable/disable.
  const [depth, setDepth] = useState({ undo: 0, redo: 0, scope: scope ?? "" });
  const busy = useRef(false);
  const collecting = useRef<UndoEntry[] | null>(null);

  const sync = () => { const s = cur(); setDepth({ undo: s.past.length, redo: s.future.length, scope: scopeRef.current }); };

  const push = useCallback((entry: UndoEntry) => {
    // An undo that's itself the result of undoing must not be recorded, or undo/redo ping-pongs.
    if (busy.current) return;
    if (collecting.current) { collecting.current.push(entry); return; }
    const s = cur();
    s.past.push(entry);
    if (s.past.length > LIMIT) s.past.shift();
    // Any fresh edit invalidates the redo branch — same as every editor.
    s.future = [];
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const group = useCallback(async <T,>(label: string, fn: () => T | Promise<T>): Promise<T> => {
    // Nested groups fold into the outer one.
    if (collecting.current) return fn();
    const parts: UndoEntry[] = [];
    collecting.current = parts;
    try {
      return await fn();
    } finally {
      collecting.current = null;
      if (parts.length === 1) push({ ...parts[0], label });
      else if (parts.length > 1) {
        push({
          label,
          undo: async () => { for (const p of [...parts].reverse()) await p.undo(); },
          redo: async () => { for (const p of parts) await p.redo(); },
        });
      }
    }
  }, [push]);

  const run = useCallback(async (from: "past" | "future") => {
    const s = cur();
    const src = from === "past" ? s.past : s.future;
    const dst = from === "past" ? s.future : s.past;
    const entry = src.pop();
    if (!entry) return null;
    busy.current = true;
    try {
      await (from === "past" ? entry.undo() : entry.redo());
      dst.push(entry);
      return entry.label;
    } finally {
      busy.current = false;
      sync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const undo = useCallback(() => run("past"), [run]);
  const redo = useCallback(() => run("future"), [run]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const clear = useCallback(() => { stacks.current.set(scopeRef.current, { past: [], future: [] }); sync(); }, []);

  // The toolbar's enabled state follows the open tab without waiting for the next push.
  const s = stacks.current.get(scope ?? "");
  const live = depth.scope === (scope ?? "") ? depth : { undo: s?.past.length ?? 0, redo: s?.future.length ?? 0 };
  return { push, group, undo, redo, clear, canUndo: live.undo > 0, canRedo: live.redo > 0 };
}
