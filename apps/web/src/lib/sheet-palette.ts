// The spreadsheet's colours and fonts, the Google Sheets way (owner, 12 Oct 2026: "plek ketiplek").
//
// Colours a person picks for their cells are DATA, stored as literal "#rrggbb" — exactly the 80-swatch
// grid Sheets shows (palette.txt in the inventory), the 8 "STANDARD" theme colours, or a custom pick.
// Older sheets stored named colours ("red", "amber"…); toHex() maps those so pickers can tick them and
// chips can paint them. Fonts: only families every device already has, so nothing is downloaded.
// Pure: no React, no "@/…" imports (tested in sheet-palette.test.mjs).

export type Swatch = { hex: string; en: string; id: string };

const ROWS: [string, string, string][][] = [
  [["#000000", "black", "hitam"], ["#434343", "dark grey 4", "abu-abu tua 4"], ["#666666", "dark grey 3", "abu-abu tua 3"], ["#999999", "dark grey 2", "abu-abu tua 2"], ["#b7b7b7", "dark grey 1", "abu-abu tua 1"], ["#cccccc", "grey", "abu-abu"], ["#d9d9d9", "light grey 1", "abu-abu muda 1"], ["#efefef", "light grey 2", "abu-abu muda 2"], ["#f3f3f3", "light grey 3", "abu-abu muda 3"], ["#ffffff", "white", "putih"]],
  [["#980000", "red berry", "beri merah"], ["#ff0000", "red", "merah"], ["#ff9900", "orange", "oranye"], ["#ffff00", "yellow", "kuning"], ["#00ff00", "green", "hijau"], ["#00ffff", "cyan", "sian"], ["#4a86e8", "cornflower blue", "biru cornflower"], ["#0000ff", "blue", "biru"], ["#9900ff", "purple", "ungu"], ["#ff00ff", "magenta", "magenta"]],
  [["#e6b8af", "light red berry 3", "beri merah muda 3"], ["#f4cccc", "light red 3", "merah muda 3"], ["#fce5cd", "light orange 3", "oranye muda 3"], ["#fff2cc", "light yellow 3", "kuning muda 3"], ["#d9ead3", "light green 3", "hijau muda 3"], ["#d0e0e3", "light cyan 3", "sian muda 3"], ["#c9daf8", "light cornflower blue 3", "biru cornflower muda 3"], ["#cfe2f3", "light blue 3", "biru muda 3"], ["#d9d2e9", "light purple 3", "ungu muda 3"], ["#ead1dc", "light magenta 3", "magenta muda 3"]],
  [["#dd7e6b", "light red berry 2", "beri merah muda 2"], ["#ea9999", "light red 2", "merah muda 2"], ["#f9cb9c", "light orange 2", "oranye muda 2"], ["#ffe599", "light yellow 2", "kuning muda 2"], ["#b6d7a8", "light green 2", "hijau muda 2"], ["#a2c4c9", "light cyan 2", "sian muda 2"], ["#a4c2f4", "light cornflower blue 2", "biru cornflower muda 2"], ["#9fc5e8", "light blue 2", "biru muda 2"], ["#b4a7d6", "light purple 2", "ungu muda 2"], ["#d5a6bd", "light magenta 2", "magenta muda 2"]],
  [["#cc4125", "light red berry 1", "beri merah muda 1"], ["#e06666", "light red 1", "merah muda 1"], ["#f6b26b", "light orange 1", "oranye muda 1"], ["#ffd966", "light yellow 1", "kuning muda 1"], ["#93c47d", "light green 1", "hijau muda 1"], ["#76a5af", "light cyan 1", "sian muda 1"], ["#6d9eeb", "light cornflower blue 1", "biru cornflower muda 1"], ["#6fa8dc", "light blue 1", "biru muda 1"], ["#8e7cc3", "light purple 1", "ungu muda 1"], ["#c27ba0", "light magenta 1", "magenta muda 1"]],
  [["#a61c00", "dark red berry 1", "beri merah tua 1"], ["#cc0000", "dark red 1", "merah tua 1"], ["#e69138", "dark orange 1", "oranye tua 1"], ["#f1c232", "dark yellow 1", "kuning tua 1"], ["#6aa84f", "dark green 1", "hijau tua 1"], ["#45818e", "dark cyan 1", "sian tua 1"], ["#3c78d8", "dark cornflower blue 1", "biru cornflower tua 1"], ["#3d85c6", "dark blue 1", "biru tua 1"], ["#674ea7", "dark purple 1", "ungu tua 1"], ["#a64d79", "dark magenta 1", "magenta tua 1"]],
  [["#85200c", "dark red berry 2", "beri merah tua 2"], ["#990000", "dark red 2", "merah tua 2"], ["#b45f06", "dark orange 2", "oranye tua 2"], ["#bf9000", "dark yellow 2", "kuning tua 2"], ["#38761d", "dark green 2", "hijau tua 2"], ["#134f5c", "dark cyan 2", "sian tua 2"], ["#1155cc", "dark cornflower blue 2", "biru cornflower tua 2"], ["#0b5394", "dark blue 2", "biru tua 2"], ["#351c75", "dark purple 2", "ungu tua 2"], ["#741b47", "dark magenta 2", "magenta tua 2"]],
  [["#5b0f00", "dark red berry 3", "beri merah tua 3"], ["#660000", "dark red 3", "merah tua 3"], ["#783f04", "dark orange 3", "oranye tua 3"], ["#7f6000", "dark yellow 3", "kuning tua 3"], ["#274e13", "dark green 3", "hijau tua 3"], ["#0c343d", "dark cyan 3", "sian tua 3"], ["#1c4587", "dark cornflower blue 3", "biru cornflower tua 3"], ["#073763", "dark blue 3", "biru tua 3"], ["#20124d", "dark purple 3", "ungu tua 3"], ["#4c1130", "dark magenta 3", "magenta tua 3"]],];

