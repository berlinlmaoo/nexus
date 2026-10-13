import { SEP, tidy, type MenuNode } from "./sheet-menus";

/**
 * Every menu of the spreadsheet, item for item and in Google Sheets' order (inventory, 12 Oct 2026):
 * the menu bar, the cell / column-header / row-header right-click menus. Pure data: the grid passes
 * its state and ONE dispatcher (`act`), so menus, context menus and "Search the menus" all run the
 * same code path. Labels are English source text; the Indonesian ones (Sheets' own id-ID labels) live
 * in lib/i18n/id-sheets-menus.ts.
 */
export type MenuAction =
  // File
  | "import" | "download" | "renameSheet" | "nameVersion" | "versionHistory" | "settings" | "print"
  // Edit
  | "undo" | "redo" | "cut" | "copy" | "paste" | "pasteSpecial" | "moveRows" | "moveCols"
  | "deleteValues" | "deleteRows" | "deleteCols" | "deleteCellsUp" | "deleteCellsLeft" | "deleteNotes" | "findReplace"
  // View
  | "toggleFormulaBar" | "toggleGridlines" | "toggleFormulas" | "toggleProtected" | "freezeRows" | "freezeCols"
  | "groupRows" | "ungroupRows" | "groupCols" | "ungroupCols" | "toggleComments" | "showAllComments"
  | "unhideSheet" | "zoom" | "fullScreen"
  // Insert
  | "insertCellsRight" | "insertCellsDown" | "insertRowsAbove" | "insertRowsBelow" | "insertColsLeft" | "insertColsRight"
  | "insertSheet" | "insertChart" | "insertPivot" | "insertFunction" | "insertLink" | "insertCheckbox"
  | "insertDropdown" | "insertComment" | "insertNote"
  // Format
  | "theme" | "numberFormat" | "customFormat" | "style" | "fontSize" | "merge" | "convertTable" | "condFormat"
  | "alternating" | "clearFormat"
  // Data
  | "sortSheet" | "sortRange" | "sortAdvanced" | "toggleFilter" | "filterViewGroupBy" | "filterViewCreate"
  | "filterViewSaveAs" | "filterViewOpen" | "filterViewAction" | "slicer" | "protect" | "namedRanges"
  | "randomize" | "columnStats" | "validation" | "removeDuplicates" | "trimWhitespace" | "splitText"
  // Tools / Help
  | "calcMode" | "autocomplete" | "searchMenus" | "functionList" | "shortcuts"
  // Context-only
  | "hideRows" | "hideCols" | "resizeRows" | "resizeCols" | "clearRows" | "clearCols" | "cellLink" | "defineNamed"
  | "protectRange" | "fitToData";

export type MenuCtx = {
  canEdit: boolean;
  canManage: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Selection, as people read it (1-based rows, column letters). */
  sel: {
    r1: number; r2: number; c1: string; c2: string; colIndex: number;
    nRows: number; nCols: number; single: boolean; wholeRows: boolean; wholeCols: boolean;
    /** Active cell's row (1-based) and column letter. */
    activeRow: number; activeCol: string;
  };
  frozenRows: number;
  frozenCols: number;
  zoom: number;
  showFormulaBar: boolean;
  showGrid: boolean;
  showFormulas: boolean;
  showProtected: boolean;
  commentsHidden: boolean;
  fullScreen: boolean;
  hiddenSheets: { id: string; name: string }[];
  merged: boolean;
  canMerge: boolean;
  hasFilter: boolean;
  views: { id: string; name: string }[];
  activeViewId: string | null;
  /** Header labels of the current region's columns (for "Create group-by filter view ▸"). */
  regionColumns: { colId: string; label: string }[];
  numberItems: { key: string; label: string; example: string }[];
  activeNumberFormat: string;
  style: { b?: boolean; i?: boolean; u?: boolean; s?: boolean; ha?: string; va?: string; wrap: "o" | "w" | "c"; rt?: number | "v"; fontPt: number };
  hasNotes: boolean;
  inTable: boolean;
  isLink: boolean;
  calcManual: boolean;
  autocomplete: boolean;
  /** Σ categories → function names. */
  functions: { category: string; names: string[] }[];
  act: (a: MenuAction, arg?: unknown) => void;
};

const range = (a: string | number, b: string | number) => (a === b ? `${a}` : `${a} - ${b}`);

