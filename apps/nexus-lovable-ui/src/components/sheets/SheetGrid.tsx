import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownAZ, ArrowUpAZ, Check, ChevronDown, ClipboardPaste, Copy, Eraser, Filter, MessageSquare, Pencil, Plus,
  Link2 as LinkIcon, Replace, RotateCcw, Scissors, Search, Trash2, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NexusSheetColumnColor } from "@/lib/nexus-api";

// Mirrors ROW_HEIGHT_MIN / ROW_HEIGHT_MAX in src/lib/project-sheets.ts — the server clamps to the
// same bounds, so a hand-crafted request can't produce a row the grid won't render sanely.
const ROW_H_MIN = 20;
const ROW_H_MAX = 400;

/**
 * Windowing.
 *
 * A 1.000-row sheet put 10.030 <td> in the DOM and a single arrow-key press locked the tab for over
 * 45 seconds — the browser was relaying out the whole table on every selection change. Only the rows
 * on screen (plus a buffer) are rendered now; the space above and below is held open by two spacer
 * rows so the scrollbar still reflects the real size.
 *
 * Row heights are therefore EXACT, not estimated: every <tr> gets an explicit height, so the running
 * offsets used to pick the window can't drift from what's painted.
 */
const ROW_H_DEFAULT = 29;
const WINDOW_BUFFER = 12;
import {
  COLUMN_TYPE_LABEL, RULE_OP_LABEL, RULE_STYLE_CLASS, aggregate, buildSheetData, displayCell, editFormula, editValue,
  COLUMN_COLOR_CLASS, COLUMN_COLOR_LABEL,
  CHIP_COLORS, CHIP_COLOR_CLASS,
  fillValues, formatCell, isLinkCell, matchRule, optionColor, parseTsv, readMulti, toTsv,
  type NexusSheetCellValue, type NexusSheetColumn, type NexusSheetColumnType, type NexusSheetRow, type NexusSheetRule,
} from "./sheet-types";
import { SUPPORTED_FUNCTIONS, letterToIndex, toStored } from "@/lib/sheet-formula";

/**
 * The grid.
 *
 * The load-bearing decision: **only ONE <input> is mounted at a time** — the cell being edited.
 * Every other cell is a plain <td> with formatted text. That single choice solves three problems at
 * once: thousands of mounted inputs would kill the browser; a background refetch can't steal focus
 * from an input that doesn't exist; and Rupiah/date formatting renders as text instead of fighting
 * the input's value. The uncontrolled-input-with-composite-key idea is lifted from
 * FinanceDashboardView, which is the app's other editable grid.
 */

export type Selection = { r: number; c: number; r2: number; c2: number };
type Editing = { rowId: string; colId: string; seed?: string } | null;

/** Dashed outline colours for referenced ranges, cycled per distinct reference. */
const REF_COLORS = [
  "outline-amber-500",
  "outline-violet-500",
  "outline-sky-500",
  "outline-emerald-500",
  "outline-rose-500",
] as const;

const isFormula = (v: unknown): boolean => Boolean(v) && typeof v === "object" && "f" in (v as object);

const rectOf = (s: Selection) => ({
  top: Math.min(s.r, s.r2), bottom: Math.max(s.r, s.r2),
  left: Math.min(s.c, s.c2), right: Math.max(s.c, s.c2),
});


type FillRect = { top: number; bottom: number; left: number; right: number; axis: "down" | "up" | "right" | "left" };

/**
 * Where a fill drag will land: the block of cells ABOUT to be written, never the source block.
 *
 * ONE function feeds both the dashed preview and the actual write. Keeping them apart is what let
 * the preview paint whole rows while the write touched a single column, so they share this now.
 *
 * Axis-locked, like Excel: a drag extends down/up OR left/right, whichever way the pointer travelled
 * further past the block. A diagonal drag filling a whole rectangle would overwrite a lot of cells
 * nobody aimed at.
 */
function fillTarget(rect: { top: number; bottom: number; left: number; right: number }, to: { r: number; c: number } | null): FillRect | null {
  if (!to) return null;
  const down = to.r - rect.bottom, up = rect.top - to.r;
  const right = to.c - rect.right, left = rect.left - to.c;
  const vert = Math.max(down, up), horiz = Math.max(right, left);
  if (vert <= 0 && horiz <= 0) return null; // back inside the block
  if (vert >= horiz) {
    return down > 0
      ? { top: rect.bottom + 1, bottom: to.r, left: rect.left, right: rect.right, axis: "down" }
      : { top: to.r, bottom: rect.top - 1, left: rect.left, right: rect.right, axis: "up" };
  }
  return right > 0
    ? { top: rect.top, bottom: rect.bottom, left: rect.right + 1, right: to.c, axis: "right" }
    : { top: rect.top, bottom: rect.bottom, left: to.c, right: rect.left - 1, axis: "left" };
}