/** The 10×8 swatch grid, row by row: greys, pure hues, then light 3/2/1 and dark 1/2/3 of each hue. */
export const PALETTE_ROWS: Swatch[][] = ROWS.map((row) => row.map(([hex, en, id]) => ({ hex, en, id })));
export const PALETTE: Swatch[] = PALETTE_ROWS.flat();

/** Sheets' default theme ("STANDARD"): black, white and the six accents. */
export const STANDARD_THEME: string[] = ["#000000", "#ffffff", "#4285f4", "#ea4335", "#fbbc04", "#34a853", "#ff6d01", "#46bdc6"];

/** Named colours from before hex (cell styles, dropdown chips, column/tab colours), as one solid hex each. */
export const LEGACY_COLOR_HEX: Record<string, string> = {
  black: "#000000",
  slate: "#94a3b8",
  red: "#ef4444",
  orange: "#f97316",
  amber: "#fbbf24",
  green: "#22c55e",
  teal: "#14b8a6",
  blue: "#3b82f6",
  violet: "#8b5cf6",
  pink: "#ec4899",
  rose: "#f43f5e",
};

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#[0-9a-f]{3}$/i;

/** Any stored colour (hex, short hex, legacy name) → "#rrggbb" lower case; null when unknown/empty. */
export function toHex(c: string | null | undefined): string | null {
  if (!c) return null;
  const v = c.trim();
  if (HEX6.test(v)) return v.toLowerCase();
  if (HEX3.test(v)) return ("#" + v.slice(1).split("").map((x) => x + x).join("")).toLowerCase();
  return LEGACY_COLOR_HEX[v.toLowerCase()] ?? null;
}

export const isHexColor = (c: unknown): c is string => typeof c === "string" && HEX6.test(c);

/** The swatch with this colour (for tooltips and ticks), if it is one of the 80. */
export function swatchOf(c: string | null | undefined): Swatch | null {
  const h = toHex(c);
  return h ? PALETTE.find((s) => s.hex === h) ?? null : null;
}

function luminance(hex: string): number {
  const ch = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
}