export function buildMenuBar(c: MenuCtx): { id: string; label: string; nodes: MenuNode[] }[] {
  const ro = !c.canEdit;
  const s = c.sel;
  const rows = range(s.r1, s.r2), cols = range(s.c1, s.c2);
  const n = (id: string, label: string, run: () => void, extra: Partial<Extract<MenuNode, { id: string }>> = {}): MenuNode => ({ id, label, run, ...extra });
  const pasteSpecial = (): MenuNode[] => [
    n("ps-values", "Values only", () => c.act("pasteSpecial", "values"), { shortcut: "Ctrl+Shift+V", disabled: ro }),
    n("ps-format", "Format only", () => c.act("pasteSpecial", "format"), { shortcut: "Ctrl+Alt+V", disabled: ro }),
    n("ps-formula", "Formula only", () => c.act("pasteSpecial", "formula"), { disabled: ro }),
    n("ps-cf", "Conditional formatting only", () => c.act("pasteSpecial", "cf"), { disabled: ro }),
    n("ps-dv", "Data validation only", () => c.act("pasteSpecial", "dv"), { disabled: ro }),
    SEP,
    n("ps-transpose", "Transposed", () => c.act("pasteSpecial", "transpose"), { disabled: ro }),
    SEP,
    n("ps-widths", "Column widths only", () => c.act("pasteSpecial", "widths"), { disabled: ro }),
    n("ps-noborders", "All except borders", () => c.act("pasteSpecial", "noBorders"), { disabled: ro }),
  ];
  const fn = (name: string): MenuNode => n(`fn-${name}`, name, () => c.act("insertFunction", name), { disabled: ro });
  const functionMenu: MenuNode[] = [
    ...["SUM", "AVERAGE", "COUNT", "MAX", "MIN"].map(fn),
    SEP,
    ...c.functions.map((g): MenuNode => ({ id: `fncat-${g.category}`, label: g.category, children: g.names.map(fn) })),
  ];
  const rotations: [string, string, number | "v" | null][] = [
    ["rot-none", "None", null], ["rot-tiltup", "Tilt up", 45], ["rot-tiltdown", "Tilt down", -45],
    ["rot-stack", "Stack vertically", "v"], ["rot-up", "Rotate up", 90], ["rot-down", "Rotate down", -90],
  ];
  const angles = Array.from({ length: 13 }, (_, i) => -90 + i * 15);

  const file: MenuNode[] = tidy([
    n("import", "Import", () => c.act("import"), { disabled: ro }),
    SEP,
    { id: "download", label: "Download", children: [
      n("dl-xlsx", "Microsoft Excel (.xlsx)", () => c.act("download", "xlsx")),
      n("dl-pdf", "PDF (.pdf)", () => c.act("download", "pdf")),
      n("dl-html", "Web page (.html)", () => c.act("download", "html")),
      n("dl-csv", "Comma-separated values (.csv)", () => c.act("download", "csv")),
      n("dl-tsv", "Tab-separated values (.tsv)", () => c.act("download", "tsv")),
    ] },
    SEP,
    n("rename", "Rename", () => c.act("renameSheet"), { disabled: ro }),
    SEP,
    { id: "versions", label: "Version history", children: [
      n("name-version", "Name current version", () => c.act("nameVersion"), { disabled: ro }),
      n("see-versions", "See version history", () => c.act("versionHistory"), { shortcut: "Ctrl+Alt+Shift+H" }),
    ] },
    SEP,
    n("settings", "Settings", () => c.act("settings")),
    SEP,
    n("print", "Print", () => c.act("print"), { shortcut: "Ctrl+P" }),
  ]);

  const edit: MenuNode[] = tidy([
    n("undo", "Undo", () => c.act("undo"), { shortcut: "Ctrl+Z", disabled: ro || !c.canUndo }),
    n("redo", "Redo", () => c.act("redo"), { shortcut: "Ctrl+Y", disabled: ro || !c.canRedo }),
    SEP,
    n("cut", "Cut", () => c.act("cut"), { shortcut: "Ctrl+X", disabled: ro }),
    n("copy", "Copy", () => c.act("copy"), { shortcut: "Ctrl+C" }),
    n("paste", "Paste", () => c.act("paste"), { shortcut: "Ctrl+V", disabled: ro }),
    { id: "paste-special", label: "Paste special", disabled: ro, children: pasteSpecial() },
    SEP,
    { id: "move", label: "Move", disabled: ro || !(s.wholeRows || s.wholeCols), children: [
      n("move-row-up", s.nRows > 1 ? "Rows {rows} up" : "Row up", () => c.act("moveRows", -1), { vars: { rows }, disabled: !s.wholeRows }),
      n("move-row-down", s.nRows > 1 ? "Rows {rows} down" : "Row down", () => c.act("moveRows", 1), { vars: { rows }, disabled: !s.wholeRows }),
      n("move-col-left", s.nCols > 1 ? "Columns {cols} left" : "Column left", () => c.act("moveCols", -1), { vars: { cols }, disabled: !s.wholeCols }),
      n("move-col-right", s.nCols > 1 ? "Columns {cols} right" : "Column right", () => c.act("moveCols", 1), { vars: { cols }, disabled: !s.wholeCols }),
    ] },
    { id: "delete", label: "Delete", disabled: ro, children: [
      n("del-values", "Values", () => c.act("deleteValues"), { shortcut: "Delete" }),
      n("del-rows", s.nRows > 1 ? "Rows {rows}" : "Row {rows}", () => c.act("deleteRows"), { vars: { rows } }),
      n("del-cols", s.nCols > 1 ? "Columns {cols}" : "Column {cols}", () => c.act("deleteCols"), { vars: { cols }, disabled: !c.canManage }),
      n("del-up", "Cells and shift up", () => c.act("deleteCellsUp")),
      n("del-left", "Cells and shift left", () => c.act("deleteCellsLeft")),
      n("del-notes", "Notes", () => c.act("deleteNotes"), { disabled: !c.hasNotes }),
    ] },
    SEP,
    n("find", "Find and replace", () => c.act("findReplace"), { shortcut: "Ctrl+H" }),
  ]);

  const freezeRowsItems = [0, 1, 2].map((k) => n(`fr-${k}`, k === 0 ? "No rows" : k === 1 ? "1 row" : "2 rows", () => c.act("freezeRows", k), { checked: c.frozenRows === k, disabled: ro }));
  const freezeColsItems = [0, 1, 2].map((k) => n(`fc-${k}`, k === 0 ? "No columns" : k === 1 ? "1 column" : "2 columns", () => c.act("freezeCols", k), { checked: c.frozenCols === k, disabled: ro }));
  const view: MenuNode[] = tidy([
    { id: "show", label: "Show", children: [
      n("show-fx", "Formula bar", () => c.act("toggleFormulaBar"), { checked: c.showFormulaBar, shortcut: "Ctrl+Shift+U" }),
      n("show-grid", "Gridlines", () => c.act("toggleGridlines"), { checked: c.showGrid, disabled: ro }),
      n("show-formulas", "Formulas", () => c.act("toggleFormulas"), { checked: c.showFormulas, shortcut: "Ctrl+`" }),
      n("show-protected", "Protected ranges", () => c.act("toggleProtected"), { checked: c.showProtected }),
    ] },
    { id: "freeze", label: "Freeze", children: [
      ...freezeRowsItems,
      n("fr-upto", "Up to row {n}", () => c.act("freezeRows", s.activeRow), { vars: { n: s.activeRow }, checked: c.frozenRows === s.activeRow && s.activeRow > 2, disabled: ro || s.activeRow > 20 }),
      SEP,
      ...freezeColsItems,
      n("fc-upto", "Up to column {c}", () => c.act("freezeCols", s.colIndex + 1), { vars: { c: s.activeCol }, checked: c.frozenCols === s.colIndex + 1 && s.colIndex > 1, disabled: ro || s.colIndex >= 10 }),
    ] },
    { id: "group", label: "Group", children: tidy([
      s.wholeCols && !s.wholeRows
        ? n("group-cols", "Group columns {cols}", () => c.act("groupCols"), { vars: { cols }, shortcut: "Alt+Shift+→", disabled: ro })
        : n("group-rows", "Group rows {rows}", () => c.act("groupRows"), { vars: { rows }, shortcut: "Alt+Shift+→", disabled: ro }),
      s.wholeCols && !s.wholeRows
        ? n("ungroup-cols", "Ungroup columns {cols}", () => c.act("ungroupCols"), { vars: { cols }, shortcut: "Alt+Shift+←", disabled: ro })
        : n("ungroup-rows", "Ungroup rows {rows}", () => c.act("ungroupRows"), { vars: { rows }, shortcut: "Alt+Shift+←", disabled: ro }),
    ]) },
    { id: "comments", label: "Comments", children: [
      n("comments-hide", "Hide comments", () => c.act("toggleComments"), { checked: c.commentsHidden, shortcut: "Ctrl+Alt+Shift+J" }),
      SEP,
      n("comments-all", "Show all comments", () => c.act("showAllComments"), { shortcut: "Ctrl+Alt+Shift+A" }),
    ] },
    SEP,
    { id: "hidden-sheets", label: "Hidden sheets", disabled: !c.hiddenSheets.length, children: c.hiddenSheets.map((h) => n(`unhide-${h.id}`, "{name}", () => c.act("unhideSheet", h.id), { vars: { name: h.name } })) },
    SEP,
    { id: "zoom", label: "Zoom", children: [50, 75, 90, 100, 125, 150, 200].map((z) => n(`zoom-${z}`, `${z}%`, () => c.act("zoom", z / 100), { checked: Math.round(c.zoom * 100) === z })) },
    n("fullscreen", "Full screen", () => c.act("fullScreen"), { checked: c.fullScreen, shortcut: "Ctrl+F1" }),
  ]);

  const insert: MenuNode[] = tidy([
    { id: "ins-cells", label: "Cells", disabled: ro, children: [
      n("ins-cells-right", "Insert cells and shift right", () => c.act("insertCellsRight")),
      n("ins-cells-down", "Insert cells and shift down", () => c.act("insertCellsDown")),
    ] },
    { id: "ins-rows", label: "Rows", disabled: ro, children: [
      n("ins-rows-above", s.nRows > 1 ? "Insert {n} rows above" : "Insert 1 row above", () => c.act("insertRowsAbove"), { vars: { n: s.nRows } }),
      n("ins-rows-below", s.nRows > 1 ? "Insert {n} rows below" : "Insert 1 row below", () => c.act("insertRowsBelow"), { vars: { n: s.nRows } }),
    ] },
    { id: "ins-cols", label: "Columns", disabled: ro, children: [
      n("ins-cols-left", s.nCols > 1 ? "Insert {n} columns left" : "Insert 1 column left", () => c.act("insertColsLeft"), { vars: { n: s.nCols } }),
      n("ins-cols-right", s.nCols > 1 ? "Insert {n} columns right" : "Insert 1 column right", () => c.act("insertColsRight"), { vars: { n: s.nCols } }),
    ] },
    n("ins-sheet", "Sheet", () => c.act("insertSheet"), { shortcut: "Shift+F11", disabled: ro }),
    SEP,
    n("ins-chart", "Chart", () => c.act("insertChart"), { disabled: ro, shortcut: "Alt+F1" }),
    n("ins-pivot", "Pivot table", () => c.act("insertPivot"), { disabled: ro }),
    SEP,
    { id: "ins-fn", label: "Function", disabled: ro, children: functionMenu },
    n("ins-link", "Link", () => c.act("insertLink"), { shortcut: "Ctrl+K", disabled: ro }),
    SEP,
    n("ins-checkbox", "Checkbox", () => c.act("insertCheckbox"), { disabled: ro }),
    n("ins-dropdown", "Dropdown", () => c.act("insertDropdown"), { disabled: ro }),
    SEP,
    n("ins-comment", "Comment", () => c.act("insertComment"), { shortcut: "Ctrl+Alt+M" }),
    n("ins-note", "Note", () => c.act("insertNote"), { shortcut: "Shift+F2", disabled: ro }),
  ]);

  const st = c.style;
  const format: MenuNode[] = tidy([
    n("theme", "Theme", () => c.act("theme"), { disabled: ro }),
    SEP,
    { id: "number", label: "Number", disabled: ro, children: c.numberItems.map((it, i) => (it.key === "sep"
      ? { sep: true as const }
      : n(`nf-${it.key}-${i}`, it.label, () => (it.key.startsWith("custom") ? c.act("customFormat", it.key) : c.act("numberFormat", it.key)), { hint: it.example, checked: c.activeNumberFormat === it.key }))) },
    { id: "text", label: "Text", disabled: ro, children: [
      n("bold", "Bold", () => c.act("style", { b: st.b ? null : 1 }), { shortcut: "Ctrl+B", checked: st.b }),
      n("italic", "Italic", () => c.act("style", { i: st.i ? null : 1 }), { shortcut: "Ctrl+I", checked: st.i }),
      n("underline", "Underline", () => c.act("style", { u: st.u ? null : 1 }), { shortcut: "Ctrl+U", checked: st.u }),
      n("strike", "Strikethrough", () => c.act("style", { s: st.s ? null : 1 }), { shortcut: "Alt+Shift+5", checked: st.s }),
    ] },
    { id: "align", label: "Alignment", disabled: ro, children: [
      n("al-l", "Left", () => c.act("style", { ha: "l" }), { shortcut: "Ctrl+Shift+L", checked: st.ha === "l" }),
      n("al-c", "Centre", () => c.act("style", { ha: "c" }), { shortcut: "Ctrl+Shift+E", checked: st.ha === "c" }),
      n("al-r", "Right", () => c.act("style", { ha: "r" }), { shortcut: "Ctrl+Shift+R", checked: st.ha === "r" }),
      SEP,
      n("al-t", "Top", () => c.act("style", { va: "t" }), { checked: st.va === "t" }),
      n("al-m", "Middle", () => c.act("style", { va: "m" }), { checked: st.va === "m" }),
      n("al-b", "Bottom", () => c.act("style", { va: null }), { checked: !st.va || st.va === "b" }),
    ] },
    { id: "wrap", label: "Wrapping", disabled: ro, children: [
      n("wr-o", "Overflow", () => c.act("style", { wr: null, w: null }), { checked: st.wrap === "o" }),
      n("wr-w", "Wrap", () => c.act("style", { wr: "w", w: null }), { checked: st.wrap === "w" }),
      n("wr-c", "Clip", () => c.act("style", { wr: "c", w: null }), { checked: st.wrap === "c" }),
    ] },
    { id: "rotation", label: "Rotation", disabled: ro, children: [
      ...rotations.map(([id, label, v]) => n(id, label, () => c.act("style", { rt: v }), { checked: (st.rt ?? null) === v })),
      SEP,
      { id: "rot-custom", label: "Custom angle", children: angles.map((a) => n(`rot-${a}`, `${a}°`, () => c.act("style", { rt: a === 0 ? null : a }), { checked: (st.rt ?? 0) === a })) },
    ] },
    SEP,
    { id: "fontsize", label: "Font size", disabled: ro, children: [6, 7, 8, 9, 10, 11, 12, 14, 18, 24, 36].map((pt) => n(`fs-${pt}`, `${pt}`, () => c.act("fontSize", pt), { checked: st.fontPt === pt })) },
    { id: "merge", label: "Merge cells", disabled: ro || (!c.canMerge && !c.merged), children: [
      n("merge-all", "Merge all", () => c.act("merge", "all"), { disabled: !c.canMerge }),
      n("merge-v", "Merge vertically", () => c.act("merge", "vertical"), { disabled: !c.canMerge || s.nRows < 2 }),
      n("merge-h", "Merge horizontally", () => c.act("merge", "horizontal"), { disabled: !c.canMerge || s.nCols < 2 }),
      n("unmerge", "Unmerge", () => c.act("merge", "unmerge"), { disabled: !c.merged }),
    ] },
    SEP,
    n("table", "Convert to table", () => c.act("convertTable"), { shortcut: "Ctrl+Alt+T", disabled: ro || c.inTable }),
    n("cf", "Conditional formatting", () => c.act("condFormat"), { disabled: ro }),
    n("alt", "Alternating colours", () => c.act("alternating"), { disabled: ro }),
    SEP,
    n("clearfmt", "Clear formatting", () => c.act("clearFormat"), { shortcut: "Ctrl+\\", disabled: ro }),
  ]);

  const col = s.activeCol;
  const data: MenuNode[] = tidy([
    { id: "sort-sheet", label: "Sort sheet", disabled: ro, children: [
      n("sort-sheet-az", "Sort sheet by column {c} (A to Z)", () => c.act("sortSheet", "asc"), { vars: { c: col } }),
      n("sort-sheet-za", "Sort sheet by column {c} (Z to A)", () => c.act("sortSheet", "desc"), { vars: { c: col } }),
    ] },
    { id: "sort-range", label: "Sort range", disabled: ro || s.single, children: [
      n("sort-range-az", "Sort range by column {c} (A to Z)", () => c.act("sortRange", "asc"), { vars: { c: s.c1 } }),
      n("sort-range-za", "Sort range by column {c} (Z to A)", () => c.act("sortRange", "desc"), { vars: { c: s.c1 } }),
      SEP,
      n("sort-adv", "Advanced range sorting options", () => c.act("sortAdvanced")),
    ] },
    SEP,
    n("filter", c.hasFilter ? "Remove filter" : "Create a filter", () => c.act("toggleFilter"), { disabled: ro, shortcut: undefined }),
    { id: "fv-groupby", label: "Create group-by filter view", disabled: !c.regionColumns.length, children: c.regionColumns.map((rc) => n(`fvg-${rc.colId}`, "{name}", () => c.act("filterViewGroupBy", rc.colId), { vars: { name: rc.label } })) },
    n("fv-create", "Create filter view", () => c.act("filterViewCreate")),
    n("fv-saveas", "Save as filter view", () => c.act("filterViewSaveAs"), { disabled: !c.hasFilter }),
    { id: "fv-change", label: "Change view", disabled: !c.views.length, children: [
      n("fv-none", "None", () => c.act("filterViewOpen", null), { checked: !c.activeViewId }),
      ...c.views.map((v) => n(`fv-open-${v.id}`, "{name}", () => c.act("filterViewOpen", v.id), { vars: { name: v.name }, checked: c.activeViewId === v.id })),
    ] },
    { id: "fv-options", label: "View options", disabled: !c.views.length, children: [
      n("fv-save", "Save view", () => c.act("filterViewAction", "save"), { disabled: !c.activeViewId }),
      n("fv-link", "Get view link", () => c.act("filterViewAction", "link"), { disabled: !c.activeViewId }),
      n("fv-rename", "Rename view", () => c.act("filterViewAction", "rename"), { disabled: !c.activeViewId || ro }),
      n("fv-dup", "Duplicate view", () => c.act("filterViewAction", "duplicate"), { disabled: !c.activeViewId || ro }),
      n("fv-update", "Update view", () => c.act("filterViewAction", "update"), { disabled: !c.activeViewId || ro }),
      n("fv-delete", "Delete view", () => c.act("filterViewAction", "delete"), { disabled: !c.activeViewId || ro }),
      n("fv-delete-all", "Delete all views in tab", () => c.act("filterViewAction", "deleteAll"), { disabled: ro }),
    ] },
    n("slicer", "Add a slicer", () => c.act("slicer"), { disabled: ro }),
    SEP,
    n("protect", "Protect sheets and ranges", () => c.act("protect")),
    n("named", "Named ranges", () => c.act("namedRanges")),
    n("randomize", "Randomise range", () => c.act("randomize"), { disabled: ro || s.single }),
    SEP,
    n("colstats", "Column stats", () => c.act("columnStats")),
    n("dv", "Data validation", () => c.act("validation")),
    { id: "cleanup", label: "Data clean-up", disabled: ro, children: [
      n("cleanup-suggest", "Cleanup suggestions", () => undefined, { disabled: true, shortcut: "Ctrl+Alt+X" }),
      n("dedupe", "Remove duplicates", () => c.act("removeDuplicates")),
      n("trim", "Trim whitespace", () => c.act("trimWhitespace")),
    ] },
    n("split", "Split text to columns", () => c.act("splitText"), { disabled: ro || s.nCols > 1 }),
  ]);

  const tools: MenuNode[] = [
    { id: "suggestions", label: "Suggestion controls", children: [
      n("sg-auto", "Enable autocomplete", () => c.act("autocomplete"), { checked: c.autocomplete }),
    ] },
    { id: "calc", label: "Calculation control", children: [
      n("calc-auto", "Automatic", () => c.act("calcMode", false), { checked: !c.calcManual }),
      n("calc-manual", "Manual", () => c.act("calcMode", true), { checked: c.calcManual, hint: "F9" }),
    ] },
  ];

  const help: MenuNode[] = [
    n("help-search", "Search the menus", () => c.act("searchMenus"), { shortcut: "Alt+/" }),
    SEP,
    n("help-functions", "Function list", () => c.act("functionList")),
    n("help-shortcuts", "Keyboard shortcuts", () => c.act("shortcuts"), { shortcut: "Ctrl+/" }),
  ];

  return [
    { id: "file", label: "File", nodes: file },
    { id: "edit", label: "Edit", nodes: edit },
    { id: "view", label: "View", nodes: view },
    { id: "insert", label: "Insert", nodes: insert },
    { id: "format", label: "Format", nodes: format },
    { id: "data", label: "Data", nodes: data },
    { id: "tools", label: "Tools", nodes: tools },
    { id: "help", label: "Help", nodes: help },
  ];
}

