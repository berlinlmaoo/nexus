// The spreadsheet's sheet-level model beyond values (Google Sheets parity, owner 12 Oct 2026:
// "plek ketiplek"). Everything here lives in ProjectSheet.settings (JSON) or SheetRow.styles (JSON),
// so no table or column had to be added. Ranges are ALWAYS the id-space form used by formulas and data
// validation ("{colId!rowId}:{colId!rowId}", whole columns "{colId!*}:{colId!*}"), so inserting or
// moving rows/columns never detaches a rule from its cells. The server narrows every key in
// readSheetSettings (src/lib/project-sheets.ts) — keep the two in step.

/** "#rrggbb" (lower case). The 80-swatch palette, theme colours and custom picks are all hex. */
export type Hex = string;
export const isHex = (v: unknown): v is Hex => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

// ── Per-cell formatting additions (SheetRow.styles) ─────────────────────────────────────────────

export type BorderLine = "thin" | "medium" | "thick" | "dotted" | "dashed" | "double";
export const BORDER_LINES: BorderLine[] = ["thin", "medium", "thick", "dotted", "dashed", "double"];
/** One drawn edge: line style + colour (absent colour = the text colour, like Sheets' black). */
export type BorderEdge = { s: BorderLine; c?: Hex };
export type BorderSpec = { t?: BorderEdge; b?: BorderEdge; l?: BorderEdge; r?: BorderEdge };

/** Number formats. "custom" carries a Sheets-style pattern in `pt` (custom number/date/currency). */
export type NumberFormatKind =
  | "auto" | "text" | "num" | "pct" | "sci" | "acct" | "fin" | "idr" | "cur" | "cur0"
  | "date" | "time" | "dt" | "dur" | "custom";

/** Text rotation: degrees −90…90 (tilt up = 45, rotate up = 90), or "v" = stacked vertically. */
export type Rotation = number | "v";
/** Wrapping: o overflow (default), w wrap, c clip. The legacy `w: 1` flag still means wrap. */
export type WrapMode = "o" | "w" | "c";

// ── Conditional formatting ──────────────────────────────────────────────────────────────────────

export type CondKind =
  | "empty" | "notEmpty"
  | "textContains" | "textNotContains" | "textStarts" | "textEnds" | "textIs"
  | "dateIs" | "dateBefore" | "dateAfter"
  | "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "between" | "notBetween"
  | "formula";
export const COND_KINDS: CondKind[] = [
  "empty", "notEmpty", "textContains", "textNotContains", "textStarts", "textEnds", "textIs",
  "dateIs", "dateBefore", "dateAfter", "gt", "gte", "lt", "lte", "eq", "neq", "between", "notBetween", "formula",
];
/** The look a matching rule gives a cell (Sheets: bold, italic, underline, strike, text, fill). */
export type CondStyle = { b?: 1; i?: 1; u?: 1; s?: 1; fc?: Hex; bg?: Hex };
export type ScalePointType = "min" | "max" | "num" | "pct" | "pctile" | "none";
export type ScalePoint = { type: ScalePointType; value?: string; color: Hex };
export type CondRule = {
  id: string;
  ranges: string[];
  type: "single" | "scale";
  cond?: CondKind;
  /** Criteria values (two for between); for date kinds: "today" | "tomorrow" | "yesterday" | "week" | "month" | "year" | an exact date. */
  values?: string[];
  /** Custom formula, stored form (relative to the first range's top-left cell). */
  formula?: string;
  style?: CondStyle;
  scale?: { min: ScalePoint; mid?: ScalePoint; max: ScalePoint };
};

// ── Alternating colours ─────────────────────────────────────────────────────────────────────────

export type Banding = { id: string; range: string; header?: Hex; c1: Hex; c2: Hex; footer?: Hex };

// ── Filter, filter views, slicers ───────────────────────────────────────────────────────────────

/** One column's filter: hidden values (by shown text), a condition, or a colour. */
export type FilterCrit = {
  hidden?: string[];
  cond?: { kind: CondKind; values?: string[]; formula?: string };
  fill?: Hex;
  text?: Hex;
};
export type SortSpec = { colId: string; dir: "asc" | "desc" };
export type SheetFilter = { range: string; criteria?: Record<string, FilterCrit>; sort?: SortSpec };
export type FilterView = SheetFilter & { id: string; name: string };

/** A floating object's place: anchored to a cell by id (so it moves with inserts), plus a px offset. */
export type Anchor = { r: string; c: string; dx?: number; dy?: number };
export type Slicer = { id: string; range: string; colId: string; at: Anchor; w?: number; title?: string; crit?: FilterCrit; bg?: Hex };

// ── Named & protected ranges, groups, tables ────────────────────────────────────────────────────

