import type { CSSProperties } from "react";
import type { NexusSheetCellStyle, NexusSheetStyleColor } from "@/lib/nexus-api";

/**
 * Per-cell formatting for the grid: how a stored style (server: normalizeCellStyle) paints a cell.
 *
 * Colours are named palette tokens, never free hex, so a sheet can't drift off the app's palette and
 * dark mode keeps working: every swatch has a light and a dark rendering.
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

export const FONT_SIZES = [9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 36];
export const DEFAULT_FONT_SIZE = 13;

/** Classes for a styled cell's text and background. */
export function styleClasses(st: CellStyle | undefined): string {
  if (!st) return "";
  return [
    st.b ? "font-bold" : "",
    st.i ? "italic" : "",
    st.s && st.u ? "[text-decoration-line:underline_line-through]" : st.s ? "line-through" : st.u ? "underline" : "",
    st.fc ? TEXT_COLOR_CLASS[st.fc] : "",
    st.bg ? FILL_COLOR_CLASS[st.bg] : "",
  ].filter(Boolean).join(" ");
}

/** Inline style parts a class can't express (font size). */
export function styleInline(st: CellStyle | undefined): CSSProperties {
  return st?.fs ? { fontSize: st.fs, lineHeight: 1.25 } : {};
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