/**
 * Right-click menus. Cell (21 entries in Sheets), column header (22) and row header (17), in order;
 * counts in the labels follow the selection ("Insert 3 rows above", "Delete rows 2 - 4").
 */
export function buildContextMenu(kind: "cell" | "col" | "row", c: MenuCtx): MenuNode[] {
  const ro = !c.canEdit;
  const s = c.sel;
  const rows = range(s.r1, s.r2), cols = range(s.c1, s.c2);
  const n = (id: string, label: string, run: () => void, extra: Partial<Extract<MenuNode, { id: string }>> = {}): MenuNode => ({ id, label, run, ...extra });
  const bar = buildMenuBar(c);
  const pasteSpecial = (bar[1].nodes.find((x) => "id" in x && x.id === "paste-special") as Extract<MenuNode, { id: string }>).children ?? [];
  const clip: MenuNode[] = [
    n("x-cut", "Cut", () => c.act("cut"), { shortcut: "Ctrl+X", disabled: ro }),
    n("x-copy", "Copy", () => c.act("copy"), { shortcut: "Ctrl+C" }),
    n("x-paste", "Paste", () => c.act("paste"), { shortcut: "Ctrl+V", disabled: ro }),
    { id: "x-paste-special", label: "Paste special", disabled: ro, children: pasteSpecial },
  ];
  const insRows = (where: "above" | "below") => n(`x-ins-rows-${where}`, s.nRows > 1 ? `Insert {n} rows ${where}` : `Insert 1 row ${where}`, () => c.act(where === "above" ? "insertRowsAbove" : "insertRowsBelow"), { vars: { n: s.nRows }, disabled: ro });
  const insCols = (where: "left" | "right") => n(`x-ins-cols-${where}`, s.nCols > 1 ? `Insert {n} columns ${where}` : `Insert 1 column ${where}`, () => c.act(where === "left" ? "insertColsLeft" : "insertColsRight"), { vars: { n: s.nCols }, disabled: ro });
  const delRows = n("x-del-rows", s.nRows > 1 ? "Delete rows {rows}" : "Delete row", () => c.act("deleteRows"), { vars: { rows }, disabled: ro });
  const delCols = n("x-del-cols", s.nCols > 1 ? "Delete columns {cols}" : "Delete column", () => c.act("deleteCols"), { vars: { cols }, disabled: ro || !c.canManage });
  const filter = n("x-filter", c.hasFilter ? "Remove filter" : "Create a filter", () => c.act("toggleFilter"), { disabled: ro });

  if (kind === "cell") {
    return tidy([
      ...clip,
      SEP,
      insRows("above"),
      insCols("left"),
      { id: "x-ins-cells", label: "Insert cells", disabled: ro, children: [
        n("x-ins-cells-right", "Shift right", () => c.act("insertCellsRight")),
        n("x-ins-cells-down", "Shift down", () => c.act("insertCellsDown")),
      ] },
      SEP,
      delRows,
      delCols,
      { id: "x-del-cells", label: "Delete cells", disabled: ro, children: [
        n("x-del-cells-up", "Shift up", () => c.act("deleteCellsUp")),
        n("x-del-cells-left", "Shift left", () => c.act("deleteCellsLeft")),
      ] },
      SEP,
      n("x-table", "Convert to table", () => c.act("convertTable"), { badge: "new", disabled: ro || c.inTable }),
      filter,
      SEP,
      n("x-link", c.isLink ? "Edit link" : "Insert link", () => c.act("insertLink"), { disabled: ro }),
      n("x-comment", "Comment", () => c.act("insertComment"), { shortcut: "Ctrl+Alt+M" }),
      n("x-note", c.hasNotes ? "Edit note" : "Insert note", () => c.act("insertNote"), { disabled: ro }),
      n("x-dropdown", "Dropdown", () => c.act("insertDropdown"), { disabled: ro }),
      SEP,
      { id: "x-more", label: "View more cell actions", children: [
        n("x-cf", "Conditional formatting", () => c.act("condFormat"), { disabled: ro }),
        n("x-dv", "Data validation", () => c.act("validation")),
        SEP,
        n("x-cell-link", "Get link to this cell", () => c.act("cellLink")),
        n("x-named", "Define named range", () => c.act("defineNamed")),
        n("x-protect", "Protect range", () => c.act("protectRange")),
      ] },
    ]);
  }
  if (kind === "col") {
    return tidy([
      ...clip,
      SEP,
      insCols("left"),
      insCols("right"),
      n("x-del-col", s.nCols > 1 ? "Delete columns {cols}" : "Delete column", () => c.act("deleteCols"), { vars: { cols }, disabled: ro || !c.canManage }),
      n("x-clear-col", s.nCols > 1 ? "Clear columns {cols}" : "Clear column", () => c.act("clearCols"), { vars: { cols }, disabled: ro }),
      n("x-hide-col", s.nCols > 1 ? "Hide columns {cols}" : "Hide column", () => c.act("hideCols"), { vars: { cols }, disabled: ro }),
      n("x-resize-col", s.nCols > 1 ? "Resize columns {cols}" : "Resize column", () => c.act("resizeCols"), { vars: { cols }, disabled: ro }),
      SEP,
      filter,
      SEP,
      n("x-sort-az", "Sort sheet A to Z", () => c.act("sortSheet", "asc"), { disabled: ro }),
      n("x-sort-za", "Sort sheet Z to A", () => c.act("sortSheet", "desc"), { disabled: ro }),
      SEP,
      n("x-cf", "Conditional formatting", () => c.act("condFormat"), { disabled: ro }),
      n("x-dv", "Data validation", () => c.act("validation")),
      n("x-stats", "Column stats", () => c.act("columnStats")),
      n("x-dropdown", "Dropdown", () => c.act("insertDropdown"), { disabled: ro }),
      SEP,
      { id: "x-more-col", label: "View more column actions", children: [
        n("x-freeze-col", "Freeze up to column {c}", () => c.act("freezeCols", s.colIndex + 1), { vars: { c: s.c2 }, disabled: ro || s.colIndex >= 10 }),
        n("x-group-col", "Group columns {cols}", () => c.act("groupCols"), { vars: { cols }, disabled: ro }),
        n("x-ungroup-col", "Ungroup columns {cols}", () => c.act("ungroupCols"), { vars: { cols }, disabled: ro }),
        n("x-fit", "Fit to data", () => c.act("fitToData"), { disabled: ro }),
        n("x-random", "Randomise range", () => c.act("randomize"), { disabled: ro }),
        SEP,
        n("x-col-link", "Get link to this range", () => c.act("cellLink")),
        n("x-named-col", "Define named range", () => c.act("defineNamed")),
        n("x-protect-col", "Protect range", () => c.act("protectRange")),
      ] },
    ]);
  }
  return tidy([
    ...clip,
    SEP,
    insRows("above"),
    insRows("below"),
    delRows,
    n("x-clear-row", s.nRows > 1 ? "Clear rows {rows}" : "Clear row", () => c.act("clearRows"), { vars: { rows }, disabled: ro }),
    n("x-hide-row", s.nRows > 1 ? "Hide rows {rows}" : "Hide row", () => c.act("hideRows"), { vars: { rows }, disabled: ro }),
    n("x-resize-row", s.nRows > 1 ? "Resize rows {rows}" : "Resize row", () => c.act("resizeRows"), { vars: { rows }, disabled: ro }),
    SEP,
    filter,
    SEP,
    n("x-cf", "Conditional formatting", () => c.act("condFormat"), { disabled: ro }),
    n("x-dv", "Data validation", () => c.act("validation")),
    SEP,
    { id: "x-more-row", label: "View more row actions", children: [
      n("x-freeze-row", "Freeze up to row {n}", () => c.act("freezeRows", s.r2), { vars: { n: s.r2 }, disabled: ro || s.r2 > 20 }),
      n("x-group-row", "Group rows {rows}", () => c.act("groupRows"), { vars: { rows }, disabled: ro }),
      n("x-ungroup-row", "Ungroup rows {rows}", () => c.act("ungroupRows"), { vars: { rows }, disabled: ro }),
      SEP,
      n("x-row-link", "Get link to this range", () => c.act("cellLink")),
      n("x-named-row", "Define named range", () => c.act("defineNamed")),
      n("x-protect-row", "Protect range", () => c.act("protectRange")),
    ] },
  ]);
}
