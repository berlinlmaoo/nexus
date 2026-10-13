import type { CSSProperties } from "react";
import type { NexusSheetCellStyle, NexusSheetStyleColor } from "@/lib/nexus-api";
import type { BorderEdge, BorderLine, BorderSpec, WrapMode } from "@/lib/sheet-model";
// Relative + .ts so lib/sheet-palette.test.mjs can load this file under plain node.
import { DEFAULT_FONT_PT, fontStack, isHexColor, ptToPx, readableText } from "../../lib/sheet-palette.ts";

/**
 * Per-cell formatting for the grid: how a stored style (server: normalizeCellStyle) paints a cell.
 *
 * Colours: older sheets store named palette tokens ("red"), painted with classes that have a light
 * and a dark rendering. Since the Sheets-parity work (12 Oct 2026) the pickers store literal hex
 * ("#ffe599"), painted inline — that's the user's data, like in Sheets. Both keep working.
 */
export type CellStyle = NexusSheetCellStyle;
export type StyleColor = NexusSheetStyleColor;

export const STYLE_COLORS: StyleColor[] = ["black", "slate", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink"];

/** Text colours (readable on the card in both themes). */
export const TEXT_COLOR_CLASS: Record<StyleColor, string> = {
  black: "text-foreground",
  slate: "text-slate-500 dark:text-slate-400",
  red: "text-red-600 dark:text-red-400",
  orange: "text-orange-600 dark:text-orange-400",
  amber: "text-amber-600 dark:text-amber-400",
  green: "text-green-600 dark:text-green-400",
  teal: "text-teal-600 dark:text-teal-400",
  blue: "text-blue-600 dark:text-blue-400",
  violet: "text-violet-600 dark:text-violet-400",
  pink: "text-pink-600 dark:text-pink-400",
};
/** Fill colours (soft, so any text colour stays legible on top). */
export const FILL_COLOR_CLASS: Record<StyleColor, string> = {
  black: "bg-zinc-300 dark:bg-zinc-600",
  slate: "bg-slate-100 dark:bg-slate-800",
  red: "bg-red-100 dark:bg-red-950",
  orange: "bg-orange-100 dark:bg-orange-950",
  amber: "bg-amber-100 dark:bg-amber-950",
  green: "bg-green-100 dark:bg-green-950",
  teal: "bg-teal-100 dark:bg-teal-950",
  blue: "bg-blue-100 dark:bg-blue-950",
  violet: "bg-violet-100 dark:bg-violet-950",
  pink: "bg-pink-100 dark:bg-pink-950",
};
/** The swatch shown in the palette pickers (a solid sample of each colour). */
export const SWATCH_CLASS: Record<StyleColor, string> = {
  black: "bg-zinc-900 dark:bg-zinc-100",
  slate: "bg-slate-400",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-400",
  green: "bg-green-500",
  teal: "bg-teal-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  pink: "bg-pink-500",
};
export const COLOR_NAME: Record<StyleColor, string> = {
  black: "Black", slate: "Grey", red: "Red", orange: "Orange", amber: "Yellow", green: "Green",
  teal: "Teal", blue: "Blue", violet: "Purple", pink: "Pink",
};

/** Legacy px sizes (the toolbar now works in points: FONT_SIZES_PT in lib/sheet-palette). */
export const FONT_SIZES = [9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 36];
export const DEFAULT_FONT_SIZE = 13;

const legacy = (c: string | undefined): StyleColor | null => (c && !c.startsWith("#") && c in TEXT_COLOR_CLASS ? (c as StyleColor) : null);

/** Classes for a styled cell's text and background (legacy named colours; hex is painted inline). */
export function styleClasses(st: CellStyle | undefined): string {
  if (!st) return "";
  const fc = legacy(st.fc), bg = legacy(st.bg);
  return [
    st.b ? "font-bold" : "",
    st.i ? "italic" : "",
    st.s && st.u ? "[text-decoration-line:underline_line-through]" : st.s ? "line-through" : st.u ? "underline" : "",
    fc ? TEXT_COLOR_CLASS[fc] : "",
    bg ? FILL_COLOR_CLASS[bg] : "",
  ].filter(Boolean).join(" ");
}

/** The cell's font size in px, when it has one (`fp` points win over the legacy `fs` px). */
export function fontPx(st: CellStyle | undefined): number | undefined {
  if (st?.fp) return ptToPx(st.fp);
  return st?.fs || undefined;
}

/** The size the toolbar shows, in points (default 10). */
export function fontPt(st: CellStyle | undefined): number {
  if (st?.fp) return st.fp;
  if (st?.fs) return Math.round(((st.fs * 3) / 4) * 2) / 2;
  return DEFAULT_FONT_PT;
}

/**
 * Inline style parts a class can't express: font size and family, hex text/fill colours. A hex fill
 * without a text colour gets black or white text, so a light fill stays readable in dark mode.
 */
export function styleInline(st: CellStyle | undefined): CSSProperties {
  if (!st) return {};
  const out: CSSProperties = {};
  const px = fontPx(st);
  if (px) { out.fontSize = px; out.lineHeight = 1.25; }
  const ff = fontStack(st.ff);
  if (ff) out.fontFamily = ff;
  if (isHexColor(st.bg)) {
    out.backgroundColor = st.bg;
    if (!st.fc) out.color = readableText(st.bg);
  }
  if (isHexColor(st.fc)) out.color = st.fc;
  return out;
}

/** Overflow (default), wrap or clip. The legacy `w: 1` flag means wrap; `wr` wins. */
export function wrapMode(st: CellStyle | undefined): WrapMode {
  return st?.wr ?? (st?.w ? "w" : "o");
}

/** Text classes per wrap mode (overflowing into empty neighbours is the grid's job). */
export function wrapClass(st: CellStyle | undefined): string {
  const m = wrapMode(st);
  return m === "w" ? "whitespace-pre-wrap break-words" : m === "c" ? "overflow-hidden whitespace-pre text-clip" : "whitespace-pre";
}

/**
 * CSS for the text span of a rotated cell: Sheets' angle is counter-clockwise (tilt up = 45), CSS is
 * clockwise, hence the minus. "v" stacks the letters upright, one per line.
 */
export function rotationStyle(st: CellStyle | undefined): CSSProperties {
  const rt = st?.rt;
  if (rt === undefined || rt === 0) return {};
  if (rt === "v") return { display: "inline-block", writingMode: "vertical-rl", textOrientation: "upright", whiteSpace: "pre", lineHeight: 1.1 };
  return { display: "inline-block", transform: `rotate(${-rt}deg)`, transformOrigin: "center", whiteSpace: "pre" };
}

/** Rough box a rotated text needs (for auto row height): text width ≈ 0.55em per character. */
export function rotatedBox(text: string, st: CellStyle | undefined, px: number): { w: number; h: number } {
  const lines = text.split("\n");
  const longest = Math.max(0, ...lines.map((l) => l.length));
  const w = longest * px * 0.55;
  const h = lines.length * px * 1.25;
  const rt = st?.rt;
  if (rt === "v") {
    const chars = Math.max(0, ...lines.map((l) => [...l].length));
    return { w: lines.length * px * 1.2, h: chars * px * 1.1 };
  }
  if (!rt) return { w, h };
  const a = (Math.abs(rt) * Math.PI) / 180;
  return { w: w * Math.cos(a) + h * Math.sin(a), h: w * Math.sin(a) + h * Math.cos(a) };
}

/** Vertical alignment: Sheets defaults to the bottom of the cell. */
export function verticalClass(st: CellStyle | undefined): string {
  return st?.va === "t" ? "align-top" : st?.va === "m" ? "align-middle" : "align-bottom";
}

/** Horizontal alignment: explicit, else numbers right and everything else left (like Sheets). */
export function horizontalClass(st: CellStyle | undefined, numeric: boolean): string {
  const ha = st?.ha ?? (numeric ? "r" : "l");
  return ha === "c" ? "text-center" : ha === "r" ? "text-right" : "text-left";
}

/** Drawn borders as inset shadows, so they never fight the 1px gridlines in a collapsed table. */
export function borderShadows(st: CellStyle | undefined): string[] {
  const bd = st?.bd ?? "";
  const ink = "var(--foreground)";
  const out: string[] = [];
  if (bd.includes("t")) out.push(`inset 0 1px 0 0 ${ink}`);
  if (bd.includes("b")) out.push(`inset 0 -1px 0 0 ${ink}`);
  if (bd.includes("l")) out.push(`inset 1px 0 0 0 ${ink}`);
  if (bd.includes("r")) out.push(`inset -1px 0 0 0 ${ink}`);
  return out;
}

/** Apply a patch to a style; keys set to undefined/null/false are removed. Empty -> null. */
export function patchStyle(st: CellStyle | undefined, patch: Partial<Record<keyof CellStyle, unknown>>): CellStyle | null {
  const next: Record<string, unknown> = { ...(st ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === false || v === "" || v === "auto") delete next[k];
    else next[k] = v;
  }
  return Object.keys(next).length ? (next as CellStyle) : null;
}

export type BorderPreset = "all" | "outer" | "inner" | "top" | "bottom" | "left" | "right" | "none";

/**
 * The sides a border preset gives the cell at (r, c) of a block spanning rows top..bottom and columns
 * left..right — "outer" only draws the edge of the block, "all" every gridline, and so on.
 */
export function bordersFor(preset: BorderPreset, r: number, c: number, rect: { top: number; bottom: number; left: number; right: number }, current = ""): string {
  const edge = { t: r === rect.top, b: r === rect.bottom, l: c === rect.left, r: c === rect.right };
  const has = new Set(current.split("").filter(Boolean));
  const set = (side: "t" | "b" | "l" | "r", on: boolean) => { if (on) has.add(side); else has.delete(side); };
  switch (preset) {
    case "none": return "";
    case "all": return "tblr";
    case "outer": if (edge.t) set("t", true); if (edge.b) set("b", true); if (edge.l) set("l", true); if (edge.r) set("r", true); break;
    case "inner": if (!edge.b) set("b", true); if (!edge.r) set("r", true); break;
    case "top": if (edge.t) set("t", true); break;
    case "bottom": if (edge.b) set("b", true); break;
    case "left": if (edge.l) set("l", true); break;
    case "right": if (edge.r) set("r", true); break;
  }
  return [...has].sort().join("");
}

// ── Borders with style and colour (bx) ────────────────────────────────────────────────────────

/** The ten buttons of the Borders panel, in Sheets' order (two rows of five). */
export type BorderPreset10 = "all" | "inner" | "horizontal" | "vertical" | "outer" | "left" | "top" | "right" | "bottom" | "clear";
/** A border change for patchStyle: the new `bx` (null = none) and the legacy `bd` always dropped. */
export type BorderPatch = { bx: BorderSpec | null; bd: null };
export const BORDER_PRESETS: BorderPreset10[] = ["all", "inner", "horizontal", "vertical", "outer", "left", "top", "right", "bottom", "clear"];

const LINE_CSS: Record<BorderLine, string> = {
  thin: "1px solid", medium: "2px solid", thick: "3px solid", dotted: "1px dotted", dashed: "1px dashed", double: "3px double",
};
export function borderCss(e: BorderEdge): string {
  return `${LINE_CSS[e.s] ?? LINE_CSS.thin} ${e.c && isHexColor(e.c) ? e.c : "var(--foreground)"}`;
}

/** Every drawn edge of a cell: `bx` per side, the legacy `bd` sides (thin, text colour) where bx has none. */
export function cellBorders(st: CellStyle | undefined): BorderSpec {
  const out: BorderSpec = {};
  for (const side of st?.bd ?? "") if (side === "t" || side === "b" || side === "l" || side === "r") out[side] = { s: "thin" };
  const bx = st?.bx;
  if (bx) for (const side of ["t", "b", "l", "r"] as const) if (bx[side]) out[side] = bx[side];
  return out;
}

/**
 * An absolutely placed box (pointer-events off) that draws the cell's borders inside its edges, or
 * null when it has none. Put it as the first child of the (position: relative) cell.
 */
export function borderOverlay(st: CellStyle | undefined): CSSProperties | null {
  const b = cellBorders(st);
  if (!b.t && !b.b && !b.l && !b.r) return null;
  const css: CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1 };
  if (b.t) css.borderTop = borderCss(b.t);
  if (b.b) css.borderBottom = borderCss(b.b);
  if (b.l) css.borderLeft = borderCss(b.l);
  if (b.r) css.borderRight = borderCss(b.r);
  return css;
}

