import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownAZ, ArrowUpAZ, ListFilter, Minus, Table2, BetweenHorizontalStart, BetweenVerticalStart, ChevronDown, ClipboardPaste, Copy,
  Eraser, EyeOff, Filter, Link2 as LinkIcon, ListChecks, MessageSquare, MoveHorizontal, MoveVertical, Paintbrush, Plus,
  RemoveFormatting, Replace, RotateCcw, Scissors, Search, Settings2, Snowflake, Trash2, X,
  CalendarDays, CircleChevronDown, ClipboardList, Hash, SquareCheck, Tags, Type,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { t as trT, useLang } from "@/lib/lang";
import type { NexusSheetColumnColor, NexusSheetSettings } from "@/lib/nexus-api";
import {
  CHIP_COLORS, COLUMN_COLOR_CLASS, COLUMN_TYPE_LABEL, RULE_STYLE_CLASS, buildSheetData, displayCell, editFormula, editValue,
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
import { Floating } from "./sheet-float";
import {
  buildRuleIndex, checkboxValue, dropdownOptions, invalidMessage, isChecked, isDropdown, newRuleId, pickedValues,
  rangeFromA1, rangeRect, rangeToA1, validateCell, type ValidationRule,
} from "@/lib/sheet-validation";
import type { PanelRule } from "./DataValidationPanel";
import { useQuery } from "@tanstack/react-query";
import { nexusApi } from "@/lib/nexus-api";
import { FilterMenu } from "./FilterMenu";
import { FindReplaceDialog, RemoveDuplicatesDialog, SortRangeDialog, SplitSeparatorChip, type FindOpts } from "./DataDialogs";
import { NamedRangesPanel, ProtectedRangesPanel, ProtectionWarningDialog } from "./SheetRangesPanel";
import { ColumnStatsPanel } from "./SheetStatsPanel";
import { SheetSettingsDialog, ShortcutsDialog } from "./SheetSettingsPanel";
import { SlicerChip, SlicerPanel } from "./SheetSlicerPanel";
import { DatePicker, NotePopover } from "./sheet-popovers";
import { ColorPicker } from "./ColorPicker";
import { CurrencyFormatDialog, CustomNumberFormatDialog, DateTimeFormatDialog } from "./FormatDialogs";
import { SheetDialog, SidePanel, primaryBtn } from "./sheet-shell";
import type { MenuNode } from "./sheet-menus";
import { dedupe, replaceText, textMatches, type SplitSep } from "@/lib/sheet-datatools";
import { stateAt } from "@/lib/sheet-versions";
import { SUPPORTED_FUNCTIONS, formatNumberPattern, isTypedCell, serialToIso, setDisplayLocale, todaySerial } from "@/lib/sheet-formula";
import { DropdownCell, DropdownPicker } from "./sheet-dropdown";
import { SheetToolbar } from "./SheetToolbar";
import { Menu, MenuItem } from "./sheet-menu-ui";
import { MenuBar, MenuPopup, MenuSearch } from "./sheet-menus";
import { buildContextMenu, buildMenuBar, type MenuAction, type MenuCtx } from "./sheet-menu-model";
import { newId, type ChartSpec, type CondRule, type FilterView, type Slicer, type TableColumnType } from "@/lib/sheet-model";
import { defaultChart } from "@/lib/sheet-chart";
import { numberFormatItems } from "@/lib/sheet-numfmt";
import { detectSeparator, splitText as splitTextLib, trimCell } from "@/lib/sheet-datatools";
import type { SheetTab } from "./SheetTabs";

/** What the grid asks of the page around it (sheets, files, bulk server operations). */
export type SheetHost = {
  sheetId: string;
  sheets: SheetTab[];
  meId: string | null;
  members: { id: string; name: string }[];
  importFile: () => void;
  download: (format: "xlsx" | "csv" | "tsv" | "html") => void;
  renameSheet: () => void;
  insertSheet: () => void;
  setSheetHidden: (id: string, hidden: boolean) => void;
  /** Bulk reorder of rows (Sort sheet); `before` is the order to restore on undo. */
  reorderRows: (order: string[], before: string[], label: string) => Promise<void>;
  reorderColumns: (ids: string[]) => void;
  deleteColumns: (ids: string[]) => void;
  /** Insert › Pivot table › New sheet: a "Pivot Table N" sheet fed by this range (stored form). */
  createPivot: (range: string) => void;
  /** File › Settings apply to every sheet of the spreadsheet (project). */
  saveSpreadsheetSettings: (patch: { locale?: unknown; timeZone?: unknown; recalc?: unknown; iterative?: unknown }) => void;
};
import {
  applyBorderPreset, borderOverlay, clearNeighbourEdge, fontPx, horizontalClass, patchStyle, rotatedBox, rotationStyle, styleClasses, styleInline,
  verticalClass, wrapMode, type BorderPreset10, type CellStyle,
} from "./sheet-style";
import type { BorderLine, NumberFormatKind } from "@/lib/sheet-model";
import { STANDARD_THEME, toHex } from "@/lib/sheet-palette";
import { applyFilter, colorsInColumn, critActive, distinctValues, sortedRowIds } from "@/lib/sheet-filter";
import { buildCondFormatter } from "@/lib/sheet-cf";
import type { Banding, SheetFilter, SheetTheme, TableSpec } from "@/lib/sheet-model";

import { PivotCreateDialog } from "./PivotEditor";
// Charts (recharts) and the side panels load when first shown, not with every sheet (perf pass, 12 Oct 2026).
const ChartEditor = lazy(() => import("./ChartEditor").then((m) => ({ default: m.ChartEditor })));
const ChartObject = lazy(() => import("./SheetChart").then((m) => ({ default: m.ChartObject })));
const ConditionalFormatPanel = lazy(() => import("./ConditionalFormatPanel").then((m) => ({ default: m.ConditionalFormatPanel })));
const DataValidationPanel = lazy(() => import("./DataValidationPanel").then((m) => ({ default: m.DataValidationPanel })));
const VersionHistoryPanel = lazy(() => import("./SheetVersionPanel").then((m) => ({ default: m.VersionHistoryPanel })));
const ThemePanel = lazy(() => import("./SheetThemePanel").then((m) => ({ default: m.ThemePanel })));
const AlternatingColorsPanel = lazy(() => import("./AlternatingColorsPanel").then((m) => ({ default: m.AlternatingColorsPanel })));

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

type Prefs = { fx: boolean; formulas: boolean; protectedShown: boolean; commentsHidden: boolean; manual: boolean };
function readPrefs(): Prefs {
  const base: Prefs = { fx: true, formulas: false, protectedShown: false, commentsHidden: false, manual: false };
  try { return { ...base, ...(JSON.parse(localStorage.getItem("nexus-sheet-prefs") ?? "{}") as Partial<Prefs>) }; } catch { return base; }
}
type PanelState =
  | { kind: "dv" } | { kind: "cf"; id?: string } | { kind: "alt" } | { kind: "named"; fromSelection?: boolean } | { kind: "protect"; fromSelection?: boolean; sheet?: boolean }
  | { kind: "chart"; id: string } | { kind: "pivot" } | { kind: "slicer"; id: string } | { kind: "stats"; col: number } | { kind: "theme" }
  | { kind: "versions" } | { kind: "comments" } | null;
type DialogState = { kind: "settings" | "find" | "sort" | "dedupe" | "functions" | "shortcuts" | "pivot" | "customNumber" | "customDate" | "customCurrency" | "resizeRows" | "resizeCols" } | null;
/** Tables (Format › Convert to table): dark-green header, light banding — like Sheets' default table. */
const TABLE_HEADER = "#1e6b45";
const TABLE_BAND = "#eef7f1";
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Insert › Function categories (Sheets' Σ menu), over what the engine actually runs. */
const FUNCTION_CATALOG: { category: string; names: string[] }[] = [
  { category: "Math", names: ["SUM", "SUMIF", "SUMIFS", "SUMPRODUCT", "PRODUCT", "ROUND", "ROUNDUP", "ROUNDDOWN", "MROUND", "CEILING", "FLOOR", "INT", "TRUNC", "ABS", "MOD", "SQRT", "POWER"] },
  { category: "Statistical", names: ["AVERAGE", "AVERAGEIF", "AVERAGEIFS", "MEDIAN", "MIN", "MAX", "MINIFS", "MAXIFS", "COUNT", "COUNTA", "COUNTBLANK", "COUNTIF", "COUNTIFS", "LARGE", "SMALL", "RANK", "STDEV", "PERCENTILE"] },
  { category: "Logical", names: ["IF", "IFS", "IFERROR", "IFNA", "AND", "OR", "NOT", "SWITCH", "CHOOSE"] },
  { category: "Info", names: ["ISBLANK", "ISNUMBER", "ISTEXT", "ISERROR"] },
  { category: "Lookup", names: ["VLOOKUP", "HLOOKUP", "XLOOKUP", "INDEX", "MATCH"] },
  { category: "Text", names: ["CONCAT", "TEXTJOIN", "TEXT", "VALUE", "LEN", "UPPER", "LOWER", "PROPER", "TRIM", "LEFT", "RIGHT", "MID", "FIND", "SEARCH", "SUBSTITUTE", "REPT"] },
  { category: "Date", names: ["TODAY", "NOW", "DATE", "DATEVALUE", "YEAR", "MONTH", "DAY", "WEEKDAY", "WEEKNUM", "EOMONTH", "EDATE", "DATEDIF", "DAYS", "NETWORKDAYS", "WORKDAY", "YEARFRAC"] },
  { category: "Financial", names: ["PMT", "FV", "PV", "NPV", "IRR"] },
];

function readZoom(): number {
  try { const z = Number(localStorage.getItem("nexus-sheet-zoom")); return z >= 0.5 && z <= 2 ? z : 1; } catch { return 1; }
}
function readStat(): Stat {
  try { const s = localStorage.getItem("nexus-sheet-stat") as Stat | null; return s && ["sum", "avg", "count", "countNum", "min", "max"].includes(s) ? s : "sum"; } catch { return "sum"; }
}

export function SheetGrid({
  columns, rows: rowsProp, settings, canEdit: canEditProp, canManage,
  onSetCells, onSetStyles, onSettings, onAddRows, onDeleteRows, onReorderRow, onDeleteColumn, onEditColumn, onAddColumn,
  tasks, onOpenTask, commentCounts, onOpenComments, peerCursors, onEditingChange, onCursor, onResizeRow, onInsertColumn,
  canUndo, canRedo, onUndo, onRedo, footerLeft, saving, sheetName, host, command, aside, onReopenAside,
}: {
  /** A sidebar from the page (the pivot table editor), shown when no other sidebar is open. */
  aside?: ReactNode;
  onReopenAside?: () => void;
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
  /** Insert `count` fresh columns AT this index (existing ones shift right). */
  onInsertColumn: (index: number, count?: number) => void;
  host?: SheetHost;
  /** One-shot instructions from the page (sheet tab menu). */
  command?: { kind: "protectSheet" | "comments"; n: number } | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Sheet tabs, drawn at the left of the bottom bar (the status bar sits on the right). */
  footerLeft?: ReactNode;
  saving?: boolean;
  /** Shown before ranges in the data-validation panel ("Anggaran!B2:B20"). */
  sheetName?: string;
}) {
  const { lang, t } = useLang();
  // File › Version history: while an old version is open the grid shows it, read-only.
  const [versionAt, setVersionAt] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(true);
  const [versionPreview, setVersionPreview] = useState<{ rows: NexusSheetRow[]; changed: Set<string> } | null>(null);
  const rows = versionPreview?.rows ?? rowsProp;
  const canEdit = canEditProp && !versionPreview;
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
  /** Per-viewer view preferences (View › Show, Tools › Calculation). */
  const [prefs, setPrefsState] = useState(readPrefs);
  const setPrefs = (fn: (p: Prefs) => Prefs) => setPrefsState((p) => { const n = fn(p); try { localStorage.setItem("nexus-sheet-prefs", JSON.stringify(n)); } catch { /* ignore */ } return n; });
  /** Bumped by F9 (manual calculation) and by File › Settings › Recalculation every minute/hour. */
  const [recalcTick, setRecalcTick] = useState(0);
  useEffect(() => {
    const every = settings.recalc === "minute" ? 60_000 : settings.recalc === "hour" ? 3_600_000 : 0;
    if (!every) return;
    const id = setInterval(() => setRecalcTick((n) => n + 1), every);
    return () => clearInterval(id);
  }, [settings.recalc]);
  // Numbers and dates read in the spreadsheet's locale (File › Settings › Locale), here and in formats.
  setDisplayLocale(settings.locale ?? "id-ID");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => buildSheetData(columns, rows, settings.namedRanges), [columns, rows, recalcTick, settings.locale, settings.namedRanges]);
  const engineRef = useRef<SheetEngine | null>(null);
  const engine = useMemo(() => {
    const prev = engineRef.current;
    const e = engineFor(data, prev);
    // Tools › Calculation control › Manual: formulas keep their last results until F9.
    if (prefs.manual && prev && prev !== e) for (const [k, v] of prev.values) if (!e.values.has(k)) e.values.set(k, v);
    engineRef.current = e;
    return e;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // ── Data validation ─────────────────────────────────────────────────────────────────────────
  // Explicit rules live in settings.validations; a Dropdown / Multi-select COLUMN (the older,
  // per-column type) reads as a dropdown rule over its whole column, so both draw and behave alike.
  const explicitRules = useMemo(() => (settings.validations ?? []) as ValidationRule[], [settings.validations]);
  const columnRules = useMemo(() => columns.map((col): PanelRule | null => (
    col.type === "select" || col.type === "multiselect"
      ? {
        id: `col:${col.id}`, columnId: col.id, ranges: [`{${col.id}!*}:{${col.id}!*}`], kind: "list",
        values: col.options ?? [],
        colors: Object.fromEntries((col.options ?? []).map((o, i) => [o, col.optionColors?.[o] ?? CHIP_COLORS[i % CHIP_COLORS.length]])),
        multiple: col.type === "multiselect", display: "chip",
      }
      : null
  )), [columns]);
  const explicitAt = useMemo(() => buildRuleIndex(explicitRules, data.shape), [explicitRules, data.shape]);
  const ruleAt = useCallback((rawRow: number, ci: number): ValidationRule | null => explicitAt(rawRow, ci) ?? columnRules[ci] ?? null, [explicitAt, columnRules]);
  const [dvOpen, setDvOpen] = useState(false);
  const [dvEditId, setDvEditId] = useState<string | null>(null);
  /** The dropdown list open on a cell. */
  const [dropdown, setDropdown] = useState<{ rowId: string; colId: string; rect: DOMRect } | null>(null);

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

  // ── Sheets-parity UI state ───────────────────────────────────────────────────────────────────
  /** The right-hand sidebar (one at a time, like Sheets). */
  const [panel, setPanel] = useState<PanelState>(null);
  /** A modal dialog. */
  const [dialog, setDialog] = useState<DialogState>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [menuSearch, setMenuSearch] = useState(false);
  const [full, setFull] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [toast, setToastState] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setToast = (msg: string) => { setToastState(msg); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToastState(null), 3500); };
  /** The filter view open for THIS viewer (Sheets: a view is personal until saved for everyone). */
  const [activeView, setActiveView] = useState<string | null>(null);
  const [selectedObject, setSelectedObject] = useState<string | null>(null);
  const [note, setNote] = useState<{ rowId: string; colId: string; rect: DOMRect; editing: boolean } | null>(null);
  const [splitChip, setSplitChip] = useState<{ rect: DOMRect; sep: unknown } | null>(null);
  /** Paint format: the copied style; sticky after a double-click. */
  const [paint, setPaint] = useState<{ style: CellStyle | null; sticky: boolean } | null>(null);
  useEffect(() => {
    if (!command) return;
    if (command.kind === "protectSheet") setPanel({ kind: "protect", sheet: true });
    if (command.kind === "comments") setPanel({ kind: "comments" });
  }, [command]);

  // ── Sheet settings ───────────────────────────────────────────────────────────────────────────
  const hiddenRows = useMemo(() => new Set(settings.hiddenRows ?? []), [settings.hiddenRows]);
  // Hidden columns, plus those inside collapsed column groups (View › Group).
  const hiddenCols = useMemo(() => {
    const out = new Set(settings.hiddenCols ?? []);
    for (const g of settings.colGroups ?? []) {
      if (!g.collapsed) continue;
      const a = columns.findIndex((c) => c.id === g.from), b = columns.findIndex((c) => c.id === g.to);
      if (a < 0 || b < 0) continue;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i += 1) out.add(columns[i].id);
    }
    return out;
  }, [settings.hiddenCols, settings.colGroups, columns]);
  const frozenCols = Math.min(settings.frozenCols ?? 0, columns.length);
  const frozenRowsSetting = settings.frozenRows ?? 0;
  const colHidden = useCallback((c: number) => hiddenCols.has(columns[c]?.id ?? ""), [hiddenCols, columns]);

  /**
   * What's on screen: the rows after hiding, sorting and filtering, each keeping its index in the
   * UNDERLYING order. Sorting is a per-viewer VIEW, never a write. Frozen rows are the sheet's first
   * N rows and stay put on top — sorting and filtering leave them alone, as Sheets does with a
   * frozen header row.
   */
  // ── Sheet-level decorations: conditional formats, alternating colours, tables, filters ───────
  /** Live previews from the open sidebars (not saved until Done). */
  const [cfPreview, setCfPreview] = useState<CondRule[] | null>(null);
  const [bandPreview, setBandPreview] = useState<{ id: string | null; b: Banding | null } | null>(null);
  const [themePreview, setThemePreview] = useState<SheetTheme | null>(null);
  const condRules = cfPreview ?? settings.condFormats ?? [];
  const condAt = useMemo(() => buildCondFormatter(condRules, data.shape, engine), [condRules, data.shape, engine]);
  const bandings = useMemo(() => {
    let list = settings.bandings ?? [];
    if (bandPreview) list = bandPreview.b ? [...list.filter((b) => b.id !== bandPreview.id), bandPreview.b] : list.filter((b) => b.id !== bandPreview.id);
    return list.map((b) => ({ b, rc: rangeRect(b.range, data.shape) })).filter((x): x is { b: Banding; rc: NonNullable<ReturnType<typeof rangeRect>> } => Boolean(x.rc));
  }, [settings.bandings, bandPreview, data.shape]);
  const tables = useMemo(() => (settings.tables ?? []).map((tb) => ({ tb, rc: rangeRect(tb.range, data.shape) })).filter((x) => x.rc) as { tb: TableSpec; rc: NonNullable<ReturnType<typeof rangeRect>> }[], [settings.tables, data.shape]);
  /** The filter in force for THIS viewer: an open filter view, else the sheet's shared filter. */
  const activeFilter: SheetFilter | null = useMemo(
    () => (activeView ? (settings.filterViews ?? []).find((v) => v.id === activeView) ?? null : settings.filter ?? null),
    [activeView, settings.filterViews, settings.filter],
  );
  const display = useCallback((rowId: string, colId: string) => {
    const col = columns.find((c) => c.id === colId);
    return col ? displayCell(col.type, data.cells.get(rowId)?.[colId], { data, rowId, colId }) : "";
  }, [columns, data]);
  const styleOfCell = useCallback((rowId: string, colId: string) => {
    const r = data.shape.rowIds.indexOf(rowId), c = data.shape.columnIds.indexOf(colId);
    const own = rows[r]?.styles?.[colId];
    const cf = r >= 0 && c >= 0 ? condAt(r, c) : null;
    const bg = cf?.bg ?? (own?.bg ? toHex(own.bg) ?? undefined : undefined);
    const fc = cf?.fc ?? (own?.fc ? toHex(own.fc) ?? undefined : undefined);
    return bg || fc ? { bg, fc } : undefined;
  }, [data.shape, rows, condAt]);
  const filterResult = useMemo(() => {
    const slicers = settings.slicers ?? [];
    const hidden = new Set<string>();
    let main: ReturnType<typeof applyFilter> | null = null;
    if (activeFilter) {
      main = applyFilter(activeFilter, { shape: data.shape, engine, display, styleOf: styleOfCell, slicers: slicers.filter((x) => x.range === activeFilter.range).map((x) => ({ colId: x.colId, crit: x.crit })) });
      main.hidden.forEach((id) => hidden.add(id));
    }
    for (const sl of slicers) {
      if (activeFilter && sl.range === activeFilter.range) continue;
      if (!sl.crit) continue;
      applyFilter({ range: sl.range }, { shape: data.shape, engine, display, styleOf: styleOfCell, slicers: [{ colId: sl.colId, crit: sl.crit }] }).hidden.forEach((id) => hidden.add(id));
    }
    return { hidden, main };
  }, [activeFilter, settings.slicers, data.shape, engine, display, styleOfCell]);
  /** Rows inside collapsed groups (View › Group). */
  const groupHidden = useMemo(() => {
    const out = new Set<string>();
    for (const g of settings.rowGroups ?? []) {
      if (!g.collapsed) continue;
      const a = data.shape.rowIds.indexOf(g.from), b = data.shape.rowIds.indexOf(g.to);
      if (a < 0 || b < 0) continue;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i += 1) out.add(data.shape.rowIds[i]);
    }
    return out;
  }, [settings.rowGroups, data.shape]);

  const { view, frozenRows } = useMemo(() => {
    const all = rows.map((row, rawIndex) => ({ row, rawIndex })).filter(({ row }) => !hiddenRows.has(row.id) && !groupHidden.has(row.id) && !filterResult.hidden.has(row.id));
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
    // The filter's sort (Sort A → Z from the filter menu) orders the rows of its range, in view only.
    const fsort = activeFilter?.sort;
    const frc = filterResult.main?.rect;
    if (fsort && frc) {
      const inside = list.filter((x) => x.rawIndex > frc.top && x.rawIndex <= frc.bottom);
      const order = sortedRowIds(inside.map((x) => x.row.id), fsort, (r, c) => engine.value(r, c));
      const byId = new Map(inside.map((x) => [x.row.id, x]));
      let k = 0;
      list = list.map((x) => (x.rawIndex > frc.top && x.rawIndex <= frc.bottom ? byId.get(order[k++])! : x));
    }
    return { view: [...fixed, ...list], frozenRows: fixed.length };
  }, [rows, columns, sort, filters, data, engine, hiddenRows, frozenRowsSetting, groupHidden, filterResult, activeFilter]);

  const protRects = useMemo(() => (prefs.protectedShown ? (settings.protections ?? []).flatMap((pr) => (pr.sheet
    ? [{ top: 0, bottom: rows.length - 1, left: 0, right: columns.length - 1 }]
    : pr.range ? [rangeRect(pr.range, data.shape)].filter(Boolean) as NonNullable<ReturnType<typeof rangeRect>>[] : [])) : []), [prefs.protectedShown, settings.protections, rows.length, columns.length, data.shape]);
  const filterCrit = activeFilter?.criteria;
  const decorAt = useCallback((rawRow: number, ci: number): Decor | null => {
    let out: Decor | null = null;
    const put = (d: Decor) => { out = { ...(out ?? {}), ...d, base: { ...(out?.base ?? {}), ...(d.base ?? {}) } }; };
    for (const { b, rc } of bandings) {
      if (rawRow < rc.top || rawRow > rc.bottom || ci < rc.left || ci > rc.right) continue;
      const first = b.header ? rc.top + 1 : rc.top;
      const bg = b.header && rawRow === rc.top ? b.header : b.footer && rawRow === rc.bottom ? b.footer : (rawRow - first) % 2 === 0 ? b.c1 : b.c2;
      put({ base: { bg } });
    }
    for (const { tb, rc } of tables) {
      if (rawRow < rc.top || rawRow > rc.bottom || ci < rc.left || ci > rc.right) continue;
      if (rawRow === rc.top) put({ base: { bg: tb.header ?? TABLE_HEADER, fc: "#ffffff", b: 1 }, head: "table" });
      else if (tb.banded !== false) put({ base: { bg: (rawRow - rc.top) % 2 === 0 ? TABLE_BAND : "#ffffff" } });
    }
    const frc = filterResult.main?.rect;
    if (frc && rawRow >= frc.top && rawRow <= frc.bottom && ci >= frc.left && ci <= frc.right) {
      const edge = `${rawRow === frc.top ? "t" : ""}${rawRow === frc.bottom ? "b" : ""}${ci === frc.left ? "l" : ""}${ci === frc.right ? "r" : ""}`;
      if (rawRow === frc.top) put({ head: "filter", filtered: critActive(filterCrit?.[columns[ci]?.id ?? ""]), base: { b: 1 }, edge });
      else if (edge) put({ edge });
    }
    const cf = condAt(rawRow, ci);
    if (cf) put({ cf: cf as Partial<CellStyle> });
    if (versionPreview?.changed.size && versionPreview.changed.has(`${rows[rawRow]?.id}:${columns[ci]?.id}`)) put({ cf: { ...(cf ?? {}), bg: "#fde9b8" } as Partial<CellStyle> });
    if (protRects.some((r) => rawRow >= r.top && rawRow <= r.bottom && ci >= r.left && ci <= r.right)) put({ stripes: true });
    return out;
  }, [bandings, tables, filterResult, filterCrit, condAt, protRects, columns, versionPreview, rows]);

  /** Rows grow to fit wrapped, rotated or large text unless someone set a height by hand (Sheets' auto height). */
  const autoHeights = useMemo(() => {
    const out = new Map<string, number>();
    const ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    if (!ctx) return out;
    const family = typeof getComputedStyle !== "undefined" ? getComputedStyle(document.body).fontFamily : "sans-serif";
    for (const row of rows) {
      if (row.height != null || !row.styles) continue;
      let h = 0;
      for (const [colId, st] of Object.entries(row.styles)) {
        if (!st) continue;
        const px = fontPx(st) ?? 13;
        const big = px > 14;
        const w = wrapMode(st) === "w";
        if (!big && !w && !st.rt) continue;
        const ci = columns.findIndex((c) => c.id === colId);
        if (ci < 0) continue;
        const col = columns[ci];
        const text = displayCell(col.type, row.cells[colId], { data, rowId: row.id, colId });
        if (!text) { if (big) h = Math.max(h, Math.round(px * 1.3 + 8)); continue; }
        if (st.rt) { h = Math.max(h, Math.round(rotatedBox(text, st, px).h + 8)); continue; }
        ctx.font = `${st.b ? "bold " : ""}${px}px ${family}`;
        const avail = Math.max(10, (col.width ?? COL_W_DEFAULT) - 12);
        let lines = 0;
        for (const para of text.split("\n")) {
          let line = 0;
          for (const word of para.split(/(\s+)/)) {
            const ww = ctx.measureText(word).width;
            if (line + ww > avail && line > 0) { lines += 1; line = /^\s+$/.test(word) ? 0 : ww; } else line += ww;
          }
          lines += 1;
        }
        h = Math.max(h, Math.round((w ? lines : 1) * px * 1.3 + 8));
      }
      if (h > ROW_H_DEFAULT) out.set(row.id, Math.min(ROW_H_MAX, h));
    }
    return out;
  }, [rows, columns, data]);
  const heightOf = useCallback((row: NexusSheetRow) => row.height ?? autoHeights.get(row.id) ?? ROW_H_DEFAULT, [autoHeights]);

  /** Running pixel offset of every row, so the window and the spacers agree to the pixel. */
  const offsets = useMemo(() => {
    const out = new Array<number>(view.length + 1);
    out[0] = 0;
    for (let i = 0; i < view.length; i += 1) out[i + 1] = out[i] + heightOf(view[i].row);
    return out;
  }, [view, heightOf]);
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

  /**
   * The rule that REJECTS this value here ("If the data is invalid: Reject the input"), or null.
   * Warning-only rules never block; they mark the cell instead.
   */
  const rejectedBy = (rowId: string, colId: string, next: unknown): ValidationRule | null => {
    const r = data.shape.rowIds.indexOf(rowId), c = data.shape.columnIds.indexOf(colId);
    const rule = r >= 0 && c >= 0 ? ruleAt(r, c) : null;
    if (!rule?.strict || isFormulaCell(next)) return null;
    return validateCell(rule, next, engine.scalar(next, colId), { engine, shape: data.shape, at: { r, c } }) ? null : rule;
  };
  /** Drop the values a rejecting rule refuses from a batch (paste, fill); tell how many. */
  const keepValid = (edits: { rowId: string; values: Record<string, unknown> }[]) => {
    let refused = 0;
    let first: ValidationRule | null = null;
    const out = edits.map((e) => ({
      rowId: e.rowId,
      values: Object.fromEntries(Object.entries(e.values).filter(([colId, v]) => {
        const bad = v === null ? null : rejectedBy(e.rowId, colId, v);
        if (bad) { refused += 1; first ??= bad; }
        return !bad;
      })),
    })).filter((e) => Object.keys(e.values).length);
    if (refused && first) alert(`${t("{n} cells were not changed: {why}", { n: refused, why: invalidMessage(first, t) })}`);
    return out;
  };

  /** Save what was typed — through inputToCell, the one path from text to a cell value. */
  const commit = useCallback((rowId: string, colId: string, raw: string) => {
    const col = columns.find((x) => x.id === colId);
    if (!col) return;
    const prevRaw = rows.find((x) => x.id === rowId)?.cells[colId];
    const next = inputToCell(col, raw, data.shape, prevRaw);
    if (sameCell(prevRaw, next)) return;
    const bad = rejectedBy(rowId, colId, next);
    if (bad) { alert(invalidMessage(bad, t)); return; }
    onSetCells([{ rowId, values: { [colId]: next } }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, rows, onSetCells, data.shape, ruleAt, engine, t]);

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
  /** Clear formatting keeps the note (Sheets: a note is content, not format). */
  const clearFormat = () => styleSelection((st) => (st?.nt ? { nt: st.nt } : null), t("clear formatting"));
  /** Borders panel: the preset with the sticky line style and colour (shared edges stored once). */
  const applyBorders10 = (preset: BorderPreset10, line: BorderLine, color: string | null) => {
    if (!canEdit) return;
    const edits: StyleEdit[] = [];
    for (let r = rect.top; r <= rect.bottom; r += 1) {
      const row = view[r]?.row;
      if (!row) continue;
      const values: Record<string, CellStyle | null> = {};
      for (let c = rect.left; c <= rect.right; c += 1) {
        const col = columns[c];
        if (!col) continue;
        values[col.id] = patchStyle(row.styles?.[col.id], applyBorderPreset(preset, r, c, rect, row.styles?.[col.id], line, color));
      }
      edits.push({ rowId: row.id, values });
    }
    if (preset === "clear" || preset === "all" || preset === "outer" || preset === "top" || preset === "left") {
      const above = view[rect.top - 1]?.row;
      if (above) {
        const values: Record<string, CellStyle | null> = {};
        for (let c = rect.left; c <= rect.right; c += 1) { const col = columns[c]; const p = col ? clearNeighbourEdge(above.styles?.[col.id], "b") : null; if (col && p && (preset === "clear" || preset === "all" || preset === "outer" || preset === "top")) values[col.id] = patchStyle(above.styles?.[col.id], p); }
        if (Object.keys(values).length) edits.push({ rowId: above.id, values });
      }
      const leftCol = columns[rect.left - 1];
      if (leftCol && (preset === "clear" || preset === "all" || preset === "outer" || preset === "left")) {
        for (let r = rect.top; r <= rect.bottom; r += 1) {
          const row = view[r]?.row;
          const p = row ? clearNeighbourEdge(row.styles?.[leftCol.id], "r") : null;
          if (!row || !p) continue;
          const e = edits.find((x) => x.rowId === row.id);
          if (e) e.values[leftCol.id] = patchStyle(row.styles?.[leftCol.id], p);
        }
      }
    }
    onSetStyles(edits, t("borders"));
  };
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
    const allowed = keepValid(edits);
    if (allowed.length) onSetCells(allowed);
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
        const cell: ClipCell = { text, raw: raw ?? null, style: row.styles?.[col.id] ?? null };
        if (isFormulaCell(raw)) cell.formula = toDisplay(raw.f, data.shape);
        line.push(cell);
      }
      cells.push(line);
    }
    // Data validation travels with a NEXUS copy (like Sheets), as rule + block-relative rectangle.
    const rawTop = view[rect.top]?.rawIndex ?? 0, rawBottom = view[rect.bottom]?.rawIndex ?? 0;
    const contiguous = rawBottom - rawTop === rect.bottom - rect.top;
    const validations = contiguous ? explicitRules.flatMap((rule) => rule.ranges.flatMap((range) => {
      const rc = rangeRect(range, data.shape);
      if (!rc) return [];
      const top = Math.max(rc.top, rawTop), bottom = Math.min(rc.bottom, rawBottom);
      const left = Math.max(rc.left, rect.left), right = Math.min(rc.right, rect.right);
      if (top > bottom || left > right) return [];
      const { id: _id, ranges: _r, ...criteria } = rule;
      return [{ rule: criteria, r1: top - rawTop, r2: bottom - rawTop, c1: left - rect.left, c2: right - rect.left }];
    })) : [];
    const condFormats = contiguous ? (settings.condFormats ?? []).flatMap((rule) => rule.ranges.flatMap((range) => {
      const rc = rangeRect(range, data.shape);
      if (!rc) return [];
      const top = Math.max(rc.top, rawTop), bottom = Math.min(rc.bottom, rawBottom);
      const left = Math.max(rc.left, rect.left), right = Math.min(rc.right, rect.right);
      if (top > bottom || left > right) return [];
      const { id: _id, ranges: _r, ...criteria } = rule;
      return [{ rule: criteria as Record<string, unknown>, r1: top - rawTop, r2: bottom - rawTop, c1: left - rect.left, c2: right - rect.left }];
    })) : [];
    return buildClipboard(cells, { r: rawTop, c: rect.left }, cut, columns.slice(rect.left, rect.right + 1).map((c) => c.type), validations, {
      widths: columns.slice(rect.left, rect.right + 1).map((c) => c.width ?? COL_W_DEFAULT), condFormats,
    });
  }, [rect, view, columns, data, explicitRules, settings.condFormats]);

  /** Paste a block at the selection (one value onto a range fills it; formulas shift). */
  const applyPaste = useCallback(async (block: PasteBlock, opts: { stylesToo?: boolean } = {}) => {
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
    // A NEXUS→NEXUS paste brings the formatting along, like Sheets (Paste special › Values only doesn't).
    const styleEdits: StyleEdit[] = [];
    const withStyles = block.internal && opts.stylesToo !== false && cells.some((l) => l.some((c) => c.style !== undefined));
    cells.forEach((line, i) => {
      const target = working[startR + i];
      if (!target) return;
      const values: Record<string, unknown> = {};
      if (withStyles) {
        const sv: Record<string, CellStyle | null> = {};
        line.forEach((cell, j) => { const col = columns[startC + j]; if (col && cell.style !== undefined) sv[col.id] = (cell.style ?? null) as CellStyle | null; });
        if (Object.keys(sv).length) styleEdits.push({ rowId: target.row.id, values: sv });
      }
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
    const allowed = keepValid(edits);
    if (allowed.length) onSetCells(allowed);
    if (styleEdits.length) onSetStyles(styleEdits, t("paste format"));
    // Rules copied with the block land on the pasted cells.
    if (block.internal && block.validations?.length && !single) {
      const added: ValidationRule[] = [];
      for (const v of block.validations) {
        const top = working[startR + v.r1], bottom = working[startR + Math.min(v.r2, cells.length - 1)];
        const left = columns[startC + v.c1], right = columns[Math.min(maxC, startC + v.c2)];
        if (!top || !bottom || !left || !right) continue;
        added.push({ ...(v.rule as Omit<ValidationRule, "id" | "ranges">), id: newRuleId(), ranges: [`{${left.id}!${top.row.id}}:{${right.id}!${bottom.row.id}}`] });
      }
      if (added.length) onSettings({ validations: [...explicitRules, ...added] }, t("paste data validation"));
    }
    if (block.cut) consumeCut();
    setSel({
      r: startR, c: startC,
      r2: Math.min(view.length + Math.max(0, needed) - 1, startR + cells.length - 1),
      c2: Math.min(maxC, startC + Math.max(...cells.map((l) => l.length)) - 1),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, rect, view, rows.length, columns, onAddRows, onSetCells, maxC, filtering, data.shape, explicitRules, ruleAt, engine]);

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

  // ── Dropdowns and checkboxes ─────────────────────────────────────────────────────────────────
  const openDropdown = (rowId: string, colId: string) => {
    const r = gridRef.current?.querySelector(`[data-cell="${rowId}:${colId}"]`)?.getBoundingClientRect();
    if (r) setDropdown({ rowId, colId, rect: r });
  };
  const isCheckboxCell = (ri: number, ci: number) =>
    columns[ci]?.type === "checkbox" || ruleAt(view[ri]?.rawIndex ?? -1, ci)?.kind === "checkbox";
  /** Space (or Enter) on checkboxes: every checkbox in the selection takes the active one's opposite. */
  const toggleCheckboxes = () => {
    if (!canEdit) return;
    const aRow = view[sel.r]?.row, aCol = columns[sel.c];
    if (!aRow || !aCol) return;
    const aRule = ruleAt(view[sel.r].rawIndex, sel.c);
    const on = !(aCol.type === "checkbox" ? aRow.cells[aCol.id] === true : isChecked(aRule, aRow.cells[aCol.id]));
    const edits: { rowId: string; values: Record<string, unknown> }[] = [];
    for (let r = rect.top; r <= rect.bottom; r += 1) {
      const row = view[r]?.row;
      if (!row) continue;
      const values: Record<string, unknown> = {};
      for (let c = rect.left; c <= rect.right; c += 1) {
        const col = columns[c];
        if (!col || !isCheckboxCell(r, c)) continue;
        values[col.id] = col.type === "checkbox" ? on : checkboxValue(ruleAt(view[r].rawIndex, c), on);
      }
      if (Object.keys(values).length) edits.push({ rowId: row.id, values });
    }
    if (edits.length) onSetCells(edits);
  };
  /**
   * Open a cell the way its kind wants: a dropdown opens its list, a checkbox toggles (from the
   * keyboard), everything else opens the editor — `seed` is the key that started typing.
   */
  const openCell = (ri: number, ci: number, seed?: string, via: "key" | "mouse" = "key") => {
    const row = view[ri]?.row, col = columns[ci];
    if (!row || !col || !canEdit) return;
    if (!protectOk.current && protectedHere(view[ri].rawIndex, ci)) { guardProtected(() => { protectOk.current = true; openCell(ri, ci, seed, via); protectOk.current = false; }); return; }
    if (!seed) {
      if (isDropdown(ruleAt(view[ri].rawIndex, ci))) { openDropdown(row.id, col.id); return; }
      if (isCheckboxCell(ri, ci)) { if (via === "key") toggleCheckboxes(); return; }
    }
    setEditing({ rowId: row.id, colId: col.id, ...(seed ? { seed } : {}) });
  };

  // ── Data validation entry points ─────────────────────────────────────────────────────────────
  /** The selection as a stored range (whole columns when every row is selected). */
  const selectionStored = (): string | null => {
    const left = columns[rect.left], right = columns[rect.right];
    if (!left || !right) return null;
    if (rect.top === 0 && rect.bottom === maxR && naturalOrder && !hiddenRows.size) return `{${left.id}!*}:{${right.id}!*}`;
    const top = view[rect.top]?.row, bottom = view[rect.bottom]?.row;
    return top && bottom ? `{${left.id}!${top.id}}:{${right.id}!${bottom.id}}` : null;
  };
  const saveRules = (next: ValidationRule[], label: string) => onSettings({ validations: next.length ? next : null }, label);
  /** Insert › Dropdown: the selection's existing values become the items (else "Option 1, 2"). */
  const insertDropdown = () => {
    const range = selectionStored();
    if (!canEdit || !range) return;
    const seen = new Set<string>();
    for (let r = rect.top; r <= Math.min(rect.bottom, rect.top + 500); r += 1) {
      const row = view[r]?.row;
      for (let c = rect.left; c <= rect.right; c += 1) {
        const col = columns[c];
        const v = row && col ? row.cells[col.id] : undefined;
        if (typeof v === "string" && v.trim() && seen.size < 50) pickedValues(v).forEach((x) => seen.add(x));
      }
    }
    const rule: ValidationRule = { id: newRuleId(), ranges: [range], kind: "list", values: seen.size ? [...seen] : [t("Option 1"), t("Option 2")] };
    saveRules([...explicitRules, rule], t("insert dropdown"));
    setDvOpen(true);
    setDvEditId(rule.id);
  };
  /** Insert › Checkbox: a checkbox rule over the selection. */
  const insertCheckbox = () => {
    const range = selectionStored();
    if (!canEdit || !range) return;
    saveRules([...explicitRules, { id: newRuleId(), ranges: [range], kind: "checkbox" }], t("insert checkbox"));
  };
  /** Data › Data validation: the active cell's rule if it has one, else the list. */
  const openValidation = () => {
    const rule = activeRow ? ruleAt(view[sel.r]?.rawIndex ?? -1, sel.c) : null;
    setDvOpen(true);
    setDvEditId(rule ? rule.id : null);
  };
  /** Colours of the formatting palette mapped onto the header palette a dropdown COLUMN stores. */
  const toColumnColor = (c: string | undefined): NexusSheetColumnColor | undefined => {
    if (!c) return undefined;
    const map: Record<string, NexusSheetColumnColor> = {
      red: "rose", pink: "rose", rose: "rose", orange: "amber", amber: "amber", green: "green", teal: "green",
      blue: "blue", violet: "violet", slate: "slate", black: "slate",
    };
    return map[c];
  };
  const saveRuleFromPanel = (rule: PanelRule & { __new?: boolean }) => {
    const { __new, columnId, ...clean } = rule;
    if (columnId) {
      onEditColumn(columnId, {
        type: clean.multiple ? "multiselect" : "select",
        options: clean.values ?? [],
        optionColors: Object.fromEntries(Object.entries(clean.colors ?? {}).map(([k, v]) => [k, toColumnColor(v)]).filter(([, v]) => v)) as Record<string, NexusSheetColumnColor>,
      });
      return;
    }
    const exists = explicitRules.some((r) => r.id === clean.id);
    saveRules(exists ? explicitRules.map((r) => (r.id === clean.id ? clean : r)) : [...explicitRules, clean], t("data validation"));
    if (__new) setDvEditId(clean.id);
  };
  const removeRuleFromPanel = (rule: PanelRule) => {
    if (rule.columnId) { onEditColumn(rule.columnId, { type: "text" }); return; }
    saveRules(explicitRules.filter((r) => r.id !== rule.id), t("remove data validation"));
  };

  /** Help text of the active cell's rule, shown under it like Sheets' input message. */
  const activeRule = activeRow ? ruleAt(view[sel.r]?.rawIndex ?? -1, sel.c) : null;
  const [helpRect, setHelpRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!activeRule?.help || editing || dropdown || !activeRow || !activeCol) { setHelpRect(null); return; }
    const r = gridRef.current?.querySelector(`[data-cell="${activeRow.id}:${activeCol.id}"]`)?.getBoundingClientRect();
    setHelpRect(r ?? null);
  }, [activeRule?.help, editing, dropdown, activeRow, activeCol, scroll.top]);

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

  // ── Sheets-parity state: sidebars, dialogs, view preferences ────────────────────────────────
  const columnsRange = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const rowsRange = columnsRange;
  /** Which number-format kind to apply for a Format › Number item. */
  const applyNumberFormat = (key: string) => {
    if (key === "auto") applyStyle({ nf: null, dp: null, pt: null });
    else applyStyle({ nf: key, dp: null, pt: null });
  };
  const numberMenuItems = useMemo(
    () => numberFormatItems(settings.locale ?? "id-ID").map((x) => ({ key: x.key, label: x.label, example: x.example })),
    [settings.locale],
  );
  /** Merge as Sheets does: all, one block per column (vertical) or per row (horizontal), or unmerge. */
  const mergeAs = (kind: "all" | "vertical" | "horizontal" | "unmerge") => {
    if (!canEdit || !naturalOrder) return;
    if (kind === "unmerge" || (kind === "all" && mergedHere.length)) { toggleMerge(); return; }
    const current = (settings.merges ?? []).filter((m) => !mergedHere.some((x) => `${view[x.top].row.id}:${columns[x.left].id}` === `${m.r}:${m.c}`));
    const top = view[rect.top], bottom = view[rect.bottom];
    if (!top || !bottom) return;
    const rs = bottom.rawIndex - top.rawIndex + 1, cs = rect.right - rect.left + 1;
    const added = kind === "all"
      ? [{ r: top.row.id, c: columns[rect.left].id, rs, cs }]
      : kind === "vertical"
        ? columnsRange(rect.left, rect.right).map((c) => ({ r: top.row.id, c: columns[c].id, rs, cs: 1 }))
        : rowsRange(rect.top, rect.bottom).map((r) => ({ r: view[r].row.id, c: columns[rect.left].id, rs: 1, cs }));
    onSettings({ merges: [...current, ...added.filter((m) => m.rs * m.cs > 1)] }, t("merge cells"));
  };
  /** The table (Format › Convert to table) covering a cell, if any. */
  const tableAt = useCallback((rawRow: number, ci: number) => {
    for (const tb of settings.tables ?? []) {
      const rc = rangeRect(tb.range, data.shape);
      if (rc && rawRow >= rc.top && rawRow <= rc.bottom && ci >= rc.left && ci <= rc.right) return { table: tb, rc };
    }
    return null;
  }, [settings.tables, data.shape]);
  const convertToTable = () => {
    if (!canEdit) return;
    const rc = currentRegion();
    const range = storedOf(rc);
    if (!range) return;
    const names = new Set((settings.tables ?? []).map((x) => x.name.toUpperCase()));
    let k = 1; while (names.has(`TABLE${k}`)) k += 1;
    const types: Record<string, TableColumnType> = {};
    for (let c = rc.left; c <= rc.right; c += 1) {
      const col = columns[c];
      const sample = rowsRange(rc.top + 1, rc.bottom).map((r) => engine.value(view[r].row.id, col.id)).filter((v) => v !== null && v !== "");
      types[col.id] = sample.length && sample.every((v) => typeof v === "number") ? (engine.format(view[rc.top + 1].row.id, col.id) === "date" ? "date" : "number") : sample.every((v) => typeof v === "boolean") && sample.length ? "checkbox" : "text";
    }
    onSettings({ tables: [...(settings.tables ?? []), { id: newId("tb"), name: `Table${k}`, range, types }] }, t("convert to table"));
    setSel({ r: rc.top, c: rc.left, r2: rc.bottom, c2: rc.right });
  };
  const regionColumns = () => {
    const rc = settings.filter ? rangeRect(settings.filter.range, data.shape) : currentRegion();
    if (!rc) return [];
    const headRow = settings.filter ? rows[rc.top] : view[rc.top]?.row;
    return columnsRange(rc.left, rc.right).filter((c) => columns[c]).map((c) => {
      const col = columns[c];
      const head = headRow ? displayCell(col.type, headRow.cells[col.id], { data, rowId: headRow.id, colId: col.id }) : "";
      return { colId: col.id, label: head || `${t("Column")} ${colLetter(c)}` };
    });
  };
  /** Data › Create a filter / Remove filter (shared by everyone, like Sheets). */
  const toggleFilter = () => {
    if (!canEdit) return;
    if (settings.filter) { onSettings({ filter: null }, t("remove filter")); return; }
    const range = storedOf(currentRegion());
    if (range) onSettings({ filter: { range } }, t("create filter"));
  };
  /** Filter views: personal views of the data (the open one is per viewer, the list is shared). */
  const createFilterView = (groupBy: string | null, fromFilter = false) => {
    const base = fromFilter && settings.filter ? settings.filter : { range: storedOf(currentRegion()) ?? "" };
    if (!base.range) return;
    const n = (settings.filterViews ?? []).length + 1;
    const view0: FilterView = { ...base, id: newId("fv"), name: t("Filter {n}", { n }), ...(groupBy ? { sort: { colId: groupBy, dir: "asc" as const } } : {}) };
    if (canEdit) onSettings({ filterViews: [...(settings.filterViews ?? []), view0] }, t("create filter view"));
    setActiveView(view0.id);
  };
  const filterViewAction = (what: string) => {
    const list = settings.filterViews ?? [];
    const cur = list.find((v) => v.id === activeView);
    if (what === "deleteAll") { onSettings({ filterViews: null }, t("delete filter views")); setActiveView(null); return; }
    if (!cur) return;
    if (what === "rename") { const name = window.prompt(t("Rename view"), cur.name); if (name?.trim()) onSettings({ filterViews: list.map((v) => (v.id === cur.id ? { ...v, name: name.trim() } : v)) }, t("rename view")); return; }
    if (what === "duplicate") { const copy = { ...cur, id: newId("fv"), name: t("Copy of {name}", { name: cur.name }) }; onSettings({ filterViews: [...list, copy] }, t("duplicate view")); setActiveView(copy.id); return; }
    if (what === "delete") { onSettings({ filterViews: list.filter((v) => v.id !== cur.id).length ? list.filter((v) => v.id !== cur.id) : null }, t("delete view")); setActiveView(null); return; }
    if (what === "update") { const range = storedOf(rect); if (range) onSettings({ filterViews: list.map((v) => (v.id === cur.id ? { ...v, range } : v)) }, t("update view")); return; }
    if (what === "link" || what === "save") {
      const url = `${window.location.origin}${window.location.pathname}${window.location.search}#gid=${host?.sheetId ?? ""}&fvid=${cur.id}`;
      void navigator.clipboard?.writeText(url).then(() => setToast(t("Link copied to clipboard.")));
    }
  };
  const addSlicer = () => {
    const rc = settings.filter ? rangeRect(settings.filter.range, data.shape) : currentRegion();
    const range = rc ? (settings.filter?.range ?? storedOf(rc)) : null;
    const anchorRow = view[Math.max(0, rect.top)]?.row, anchorCol = columns[Math.min(maxC, (rc?.right ?? rect.right) + 1)] ?? columns[rect.left];
    if (!range || !anchorRow || !anchorCol || !rc) return;
    const sl: Slicer = { id: newId("sl"), range, colId: columns[rc.left].id, at: { r: anchorRow.id, c: anchorCol.id, dx: 8, dy: 4 } };
    onSettings({ slicers: [...(settings.slicers ?? []), sl] }, t("add slicer"));
    setPanel({ kind: "slicer", id: sl.id });
  };
  /** Data clean-up › Trim whitespace: acts at once, then says how many cells changed. */
  const trimWhitespace = () => {
    const edits: { rowId: string; values: Record<string, unknown> }[] = [];
    let n = 0;
    for (let r = rect.top; r <= rect.bottom; r += 1) {
      const row = view[r]?.row;
      if (!row) continue;
      const values: Record<string, unknown> = {};
      for (let c = rect.left; c <= rect.right; c += 1) {
        const col = columns[c];
        const v = col ? row.cells[col.id] : undefined;
        if (typeof v === "string") { const x = trimCell(v); if (x !== v) { values[col.id] = x || null; n += 1; } }
      }
      if (Object.keys(values).length) edits.push({ rowId: row.id, values });
    }
    if (edits.length) onSetCells(edits);
    setToast(n ? t("Trimmed whitespace from {n} cells.", { n }) : t("No whitespace to trim."));
  };
  /** Split text to columns: splits at once (auto-detected separator); the floating chooser re-splits. */
  const splitText = (sep: Parameters<typeof splitTextLib>[1]) => {
    if (!canEdit) return;
    const c = rect.left;
    const col = columns[c];
    if (!col) return;
    const texts = rowsRange(rect.top, rect.bottom).map((r) => { const v = view[r]?.row.cells[col.id]; return typeof v === "string" ? v : ""; });
    const resolved = sep === "auto" ? detectSeparator(texts) ?? "," : sep;
    const edits: { rowId: string; values: Record<string, unknown> }[] = [];
    let widest = 1;
    texts.forEach((text, i) => {
      if (!text) return;
      const parts = splitTextLib(text, resolved);
      widest = Math.max(widest, parts.length);
      const values: Record<string, unknown> = {};
      parts.forEach((p, j) => { const target = columns[c + j]; if (target) values[target.id] = inputToCell(target, p, data.shape); });
      edits.push({ rowId: view[rect.top + i].row.id, values });
    });
    if (c + widest - 1 > maxC) setToast(t("Some parts didn't fit: add columns to the right and split again."));
    if (edits.length) onSetCells(edits);
    const box = gridRef.current?.querySelector(`[data-cell="${view[rect.bottom]?.row.id}:${col.id}"]`)?.getBoundingClientRect();
    if (box) setSplitChip({ rect: box, sep });
  };
  /** Insert › Chart: a chart of the selection (or its data region), placed to the right, editor open. */
  const insertChart = () => {
    if (!canEdit) return;
    const rc = selInfo.single ? currentRegion() : { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    const range = storedOf(rc);
    if (!range) return;
    const picked = defaultChart({ top: view[rc.top].rawIndex, bottom: view[rc.bottom].rawIndex, left: rc.left, right: rc.right }, data, engine);
    const at = { r: view[rc.top].row.id, c: (columns[Math.min(maxC, rc.right + 1)] ?? columns[rc.right]).id, dx: 16, dy: 0 };
    const chart: ChartSpec = { id: newId("ch"), ranges: [range], at, w: 600, h: 371, ...picked };
    onSettings({ charts: [...(settings.charts ?? []), chart] }, t("insert chart"));
    setSelectedObject(chart.id);
    setPanel({ kind: "chart", id: chart.id });
  };
  /** Insert › Note (Shift+F2): the yellow sticky on the active cell. */
  const openNote = (editing: boolean) => {
    if (!activeRow || !activeCol) return;
    const box = gridRef.current?.querySelector(`[data-cell="${activeRow.id}:${activeCol.id}"]`)?.getBoundingClientRect();
    if (box) setNote({ rowId: activeRow.id, colId: activeCol.id, rect: box, editing });
  };
  // ── Menus: one dispatcher for the menu bar, right-click menus and "Search the menus" ─────────
  const selInfo = useMemo(() => {
    const r1 = (view[rect.top]?.rawIndex ?? rect.top) + 1, r2 = (view[rect.bottom]?.rawIndex ?? rect.bottom) + 1;
    return {
      r1, r2, c1: colLetter(rect.left), c2: colLetter(rect.right), colIndex: rect.right,
      nRows: rect.bottom - rect.top + 1, nCols: rect.right - rect.left + 1,
      single: rect.top === rect.bottom && rect.left === rect.right,
      wholeRows: rect.left === 0 && rect.right === maxC && maxC > 0,
      wholeCols: rect.top === 0 && rect.bottom === maxR && maxR > 0,
      activeRow: (view[sel.r]?.rawIndex ?? sel.r) + 1, activeCol: colLetter(sel.c),
    };
  }, [rect, view, sel.r, sel.c, maxC, maxR]);

  /** Write a block of values AND formats in one go (sorts, moves, shifts): one undo entry each. */
  const writeBlock = (cellEdits: { rowId: string; values: Record<string, unknown> }[], styleEdits: StyleEdit[], label: string) => {
    const cells = cellEdits.filter((e) => Object.keys(e.values).length);
    const styles = styleEdits.filter((e) => Object.keys(e.values).length);
    if (cells.length) onSetCells(cells);
    if (styles.length) onSetStyles(styles, label);
  };
  /** Move rows of a block around: `order[i]` is the view row whose content lands on view row top+i. */
  const permuteBlock = (top: number, order: number[], left: number, right: number, label: string) => {
    const cellEdits: { rowId: string; values: Record<string, unknown> }[] = [];
    const styleEdits: StyleEdit[] = [];
    order.forEach((src, i) => {
      const dst = top + i;
      if (src === dst) return;
      const from = view[src]?.row, to = view[dst]?.row;
      if (!from || !to) return;
      const values: Record<string, unknown> = {}, styles: Record<string, CellStyle | null> = {};
      for (let c = left; c <= right; c += 1) {
        const col = columns[c];
        if (!col) continue;
        const raw = from.cells[col.id];
        values[col.id] = isFormulaCell(raw)
          ? moveFormula(raw.f, { r: view[src].rawIndex, c }, { r: view[dst].rawIndex, c })
          : raw ?? null;
        styles[col.id] = from.styles?.[col.id] ?? null;
        if (JSON.stringify(to.styles?.[col.id] ?? null) === JSON.stringify(styles[col.id])) delete styles[col.id];
        if (sameCell(to.cells[col.id], values[col.id])) delete values[col.id];
      }
      cellEdits.push({ rowId: to.id, values });
      styleEdits.push({ rowId: to.id, values: styles });
    });
    writeBlock(cellEdits, styleEdits, label);
  };
  /** Sort the rows of the selection (range sort): by one or more columns, optionally skipping a header row. */
  const sortRange = (keys: { col: number; dir: "asc" | "desc" }[], header = false, within: { top: number; bottom: number; left: number; right: number } = rect) => {
    if (!canEdit) return;
    const top = within.top + (header ? 1 : 0);
    if (top > within.bottom) return;
    const idx = Array.from({ length: within.bottom - top + 1 }, (_, i) => top + i);
    const keyed = idx.map((r) => ({ r, k: keys.map((k) => sortKey(engine.value(view[r].row.id, columns[k.col]?.id ?? ""))) }));
    keyed.sort((a, b) => {
      for (let i = 0; i < keys.length; i += 1) {
        const x = a.k[i], y = b.k[i], dir = keys[i].dir === "asc" ? 1 : -1;
        if (!x || !y) { if (!x && !y) continue; return !x ? 1 : -1; }
        if ("n" in x && "n" in y) { if (x.n !== y.n) return (x.n - y.n) * dir; continue; }
        if ("n" in x) return -dir;
        if ("n" in y) return dir;
        const c = x.s.localeCompare(y.s, "id", { sensitivity: "base" });
        if (c) return c * dir;
      }
      return a.r - b.r;
    });
    permuteBlock(top, keyed.map((x) => x.r), within.left, within.right, t("sort range"));
  };
  /** Data › Sort sheet: rows below the frozen ones change places for real (saved, like Sheets). */
  const sortSheet = (dir: "asc" | "desc") => {
    const col = columns[sel.c];
    if (!canEdit || !col || !host) return;
    const body = rows.filter((_r, i) => i >= frozenRowsSetting);
    const keyed = body.map((r, i) => ({ id: r.id, i, k: sortKey(engine.value(r.id, col.id)) }));
    const d = dir === "asc" ? 1 : -1;
    keyed.sort((a, b) => {
      if (!a.k || !b.k) return !a.k && !b.k ? a.i - b.i : !a.k ? 1 : -1;
      if ("n" in a.k && "n" in b.k) return (a.k.n - b.k.n) * d || a.i - b.i;
      if ("n" in a.k) return -d;
      if ("n" in b.k) return d;
      return a.k.s.localeCompare(b.k.s, "id", { sensitivity: "base" }) * d || a.i - b.i;
    });
    void host.reorderRows(keyed.map((x) => x.id), body.map((r) => r.id), t("sort sheet"));
  };
  /** Insert › Cells (shift down/right) and Edit › Delete › Cells (shift up/left) move values within the block's rows or columns. */
  const shiftCells = async (dir: "down" | "up" | "right" | "left") => {
    if (!canEdit) return;
    const nR = rect.bottom - rect.top + 1, nC = rect.right - rect.left + 1;
    const cellEdits: { rowId: string; values: Record<string, unknown> }[] = [];
    const styleEdits: StyleEdit[] = [];
    const put = (rowId: string, colId: string, raw: unknown, st: CellStyle | null | undefined) => {
      let ce = cellEdits.find((e) => e.rowId === rowId); if (!ce) { ce = { rowId, values: {} }; cellEdits.push(ce); }
      let se = styleEdits.find((e) => e.rowId === rowId); if (!se) { se = { rowId, values: {} }; styleEdits.push(se); }
      ce.values[colId] = raw ?? null;
      se.values[colId] = st ?? null;
    };
    if (dir === "down" || dir === "up") {
      let last = view.length - 1;
      while (last > rect.top && columns.slice(rect.left, rect.right + 1).every((c) => view[last]?.row.cells[c.id] === undefined)) last -= 1;
      let list = view;
      if (dir === "down" && last + nR > view.length - 1) {
        const created = await onAddRows({ count: last + nR - (view.length - 1) });
        list = [...view, ...created.map((row, i) => ({ row, rawIndex: rows.length + i }))];
      }
      for (let c = rect.left; c <= rect.right; c += 1) {
        const col = columns[c];
        if (!col) continue;
        if (dir === "down") {
          for (let r = last + nR; r >= rect.top; r -= 1) {
            const src = r - nR >= rect.top ? list[r - nR]?.row : null;
            const dst = list[r]?.row;
            if (dst) put(dst.id, col.id, src ? src.cells[col.id] : null, src ? src.styles?.[col.id] : null);
          }
        } else {
          for (let r = rect.top; r <= last; r += 1) {
            const src = list[r + nR]?.row;
            const dst = list[r]?.row;
            if (dst) put(dst.id, col.id, src ? src.cells[col.id] : null, src ? src.styles?.[col.id] : null);
          }
        }
      }
    } else {
      for (let r = rect.top; r <= rect.bottom; r += 1) {
        const row = view[r]?.row;
        if (!row) continue;
        if (dir === "right") {
          const spill = columns.slice(columns.length - nC).some((c) => row.cells[c.id] !== undefined);
          if (spill) { alert(t("There's data in the last columns. Add columns first, then insert cells.")); return; }
          for (let c = columns.length - 1; c >= rect.left; c -= 1) {
            const src = c - nC >= rect.left ? columns[c - nC] : null;
            put(row.id, columns[c].id, src ? row.cells[src.id] : null, src ? row.styles?.[src.id] : null);
          }
        } else {
          for (let c = rect.left; c < columns.length; c += 1) {
            const src = columns[c + nC];
            put(row.id, columns[c].id, src ? row.cells[src.id] : null, src ? row.styles?.[src.id] : null);
          }
        }
      }
    }
    for (const e of cellEdits) for (const [k, v] of Object.entries(e.values)) {
      const before = rows.find((r) => r.id === e.rowId)?.cells[k];
      if (sameCell(before, v)) delete e.values[k];
    }
    for (const e of styleEdits) for (const [k, v] of Object.entries(e.values)) {
      const before = rows.find((r) => r.id === e.rowId)?.styles?.[k];
      if (JSON.stringify(before ?? null) === JSON.stringify(v ?? null)) delete e.values[k];
    }
    writeBlock(cellEdits, styleEdits, t("shift cells"));
  };
  /** Edit › Move: rows/columns of the selection one step up/down/left/right. */
  const moveRowsBy = (d: -1 | 1) => {
    const top = view[rect.top]?.row, bottom = view[rect.bottom]?.row;
    if (!top || !bottom) return;
    if (d === -1) {
      const above = view[rect.top - 1]?.row;
      if (!above) return;
      onReorderRow(above.id, bottom.id);
      setSel((s) => ({ ...s, r: s.r - 1, r2: s.r2 - 1 }));
    } else {
      const below = view[rect.bottom + 1]?.row;
      if (!below) return;
      onReorderRow(below.id, view[rect.top - 1]?.row.id ?? null);
      setSel((s) => ({ ...s, r: s.r + 1, r2: s.r2 + 1 }));
    }
  };
  const moveColsBy = (d: -1 | 1) => {
    if (!host) return;
    const ids = columns.map((c) => c.id);
    const block = ids.slice(rect.left, rect.right + 1);
    const rest = [...ids.slice(0, rect.left), ...ids.slice(rect.right + 1)];
    const at = Math.max(0, Math.min(rest.length, rect.left + d));
    if (at === rect.left) return;
    host.reorderColumns([...rest.slice(0, at), ...block, ...rest.slice(at)]);
    setSel((s) => ({ ...s, c: s.c + d, c2: s.c2 + d }));
  };
  /** Freeze rows — refused when the line would cut through a merged block (Sheets' "There was a problem"). */
  const freezeRowsSafe = (n: number) => {
    if (n > 0) {
      const cut = (settings.merges ?? []).some((m) => {
        const r0 = rows.findIndex((r) => r.id === m.r);
        return r0 >= 0 && r0 < n && r0 + m.rs > n;
      });
      if (cut) { setProblem(t("Sorry, you can't freeze rows that contain only part of a merged cell.")); return; }
    }
    setFrozenRows(n);
  };
  const freezeColsSafe = (n: number) => {
    if (n > 0) {
      const cut = (settings.merges ?? []).some((m) => {
        const c0 = columns.findIndex((c) => c.id === m.c);
        return c0 >= 0 && c0 < n && c0 + m.cs > n;
      });
      if (cut) { setProblem(t("Sorry, you can't freeze columns that contain only part of a merged cell.")); return; }
    }
    setFrozenCols(n);
  };
  /** View › Group: rows (or columns) of the selection become a collapsible group. */
  const groupSel = (axis: "row" | "col", on: boolean) => {
    const key = axis === "row" ? "rowGroups" : "colGroups";
    const from = axis === "row" ? view[rect.top]?.row.id : columns[rect.left]?.id;
    const to = axis === "row" ? view[rect.bottom]?.row.id : columns[rect.right]?.id;
    if (!from || !to) return;
    const list = (settings[key] ?? []) as { id: string; from: string; to: string; collapsed?: true }[];
    if (on) onSettings({ [key]: [...list, { id: newId("gr"), from, to }] }, t("group"));
    else {
      const next = list.filter((g) => !(g.from === from && g.to === to));
      const fallback = next.length === list.length ? list.slice(0, -1) : next;
      onSettings({ [key]: fallback.length ? fallback : null }, t("ungroup"));
    }
  };
  /** Paste special. */
  const pasteSpecial = (kind: string) => {
    readClipboardAsync().then((block) => {
      if (!block) return;
      if (kind === "values") { void applyPaste({ cells: block.cells.map((r) => r.map((c) => ({ text: c.text }))), internal: false }); return; }
      if (kind === "transpose") {
        const h = block.cells.length, w = Math.max(...block.cells.map((r) => r.length));
        const cells = Array.from({ length: w }, (_, j) => Array.from({ length: h }, (_, i) => ({ ...(block.cells[i]?.[j] ?? { text: "" }), formula: undefined })));
        void applyPaste({ ...block, cells, origin: undefined });
        return;
      }
      if (kind === "formula") { void applyPaste({ ...block, cells: block.cells.map((r) => r.map((c) => (c.formula ? c : { ...c, style: undefined }))) }, { stylesToo: false }); return; }
      if (kind === "widths") {
        if (!block.widths) return;
        block.widths.forEach((w, j) => { const col = columns[rect.left + j]; if (col && w) onEditColumn(col.id, { width: w }); });
        return;
      }
      if (kind === "format" || kind === "noBorders") {
        if (!block.internal) return;
        const edits: StyleEdit[] = [];
        block.cells.forEach((line, i) => {
          const row = view[rect.top + i]?.row;
          if (!row) return;
          const values: Record<string, CellStyle | null> = {};
          line.forEach((cell, j) => {
            const col = columns[rect.left + j];
            if (!col) return;
            let st = (cell.style ?? null) as CellStyle | null;
            if (kind === "noBorders" && st) st = patchStyle(st, { bd: null, bx: null });
            values[col.id] = st;
          });
          edits.push({ rowId: row.id, values });
        });
        if (kind === "noBorders") void applyPaste(block, { stylesToo: false });
        onSetStyles(edits, t("paste format"));
        return;
      }
      if (kind === "cf" && block.condFormats?.length) {
        const added = block.condFormats.flatMap((v) => {
          const top = view[rect.top + v.r1], bottom = view[rect.top + v.r2], left = columns[rect.left + v.c1], right = columns[rect.left + v.c2];
          return top && bottom && left && right ? [{ ...(v.rule as Omit<CondRule, "id" | "ranges">), id: newId("cf"), ranges: [`{${left.id}!${top.row.id}}:{${right.id}!${bottom.row.id}}`] } as CondRule] : [];
        });
        if (added.length) onSettings({ condFormats: [...(settings.condFormats ?? []), ...added] }, t("paste conditional formatting"));
        return;
      }
      if (kind === "dv" && block.validations?.length) {
        const added: ValidationRule[] = [];
        for (const v of block.validations) {
          const top = view[rect.top + v.r1], bottom = view[rect.top + v.r2], left = columns[rect.left + v.c1], right = columns[rect.left + v.c2];
          if (top && bottom && left && right) added.push({ ...(v.rule as Omit<ValidationRule, "id" | "ranges">), id: newRuleId(), ranges: [`{${left.id}!${top.row.id}}:{${right.id}!${bottom.row.id}}`] });
        }
        if (added.length) onSettings({ validations: [...explicitRules, ...added] }, t("paste data validation"));
      }
    }).catch(() => clipboardBlocked("Ctrl+V / ⌘V"));
  };
  /** A cell holds something (value, formula, non-empty multi-select). */
  const filledAt = (r: number, c: number) => {
    const row = view[r]?.row;
    const col = columns[c];
    if (!row || !col) return false;
    const v = row.cells[col.id];
    return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length);
  };
  /** The block around the selection that holds data (Sheets picks it for "Create a filter" on one cell). */
  const currentRegion = () => {
    if (!selInfo.single) return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    let { top, bottom, left, right } = rect;
    const filled = (r: number, c: number) => filledAt(r, c);
    let grew = true;
    while (grew) {
      grew = false;
      if (top > 0 && columnsRange(left, right).some((c) => filled(top - 1, c))) { top -= 1; grew = true; }
      if (bottom < maxR && columnsRange(left, right).some((c) => filled(bottom + 1, c))) { bottom += 1; grew = true; }
      if (left > 0 && rowsRange(top, bottom).some((r) => filled(r, left - 1))) { left -= 1; grew = true; }
      if (right < maxC && rowsRange(top, bottom).some((r) => filled(r, right + 1))) { right += 1; grew = true; }
    }
    return { top, bottom, left, right };
  };
  const storedOf = (rc: { top: number; bottom: number; left: number; right: number }) => {
    const a = view[rc.top]?.row, b = view[rc.bottom]?.row, l = columns[rc.left], r = columns[rc.right];
    return a && b && l && r ? `{${l.id}!${a.id}}:{${r.id}!${b.id}}` : null;
  };
  const print = () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(sheetName ?? "Sheet")}</title><style>body{font:11px system-ui,sans-serif;margin:12mm}table{border-collapse:collapse}td{border:1px solid #ccc;padding:2px 5px;vertical-align:bottom;white-space:pre}</style></head><body><table>`
      + view.filter(({ row }) => columns.some((c) => row.cells[c.id] !== undefined)).map(({ row }) => `<tr>${columns.filter((_c, i) => !colHidden(i)).map((c) => `<td>${escapeHtml(displayCell(c.type, row.cells[c.id], { data, rowId: row.id, colId: c.id }))}</td>`).join("")}</tr>`).join("")
      + `</table></body></html>`;
    const frame = document.createElement("iframe");
    frame.style.position = "fixed"; frame.style.width = "0"; frame.style.height = "0"; frame.style.border = "0";
    document.body.appendChild(frame);
    frame.contentDocument?.open(); frame.contentDocument?.write(html); frame.contentDocument?.close();
    setTimeout(() => { frame.contentWindow?.focus(); frame.contentWindow?.print(); setTimeout(() => frame.remove(), 1000); }, 50);
  };

  const act = (a: MenuAction, arg?: unknown) => {
    const firstRow = view[rect.top]?.row, lastRow = view[rect.bottom]?.row;
    switch (a) {
      case "import": host?.importFile(); return;
      case "download": if (arg === "pdf") print(); else host?.download(arg as "xlsx" | "csv" | "tsv" | "html"); return;
      case "renameSheet": host?.renameSheet(); return;
      case "nameVersion": {
        const name = window.prompt(t("Name this version"), "");
        if (name?.trim()) onSettings({ versions: [...(settings.versions ?? []), { id: newId("vr"), name: name.trim(), at: new Date().toISOString() }] }, t("name version"));
        return;
      }
      case "versionHistory": setPanel({ kind: "versions" }); return;
      case "settings": setDialog({ kind: "settings" }); return;
      case "print": print(); return;
      case "undo": onUndo(); return;
      case "redo": onRedo(); return;
      case "cut": void writeClipboardAsync(clipSelection(true)).then(clearSelection).catch(() => clipboardBlocked("Ctrl+X / ⌘X")); return;
      case "copy": void writeClipboardAsync(clipSelection(false)).catch(() => clipboardBlocked("Ctrl+C / ⌘C")); return;
      case "paste": pasteVia(false)(); return;
      case "pasteSpecial": pasteSpecial(String(arg)); return;
      case "moveRows": moveRowsBy(arg as -1 | 1); return;
      case "moveCols": moveColsBy(arg as -1 | 1); return;
      case "deleteValues": clearSelection(); return;
      case "deleteRows": onDeleteRows(view.slice(rect.top, rect.bottom + 1).map((v) => v.row.id)); return;
      case "deleteCols": {
        const ids = columns.slice(rect.left, rect.right + 1).map((c) => c.id);
        if (ids.length === 1) onDeleteColumn(ids[0]); else host?.deleteColumns(ids);
        return;
      }
      case "deleteCellsUp": void shiftCells("up"); return;
      case "deleteCellsLeft": void shiftCells("left"); return;
      case "insertCellsDown": void shiftCells("down"); return;
      case "insertCellsRight": void shiftCells("right"); return;
      case "deleteNotes": styleSelection((st) => patchStyle(st, { nt: null }), t("delete notes")); return;
      case "findReplace": setDialog({ kind: "find" }); return;
      case "toggleFormulaBar": setPrefs((p) => ({ ...p, fx: !p.fx })); return;
      case "toggleGridlines": onSettings({ noGrid: settings.noGrid ? null : true }, t("gridlines")); return;
      case "toggleFormulas": setPrefs((p) => ({ ...p, formulas: !p.formulas })); return;
      case "toggleProtected": setPrefs((p) => ({ ...p, protectedShown: !p.protectedShown })); return;
      case "toggleComments": setPrefs((p) => ({ ...p, commentsHidden: !p.commentsHidden })); return;
      case "showAllComments": setPanel({ kind: "comments" }); return;
      case "freezeRows": freezeRowsSafe(Number(arg)); return;
      case "freezeCols": freezeColsSafe(Number(arg)); return;
      case "groupRows": groupSel("row", true); return;
      case "ungroupRows": groupSel("row", false); return;
      case "groupCols": groupSel("col", true); return;
      case "ungroupCols": groupSel("col", false); return;
      case "unhideSheet": host?.setSheetHidden(String(arg), false); return;
      case "zoom": setZoom(Number(arg)); return;
      case "fullScreen": setFull((f) => !f); return;
      case "insertRowsAbove": if (firstRow) void onAddRows({ count: rect.bottom - rect.top + 1, beforeRowId: firstRow.id }); return;
      case "insertRowsBelow": if (lastRow) void onAddRows({ count: rect.bottom - rect.top + 1, afterRowId: lastRow.id }); return;
      case "insertColsLeft": onInsertColumn(rect.left, rect.right - rect.left + 1); return;
      case "insertColsRight": onInsertColumn(rect.right + 1, rect.right - rect.left + 1); return;
      case "insertSheet": host?.insertSheet(); return;
      case "insertChart": insertChart(); return;
      case "insertPivot": setDialog({ kind: "pivot" }); return;
      case "insertFunction": insertFunction(String(arg)); return;
      case "insertLink": insertLink(); return;
      case "insertCheckbox": insertCheckbox(); return;
      case "insertDropdown": insertDropdown(); return;
      case "insertComment": openCommentsAt(sel.r, sel.c); return;
      case "insertNote": openNote(true); return;
      case "theme": setPanel({ kind: "theme" }); return;
      case "numberFormat": applyNumberFormat(String(arg)); return;
      case "customFormat": setDialog({ kind: String(arg) as "customNumber" | "customDate" | "customCurrency" }); return;
      case "style": applyStyle(arg as Partial<Record<keyof CellStyle, unknown>>); return;
      case "fontSize": applyStyle({ fp: Number(arg) === 10 ? null : Number(arg), fs: null }); return;
      case "merge": mergeAs(arg as "all" | "vertical" | "horizontal" | "unmerge"); return;
      case "convertTable": convertToTable(); return;
      case "condFormat": setPanel({ kind: "cf" }); return;
      case "alternating": setPanel({ kind: "alt" }); return;
      case "clearFormat": clearFormat(); return;
      case "sortSheet": sortSheet(arg as "asc" | "desc"); return;
      case "sortRange": sortRange([{ col: rect.left, dir: arg as "asc" | "desc" }]); return;
      case "sortAdvanced": setDialog({ kind: "sort" }); return;
      case "toggleFilter": toggleFilter(); return;
      case "filterViewGroupBy": createFilterView(String(arg)); return;
      case "filterViewCreate": createFilterView(null); return;
      case "filterViewSaveAs": createFilterView(null, true); return;
      case "filterViewOpen": setActiveView((arg as string | null) ?? null); return;
      case "filterViewAction": filterViewAction(String(arg)); return;
      case "slicer": addSlicer(); return;
      case "protect": setPanel({ kind: "protect" }); return;
      case "protectRange": setPanel({ kind: "protect", fromSelection: true }); return;
      case "namedRanges": setPanel({ kind: "named" }); return;
      case "defineNamed": setPanel({ kind: "named", fromSelection: true }); return;
      case "randomize": {
        const idx = Array.from({ length: rect.bottom - rect.top + 1 }, (_, i) => rect.top + i);
        for (let i = idx.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
        permuteBlock(rect.top, idx, rect.left, rect.right, t("randomise range"));
        return;
      }
      case "columnStats": setPanel({ kind: "stats", col: sel.c }); return;
      case "validation": openValidation(); return;
      case "removeDuplicates": setDialog({ kind: "dedupe" }); return;
      case "trimWhitespace": trimWhitespace(); return;
      case "splitText": splitText("auto"); return;
      case "calcMode": setPrefs((p) => ({ ...p, manual: Boolean(arg) })); return;
      case "searchMenus": setMenuSearch(true); return;
      case "functionList": setDialog({ kind: "functions" }); return;
      case "shortcuts": setDialog({ kind: "shortcuts" }); return;
      case "hideRows": hideRows(rect.top, rect.bottom); return;
      case "hideCols": hideColumns(rect.left, rect.right); return;
      case "clearRows": case "clearCols": clearSelection(); return;
      case "resizeRows": case "resizeCols": setDialog({ kind: a === "resizeRows" ? "resizeRows" : "resizeCols" }); return;
      case "fitToData": for (let c = rect.left; c <= rect.right; c += 1) autofit(c); return;
      case "cellLink": {
        const url = `${window.location.origin}${window.location.pathname}${window.location.search}#gid=${host?.sheetId ?? ""}&range=${nameBox}`;
        void navigator.clipboard?.writeText(url).then(() => setToast(t("Link copied to clipboard.")));
        return;
      }
      case "autocomplete": return;
    }
  };
  // ── Popovers, sidebars and floating objects ───────────────────────────────────────────────────
  const [noteHover, setNoteHover] = useState<{ rowId: string; colId: string; rect: DOMRect } | null>(null);
  const onNoteHover = useCallback((rowId: string, colId: string, r: DOMRect | null) => setNoteHover(r ? { rowId, colId, rect: r } : null), []);
  const [headerMenu, setHeaderMenu] = useState<{ ci: number; rect: DOMRect } | null>(null);
  const onHeaderMenu = useCallback((ci: number, r: DOMRect) => setHeaderMenu({ ci, rect: r }), []);
  const [tableMenu, setTableMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [slicerMenu, setSlicerMenu] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [datePick, setDatePick] = useState<{ rowId: string; colId: string; rect: DOMRect; value: number | null } | null>(null);
  const [protectWarn, setProtectWarn] = useState<null | (() => void)>(null);
  const protectMuteUntil = useRef(0);
  const theme = themePreview ?? settings.theme;
  const themeStandard = theme?.accents?.length ? ["#000000", "#ffffff", ...theme.accents].slice(0, 8) : STANDARD_THEME;
  const selectionA1 = (() => { const r = selectionStored(); return r ? rangeToA1(r, data.shape) : ""; })();

  /** Row-group gutter: a bracket beside grouped rows, [–] under the group, [+] where a collapsed one sits. */
  const rowGutter = useMemo(() => {
    const out = new Map<string, ReactNode>();
    const groups = settings.rowGroups ?? [];
    if (!groups.length) return out;
    const idx = new Map(rows.map((r, i) => [r.id, i]));
    const toggle = (id: string) => onSettings({ rowGroups: groups.map((g) => (g.id === id ? { ...g, collapsed: g.collapsed ? undefined : true as const } : g)) }, t("group"));
    for (const g of groups) {
      const a = idx.get(g.from), b = idx.get(g.to);
      if (a === undefined || b === undefined) continue;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      if (g.collapsed) {
        const after = rows[hi + 1] ?? rows[lo - 1];
        if (after) out.set(after.id, (
          <button onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggle(g.id); }} aria-label={t("Expand group")} title={t("Expand group")}
            className="absolute left-0.5 top-1/2 z-10 grid h-3 w-3 -translate-y-1/2 place-items-center rounded-[2px] border border-muted-foreground/60 bg-card text-muted-foreground"><Plus className="h-2 w-2" /></button>
        ));
        continue;
      }
      for (let i = lo; i <= hi; i += 1) {
        const last = i === hi;
        out.set(rows[i].id, (
          <>
            <span aria-hidden className={cn("absolute left-[7px] w-px bg-muted-foreground/50", i === lo ? "top-1/2" : "top-0", last ? "bottom-1/2" : "bottom-0")} />
            {last && (
              <button onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggle(g.id); }} aria-label={t("Collapse group")} title={t("Collapse group")}
                className="absolute left-0.5 top-1/2 z-10 grid h-3 w-3 -translate-y-1/2 place-items-center rounded-[2px] border border-muted-foreground/60 bg-card text-muted-foreground"><Minus className="h-2 w-2" /></button>
            )}
          </>
        ));
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.rowGroups, rows]);
  /** The [–]/[+] of a column group sits in the header of its last column (or the one after a collapsed group). */
  const colGroupMark = (ci: number): ReactNode => {
    for (const g of settings.colGroups ?? []) {
      const a = columns.findIndex((c) => c.id === g.from), b = columns.findIndex((c) => c.id === g.to);
      if (a < 0 || b < 0) continue;
      const hi = Math.max(a, b);
      const here = g.collapsed ? ci === Math.min(columns.length - 1, hi + 1) : ci === hi;
      if (!here) continue;
      const toggle = () => onSettings({ colGroups: (settings.colGroups ?? []).map((x) => (x.id === g.id ? { ...x, collapsed: x.collapsed ? undefined : true as const } : x)) }, t("group"));
      return (
        <button onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggle(); }} aria-label={g.collapsed ? t("Expand group") : t("Collapse group")}
          className="absolute left-0.5 top-0.5 z-10 grid h-3 w-3 place-items-center rounded-[2px] border border-muted-foreground/60 bg-card text-muted-foreground">
          {g.collapsed ? <Plus className="h-2 w-2" /> : <Minus className="h-2 w-2" />}
        </button>
      );
    }
    return null;
  };

  /** Where a floating object (chart, slicer) sits, in unzoomed px inside the scroll area. */
  const viewIndexOf = useMemo(() => new Map(view.map((v, i) => [v.row.id, i])), [view]);
  const anchorXY = (at: { r: string; c: string; dx?: number; dy?: number }) => {
    const ci = columns.findIndex((c) => c.id === at.c);
    const vi = viewIndexOf.get(at.r);
    if (ci < 0 || vi === undefined) return null;
    return { x: (lefts[ci] ?? 0) + (at.dx ?? 0), y: headH + (offsets[vi] ?? 0) + (at.dy ?? 0) };
  };
  const anchorFromXY = (x: number, y: number) => {
    let ci = 0;
    while (ci < columns.length - 1 && (lefts[ci + 1] ?? Infinity) <= x) ci += 1;
    let vi = 0;
    while (vi < view.length - 1 && headH + offsets[vi + 1] <= y) vi += 1;
    return { r: view[vi]?.row.id ?? view[0]?.row.id ?? "", c: columns[ci].id, dx: Math.round(x - (lefts[ci] ?? 0)), dy: Math.round(y - headH - (offsets[vi] ?? 0)) };
  };
  const saveChart = (next: ChartSpec, label = t("edit chart")) =>
    onSettings({ charts: (settings.charts ?? []).map((c) => (c.id === next.id ? next : c)) }, label);
  /** Chart editor edits arrive per keystroke: shown at once, saved after a pause (one undo entry). */
  const chartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [chartDraft, setChartDraft] = useState<ChartSpec | null>(null);
  const editChart = (next: ChartSpec) => {
    setChartDraft(next);
    if (chartTimer.current) clearTimeout(chartTimer.current);
    chartTimer.current = setTimeout(() => { saveChart(next); setChartDraft(null); }, 600);
  };
  const chartsShown = (settings.charts ?? []).map((c) => (chartDraft && chartDraft.id === c.id ? chartDraft : c));

  /** Filter menu (funnel on a header): criteria saved on the open view, or the shared filter. */
  const saveFilter = (next: SheetFilter) => {
    if (activeView) onSettings({ filterViews: (settings.filterViews ?? []).map((v) => (v.id === activeView ? { ...v, ...next } : v)) }, t("filter"));
    else onSettings({ filter: next }, t("filter"));
  };
  const filterBodyIds = () => {
    const rc = filterResult.main?.rect;
    return rc ? rows.slice(rc.top + 1, rc.bottom + 1).map((r) => r.id) : [];
  };

  /** Spreadsheet-wide settings (File › Settings) apply to every sheet of the project. */
  const valuesOfColumn = useCallback((ci: number) => {
    const col = columns[ci];
    return col ? rows.map((r) => ({ value: engine.value(r.id, col.id), text: displayCell(col.type, r.cells[col.id], { data, rowId: r.id, colId: col.id }) })) : [];
  }, [columns, rows, engine, data]);

  /**
   * Protected ranges: "Show a warning" ranges ask first (Sheets' "Heads up!"); restricted ones the
   * user isn't an editor of are refused here and by the server.
   */
  const protectOk = useRef(false);
  const protectedHere = (rawRow: number, ci: number): "warn" | "deny" | null => {
    let out: "warn" | "deny" | null = null;
    for (const pr of settings.protections ?? []) {
      const inside = pr.sheet
        ? !(pr.except ?? []).some((x) => { const rc = rangeRect(x, data.shape); return rc && rawRow >= rc.top && rawRow <= rc.bottom && ci >= rc.left && ci <= rc.right; })
        : (() => { const rc = pr.range ? rangeRect(pr.range, data.shape) : null; return Boolean(rc && rawRow >= rc.top && rawRow <= rc.bottom && ci >= rc.left && ci <= rc.right); })();
      if (!inside) continue;
      if (pr.mode === "restrict") {
        const me = host?.meId ?? "";
        if (pr.by === me || pr.editors?.includes(me) || canManage) continue;
        return "deny";
      }
      out = "warn";
    }
    return out;
  };
  const guardProtected = (go: () => void) => {
    const hit = protectedHere(view[sel.r]?.rawIndex ?? 0, sel.c);
    if (hit === "deny") { setProblem(t("This cell is protected. Ask its owner if you need to change it.")); return; }
    if (!hit || Date.now() < protectMuteUntil.current) { go(); return; }
    setProtectWarn(() => go);
  };
  // ── Find and replace (dialog) ─────────────────────────────────────────────────────────────────
  const findCells = (o: FindOpts) => {
    const hits: { r: number; c: number }[] = [];
    if (!o.find) return hits;
    const inRange = (r: number, c: number) => o.scope !== "range" || (r >= rect.top && r <= rect.bottom && c >= rect.left && c <= rect.right);
    view.forEach(({ row }, r) => columns.forEach((col, c) => {
      if (!inRange(r, c)) return;
      const raw = row.cells[col.id];
      if (raw === undefined || raw === null) return;
      const text = isFormula(raw)
        ? (o.formulas ? editFormula(raw, data.shape) ?? "" : displayCell(col.type, raw, { data, rowId: row.id, colId: col.id }))
        : isLinkCell(raw) && o.links ? `${raw.t} ${raw.u}` : editValue(col.type, raw);
      if (textMatches(text, o)) hits.push({ r, c });
    }));
    return hits;
  };
  const findNext = (o: FindOpts): number => {
    const hits = findCells(o);
    if (!hits.length) return 0;
    const at = hits.findIndex((h) => h.r > sel.r || (h.r === sel.r && h.c > sel.c));
    const next = hits[at < 0 ? 0 : at];
    setSel({ r: next.r, c: next.c, r2: next.r, c2: next.c });
    return hits.length;
  };
  const replaceIn = (o: FindOpts, only?: { r: number; c: number }) => {
    if (!canEdit) return 0;
    const hits = only ? [only] : findCells(o);
    const edits: { rowId: string; values: Record<string, unknown> }[] = [];
    let count = 0;
    for (const h of hits) {
      const row = view[h.r]?.row, col = columns[h.c];
      if (!row || !col) continue;
      const raw = row.cells[col.id];
      if (isFormula(raw)) {
        if (!o.formulas) continue;
        const text = editFormula(raw, data.shape) ?? "";
        const res = replaceText(text, o);
        if (!res.count) continue;
        count += res.count;
        edits.push({ rowId: row.id, values: { [col.id]: res.text.startsWith("=") ? { f: toStored(res.text, data.shape) } : inputToCell(col, res.text, data.shape, raw) } });
        continue;
      }
      const text = editValue(col.type, raw);
      const res = replaceText(text, o);
      if (!res.count) continue;
      count += res.count;
      const next = isLinkCell(raw) ? (res.text.trim() ? { t: res.text, u: raw.u } : null) : inputToCell(col, res.text, data.shape, raw);
      const e = edits.find((x) => x.rowId === row.id);
      if (e) e.values[col.id] = next; else edits.push({ rowId: row.id, values: { [col.id]: next } });
    }
    if (edits.length) onSetCells(edits);
    return count;
  };
  const replaceOne = (o: FindOpts): number => {
    const hits = findCells(o);
    const here = hits.find((h) => h.r === sel.r && h.c === sel.c);
    if (!here) return findNext(o) ? 0 : 0;
    const n = replaceIn(o, here);
    findNext(o);
    return n;
  };
  const replaceEvery = (o: FindOpts): number => replaceIn(o);

  /** Data clean-up › Remove duplicates: unique rows move up inside the selection, the rest is cleared. */
  const removeDuplicates = (header: boolean, cols: number[]) => {
    const top = rect.top;
    const lines = rowsRange(top, rect.bottom).map((r) => columnsRange(rect.left, rect.right).map((c) => display(view[r].row.id, columns[c].id)));
    const { keep, removed } = dedupe(lines, cols.map((c) => c - rect.left), { header });
    const order = [...keep.map((i) => top + i)];
    const cleared = rowsRange(top, rect.bottom).length - order.length;
    permuteBlock(top, order, rect.left, rect.right, t("remove duplicates"));
    if (cleared) {
      const tail = view.slice(top + order.length, rect.bottom + 1);
      onSetCells(tail.map((v) => ({ rowId: v.row.id, values: Object.fromEntries(columnsRange(rect.left, rect.right).map((c) => [columns[c].id, null])) })));
    }
    setToast(t("{n} duplicate rows found and removed. {m} unique rows remain.", { n: removed, m: keep.length - (header ? 1 : 0) }));
  };

  // ── Version history ─────────────────────────────────────────────────────────────────────────
  const historyQ = useQuery({
    queryKey: ["nexus", "sheet-history", host?.sheetId],
    queryFn: () => nexusApi.sheetHistory(host!.sheetId, { limit: 2000 }),
    enabled: panel?.kind === "versions" && Boolean(host?.sheetId),
    staleTime: 0,
  });
  const laterQ = useQuery({
    queryKey: ["nexus", "sheet-history-after", host?.sheetId, versionAt],
    queryFn: () => nexusApi.sheetHistory(host!.sheetId, { after: versionAt! }),
    enabled: Boolean(versionAt && host?.sheetId),
    staleTime: 0,
  });
  useEffect(() => {
    if (!versionAt || !laterQ.data) { setVersionPreview(null); return; }
    const st = stateAt(rowsProp, laterQ.data.revisions, versionAt);
    setVersionPreview({ rows: st.rows, changed: showChanges ? st.changed : new Set() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionAt, laterQ.data, showChanges]);
  const restoreVersion = async (at: string) => {
    if (!canEditProp || !host) return;
    const res = await nexusApi.sheetHistory(host.sheetId, { after: at });
    const st = stateAt(rowsProp, res.revisions, at);
    const byId = new Map(st.rows.map((r) => [r.id, r]));
    const edits: { rowId: string; values: Record<string, unknown> }[] = [];
    for (const key of st.changed) {
      const [rowId, colId] = key.split(":");
      const then = byId.get(rowId);
      if (!then || !columns.some((c) => c.id === colId)) continue;
      const e = edits.find((x) => x.rowId === rowId) ?? (() => { const x = { rowId, values: {} as Record<string, unknown> }; edits.push(x); return x; })();
      e.values[colId] = (then.cells as Record<string, unknown>)[colId] ?? null;
    }
    setVersionAt(null);
    if (edits.length) onSetCells(edits);
    setToast(t("Version restored."));
  };

  // ── Paint format: the copied format lands on the next selection ─────────────────────────────
  const paintRect = useRef<string>("");
  useEffect(() => {
    if (!paint) { paintRect.current = ""; return; }
    const key = `${rect.top}:${rect.bottom}:${rect.left}:${rect.right}`;
    if (!paintRect.current) { paintRect.current = key; return; }
    if (key === paintRect.current) return;
    const up = () => {
      window.removeEventListener("mouseup", up);
      styleSelection(() => (paint.style ? { ...paint.style } : null), t("paint format"));
      if (!paint.sticky) setPaint(null); else paintRect.current = key;
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rect, paint]);

  /** Date cells open the date picker under the editor (Enter, F2, double-click). */
  useEffect(() => {
    if (!editing) return;
    const col = columns.find((c) => c.id === editing.colId);
    const row = rows.find((r) => r.id === editing.rowId);
    if (!col || !row || editing.seed) return;
    const raw = row.cells[col.id];
    const isDate = col.type === "date" || (isTypedCell(raw) && raw.nf === "date") || engine.format(row.id, col.id) === "date" || row.styles?.[col.id]?.nf === "date";
    if (!isDate) return;
    const box = gridRef.current?.querySelector(`[data-cell="${row.id}:${col.id}"]`)?.getBoundingClientRect();
    const v = engine.value(row.id, col.id);
    if (box) setDatePick({ rowId: row.id, colId: col.id, rect: box, value: typeof v === "number" ? v : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  useEffect(() => { if (datePick && (!editing || editing.rowId !== datePick.rowId || editing.colId !== datePick.colId)) { const id = setTimeout(() => setDatePick(null), 300); return () => clearTimeout(id); } }, [editing, datePick]);
  const nameBoxRef = useRef<HTMLInputElement>(null);
  const pasteValuesNext = useRef(false);
  /** Ctrl+; / Ctrl+Shift+; / Ctrl+Alt+Shift+; — today's date, the time, or both, into the selection. */
  const stampNow = (kind: "date" | "time" | "dt") => {
    if (!canEdit) return;
    const now = new Date();
    const day = todaySerial(now);
    const frac = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86_400;
    const edits: { rowId: string; values: Record<string, unknown> }[] = [];
    const styles: StyleEdit[] = [];
    for (let r = rect.top; r <= rect.bottom; r += 1) {
      const row = view[r]?.row;
      if (!row) continue;
      const values: Record<string, unknown> = {}, sv: Record<string, CellStyle | null> = {};
      for (let c = rect.left; c <= rect.right; c += 1) {
        const col = columns[c];
        if (!col) continue;
        if (kind === "date") values[col.id] = col.type === "date" ? serialToIso(day) : { v: day, nf: "date" };
        else { values[col.id] = kind === "time" ? frac : day + frac; sv[col.id] = patchStyle(row.styles?.[col.id], { nf: kind }); }
      }
      edits.push({ rowId: row.id, values });
      if (Object.keys(sv).length) styles.push({ rowId: row.id, values: sv });
    }
    onSetCells(edits);
    if (styles.length) onSetStyles(styles, t("format cells"));
  };
  /** Ctrl+D / Ctrl+R: the first row (column) of the selection fills the rest; one cell copies from above (left). */
  const fillDirection = (dir: "down" | "right") => {
    const one = dir === "down" ? rect.top === rect.bottom : rect.left === rect.right;
    const srcR = dir === "down" ? (one ? rect.top - 1 : rect.top) : null;
    const srcC = dir === "right" ? (one ? rect.left - 1 : rect.left) : null;
    if ((srcR !== null && srcR < 0) || (srcC !== null && srcC < 0)) return;
    const edits: { rowId: string; values: Record<string, unknown> }[] = [];
    for (let r = rect.top; r <= rect.bottom; r += 1) {
      const row = view[r]?.row;
      if (!row) continue;
      const values: Record<string, unknown> = {};
      for (let c = rect.left; c <= rect.right; c += 1) {
        const fr = srcR ?? r, fc = srcC ?? c;
        if (fr === r && fc === c) continue;
        const from = view[fr]?.row, col = columns[c], fcol = columns[fc];
        if (!from || !col || !fcol) continue;
        const raw = from.cells[fcol.id];
        values[col.id] = isFormulaCell(raw) ? moveFormula(raw.f, { r: view[fr].rawIndex, c: fc }, { r: view[r].rawIndex, c }) : raw ?? null;
      }
      if (Object.keys(values).length) edits.push({ rowId: row.id, values });
    }
    const allowed = keepValid(edits);
    if (allowed.length) onSetCells(allowed);
  };
  const menuCtx: MenuCtx = {
    canEdit, canManage, canUndo, canRedo, sel: selInfo,
    frozenRows: frozenRowsSetting, frozenCols, zoom,
    showFormulaBar: prefs.fx, showGrid: !settings.noGrid, showFormulas: prefs.formulas, showProtected: prefs.protectedShown,
    commentsHidden: prefs.commentsHidden, fullScreen: full,
    hiddenSheets: (host?.sheets ?? []).filter((s) => s.hidden).map((s) => ({ id: s.id, name: s.name })),
    merged: mergedHere.length > 0, canMerge,
    hasFilter: Boolean(settings.filter), views: (settings.filterViews ?? []).map((v) => ({ id: v.id, name: v.name })), activeViewId: activeView,
    regionColumns: regionColumns(),
    numberItems: numberMenuItems,
    activeNumberFormat: activeStyle?.nf ?? "auto",
    style: {
      b: Boolean(activeStyle?.b), i: Boolean(activeStyle?.i), u: Boolean(activeStyle?.u), s: Boolean(activeStyle?.s),
      ha: activeStyle?.ha, va: activeStyle?.va, wrap: activeStyle?.wr ?? (activeStyle?.w ? "w" : "o"), rt: activeStyle?.rt,
      fontPt: activeStyle?.fp ?? (activeStyle?.fs ? Math.round(activeStyle.fs * 0.75) : 10),
    },
    hasNotes: Boolean(activeStyle?.nt),
    inTable: Boolean(tableAt(view[sel.r]?.rawIndex ?? -1, sel.c)),
    isLink: Boolean(activeCol && isLinkCell(activeRaw)),
    calcManual: prefs.manual,
    autocomplete: true,
    functions: FUNCTION_CATALOG,
    act,
  };
  const menuBar = buildMenuBar(menuCtx);
  // ── Keyboard ────────────────────────────────────────────────────────────────────────────────
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
    if (note?.editing) { e.preventDefault(); return; } // keys typed before the note's box takes focus stay out of the cell
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.altKey && e.code === "KeyM") { e.preventDefault(); openCommentsAt(sel.r, sel.c); return; }
    if (selectedObject && (e.key === "Escape")) { setSelectedObject(null); return; }
    // Sheets' keyboard shortcuts (Help › Keyboard shortcuts lists these).
    const code = e.code;
    const go = (fn: () => void) => { e.preventDefault(); e.stopPropagation(); fn(); };
    if (e.altKey && e.shiftKey && !meta) {
      const menuKey: Record<string, string> = { KeyF: "file", KeyE: "edit", KeyV: "view", KeyI: "insert", KeyO: "format", KeyD: "data", KeyT: "tools", KeyH: "help" };
      if (menuKey[code]) return go(() => setMenuOpen(menuKey[code]));
      const border: Record<string, BorderPreset10> = { Digit1: "top", Digit2: "right", Digit3: "bottom", Digit4: "left", Digit6: "clear", Digit7: "outer" };
      if (border[code] && canEdit) return go(() => applyBorders10(border[code], "thin", null));
      if (code === "ArrowRight") return go(() => act(selInfo.wholeCols && !selInfo.wholeRows ? "groupCols" : "groupRows"));
      if (code === "ArrowLeft") return go(() => act(selInfo.wholeCols && !selInfo.wholeRows ? "ungroupCols" : "ungroupRows"));
      // Quick sum (Sheets: Alt+Shift+Q): open the statistics chip's menu.
      if (code === "KeyQ") {
        const chip = document.querySelector<HTMLButtonElement>("[data-quick-sum] button");
        if (chip) return go(() => chip.click());
      }
    }
    if (e.altKey && !meta && !e.shiftKey && (e.key === "/" || code === "Slash")) return go(() => setMenuSearch(true));
    if (e.altKey && !meta && code === "F1") return go(() => act("insertChart"));
    if (e.shiftKey && !meta && !e.altKey && code === "F2") return go(() => openNote(true));
    if (e.shiftKey && !meta && code === "F11") return go(() => act("insertSheet"));
    if (code === "F9" && prefs.manual) return go(() => setRecalcTick((n) => n + 1));
    if (meta) {
      if (e.altKey && e.shiftKey && code === "KeyH") return go(() => act("versionHistory"));
      if (e.altKey && code === "KeyT") return go(() => act("convertTable"));
      if (e.altKey && code === "KeyR") return go(() => { const box = gridRef.current?.querySelector(`[data-cell="${activeRow?.id}:${activeCol?.id}"]`)?.getBoundingClientRect(); if (box) setHeaderMenu({ ci: sel.c, rect: box }); });
      if (e.altKey && code === "KeyV") return go(() => pasteSpecial("format"));
      if (e.altKey && (code === "Equal" || code === "NumpadAdd")) return go(() => act(selInfo.wholeCols && !selInfo.wholeRows ? "insertColsLeft" : "insertRowsAbove"));
      if (e.altKey && (code === "Minus" || code === "NumpadSubtract")) return go(() => act(selInfo.wholeCols && !selInfo.wholeRows ? "deleteCols" : "deleteRows"));
      if (e.altKey && e.shiftKey && code === "Semicolon") return go(() => stampNow("dt"));
      if (e.shiftKey && code === "Semicolon") return go(() => stampNow("time"));
      if (!e.shiftKey && code === "Semicolon") return go(() => stampNow("date"));
      if (code === "Slash") return go(() => act("shortcuts"));
      if (code === "KeyH") return go(() => act("findReplace"));
      if (code === "KeyJ") return go(() => nameBoxRef.current?.focus());
      if (code === "KeyP") return go(() => print());
      if (code === "Backquote") return go(() => act("toggleFormulas"));
      if (code === "F1") return go(() => act("fullScreen"));
      if (e.shiftKey && code === "KeyU") return go(() => act("toggleFormulaBar"));
      if (code === "Backspace") return go(() => setSel((x) => ({ ...x })));
      if (canEdit) {
        if (code === "KeyD" && !e.shiftKey) return go(() => fillDirection("down"));
        if (code === "KeyR" && !e.shiftKey) return go(() => fillDirection("right"));
        if (e.shiftKey && code === "KeyL") return go(() => applyStyle({ ha: "l" }));
        if (e.shiftKey && code === "KeyE") return go(() => applyStyle({ ha: "c" }));
        if (e.shiftKey && code === "KeyR") return go(() => applyStyle({ ha: "r" }));
        if (e.shiftKey && code === "Digit1") return go(() => applyNumberFormat("num"));
        if (e.shiftKey && code === "Digit2") return go(() => applyNumberFormat("time"));
        if (e.shiftKey && code === "Digit3") return go(() => applyNumberFormat("date"));
        if (e.shiftKey && code === "Digit4") return go(() => applyNumberFormat(settings.locale === "en-US" ? "cur" : "idr"));
        if (e.shiftKey && code === "Digit5") return go(() => applyNumberFormat("pct"));
        if (e.shiftKey && code === "Digit6") return go(() => applyNumberFormat("sci"));
        if (e.shiftKey && code === "Digit7") return go(() => applyBorders10("outer", "thin", null));
        if (e.shiftKey && code === "Minus") return go(() => applyBorders10("clear", "thin", null));
        if (!e.shiftKey && code === "Digit2") return go(() => applyStyle({ b: activeStyle?.b ? null : 1 }));
        if (!e.shiftKey && code === "Digit3") return go(() => applyStyle({ i: activeStyle?.i ? null : 1 }));
        if (!e.shiftKey && code === "Digit4") return go(() => applyStyle({ u: activeStyle?.u ? null : 1 }));
        if (!e.shiftKey && code === "Digit5") return go(() => applyStyle({ s: activeStyle?.s ? null : 1 }));
        if (!e.shiftKey && code === "Digit9") return go(() => act("hideRows"));
        if (!e.shiftKey && code === "Digit0") return go(() => act("hideCols"));
        if (e.shiftKey && code === "Digit9") return go(() => unhideRows(view.slice(rect.top, rect.bottom + 2).flatMap((v) => hiddenRowsBefore.get(v.row.id) ?? [])));
        if (e.shiftKey && code === "Digit0") return go(() => unhideCols(columnsRange(rect.left, Math.min(maxC, rect.right + 1)).flatMap((c) => hiddenBefore(c))));
        if (e.shiftKey && code === "KeyV") { pasteValuesNext.current = true; return; }
      }
    }
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
        return openCell(sel.r, sel.c);
      }
      case "Escape": return setSel((s) => ({ ...s, r2: s.r, c2: s.c }));
      case "Delete":
      case "Backspace": e.preventDefault(); return clearSelection();
      case "a": if (meta) { e.preventDefault(); setSel({ r: 0, c: 0, r2: maxR, c2: maxC }); } return;
      case "f": if (meta) { e.preventDefault(); setFindOpen(true); } return;
      default: break;
    }
    // Space ticks / unticks checkboxes (every checkbox in the selection).
    if (e.key === " " && !meta && !e.altKey && !e.shiftKey && isCheckboxCell(sel.r, sel.c)) { e.preventDefault(); toggleCheckboxes(); return; }
    // Any printable character starts editing and REPLACES the cell (F2 / double-click append instead).
    if (!meta && !e.altKey && e.key.length === 1 && canEdit && activeRow && activeCol) {
      e.preventDefault();
      openCell(sel.r, sel.c, e.key);
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
    return (v: number) => formatWithStyle(v, st?.nf, st?.dp, nf ?? (col?.type === "currency" ? "idr" : null), st?.pt)
      ?? formatResult(col?.type === "currency" ? "currency" : "number", v, nf === "date" ? null : nf);
  }, [columns, rect.left, rect.top, view, engine]);
  const statLabel: Record<Stat, string> = {
    sum: t("Sum"), avg: t("Average"), count: t("Count"), countNum: t("Count numbers"), min: t("Min"), max: t("Max"),
  };
  const statValue = (s: Stat) => (s === "count" || s === "countNum" ? String(stats[s]) : statFormat(stats[s]));
  const multiCell = stats.cells > 1;
  // Like Sheets: a selection without numbers shows its Count instead of "Sum: 0".
  const shownStat: Stat = stats.countNum === 0 && stat !== "count" ? "count" : stat;

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
    <div className="flex items-stretch gap-2">
    <div className="min-w-0 flex-1 space-y-1.5">
      {!full || true ? (
        <div className="flex items-center gap-1">
          <MenuBar menus={menuBar} openId={menuOpen} onOpen={setMenuOpen} />
        </div>
      ) : null}
      <SheetToolbar
        canEdit={canEdit}
        editing={Boolean(editing)}
        style={activeStyle}
        onStyle={applyStyle}
        numberItems={numberMenuItems.map((x) => (x.key === "sep" ? "sep" : { nf: x.key as NumberFormatKind, label: x.label, example: x.example }))}
        onCustomFormat={(k) => setDialog({ kind: k })}
        onBorders={applyBorders10}
        onClearFormat={clearFormat}
        onDecimals={changeDecimals}
        zoom={zoom}
        onZoom={setZoom}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
        onPrint={print}
        paint={paint ? (paint.sticky ? "sticky" : "once") : "off"}
        onPaint={(sticky) => setPaint((p) => (p && !sticky ? null : { style: activeStyle ?? null, sticky }))}
        merged={mergedHere.length > 0}
        canMerge={canMerge}
        onMerge={mergeAs}
        onLink={insertLink}
        onComment={() => openCommentsAt(sel.r, sel.c)}
        onChart={insertChart}
        filterOn={Boolean(settings.filter)}
        onFilter={toggleFilter}
        filterViews={(settings.filterViews ?? []).map((v) => ({ id: v.id, name: v.name }))}
        activeViewId={activeView}
        groupByColumns={regionColumns()}
        onFilterView={(a) => (a.kind === "create" ? createFilterView(null) : a.kind === "groupBy" ? createFilterView(a.colId) : setActiveView(a.id))}
        onFunction={insertFunction}
        functionCatalog={FUNCTION_CATALOG}
        onSearchMenus={() => setMenuSearch(true)}
        themeColors={themeStandard}
        onEditTheme={() => setPanel({ kind: "theme" })}
        onOpenCF={() => setPanel({ kind: "cf" })}
        onOpenAlternating={() => setPanel({ kind: "alt" })}
        currency={settings.locale === "en-US" ? { nf: "cur", symbol: "$", dp: 2 } : undefined}
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
          ref={nameBoxRef}
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
            // Ctrl+Shift+V: paste values only (no formats, no formulas).
            if (pasteValuesNext.current) { pasteValuesNext.current = false; void applyPaste({ cells: block.cells.map((r) => r.map((c) => ({ text: c.text }))), internal: false }); return; }
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
                      groupMark={colGroupMark(ci)}
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
                    height={heightOf(row)}
                    decorAt={decorAt}
                    noGrid={Boolean(settings.noGrid)}
                    showFormulas={prefs.formulas}
                    commentsHidden={prefs.commentsHidden}
                    onNoteHover={onNoteHover}
                    onHeaderMenu={onHeaderMenu}
                    gutter={rowGutter.get(row.id) ?? null}
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
                    onEdit={(ci) => openCell(ri, ci, undefined, "mouse")}
                    ruleAt={ruleAt}
                    onOpenDropdown={(ci) => { setSel({ r: ri, c: ci, r2: ri, c2: ci }); if (canEdit) openDropdown(row.id, columns[ci].id); }}
                    onToggleCheck={(ci) => {
                      const col = columns[ci];
                      if (!canEdit || !col) return;
                      const rule = ruleAt(rawIndex, ci);
                      const on = !(col.type === "checkbox" ? row.cells[col.id] === true : isChecked(rule, row.cells[col.id]));
                      onSetCells([{ rowId: row.id, values: { [col.id]: col.type === "checkbox" ? on : checkboxValue(rule, on) } }]);
                    }}
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

          {/* Floating objects over the cells: charts, slicers and table name tabs (anchored to cells by id). */}
          <div aria-hidden={false} className="pointer-events-none absolute left-0 top-0" style={{ zoom } as CSSProperties}>
            {chartsShown.map((ch) => {
              const p = anchorXY(ch.at);
              if (!p) return null;
              return (
                <div key={ch.id} className="pointer-events-auto">
                  <Suspense fallback={null}><ChartObject
                    spec={ch}
                    data={data}
                    engine={engine}
                    theme={theme?.accents}
                    left={p.x}
                    top={p.y}
                    zoom={zoom}
                    selected={selectedObject === ch.id}
                    canEdit={canEdit}
                    onSelect={() => setSelectedObject(ch.id)}
                    onMove={(d) => saveChart({ ...ch, at: anchorFromXY(p.x + d.dx, p.y + d.dy) }, t("move chart"))}
                    onResize={(w, h, mv) => saveChart({ ...ch, w: Math.round(w), h: Math.round(h), ...(mv ? { at: anchorFromXY(p.x + mv.dx, p.y + mv.dy) } : {}) }, t("resize chart"))}
                    onEdit={() => { setSelectedObject(ch.id); setPanel({ kind: "chart", id: ch.id }); }}
                    onDelete={() => { onSettings({ charts: (settings.charts ?? []).filter((x) => x.id !== ch.id).length ? (settings.charts ?? []).filter((x) => x.id !== ch.id) : null }, t("delete chart")); setSelectedObject(null); if (panel?.kind === "chart") setPanel(null); }}
                    onCopy={() => onSettings({ charts: [...(settings.charts ?? []), { ...ch, id: newId("ch"), at: { ...ch.at, dx: (ch.at.dx ?? 0) + 24, dy: (ch.at.dy ?? 0) + 24 } }] }, t("copy chart"))}
                  /></Suspense>
                </div>
              );
            })}
            {(settings.slicers ?? []).map((sl) => {
              const p = anchorXY(sl.at);
              if (!p) return null;
              const rc = rangeRect(sl.range, data.shape);
              const label = rc ? display(rows[rc.top]?.id ?? "", sl.colId) : "";
              const ids = rc ? rows.slice(rc.top + 1, rc.bottom + 1).map((r) => r.id) : [];
              const total = sl.crit?.hidden ? distinctValues(ids, sl.colId, display).length : undefined;
              return (
                <div key={sl.id} className="pointer-events-auto absolute" style={{ left: p.x, top: p.y }}>
                  <SlicerChip
                    slicer={sl}
                    label={label}
                    active={critActive(sl.crit)}
                    selected={selectedObject === sl.id}
                    onOpen={(r) => setSlicerMenu({ id: sl.id, rect: r })}
                    onSelect={() => { setSelectedObject(sl.id); setPanel({ kind: "slicer", id: sl.id }); }}
                    shown={total !== undefined ? total - (sl.crit?.hidden?.length ?? 0) : undefined}
                    total={total}
                  />
                </div>
              );
            })}
            {tables.map(({ tb, rc }) => {
              const vi = view.findIndex((v) => v.rawIndex === rc.top);
              if (vi < 0 || vi < frozenRows && false) return null;
              return (
                <button
                  key={tb.id}
                  onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setTableMenu({ id: tb.id, x: r.left, y: r.bottom + 2 }); }}
                  className="pointer-events-auto absolute flex h-5 items-center gap-1 rounded-t-md px-2 text-[11px] font-semibold text-white shadow-soft"
                  style={{ left: lefts[rc.left] ?? 0, top: headH + (offsets[vi] ?? 0) - 20, background: tb.header ?? TABLE_HEADER }}
                  title={t("Table menu")}
                >
                  <Table2 className="h-3 w-3" /> {tb.name} <ChevronDown className="h-3 w-3" />
                </button>
              );
            })}
          </div>

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
            <span data-quick-sum className="contents">
            <Menu
              label={t("Selection statistics")}
              trigger={
                <span className="max-w-[220px] truncate text-xs tabular-nums">
                  <span className="text-muted-foreground">{statLabel[shownStat]}:</span> <span className="font-medium">{statValue(shownStat)}</span>
                </span>
              }
            >
              {(close) => (Object.keys(statLabel) as Stat[]).map((s) => (
                <MenuItem key={s} active={shownStat === s} hint={statValue(s)} onClick={() => { setStat(s); close(); }}>{statLabel[s]}</MenuItem>
              ))}
            </Menu>
            </span>
          )}
        </div>
      </div>
    </div>
    {panel?.kind === "cf" && (
      <Suspense fallback={null}><ConditionalFormatPanel
        rules={settings.condFormats ?? []}
        shape={data.shape}
        sheetName={sheetName ?? "Sheet1"}
        selectionRange={selectionA1}
        editId={panel.id ?? null}
        canEdit={canEdit}
        onPreview={(r) => setCfPreview(r)}
        onSave={(r) => { setCfPreview(null); onSettings({ condFormats: r.length ? r : null }, t("conditional formatting")); }}
        onClose={() => { setCfPreview(null); setPanel(null); }}
      /></Suspense>
    )}
    {panel?.kind === "alt" && (() => {
      const here = (settings.bandings ?? []).find((b) => { const rc = rangeRect(b.range, data.shape); return rc && rc.top <= (view[rect.top]?.rawIndex ?? 0) && rc.bottom >= (view[rect.top]?.rawIndex ?? 0) && rc.left <= rect.left && rc.right >= rect.left; }) ?? null;
      return (
        <Suspense fallback={null}><AlternatingColorsPanel
          banding={here}
          selectionRange={selectionA1 || nameBox}
          shape={data.shape}
          onPreview={(b) => setBandPreview({ id: here?.id ?? b?.id ?? null, b })}
          onSave={(b) => { setBandPreview(null); onSettings({ bandings: [...(settings.bandings ?? []).filter((x) => x.id !== b.id && x.id !== here?.id), b] }, t("alternating colours")); }}
          onRemove={() => { setBandPreview(null); if (here) onSettings({ bandings: (settings.bandings ?? []).filter((x) => x.id !== here.id).length ? (settings.bandings ?? []).filter((x) => x.id !== here.id) : null }, t("remove alternating colours")); setPanel(null); }}
          onClose={() => { setBandPreview(null); setPanel(null); }}
        /></Suspense>
      );
    })()}
    {panel?.kind === "named" && (
      <NamedRangesPanel
        ranges={settings.namedRanges ?? []}
        shape={data.shape}
        sheetName={sheetName ?? "Sheet1"}
        selectionRange={selectionA1}
        canEdit={canEdit}
        onSave={(next) => onSettings({ namedRanges: next.length ? next : null }, t("named ranges"))}
        onClose={() => setPanel(null)}
        onJump={(nr) => { const rc = rangeRect(nr.range, data.shape); if (rc) { const a = view.findIndex((v) => v.rawIndex === rc.top), b = view.findIndex((v) => v.rawIndex === rc.bottom); if (a >= 0 && b >= 0) setSel({ r: a, c: rc.left, r2: b, c2: rc.right }); } }}
      />
    )}
    {panel?.kind === "protect" && (
      <ProtectedRangesPanel
        protections={settings.protections ?? []}
        shape={data.shape}
        sheetName={sheetName ?? "Sheet1"}
        selectionRange={selectionA1}
        members={host?.members ?? []}
        meId={host?.meId ?? ""}
        canManage={canManage}
        onSave={(next) => onSettings({ protections: next.length ? next : null }, t("protected ranges"))}
        onClose={() => setPanel(null)}
      />
    )}
    {panel?.kind === "chart" && (() => {
      const spec = chartsShown.find((c) => c.id === panel.id);
      return spec ? (
        <Suspense fallback={null}><ChartEditor
          spec={spec}
          shape={data.shape}
          sheetName={sheetName ?? "Sheet1"}
          columnLabel={(ci) => colLetter(ci)}
          data={data}
          engine={engine}
          theme={theme?.accents}
          onChange={editChart}
          onClose={() => setPanel(null)}
        /></Suspense>
      ) : null;
    })()}
    {panel?.kind === "slicer" && (() => {
      const sl = (settings.slicers ?? []).find((x) => x.id === panel.id);
      if (!sl) return null;
      const rc = rangeRect(sl.range, data.shape);
      const head = rc ? rows[rc.top] : null;
      return (
        <SlicerPanel
          slicer={sl}
          columns={rc ? columnsRange(rc.left, rc.right).map((c) => ({ colId: columns[c].id, label: (head ? display(head.id, columns[c].id) : "") || `${t("Column")} ${colLetter(c)}` })) : []}
          sheetName={sheetName ?? "Sheet1"}
          rangeA1={rangeToA1(sl.range, data.shape)}
          onChange={(next) => onSettings({ slicers: (settings.slicers ?? []).map((x) => (x.id === next.id ? next : x)) }, t("slicer"))}
          onRangeChange={(a1) => { const r = rangeFromA1(a1, data.shape); if (!r) return false; onSettings({ slicers: (settings.slicers ?? []).map((x) => (x.id === sl.id ? { ...x, range: r } : x)) }, t("slicer")); return true; }}
          onClose={() => setPanel(null)}
        />
      );
    })()}
    {panel?.kind === "stats" && (
      <ColumnStatsPanel
        columns={columns.map((c, i) => ({ index: i, label: c.name || `${t("Column")} ${colLetter(i)}` }))}
        colIndex={panel.col}
        onColIndex={(i) => setPanel({ kind: "stats", col: i })}
        valuesOf={valuesOfColumn}
        onClose={() => setPanel(null)}
      />
    )}
    {panel?.kind === "theme" && (
      <Suspense fallback={null}><ThemePanel
        theme={settings.theme}
        onPreview={setThemePreview}
        onSave={(th) => { setThemePreview(null); onSettings({ theme: th }, t("theme")); }}
        onClose={() => { setThemePreview(null); setPanel(null); }}
      /></Suspense>
    )}
    {panel?.kind === "versions" && (
      <Suspense fallback={null}><VersionHistoryPanel
        revisions={historyQ.data?.revisions ?? []}
        loading={historyQ.isLoading}
        named={settings.versions ?? []}
        selectedAt={versionAt}
        showChanges={showChanges}
        onShowChanges={setShowChanges}
        onSelect={setVersionAt}
        onRestore={restoreVersion}
        onName={(at, name) => onSettings({ versions: [...(settings.versions ?? []).filter((v) => v.at !== at), { id: newId("ver"), name, at }] }, t("name version"))}
        onClose={() => { setVersionAt(null); setPanel(null); }}
      /></Suspense>
    )}
    {panel?.kind === "comments" && (
      <SidePanel title={t("Comments")} onClose={() => setPanel(null)}>
        <div className="space-y-1 p-2">
          {Object.keys(commentCounts).length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t("No open comments on this sheet.")}</p>}
          {Object.entries(commentCounts).map(([k, n]) => {
            const [rowId, colId] = k.split(":");
            const ri = view.findIndex((v) => v.row.id === rowId), ci = columns.findIndex((c) => c.id === colId);
            if (ri < 0 || ci < 0) return null;
            return (
              <button key={k} onClick={() => { setSel({ r: ri, c: ci, r2: ri, c2: ci }); setTimeout(() => openCommentsAt(ri, ci), 50); }}
                className="flex w-full items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-left text-xs hover:bg-muted">
                <span className="font-mono text-[11px] text-muted-foreground">{colLetter(ci)}{view[ri].rawIndex + 1}</span>
                <span className="min-w-0 flex-1 truncate">{display(rowId, colId) || "—"}</span>
                <span className="text-muted-foreground">{t("{n} comments", { n })}</span>
              </button>
            );
          })}
        </div>
      </SidePanel>
    )}
    {!panel && !dvOpen && aside}
    {dvOpen && (
      <Suspense fallback={null}><DataValidationPanel
        rules={[...(columnRules.filter(Boolean) as PanelRule[]), ...explicitRules]}
        shape={data.shape}
        sheetName={sheetName ?? "Sheet1"}
        selectionRange={(() => { const r = selectionStored(); return r ? rangeToA1(r, data.shape) : ""; })()}
        editId={dvEditId}
        canEdit={canEdit}
        onSave={saveRuleFromPanel}
        onRemove={removeRuleFromPanel}
        onClose={() => { setDvOpen(false); setDvEditId(null); }}
        onEditChange={setDvEditId}
      /></Suspense>
    )}
    </div>

    {/* The open dropdown list of a cell. */}
    {dropdown && (() => {
      const row = rows.find((r) => r.id === dropdown.rowId);
      const ci = columns.findIndex((c) => c.id === dropdown.colId);
      const rawRow = rows.findIndex((r) => r.id === dropdown.rowId);
      const rule = row && ci >= 0 ? ruleAt(rawRow, ci) : null;
      if (!row || !rule) return null;
      const raw = row.cells[dropdown.colId];
      return (
        <DropdownPicker
          anchor={dropdown.rect}
          options={dropdownOptions(rule, engine, data.shape)}
          colors={rule.colors}
          picked={rule.multiple ? pickedValues(raw) : raw === undefined || raw === null || raw === "" ? [] : [String(Array.isArray(raw) ? raw.join(", ") : raw)]}
          multiple={Boolean(rule.multiple)}
          onClose={() => { setDropdown(null); gridRef.current?.focus(); }}
          onCommit={(values) => {
            setDropdown(null);
            // Items are written exactly as listed (never re-read as numbers or dates).
            const next = values.length ? values.join(", ") : null;
            if (!sameCell(raw, next)) onSetCells([{ rowId: dropdown.rowId, values: { [dropdown.colId]: next } }]);
            gridRef.current?.focus();
          }}
        />
      );
    })()}

    {/* Help text of the selected cell's rule (Advanced options › help text). */}
    {helpRect && activeRule?.help && createPortal(
      <Floating anchor={{ rect: helpRect }} className="pointer-events-none max-w-64 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-pop">
        {activeRule.help}
      </Floating>,
      document.body,
    )}

    {menu && (
      <MenuPopup
        nodes={buildContextMenu(menu.kind, menuCtx)}
        anchor={{ x: menu.left, y: menu.top }}
        onClose={() => setMenu(null)}
        width={290}
      />
    )}
    {menuSearch && <MenuSearch menus={menuBar} onClose={() => setMenuSearch(false)} />}
    {dialog?.kind === "settings" && (
      <SheetSettingsDialog
        settings={{ locale: settings.locale, timeZone: settings.timeZone, recalc: settings.recalc, iterative: settings.iterative }}
        onSave={(patch) => { host?.saveSpreadsheetSettings ? host.saveSpreadsheetSettings(patch) : onSettings(patch, t("settings")); setDialog(null); }}
        onClose={() => setDialog(null)}
      />
    )}
    {dialog?.kind === "shortcuts" && <ShortcutsDialog onClose={() => setDialog(null)} />}
    {dialog?.kind === "functions" && (
      <SheetDialog title={t("Function list")} onClose={() => setDialog(null)} width={560}>
        <div className="divide-y divide-border">
          {SUPPORTED_FUNCTIONS.map((f) => (
            <div key={f.name} className="flex gap-3 py-1.5 text-xs">
              <span className="w-36 shrink-0 font-mono font-semibold">{f.name}<span className="font-normal text-muted-foreground">{f.args}</span></span>
              <span className="text-muted-foreground">{lang === "id" ? f.desc : f.descEn}</span>
            </div>
          ))}
        </div>
      </SheetDialog>
    )}
    {dialog?.kind === "find" && (
      <FindReplaceDialog
        canEdit={canEdit}
        hasSelection={!selInfo.single}
        onFind={(o) => findNext(o)}
        onReplace={(o) => replaceOne(o)}
        onReplaceAll={(o) => replaceEvery(o)}
        onClose={() => setDialog(null)}
      />
    )}
    {dialog?.kind === "sort" && (
      <SortRangeDialog
        columns={columnsRange(rect.left, rect.right).map((c) => ({ index: c, letter: colLetter(c), header: display(view[rect.top]?.row.id ?? "", columns[c].id) }))}
        defaultHeader={false}
        onSort={(o) => sortRange(o.keys, o.header)}
        onClose={() => setDialog(null)}
      />
    )}
    {dialog?.kind === "dedupe" && (
      <RemoveDuplicatesDialog
        rowCount={rect.bottom - rect.top + 1}
        columns={columnsRange(rect.left, rect.right).map((c) => ({ index: c, letter: colLetter(c), header: display(view[rect.top]?.row.id ?? "", columns[c].id) }))}
        onApply={(o) => removeDuplicates(o.header, o.cols)}
        onClose={() => setDialog(null)}
      />
    )}
    {dialog?.kind === "customNumber" && (
      <CustomNumberFormatDialog initial={activeStyle?.nf === "custom" ? activeStyle.pt : undefined} sample={typeof engine.value(activeRow?.id ?? "", activeCol?.id ?? "") === "number" ? engine.value(activeRow?.id ?? "", activeCol?.id ?? "") as number : 1234.56}
        locale={settings.locale ?? "id-ID"} onApply={(pt) => { applyStyle({ nf: "custom", pt, dp: null }); setDialog(null); }} onClose={() => setDialog(null)} />
    )}
    {dialog?.kind === "customDate" && (
      <DateTimeFormatDialog initial={activeStyle?.nf === "custom" ? activeStyle.pt : undefined} sample={typeof engine.value(activeRow?.id ?? "", activeCol?.id ?? "") === "number" ? engine.value(activeRow?.id ?? "", activeCol?.id ?? "") as number : 11175.559}
        locale={settings.locale ?? "id-ID"} onApply={(pt) => { applyStyle({ nf: "custom", pt, dp: null }); setDialog(null); }} onClose={() => setDialog(null)} />
    )}
    {dialog?.kind === "customCurrency" && (
      <CurrencyFormatDialog locale={settings.locale ?? "id-ID"} onApply={(pt) => { applyStyle({ nf: "custom", pt, dp: null }); setDialog(null); }} onClose={() => setDialog(null)} />
    )}
    {dialog?.kind === "pivot" && (
      <Suspense fallback={null}><PivotCreateDialog
        defaultRange={`${sheetName ?? "Sheet1"}!${rangeToA1(storedOf(selInfo.single ? currentRegion() : rect) ?? "", data.shape)}`}
        onCreate={(o) => { setDialog(null); const r = rangeFromA1(o.range, data.shape); if (r) host?.createPivot(r); else alert(t("That range isn't valid.")); }}
        onClose={() => setDialog(null)}
      /></Suspense>
    )}
    {(dialog?.kind === "resizeRows" || dialog?.kind === "resizeCols") && (
      <ResizeDialog
        kind={dialog.kind === "resizeRows" ? "rows" : "cols"}
        label={dialog.kind === "resizeRows" ? `${selInfo.r1}${selInfo.r2 !== selInfo.r1 ? ` - ${selInfo.r2}` : ""}` : `${selInfo.c1}${selInfo.c2 !== selInfo.c1 ? ` - ${selInfo.c2}` : ""}`}
        initial={dialog.kind === "resizeRows" ? heightOf(view[rect.top]?.row ?? rows[0]) : columns[rect.left]?.width ?? COL_W_DEFAULT}
        onApply={(v) => {
          setDialog(null);
          if (dialog.kind === "resizeRows") for (let r = rect.top; r <= rect.bottom; r += 1) { const row = view[r]?.row; if (row) onResizeRow(row.id, v === "fit" ? null : Math.round(Math.max(ROW_H_MIN, Math.min(ROW_H_MAX, v)))); }
          else for (let c = rect.left; c <= rect.right; c += 1) { if (v === "fit") autofit(c); else onEditColumn(columns[c].id, { width: Math.round(Math.max(20, Math.min(600, v))) }); }
        }}
        onClose={() => setDialog(null)}
      />
    )}
    {problem && (
      <SheetDialog title={t("There was a problem")} onClose={() => setProblem(null)} footer={<button className={primaryBtn} onClick={() => setProblem(null)}>{t("OK")}</button>}>
        <p className="text-sm">{problem}</p>
      </SheetDialog>
    )}
    {protectWarn && (
      <ProtectionWarningDialog
        onOk={(mute) => { if (mute) protectMuteUntil.current = Date.now() + 5 * 60_000; const go = protectWarn; setProtectWarn(null); go(); }}
        onCancel={() => setProtectWarn(null)}
      />
    )}
    {toast && createPortal(
      <div role="status" className="fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-lg bg-foreground px-4 py-2 text-xs font-medium text-background shadow-pop">{toast}</div>,
      document.body,
    )}
    {noteHover && !note && (() => {
      const st = rows.find((r) => r.id === noteHover.rowId)?.styles?.[noteHover.colId];
      return st?.nt ? <NotePopover anchor={noteHover.rect} value={st.nt} editing={false} canEdit={false} onSave={() => undefined} onClose={() => setNoteHover(null)} /> : null;
    })()}
    {note && (
      <NotePopover
        anchor={note.rect}
        value={rows.find((r) => r.id === note.rowId)?.styles?.[note.colId]?.nt ?? ""}
        editing={note.editing}
        canEdit={canEdit}
        onSave={(text) => {
          const row = rows.find((r) => r.id === note.rowId);
          if (row) onSetStyles([{ rowId: row.id, values: { [note.colId]: patchStyle(row.styles?.[note.colId], { nt: text.trim() ? text : null }) } }], t("note"));
        }}
        onClose={() => { setNote(null); gridRef.current?.focus(); }}
      />
    )}
    {splitChip && (
      <SplitSeparatorChip anchor={splitChip.rect} value={splitChip.sep as SplitSep} onChange={(sep) => { onUndo(); setTimeout(() => splitText(sep), 150); }} onClose={() => setSplitChip(null)} />
    )}
    {datePick && (
      <DatePicker
        anchor={datePick.rect}
        value={datePick.value}
        locale={settings.locale ?? "id-ID"}
        onPick={(serial) => {
          const col = columns.find((c) => c.id === datePick.colId);
          const row = rows.find((r) => r.id === datePick.rowId);
          if (col && row) {
            const next = col.type === "date" ? serialToIso(serial) : { v: serial, nf: "date" as const };
            if (!sameCell(row.cells[col.id], next)) onSetCells([{ rowId: row.id, values: { [col.id]: next } }]);
          }
          setDatePick(null);
          setEditing(null);
          gridRef.current?.focus();
        }}
        onClose={() => setDatePick(null)}
      />
    )}
    {headerMenu && (() => {
      const col = columns[headerMenu.ci];
      if (!col) return null;
      const rawTop = view.find((v) => v.rawIndex >= 0) ? undefined : undefined;
      void rawTop;
      const inTable = tables.find(({ rc }) => headerMenu.ci >= rc.left && headerMenu.ci <= rc.right && rows[rc.top] && view.some((v) => v.rawIndex === rc.top));
      const frc = filterResult.main?.rect;
      if (frc && activeFilter && headerMenu.ci >= frc.left && headerMenu.ci <= frc.right && !(inTable && !frc)) {
        const ids = filterBodyIds();
        const crit = activeFilter.criteria?.[col.id];
        const colors = colorsInColumn(ids, col.id, styleOfCell);
        return (
          <FilterMenu
            anchor={headerMenu.rect}
            columnLabel={display(rows[frc.top]?.id ?? "", col.id) || `${t("Column")} ${colLetter(headerMenu.ci)}`}
            values={distinctValues(ids, col.id, display)}
            crit={crit}
            fills={colors.fills}
            texts={colors.texts}
            onSort={(dir) => { const a = view.findIndex((v) => v.rawIndex === frc.top + 1), b = view.findIndex((v) => v.rawIndex === frc.bottom); if (a >= 0 && b >= 0) sortRange([{ col: headerMenu.ci, dir }], false, { top: a, bottom: b, left: frc.left, right: frc.right }); setHeaderMenu(null); }}
            onApply={(c) => {
              const criteria = { ...(activeFilter.criteria ?? {}) };
              if (c) {
                const cc = c.cond?.kind === "formula" && c.cond.formula ? { ...c, cond: { ...c.cond, formula: toStored(c.cond.formula, data.shape) } } : c;
                criteria[col.id] = cc;
              } else delete criteria[col.id];
              saveFilter({ range: activeFilter.range, ...(Object.keys(criteria).length ? { criteria } : {}), ...(activeFilter.sort ? { sort: activeFilter.sort } : {}) });
              setHeaderMenu(null);
            }}
            onClose={() => setHeaderMenu(null)}
          />
        );
      }
      if (inTable) {
        const tb = inTable.tb, rc = inTable.rc;
        const types: [TableColumnType, string][] = [["text", "Text"], ["number", "Number"], ["pct", "Percent"], ["currency", "Currency"], ["date", "Date"], ["time", "Time"], ["dt", "Date time"], ["dur", "Duration"], ["checkbox", "Checkbox"], ["dropdown", "Dropdown"], ["none", "None"]];
        const setType = (ty: TableColumnType) => {
          onSettings({ tables: (settings.tables ?? []).map((x) => (x.id === tb.id ? { ...x, types: { ...(x.types ?? {}), [col.id]: ty } } : x)) }, t("column type"));
          const body = rows.slice(rc.top + 1, rc.bottom + 1);
          const nf = ty === "number" ? "num" : ty === "pct" ? "pct" : ty === "currency" ? "idr" : ty === "date" ? "date" : ty === "time" ? "time" : ty === "dt" ? "dt" : ty === "dur" ? "dur" : null;
          if (nf || ty === "text") onSetStyles(body.map((r) => ({ rowId: r.id, values: { [col.id]: patchStyle(r.styles?.[col.id], { nf: nf ?? "text", pt: null }) } })), t("column type"));
          if (ty === "checkbox" || ty === "dropdown") {
            const range = `{${col.id}!${body[0]?.id}}:{${col.id}!${body[body.length - 1]?.id}}`;
            if (body.length) {
              const seen = new Set<string>();
              if (ty === "dropdown") body.forEach((r) => { const v = r.cells[col.id]; if (typeof v === "string" && v.trim()) seen.add(v.trim()); });
              saveRules([...explicitRules, { id: newRuleId(), ranges: [range], kind: ty === "checkbox" ? "checkbox" : "list", ...(ty === "dropdown" ? { values: seen.size ? [...seen].slice(0, 50) : [t("Option 1"), t("Option 2")] } : {}) }], t("column type"));
            }
          }
        };
        const items: MenuNode[] = [
          { id: "tc-az", label: "Sort table A to Z", run: () => { const a = view.findIndex((v) => v.rawIndex === rc.top + 1), b = view.findIndex((v) => v.rawIndex === rc.bottom); if (a >= 0 && b >= 0) sortRange([{ col: headerMenu.ci, dir: "asc" }], false, { top: a, bottom: b, left: rc.left, right: rc.right }); } },
          { id: "tc-za", label: "Sort table Z to A", run: () => { const a = view.findIndex((v) => v.rawIndex === rc.top + 1), b = view.findIndex((v) => v.rawIndex === rc.bottom); if (a >= 0 && b >= 0) sortRange([{ col: headerMenu.ci, dir: "desc" }], false, { top: a, bottom: b, left: rc.left, right: rc.right }); } },
          { sep: true },
          { id: "tc-type", label: "Edit column type", children: types.map(([ty, l]) => ({ id: `tct-${ty}`, label: l, checked: (tb.types?.[col.id] ?? "text") === ty, run: () => setType(ty) })) },
          { sep: true },
          { id: "tc-ins-l", label: "Insert 1 column left", run: () => onInsertColumn(headerMenu.ci, 1) },
          { id: "tc-ins-r", label: "Insert 1 column right", run: () => onInsertColumn(headerMenu.ci + 1, 1) },
          { id: "tc-del", label: "Delete column", disabled: !canManage, run: () => onDeleteColumn(col.id) },
        ];
        return <MenuPopup nodes={items} anchor={{ x: headerMenu.rect.right - 16, y: headerMenu.rect.bottom }} onClose={() => setHeaderMenu(null)} />;
      }
      return null;
    })()}
    {tableMenu && (() => {
      const tb = (settings.tables ?? []).find((x) => x.id === tableMenu.id);
      if (!tb) return null;
      const update = (patch: Partial<TableSpec>, label: string) => onSettings({ tables: (settings.tables ?? []).map((x) => (x.id === tb.id ? { ...x, ...patch } : x)) }, label);
      const drop = () => onSettings({ tables: (settings.tables ?? []).filter((x) => x.id !== tb.id).length ? (settings.tables ?? []).filter((x) => x.id !== tb.id) : null }, t("revert table"));
      const items: MenuNode[] = [
        { id: "tb-rename", label: "Rename table", disabled: !canEdit, run: () => { const name = window.prompt(t("Table name"), tb.name); if (name?.trim()) update({ name: name.trim() }, t("rename table")); } },
        { sep: true },
        { id: "tb-range", label: "Adjust table range", disabled: !canEdit, run: () => { const r = storedOf(rect); if (r) update({ range: r }, t("adjust table range")); } },
        { id: "tb-header", label: "Table header colour", disabled: !canEdit, panel: (close) => <ColorPicker value={tb.header ?? TABLE_HEADER} onPick={(c) => { update({ header: c ?? undefined }, t("table header colour")); close(); }} /> },
        { id: "tb-format", label: "Table formatting", disabled: !canEdit, children: [
          { id: "tb-band", label: "Alternating colours", checked: tb.banded !== false, run: () => update({ banded: tb.banded === false ? undefined : false }, t("table formatting")) },
        ] },
        { sep: true },
        { id: "tb-revert", label: "Revert to unformatted data", disabled: !canEdit, run: drop },
        { id: "tb-delete", label: "Delete table", danger: true, disabled: !canEdit, run: () => {
          const rc = rangeRect(tb.range, data.shape);
          drop();
          if (rc) onSetCells(rows.slice(rc.top, rc.bottom + 1).map((r) => ({ rowId: r.id, values: Object.fromEntries(columnsRange(rc.left, rc.right).map((c) => [columns[c].id, null])) })));
        } },
      ];
      return <MenuPopup nodes={items} anchor={{ x: tableMenu.x, y: tableMenu.y }} onClose={() => setTableMenu(null)} />;
    })()}
    {slicerMenu && (() => {
      const sl = (settings.slicers ?? []).find((x) => x.id === slicerMenu.id);
      if (!sl) return null;
      const rc = rangeRect(sl.range, data.shape);
      const ids = rc ? rows.slice(rc.top + 1, rc.bottom + 1).map((r) => r.id) : [];
      const colors = colorsInColumn(ids, sl.colId, styleOfCell);
      return (
        <FilterMenu
          anchor={slicerMenu.rect}
          columnLabel={rc ? display(rows[rc.top]?.id ?? "", sl.colId) : ""}
          values={distinctValues(ids, sl.colId, display)}
          crit={sl.crit}
          fills={colors.fills}
          texts={colors.texts}
          onSort={() => setSlicerMenu(null)}
          onApply={(c) => { onSettings({ slicers: (settings.slicers ?? []).map((x) => (x.id === sl.id ? { ...x, crit: c } : x)) }, t("slicer")); setSlicerMenu(null); }}
          onClose={() => setSlicerMenu(null)}
        />
      );
    })()}

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
function ColumnHeader({ index, col, hidden, active, whole, canEdit, showMarks, sortDir, filtered, hiddenBefore, onUnhide, style, onSelect, onMenu, onResize, onAutofit, groupMark }: {
  groupMark?: ReactNode;
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
  if (hidden) return <th data-col-index={index} style={style} className="sticky top-0 z-30 overflow-hidden border-b border-border bg-muted p-0">{groupMark}</th>;
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
      {groupMark}
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

/** How a cell is decorated by sheet-level features (computed once per render by the grid). */
type Decor = {
  /** Alternating colours / table body (under the cell's own format). */
  base?: Partial<CellStyle>;
  /** Conditional formatting (over it). */
  cf?: Partial<CellStyle>;
  /** Header cell of a filter or a table: shows the ▾ / funnel button. */
  head?: "filter" | "table";
  filtered?: boolean;
  /** Green outline sides of the filter range. */
  edge?: string;
  /** View › Show › Protected ranges. */
  stripes?: boolean;
};

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
  onEdit: (colIndex: number) => void;
  ruleAt: (rawRow: number, colIndex: number) => ValidationRule | null;
  onOpenDropdown: (colIndex: number) => void;
  onToggleCheck: (colIndex: number) => void;
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
  /** Resolved height (explicit, or grown to fit wrapped/rotated text). */
  height: number;
  /** Alternating colours / table / conditional formatting / filter decorations of a cell. */
  decorAt: (rawRow: number, colIndex: number) => Decor | null;
  noGrid: boolean;
  showFormulas: boolean;
  commentsHidden: boolean;
  onNoteHover: (rowId: string, colId: string, rect: DOMRect | null) => void;
  /** The ▾ on a filter / table header cell. */
  onHeaderMenu: (colIndex: number, rect: DOMRect) => void;
  /** Row-group gutter content for this row (brackets and [–]/[+]). */
  gutter: ReactNode;
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
      style={{ height: p.height }}
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
        {p.gutter}
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
        const own = p.row.styles?.[col.id];
        const dec = p.decorAt(p.rawIndex, ci);
        // Alternating colours and tables sit UNDER the cell's own format; conditional formatting on top.
        const st: CellStyle | undefined = dec ? { ...(dec.base ?? {}), ...(own ?? {}), ...(dec.cf ?? {}) } as CellStyle : own;
        const computed = engine.value(p.row.id, col.id);
        const ruleHit = col.rules?.length ? matchRule(col.rules, computed) : null;
        const dv = p.ruleAt(p.rawIndex, ci);
        const invalid = dv ? !validateCell(dv, value, computed, { engine, shape: p.data.shape, at: { r: p.rawIndex, c: ci } }) : false;
        const peerHere = p.peerCursors[key];
        const numeric = typeof computed === "number" && col.type !== "checkbox" && col.type !== "select" && col.type !== "multiselect";

        // Shadows: drawn borders, the selection's outer edge, the active cell, the freeze line.
        const shadows: string[] = [];
        if (dec?.edge) {
          const g = "var(--success)";
          if (dec.edge.includes("t")) shadows.push(`inset 0 2px 0 0 ${g}`);
          if (dec.edge.includes("b")) shadows.push(`inset 0 -2px 0 0 ${g}`);
          if (dec.edge.includes("l")) shadows.push(`inset 2px 0 0 0 ${g}`);
          if (dec.edge.includes("r")) shadows.push(`inset -2px 0 0 0 ${g}`);
        }
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
        const styled = formatWithStyle(computed, st?.nf, st?.dp, isFormulaCell(value) ? engine.format(p.row.id, col.id) : (col.type === "currency" ? "idr" : col.type === "date" ? "date" : null), st?.pt);
        // A custom pattern's [Red]/[Blue]… section colours the value, over the cell's text colour.
        const patColor = st?.nf === "custom" && st.pt && (typeof computed === "number" || typeof computed === "string") ? formatNumberPattern(computed, st.pt).color : undefined;
        const text = p.showFormulas && isFormulaCell(value)
          ? editFormula(value, p.data.shape) ?? ""
          : styled ?? displayCell(col.type, value, { data: p.data, rowId: p.row.id, colId: col.id });
        const fill = st?.bg || ruleHit;
        const wrap = wrapMode(st);
        // Overflow: left-aligned text spills over empty neighbours to the right (stops at the first
        // non-empty one, like Sheets). Numbers never spill.
        let spill = 0;
        if (wrap === "o" && !numeric && text && !span && (st?.ha ?? "l") === "l" && !isEditing && !st?.rt) {
          for (let k = ci + 1; k < p.columns.length; k += 1) {
            const nc = p.columns[k];
            const key2 = `${p.row.id}:${nc.id}`;
            const v2 = p.row.cells[nc.id];
            if (p.hiddenCols.has(nc.id)) continue;
            if ((v2 !== undefined && v2 !== null && v2 !== "") || p.merges.covered.has(key2) || p.merges.anchors.has(key2) || p.ruleAt(p.rawIndex, k)) break;
            spill += p.widthsKey[k] ?? 0;
            if (spill > 2000) break;
          }
        }
        const borders = borderOverlay(st);
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
              ...(patColor ? { color: patColor } : {}),
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
            onDoubleClick={() => p.canEdit && p.onEdit(ci)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (!inRect) p.onSelect(ci, false);
              p.onCellMenu(ci, { left: e.clientX, top: e.clientY });
            }}
            className={cn(
              "group/cell relative px-1.5 py-0.5",
              spill ? "overflow-visible" : "overflow-hidden",
              p.noGrid ? "border-b border-r border-transparent" : "border-b border-r border-border/80",
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
            {borders && <span aria-hidden style={borders} />}
            {dec?.stripes && <span aria-hidden className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_oklab,var(--muted-foreground)_18%,transparent)_6px_8px)]" />}
            {(dec?.head === "filter" || dec?.head === "table") && p.canEdit !== undefined && (
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); p.onHeaderMenu(ci, (e.currentTarget.closest("td") as HTMLElement).getBoundingClientRect()); }}
                aria-label={dec.head === "filter" ? t("Filter menu") : t("Column menu")}
                className={cn("absolute right-0.5 top-1/2 z-[4] grid h-4 w-4 -translate-y-1/2 place-items-center rounded-sm",
                  dec.head === "table" ? "text-white/90 hover:bg-white/20" : dec.filtered ? "bg-success text-white" : "text-success hover:bg-success/15")}
              >
                {dec.head === "table" ? <ChevronDown className="h-3 w-3" /> : <ListFilter className="h-3 w-3" />}
              </button>
            )}
            {st?.nt && (
              <span
                onMouseEnter={(e) => p.onNoteHover(p.row.id, col.id, (e.currentTarget.closest("td") as HTMLElement).getBoundingClientRect())}
                onMouseLeave={() => p.onNoteHover(p.row.id, col.id, null)}
                className="absolute right-0 top-0 z-[3] h-0 w-0 border-l-[6px] border-t-[6px] border-l-transparent border-t-foreground"
              />
            )}
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
            {!p.commentsHidden && (p.commentCounts[key] ?? 0) > 0 && (
              <span
                title={t("{n} comments — right-click to open", { n: p.commentCounts[key] })}
                className="pointer-events-none absolute right-0 top-0 h-0 w-0 border-l-[6px] border-t-[6px] border-l-transparent border-t-amber-500"
              />
            )}
            {/* Invalid for its data-validation rule: Sheets' red corner, with the reason on hover. */}
            {invalid && dv && (
              <span
                title={invalidMessage(dv, t)}
                aria-label={invalidMessage(dv, t)}
                className="absolute right-0 top-0 z-[3] h-0 w-0 border-l-[7px] border-t-[7px] border-l-transparent border-t-red-600"
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
            ) : isDropdown(dv) && dv ? (
              <DropdownCell
                picked={dv.multiple ? pickedValues(value) : (value === undefined || value === null || value === "" ? [] : [isFormula(value) ? String(computed ?? "") : Array.isArray(value) ? value.join(", ") : String(value)])}
                colors={dv.colors}
                display={dv.display ?? "chip"}
                canEdit={p.canEdit}
                wrap={Boolean(st?.w)}
                onOpen={() => p.onOpenDropdown(ci)}
              />
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
            ) : col.type === "checkbox" || dv?.kind === "checkbox" ? ((() => {
              const on = col.type === "checkbox" ? value === true : isChecked(dv, value);
              return (
                <button
                  disabled={!p.canEdit}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => p.onToggleCheck(ci)}
                  role="checkbox"
                  aria-checked={on}
                  aria-label={on ? t("Untick") : t("Tick")}
                  className={cn("mx-auto grid h-4 w-4 place-items-center rounded border transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "border-control-border bg-card hover:border-foreground/60")}
                >
                  {on ? <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden><path d="M2.5 6.5l2.2 2.2L9.5 3.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
                </button>
              );
            })()) : (
              <span
                className={cn("block",
                  st?.rt ? "whitespace-pre" : wrap === "w" ? "whitespace-pre-wrap break-words" : wrap === "c" ? "overflow-hidden whitespace-pre" : spill ? "relative z-[2] overflow-hidden whitespace-pre" : "truncate whitespace-pre",
                  isError(computed) && isFormula(value) ? "font-medium text-destructive" : "")}
                style={{ ...rotationStyle(st), ...(spill ? { width: (p.widthsKey[ci] ?? 0) + spill - 12 } : {}) }}
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
  a.height === b.height &&
  a.decorAt === b.decorAt &&
  a.noGrid === b.noGrid &&
  a.showFormulas === b.showFormulas &&
  a.commentsHidden === b.commentsHidden &&
  a.gutter === b.gutter &&
  a.frozenCols === b.frozenCols &&
  a.stickyTop === b.stickyTop &&
  a.freezeEdge === b.freezeEdge &&
  a.hiddenCols === b.hiddenCols &&
  a.unhideRows === b.unhideRows &&
  a.merges === b.merges &&
  a.ruleAt === b.ruleAt &&
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

/** Format › Resize rows / columns: a number in pixels, or "Fit to data". */
function ResizeDialog({ kind, label, initial, onApply, onClose }: {
  kind: "rows" | "cols"; label: string; initial: number;
  onApply: (v: number | "fit") => void; onClose: () => void;
}) {
  const { t } = useLang();
  const [mode, setMode] = useState<"px" | "fit">("px");
  const [v, setV] = useState(String(initial));
  return (
    <SheetDialog
      title={kind === "rows" ? t("Resize rows {r}", { r: label }) : t("Resize columns {r}", { r: label })}
      onClose={onClose}
      width={380}
      footer={<><button className="rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-muted" onClick={onClose}>{t("Cancel")}</button><button className={primaryBtn} onClick={() => onApply(mode === "fit" ? "fit" : Number(v) || initial)}>{t("OK")}</button></>}
    >
      <label className="flex items-center gap-2 py-1 text-sm">
        <input type="radio" checked={mode === "px"} onChange={() => setMode("px")} className="accent-primary" />
        {kind === "rows" ? t("Specify row height") : t("Enter new column width in pixels")}
        <input value={v} onChange={(e) => { setV(e.target.value.replace(/[^0-9]/g, "")); setMode("px"); }} inputMode="numeric" className="ml-auto h-8 w-20 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-ring" />
      </label>
      <label className="flex items-center gap-2 py-1 text-sm">
        <input type="radio" checked={mode === "fit"} onChange={() => setMode("fit")} className="accent-primary" />
        {t("Fit to data")}
      </label>
    </SheetDialog>
  );
}