export function SheetGrid({
  columns, rows, canEdit, canManage,
  onSetCells, onAddRows, onDeleteRows, onReorderRow, onDeleteColumn, onEditColumn, onAddColumn, tasks, onOpenTask, commentCounts, onOpenComments,
  peerCursors, onEditingChange, onCursor, onResizeRow, onInsertColumn,
}: {
  columns: NexusSheetColumn[];
  rows: NexusSheetRow[];
  canEdit: boolean;
  canManage: boolean;
  onSetCells: (edits: { rowId: string; values: Record<string, unknown> }[]) => void;
  onAddRows: (payload: { count?: number; afterRowId?: string; beforeRowId?: string; rows?: Record<string, unknown>[] }) => Promise<NexusSheetRow[]>;
  onDeleteRows: (rowIds: string[]) => void;
  /** Move `rowId` to just after `afterRowId`; null means "to the top". */
  onReorderRow: (rowId: string, afterRowId: string | null) => void;
  onDeleteColumn: (columnId: string) => void;
  onEditColumn: (columnId: string, patch: { name?: string; type?: NexusSheetColumnType; width?: number; options?: string[]; optionColors?: Record<string, NexusSheetColumnColor>; color?: NexusSheetColumnColor; rules?: NexusSheetRule[] }) => void;
  onAddColumn: () => void;
  /** Project tasks, for the "task" column type. */
  tasks: { id: string; title: string; status?: string | null }[];
  onOpenTask?: (taskId: string) => void;
  /** "rowId:columnId" -> unresolved comment count, for the corner marker. */
  commentCounts: Record<string, number>;
  onOpenComments: (rowId: string, columnId: string, at: { left: number; top: number }) => void;
  /** Where everyone else is parked: "rowId:columnId" -> their name and colour. */
  peerCursors: Record<string, { name: string; color: string }>;
  /** Reports the cell open in the editor, so an incoming realtime patch can skip it. */
  onEditingChange: (cell: { rowId: string; colId: string } | null) => void;
  onCursor: (rowId: string | null, columnId: string | null) => void;
  onResizeRow: (rowId: string, height: number | null) => void;
  /** Insert a fresh column AT this index (existing ones shift right). */
  onInsertColumn: (index: number) => void;
}) {
  const [sel, setSel] = useState<Selection>({ r: 0, c: 0, r2: 0, c2: 0 });
  /** Right-click menu for a row, anchored at the pointer. */
  const [rowMenu, setRowMenu] = useState<
    { rowId: string; number: number; height: number | null; left: number; top: number } | null
  >(null);
  /** Right-click menu for a cell, anchored at the pointer. */
  const [cellMenu, setCellMenu] = useState<{ r: number; c: number; left: number; top: number } | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const maxC = columns.length - 1;
  const dragging = useRef(false);
  // Row drag uses the HTML5 DnD API on the row-number gutter only, so it never fights cell selection
  // (which is a mousedown-drag on the cells themselves).
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [dropRow, setDropRow] = useState<string | null>(null);
  const rect = useMemo(() => rectOf(sel), [sel]);
  // Formulas are evaluated at render, never stored — so the context is rebuilt whenever the data is.
  const data = useMemo(() => buildSheetData(columns, rows), [columns, rows]);

  // While a FORMULA is being edited, clicking a cell inserts its reference instead of moving the
  // selection — that's the behaviour that makes formulas usable without memorising addresses.
  const [draft, setDraft] = useState("");
  const editorEl = useRef<HTMLInputElement | null>(null);
  // Where the ref just inserted by a click lives, so dragging can widen it into a range in place.
  const refSpan = useRef<{ at: number; len: number; anchor: { r: number; c: number } } | null>(null);
  // Dragging the little square at the selection's bottom-right corner: fill down (or up) from it.
  const [fillTo, setFillTo] = useState<{ r: number; c: number } | null>(null);
  const filling = useRef(false);
  const [sort, setSort] = useState<{ colId: string; dir: "asc" | "desc" } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  /** Column whose filter box should be forced open — the cell menu can't reach HeaderCell's state. */
  const [openFilterFor, setOpenFilterFor] = useState<string | null>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 700 });
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState({ q: "", to: "", matchCase: false });

  /**
   * What's on screen: the rows after sorting/filtering, each keeping its index in the UNDERLYING
   * order.
   *
   * Sorting here is a per-viewer VIEW, never a write — `SheetRow.position` is untouched. If sorting
   * actually moved rows, one person sorting by amount would silently rearrange the sheet for
   * everyone else who has it open.
   *
   * The raw index is what the gutter number and every A1 reference use, so a formula written while
   * the view is sorted still points at the row the user clicked.
   */
  const view = useMemo(() => {
    let list = rows.map((row, rawIndex) => ({ row, rawIndex }));

    const active = Object.entries(filters).filter(([, q]) => q.trim());
    if (active.length) {
      list = list.filter(({ row }) => active.every(([colId, q]) => {
        const col = columns.find((c) => c.id === colId);
        const shown = col ? displayCell(col.type, row.cells[colId], null) : String(row.cells[colId] ?? "");
        return shown.toLowerCase().includes(q.trim().toLowerCase());
      }));
    }

    if (sort) {
      const col = columns.find((c) => c.id === sort.colId);
      const dir = sort.dir === "asc" ? 1 : -1;
      list = [...list].sort((a, b) => {
        const av = a.row.cells[sort.colId];
        const bv = b.row.cells[sort.colId];
        const aEmpty = av === undefined || av === null || av === "";
        const bEmpty = bv === undefined || bv === null || bv === "";
        // Empties always sink, in both directions — a column of blanks on top is never what you want.
        if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1;
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
        const as = col ? displayCell(col.type, av, null) : String(av);
        const bs = col ? displayCell(col.type, bv, null) : String(bv);
        return as.localeCompare(bs, "id") * dir;
      });
    }
    return list;
  }, [rows, columns, sort, filters]);

  /** Running pixel offset of every row, so the window and the spacers agree to the pixel. */
  const offsets = useMemo(() => {
    const out = new Array<number>(view.length + 1);
    out[0] = 0;
    for (let i = 0; i < view.length; i += 1) out[i + 1] = out[i] + (view[i].row.height ?? ROW_H_DEFAULT);
    return out;
  }, [view]);
  const totalHeight = offsets[view.length] ?? 0;

  /**
   * Scroll + size tracking.
   *
   * Called straight from the scroll event, NOT wrapped in requestAnimationFrame: the browser already
   * fires scroll at most once per frame, React batches the state update, and the rAF version simply
   * stops working wherever rAF is throttled (a background tab), leaving the window frozen on stale
   * rows. Returning `prev` unchanged when nothing moved keeps this from re-rendering on no-op events.
   */
  const syncScroll = useCallback(() => {
    const el = gridRef.current;
    if (!el) return;
    setScroll((prev) =>
      prev.top === el.scrollTop && prev.height === el.clientHeight
        ? prev
        : { top: el.scrollTop, height: el.clientHeight },
    );
  }, []);
  const onGridScroll = syncScroll;
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    syncScroll();
    const ro = new ResizeObserver(syncScroll);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncScroll]);

  /**
   * Keep the cursor on screen. Without windowing the browser did this for free, because every row
   * existed; now a selection can move to a row that isn't mounted, and nothing would appear to happen.
   */
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const top = offsets[sel.r] ?? 0;
    const bottom = offsets[sel.r + 1] ?? top + ROW_H_DEFAULT;
    const headerH = 34; // the sticky <thead> covers this much of the top
    if (top < el.scrollTop + headerH) el.scrollTop = Math.max(0, top - headerH);
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, [sel.r, offsets]);

  const [winFirst, winLast] = useMemo(() => {
    if (view.length <= WINDOW_BUFFER * 3) return [0, view.length]; // small sheet: don't bother
    // Binary search rather than a scan: this runs on every scroll frame.
    let lo = 0, hi = view.length - 1, start = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1] <= scroll.top) lo = mid + 1;
      else { start = mid; hi = mid - 1; }
    }
    let end = start;
    while (end < view.length && offsets[end] < scroll.top + scroll.height) end += 1;
    return [Math.max(0, start - WINDOW_BUFFER), Math.min(view.length, end + WINDOW_BUFFER)];
  }, [offsets, scroll.top, scroll.height, view.length]);

  const viewRows = useMemo(() => view.map((v) => v.row), [view]);
  const maxR = view.length - 1;
  const filtering = Object.values(filters).some((q) => q.trim()) || Boolean(sort);

  /** True when the caret sits somewhere a cell reference may legally go. */
  const refMode = useMemo(() => {
    if (!editing || !draft.startsWith("=")) return false;
    const el = editorEl.current;
    const caret = el?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret).replace(/\s+$/, "");
    return before === "=" || /[=+\-*/^&<>(,;:]$/.test(before);
  }, [editing, draft]);

  const a1 = useCallback((r: number, c: number) => `${colLetter(c)}${r + 1}`, []);

  /**
   * The rectangles the draft formula refers to, each with a colour — the dashed outlines that make
   * it obvious which cells a formula is actually reading.
   */
  const refRects = useMemo(() => {
    if (!editing || !draft.startsWith("=")) return [];
    const out: { top: number; left: number; bottom: number; right: number; color: number }[] = [];
    const re = /([A-Za-z]{1,3})(\d+)(?::([A-Za-z]{1,3})(\d+))?/g;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(draft))) {
      const c1 = letterToIndex(m[1]);
      const r1 = Number(m[2]) - 1;
      const c2 = m[3] ? letterToIndex(m[3]) : c1;
      const r2 = m[4] ? Number(m[4]) - 1 : r1;
      if (c1 < 0 || r1 < 0 || c1 > maxC || r1 > maxR) continue;
      out.push({
        top: Math.min(r1, r2), bottom: Math.max(r1, r2),
        left: Math.min(c1, c2), right: Math.max(c1, c2),
        color: i % REF_COLORS.length,
      });
      i += 1;
    }
    return out;
  }, [editing, draft, maxR, maxC]);

  /** Put `textToInsert` at the caret, or replace the ref a drag is currently widening. */
  const putRef = useCallback((textToInsert: string, anchor: { r: number; c: number } | null) => {
    const el = editorEl.current;
    if (!el) return;
    const span = refSpan.current;
    const at = span ? span.at : el.selectionStart ?? el.value.length;
    const len = span ? span.len : 0;
    const next = el.value.slice(0, at) + textToInsert + el.value.slice(at + len);
    el.value = next;
    setDraft(next);
    refSpan.current = { at, len: textToInsert.length, anchor: anchor ?? span?.anchor ?? { r: 0, c: 0 } };
    const caret = at + textToInsert.length;
    el.focus();
    el.setSelectionRange(caret, caret);
  }, []);


  const clamp = useCallback((r: number, c: number) => ({
    r: Math.max(0, Math.min(maxR, r)),
    c: Math.max(0, Math.min(maxC, c)),
  }), [maxR, maxC]);

  const move = useCallback((dr: number, dc: number, extend: boolean) => {
    setSel((s) => {
      const { r, c } = clamp((extend ? s.r2 : s.r) + dr, (extend ? s.c2 : s.c) + dc);
      return extend ? { ...s, r2: r, c2: c } : { r, c, r2: r, c2: c };
    });
  }, [clamp]);

  const commit = useCallback((rowId: string, colId: string, raw: string) => {
    const col = columns.find((x) => x.id === colId);
    if (!col) return;
    const prevRaw = rows.find((x) => x.id === rowId)?.cells[colId];

    // A leading "=" makes it a formula. It's translated into id-space HERE, while the current row
    // and column order is known — after that, inserting rows or moving columns can never break it.
    if (raw.trim().startsWith("=")) {
      const stored = toStored(raw.trim(), data.shape);
      const prevF = prevRaw && typeof prevRaw === "object" && "f" in prevRaw ? (prevRaw as { f: string }).f : null;
      if (prevF === stored) return;
      onSetCells([{ rowId, values: { [colId]: { f: stored } } }]);
      return;
    }

    // Typing over a link edits what it SAYS, not where it goes — the URL is the part you can't
    // retype from memory, so it survives unless the cell is cleared. "Atur URL…" in the right-click
    // menu is how the address itself changes.
    if (col.type === "link") {
      const text = raw.trim();
      const prevUrl = isLinkCell(prevRaw) ? prevRaw.u : "";
      if (!text) { onSetCells([{ rowId, values: { [colId]: null } }]); return; }
      onSetCells([{ rowId, values: { [colId]: prevUrl ? { t: text, u: prevUrl } : text } }]);
      return;
    }

    const next = col.type === "checkbox" ? raw === "true" : raw;
    const prevPlain = prevRaw && typeof prevRaw === "object" ? "\u0000formula" : prevRaw;
    // Don't spend a request when nothing actually changed (blur fires on every exit).
    if (String(prevPlain ?? "") === String(next ?? "")) return;
    onSetCells([{ rowId, values: { [colId]: raw === "" ? null : next } }]);
  }, [columns, rows, onSetCells, data.shape]);

  /** Clear every cell in the current rectangle in one request. */
  const clearSelection = useCallback(() => {
    if (!canEdit) return;
    const edits: { rowId: string; values: Record<string, unknown> }[] = [];
    for (let r = rect.top; r <= rect.bottom; r += 1) {
      const row = view[r]?.row;
      if (!row) continue;
      const values: Record<string, unknown> = {};
      for (let c = rect.left; c <= rect.right; c += 1) {
        const col = columns[c];
        if (col) values[col.id] = null;
      }
      if (Object.keys(values).length) edits.push({ rowId: row.id, values });
    }
    if (edits.length) onSetCells(edits);
  }, [canEdit, rect, view, columns, onSetCells]);

  /** Same helper the write uses, so the dashed outline can never promise a different block. */
  const fillPreviewRect = useMemo(() => fillTarget(rect, fillTo), [rect, fillTo]);

  /** Commit whatever the fill drag is previewing. */
  const applyFill = useCallback((to: { r: number; c: number }) => {
    if (!canEdit) return;
    const t = fillTarget(rect, to);
    if (!t) return;

    const edits: { rowId: string; values: Record<string, unknown> }[] = [];
    const put = (rowIdx: number, colIdx: number, value: NexusSheetCellValue | null | undefined) => {
      const row = view[rowIdx]?.row;
      const col = columns[colIdx];
      if (!row || !col) return;
      const entry = edits.find((e) => e.rowId === row.id) ?? (() => {
        const fresh = { rowId: row.id, values: {} as Record<string, unknown> };
        edits.push(fresh);
        return fresh;
      })();
      entry.values[col.id] = value ?? null;
    };
    /** A formula never seeds a series — its value belongs to its own position, not the pattern. */
    const raw = (r: number, c: number) => {
      const col = columns[c];
      const v = col ? view[r]?.row.cells[col.id] : undefined;
      return isFormula(v) ? undefined : (v as NexusSheetCellValue | undefined);
    };

    if (t.axis === "down" || t.axis === "up") {
      // Targets ordered AWAY from the block, so a series counts in the direction it grows.
      const targets: number[] = [];
      if (t.axis === "down") for (let r = t.top; r <= t.bottom; r += 1) targets.push(r);
      else for (let r = t.bottom; r >= t.top; r -= 1) targets.push(r);
      for (let c = rect.left; c <= rect.right; c += 1) {
        const source: (NexusSheetCellValue | undefined)[] = [];
        for (let r = rect.top; r <= rect.bottom; r += 1) source.push(raw(r, c));
        const produced = fillValues(t.axis === "down" ? source : [...source].reverse(), targets.length);
        targets.forEach((r, i) => put(r, c, produced[i]));
      }
    } else {
      const targets: number[] = [];
      if (t.axis === "right") for (let c = t.left; c <= t.right; c += 1) targets.push(c);
      else for (let c = t.right; c >= t.left; c -= 1) targets.push(c);
      for (let r = rect.top; r <= rect.bottom; r += 1) {
        const source: (NexusSheetCellValue | undefined)[] = [];
        for (let c = rect.left; c <= rect.right; c += 1) source.push(raw(r, c));
        const produced = fillValues(t.axis === "right" ? source : [...source].reverse(), targets.length);
        targets.forEach((c, i) => put(r, c, produced[i]));
      }
    }
    if (edits.length) onSetCells(edits);
    // Selection grows to cover source + filled, same as every spreadsheet.
    setSel({
      r: Math.min(rect.top, t.top), c: Math.min(rect.left, t.left),
      r2: Math.max(rect.bottom, t.bottom), c2: Math.max(rect.right, t.right),
    });
  }, [canEdit, rect, columns, view, onSetCells]);

  const copySelection = useCallback(() => {
    const out: string[][] = [];
    for (let r = rect.top; r <= rect.bottom; r += 1) {
      const row = view[r]?.row;
      if (!row) continue;
      const line: string[] = [];
      for (let c = rect.left; c <= rect.right; c += 1) {
        const col = columns[c];
        line.push(col ? editValue(col.type, row.cells[col.id]) : "");
      }
      out.push(line);
    }
    return toTsv(out);
  }, [rect, view, columns]);

  /** Paste a TSV block starting at the selection's top-left. */
  const applyPaste = useCallback(async (text: string) => {
    if (!canEdit) return;
    const block = parseTsv(text);
    if (!block.length) return;

    const startR = rect.top;
    const startC = rect.left;
    // Grow the sheet downward if the block runs past the last row. Columns are NOT auto-created —
    // silently widening the schema from a paste is a footgun, so the block is clipped instead.
    // Growing the sheet while a filter hides rows would land the paste in unpredictable places, so
    // the paste is clipped to what's visible instead.
    const needed = filtering ? 0 : startR + block.length - view.length;
    let workingRows = view.map((v) => v.row);
    if (needed > 0) {
      const created = await onAddRows({ count: needed });
      workingRows = [...workingRows, ...created];
    }

    const edits: { rowId: string; values: Record<string, unknown> }[] = [];
    block.forEach((line, i) => {
      const row = workingRows[startR + i];
      if (!row) return;
      const values: Record<string, unknown> = {};
      line.forEach((cellText, j) => {
        const col = columns[startC + j];
        if (!col) return; // clipped
        values[col.id] = cellText === "" ? null : cellText;
      });
      if (Object.keys(values).length) edits.push({ rowId: row.id, values });
    });
    if (edits.length) onSetCells(edits);
    setSel({
      r: startR, c: startC,
      r2: Math.min(view.length + Math.max(0, needed) - 1, startR + block.length - 1),
      c2: Math.min(maxC, startC + Math.max(...block.map((l) => l.length)) - 1),
    });
  }, [canEdit, rect, view, columns, onAddRows, onSetCells, maxC, filtering]);

  /** Opens the comment thread for a cell by grid position, anchored under the cell itself. */
  const openCommentsAt = (r: number, c: number) => {
    const row = view[r]?.row;
    const col = columns[c];
    if (!row || !col) return;
    const el = gridRef.current?.querySelector(`[data-cell="${row.id}:${col.id}"]`);
    const box = el?.getBoundingClientRect();
    onOpenComments(row.id, col.id, box ? { left: box.left, top: box.bottom + 4 } : { left: 80, top: 160 });
  };

  // Tell the parent which cell is being typed in. A realtime patch must never overwrite it.
  useEffect(() => {
    onEditingChange(editing ? { rowId: editing.rowId, colId: editing.colId } : null);
  }, [editing, onEditingChange]);

  // Broadcast where this person is parked. The hook dedupes repeats, so holding an arrow key down
  // doesn't turn into one emit per repeat.
  useEffect(() => {
    onCursor(view[sel.r]?.row.id ?? null, columns[sel.c]?.id ?? null);
  }, [sel.r, sel.c, view, columns, onCursor]);


  /**
   * What the cell right-click menu offers.
   *
   * Deliberately a subset of Sheets: everything here maps onto something this grid already does
   * correctly. Cut is copy+clear, paste reuses the same TSV path as Ctrl+V, and the row/column
   * inserts go through the existing endpoints rather than new ones.
   */
  type MenuItem = { label: string; icon: typeof Copy; run: () => void; hint?: string; danger?: boolean };
  const menuItems: (MenuItem | "sep")[] = useMemo(() => {
    if (!cellMenu) return [];
    const row = view[cellMenu.r]?.row;
    const col = columns[cellMenu.c];
    if (!row || !col) return [];
    const rowsInBlock = rect.bottom - rect.top + 1;
    const colsInBlock = rect.right - rect.left + 1;
    const items: (MenuItem | "sep")[] = [];

    if (canEdit) {
      items.push({
        label: "Potong", icon: Scissors, hint: "⌘X",
        run: () => { void navigator.clipboard.writeText(copySelection()); clearSelection(); },
      });
    }
    items.push({
      label: "Salin", icon: Copy, hint: "⌘C",
      run: () => void navigator.clipboard.writeText(copySelection()),
    });
    if (canEdit) {
      items.push({
        label: "Tempel", icon: ClipboardPaste, hint: "⌘V",
        // Reading the clipboard needs the browser's permission prompt, which Ctrl+V never triggers.
        // If it's refused, say so instead of failing silently.
        run: () => {
          navigator.clipboard.readText()
            .then((text) => { if (text) void applyPaste(text); })
            .catch(() => alert("Browser-nya nggak ngasih akses clipboard. Pakai Ctrl+V / ⌘V aja."));
        },
      });
      items.push({
        label: rowsInBlock * colsInBlock > 1 ? "Kosongin isi seleksi" : "Kosongin isi sel",
        icon: Eraser, hint: "Del", run: clearSelection,
      });
      items.push("sep");
      items.push({
        label: "Sisipin baris di atas", icon: Plus,
        run: () => void onAddRows({ count: 1, beforeRowId: row.id }),
      });
      items.push({
        label: "Sisipin baris di bawah", icon: Plus,
        run: () => void onAddRows({ count: 1, afterRowId: row.id }),
      });
      items.push({
        label: "Sisipin kolom di kiri", icon: Plus,
        run: () => onInsertColumn(cellMenu.c),
      });
      items.push({
        label: "Sisipin kolom di kanan", icon: Plus,
        run: () => onInsertColumn(cellMenu.c + 1),
      });
      items.push("sep");
      items.push({
        label: rowsInBlock > 1 ? `Hapus ${rowsInBlock} baris` : "Hapus baris", icon: Trash2, danger: true,
        run: () => onDeleteRows(view.slice(rect.top, rect.bottom + 1).map((v) => v.row.id)),
      });
      if (canManage) {
        items.push({
          label: "Hapus kolom", icon: Trash2, danger: true,
          run: () => onDeleteColumn(col.id),
        });
      }
      items.push("sep");
    }
    if (canEdit && col.type === "link") {
      const cur = row.cells[col.id] as unknown;
      const current = isLinkCell(cur) ? cur.u : "";
      items.push({
        label: "Atur URL…", icon: LinkIcon,
        run: () => {
          const next = window.prompt("Alamat link buat sel ini:", current);
          if (next === null) return;
          const text = displayCell(col.type, row.cells[col.id], null);
          onSetCells([{ rowId: row.id, values: { [col.id]: next.trim() ? { t: text || next.trim(), u: next.trim() } : (text || null) } }]);
        },
      });
      items.push("sep");
    }
    items.push({
      label: "Komentar", icon: MessageSquare, hint: "⌘⌥M",
      run: () => openCommentsAt(cellMenu.r, cellMenu.c),
    });
    items.push({
      label: "Saring kolom ini", icon: Filter,
      run: () => setOpenFilterFor(col.id),
    });
    return items;
  }, [cellMenu, view, columns, rect, canEdit, canManage, copySelection, clearSelection, applyPaste,
      onAddRows, onInsertColumn, onDeleteRows, onDeleteColumn, openCommentsAt]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return; // the input owns the keyboard while editing
    const meta = e.metaKey || e.ctrlKey;
    // Ctrl/Cmd+Alt+M — same shortcut Sheets uses for "comment on this cell". Matched on e.code, not
    // e.key, because Option+M on macOS types "µ".
    if (meta && e.altKey && e.code === "KeyM") {
      e.preventDefault();
      openCommentsAt(sel.r, sel.c);
      return;
    }
    switch (e.key) {
      case "ArrowUp": e.preventDefault(); return move(-1, 0, e.shiftKey);
      case "ArrowDown": e.preventDefault(); return move(1, 0, e.shiftKey);
      case "ArrowLeft": e.preventDefault(); return move(0, -1, e.shiftKey);
      case "ArrowRight": e.preventDefault(); return move(0, 1, e.shiftKey);
      case "Tab": e.preventDefault(); return move(0, e.shiftKey ? -1 : 1, false);
      case "Enter":
      case "F2": {
        e.preventDefault();
        if (!canEdit) return;
        const row = view[sel.r]?.row; const col = columns[sel.c];
        if (row && col) setEditing({ rowId: row.id, colId: col.id });
        return;
      }
      case "Escape": return setSel((s) => ({ ...s, r2: s.r, c2: s.c }));
      case "Delete":
      case "Backspace": e.preventDefault(); return clearSelection();
      case "a": if (meta) { e.preventDefault(); setSel({ r: 0, c: 0, r2: maxR, c2: maxC }); } return;
      case "f": if (meta) { e.preventDefault(); setFindOpen(true); } return;
      default: break;
    }
    // Any printable character starts editing and replaces the cell — the spreadsheet reflex.
    if (!meta && !e.altKey && e.key.length === 1 && canEdit) {
      const row = view[sel.r]?.row; const col = columns[sel.c];
      if (row && col) { e.preventDefault(); setEditing({ rowId: row.id, colId: col.id, seed: e.key }); }
    }
  };

  useEffect(() => {
    const up = () => {
      if (filling.current && fillTo) applyFill(fillTo);
      filling.current = false;
      setFillTo(null);
      dragging.current = false;
      // Finishing a reference drag frees the span so the NEXT click starts a fresh reference
      // instead of overwriting the one just placed.
      refSpan.current = null;
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [applyFill, fillTo]);

  const activeRow = view[sel.r]?.row;
  const activeCol = columns[sel.c];
  const activeRaw = activeRow && activeCol ? activeRow.cells[activeCol.id] : undefined;

  /** Every visible cell whose text contains the query, in reading order. */
  const findHits = useMemo(() => {
    if (!find.q.trim()) return [] as { r: number; c: number }[];
    const needle = find.matchCase ? find.q : find.q.toLowerCase();
    const out: { r: number; c: number }[] = [];
    view.forEach(({ row }, r) => {
      columns.forEach((col, c) => {
        const raw = row.cells[col.id];
        const text = isFormula(raw)
          ? (raw as unknown as { f: string }).f
          : editValue(col.type, raw as NexusSheetCellValue | undefined);
        const hay = find.matchCase ? text : text.toLowerCase();
        if (text && hay.includes(needle)) out.push({ r, c });
      });
    });
    return out;
  }, [find, view, columns]);

  const replaceAll = useCallback(() => {
    if (!canEdit || !find.q.trim()) return;
    const edits: { rowId: string; values: Record<string, unknown> }[] = [];
    for (const hit of findHits) {
      const row = view[hit.r]?.row;
      const col = columns[hit.c];
      if (!row || !col) continue;
      const raw = row.cells[col.id];
      // Formula cells are skipped on purpose: replacing text inside a stored formula would rewrite
      // its id-space references and quietly break it.
      if (isFormula(raw)) continue;
      const text = editValue(col.type, raw as NexusSheetCellValue | undefined);
      const next = find.matchCase
        ? text.split(find.q).join(find.to)
        : text.replace(new RegExp(find.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), find.to);
      if (next === text) continue;
      const entry = edits.find((e) => e.rowId === row.id) ?? (() => {
        const fresh = { rowId: row.id, values: {} as Record<string, unknown> };
        edits.push(fresh);
        return fresh;
      })();
      entry.values[col.id] = next === "" ? null : next;
    }
    if (edits.length) onSetCells(edits);
    return edits.length;
  }, [canEdit, find, findHits, view, columns, onSetCells]);

  return (
    <>
    {findOpen && (
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-2 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          autoFocus value={find.q} onChange={(e) => setFind((f) => ({ ...f, q: e.target.value }))}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") setFindOpen(false);
            if (e.key === "Enter" && findHits.length) {
              // Enter walks the hits, wrapping — the plain "find next" everyone expects.
              const at = findHits.findIndex((h) => h.r === sel.r && h.c === sel.c);
              const next = findHits[(at + 1) % findHits.length];
              setSel({ r: next.r, c: next.c, r2: next.r, c2: next.c });
            }
          }}
          placeholder="Cari…" className="w-40 rounded border border-border bg-background px-2 py-0.5 text-xs outline-none focus:border-primary"
        />
        {canEdit && (
          <>
            <Replace className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              value={find.to} onChange={(e) => setFind((f) => ({ ...f, to: e.target.value }))}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Ganti jadi…" className="w-40 rounded border border-border bg-background px-2 py-0.5 text-xs outline-none focus:border-primary"
            />
            <button
              onClick={() => { const n = replaceAll(); if (typeof n === "number") alert(n ? `${n} baris keganti.` : "Nggak ada yang cocok."); }}
              className="rounded-lg bg-primary px-2 py-1 text-[11px] font-bold text-primary-foreground"
            >Ganti semua</button>
          </>
        )}
        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={find.matchCase} onChange={(e) => setFind((f) => ({ ...f, matchCase: e.target.checked }))} className="h-3 w-3 accent-primary" />
          Bedakan huruf besar/kecil
        </label>
        <span className="text-[11px] text-muted-foreground">{find.q.trim() ? `${findHits.length} ketemu` : ""}</span>
        <button onClick={() => setFindOpen(false)} className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
      </div>
    )}
    {/* Formula bar: a long formula is unreadable squeezed into its cell, and this is where people
        expect to see what a cell REALLY contains rather than its formatted result. */}
    <div className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-card px-2 py-1">
      <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-bold text-muted-foreground">
        {activeCol ? `${colLetter(sel.c)}${(view[sel.r]?.rawIndex ?? sel.r) + 1}` : "—"}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">fx</span>
      <input
        key={`${activeRow?.id}:${activeCol?.id}:${JSON.stringify(activeRaw ?? "")}`}
        defaultValue={
          isFormula(activeRaw)
            ? editFormula(activeRaw, data.shape) ?? ""
            : editValue(activeCol?.type ?? "text", activeRaw as NexusSheetCellValue | undefined)
        }
        readOnly={!canEdit}
        placeholder={canEdit ? "Ketik isi sel atau rumus…" : ""}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && activeRow && activeCol) {
            commit(activeRow.id, activeCol.id, (e.target as HTMLInputElement).value);
            gridRef.current?.focus();
          }
          if (e.key === "Escape") { (e.target as HTMLInputElement).blur(); gridRef.current?.focus(); }
        }}
        onBlur={(e) => { if (activeRow && activeCol) commit(activeRow.id, activeCol.id, e.target.value); }}
        className="min-w-0 flex-1 select-text bg-transparent font-mono text-xs outline-none"
      />
      {/* Right-click and Ctrl+Alt+M both open the thread, but neither is discoverable on its own —
          this button is how someone finds out the feature exists. */}
      <button
        onClick={() => openCommentsAt(sel.r, sel.c)}
        title="Komentar di sel ini (Ctrl+Alt+M, atau klik kanan selnya)"
        className="relative grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-primary"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        {activeRow && activeCol && (commentCounts[`${activeRow.id}:${activeCol.id}`] ?? 0) > 0 && (
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
        )}
      </button>
    </div>

    <div
      ref={gridRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onCopy={(e) => { if (!editing) { e.preventDefault(); e.clipboardData.setData("text/plain", copySelection()); } }}
      onPaste={(e) => {
        if (editing) return; // let the native input handle a single-cell paste
        const text = e.clipboardData.getData("text/plain");
        if (!text) return;
        e.preventDefault();
        void applyPaste(text);
      }}
      onScroll={onGridScroll}
      // select-none because dragging across cells is a RANGE selection, not a text selection — without
      // it the browser also highlights the words it drags over, so half the sheet ends up smeared blue.
      // Nothing here depends on native selection: Ctrl+C builds its TSV from state, not from the DOM.
      className="max-h-[calc(100vh-19rem)] select-none overflow-auto rounded-2xl border border-border bg-card outline-none focus:ring-2 focus:ring-primary/30"
    >
      <table className="w-max min-w-full border-collapse text-sm">
        <thead className="sticky top-0 z-20">
          <tr>
            <th className="sticky left-0 z-30 w-10 border-b border-r border-border bg-muted px-2 py-2 text-[10px] font-bold text-muted-foreground" />
            {columns.map((col, ci) => (
              <HeaderCell
                key={col.id}
                col={col}
                index={ci}
                active={ci >= rect.left && ci <= rect.right}
                canManage={canManage}
                canEdit={canEdit}
                onEditColumn={(patch) => onEditColumn(col.id, patch)}
                onResize={(width) => onEditColumn(col.id, { width })}
                sortDir={sort?.colId === col.id ? sort.dir : null}
                onSort={() => setSort((cur) =>
                  cur?.colId !== col.id ? { colId: col.id, dir: "asc" }
                    : cur.dir === "asc" ? { colId: col.id, dir: "desc" }
                    : null)}
                filterValue={filters[col.id] ?? ""}
                onFilter={(q) => setFilters((f) => ({ ...f, [col.id]: q }))}
                forceFilterOpen={openFilterFor === col.id}
                onFilterOpened={() => setOpenFilterFor(null)}
                onDelete={() => onDeleteColumn(col.id)}
              />
            ))}
            <th className="border-b border-border bg-muted px-1">
              {canEdit && (
                <button onClick={onAddColumn} title="Tambah kolom"
                  className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition hover:bg-primary/10 hover:text-primary">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {/* Spacer holding open the rows scrolled off the top. colSpan covers gutter + columns +
              the trailing filler cell, so the table's column widths stay put. */}
          {winFirst > 0 && (
            <tr style={{ height: offsets[winFirst] }} aria-hidden>
              <td colSpan={columns.length + 2} className="p-0" />
            </tr>
          )}
          {view.slice(winFirst, winLast).map(({ row, rawIndex }, k) => {
            const ri = winFirst + k;
            return (
            <Row
              key={row.id}
              row={row}
              rowIndex={ri}
              gutterNumber={rawIndex + 1}
              columns={columns}
              selected={ri >= rect.top && ri <= rect.bottom}
              rect={rect}
              editing={editing}
              canEdit={canEdit}
              data={data}
              refMode={refMode}
              refRects={refRects}
              onPickRef={(c) => {
                // Clicking a cell mid-formula inserts its address instead of moving the cursor.
                // Addresses always speak the UNDERLYING row, so a reference picked while the view is
                // sorted still points at the row that was clicked.
                putRef(a1(rawIndex, c), { r: rawIndex, c });
                dragging.current = true;
              }}
              onExtendRef={(c) => {
                const anchor = refSpan.current?.anchor;
                if (!dragging.current || !anchor) return;
                const from = a1(Math.min(anchor.r, rawIndex), Math.min(anchor.c, c));
                const to = a1(Math.max(anchor.r, rawIndex), Math.max(anchor.c, c));
                putRef(from === to ? from : `${from}:${to}`, anchor);
              }}
              onDraftChange={setDraft}
              registerEditor={(el) => { editorEl.current = el; }}
              findHits={findHits}
              tasks={tasks}
              onOpenTask={onOpenTask}
              commentCounts={commentCounts}
              onOpenComments={onOpenComments}
              peerCursors={peerCursors}
              onResizeRow={(height) => onResizeRow(row.id, height)}
              showFillHandle={canEdit && ri === rect.bottom}
              fillRect={fillPreviewRect}
              onFillStart={() => { filling.current = true; setFillTo({ r: ri, c: rect.right }); }}
              onFillOver={(ci) => { if (filling.current) setFillTo({ r: ri, c: ci }); }}
              onSelect={(c, extend) => setSel((s) => (extend ? { ...s, r2: ri, c2: c } : { r: ri, c, r2: ri, c2: c }))}
              onDragOver={(c) => { if (dragging.current) setSel((s) => ({ ...s, r2: ri, c2: c })); }}
              onStartDrag={(c) => { dragging.current = true; setSel({ r: ri, c, r2: ri, c2: c }); }}
              onEdit={(colId) => setEditing({ rowId: row.id, colId })}
              onCommit={(colId, raw, next) => {
                commit(row.id, colId, raw);
                setEditing(null);
                gridRef.current?.focus();
                if (next === "down") move(1, 0, false);
                if (next === "right") move(0, 1, false);
              }}
              onCancel={() => { setEditing(null); gridRef.current?.focus(); }}
              onRowMenu={(at) => setRowMenu({ rowId: row.id, number: rawIndex + 1, height: row.height, ...at })}
              onCellMenu={(ci, at) => setCellMenu({ r: ri, c: ci, ...at })}
              dragging={dragRow === row.id}
              dropTarget={dropRow === row.id}
              onDragStart={() => setDragRow(row.id)}
              onDragOverRow={() => { if (dragRow && dragRow !== row.id) setDropRow(row.id); }}
              onDrop={() => {
                if (dragRow && dragRow !== row.id) {
                  // Dropping ON a row means "land right after it", except at the very top where the
                  // only sensible reading is "before everything".
                  const targetIndex = rows.findIndex((r) => r.id === row.id);
                  const sourceIndex = rows.findIndex((r) => r.id === dragRow);
                  const after = targetIndex === 0 && sourceIndex > 0 ? null : row.id;
                  onReorderRow(dragRow, after);
                }
                setDragRow(null); setDropRow(null);
              }}
              onDragEnd={() => { setDragRow(null); setDropRow(null); }}
            />
            );
          })}
          {winLast < view.length && (
            <tr style={{ height: totalHeight - offsets[winLast] }} aria-hidden>
              <td colSpan={columns.length + 2} className="p-0" />
            </tr>
          )}
        </tbody>
        <tfoot className="sticky bottom-0 z-20">
          <tr>
            <td className="sticky left-0 z-30 border-t border-r border-border bg-muted" />
            {columns.map((col) => {
              const a = aggregate(viewRows, col, data);
              const numeric = col.type === "number" || col.type === "currency";
              return (
                <td key={col.id} className="border-t border-border bg-muted px-2 py-1.5 text-right text-[11px] font-bold tabular-nums text-muted-foreground">
                  {numeric
                    ? formatCell(col.type, a.sum)
                    : a.filled > 0 ? `${a.filled} terisi` : ""}
                </td>
              );
            })}
            <td className="border-t border-border bg-muted" />
          </tr>
        </tfoot>
      </table>

      {canEdit && (
        <div className="sticky left-0 flex gap-2 p-2">
          <button onClick={() => void onAddRows({ count: 1 })}
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition hover:border-primary/50 hover:text-primary">
            <Plus className="h-3.5 w-3.5" /> Baris
          </button>
          <button onClick={() => void onAddRows({ count: 20 })}
            className="rounded-lg border border-dashed border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition hover:border-primary/50 hover:text-primary">
            +20
          </button>
        </div>
      )}
    </div>


    {/* Right-click menu for a cell. Only the entries this grid can actually honour — no Sheets item
        is listed here as a stub, because a menu that says "Tempel khusus" and does nothing is worse
        than one that never offered it. */}
    {cellMenu && createPortal(
      <>
        <div className="fixed inset-0 z-[60]" onClick={() => setCellMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCellMenu(null); }} />
        <div
          style={{ left: Math.min(cellMenu.left, window.innerWidth - 240), top: Math.min(cellMenu.top, window.innerHeight - 400) }}
          className="fixed z-[61] max-h-[80vh] w-56 overflow-y-auto rounded-xl border border-border bg-card py-1 shadow-pop"
        >
          {menuItems.map((item, i) =>
            item === "sep" ? (
              <div key={`sep${i}`} className="my-1 border-t border-border" />
            ) : (
              <button
                key={item.label}
                onClick={() => { setCellMenu(null); item.run(); }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold transition",
                  item.danger ? "text-rose-600 hover:bg-rose-50" : "hover:bg-muted",
                )}
              >
                <item.icon className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                {item.hint && <span className="shrink-0 text-[10px] font-normal text-muted-foreground">{item.hint}</span>}
              </button>
            ),
          )}
        </div>
      </>,
      document.body,
    )}

    {/* Right-click menu for a row. Portaled + fixed for the same reason as every other popover here:
        the grid scroll container is overflow:auto and would clip it. */}
    {rowMenu && createPortal(
      <>
        <div className="fixed inset-0 z-[60]" onClick={() => setRowMenu(null)} onContextMenu={(e) => { e.preventDefault(); setRowMenu(null); }} />
        <div
          style={{ left: Math.min(rowMenu.left, window.innerWidth - 200), top: Math.min(rowMenu.top, window.innerHeight - 130) }}
          className="fixed z-[61] w-48 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-pop"
        >
          <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Baris {rowMenu.number}</p>
          <button
            onClick={() => { void onAddRows({ count: 1, afterRowId: rowMenu.rowId }); setRowMenu(null); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold transition hover:bg-muted"
          ><Plus className="h-3.5 w-3.5" /> Sisipin baris di bawah</button>
          {rowMenu.height != null && (
            <button
              onClick={() => { onResizeRow(rowMenu.rowId, null); setRowMenu(null); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold transition hover:bg-muted"
            ><RotateCcw className="h-3.5 w-3.5" /> Balikin tinggi default</button>
          )}
          <button
            onClick={() => { onDeleteRows([rowMenu.rowId]); setRowMenu(null); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
          ><Trash2 className="h-3.5 w-3.5" /> Hapus baris</button>
        </div>
      </>,
      document.body,
    )}
    </>
  );
}

function HeaderCell({ col, index, active, canManage, canEdit, onEditColumn, onResize, onDelete, sortDir, onSort, filterValue, onFilter, forceFilterOpen, onFilterOpened }: {
  col: NexusSheetColumn; index: number; active: boolean; canManage: boolean; canEdit: boolean;
  onEditColumn: (patch: { name?: string; type?: NexusSheetColumnType; rules?: NexusSheetRule[] }) => void;
  onResize: (width: number) => void;
  onDelete: () => void;
  sortDir: "asc" | "desc" | null;
  onSort: () => void;
  filterValue: string;
  onFilter: (q: string) => void;
  /** Set when the cell right-click menu asked for this column's filter box. */
  forceFilterOpen: boolean;
  onFilterOpened: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const thRef = useRef<HTMLTableCellElement>(null);

  /**
   * Drag the right edge to resize. The width is applied live to the DOM node and only SAVED on
   * mouseup — one PATCH per resize instead of one per pixel, and one undo entry instead of hundreds.
   */
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!forceFilterOpen) return;
    setFilterOpen(true);
    onFilterOpened();
  }, [forceFilterOpen, onFilterOpened]);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = thRef.current?.offsetWidth ?? col.width ?? 140;
    let latest = startW;
    const move = (ev: MouseEvent) => {
      latest = Math.max(60, Math.min(600, startW + (ev.clientX - startX)));
      if (thRef.current) thRef.current.style.minWidth = `${latest}px`;
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (Math.round(latest) !== Math.round(startW)) onResize(Math.round(latest));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return (
    <th
      ref={thRef}
      style={col.width ? { minWidth: col.width } : undefined}
      className={cn("group relative border-b border-r border-border px-2 py-1.5 text-left text-xs font-bold",
        // The active-column highlight still wins: knowing where the cursor is beats the decoration.
        active ? "bg-primary/10 text-primary" : col.color ? COLUMN_COLOR_CLASS[col.color] : "bg-muted text-foreground")}
      onContextMenu={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setMenu({ left: e.clientX, top: e.clientY });
      }}
    >
      <div className="flex items-center gap-1">
        {/* The letter is the label until someone names the column, exactly like a blank Sheets file. */}
        <span className="text-[10px] font-black text-muted-foreground">{colLetter(index)}</span>
        <button
          onDoubleClick={() => canEdit && setOpen(true)}
          className={cn("min-w-0 flex-1 truncate text-left", !col.name && "font-normal text-muted-foreground/50")}
          title={col.name
            ? `${col.name} — klik 2x buat atur kolom, klik kanan buat menu`
            : "Klik 2x buat kasih nama & tipe kolom · klik kanan buat menu"}
        >
          {col.name || "—"}
        </button>
        {/* Passive state only. These used to be BUTTONS that appeared on hover, stacked right up
            against the resize grip on the same edge — so aiming for the grip kept hitting sort,
            filter, or (worst) delete. Every action moved to the right-click menu; what's left just
            reports that the column IS sorted or filtered. */}
        {sortDir && (
          <span className="shrink-0 text-primary" title={sortDir === "asc" ? "Diurut A→Z" : "Diurut Z→A"}>
            {sortDir === "desc" ? <ArrowUpAZ className="h-3 w-3" /> : <ArrowDownAZ className="h-3 w-3" />}
          </span>
        )}
        {filterValue && (
          <span className="shrink-0 text-primary" title="Kolom ini lagi disaring"><Filter className="h-3 w-3" /></span>
        )}
      </div>

      {(filterOpen || filterValue) && (
        <input
          value={filterValue}
          onChange={(e) => onFilter(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { onFilter(""); setFilterOpen(false); } }}
          placeholder="saring…"
          className="mt-1 w-full rounded border border-border bg-background px-1 py-0.5 text-[11px] font-normal outline-none focus:border-primary"
        />
      )}

      {canEdit && (
        <span
          onMouseDown={startResize}
          title="Tarik buat atur lebar kolom"
          className="absolute -right-[3px] top-0 z-20 h-full w-2 cursor-col-resize hover:bg-primary/40"
        />
      )}

      {menu && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div
            style={{ left: Math.min(menu.left, window.innerWidth - 220), top: Math.min(menu.top, window.innerHeight - 190) }}
            className="fixed z-[61] w-52 overflow-hidden rounded-xl border border-border bg-card py-1 font-normal shadow-pop"
          >
            <p className="truncate px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Kolom {colLetter(index)}{col.name ? ` · ${col.name}` : ""}
            </p>
            <button onClick={() => { setOpen(true); setMenu(null); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold transition hover:bg-muted"
            ><Pencil className="h-3.5 w-3.5" /> Nama &amp; tipe kolom…</button>
            <button onClick={() => { onSort(); setMenu(null); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold transition hover:bg-muted"
            >
              {sortDir === "desc" ? <ArrowUpAZ className="h-3.5 w-3.5" /> : <ArrowDownAZ className="h-3.5 w-3.5" />}
              {sortDir === "asc" ? "Urut Z→A" : sortDir === "desc" ? "Balikin urutan asli" : "Urut A→Z"}
            </button>
            <button onClick={() => { setFilterOpen(true); setMenu(null); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold transition hover:bg-muted"
            ><Filter className="h-3.5 w-3.5" /> Saring kolom ini</button>
            {filterValue && (
              <button onClick={() => { onFilter(""); setFilterOpen(false); setMenu(null); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold transition hover:bg-muted"
              ><X className="h-3.5 w-3.5" /> Hapus saringan</button>
            )}
            {canManage && (
              <button onClick={() => { onDelete(); setMenu(null); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
              ><Trash2 className="h-3.5 w-3.5" /> Hapus kolom</button>
            )}
          </div>
        </>,
        document.body,
      )}

      {open && (
        <ColumnPopover
          col={col}
          anchor={thRef.current?.getBoundingClientRect() ?? null}
          onClose={() => setOpen(false)}
          onSave={(patch) => { onEditColumn(patch); setOpen(false); }}
        />
      )}
    </th>
  );
}

/** Name + type in one place, so a blank column becomes a Rupiah/date column without leaving the grid. */

/**
 * The picker for a multi-select cell.
 *
 * A tick list rather than a native `<select multiple>`: the native one needs Ctrl-click to add a
 * second value, which nobody discovers, and it can't be made to fit a 29px row. Portaled + fixed like
 * every other popover here, because the grid's overflow:auto would clip it.
 *
 * Commits on close, not on every tick — one undo entry per visit instead of one per checkbox.
 */
function ChoiceEditor({ col, multi, initial, onCommit, onCancel }: {
  col: NexusSheetColumn;
  /** false = pick one and close, true = tick several then close. */
  multi: boolean;
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(() => (multi ? readMulti(initial) : initial ? [initial] : []));
  const boxRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const cell = boxRef.current?.closest("td");
    const r = cell?.getBoundingClientRect();
    if (r) setAnchor({ left: Math.min(r.left, window.innerWidth - 232), top: Math.min(r.bottom + 2, window.innerHeight - 260) });
  }, []);

  const toggle = (v: string) => {
    // Single choice closes on the click — an extra "Selesai" step for one value is friction nobody
    // asked for. Multi keeps the list open so several ticks are one visit.
    if (!multi) { onCommit(picked[0] === v ? "" : v); return; }
    setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  };

  const options = col.options ?? [];
  // Values already in the cell that are no longer offered still show, ticked — hiding them would
  // silently drop data the moment someone opened the picker.
  const extras = picked.filter((v) => !options.includes(v));

  return (
    <>
      <span ref={boxRef} className="block truncate text-xs text-muted-foreground">
        {picked.length ? picked.join(", ") : "—"}
      </span>
      {anchor && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => onCommit(multi ? picked.join(", ") : (picked[0] ?? ""))} />
          <div
            style={{ left: anchor.left, top: anchor.top }}
            className="fixed z-[61] max-h-60 w-56 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-pop"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") onCancel();
              if (e.key === "Enter") onCommit(multi ? picked.join(", ") : (picked[0] ?? ""));
            }}
          >
            {options.length === 0 && extras.length === 0 && (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                Kolom ini belum punya pilihan. Klik 2x judul kolomnya buat ngisi.
              </p>
            )}
            {[...options, ...extras].map((o) => (
              <button
                key={o}
                onClick={() => toggle(o)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs font-semibold transition hover:bg-muted"
              >
                <span className={cn("grid h-3.5 w-3.5 shrink-0 place-items-center rounded border",
                  picked.includes(o) ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                  {picked.includes(o) && <Check className="h-2.5 w-2.5" />}
                </span>
                <span className={cn("min-w-0 max-w-full truncate rounded-full px-2 leading-5", optionColor(col, o))}>{o}</span>
                {!options.includes(o) && <span className="shrink-0 text-[9px] text-muted-foreground">di luar daftar</span>}
              </button>
            ))}
            {multi ? (
              <button
                onClick={() => onCommit(picked.join(", "))}
                className="mt-1 w-full rounded-lg bg-primary px-2 py-1 text-[11px] font-bold text-primary-foreground"
              >Selesai</button>
            ) : (
              <button
                onClick={() => onCommit("")}
                className="mt-1 w-full rounded-lg border border-dashed border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:border-rose-300 hover:text-rose-600"
              >Kosongin</button>
            )}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

function ColumnPopover({ col, anchor, onClose, onSave }: {
  col: NexusSheetColumn;
  /** Screen rect of the header cell. */
  anchor: DOMRect | null;
  onClose: () => void;
  onSave: (patch: { name: string; type: NexusSheetColumnType; options?: string[]; optionColors?: Record<string, NexusSheetColumnColor>; color?: NexusSheetColumnColor; rules?: NexusSheetRule[] }) => void;
}) {
  const [name, setName] = useState(col.name);
  const [type, setType] = useState<NexusSheetColumnType>(col.type);
  const [options, setOptions] = useState<string[]>(col.options ?? []);
  const [optionColors, setOptionColors] = useState<Record<string, NexusSheetColumnColor>>(col.optionColors ?? {});
  /** Which choice has its palette open, if any. */
  const [palette, setPalette] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState<NexusSheetColumnColor | undefined>(col.color);
  const [rules, setRules] = useState<NexusSheetRule[]>(col.rules ?? []);
  const addOption = () => {
    const v = draft.trim();
    // Silently ignoring a duplicate beats an error toast: the choice the user wanted is already there.
    if (!v || options.includes(v)) { setDraft(""); return; }
    setOptions((o) => [...o, v.slice(0, 80)]);
    setDraft("");
  };
  const save = () => onSave({
    name: name.trim(),
    type,
    // Choices only mean anything on a select column; carrying them on a text column would resurrect
    // a stale list the moment someone switched the type back.
    options: type === "select" || type === "multiselect" ? options : [],
    // Colours for choices that no longer exist are dropped, so a deleted-then-retyped choice starts
    // from the automatic colour instead of resurrecting an old one.
    optionColors: Object.fromEntries(Object.entries(optionColors).filter(([k]) => options.includes(k))),
    color,
    rules: rules.length ? rules : undefined,
  });
  // Portaled and fixed, for the same reason as the autocomplete and the comment thread: anchored
  // inside the <th> it was clipped by the grid's overflow:auto, which hid the colour picker and the
  // rules editor below the fold entirely.
  const left = Math.min(anchor?.left ?? 80, window.innerWidth - 248);
  // Height is bound to the space actually left below the header, not to a guessed constant: the
  // popover grows with the number of choices and rules, so any fixed number is wrong eventually —
  // and being 27px too tall is enough to put the save button off-screen.
  const top = Math.min((anchor?.bottom ?? 120) + 4, Math.max(8, window.innerHeight - 240));
  const maxHeight = Math.max(200, window.innerHeight - top - 12);
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div
        style={{ left, top, maxHeight }}
        className="fixed z-[61] w-56 space-y-2 overflow-y-auto rounded-xl border border-border bg-card p-3 font-normal shadow-pop"
      >
        <input
          autoFocus value={name} maxLength={80} placeholder="Nama kolom (boleh kosong)"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") save();
            if (e.key === "Escape") onClose();
          }}
          className="w-full rounded-lg border border-border bg-background px-2 py-1 text-xs font-normal outline-none focus:border-primary"
        />
        <div className="flex flex-wrap gap-1">
          {(Object.keys(COLUMN_TYPE_LABEL) as NexusSheetColumnType[]).map((t) => (
            <button key={t} onClick={() => setType(t)}
              className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold transition",
                type === t ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent")}>
              {COLUMN_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        {/* The choices themselves. Without this a "Pilihan" column rendered an empty dropdown and
            there was nowhere in the app to fill it. */}
        {(type === "select" || type === "multiselect") && (
          <div className="space-y-1 border-t border-border pt-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Isi dropdown</div>
            {options.length > 0 && (
              <div className="space-y-0.5">
                {options.map((o, i) => (
                  <div key={o}>
                    <div className="flex items-center gap-1">
                      {/* The swatch opens this choice's palette. Colours default to cycling the
                          palette by position, so the list is legible before anyone touches it. */}
                      <button
                        onClick={() => setPalette((c) => (c === o ? null : o))}
                        title="Warna pilihan ini"
                        className={cn("h-4 w-4 shrink-0 rounded-full border border-border",
                          (optionColors[o] ? CHIP_COLOR_CLASS[optionColors[o]] : CHIP_COLOR_CLASS[CHIP_COLORS[i % CHIP_COLORS.length]]).split(" ")[0])}
                      />
                      <span className={cn("min-w-0 flex-1 truncate rounded-full px-2 text-[11px] font-semibold leading-5",
                        optionColors[o] ? CHIP_COLOR_CLASS[optionColors[o]] : CHIP_COLOR_CLASS[CHIP_COLORS[i % CHIP_COLORS.length]])}>{o}</span>
                      <button onClick={() => {
                        setOptions((xs) => xs.filter((_, j) => j !== i));
                        setOptionColors((c) => { const n = { ...c }; delete n[o]; return n; });
                      }} className="shrink-0 text-muted-foreground hover:text-rose-600"><X className="h-2.5 w-2.5" /></button>
                    </div>
                    {palette === o && (
                      <div className="flex flex-wrap gap-1 py-1 pl-5">
                        {CHIP_COLORS.map((c) => (
                          <button key={c} title={COLUMN_COLOR_LABEL[c]}
                            onClick={() => { setOptionColors((prev) => ({ ...prev, [o]: c })); setPalette(null); }}
                            className={cn("h-4 w-4 rounded-full border border-border", CHIP_COLOR_CLASS[c].split(" ")[0])} />
                        ))}
                        <button title="Balik ke otomatis"
                          onClick={() => { setOptionColors((prev) => { const n = { ...prev }; delete n[o]; return n; }); setPalette(null); }}
                          className="rounded-full border border-dashed border-border px-1.5 text-[9px] font-bold text-muted-foreground">auto</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-1">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") { e.preventDefault(); addOption(); }
                  if (e.key === "Escape") onClose();
                }}
                placeholder="Tulis pilihan, Enter"
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1 text-xs font-normal outline-none focus:border-primary"
              />
              <button onClick={addOption} disabled={!draft.trim()}
                className="shrink-0 rounded-lg border border-border px-2 text-xs font-bold text-muted-foreground transition hover:border-primary/50 hover:text-primary disabled:opacity-40">+</button>
            </div>
          </div>
        )}

        {/* Header tint. */}
        <div className="space-y-1 border-t border-border pt-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Warna judul</div>
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setColor(undefined)}
              title="Tanpa warna"
              className={cn("h-5 w-5 rounded-full border bg-muted", !color ? "border-primary ring-2 ring-primary/30" : "border-border")}
            />
            {(Object.keys(COLUMN_COLOR_CLASS) as NexusSheetColumnColor[]).map((c) => (
              <button key={c} onClick={() => setColor(c)} title={COLUMN_COLOR_LABEL[c]}
                className={cn("h-5 w-5 rounded-full border", COLUMN_COLOR_CLASS[c].split(" ")[0],
                  color === c ? "border-primary ring-2 ring-primary/30" : "border-border")} />
            ))}
          </div>
        </div>

        {/* Conditional formatting — the first matching rule wins, so order is meaningful. */}
        <div className="space-y-1 border-t border-border pt-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Warnain otomatis</div>
          {rules.map((r, i) => (
            <div key={i} className="flex items-center gap-1">
              <select
                value={r.op}
                onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, op: e.target.value as NexusSheetRule["op"] } : x)))}
                onKeyDown={(e) => e.stopPropagation()}
                className="min-w-0 flex-1 rounded border border-border bg-background px-1 py-0.5 text-[11px] font-normal outline-none"
              >
                {(Object.keys(RULE_OP_LABEL) as NexusSheetRule["op"][]).map((o) => (
                  <option key={o} value={o}>{RULE_OP_LABEL[o]}</option>
                ))}
              </select>
              {r.op !== "empty" && r.op !== "notEmpty" && (
                <input
                  value={r.value ?? ""}
                  onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder="nilai"
                  className="w-16 rounded border border-border bg-background px-1 py-0.5 text-[11px] font-normal outline-none"
                />
              )}
              <select
                value={r.style}
                onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, style: e.target.value as NexusSheetRule["style"] } : x)))}
                onKeyDown={(e) => e.stopPropagation()}
                className={cn("rounded border border-border px-1 py-0.5 text-[11px] font-normal outline-none", RULE_STYLE_CLASS[r.style])}
              >
                <option value="red">merah</option>
                <option value="amber">kuning</option>
                <option value="green">hijau</option>
                <option value="blue">biru</option>
                <option value="grey">abu</option>
                <option value="bold">tebal</option>
              </select>
              <button onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}
                className="shrink-0 text-muted-foreground hover:text-rose-600"><X className="h-3 w-3" /></button>
            </div>
          ))}
          {rules.length < 8 && (
            <button
              onClick={() => setRules((rs) => [...rs, { op: "lt", value: "0", style: "red" }])}
              className="w-full rounded-lg border border-dashed border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition hover:border-primary/50 hover:text-primary"
            >+ Aturan</button>
          )}
        </div>

        <button onClick={save}
          className="w-full rounded-lg bg-primary px-2 py-1.5 text-xs font-bold text-primary-foreground">Simpan</button>
      </div>
    </>,
    document.body,
  );
}

/**
 * A cell pointing at a real NEXUS task — the thing a plain spreadsheet can't do.
 *
 * The cell stores only the task id; the title and status are read live, so a task renamed or moved to
 * Done updates here without anyone touching the sheet.
 */
function TaskCell({ taskId, tasks, canEdit, onOpen, onPick }: {
  taskId: string;
  tasks: { id: string; title: string; status?: string | null }[];
  canEdit: boolean;
  onOpen?: (taskId: string) => void;
  onPick: (taskId: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const task = tasks.find((t) => t.id === taskId);

  if (picking) {
    const matches = tasks.filter((t) => t.title.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8);
    return (
      <div className="relative">
        <input
          autoFocus value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") setPicking(false); }}
          onBlur={() => setTimeout(() => setPicking(false), 120)}
          placeholder="Cari task…"
          className="w-full select-text rounded border border-primary bg-background px-1 py-0.5 text-sm outline-none"
        />
        <div className="absolute left-0 top-full z-40 mt-1 max-h-56 w-64 overflow-y-auto rounded-xl border border-border bg-card shadow-pop">
          {taskId && (
            <button onMouseDown={(e) => { e.preventDefault(); onPick(""); setPicking(false); }}
              className="block w-full px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent">Kosongin</button>
          )}
          {matches.map((t) => (
            <button key={t.id} onMouseDown={(e) => { e.preventDefault(); onPick(t.id); setPicking(false); }}
              className="block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-accent">{t.title}</button>
          ))}
          {!matches.length && <div className="px-3 py-2 text-xs text-muted-foreground">Nggak ketemu.</div>}
        </div>
      </div>
    );
  }

  if (!task) {
    return canEdit ? (
      <button onClick={() => setPicking(true)} className="text-xs text-muted-foreground/60 hover:text-primary">
        {taskId ? "task nggak ketemu" : "+ task"}
      </button>
    ) : <span />;
  }
  const done = (task.status ?? "").toUpperCase() === "DONE";
  return (
    <span className="flex items-center gap-1">
      <button
        onClick={() => onOpen?.(task.id)}
        title="Buka task"
        className={cn("min-w-0 truncate text-left text-xs font-semibold text-primary hover:underline", done && "line-through opacity-60")}
      >{task.title}</button>
      {canEdit && (
        <button onClick={() => setPicking(true)} title="Ganti task"
          className="shrink-0 text-[10px] text-muted-foreground hover:text-primary">✎</button>
      )}
    </span>
  );
}

/** A1-style letters are a DISPLAY layer over the column's position — the stored key is its id. */
export function colLetter(i: number): string {
  let n = i;
  let out = "";
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return out;
}

type RowProps = {
  row: NexusSheetRow; rowIndex: number; gutterNumber: number; columns: NexusSheetColumn[];
  selected: boolean; rect: ReturnType<typeof rectOf>; editing: Editing; canEdit: boolean;
  data: ReturnType<typeof buildSheetData>;
  refMode: boolean;
  refRects: { top: number; left: number; bottom: number; right: number; color: number }[];
  onPickRef: (c: number) => void;
  onExtendRef: (c: number) => void;
  onDraftChange: (text: string) => void;
  registerEditor: (el: HTMLInputElement | null) => void;
  findHits: { r: number; c: number }[];
  tasks: { id: string; title: string; status?: string | null }[];
  onOpenTask?: (taskId: string) => void;
  commentCounts: Record<string, number>;
  onOpenComments: (rowId: string, columnId: string, at: { left: number; top: number }) => void;
  showFillHandle: boolean;
  /** The block a fill drag is about to write, or null. Cells test their own membership. */
  fillRect: FillRect | null;
  onFillStart: () => void;
  onFillOver: (colIndex: number) => void;
  onSelect: (c: number, extend: boolean) => void;
  onDragOver: (c: number) => void;
  onStartDrag: (c: number) => void;
  onEdit: (colId: string) => void;
  onCommit: (colId: string, raw: string, next: "down" | "right" | null) => void;
  onCancel: () => void;
  onRowMenu: (at: { left: number; top: number }) => void;
  dragging: boolean;
  dropTarget: boolean;
  onDragStart: () => void;
  onDragOverRow: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  peerCursors: Record<string, { name: string; color: string }>;
  onCellMenu: (colIndex: number, at: { left: number; top: number }) => void;
  /** null resets to the default height. */
  onResizeRow: (height: number | null) => void;
};

/**
 * memo'd so arrow-key navigation re-renders 2 rows instead of the whole sheet. Without this, moving
 * the cursor on a 2,000-row sheet re-renders 2,000 rows per keypress and the grid feels broken.
 */
const Row = memo(function Row(p: RowProps) {
  const editingHere = p.editing && p.editing.rowId === p.row.id;
  const trRef = useRef<HTMLTableRowElement>(null);

  /**
   * Drag the bottom edge of the row number to change its height.
   *
   * Same shape as the column resize on the header edge: the height is applied live to the DOM node
   * and only SAVED on mouseup — one PATCH per resize instead of one per pixel, and one undo entry
   * instead of hundreds. Double-click clears it back to the default.
   */
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = trRef.current?.offsetHeight ?? p.row.height ?? 0;
    let latest = startH;
    const move = (ev: MouseEvent) => {
      latest = Math.max(ROW_H_MIN, Math.min(ROW_H_MAX, startH + (ev.clientY - startY)));
      if (trRef.current) trRef.current.style.height = `${latest}px`;
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (Math.round(latest) !== Math.round(startH)) p.onResizeRow(Math.round(latest));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <tr
      ref={trRef}
      // ALWAYS explicit, never left to the content: the window's offsets are computed from these
      // numbers, so a row that paints even a pixel taller would drift the spacers out of sync.
      style={{ height: p.row.height ?? ROW_H_DEFAULT }}
      className={cn("group/row", p.dragging && "opacity-40", p.dropTarget && "border-t-2 border-primary")}

    >
      <td
        draggable={p.canEdit}
        onDragStart={p.onDragStart}
        onDragOver={(e) => { e.preventDefault(); p.onDragOverRow(); }}
        onDrop={(e) => { e.preventDefault(); p.onDrop(); }}
        onDragEnd={p.onDragEnd}
        title={p.canEdit ? "Tarik buat pindahin baris · klik kanan buat menu" : undefined}
        onContextMenu={(e) => {
          if (!p.canEdit) return;
          e.preventDefault();
          p.onRowMenu({ left: e.clientX, top: e.clientY });
        }}
        className={cn("sticky left-0 z-10 w-10 border-b border-r border-border bg-muted/60 px-1 text-center text-[10px] tabular-nums text-muted-foreground",
          "relative",
          p.canEdit && "cursor-grab active:cursor-grabbing")}
      >
        {/* The number stays put. It used to be swapped for a delete icon on hover, which hid the one
            thing the gutter exists to show — and put a destructive button under an accidental
            mouse-over. Delete lives in the right-click menu now. */}
        <span>{p.gutterNumber}</span>
        {p.canEdit && (
          // Sits ON the bottom border, half above and half below, so the grab zone covers the line
          // people actually aim at rather than only the pixels inside this row.
          <span
            onMouseDown={startResize}
            onDoubleClick={(e) => { e.stopPropagation(); p.onResizeRow(null); }}
            title="Tarik buat atur tinggi baris · klik 2x buat balik ke default"
            className="absolute -bottom-[3px] left-0 z-20 h-1.5 w-full cursor-row-resize hover:bg-primary/40"
          />
        )}
      </td>
      {p.columns.map((col, ci) => {
        const inRect = p.selected && ci >= p.rect.left && ci <= p.rect.right;
        const refHit = p.refRects.find(
          (x) => p.gutterNumber - 1 >= x.top && p.gutterNumber - 1 <= x.bottom && ci >= x.left && ci <= x.right,
        );
        const isEditing = Boolean(editingHere && p.editing!.colId === col.id);
        const value = p.row.cells[col.id];
        const ruleHit = matchRule(col.rules, isFormula(value) ? undefined : (value as NexusSheetCellValue | undefined));
        const peerHere = p.peerCursors[`${p.row.id}:${col.id}`];
        return (
          <td
            key={col.id}
            data-cell={`${p.row.id}:${col.id}`}
            onMouseDown={(e) => {
              if (p.refMode) {
                // preventDefault keeps focus in the formula input — a blur here would commit the
                // half-written formula before the reference lands.
                e.preventDefault();
                p.onPickRef(ci);
                return;
              }
              if (e.shiftKey) p.onSelect(ci, true); else p.onStartDrag(ci);
            }}
            onMouseEnter={() => {
              // Fill tracking lives on the CELL, not the row: a horizontal drag needs the column
              // under the pointer, which a <tr> handler can't know.
              p.onFillOver(ci);
              if (p.refMode) p.onExtendRef(ci); else p.onDragOver(ci);
            }}
            onDoubleClick={() => p.canEdit && p.onEdit(col.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              // Right-clicking OUTSIDE the current selection moves to that cell first — otherwise
              // "Hapus baris" would act on a row the user isn't looking at. Right-clicking INSIDE
              // it keeps the block, so a multi-row delete still works.
              if (!inRect) p.onSelect(ci, false);
              p.onCellMenu(ci, { left: e.clientX, top: e.clientY });
            }}
            className={cn(
              "border-b border-r border-border px-2 py-1 align-middle",
              col.type === "number" || col.type === "currency" ? "text-right tabular-nums" : "",
              col.type === "checkbox" ? "text-center" : "",
              inRect ? "bg-primary/10" : "",
              // Dashed outline in the reference's own colour, so it's obvious which cells the
              // formula being typed actually reads.
              refHit ? `outline outline-2 -outline-offset-2 outline-dashed ${REF_COLORS[refHit.color]}` : "",
              // Only the columns the fill will actually write. The preview used to paint the whole
              // row, which promised a fill across every column while applyFill wrote just the
              // selected ones.
              p.fillRect
                && p.rowIndex >= p.fillRect.top && p.rowIndex <= p.fillRect.bottom
                && ci >= p.fillRect.left && ci <= p.fillRect.right
                ? "bg-primary/5 outline-dashed outline-1 -outline-offset-1 outline-primary/40" : "",
              ruleHit ? RULE_STYLE_CLASS[ruleHit.style] : "",
              p.findHits.some((h) => h.r === p.rowIndex && h.c === ci) ? "bg-amber-100" : "",
              "relative",
            )}
          >
            {/* Someone else is parked here. Their colour comes from the server as a hex string, so
                it has to be an inline style — Tailwind can't express a runtime colour. The inset
                shadow draws inside the cell so it never shifts the grid by a pixel. */}
            {peerHere && (
              <>
                <span
                  className="pointer-events-none absolute inset-0 z-[1]"
                  style={{ boxShadow: `inset 0 0 0 2px ${peerHere.color}` }}
                />
                <span
                  className="pointer-events-none absolute -top-[9px] left-0 z-[2] max-w-[110px] truncate rounded-t px-1 text-[9px] font-bold leading-[10px] text-white"
                  style={{ backgroundColor: peerHere.color }}
                >
                  {peerHere.name}
                </span>
              </>
            )}
            {/* The little corner flag every spreadsheet uses for "there's a note here". Outside the
                type branch on purpose: a checkbox or a task cell can be commented on too. */}
            {(p.commentCounts[`${p.row.id}:${col.id}`] ?? 0) > 0 && (
              <span
                title={`${p.commentCounts[`${p.row.id}:${col.id}`]} komentar — klik kanan buat buka`}
                className="pointer-events-none absolute right-0 top-0 h-0 w-0 border-l-[6px] border-t-[6px] border-l-transparent border-t-amber-500"
              />
            )}
            {isEditing ? (
              <CellEditor
                col={col}
                initial={p.editing?.seed ?? editFormula(value, p.data.shape) ?? editValue(col.type, value as never)}
                seeded={Boolean(p.editing?.seed)}
                onCommit={(raw, next) => p.onCommit(col.id, raw, next)}
                onCancel={p.onCancel}
                onDraftChange={p.onDraftChange}
                registerEditor={p.registerEditor}
              />
            ) : col.type === "task" ? (
              <TaskCell
                taskId={typeof value === "string" ? value : ""}
                tasks={p.tasks}
                canEdit={p.canEdit}
                onOpen={p.onOpenTask}
                onPick={(id) => p.onCommit(col.id, id, null)}
              />
            ) : col.type === "select" ? (
              // A pill and a caret, like Sheets. Bare text gave no hint the cell was a dropdown at
              // all — the only way to find out was to double-click and see what happened.
              <span className="flex items-center gap-1 overflow-hidden">
                {value !== undefined && value !== null && value !== "" && (
                  <span className={cn("max-w-full truncate rounded-full px-2 text-[11px] font-semibold leading-5", optionColor(col, String(value)))}>
                    {String(value)}
                  </span>
                )}
                {p.canEdit && <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/60" />}
              </span>
            ) : col.type === "multiselect" ? (
              <span className="flex items-center gap-1 overflow-hidden">
                <span className="flex min-w-0 flex-wrap items-center gap-1">
                  {readMulti(value).map((v) => (
                    <span key={v} className={cn("max-w-full truncate rounded-full px-2 text-[11px] font-semibold leading-5", optionColor(col, v))}>{v}</span>
                  ))}
                </span>
                {p.canEdit && <ChevronDown className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/60" />}
              </span>
            ) : col.type === "link" && isLinkCell(value) ? (
              <a
                href={value.u}
                target="_blank"
                rel="noopener noreferrer"
                // stopPropagation so clicking the link doesn't also start a selection drag.
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                title={value.u}
                className="block truncate text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
              >
                {value.t || value.u}
              </a>
            ) : col.type === "checkbox" ? (
              <button
                disabled={!p.canEdit}
                onClick={() => p.onCommit(col.id, value === true ? "" : "true", null)}
                className={cn("grid h-4 w-4 place-items-center rounded border", value ? "border-primary bg-primary text-primary-foreground" : "border-border")}
              >
                {value ? <Check className="h-3 w-3" /> : null}
              </button>
            ) : (
              <>
              {p.showFillHandle && ci === p.rect.right && p.selected && (
                // The grab square, same place every spreadsheet puts it. Fills in all four
                // directions; the axis is locked to whichever way the pointer travelled further.
                <span
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); p.onFillStart(); }}
                  title="Tarik ke bawah, atas, kiri, atau kanan buat nyalin / nerusin deret"
                  className="absolute -bottom-[3px] -right-[3px] z-10 h-[7px] w-[7px] cursor-crosshair rounded-[1px] bg-primary"
                />
              )}
              <span
                className={cn("block truncate", isFormula(value) && "text-primary")}
                title={isFormula(value) ? "Sel rumus — klik 2x buat lihat rumusnya" : undefined}
              >
                {displayCell(col.type, value, { data: p.data, rowId: p.row.id, colId: col.id })}
              </span>
              </>
            )}
          </td>
        );
      })}
      <td className="border-b border-border" />
    </tr>
  );
}, (a, b) =>
  a.row === b.row &&
  a.columns === b.columns &&
  // A formula in THIS row can read cells in another row, so its rendered value changes when the
  // sheet data does — comparing only `row` would leave stale results on screen.
  a.data === b.data &&
  a.rowIndex === b.rowIndex &&
  a.gutterNumber === b.gutterNumber &&
  a.canEdit === b.canEdit &&
  a.dragging === b.dragging &&
  a.dropTarget === b.dropTarget &&
  a.refMode === b.refMode &&
  a.refRects === b.refRects &&
  a.findHits === b.findHits &&
  a.commentCounts === b.commentCounts &&
  a.peerCursors === b.peerCursors &&
  a.row.height === b.row.height &&
  a.showFillHandle === b.showFillHandle &&
  a.fillRect === b.fillRect &&
  // Only re-render when this row's selected-ness or edit state actually changed.
  (a.selected === b.selected && (!a.selected || (a.rect.left === b.rect.left && a.rect.right === b.rect.right))) &&
  (a.editing?.rowId === a.row.id) === (b.editing?.rowId === b.row.id) &&
  (a.editing?.rowId !== a.row.id || a.editing?.colId === b.editing?.colId),
);

/** The one mounted input. Uncontrolled on purpose: a refetch can never overwrite what's being typed. */
function CellEditor({ col, initial, seeded, onCommit, onCancel, onDraftChange, registerEditor }: {
  col: NexusSheetColumn; initial: string;
  /** True when `initial` is the keystroke that OPENED the editor, rather than the cell's value. */
  seeded: boolean;
  onCommit: (raw: string, next: "down" | "right" | null) => void;
  onCancel: () => void;
  onDraftChange: (text: string) => void;
  registerEditor: (el: HTMLInputElement | null) => void;
}) {
  const ref = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (!(el instanceof HTMLInputElement)) return;
    // Select-all is right when you open an existing value with F2 or a double-click: the next
    // keystroke should replace it. It is WRONG when the editor was opened BY a keystroke — that
    // character is already in the box, and selecting it makes the following keystroke eat it. That
    // is what broke formula entry: typing "=SUM(...)" stored "SUM(...)" as text, because "S"
    // replaced the selected "=".
    if (seeded) el.setSelectionRange(el.value.length, el.value.length);
    else el.select();
  }, [seeded]);

  const finish = (next: "down" | "right" | null) => {
    if (done.current) return;
    done.current = true;
    onCommit(ref.current?.value ?? "", next);
  };

  if (col.type === "multiselect" || col.type === "select") {
    return (
      <ChoiceEditor
        col={col}
        multi={col.type === "multiselect"}
        initial={initial}
        onCommit={(v) => onCommit(v, null)}
        onCancel={onCancel}
      />
    );
  }

  return (
    <FormulaInput
      inputRef={ref as React.RefObject<HTMLInputElement>}
      col={col}
      initial={initial}
      onFinish={finish}
      onCancel={() => { done.current = true; onCancel(); }}
      onDraftChange={onDraftChange}
      registerEditor={registerEditor}
    />
  );
}

/**
 * The cell input, plus the function autocomplete that appears once the text starts with "=".
 *
 * The list only offers functions the engine actually implements (SUPPORTED_FUNCTIONS lives next to
 * the evaluator's switch) — suggesting SUMPRODUCT and then returning #NAME? would be worse than not
 * suggesting it. Rendered through a portal with fixed positioning because the grid scroll container
 * has `overflow:auto`, which would otherwise clip a dropdown anchored inside a <td>.
 */
function FormulaInput({ inputRef, col, initial, onFinish, onCancel, onDraftChange, registerEditor }: {
  inputRef: React.RefObject<HTMLInputElement>;
  col: NexusSheetColumn;
  initial: string;
  onFinish: (next: "down" | "right" | null) => void;
  onCancel: () => void;
  onDraftChange: (text: string) => void;
  registerEditor: (el: HTMLInputElement | null) => void;
}) {
  const [text, setTextRaw] = useState(initial);
  // The grid needs the live draft to know whether a click should insert a reference, and to draw the
  // dashed outlines — so every change goes up as well as into local state.
  const setText = useCallback((v: string) => { setTextRaw(v); onDraftChange(v); }, [onDraftChange]);
  useEffect(() => {
    onDraftChange(initial);
    registerEditor(inputRef.current);
    return () => { onDraftChange(""); registerEditor(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [pick, setPick] = useState(0);
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null);

  /**
   * What to complete right now.
   *   ""   -> the caret sits right after "=", an operator, "(" or a separator: offer everything,
   *           which is what a spreadsheet does the instant you type "=".
   *   "SU" -> filter by that prefix.
   *   null -> nothing to complete (mid-number, after ")" or a closing quote).
   */
  const token = useMemo(() => {
    if (!text.startsWith("=")) return null;
    const letters = /([A-Za-z]+)$/.exec(text);
    if (letters) return letters[1].toUpperCase();
    return /[=+\-*/^&<>(,;:]$/.test(text) ? "" : null;
  }, [text]);

  const matches = useMemo(
    () => (token === null ? [] : SUPPORTED_FUNCTIONS.filter((f) => f.name.startsWith(token))),
    [token],
  );
  const open = matches.length > 0;

  useEffect(() => { setPick(0); }, [token]);
  useEffect(() => {
    if (!open) { setAnchor(null); return; }
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setAnchor({ left: r.left, top: r.bottom + 2, width: Math.max(240, r.width) });
  }, [open, text, inputRef]);

  const accept = (name: string) => {
    // Replace the half-typed name and open the bracket, the way every spreadsheet does.
    const next = `${text.replace(/[A-Za-z]+$/, "")}${name}(`;
    setText(next);
    const el = inputRef.current;
    if (el) {
      el.value = next;
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(next.length, next.length); });
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type={col.type === "date" && !text.startsWith("=") ? "date" : "text"}
        inputMode={col.type === "number" || col.type === "currency" ? "decimal" : undefined}
        defaultValue={initial}
        onChange={(e) => setText(e.target.value)}
        onSelect={(e) => setTextRaw((e.target as HTMLInputElement).value)}
        // Blur while clicking a suggestion would commit before the pick lands; the list uses
        // onMouseDown+preventDefault so focus never leaves in the first place.
        onBlur={() => onFinish(null)}
        onKeyDown={(e) => {
          e.stopPropagation(); // arrows move the caret, not the grid selection
          if (open) {
            if (e.key === "ArrowDown") { e.preventDefault(); setPick((p) => (p + 1) % matches.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setPick((p) => (p - 1 + matches.length) % matches.length); return; }
            if (e.key === "Tab") { e.preventDefault(); accept(matches[pick].name); return; }
            if (e.key === "Enter" && token) { e.preventDefault(); accept(matches[pick].name); return; }
            if (e.key === "Escape") { e.preventDefault(); setText(`${text} `); return; } // close list, keep editing
          }
          if (e.key === "Enter") { e.preventDefault(); onFinish("down"); }
          else if (e.key === "Tab") { e.preventDefault(); onFinish("right"); }
          else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        className="w-full select-text rounded border border-primary bg-background px-1 py-0.5 text-sm outline-none"
      />
      {open && anchor && createPortal(
        <div
          style={{ left: anchor.left, top: anchor.top, width: anchor.width }}
          className="fixed z-[60] overflow-hidden rounded-xl border border-border bg-card shadow-pop"
        >
          <div className="max-h-64 overflow-y-auto">
          {matches.map((f, i) => (
            <button
              key={f.name}
              onMouseDown={(e) => { e.preventDefault(); accept(f.name); }}
              onMouseEnter={() => setPick(i)}
              className={cn("block w-full px-3 py-1.5 text-left transition", i === pick ? "bg-primary/10" : "hover:bg-accent")}
            >
              <div className="font-mono text-xs font-bold">
                {f.name}<span className="font-normal text-muted-foreground">{f.args}</span>
              </div>
              <div className="text-[11px] text-muted-foreground">{f.desc}</div>
            </button>
          ))}
          </div>
          <div className="border-t border-border px-3 py-1 text-[10px] text-muted-foreground">
            <b>Tab</b> buat pilih · <b>↑↓</b> buat pindah
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
