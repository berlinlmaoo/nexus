import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownAZ, ArrowUpAZ, BetweenHorizontalStart, BetweenVerticalStart, ChevronDown, ClipboardPaste, Copy,
  Eraser, EyeOff, Filter, Link2 as LinkIcon, ListChecks, MessageSquare, MoveHorizontal, MoveVertical, Paintbrush, Plus,
  RemoveFormatting, Replace, RotateCcw, Scissors, Search, Settings2, Snowflake, Trash2, X,
  CalendarDays, CircleChevronDown, ClipboardList, Hash, SquareCheck, Tags, Type,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { t as trT, useLang } from "@/lib/lang";
import type { NexusSheetColumnColor, NexusSheetSettings } from "@/lib/nexus-api";
import {
  COLUMN_COLOR_CLASS, COLUMN_TYPE_LABEL, RULE_STYLE_CLASS, buildSheetData, displayCell, editFormula, editValue,
  fillValues, inputToCell, isLinkCell, matchRule, optionColor, readMulti, sameCell, sortKey,
  type NexusSheetColumn, type NexusSheetColumnType, type NexusSheetRow, type NexusSheetRule,
} from "./sheet-types";
import {
  decimalsShown, engineFor, errorHint, findA1Ranges, formatResult, formatWithStyle, isError, isFormulaCell, letterToIndex,
  shiftFormula, toDisplay, toStored, type SheetEngine,
} from "@/lib/sheet-formula";
import {
  buildClipboard, consumeCut, foreignFormulaAt, readClipboard, readClipboardAsync, writeClipboardAsync, writeClipboardEvent,
  type ClipCell, type PasteBlock,
} from "./sheet-clipboard";
import { CellEditor, ColumnPopover, TaskCell, type Next } from "./sheet-cells";
import { SheetToolbar, Menu, MenuItem } from "./SheetToolbar";
import {
  borderShadows, bordersFor, horizontalClass, patchStyle, styleClasses, styleInline, verticalClass,
  type BorderPreset, type CellStyle,
} from "./sheet-style";

// Mirrors ROW_HEIGHT_MIN / ROW_HEIGHT_MAX in src/lib/project-sheets.ts — the server clamps to the
// same bounds, so a hand-crafted request can't produce a row the grid won't render sanely.
const ROW_H_MIN = 20;
const ROW_H_MAX = 400;

/**
 * Windowing.
 *
 * A 1.000-row sheet put 10.030 <td> in the DOM and a single arrow-key press locked the tab for over
 * 45 seconds — the browser was relaying out the whole table on every selection change. Only the rows
 * on screen (plus a buffer) are rendered; the space above and below is held open by two spacer rows so
 * the scrollbar still reflects the real size.
 *
 * Row heights are therefore EXACT, not estimated: every <tr> gets an explicit height, so the running
 * offsets used to pick the window can't drift from what's painted.
 */
const ROW_H_DEFAULT = 26;
const WINDOW_BUFFER = 12;
/** Fixed geometry (Sheets-like): the row-number gutter, the letter header and the optional name row. */
const GUTTER_W = 46;
const HEAD_H = 24;
const LABEL_H = 26;
const COL_W_DEFAULT = 120;
const ADD_COL_W = 44;
/** Selection colour: NEXUS's electric-blue accent (--info). */
const SEL = "var(--info)";
const FREEZE_LINE = "color-mix(in oklab, var(--muted-foreground) 55%, transparent)";
/** Opaque selection tints for STICKY surfaces (headers, gutter, frozen panes): a translucent tint
 *  there would let the cells scrolling underneath show through. */
const HEAD_SEL_BG = "bg-[color-mix(in_oklab,var(--info)_16%,var(--muted))]";
const LABEL_SEL_BG = "bg-[color-mix(in_oklab,var(--info)_9%,var(--card))]";

/**
 * The grid.
 *
 * The load-bearing decision: **only ONE <input> is mounted at a time** — the cell being edited.
 * Every other cell is a plain <td> with formatted text. Thousands of mounted inputs would kill the
 * browser; a background refetch can't steal focus from an input that doesn't exist; and Rupiah/date
 * formatting renders as text instead of fighting the input's value.
 *
 * Chrome follows Google Sheets (owner, 11 Oct 2026): toolbar, Name Box + fx bar, lettered columns and
 * numbered rows, a blue selection with a fill handle, freeze bars, sheet tabs and a status bar. The
 * named, typed columns NEXUS always had stay: their names show in a slim row under the letters (only
 * when some column has a name or a type), and their settings live in the column menu.
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
 * ONE function feeds both the dashed preview and the actual write. Axis-locked, like Excel.
 */
function fillTarget(rect: { top: number; bottom: number; left: number; right: number }, to: { r: number; c: number } | null): FillRect | null {
  if (!to) return null;
  const down = to.r - rect.bottom, up = rect.top - to.r;
  const right = to.c - rect.right, left = rect.left - to.c;
  const vert = Math.max(down, up), horiz = Math.max(right, left);
  if (vert <= 0 && horiz <= 0) return null;
  if (vert >= horiz) {
    return down > 0
      ? { top: rect.bottom + 1, bottom: to.r, left: rect.left, right: rect.right, axis: "down" }
      : { top: to.r, bottom: rect.top - 1, left: rect.left, right: rect.right, axis: "up" };
  }
  return right > 0
    ? { top: rect.top, bottom: rect.bottom, left: rect.right + 1, right: to.c, axis: "right" }
    : { top: rect.top, bottom: rect.bottom, left: to.c, right: rect.left - 1, axis: "left" };
}

/** A1-style letters are a DISPLAY layer over the column's position — the stored key is its id. */
export function colLetter(i: number): string {
  let n = i;
  let out = "";
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return out;
}

type ColumnPatch = { name?: string; type?: NexusSheetColumnType; width?: number; options?: string[]; optionColors?: Record<string, NexusSheetColumnColor>; color?: NexusSheetColumnColor; rules?: NexusSheetRule[] };
type StyleEdit = { rowId: string; values: Record<string, CellStyle | null> };
type MenuEntry = { label: string; icon?: ReactNode; run: () => void; hint?: string; danger?: boolean; disabled?: boolean } | "sep";
type Stat = "sum" | "avg" | "count" | "countNum" | "min" | "max";

function readZoom(): number {
  try { const z = Number(localStorage.getItem("nexus-sheet-zoom")); return z >= 0.5 && z <= 2 ? z : 1; } catch { return 1; }
}
function readStat(): Stat {
  try { const s = localStorage.getItem("nexus-sheet-stat") as Stat | null; return s && ["sum", "avg", "count", "countNum", "min", "max"].includes(s) ? s : "sum"; } catch { return "sum"; }
}