export type NamedRange = { id: string; name: string; range: string };
export type Protection = {
  id: string;
  /** A range, or the whole sheet when `sheet` is set. */
  range?: string;
  sheet?: true;
  /** "Except certain cells" (sheet protection only). */
  except?: string[];
  desc?: string;
  /** warn = "Show a warning when editing this range"; restrict = only `editors` (and the creator) may edit. */
  mode: "warn" | "restrict";
  editors?: string[];
  by?: string;
};
export type Group = { id: string; from: string; to: string; collapsed?: true };
export type TableColumnType = "text" | "number" | "pct" | "currency" | "date" | "time" | "dt" | "dur" | "checkbox" | "dropdown" | "none";
export type TableSpec = {
  id: string;
  name: string;
  range: string;
  header?: Hex;
  /** Alternating row colours (default on). */
  banded?: boolean;
  footer?: boolean;
  types?: Record<string, TableColumnType>;
};

// ── Charts & pivots ─────────────────────────────────────────────────────────────────────────────

export type ChartType =
  | "column" | "columnStacked" | "column100"
  | "bar" | "barStacked" | "bar100"
  | "line" | "lineSmooth"
  | "area" | "areaStacked" | "area100" | "areaStepped"
  | "pie" | "donut"
  | "scatter" | "bubble"
  | "combo"
  | "histogram" | "radar" | "waterfall"
  | "scorecard" | "table";
export type ChartSpec = {
  id: string;
  type: ChartType;
  /** Data range(s), stored form. The first column is the x-axis / labels unless `labels` is off. */
  ranges: string[];
  at: Anchor;
  w: number;
  h: number;
  title?: string;
  subtitle?: string;
  /** Use row 1 as headers / column A as labels / switch rows and columns / aggregate. */
  headers?: boolean;
  labels?: boolean;
  transpose?: boolean;
  aggregate?: "sum" | "avg" | "count" | "min" | "max";
  /** Customise: colours per series, background, legend, axis titles, data labels, gridlines. */
  colors?: Hex[];
  bg?: Hex;
  legend?: "top" | "bottom" | "right" | "left" | "none";
  xTitle?: string;
  yTitle?: string;
  dataLabels?: boolean;
  gridlines?: boolean;
  yMin?: number;
  yMax?: number;
  /** Scorecard: the key value cell and an optional baseline. */
  key?: string;
  baseline?: string;
};

export type PivotSummarize = "SUM" | "COUNTA" | "COUNT" | "COUNTUNIQUE" | "AVERAGE" | "MAX" | "MIN" | "MEDIAN" | "PRODUCT" | "STDEV" | "STDEVP" | "VAR" | "VARP";
export type PivotGroupSpec = { colId: string; order?: "asc" | "desc"; totals?: boolean };
export type PivotValueSpec = { colId: string; fn: PivotSummarize; showAs?: "default" | "row" | "col" | "total" };
export type PivotFilterSpec = { colId: string; hidden?: string[] };
export type PivotSpec = {
  /** The sheet the data comes from, and its range there (that sheet's id space). */
  source: string;
  range: string;
  rows: PivotGroupSpec[];
  cols: PivotGroupSpec[];
  values: PivotValueSpec[];
  filters: PivotFilterSpec[];
};

// ── Spreadsheet-wide options ────────────────────────────────────────────────────────────────────

export type SheetTheme = { name: string; font?: string; text?: Hex; accents: Hex[]; link?: Hex };
export type SheetLocaleCode = "id-ID" | "en-US";
export type NamedVersion = { id: string; name: string; at: string };

/** Every settings key the web client reads and writes (the server keeps exactly these). */
export type SheetSettingsModel = {
  frozenRows?: number;
  frozenCols?: number;
  /** A column-colour name (legacy) or a hex colour. */
  tabColor?: string;
  hiddenRows?: string[];
  hiddenCols?: string[];
  merges?: { r: string; c: string; rs: number; cs: number }[];
  condFormats?: CondRule[];
  bandings?: Banding[];
  filter?: SheetFilter;
  filterViews?: FilterView[];
  slicers?: Slicer[];
  namedRanges?: NamedRange[];
  protections?: Protection[];
  rowGroups?: Group[];
  colGroups?: Group[];
  tables?: TableSpec[];
  charts?: ChartSpec[];
  pivot?: PivotSpec;
  theme?: SheetTheme;
  locale?: SheetLocaleCode;
  timeZone?: string;
  recalc?: "change" | "minute" | "hour";
  iterative?: { on: boolean; max: number; threshold: number };
  versions?: NamedVersion[];
  /** The tab is hidden (View › Hidden sheets). */
  hidden?: true;
  /** Gridlines off (View › Show › Gridlines). */
  noGrid?: true;
};

export const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