/** Black or white, whichever reads better on this background (WCAG contrast). */
export function readableText(bg: string | null | undefined): "#000000" | "#ffffff" {
  const h = toHex(bg);
  if (!h) return "#000000";
  const l = luminance(h);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#000000" : "#ffffff";
}

// ── Recent custom colours (per device) ──────────────────────────────────────────────────────────

export const CUSTOM_COLORS_KEY = "nexus-sheet-custom-colors";
export const MAX_CUSTOM_COLORS = 10;

function store(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function loadCustomColors(): string[] {
  try {
    const raw = JSON.parse(store()?.getItem(CUSTOM_COLORS_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter(isHexColor).map((x) => x.toLowerCase()).slice(0, MAX_CUSTOM_COLORS) : [];
  } catch {
    return [];
  }
}

/** Put a custom colour first (deduplicated, at most 10). Returns the new list. */
export function addCustomColor(hex: string): string[] {
  const h = toHex(hex);
  const list = loadCustomColors();
  if (!h) return list;
  const next = [h, ...list.filter((x) => x !== h)].slice(0, MAX_CUSTOM_COLORS);
  try { store()?.setItem(CUSTOM_COLORS_KEY, JSON.stringify(next)); } catch { /* private mode: keep in memory only */ }
  return next;
}

// ── Fonts ───────────────────────────────────────────────────────────────────────────────────────

/** `name` is what a cell stores in `ff`; "Default" (absent) = the app's own font. */
export type FontFamily = { name: string; css: string };
export const DEFAULT_FONT = "Default";
export const FONT_FAMILIES: FontFamily[] = [
  { name: DEFAULT_FONT, css: "inherit" },
  { name: "Arial", css: "Arial, Helvetica, sans-serif" },
  { name: "Calibri", css: "Calibri, Carlito, 'Segoe UI', sans-serif" },
  { name: "Cambria", css: "Cambria, Caladea, Georgia, serif" },
  { name: "Comic Sans MS", css: "'Comic Sans MS', 'Comic Sans', 'Comic Neue', cursive" },
  { name: "Consolas", css: "Consolas, 'Liberation Mono', Menlo, monospace" },
  { name: "Courier New", css: "'Courier New', Courier, monospace" },
  { name: "Georgia", css: "Georgia, 'Times New Roman', serif" },
  { name: "Helvetica", css: "Helvetica, Arial, sans-serif" },
  { name: "Impact", css: "Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif" },
  { name: "Lucida Console", css: "'Lucida Console', Monaco, monospace" },
  { name: "Segoe UI", css: "'Segoe UI', system-ui, sans-serif" },
  { name: "Tahoma", css: "Tahoma, Verdana, sans-serif" },
  { name: "Times New Roman", css: "'Times New Roman', Times, serif" },
  { name: "Trebuchet MS", css: "'Trebuchet MS', 'Lucida Grande', sans-serif" },
  { name: "Verdana", css: "Verdana, Geneva, sans-serif" },
  { name: "Serif", css: "serif" },
  { name: "Sans Serif", css: "sans-serif" },
  { name: "Monospace", css: "monospace" },
];

/** The CSS font-family for a stored `ff` (unknown names are still tried, then the app font). */
export function fontStack(ff: string | null | undefined, families: FontFamily[] = FONT_FAMILIES): string | undefined {
  if (!ff || ff === DEFAULT_FONT) return undefined;
  const f = families.find((x) => x.name.toLowerCase() === ff.toLowerCase());
  return f ? f.css : `'${ff.replace(/'/g, "")}', inherit`;
}

/** Font sizes in points, as the Sheets toolbar lists them. */
export const FONT_SIZES_PT = [6, 7, 8, 9, 10, 11, 12, 14, 18, 24, 36];
export const DEFAULT_FONT_PT = 10;
export const MIN_FONT_PT = 1;
export const MAX_FONT_PT = 400;

export const ptToPx = (pt: number): number => (pt * 4) / 3;
/** Pixels → points, rounded to a half point (13px → 10pt). */
export const pxToPt = (px: number): number => Math.round(((px * 3) / 4) * 2) / 2;