export function SheetGrid({
  columns, rows, settings, canEdit, canManage,
  onSetCells, onSetStyles, onSettings, onAddRows, onDeleteRows, onReorderRow, onDeleteColumn, onEditColumn, onAddColumn,
  tasks, onOpenTask, commentCounts, onOpenComments, peerCursors, onEditingChange, onCursor, onResizeRow, onInsertColumn,
  canUndo, canRedo, onUndo, onRedo, footerLeft, saving,
}: {
  columns: NexusSheetColumn[];
  rows: NexusSheetRow[];
  settings: NexusSheetSettings;
  canEdit: boolean;
  canManage: boolean;
  onSetCells: (edits: { rowId: string; values: Record<string, unknown> }[]) => void;
  onSetStyles: (edits: StyleEdit[], label: string) => void;
  onSettings: (patch: { [K in keyof NexusSheetSettings]?: NexusSheetSettings[K] | null }, label: string) => void;
  onAddRows: (payload: { count?: number; afterRowId?: string; beforeRowId?: string; rows?: Record<string, unknown>[] }) => Promise<NexusSheetRow[]>;
  onDeleteRows: (rowIds: string[]) => void;
  /** Move `rowId` to just after `afterRowId`; null means "to the top". */
  onReorderRow: (rowId: string, afterRowId: string | null) => void;
  onDeleteColumn: (columnId: string) => void;
  onEditColumn: (columnId: string, patch: ColumnPatch) => void;
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
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Sheet tabs, drawn at the left of the bottom bar (the status bar sits on the right). */
  footerLeft?: ReactNode;
  saving?: boolean;
}) {
  const { lang, t } = useLang();
  const [sel, setSel] = useState<Selection>({ r: 0, c: 0, r2: 0, c2: 0 });
  /** Right-click menus, anchored at the pointer: a cell, a column header, a row header. */
  const [menu, setMenu] = useState<{ kind: "cell" | "col" | "row"; r: number; c: number; left: number; top: number } | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const maxC = columns.length - 1;
  const dragging = useRef(false);
  // Row drag uses the HTML5 DnD API on the row-number gutter only, so it never fights cell selection.
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [dropRow, setDropRow] = useState<string | null>(null);
  const rect = useMemo(() => rectOf(sel), [sel]);
  const [zoom, setZoomState] = useState(readZoom);
  const setZoom = (z: number) => { setZoomState(z); try { localStorage.setItem("nexus-sheet-zoom", String(z)); } catch { /* ignore */ } };
  /** The column whose settings popover is open (name, type, choices, colours, rules). */
  const [colPopover, setColPopover] = useState<{ colId: string; anchor: DOMRect | null } | null>(null);

  // Formulas are evaluated, never stored — so the context is rebuilt whenever the data is. The engine
  // carries over every cached result an edit didn't touch (dependency graph).
  const data = useMemo(() => buildSheetData(columns, rows), [columns, rows]);
  const engineRef = useRef<SheetEngine | null>(null);
  const engine = useMemo(() => {
    const e = engineFor(data, engineRef.current);
    engineRef.current = e;
    return e;
  }, [data]);

  // While a FORMULA is being edited, clicking a cell inserts its reference instead of moving the
  // selection — that's the behaviour that makes formulas usable without memorising addresses.
  const [draft, setDraft] = useState("");
  const editorEl = useRef<HTMLInputElement | null>(null);
  const refSpan = useRef<{ at: number; len: number; anchor: { r: number; c: number } } | null>(null);
  const [fillTo, setFillTo] = useState<{ r: number; c: number } | null>(null);
  const filling = useRef(false);
  const [sort, setSort] = useState<{ colId: string; dir: "asc" | "desc" } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  /** Columns whose filter box is open (shown in the name row under the letters). */
  const [filterOpen, setFilterOpen] = useState<Record<string, boolean>>({});
  const [scroll, setScroll] = useState({ top: 0, height: 700 });
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState({ q: "", to: "", matchCase: false });
  const [stat, setStatState] = useState<Stat>(readStat);
  const setStat = (s: Stat) => { setStatState(s); try { localStorage.setItem("nexus-sheet-stat", s); } catch { /* ignore */ } };

  // ── Sheet settings ───────────────────────────────────────────────────────────────────────────
  const hiddenRows = useMemo(() => new Set(settings.hiddenRows ?? []), [settings.hiddenRows]);
  const hiddenCols = useMemo(() => new Set(settings.hiddenCols ?? []), [settings.hiddenCols]);
  const frozenCols = Math.min(settings.frozenCols ?? 0, columns.length);
  const frozenRowsSetting = settings.frozenRows ?? 0;
  const colHidden = useCallback((c: number) => hiddenCols.has(columns[c]?.id ?? ""), [hiddenCols, columns]);

  /**
   * What's on screen: the rows after hiding, sorting and filtering, each keeping its index in the
   * UNDERLYING order. Sorting is a per-viewer VIEW, never a write. Frozen rows are the sheet's first
   * N rows and stay put on top — sorting and filtering leave them alone, as Sheets does with a
   * frozen header row.
   */
  const { view, frozenRows } = useMemo(() => {
    const all = rows.map((row, rawIndex) => ({ row, rawIndex })).filter(({ row }) => !hiddenRows.has(row.id));
    const fixedRaw = Math.min(frozenRowsSetting, rows.length);
    const fixed = all.filter((x) => x.rawIndex < fixedRaw);
    let list = all.filter((x) => x.rawIndex >= fixedRaw);

    const active = Object.entries(filters).filter(([, q]) => q.trim());
    if (active.length) {
      // Filters match what the cell SHOWS — a formula's result, a typed "Rp 1.500.000" — not its source.
      list = list.filter(({ row }) => active.every(([colId, q]) => {
        const col = columns.find((c) => c.id === colId);
        const shown = col ? displayCell(col.type, row.cells[colId], { data, rowId: row.id, colId }) : String(row.cells[colId] ?? "");
        return shown.toLowerCase().includes(q.trim().toLowerCase());
      }));
    }
    if (sort) {
      const dir = sort.dir === "asc" ? 1 : -1;
      // By the COMPUTED value: numbers (and dates, typed Rupiah, numeric text) before text.
      const keyed = list.map((item) => ({ item, k: sortKey(engine.value(item.row.id, sort.colId)) }));
      keyed.sort((a, b) => {
        if (!a.k || !b.k) return !a.k && !b.k ? 0 : !a.k ? 1 : -1; // empties always sink
        if ("n" in a.k && "n" in b.k) return (a.k.n - b.k.n) * dir;
        if ("n" in a.k) return -dir;
        if ("n" in b.k) return dir;
        return a.k.s.localeCompare(b.k.s, "id", { sensitivity: "base" }) * dir;
      });
      list = keyed.map((x) => x.item);
    }
    return { view: [...fixed, ...list], frozenRows: fixed.length };
  }, [rows, columns, sort, filters, data, engine, hiddenRows, frozenRowsSetting]);

  /** Running pixel offset of every row, so the window and the spacers agree to the pixel. */
  const offsets = useMemo(() => {
    const out = new Array<number>(view.length + 1);
    out[0] = 0;
    for (let i = 0; i < view.length; i += 1) out[i + 1] = out[i] + (view[i].row.height ?? ROW_H_DEFAULT);
    return out;
  }, [view]);
  const totalHeight = offsets[view.length] ?? 0;

  /** Column geometry: widths (hidden = 0) and the left edge of each, for frozen (sticky) columns. */
  const widths = useMemo(() => columns.map((c) => (hiddenCols.has(c.id) ? 0 : c.width ?? COL_W_DEFAULT)), [columns, hiddenCols]);
  const lefts = useMemo(() => {
    const out: number[] = [];
    let x = GUTTER_W;
    for (const w of widths) { out.push(x); x += w; }
    return out;
  }, [widths]);
  const tableWidth = GUTTER_W + widths.reduce((s, w) => s + w, 0) + ADD_COL_W;

  /** The slim row of column names/types under the letters — only when some column carries one. */
  const showLabels = useMemo(
    () => columns.some((c) => c.name.trim() || c.type !== "text" || c.color) || Object.values(filterOpen).some(Boolean) || Object.values(filters).some((q) => q),
    [columns, filterOpen, filters],
  );
  const headH = HEAD_H + (showLabels ? LABEL_H : 0);

  const syncScroll = useCallback(() => {
    const el = gridRef.current;
    if (!el) return;
    setScroll((prev) =>
      prev.top === el.scrollTop && prev.height === el.clientHeight ? prev : { top: el.scrollTop, height: el.clientHeight },
    );
  }, []);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    syncScroll();
    const ro = new ResizeObserver(syncScroll);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncScroll]);

  /** Keep the cursor on screen (windowing means the row may not be mounted). */
  useEffect(() => {
    const el = gridRef.current;
    if (!el || sel.r < frozenRows) return;
    const pinned = (offsets[frozenRows] ?? 0) * zoom;
    const top = (offsets[sel.r] ?? 0) * zoom;
    const bottom = (offsets[sel.r + 1] ?? 0) * zoom;
    const header = headH * zoom;
    if (top - pinned < el.scrollTop) el.scrollTop = Math.max(0, top - pinned);
    else if (bottom + header > el.scrollTop + el.clientHeight) el.scrollTop = bottom + header - el.clientHeight;
    // Horizontal: keep the active column visible past the frozen ones.
    const cl = (lefts[sel.c] ?? 0) * zoom, cr = cl + (widths[sel.c] ?? 0) * zoom;
    const frozenW = ((lefts[frozenCols] ?? GUTTER_W)) * zoom;
    if (sel.c >= frozenCols) {
      if (cl - frozenW + GUTTER_W * zoom < el.scrollLeft + GUTTER_W * zoom) el.scrollLeft = Math.max(0, cl - frozenW);
      else if (cr > el.scrollLeft + el.clientWidth) el.scrollLeft = cr - el.clientWidth;
    }
  }, [sel.r, sel.c, offsets, zoom, headH, frozenRows, lefts, widths, frozenCols]);

  // ── Merged cells (only drawn while the view is in sheet order) ──────────────────────────────
  const naturalOrder = !sort && !Object.values(filters).some((q) => q.trim());
  const merges = useMemo(() => {
    const anchors = new Map<string, { rowSpan: number; colSpan: number }>();
    const covered = new Set<string>();
    const ranges: { top: number; bottom: number; left: number; right: number }[] = [];
    if (!naturalOrder) return { anchors, covered, ranges };
    const viewIdx = new Map(view.map((v, i) => [v.row.id, i]));
    const rawIdx = new Map(rows.map((r, i) => [r.id, i]));
    for (const m of settings.merges ?? []) {
      const r0 = rawIdx.get(m.r), c0 = columns.findIndex((c) => c.id === m.c);
      if (r0 === undefined || c0 < 0) continue;
      const vis: number[] = [];
      for (let r = r0; r < Math.min(rows.length, r0 + m.rs); r += 1) { const i = viewIdx.get(rows[r].id); if (i !== undefined) vis.push(i); }
      if (!vis.length) continue;
      const c1 = Math.min(columns.length - 1, c0 + m.cs - 1);
      const top = vis[0], bottom = vis[vis.length - 1];
      anchors.set(`${view[top].row.id}:${columns[c0].id}`, { rowSpan: vis.length, colSpan: c1 - c0 + 1 });
      ranges.push({ top, bottom, left: c0, right: c1 });
      for (const i of vis) for (let c = c0; c <= c1; c += 1) if (!(i === top && c === c0)) covered.add(`${view[i].row.id}:${columns[c].id}`);
    }
    return { anchors, covered, ranges };
  }, [naturalOrder, settings.merges, view, rows, columns]);

  const [winFirst, winLast] = useMemo(() => {
    const n = view.length;
    let first = frozenRows, last = n;
    if (n - frozenRows > WINDOW_BUFFER * 3) {
      const top = scroll.top / zoom + offsets[frozenRows];
      const height = scroll.height / zoom;
      let lo = frozenRows, hi = n - 1, start = frozenRows;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid + 1] <= top) lo = mid + 1;
        else { start = mid; hi = mid - 1; }
      }
      let end = start;
      while (end < n && offsets[end] < top + height) end += 1;
      first = Math.max(frozenRows, start - WINDOW_BUFFER);
      last = Math.min(n, end + WINDOW_BUFFER);
    }
    // A merged block that starts above the window but reaches into it must render from its anchor.
    for (const m of merges.ranges) if (m.top < first && m.bottom >= first && m.top >= frozenRows) first = m.top;
    return [first, last];
  }, [offsets, scroll.top, scroll.height, view.length, frozenRows, zoom, merges.ranges]);

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

  /** The rectangles the draft formula refers to, each with a colour. */
  const refRects = useMemo(() => {
    if (!editing || !draft.startsWith("=")) return [];
    return findA1Ranges(draft)
      .filter((x) => x.left <= maxC && x.top <= rows.length - 1)
      .map((x, i) => ({ top: x.top, bottom: Math.min(x.bottom, rows.length - 1), left: x.left, right: x.right, color: i % REF_COLORS.length }));
  }, [editing, draft, rows.length, maxC]);

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

  /** Step to the next VISIBLE column in a direction (hidden columns are skipped, like Sheets). */
  const stepCol = useCallback((c: number, dc: number) => {
    let n = c + dc;
    while (n >= 0 && n <= maxC && colHidden(n)) n += dc > 0 ? 1 : -1;
    return n < 0 || n > maxC ? c : n;
  }, [maxC, colHidden]);

  const move = useCallback((dr: number, dc: number, extend: boolean) => {
    setSel((s) => {
      const fromC = extend ? s.c2 : s.c;
      const nc = dc ? stepCol(fromC, dc) : fromC;
      const { r, c } = clamp((extend ? s.r2 : s.r) + dr, nc);
      return extend ? { ...s, r2: r, c2: c } : { r, c, r2: r, c2: c };
    });
  }, [clamp, stepCol]);

  // ── Writes ───────────────────────────────────────────────────────────────────────────────────

  /** Save what was typed — through inputToCell, the one path from text to a cell value. */
  const commit = useCallback((rowId: string, colId: string, raw: string) => {
    const col = columns.find((x) => x.id === colId);
    if (!col) return;
    const prevRaw = rows.find((x) => x.id === rowId)?.cells[colId];
    const next = inputToCell(col, raw, data.shape, prevRaw);
    if (sameCell(prevRaw, next)) return;
    onSetCells([{ rowId, values: { [colId]: next } }]);
  }, [columns, rows, onSetCells, data.shape]);

  /** Clear every VALUE in the current rectangle in one request (formatting stays, as in Sheets). */
  const clearSelection = useCallback(() => {
    if (!canEdit) return;
    const edits: { rowId: string; values: Record<string, unknown> }[] = [];
    for (let r = rect.top; r <= rect.bottom; r += 1) {
      const row = view[r]?.row;
      if (!row) continue;
      const values: Record<string, unknown> = {};
      for (let c = rect.left; c <= rect.right; c += 1) {
        const col = columns[c];
        if (col && row.cells[col.id] !== undefined) values[col.id] = null;
      }
      if (Object.keys(values).length) edits.push({ rowId: row.id, values });
    }
    if (edits.length) onSetCells(edits);
  }, [canEdit, rect, view, columns, onSetCells]);

  /** Apply a formatting change to every cell of the selection. */
  const styleSelection = useCallback((fn: (st: CellStyle | undefined, r: number, c: number) => CellStyle | null, label: string) => {
    if (!canEdit) return;
    const edits: StyleEdit[] = [];
    for (let r = rect.top; r <= rect.bottom; r += 1) {
      const row = view[r]?.row;
      if (!row) continue;
      const values: Record<string, CellStyle | null> = {};
      for (let c = rect.left; c <= rect.right; c += 1) {
        const col = columns[c];
        if (!col || colHidden(c)) continue;
        const before = row.styles?.[col.id];
        const next = fn(before, r, c);
        if (JSON.stringify(before ?? null) !== JSON.stringify(next ?? null)) values[col.id] = next;
      }
      if (Object.keys(values).length) edits.push({ rowId: row.id, values });
    }
    if (edits.length) onSetStyles(edits, label);
  }, [canEdit, rect, view, columns, colHidden, onSetStyles]);

  const activeRow = view[sel.r]?.row;
  const activeCol = columns[sel.c];
  const activeRaw = activeRow && activeCol ? activeRow.cells[activeCol.id] : undefined;
  const activeStyle = activeRow && activeCol ? activeRow.styles?.[activeCol.id] : undefined;

  const applyStyle = (patch: Partial<Record<keyof CellStyle, unknown>>) =>
    styleSelection((st) => patchStyle(st, patch), t("format cells"));
  const applyBorders = (preset: BorderPreset) =>
    styleSelection((st, r, c) => patchStyle(st, { bd: bordersFor(preset, r, c, rect, st?.bd) || null }), t("borders"));
  const clearFormat = () => styleSelection(() => null, t("clear formatting"));
  const changeDecimals = (delta: 1 | -1) => {
    const shown = activeRow && activeCol ? displayCell(activeCol.type, activeRaw, { data, rowId: activeRow.id, colId: activeCol.id }) : "";
    const current = activeStyle?.dp ?? decimalsShown(shown);
    const dp = Math.max(0, Math.min(10, current + delta));
    styleSelection((st) => patchStyle(st, { dp }), t("decimal places"));
  };

  /** Merge the selection, or unmerge whatever merged blocks it touches. */
  const mergedHere = merges.ranges.filter((m) => m.top <= rect.bottom && m.bottom >= rect.top && m.left <= rect.right && m.right >= rect.left);
  const canMerge = naturalOrder && (mergedHere.length > 0 || rect.bottom > rect.top || rect.right > rect.left);
  const toggleMerge = () => {
    if (!canEdit || !naturalOrder) return;
    const current = settings.merges ?? [];
    if (mergedHere.length) {
      const ids = new Set(mergedHere.map((m) => `${view[m.top].row.id}:${columns[m.left].id}`));
      onSettings({ merges: current.filter((m) => !ids.has(`${m.r}:${m.c}`)) }, t("unmerge cells"));
      return;
    }
    const top = view[rect.top], bottom = view[rect.bottom];
    if (!top || !bottom) return;
    onSettings({
      merges: [...current, { r: top.row.id, c: columns[rect.left].id, rs: bottom.rawIndex - top.rawIndex + 1, cs: rect.right - rect.left + 1 }],
    }, t("merge cells"));
  };

  const moveFormula = useCallback((stored: string, from: { r: number; c: number }, to: { r: number; c: number }) => {
    const text = toDisplay(stored, data.shape);
    return { f: toStored(shiftFormula(text, to.r - from.r, to.c - from.c), data.shape) };
  }, [data.shape]);

  const fillPreviewRect = useMemo(() => fillTarget(rect, fillTo), [rect, fillTo]);

  /** Commit whatever the fill drag is previewing. */
  const applyFill = useCallback((to: { r: number; c: number }) => {
    if (!canEdit) return;
    const tgt = fillTarget(rect, to);
    if (!tgt) return;
    const edits: { rowId: string; values: Record<string, unknown> }[] = [];
    const put = (rowIdx: number, colIdx: number, value: unknown) => {
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
    const rawAt = (r: number, c: number) => { const col = columns[c]; return col ? view[r]?.row.cells[col.id] : undefined; };
    const posOf = (r: number, c: number) => ({ r: view[r]?.rawIndex ?? r, c });
    /** One line of the fill: formulas shift to their new place, series continue, blocks repeat. */
    const fillLine = (sources: { r: number; c: number }[], targets: { r: number; c: number }[]) => {
      const raws = sources.map((p) => rawAt(p.r, p.c));
      if (raws.some((v) => isFormulaCell(v))) {
        targets.forEach((tg, i) => {
          const k = i % sources.length;
          const v = raws[k];
          put(tg.r, tg.c, isFormulaCell(v) ? moveFormula(v.f, posOf(sources[k].r, sources[k].c), posOf(tg.r, tg.c)) : v ?? null);
        });
        return;
      }
      const produced = fillValues(raws, targets.length);
      targets.forEach((tg, i) => put(tg.r, tg.c, produced[i]));
    };
    if (tgt.axis === "down" || tgt.axis === "up") {
      const out: number[] = [];
      if (tgt.axis === "down") for (let r = tgt.top; r <= tgt.bottom; r += 1) out.push(r);
      else for (let r = tgt.bottom; r >= tgt.top; r -= 1) out.push(r);
      for (let c = rect.left; c <= rect.right; c += 1) {
        const src: { r: number; c: number }[] = [];
        for (let r = rect.top; r <= rect.bottom; r += 1) src.push({ r, c });
        fillLine(tgt.axis === "down" ? src : [...src].reverse(), out.map((r) => ({ r, c })));
      }
    } else {
      const out: number[] = [];
      if (tgt.axis === "right") for (let c = tgt.left; c <= tgt.right; c += 1) out.push(c);
      else for (let c = tgt.right; c >= tgt.left; c -= 1) out.push(c);
      for (let r = rect.top; r <= rect.bottom; r += 1) {
        const src: { r: number; c: number }[] = [];
        for (let c = rect.left; c <= rect.right; c += 1) src.push({ r, c });
        fillLine(tgt.axis === "right" ? src : [...src].reverse(), out.map((c) => ({ r, c })));
      }
    }
    if (edits.length) onSetCells(edits);
    setSel({
      r: Math.min(rect.top, tgt.top), c: Math.min(rect.left, tgt.left),
      r2: Math.max(rect.bottom, tgt.bottom), c2: Math.max(rect.right, tgt.right),
    });
  }, [canEdit, rect, columns, view, onSetCells, moveFormula]);

  /** The selected block for the clipboard: what cells SHOW, plus raw values and A1 formulas. */
  const clipSelection = useCallback((cut: boolean) => {
    const cells: ClipCell[][] = [];
    for (let r = rect.top; r <= rect.bottom; r += 1) {
      const row = view[r]?.row;
      if (!row) continue;
      const line: ClipCell[] = [];
      for (let c = rect.left; c <= rect.right; c += 1) {
        const col = columns[c];
        if (!col) { line.push({ text: "" }); continue; }
        const raw = row.cells[col.id];
        const text = col.type === "checkbox"
          ? (raw === true ? "TRUE" : raw === false ? "FALSE" : "")
          : displayCell(col.type, raw, { data, rowId: row.id, colId: col.id });
        const cell: ClipCell = { text, raw: raw ?? null };
        if (isFormulaCell(raw)) cell.formula = toDisplay(raw.f, data.shape);
        line.push(cell);
      }
      cells.push(line);
    }
    return buildClipboard(cells, { r: view[rect.top]?.rawIndex ?? rect.top, c: rect.left }, cut, columns.slice(rect.left, rect.right + 1).map((c) => c.type));
  }, [rect, view, columns, data]);

  /** Paste a block at the selection (one value onto a range fills it; formulas shift). */
  const applyPaste = useCallback(async (block: PasteBlock) => {
    if (!canEdit || !block.cells.length) return;
    let cells = block.cells;
    const selRows = rect.bottom - rect.top + 1, selCols = rect.right - rect.left + 1;
    const single = cells.length === 1 && cells[0].length === 1;
    if (single && selRows * selCols > 1) cells = Array.from({ length: selRows }, () => Array.from({ length: selCols }, () => block.cells[0][0]));
    const startR = rect.top;
    const startC = rect.left;
    // Grow the sheet downward if the block runs past the last row. Columns are NOT auto-created.
    // While a filter hides rows the paste is clipped to what's visible instead.
    const needed = filtering ? 0 : startR + cells.length - view.length;
    let working = view.map((v) => ({ row: v.row, rawIndex: v.rawIndex }));
    if (needed > 0) {
      const created = await onAddRows({ count: needed });
      working = [...working, ...created.map((row, i) => ({ row, rawIndex: rows.length + i }))];
    }
    const shape = needed > 0
      ? { columnIds: data.shape.columnIds, rowIds: [...data.shape.rowIds, ...working.slice(view.length).map((w) => w.row.id)] }
      : data.shape;
    const edits: { rowId: string; values: Record<string, unknown> }[] = [];
    cells.forEach((line, i) => {
      const target = working[startR + i];
      if (!target) return;
      const values: Record<string, unknown> = {};
      line.forEach((cell, j) => {
        const col = columns[startC + j];
        if (!col) return;
        const at = { r: target.rawIndex, c: startC + j };
        const srcI = single ? 0 : i, srcJ = single ? 0 : j;
        if (cell.formula && block.origin) {
          const from = { r: block.origin.r + srcI, c: block.origin.c + srcJ };
          const text = block.cut ? cell.formula : shiftFormula(cell.formula, at.r - from.r, at.c - from.c);
          values[col.id] = { f: toStored(text, shape) };
          return;
        }
        if (cell.formulaR1C1) { values[col.id] = { f: toStored(foreignFormulaAt(cell.formulaR1C1, at.r, at.c), shape) }; return; }
        if (block.internal && cell.raw !== undefined && block.types?.[srcJ] === col.type) { values[col.id] = cell.raw; return; }
        values[col.id] = inputToCell(col, cell.text, shape);
      });
      if (Object.keys(values).length) edits.push({ rowId: target.row.id, values });
    });
    if (edits.length) onSetCells(edits);
    if (block.cut) consumeCut();
    setSel({
      r: startR, c: startC,
      r2: Math.min(view.length + Math.max(0, needed) - 1, startR + cells.length - 1),
      c2: Math.min(maxC, startC + Math.max(...cells.map((l) => l.length)) - 1),
    });
  }, [canEdit, rect, view, rows.length, columns, onAddRows, onSetCells, maxC, filtering, data.shape]);

  const openCommentsAt = (r: number, c: number) => {
    const row = view[r]?.row;
    const col = columns[c];
    if (!row || !col) return;
    const el = gridRef.current?.querySelector(`[data-cell="${row.id}:${col.id}"]`);
    const box = el?.getBoundingClientRect();
    onOpenComments(row.id, col.id, box ? { left: box.left, top: box.bottom + 4 } : { left: 80, top: 160 });
  };

  /** Insert link (any text or link column): a label plus an http(s) address. */
  const insertLink = () => {
    const row = activeRow, col = activeCol;
    if (!canEdit || !row || !col) return;
    if (col.type !== "text" && col.type !== "link") { alert(t("Links can go in text and link columns.")); return; }
    const raw = row.cells[col.id];
    const url = window.prompt(t("Link address for this cell:"), isLinkCell(raw) ? raw.u : "");
    if (url === null) return;
    const label = displayCell(col.type, raw, { data, rowId: row.id, colId: col.id });
    onSetCells([{ rowId: row.id, values: { [col.id]: url.trim() ? { t: label || url.trim(), u: url.trim() } : (label || null) } }]);
  };

  /** Σ: on a block, write =FN(block) in the cell below it; on one cell, start typing =FN(. */
  const insertFunction = (fn: string) => {
    if (!canEdit) return;
    const multi = rect.bottom > rect.top && rect.left === rect.right && naturalOrder;
    if (multi && ["SUM", "AVERAGE", "COUNT", "MAX", "MIN"].includes(fn)) {
      const below = view[rect.bottom + 1];
      const col = columns[rect.left];
      if (below && col) {
        const range = `${a1(view[rect.top].rawIndex, rect.left)}:${a1(view[rect.bottom].rawIndex, rect.left)}`;
        onSetCells([{ rowId: below.row.id, values: { [col.id]: { f: toStored(`=${fn}(${range})`, data.shape) } } }]);
        setSel({ r: rect.bottom + 1, c: rect.left, r2: rect.bottom + 1, c2: rect.left });
        return;
      }
    }
    if (activeRow && activeCol) setEditing({ rowId: activeRow.id, colId: activeCol.id, seed: `=${fn}(` });
  };

  useEffect(() => { onEditingChange(editing ? { rowId: editing.rowId, colId: editing.colId } : null); }, [editing, onEditingChange]);
  useEffect(() => { onCursor(view[sel.r]?.row.id ?? null, columns[sel.c]?.id ?? null); }, [sel.r, sel.c, view, columns, onCursor]);

  // ── Header actions ──────────────────────────────────────────────────────────────────────────
  const selectColumns = (c1: number, c2: number) => setSel({ r: 0, c: c1, r2: maxR, c2 });
  const selectRows = (r1: number, r2: number) => setSel({ r: r1, c: 0, r2, c2: maxC });
  const hideColumns = (from: number, to: number) => {
    const ids = columns.slice(from, to + 1).map((c) => c.id);
    if (ids.length >= columns.filter((c) => !hiddenCols.has(c.id)).length) return; // never hide everything
    onSettings({ hiddenCols: [...new Set([...(settings.hiddenCols ?? []), ...ids])] }, t("hide columns"));
  };
  const hideRows = (from: number, to: number) => {
    const ids = view.slice(from, to + 1).map((v) => v.row.id);
    onSettings({ hiddenRows: [...new Set([...(settings.hiddenRows ?? []), ...ids])] }, t("hide rows"));
  };
  const unhideCols = (ids: string[]) => onSettings({ hiddenCols: (settings.hiddenCols ?? []).filter((x) => !ids.includes(x)) }, t("unhide columns"));
  const unhideRows = (ids: string[]) => onSettings({ hiddenRows: (settings.hiddenRows ?? []).filter((x) => !ids.includes(x)) }, t("unhide rows"));

  /** Double-click a column edge: fit the widest value on screen (like Sheets' "Fit to data"). */
  const autofit = (c: number) => {
    const col = columns[c];
    if (!col) return;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return;
    ctx.font = `13px ${getComputedStyle(document.body).fontFamily}`;
    let w = ctx.measureText(col.name || colLetter(c)).width + 40;
    for (const { row } of view.slice(0, 2000)) {
      const text = displayCell(col.type, row.cells[col.id], { data, rowId: row.id, colId: col.id });
      if (text) w = Math.max(w, ctx.measureText(text).width * ((row.styles?.[col.id]?.fs ?? 13) / 13) + 20);
    }
    onEditColumn(col.id, { width: Math.round(Math.max(48, Math.min(600, w))) });
  };

  const setFrozenCols = (n: number) => onSettings({ frozenCols: n > 0 ? n : null }, n ? t("freeze columns") : t("unfreeze columns"));
  const setFrozenRows = (n: number) => onSettings({ frozenRows: n > 0 ? n : null }, n ? t("freeze rows") : t("unfreeze rows"));

  /** Dragging the thick freeze bar from the corner: drop it after any row / column. */
  const [freezeDrag, setFreezeDrag] = useState<{ axis: "row" | "col"; n: number } | null>(null);
  const startFreezeDrag = (axis: "row" | "col") => (e: React.MouseEvent) => {
    if (!canEdit) return;
    e.preventDefault(); e.stopPropagation();
    let n = axis === "row" ? frozenRowsSetting : frozenCols;
    setFreezeDrag({ axis, n });
    const onMove = (ev: MouseEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(axis === "row" ? "[data-raw-row]" : "[data-col-index]") as HTMLElement | null;
      if (!el) return;
      const box = el.getBoundingClientRect();
      if (axis === "row") {
        const raw = Number(el.dataset.rawRow);
        n = ev.clientY > box.top + box.height / 2 ? raw + 1 : raw;
      } else {
        const ci = Number(el.dataset.colIndex);
        n = ev.clientX > box.left + box.width / 2 ? ci + 1 : ci;
      }
      setFreezeDrag({ axis, n: Math.max(0, Math.min(axis === "row" ? 20 : 10, n)) });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setFreezeDrag(null);
      const final = Math.max(0, Math.min(axis === "row" ? 20 : 10, n));
      if (axis === "row" && final !== frozenRowsSetting) setFrozenRows(final);
      if (axis === "col" && final !== frozenCols) setFrozenCols(final);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ── Menus ───────────────────────────────────────────────────────────────────────────────────
  const clipboardBlocked = (keys: string) => alert(t("The browser blocked the clipboard. Use {keys} instead.", { keys }));
  const pasteVia = (valuesOnly: boolean) => () => {
    readClipboardAsync()
      .then((block) => {
        if (!block) return;
        void applyPaste(valuesOnly ? { cells: block.cells.map((r) => r.map((c) => ({ text: c.text }))), internal: false } : block);
      })
      .catch(() => clipboardBlocked("Ctrl+V / ⌘V"));
  };
  const openColumnSettings = (c: number) => {
    const col = columns[c];
    if (!col) return;
    const el = gridRef.current?.querySelector(`[data-col-index="${c}"]`);
    setColPopover({ colId: col.id, anchor: el?.getBoundingClientRect() ?? null });
  };

  const menuEntries = useMemo((): MenuEntry[] => {
    if (!menu) return [];
    const ic = (I: typeof Copy) => <I className="h-3.5 w-3.5" />;
    const row = view[menu.r]?.row;
    const col = columns[menu.c];
    const nRows = rect.bottom - rect.top + 1;
    const nCols = rect.right - rect.left + 1;
    const out: MenuEntry[] = [];
    const insertDelete = (kind: "row" | "col") => {
      if (!canEdit) return;
      if (kind === "row" && row) {
        out.push({ label: t("Insert 1 row above"), icon: ic(BetweenHorizontalStart), run: () => void onAddRows({ count: 1, beforeRowId: row.id }) });
        out.push({ label: t("Insert 1 row below"), icon: ic(BetweenHorizontalStart), run: () => void onAddRows({ count: 1, afterRowId: row.id }) });
      }
      if (kind === "col") {
        out.push({ label: t("Insert 1 column left"), icon: ic(BetweenVerticalStart), run: () => onInsertColumn(menu.c) });
        out.push({ label: t("Insert 1 column right"), icon: ic(BetweenVerticalStart), run: () => onInsertColumn(menu.c + 1) });
      }
    };
    if (menu.kind === "cell") {
      if (canEdit) out.push({ label: t("Cut"), icon: ic(Scissors), hint: "⌘X", run: () => { void writeClipboardAsync(clipSelection(true)).then(clearSelection).catch(() => clipboardBlocked("Ctrl+X / ⌘X")); } });
      out.push({ label: t("Copy"), icon: ic(Copy), hint: "⌘C", run: () => void writeClipboardAsync(clipSelection(false)).catch(() => clipboardBlocked("Ctrl+C / ⌘C")) });
      if (canEdit) {
        out.push({ label: t("Paste"), icon: ic(ClipboardPaste), hint: "⌘V", run: pasteVia(false) });
        out.push({ label: t("Paste values only"), icon: ic(ClipboardPaste), run: pasteVia(true) });
        out.push("sep");
        insertDelete("row");
        insertDelete("col");
        out.push("sep");
        out.push({ label: nRows > 1 ? t("Delete rows {a} – {b}", { a: (view[rect.top]?.rawIndex ?? 0) + 1, b: (view[rect.bottom]?.rawIndex ?? 0) + 1 }) : t("Delete row"), icon: ic(Trash2), danger: true, run: () => onDeleteRows(view.slice(rect.top, rect.bottom + 1).map((v) => v.row.id)) });
        if (canManage && col) out.push({ label: t("Delete column"), icon: ic(Trash2), danger: true, run: () => onDeleteColumn(col.id) });
        out.push({ label: nRows * nCols > 1 ? t("Clear values") : t("Clear value"), icon: ic(Eraser), hint: "Del", run: clearSelection });
        out.push({ label: t("Clear formatting"), icon: ic(RemoveFormatting), hint: "⌘\\", run: clearFormat });
        out.push("sep");
        out.push({ label: col && isLinkCell(row?.cells[col.id]) ? t("Edit link") : t("Insert link"), icon: ic(LinkIcon), hint: "⌘K", run: insertLink });
      }
      out.push({ label: t("Comment"), icon: ic(MessageSquare), hint: "⌘⌥M", run: () => openCommentsAt(menu.r, menu.c) });
      if (canEdit) {
        out.push("sep");
        out.push({ label: t("Conditional formatting…"), icon: ic(Paintbrush), run: () => openColumnSettings(menu.c) });
        out.push({ label: t("Data validation…"), icon: ic(ListChecks), run: () => openColumnSettings(menu.c) });
      }
      out.push({ label: t("Filter this column"), icon: ic(Filter), run: () => col && setFilterOpen((f) => ({ ...f, [col.id]: true })) });
      return out;
    }
    if (menu.kind === "col" && col) {
      const span = nCols > 1 && menu.c >= rect.left && menu.c <= rect.right ? [rect.left, rect.right] : [menu.c, menu.c];
      const label = span[0] === span[1] ? colLetter(span[0]) : `${colLetter(span[0])}–${colLetter(span[1])}`;
      out.push({ label: t("Copy"), icon: ic(Copy), hint: "⌘C", run: () => void writeClipboardAsync(clipSelection(false)).catch(() => clipboardBlocked("Ctrl+C / ⌘C")) });
      if (canEdit) {
        out.push({ label: t("Paste"), icon: ic(ClipboardPaste), hint: "⌘V", run: pasteVia(false) });
        out.push("sep");
        insertDelete("col");
        if (canManage) out.push({ label: t("Delete column {c}", { c: colLetter(menu.c) }), icon: ic(Trash2), danger: true, run: () => onDeleteColumn(col.id) });
        out.push({ label: t("Clear column"), icon: ic(Eraser), run: clearSelection });
        out.push({ label: t("Hide column {c}", { c: label }), icon: ic(EyeOff), run: () => hideColumns(span[0], span[1]) });
        out.push({
          label: t("Resize column"), icon: ic(MoveHorizontal), run: () => {
            const w = window.prompt(t("Column width in pixels:"), String(col.width ?? COL_W_DEFAULT));
            const n = Number(w);
            if (w !== null && Number.isFinite(n) && n >= 20) onEditColumn(col.id, { width: Math.round(Math.min(600, n)) });
          },
        });
        out.push({ label: t("Fit to data"), icon: ic(MoveHorizontal), run: () => autofit(menu.c) });
        out.push(frozenCols === menu.c + 1
          ? { label: t("Unfreeze columns"), icon: ic(Snowflake), run: () => setFrozenCols(0) }
          : { label: t("Freeze up to column {c}", { c: colLetter(menu.c) }), icon: ic(Snowflake), disabled: menu.c >= 10, run: () => setFrozenCols(menu.c + 1) });
      }
      out.push("sep");
      out.push({ label: t("Sort sheet A → Z"), icon: ic(ArrowDownAZ), run: () => setSort({ colId: col.id, dir: "asc" }) });
      out.push({ label: t("Sort sheet Z → A"), icon: ic(ArrowUpAZ), run: () => setSort({ colId: col.id, dir: "desc" }) });
      if (sort) out.push({ label: t("Back to sheet order"), icon: ic(RotateCcw), run: () => setSort(null) });
      out.push({ label: t("Filter this column"), icon: ic(Filter), run: () => setFilterOpen((f) => ({ ...f, [col.id]: true })) });
      if (filters[col.id]) out.push({ label: t("Remove filter"), icon: ic(X), run: () => { setFilters((f) => ({ ...f, [col.id]: "" })); setFilterOpen((f) => ({ ...f, [col.id]: false })); } });
      if (canEdit) {
        out.push("sep");
        out.push({ label: t("Column settings…"), icon: ic(Settings2), hint: t(COLUMN_TYPE_LABEL[col.type]), run: () => openColumnSettings(menu.c) });
      }
      return out;
    }
    if (menu.kind === "row" && row) {
      const span = nRows > 1 && menu.r >= rect.top && menu.r <= rect.bottom ? [rect.top, rect.bottom] : [menu.r, menu.r];
      const rawN = (view[menu.r]?.rawIndex ?? 0) + 1;
      out.push({ label: t("Copy"), icon: ic(Copy), hint: "⌘C", run: () => void writeClipboardAsync(clipSelection(false)).catch(() => clipboardBlocked("Ctrl+C / ⌘C")) });
      if (canEdit) {
        out.push({ label: t("Paste"), icon: ic(ClipboardPaste), hint: "⌘V", run: pasteVia(false) });
        out.push("sep");
        insertDelete("row");
        out.push({ label: span[0] === span[1] ? t("Delete row {n}", { n: rawN }) : t("Delete {n} rows", { n: span[1] - span[0] + 1 }), icon: ic(Trash2), danger: true, run: () => onDeleteRows(view.slice(span[0], span[1] + 1).map((v) => v.row.id)) });
        out.push({ label: t("Clear row"), icon: ic(Eraser), run: clearSelection });
        out.push({ label: span[0] === span[1] ? t("Hide row {n}", { n: rawN }) : t("Hide {n} rows", { n: span[1] - span[0] + 1 }), icon: ic(EyeOff), run: () => hideRows(span[0], span[1]) });
        out.push({
          label: t("Resize row"), icon: ic(MoveVertical), run: () => {
            const h = window.prompt(t("Row height in pixels:"), String(row.height ?? ROW_H_DEFAULT));
            const n = Number(h);
            if (h !== null && Number.isFinite(n)) onResizeRow(row.id, Math.round(Math.max(ROW_H_MIN, Math.min(ROW_H_MAX, n))));
          },
        });
        if (row.height != null) out.push({ label: t("Default height"), icon: ic(RotateCcw), run: () => onResizeRow(row.id, null) });
        const rawIdx = view[menu.r]?.rawIndex ?? 0;
        out.push(frozenRowsSetting === rawIdx + 1
          ? { label: t("Unfreeze rows"), icon: ic(Snowflake), run: () => setFrozenRows(0) }
          : { label: t("Freeze up to row {n}", { n: rawIdx + 1 }), icon: ic(Snowflake), disabled: rawIdx >= 20, run: () => setFrozenRows(rawIdx + 1) });
      }
      return out;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, view, columns, rect, canEdit, canManage, clipSelection, clearSelection, applyPaste, t, sort, filters, frozenCols, frozenRowsSetting, settings]);

  // ── Keyboard ────────────────────────────────────────────────────────────────────────────────
  const filledAt = (r: number, c: number) => {
    const row = view[r]?.row;
    const col = columns[c];
    if (!row || !col) return false;
    const v = row.cells[col.id];
    return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length);
  };
  /** Ctrl/Cmd+Arrow: to the far edge of a filled block, else to the next filled cell, else the sheet edge. */
  const jump = (r: number, c: number, dr: number, dc: number) => {
    const inside = (y: number, x: number) => y >= 0 && y <= maxR && x >= 0 && x <= maxC;
    let nr = r + dr, nc = c + dc;
    if (!inside(nr, nc)) return { r, c };
    if (filledAt(r, c) && filledAt(nr, nc)) {
      while (inside(nr + dr, nc + dc) && filledAt(nr + dr, nc + dc)) { nr += dr; nc += dc; }
      return { r: nr, c: nc };
    }
    while (!filledAt(nr, nc)) {
      if (!inside(nr + dr, nc + dc)) return { r: nr, c: nc };
      nr += dr; nc += dc;
    }
    return { r: nr, c: nc };
  };
  const lastFilled = () => {
    let r2 = 0, c2 = 0;
    view.forEach(({ row }, r) => columns.forEach((col, c) => {
      const v = row.cells[col.id];
      if (v !== undefined && v !== null && v !== "") { r2 = Math.max(r2, r); c2 = Math.max(c2, c); }
    }));
    return { r: r2, c: c2 };
  };
  const goTo = (r: number, c: number, extend: boolean) => {
    const p = clamp(r, c);
    setSel((s) => (extend ? { ...s, r2: p.r, c2: p.c } : { r: p.r, c: p.c, r2: p.r, c2: p.c }));
  };
  /** Column a run of Tabs started in: Enter after Tab, Tab, Tab returns there on the next row. */
  const tabRun = useRef<number | null>(null);
  const pageRows = Math.max(1, Math.floor((scroll.height / zoom - headH) / ROW_H_DEFAULT) - 1);
  // Read through a ref: Row is memoised and may hold an older closure of this function.
  const selRef = useRef(sel);
  selRef.current = sel;
  const afterCommit = (next: Next) => {
    const s = selRef.current;
    if (next === "right") {
      if (tabRun.current === null) tabRun.current = s.c;
      move(0, 1, false);
      return;
    }
    if (next === "down" && tabRun.current !== null) {
      const c = tabRun.current;
      tabRun.current = null;
      goTo(s.r + 1, c, false);
      return;
    }
    tabRun.current = null;
    if (next === "down") move(1, 0, false);
    if (next === "up") move(-1, 0, false);
    if (next === "left") move(0, -1, false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return; // the input owns the keyboard while editing
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.altKey && e.code === "KeyM") { e.preventDefault(); openCommentsAt(sel.r, sel.c); return; }
    // Formatting shortcuts (Sheets' own).
    if (meta && !e.altKey && canEdit) {
      const k = e.key.toLowerCase();
      if (k === "b") { e.preventDefault(); applyStyle({ b: activeStyle?.b ? null : 1 }); return; }
      if (k === "i") { e.preventDefault(); applyStyle({ i: activeStyle?.i ? null : 1 }); return; }
      if (k === "u") { e.preventDefault(); applyStyle({ u: activeStyle?.u ? null : 1 }); return; }
      if (k === "\\") { e.preventDefault(); clearFormat(); return; }
      if (k === "k") { e.preventDefault(); insertLink(); return; }
    }
    if (e.altKey && e.shiftKey && e.code === "Digit5" && canEdit) { e.preventDefault(); applyStyle({ s: activeStyle?.s ? null : 1 }); return; }
    if (e.key === " " && meta) { e.preventDefault(); selectColumns(rect.left, rect.right); return; }
    if (e.key === " " && e.shiftKey) { e.preventDefault(); selectRows(rect.top, rect.bottom); return; }
    const from = e.shiftKey ? { r: sel.r2, c: sel.c2 } : { r: sel.r, c: sel.c };
    const arrow = (dr: number, dc: number) => {
      e.preventDefault();
      tabRun.current = null;
      if (meta) { const p = jump(from.r, from.c, dr, dc); goTo(p.r, p.c, e.shiftKey); return; }
      move(dr, dc, e.shiftKey);
    };
    switch (e.key) {
      case "ArrowUp": return arrow(-1, 0);
      case "ArrowDown": return arrow(1, 0);
      case "ArrowLeft": return arrow(0, -1);
      case "ArrowRight": return arrow(0, 1);
      case "Home": e.preventDefault(); tabRun.current = null; return goTo(meta ? 0 : from.r, 0, e.shiftKey);
      case "End": {
        e.preventDefault(); tabRun.current = null;
        if (meta) { const p = lastFilled(); return goTo(p.r, p.c, e.shiftKey); }
        return goTo(from.r, maxC, e.shiftKey);
      }
      case "PageDown": e.preventDefault(); tabRun.current = null; return goTo(from.r + pageRows, from.c, e.shiftKey);
      case "PageUp": e.preventDefault(); tabRun.current = null; return goTo(from.r - pageRows, from.c, e.shiftKey);
      case "Tab":
        e.preventDefault();
        if (!e.shiftKey && tabRun.current === null) tabRun.current = sel.c;
        return move(0, e.shiftKey ? -1 : 1, false);
      case "Enter":
      case "F2": {
        e.preventDefault();
        if (e.key === "Enter" && tabRun.current !== null && !e.shiftKey) {
          const c = tabRun.current;
          tabRun.current = null;
          return goTo(sel.r + 1, c, false);
        }
        if (!canEdit) return;
        if (activeRow && activeCol) setEditing({ rowId: activeRow.id, colId: activeCol.id });
        return;
      }
      case "Escape": return setSel((s) => ({ ...s, r2: s.r, c2: s.c }));
      case "Delete":
      case "Backspace": e.preventDefault(); return clearSelection();
      case "a": if (meta) { e.preventDefault(); setSel({ r: 0, c: 0, r2: maxR, c2: maxC }); } return;
      case "f": if (meta) { e.preventDefault(); setFindOpen(true); } return;
      default: break;
    }
    // Any printable character starts editing and REPLACES the cell (F2 / double-click append instead).
    if (!meta && !e.altKey && e.key.length === 1 && canEdit && activeRow && activeCol) {
      e.preventDefault();
      setEditing({ rowId: activeRow.id, colId: activeCol.id, seed: e.key });
    }
  };

  useEffect(() => {
    const up = () => {
      if (filling.current && fillTo) applyFill(fillTo);
      filling.current = false;
      setFillTo(null);
      dragging.current = false;
      refSpan.current = null;
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [applyFill, fillTo]);

  // ── Find & replace ──────────────────────────────────────────────────────────────────────────
  const findHits = useMemo(() => {
    if (!find.q.trim()) return [] as { r: number; c: number }[];
    const needle = find.matchCase ? find.q : find.q.toLowerCase();
    const out: { r: number; c: number }[] = [];
    view.forEach(({ row }, r) => {
      columns.forEach((col, c) => {
        const raw = row.cells[col.id];
        // What the cell SHOWS (a formula's result, a link's label), like Sheets does by default.
        const text = isFormula(raw) ? displayCell(col.type, raw, { data, rowId: row.id, colId: col.id }) : editValue(col.type, raw);
        const hay = find.matchCase ? text : text.toLowerCase();
        if (text && hay.includes(needle)) out.push({ r, c });
      });
    });
    return out;
  }, [find, view, columns, data]);

  const replaceAll = useCallback(() => {
    if (!canEdit || !find.q.trim()) return;
    const edits: { rowId: string; values: Record<string, unknown> }[] = [];
    for (const hit of findHits) {
      const row = view[hit.r]?.row;
      const col = columns[hit.c];
      if (!row || !col) continue;
      const raw = row.cells[col.id];
      // Formula cells are skipped: replacing text inside a stored formula would rewrite references.
      if (isFormula(raw)) continue;
      const text = editValue(col.type, raw);
      const replaced = find.matchCase
        ? text.split(find.q).join(find.to)
        : text.replace(new RegExp(find.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), find.to);
      if (replaced === text) continue;
      const next = isLinkCell(raw) ? (replaced.trim() ? { t: replaced, u: raw.u } : null) : inputToCell(col, replaced, data.shape, raw);
      const entry = edits.find((e) => e.rowId === row.id) ?? (() => {
        const fresh = { rowId: row.id, values: {} as Record<string, unknown> };
        edits.push(fresh);
        return fresh;
      })();
      entry.values[col.id] = next;
    }
    if (edits.length) onSetCells(edits);
    return edits.length;
  }, [canEdit, find, findHits, view, columns, onSetCells, data.shape]);

  // ── Status bar: Sum / Average / Count of the selection ──────────────────────────────────────
  const stats = useMemo(() => {
    let sum = 0, n = 0, filled = 0, min = Infinity, max = -Infinity, cells = 0;
    for (let r = rect.top; r <= rect.bottom && cells < 200_000; r += 1) {
      const row = view[r]?.row;
      if (!row) continue;
      for (let c = rect.left; c <= rect.right; c += 1) {
        const col = columns[c];
        if (!col) continue;
        cells += 1;
        const v = engine.value(row.id, col.id);
        if (v === null || v === "" || isError(v)) continue;
        filled += 1;
        if (typeof v === "number") { sum += v; n += 1; min = Math.min(min, v); max = Math.max(max, v); }
      }
    }
    return { sum, avg: n ? sum / n : 0, count: filled, countNum: n, min: n ? min : 0, max: n ? max : 0, cells };
  }, [rect, view, columns, engine]);
  const statFormat = useMemo(() => {
    // Totals read like the column they come from: Rupiah stays Rupiah.
    const col = columns[rect.left];
    const row = view[rect.top]?.row;
    const st = row && col ? row.styles?.[col.id] : undefined;
    const nf = row && col ? engine.format(row.id, col.id) : null;
    return (v: number) => formatWithStyle(v, st?.nf, st?.dp, nf ?? (col?.type === "currency" ? "idr" : null))
      ?? formatResult(col?.type === "currency" ? "currency" : "number", v, nf === "date" ? null : nf);
  }, [columns, rect.left, rect.top, view, engine]);
  const statLabel: Record<Stat, string> = {
    sum: t("Sum"), avg: t("Average"), count: t("Count"), countNum: t("Count numbers"), min: t("Min"), max: t("Max"),
  };
  const statValue = (s: Stat) => (s === "count" || s === "countNum" ? String(stats[s]) : statFormat(stats[s]));
  const multiCell = stats.cells > 1;

  /** Name Box text: the active cell, or the selected range. */
  const nameBox = useMemo(() => {
    const a = (r: number, c: number) => `${colLetter(c)}${(view[r]?.rawIndex ?? r) + 1}`;
    if (rect.top === 0 && rect.bottom === maxR && rect.left === rect.right && maxR > 0) return `${colLetter(rect.left)}:${colLetter(rect.left)}`;
    return rect.top === rect.bottom && rect.left === rect.right ? a(rect.top, rect.left) : `${a(rect.top, rect.left)}:${a(rect.bottom, rect.right)}`;
  }, [rect, view, maxR]);
  /** Typing "B12" or "A1:C9" (or "C:C") in the Name Box selects it. */
  const jumpTo = (text: string) => {
    const s = text.trim().toUpperCase().replace(/\$/g, "");
    const viewOf = (raw: number) => view.findIndex((v) => v.rawIndex === raw);
    let m = /^([A-Z]{1,3}):([A-Z]{1,3})$/.exec(s);
    if (m) { selectColumns(letterToIndex(m[1]), letterToIndex(m[2])); return true; }
    m = /^([A-Z]{1,3})(\d+)(?::([A-Z]{1,3})(\d+))?$/.exec(s);
    if (!m) return false;
    const r1 = viewOf(Number(m[2]) - 1), c1 = letterToIndex(m[1]);
    const r2 = m[3] ? viewOf(Number(m[4]) - 1) : r1, c2 = m[3] ? letterToIndex(m[3]) : c1;
    if (r1 < 0 || r2 < 0 || c1 > maxC || c2 > maxC) return false;
    setSel({ r: r1, c: c1, r2, c2 });
    return true;
  };

  /** Raw ids of hidden columns right before column c (for the unhide arrows). */
  const hiddenBefore = (c: number) => {
    const ids: string[] = [];
    for (let i = c - 1; i >= 0 && colHidden(i); i -= 1) ids.push(columns[i].id);
    return ids;
  };
  const hiddenRowsBefore = useMemo(() => {
    const out = new Map<string, string[]>();
    if (!hiddenRows.size) return out;
    let block: string[] = [];
    for (const row of rows) {
      if (hiddenRows.has(row.id)) { block.push(row.id); continue; }
      if (block.length) { out.set(row.id, block); block = []; }
    }
    return out;
  }, [rows, hiddenRows]);

  const colFrozenStyle = (c: number, z: number): CSSProperties =>
    c < frozenCols ? { position: "sticky", left: lefts[c], zIndex: z } : {};

  return (
    <>
    <div className="space-y-1.5">
      <SheetToolbar
        canEdit={canEdit}
        style={activeStyle}
        onStyle={applyStyle}
        onBorders={applyBorders}
        onClearFormat={clearFormat}
        onDecimals={changeDecimals}
        zoom={zoom}
        onZoom={setZoom}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
        merged={mergedHere.length > 0}
        canMerge={canMerge}
        onMerge={toggleMerge}
        onLink={insertLink}
        onComment={() => openCommentsAt(sel.r, sel.c)}
        filterOn={Boolean(activeCol && (filters[activeCol.id] || filterOpen[activeCol.id]))}
        onFilter={() => {
          if (!activeCol) return;
          const on = Boolean(filters[activeCol.id] || filterOpen[activeCol.id]);
          setFilterOpen((f) => ({ ...f, [activeCol.id]: !on }));
          if (on) setFilters((f) => ({ ...f, [activeCol.id]: "" }));
        }}
        onFunction={insertFunction}
        onFind={() => setFindOpen((o) => !o)}
      />

      {findOpen && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-2 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus value={find.q} onChange={(e) => setFind((f) => ({ ...f, q: e.target.value }))}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") setFindOpen(false);
              if (e.key === "Enter" && findHits.length) {
                const at = findHits.findIndex((h) => h.r === sel.r && h.c === sel.c);
                const next = findHits[(at + 1) % findHits.length];
                setSel({ r: next.r, c: next.c, r2: next.r, c2: next.c });
              }
            }}
            placeholder={t("Find…")} aria-label={t("Find")}
            className="w-40 rounded-md border border-border bg-background px-2 py-0.5 text-xs outline-none focus:border-ring"
          />
          {canEdit && (
            <>
              <Replace className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                value={find.to} onChange={(e) => setFind((f) => ({ ...f, to: e.target.value }))}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder={t("Replace with…")} aria-label={t("Replace with")}
                className="w-40 rounded-md border border-border bg-background px-2 py-0.5 text-xs outline-none focus:border-ring"
              />
              <button
                onClick={() => { const n = replaceAll(); if (typeof n === "number") alert(n ? t("{n} rows changed.", { n }) : t("No matches.")); }}
                className="rounded-md bg-primary px-2 py-1 text-2xs font-semibold text-primary-foreground"
              >{t("Replace all")}</button>
            </>
          )}
          <label className="flex items-center gap-1 text-2xs text-muted-foreground">
            <input type="checkbox" checked={find.matchCase} onChange={(e) => setFind((f) => ({ ...f, matchCase: e.target.checked }))} className="h-3 w-3 accent-primary" />
            {t("Match case")}
          </label>
          <span className="text-2xs tabular-nums text-muted-foreground">{find.q.trim() ? t("{n} found", { n: findHits.length }) : ""}</span>
          <button onClick={() => setFindOpen(false)} aria-label={t("Close")} className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Name Box + formula bar. The Name Box shows the selection and jumps when you type an address. */}
      <div className="flex items-stretch overflow-hidden rounded-xl border border-border bg-card">
        <input
          key={nameBox}
          defaultValue={nameBox}
          aria-label={t("Name box")}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              if (!jumpTo((e.target as HTMLInputElement).value)) (e.target as HTMLInputElement).value = nameBox;
              gridRef.current?.focus();
            }
            if (e.key === "Escape") { (e.target as HTMLInputElement).value = nameBox; gridRef.current?.focus(); }
          }}
          className="w-24 shrink-0 border-r border-border bg-transparent px-2 py-1 font-mono text-xs tabular-nums outline-none focus:bg-muted/50"
        />
        <span className="grid shrink-0 place-items-center border-r border-border px-2 font-serif text-xs italic text-muted-foreground">fx</span>
        <input
          key={`${activeRow?.id}:${activeCol?.id}:${JSON.stringify(activeRaw ?? "")}`}
          defaultValue={isFormula(activeRaw) ? editFormula(activeRaw, data.shape) ?? "" : editValue(activeCol?.type ?? "text", activeRaw)}
          readOnly={!canEdit}
          aria-label={t("Formula bar")}
          placeholder={canEdit ? t("Type a value or a formula…") : ""}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && activeRow && activeCol) {
              commit(activeRow.id, activeCol.id, (e.target as HTMLInputElement).value);
              gridRef.current?.focus();
            }
            if (e.key === "Escape") { (e.target as HTMLInputElement).blur(); gridRef.current?.focus(); }
          }}
          onBlur={(e) => { if (activeRow && activeCol) commit(activeRow.id, activeCol.id, e.target.value); }}
          className="min-w-0 flex-1 select-text bg-transparent px-2 py-1 font-mono text-xs outline-none"
        />
        {activeCol && (activeCol.name || activeCol.type !== "text") && (
          <span className="hidden shrink-0 items-center border-l border-border px-2 text-2xs text-muted-foreground sm:flex">
            {activeCol.name || colLetter(sel.c)} · {t(COLUMN_TYPE_LABEL[activeCol.type])}
          </span>
        )}
        <button
          onClick={() => openCommentsAt(sel.r, sel.c)}
          title={t("Comment on this cell (Ctrl+Alt+M)")}
          aria-label={t("Comment on this cell (Ctrl+Alt+M)")}
          className="relative grid w-8 shrink-0 place-items-center border-l border-border text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {activeRow && activeCol && (commentCounts[`${activeRow.id}:${activeCol.id}`] ?? 0) > 0 && (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
          )}
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div
          ref={gridRef}
          tabIndex={0}
          role="grid"
          aria-label={t("Spreadsheet")}
          aria-rowcount={rows.length}
          aria-colcount={columns.length}
          onKeyDown={onKeyDown}
          onCopy={(e) => { if (!editing) { e.preventDefault(); writeClipboardEvent(e, clipSelection(false)); } }}
          onCut={(e) => {
            if (editing || !canEdit) return;
            e.preventDefault();
            writeClipboardEvent(e, clipSelection(true));
            clearSelection();
          }}
          onPaste={(e) => {
            if (editing) return;
            const block = readClipboard(e.clipboardData);
            if (!block) return;
            e.preventDefault();
            void applyPaste(block);
          }}
          onScroll={syncScroll}
          // select-none: dragging across cells is a RANGE selection, not a text selection.
          className="sheet-scroll relative h-[calc(100vh-21rem)] min-h-[320px] select-none overflow-auto outline-none [scrollbar-color:var(--border)_transparent]"
        >
          <table
            className="border-separate border-spacing-0 text-[13px] text-foreground"
            style={{ tableLayout: "fixed", width: tableWidth, zoom } as CSSProperties}
          >
            <colgroup>
              <col style={{ width: GUTTER_W }} />
              {widths.map((w, i) => <col key={columns[i].id} style={{ width: w }} />)}
              <col style={{ width: ADD_COL_W }} />
            </colgroup>
            <thead>
              <tr style={{ height: HEAD_H }}>
                {/* Select-all corner, with the two freeze handles (drag them, like Sheets' grey bars). */}
                <th
                  onClick={() => setSel({ r: 0, c: 0, r2: maxR, c2: maxC })}
                  title={t("Select all (Ctrl+A)")}
                  rowSpan={showLabels ? 2 : 1}
                  className="sticky left-0 top-0 z-40 cursor-pointer border-b border-r border-border bg-muted p-0 hover:bg-secondary"
                >
                  <span aria-hidden className="absolute bottom-1 right-1 h-0 w-0 border-b-[7px] border-l-[7px] border-b-muted-foreground/40 border-l-transparent" />
                  {canEdit && (
                    <>
                      <span
                        onMouseDown={startFreezeDrag("row")}
                        onClick={(e) => e.stopPropagation()}
                        title={t("Drag to freeze rows")}
                        className="absolute bottom-0 left-0 h-[4px] w-full cursor-row-resize bg-muted-foreground/30 hover:bg-info"
                      />
                      <span
                        onMouseDown={startFreezeDrag("col")}
                        onClick={(e) => e.stopPropagation()}
                        title={t("Drag to freeze columns")}
                        className="absolute right-0 top-0 h-full w-[4px] cursor-col-resize bg-muted-foreground/30 hover:bg-info"
                      />
                    </>
                  )}
                </th>
                {columns.map((col, ci) => {
                  const active = ci >= rect.left && ci <= rect.right;
                  const whole = active && rect.top === 0 && rect.bottom === maxR;
                  const hidden = colHidden(ci);
                  const before = hidden ? [] : hiddenBefore(ci);
                  const freezeEdge = (freezeDrag?.axis === "col" ? freezeDrag.n : frozenCols) === ci + 1;
                  return (
                    <ColumnHeader
                      key={col.id}
                      index={ci}
                      col={col}
                      hidden={hidden}
                      active={active}
                      whole={whole}
                      canEdit={canEdit}
                      showMarks={!showLabels}
                      sortDir={sort?.colId === col.id ? sort.dir : null}
                      filtered={Boolean(filters[col.id])}
                      hiddenBefore={before}
                      onUnhide={() => unhideCols(before)}
                      style={{ ...colFrozenStyle(ci, 31), top: 0, ...(freezeEdge ? { boxShadow: `inset -3px 0 0 0 ${FREEZE_LINE}` } : {}) }}
                      onSelect={(extend) => {
                        tabRun.current = null;
                        if (extend) setSel((s) => ({ r: 0, c: s.c, r2: maxR, c2: ci }));
                        else selectColumns(ci, ci);
                      }}
                      onMenu={(at) => {
                        if (!(ci >= rect.left && ci <= rect.right && rect.top === 0 && rect.bottom === maxR)) selectColumns(ci, ci);
                        setMenu({ kind: "col", r: 0, c: ci, ...at });
                      }}
                      onResize={(width) => onEditColumn(col.id, { width })}
                      onAutofit={() => autofit(ci)}
                    />
                  );
                })}
                <th rowSpan={showLabels ? 2 : 1} className="sticky top-0 z-30 border-b border-border bg-muted p-0">
                  {canEdit && (
                    <button onClick={onAddColumn} title={t("Add column")} aria-label={t("Add column")}
                      className="mx-auto grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition hover:bg-background hover:text-foreground">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </th>
              </tr>
              {showLabels && (
                <tr style={{ height: LABEL_H }}>
                  {columns.map((col, ci) => (
                    <ColumnLabel
                      key={col.id}
                      col={col}
                      index={ci}
                      hidden={colHidden(ci)}
                      active={ci >= rect.left && ci <= rect.right}
                      canEdit={canEdit}
                      sortDir={sort?.colId === col.id ? sort.dir : null}
                      filterValue={filters[col.id] ?? ""}
                      filterOpen={Boolean(filterOpen[col.id])}
                      onFilter={(q) => setFilters((f) => ({ ...f, [col.id]: q }))}
                      onCloseFilter={() => { setFilters((f) => ({ ...f, [col.id]: "" })); setFilterOpen((f) => ({ ...f, [col.id]: false })); }}
                      style={{ ...colFrozenStyle(ci, 31), top: HEAD_H, ...((freezeDrag?.axis === "col" ? freezeDrag.n : frozenCols) === ci + 1 ? { boxShadow: `inset -3px 0 0 0 ${FREEZE_LINE}` } : {}) }}
                      onOpenSettings={() => openColumnSettings(ci)}
                      onMenu={(at) => { selectColumns(ci, ci); setMenu({ kind: "col", r: 0, c: ci, ...at }); }}
                    />
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {[...view.slice(0, frozenRows).map((v, i) => ({ ...v, ri: i })),
                ...(winFirst > frozenRows ? [null] : []),
                ...view.slice(winFirst, winLast).map((v, k) => ({ ...v, ri: winFirst + k }))].map((item) => {
                if (!item) {
                  // Spacer holding open the rows scrolled off the top.
                  return (
                    <tr key="spacer-top" style={{ height: offsets[winFirst] - offsets[frozenRows] }} aria-hidden>
                      <td colSpan={columns.length + 2} className="p-0" />
                    </tr>
                  );
                }
                const { row, rawIndex, ri } = item;
                const frozen = ri < frozenRows;
                const freezeRowEdge = (freezeDrag?.axis === "row" ? freezeDrag.n : frozenRowsSetting) === rawIndex + 1;
                return (
                  <Row
                    key={row.id}
                    row={row}
                    rowIndex={ri}
                    rawIndex={rawIndex}
                    columns={columns}
                    widthsKey={widths}
                    lefts={lefts}
                    frozenCols={frozenCols}
                    stickyTop={frozen ? headH + offsets[ri] : null}
                    freezeEdge={freezeRowEdge}
                    hiddenCols={hiddenCols}
                    unhideRows={hiddenRowsBefore.get(row.id) ?? null}
                    onUnhideRows={unhideRows}
                    merges={merges}
                    selected={ri >= rect.top && ri <= rect.bottom}
                    rowSelected={ri >= rect.top && ri <= rect.bottom && rect.left === 0 && rect.right === maxC}
                    rect={rect}
                    activeC={ri === sel.r ? sel.c : -1}
                    editing={editing}
                    canEdit={canEdit}
                    data={data}
                    lang={lang}
                    refMode={refMode}
                    refRects={refRects}
                    onPickRef={(c) => {
                      // Addresses always speak the UNDERLYING row, so a reference picked while the view
                      // is sorted still points at the row that was clicked.
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
                    peerCursors={peerCursors}
                    onResizeRow={(height) => onResizeRow(row.id, height)}
                    showFillHandle={canEdit && ri === rect.bottom}
                    fillRect={fillPreviewRect}
                    onFillStart={() => { filling.current = true; setFillTo({ r: ri, c: rect.right }); }}
                    onFillOver={(ci) => { if (filling.current) setFillTo({ r: ri, c: ci }); }}
                    onSelect={(c, extend) => { tabRun.current = null; setSel((s) => (extend ? { ...s, r2: ri, c2: c } : { r: ri, c, r2: ri, c2: c })); }}
                    onDragOver={(c) => { if (dragging.current) setSel((s) => ({ ...s, r2: ri, c2: c })); }}
                    onStartDrag={(c) => { tabRun.current = null; dragging.current = true; setSel({ r: ri, c, r2: ri, c2: c }); }}
                    onSelectRow={(extend) => {
                      tabRun.current = null;
                      if (extend) setSel((s) => ({ r: s.r, c: 0, r2: ri, c2: maxC }));
                      else selectRows(ri, ri);
                    }}
                    onEdit={(colId) => setEditing({ rowId: row.id, colId })}
                    onCommit={(colId, raw, next) => {
                      commit(row.id, colId, raw);
                      setEditing(null);
                      gridRef.current?.focus();
                      afterCommit(next);
                    }}
                    onCancel={() => { setEditing(null); gridRef.current?.focus(); }}
                    onRowMenu={(at) => {
                      if (!(ri >= rect.top && ri <= rect.bottom && rect.left === 0 && rect.right === maxC)) selectRows(ri, ri);
                      setMenu({ kind: "row", r: ri, c: 0, ...at });
                    }}
                    onCellMenu={(ci, at) => setMenu({ kind: "cell", r: ri, c: ci, ...at })}
                    dragging={dragRow === row.id}
                    dropTarget={dropRow === row.id}
                    onDragStart={() => setDragRow(row.id)}
                    onDragOverRow={() => { if (dragRow && dragRow !== row.id) setDropRow(row.id); }}
                    onDrop={() => {
                      if (dragRow && dragRow !== row.id) {
                        // Dropping ON a row means "land right after it", except at the very top.
                        const targetIndex = rows.findIndex((r) => r.id === row.id);
                        const sourceIndex = rows.findIndex((r) => r.id === dragRow);
                        onReorderRow(dragRow, targetIndex === 0 && sourceIndex > 0 ? null : row.id);
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
          </table>

          {canEdit && (
            <div className="sticky left-0 flex items-center gap-2 px-2 py-3" style={{ zoom } as CSSProperties}>
              <button onClick={() => void onAddRows({ count: 1 })}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground">
                <Plus className="h-3.5 w-3.5" /> {t("Add 1 row")}
              </button>
              <button onClick={() => void onAddRows({ count: 100 })}
                className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground">
                {t("Add 100 rows")}
              </button>
            </div>
          )}
        </div>

        {/* Bottom bar: sheet tabs on the left, the selection's statistics on the right. */}
        <div className="flex min-h-9 items-center gap-2 border-t border-border bg-muted/60 px-1.5">
          <div className="min-w-0 flex-1">{footerLeft}</div>
          {saving && <span className="shrink-0 text-2xs text-muted-foreground">{t("Saving…")}</span>}
          {multiCell && stats.count > 0 && (
            <Menu
              label={t("Selection statistics")}
              trigger={
                <span className="max-w-[220px] truncate text-xs tabular-nums">
                  <span className="text-muted-foreground">{statLabel[stat]}:</span> <span className="font-medium">{statValue(stat)}</span>
                </span>
              }
            >
              {(close) => (Object.keys(statLabel) as Stat[]).map((s) => (
                <MenuItem key={s} active={stat === s} hint={statValue(s)} onClick={() => { setStat(s); close(); }}>{statLabel[s]}</MenuItem>
              ))}
            </Menu>
          )}
        </div>
      </div>
    </div>

    {/* Right-click menus (cell, column header, row header). Only entries this grid can honour. */}
    {menu && menuEntries.length > 0 && createPortal(
      <>
        <div className="fixed inset-0 z-[60]" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
        <div
          role="menu"
          style={{ left: Math.min(menu.left, window.innerWidth - 250), top: Math.max(8, Math.min(menu.top, window.innerHeight - 440)) }}
          className="fixed z-[61] max-h-[80vh] w-60 overflow-y-auto rounded-xl border border-border bg-popover py-1 text-popover-foreground shadow-pop"
        >
          {menuEntries.map((item, i) =>
            item === "sep" ? (
              <div key={`sep${i}`} className="my-1 border-t border-border" />
            ) : (
              <MenuItem key={`${item.label}${i}`} icon={item.icon} hint={item.hint} danger={item.danger} disabled={item.disabled}
                onClick={() => { setMenu(null); item.run(); }}>
                {item.label}
              </MenuItem>
            ),
          )}
        </div>
      </>,
      document.body,
    )}

    {colPopover && (() => {
      const col = columns.find((c) => c.id === colPopover.colId);
      return col ? (
        <ColumnPopover
          col={col}
          anchor={colPopover.anchor}
          onClose={() => setColPopover(null)}
          onSave={(patch) => { onEditColumn(col.id, patch); setColPopover(null); }}
        />
      ) : null;
    })()}
    </>
  );
}

/** A lettered column header: click selects the column, the right edge resizes (double-click fits). */
function ColumnHeader({ index, col, hidden, active, whole, canEdit, showMarks, sortDir, filtered, hiddenBefore, onUnhide, style, onSelect, onMenu, onResize, onAutofit }: {
  index: number; col: NexusSheetColumn; hidden: boolean; active: boolean; whole: boolean; canEdit: boolean;
  /** Sort/filter marks go here when there is no name row to carry them. */
  showMarks: boolean;
  sortDir: "asc" | "desc" | null; filtered: boolean;
  hiddenBefore: string[]; onUnhide: () => void;
  style: CSSProperties;
  onSelect: (extend: boolean) => void;
  onMenu: (at: { left: number; top: number }) => void;
  onResize: (width: number) => void;
  onAutofit: () => void;
}) {
  const { t } = useLang();
  const ref = useRef<HTMLTableCellElement>(null);
  /** Width applied live to the DOM, SAVED on mouseup: one PATCH and one undo entry per resize. */
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const table = ref.current?.closest("table");
    const colEl = table?.querySelectorAll("col")[index + 1] as HTMLElement | undefined;
    const startW = ref.current?.offsetWidth ?? col.width ?? COL_W_DEFAULT;
    let latest = startW;
    const z = Number((table?.style as CSSStyleDeclaration & { zoom?: string })?.zoom) || 1;
    const move = (ev: MouseEvent) => {
      latest = Math.max(30, Math.min(600, startW + (ev.clientX - startX) / z));
      if (colEl) colEl.style.width = `${latest}px`;
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (Math.round(latest) !== Math.round(startW)) onResize(Math.round(latest));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  if (hidden) return <th data-col-index={index} style={style} className="sticky top-0 z-30 overflow-hidden border-b border-border bg-muted p-0" />;
  return (
    <th
      ref={ref}
      data-col-index={index}
      scope="col"
      style={style}
      onMouseDown={(e) => { if (e.button === 0) onSelect(e.shiftKey); }}
      onContextMenu={(e) => { e.preventDefault(); onMenu({ left: e.clientX, top: e.clientY }); }}
      className={cn(
        "group sticky top-0 z-30 cursor-default select-none border-b border-r border-border p-0 text-center text-[11px] font-medium tabular-nums",
        whole ? "bg-info text-info-foreground" : active ? `${HEAD_SEL_BG} text-foreground` : "bg-muted text-muted-foreground",
      )}
    >
      <span className="flex items-center justify-center gap-1 px-1">
        {colLetter(index)}
        {showMarks && sortDir && (sortDir === "desc" ? <ArrowUpAZ className="h-3 w-3" /> : <ArrowDownAZ className="h-3 w-3" />)}
        {showMarks && filtered && <Filter className="h-3 w-3" />}
      </span>
      {hiddenBefore.length > 0 && (
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onUnhide(); }}
          title={t("Show {n} hidden columns", { n: hiddenBefore.length })}
          aria-label={t("Show {n} hidden columns", { n: hiddenBefore.length })}
          className="absolute -left-2 top-1/2 z-10 flex h-4 -translate-y-1/2 items-center rounded-sm border border-border bg-card px-0.5 text-muted-foreground shadow-soft hover:text-foreground"
        >
          <ChevronDown className="h-2.5 w-2.5 rotate-90" /><ChevronDown className="-ml-1 h-2.5 w-2.5 -rotate-90" />
        </button>
      )}
      {canEdit && (
        <span
          onMouseDown={startResize}
          onDoubleClick={(e) => { e.stopPropagation(); onAutofit(); }}
          title={t("Drag to resize · double-click to fit")}
          className="absolute -right-[3px] top-0 z-20 h-full w-[6px] cursor-col-resize hover:bg-info/60"
        />
      )}
    </th>
  );
}

/** The slim row under the letters: the column's name and type (NEXUS's typed columns), sort/filter marks. */
function ColumnLabel({ col, index, hidden, active, canEdit, sortDir, filterValue, filterOpen, onFilter, onCloseFilter, style, onOpenSettings, onMenu }: {
  col: NexusSheetColumn; index: number; hidden: boolean; active: boolean; canEdit: boolean;
  sortDir: "asc" | "desc" | null; filterValue: string; filterOpen: boolean;
  onFilter: (q: string) => void; onCloseFilter: () => void;
  style: CSSProperties;
  onOpenSettings: () => void;
  onMenu: (at: { left: number; top: number }) => void;
}) {
  const { t } = useLang();
  if (hidden) return <th style={style} className="sticky z-30 overflow-hidden border-b border-border bg-muted p-0" />;
  const showFilter = filterOpen || Boolean(filterValue);
  return (
    <th
      data-col-index={index}
      scope="col"
      style={style}
      onDoubleClick={() => canEdit && onOpenSettings()}
      onContextMenu={(e) => { e.preventDefault(); onMenu({ left: e.clientX, top: e.clientY }); }}
      className={cn(
        "sticky z-30 border-b border-r border-border px-1.5 py-0 text-left text-xs font-semibold",
        active ? LABEL_SEL_BG : col.color ? COLUMN_COLOR_CLASS[col.color] : "bg-card",
      )}
    >
      {showFilter ? (
        <span className="flex items-center gap-1">
          <Filter className="h-3 w-3 shrink-0 text-info" />
          <input
            autoFocus={filterOpen && !filterValue}
            value={filterValue}
            onChange={(e) => onFilter(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onCloseFilter(); }}
            placeholder={t("filter…")}
            aria-label={t("Filter {c}", { c: col.name || colLetter(index) })}
            className="h-5 min-w-0 flex-1 rounded border border-border bg-background px-1 text-[11px] font-normal outline-none focus:border-ring"
          />
          <button onClick={onCloseFilter} aria-label={t("Remove filter")} className="shrink-0 text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <TypeIcon type={col.type} />
          <button
            onClick={() => canEdit && onOpenSettings()}
            title={canEdit ? t("Column settings: name, type, choices, colours, rules") : undefined}
            className={cn("min-w-0 flex-1 truncate text-left", !col.name && "font-normal text-muted-foreground/60")}
          >
            {col.name || (col.type === "text" ? "" : t(COLUMN_TYPE_LABEL[col.type]))}
          </button>
          {sortDir && <span className="shrink-0 text-info" title={sortDir === "asc" ? t("Sorted A → Z") : t("Sorted Z → A")}>{sortDir === "desc" ? <ArrowUpAZ className="h-3 w-3" /> : <ArrowDownAZ className="h-3 w-3" />}</span>}
        </span>
      )}
    </th>
  );
}

/** The column type, as a small lucide icon beside the name (Rupiah reads as the letters it shows). */
function TypeIcon({ type }: { type: NexusSheetColumnType }) {
  const cls = "h-3 w-3 shrink-0 text-muted-foreground";
  switch (type) {
    case "number": return <Hash className={cls} />;
    case "currency": return <span className="shrink-0 text-[9px] font-bold text-muted-foreground">Rp</span>;
    case "date": return <CalendarDays className={cls} />;
    case "select": return <CircleChevronDown className={cls} />;
    case "multiselect": return <Tags className={cls} />;
    case "checkbox": return <SquareCheck className={cls} />;
    case "task": return <ClipboardList className={cls} />;
    case "link": return <LinkIcon className={cls} />;
    default: return <Type className={cls} />;
  }
}

type RowProps = {
  row: NexusSheetRow; rowIndex: number; rawIndex: number; columns: NexusSheetColumn[];
  /** Identity changes when any width changes (cells don't read it; it re-renders sticky offsets). */
  widthsKey: number[];
  lefts: number[];
  frozenCols: number;
  /** Sticky top for a frozen row, null otherwise. */
  stickyTop: number | null;
  /** The thick freeze line sits under this row. */
  freezeEdge: boolean;
  hiddenCols: Set<string>;
  unhideRows: string[] | null;
  onUnhideRows: (ids: string[]) => void;
  merges: { anchors: Map<string, { rowSpan: number; colSpan: number }>; covered: Set<string> };
  selected: boolean; rowSelected: boolean; rect: ReturnType<typeof rectOf>; activeC: number;
  editing: Editing; canEdit: boolean;
  data: ReturnType<typeof buildSheetData>;
  lang: "en" | "id";
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
  showFillHandle: boolean;
  fillRect: FillRect | null;
  onFillStart: () => void;
  onFillOver: (colIndex: number) => void;
  onSelect: (c: number, extend: boolean) => void;
  onDragOver: (c: number) => void;
  onStartDrag: (c: number) => void;
  onSelectRow: (extend: boolean) => void;
  onEdit: (colId: string) => void;
  onCommit: (colId: string, raw: string, next: Next) => void;
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

/** memo'd so arrow-key navigation re-renders 2 rows instead of the whole sheet. */
const Row = memo(function Row(p: RowProps) {
  const editingHere = p.editing && p.editing.rowId === p.row.id;
  const trRef = useRef<HTMLTableRowElement>(null);
  const engine = engineFor(p.data);
  const t = (en: string, vars?: Record<string, string | number>) => trT(en, vars, p.lang);

  /** Drag the bottom edge of the row number to change its height; double-click resets it. */
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

  const sticky = (extra: CSSProperties = {}): CSSProperties =>
    p.stickyTop !== null ? { position: "sticky", top: p.stickyTop, ...extra } : extra;

  return (
    <tr
      ref={trRef}
      // ALWAYS explicit: the window's offsets are computed from these numbers.
      style={{ height: p.row.height ?? ROW_H_DEFAULT }}
      className={cn("group/row", p.dragging && "opacity-40")}
    >
      <td
        data-raw-row={p.rawIndex}
        draggable={p.canEdit}
        onDragStart={p.onDragStart}
        onDragOver={(e) => { e.preventDefault(); p.onDragOverRow(); }}
        onDrop={(e) => { e.preventDefault(); p.onDrop(); }}
        onDragEnd={p.onDragEnd}
        onMouseDown={(e) => { if (e.button === 0 && !(e.target as HTMLElement).closest("button,[data-resize]")) p.onSelectRow(e.shiftKey); }}
        title={p.canEdit ? t("Click to select the row · drag to move it · right-click for more") : undefined}
        onContextMenu={(e) => { e.preventDefault(); p.onRowMenu({ left: e.clientX, top: e.clientY }); }}
        style={{
          position: "sticky", left: 0, zIndex: p.stickyTop !== null ? 25 : 20,
          ...(p.stickyTop !== null ? { top: p.stickyTop } : {}),
          boxShadow: [p.freezeEdge ? `inset 0 -3px 0 0 ${FREEZE_LINE}` : "", p.dropTarget ? `inset 0 2px 0 0 ${SEL}` : ""].filter(Boolean).join(", ") || undefined,
        }}
        className={cn(
          "relative border-b border-r border-border px-1 text-center text-[11px] tabular-nums",
          p.rowSelected ? "bg-info text-info-foreground" : p.selected ? `${HEAD_SEL_BG} text-foreground` : "bg-muted text-muted-foreground",
          p.canEdit && "cursor-default",
        )}
      >
        <span>{p.rawIndex + 1}</span>
        {p.unhideRows && (
          <button
            onClick={(e) => { e.stopPropagation(); p.onUnhideRows(p.unhideRows!); }}
            title={t("Show {n} hidden rows", { n: p.unhideRows.length })}
            aria-label={t("Show {n} hidden rows", { n: p.unhideRows.length })}
            className="absolute -top-2 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center rounded-sm border border-border bg-card px-1 leading-none text-muted-foreground shadow-soft hover:text-foreground"
          >
            <ChevronDown className="h-2.5 w-2.5 rotate-180" /><ChevronDown className="-mt-1 h-2.5 w-2.5" />
          </button>
        )}
        {p.canEdit && (
          <span
            data-resize
            onMouseDown={startResize}
            onDoubleClick={(e) => { e.stopPropagation(); p.onResizeRow(null); }}
            title={t("Drag to resize · double-click for the default height")}
            className="absolute -bottom-[3px] left-0 z-20 h-1.5 w-full cursor-row-resize hover:bg-info/60"
          />
        )}
      </td>
      {p.columns.map((col, ci) => {
        const key = `${p.row.id}:${col.id}`;
        if (p.merges.covered.has(key)) return null;
        const span = p.merges.anchors.get(key);
        if (p.hiddenCols.has(col.id)) return <td key={col.id} style={sticky()} className="overflow-hidden border-0 p-0" />;
        const lastCol = span ? ci + span.colSpan - 1 : ci;
        const inRect = p.selected && lastCol >= p.rect.left && ci <= p.rect.right;
        const refHit = p.refRects.find(
          (x) => p.rawIndex >= x.top && p.rawIndex <= x.bottom && ci >= x.left && ci <= x.right,
        );
        const isEditing = Boolean(editingHere && p.editing!.colId === col.id);
        const value = p.row.cells[col.id];
        const st = p.row.styles?.[col.id];
        const computed = engine.value(p.row.id, col.id);
        const ruleHit = col.rules?.length ? matchRule(col.rules, computed) : null;
        const peerHere = p.peerCursors[key];
        const numeric = typeof computed === "number" && col.type !== "checkbox" && col.type !== "select" && col.type !== "multiselect";

        // Shadows: drawn borders, the selection's outer edge, the active cell, the freeze line.
        const shadows = borderShadows(st);
        if (inRect) {
          if (p.rowIndex === p.rect.top) shadows.push(`inset 0 2px 0 0 ${SEL}`);
          if (p.rowIndex === p.rect.bottom || (span && p.rowIndex + span.rowSpan - 1 >= p.rect.bottom)) shadows.push(`inset 0 -2px 0 0 ${SEL}`);
          if (ci === p.rect.left) shadows.push(`inset 2px 0 0 0 ${SEL}`);
          if (lastCol === p.rect.right) shadows.push(`inset -2px 0 0 0 ${SEL}`);
        }
        if (p.activeC === ci) shadows.push(`inset 0 0 0 2px ${SEL}`);
        if (ci === p.frozenCols - 1) shadows.push(`inset -3px 0 0 0 ${FREEZE_LINE}`);
        if (p.freezeEdge) shadows.push(`inset 0 -3px 0 0 ${FREEZE_LINE}`);
        const frozenCol = ci < p.frozenCols;
        const styled = formatWithStyle(computed, st?.nf, st?.dp, isFormulaCell(value) ? engine.format(p.row.id, col.id) : (col.type === "currency" ? "idr" : col.type === "date" ? "date" : null));
        const text = styled ?? displayCell(col.type, value, { data: p.data, rowId: p.row.id, colId: col.id });
        const fill = st?.bg || ruleHit;
        return (
          <td
            key={col.id}
            data-cell={key}
            role="gridcell"
            aria-selected={inRect}
            rowSpan={span?.rowSpan}
            colSpan={span?.colSpan}
            style={{
              ...(frozenCol ? { position: "sticky", left: p.lefts[ci], zIndex: p.stickyTop !== null ? 24 : 15 } : {}),
              ...(p.stickyTop !== null ? { position: "sticky", top: p.stickyTop, zIndex: frozenCol ? 24 : 18 } : {}),
              ...styleInline(st),
              ...(shadows.length ? { boxShadow: shadows.join(", ") } : {}),
            }}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              if (p.refMode) {
                // preventDefault keeps focus in the formula input — a blur would commit it early.
                e.preventDefault();
                p.onPickRef(ci);
                return;
              }
              if (e.shiftKey) p.onSelect(ci, true); else p.onStartDrag(ci);
            }}
            onMouseEnter={() => {
              p.onFillOver(ci);
              if (p.refMode) p.onExtendRef(ci); else p.onDragOver(ci);
            }}
            onDoubleClick={() => p.canEdit && p.onEdit(col.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (!inRect) p.onSelect(ci, false);
              p.onCellMenu(ci, { left: e.clientX, top: e.clientY });
            }}
            className={cn(
              "group/cell relative overflow-hidden border-b border-r border-border/80 px-1.5 py-0.5",
              verticalClass(st), horizontalClass(st, numeric),
              numeric && "tabular-nums",
              col.type === "checkbox" && !st?.ha ? "text-center" : "",
              // Opaque background wherever the cell is pinned, so scrolled cells pass underneath.
              fill ? "" : frozenCol || p.stickyTop !== null ? "bg-card" : "",
              ruleHit ? RULE_STYLE_CLASS[ruleHit.style] : "",
              styleClasses(st),
              refHit ? `outline outline-2 -outline-offset-2 outline-dashed ${REF_COLORS[refHit.color]}` : "",
              p.fillRect && p.rowIndex >= p.fillRect.top && p.rowIndex <= p.fillRect.bottom && ci >= p.fillRect.left && ci <= p.fillRect.right
                ? "bg-info/5 outline-dashed outline-1 -outline-offset-1 outline-info/60" : "",
              p.findHits.some((h) => h.r === p.rowIndex && h.c === ci) ? "bg-amber-100 dark:bg-amber-900/40" : "",
            )}
          >
            {/* Selection tint as an overlay, so it sits over fills and pinned cells stay opaque. */}
            {inRect && p.activeC !== ci && <span aria-hidden className="pointer-events-none absolute inset-0 bg-info/10" />}
            {peerHere && (
              <>
                <span className="pointer-events-none absolute inset-0 z-[1]" style={{ boxShadow: `inset 0 0 0 2px ${peerHere.color}` }} />
                <span
                  className="pointer-events-none absolute right-0 top-0 z-[2] max-w-[110px] truncate rounded-bl px-1 text-[9px] font-bold leading-[11px] text-white"
                  style={{ backgroundColor: peerHere.color }}
                >
                  {peerHere.name}
                </span>
              </>
            )}
            {(p.commentCounts[key] ?? 0) > 0 && (
              <span
                title={t("{n} comments — right-click to open", { n: p.commentCounts[key] })}
                className="pointer-events-none absolute right-0 top-0 h-0 w-0 border-l-[6px] border-t-[6px] border-l-transparent border-t-amber-500"
              />
            )}
            {p.showFillHandle && inRect && lastCol === p.rect.right && !isEditing && (
              <span
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); p.onFillStart(); }}
                title={t("Drag to copy or continue a series")}
                className="absolute -bottom-[1px] -right-[1px] z-10 h-[7px] w-[7px] cursor-crosshair border border-card bg-info"
              />
            )}
            {isEditing ? (
              <div className="absolute inset-0 z-10">
              <CellEditor
                col={col}
                initial={p.editing?.seed ?? editFormula(value, p.data.shape) ?? editValue(col.type, value)}
                seeded={Boolean(p.editing?.seed)}
                onCommit={(raw, next) => p.onCommit(col.id, raw, next)}
                onCancel={p.onCancel}
                onDraftChange={p.onDraftChange}
                registerEditor={p.registerEditor}
              />
              </div>
            ) : col.type === "task" ? (
              <TaskCell
                taskId={typeof value === "string" ? value : ""}
                tasks={p.tasks}
                canEdit={p.canEdit}
                onOpen={p.onOpenTask}
                onPick={(id) => p.onCommit(col.id, id, null)}
              />
            ) : col.type === "select" ? (
              <span className="flex items-center gap-1 overflow-hidden">
                {value !== undefined && value !== null && value !== "" && (
                  <span className={cn("max-w-full truncate rounded-full px-2 text-[11px] font-medium leading-5", optionColor(col, String(value)))}>{String(value)}</span>
                )}
                {p.canEdit && <ChevronDown className={cn("ml-auto h-3 w-3 shrink-0 text-muted-foreground/60", (value === undefined || value === null || value === "") && "opacity-0 group-hover/cell:opacity-100")} />}
              </span>
            ) : col.type === "multiselect" ? (
              <span className="flex items-center gap-1 overflow-hidden">
                <span className="flex min-w-0 flex-wrap items-center gap-1">
                  {readMulti(value).map((v) => (
                    <span key={v} className={cn("max-w-full truncate rounded-full px-2 text-[11px] font-medium leading-5", optionColor(col, v))}>{v}</span>
                  ))}
                </span>
                {p.canEdit && <ChevronDown className={cn("ml-auto h-3 w-3 shrink-0 text-muted-foreground/60", !readMulti(value).length && "opacity-0 group-hover/cell:opacity-100")} />}
              </span>
            ) : isLinkCell(value) ? (
              <a
                href={value.u}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => { if (!e.metaKey && !e.ctrlKey) e.stopPropagation(); }}
                title={value.u}
                className={cn("block text-info underline decoration-info/40 underline-offset-2 hover:decoration-info", st?.w ? "whitespace-normal break-words" : "truncate")}
              >
                {value.t || value.u}
              </a>
            ) : col.type === "checkbox" ? (
              <button
                disabled={!p.canEdit}
                onClick={() => p.onCommit(col.id, value === true ? "" : "true", null)}
                aria-label={value ? t("Untick") : t("Tick")}
                className={cn("mx-auto grid h-4 w-4 place-items-center rounded border", value ? "border-primary bg-primary text-primary-foreground" : "border-control-border")}
              >
                {value ? <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden><path d="M2.5 6.5l2.2 2.2L9.5 3.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
              </button>
            ) : (
              <span
                className={cn("block", st?.w ? "whitespace-pre-wrap break-words" : "truncate whitespace-pre",
                  isError(computed) && isFormula(value) ? "font-medium text-destructive" : "")}
                title={isFormula(value) && isError(computed) ? `${computed} — ${errorHint(computed, p.lang)}` : undefined}
              >
                {text}
              </span>
            )}
          </td>
        );
      })}
      <td style={sticky()} className={cn("border-b border-border/60", p.stickyTop !== null && "bg-card")} />
    </tr>
  );
}, (a, b) =>
  a.row === b.row &&
  a.columns === b.columns &&
  // A formula in THIS row can read cells in another row, so its value changes when the data does.
  a.data === b.data &&
  a.lang === b.lang &&
  a.rowIndex === b.rowIndex &&
  a.rawIndex === b.rawIndex &&
  a.widthsKey === b.widthsKey &&
  a.lefts === b.lefts &&
  a.frozenCols === b.frozenCols &&
  a.stickyTop === b.stickyTop &&
  a.freezeEdge === b.freezeEdge &&
  a.hiddenCols === b.hiddenCols &&
  a.unhideRows === b.unhideRows &&
  a.merges === b.merges &&
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
  a.activeC === b.activeC &&
  a.rowSelected === b.rowSelected &&
  // Only re-render when this row's selected-ness or the selection's edges in it changed.
  (a.selected === b.selected && (!a.selected || (a.rect.left === b.rect.left && a.rect.right === b.rect.right && a.rect.top === b.rect.top && a.rect.bottom === b.rect.bottom))) &&
  (a.editing?.rowId === a.row.id) === (b.editing?.rowId === b.row.id) &&
  (a.editing?.rowId !== a.row.id || a.editing?.colId === b.editing?.colId),
);