/**
 * The new borders of the cell at (r, c) when `preset` is applied to the block `rect`.
 *
 * An edge between two cells of the block is stored ONCE — as the bottom of the upper cell / the right
 * of the left cell — so neighbours never draw it twice; top/left edges are only stored on the block's
 * first row/column. Legacy `bd` sides are folded into `bx` (and `bd` dropped). Returns a patch for
 * patchStyle: { bx: spec | null, bd: null }. "clear" removes everything on the cell; the cell above /
 * to the left of the block may still carry the shared edge (clear those with clearNeighbourEdge).
 */
export function applyBorderPreset(
  preset: BorderPreset10,
  r: number,
  c: number,
  rect: { top: number; bottom: number; left: number; right: number },
  current: CellStyle | undefined,
  line: BorderLine = "thin",
  color: string | null = null,
): BorderPatch {
  if (preset === "clear") return { bx: null, bd: null };
  const spec: BorderSpec = { ...cellBorders(current) };
  const edge: BorderEdge = color && isHexColor(color) ? { s: line, c: color.toLowerCase() } : { s: line };
  const top = r === rect.top, bottom = r === rect.bottom, left = c === rect.left, right = c === rect.right;
  const set = (side: keyof BorderSpec) => { spec[side] = { ...edge }; };
  const drop = (side: keyof BorderSpec) => { delete spec[side]; };
  switch (preset) {
    case "all":
      set("b"); set("r");
      if (top) set("t"); else drop("t");
      if (left) set("l"); else drop("l");
      break;
    case "inner":
      if (!bottom) set("b");
      if (!right) set("r");
      if (!top) drop("t");
      if (!left) drop("l");
      break;
    case "horizontal":
      if (!bottom) set("b");
      if (!top) drop("t");
      break;
    case "vertical":
      if (!right) set("r");
      if (!left) drop("l");
      break;
    case "outer":
      if (top) set("t");
      if (bottom) set("b");
      if (left) set("l");
      if (right) set("r");
      break;
    case "left": if (left) set("l"); break;
    case "top": if (top) set("t"); break;
    case "right": if (right) set("r"); break;
    case "bottom": if (bottom) set("b"); break;
  }
  const empty = !spec.t && !spec.b && !spec.l && !spec.r;
  return { bx: empty ? null : spec, bd: null };
}

/**
 * For "clear" (and to be thorough, "top"/"left" replacements): the side of a NEIGHBOUR that shares the
 * block's edge — the cell above the block keeps the line as its `b`, the cell left of it as its `r`.
 * Returns the patch for that neighbour, or null when it carries nothing on that side.
 */
export function clearNeighbourEdge(neighbour: CellStyle | undefined, side: "b" | "r"): BorderPatch | null {
  const spec = cellBorders(neighbour);
  if (!spec[side]) return null;
  delete spec[side];
  const empty = !spec.t && !spec.b && !spec.l && !spec.r;
  return { bx: empty ? null : spec, bd: null };
}
