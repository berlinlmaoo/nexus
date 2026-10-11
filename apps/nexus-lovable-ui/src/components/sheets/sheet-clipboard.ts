import { r1c1ToA1 } from "@/lib/sheet-formula";
import { parseTsv, toTsv } from "./sheet-types";

/**
 * Spreadsheet clipboard, interoperable with Google Sheets and Excel.
 *
 * What goes OUT (matches what Sheets itself writes, per the REA study of an id-ID sheet, 11 Oct 2026):
 *   text/plain  TSV of the DISPLAY strings ("1.500.000", "15%", "11/10/2026"), formulas as their
 *               results, fields with tab/newline/quote wrapped in "…", no trailing newline.
 *   text/html   a <table> (in-cell newlines as <br>), which Sheets/Excel/Docs paste as a table.
 *   NEXUS_MIME  our own JSON: raw values, formats and formulas (A1 + the origin cell), so a
 *               NEXUS→NEXUS paste keeps formulas and shifts their relative references.
 * Google's own rich data lives in a private type we deliberately do not depend on.
 *
 * What comes IN: our JSON when present; else an HTML table (colspan/rowspan expanded, <br> kept as a
 * newline); else TSV. Every external cell then goes through the same parser as typing (inputToCell),
 * so a leading "=" is a formula and "Rp 1.500.000" is a number.
 */
export const NEXUS_MIME = "application/x-nexus-sheet+json";

/** One copied cell. `formula` is the A1 text as shown (Indonesian separators), when it is one. */
export type ClipCell = { text: string; raw?: unknown; formula?: string; style?: Record<string, unknown> | null };
export type ClipPayload = {
  v: 1;
  /** Top-left of the copied block in the UNDERLYING order (A1 positions), for reference shifting. */
  origin: { r: number; c: number };
  cut: boolean;
  /** Column types of the source block, so a paste into a different column type re-reads the text. */
  types: string[];
  cells: ClipCell[][];
  /** Data-validation rules covering parts of the block, as block-relative rectangles. */
  validations?: ClipValidation[];
  /** Paste special › Column widths only. */
  widths?: number[];
  /** Conditional-format rules covering parts of the block (Paste special › Conditional formatting only). */
  condFormats?: ClipValidation[];
};
export type ClipValidation = { rule: Record<string, unknown>; r1: number; r2: number; c1: number; c2: number };
/** A block ready to paste. `formulaR1C1` comes from foreign clipboards that carry one. */
export type PasteCell = { text: string; raw?: unknown; formula?: string; formulaR1C1?: string; style?: Record<string, unknown> | null };
export type PasteBlock = {
  cells: PasteCell[][]; origin?: { r: number; c: number }; cut?: boolean; types?: string[]; internal: boolean;
  validations?: ClipValidation[]; widths?: number[]; condFormats?: ClipValidation[];
};

/**
 * The last thing this tab copied. The async Clipboard API (used by the right-click menu) can't carry
 * a custom type, so a paste whose plain text matches this falls back to it.
 */
let lastCopy: { text: string; payload: ClipPayload } | null = null;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildClipboard(
  cells: ClipCell[][], origin: { r: number; c: number }, cut: boolean, types: string[], validations: ClipValidation[] = [],
  extra: { widths?: number[]; condFormats?: ClipValidation[] } = {},
) {
  const text = toTsv(cells.map((row) => row.map((c) => c.text)));
  const html =
    `<meta charset="utf-8"><table data-nexus-sheet="1" style="border-collapse:collapse"><tbody>` +
    cells.map((row) => `<tr>${row.map((c) =>
      `<td style="border:1px solid #ccc;padding:2px 3px;vertical-align:bottom">${escapeHtml(c.text).replace(/\n/g, "<br>")}</td>`,
    ).join("")}</tr>`).join("") +
    `</tbody></table>`;
  const payload: ClipPayload = {
    v: 1, origin, cut, types, cells, ...(validations.length ? { validations } : {}),
    ...(extra.widths ? { widths: extra.widths } : {}), ...(extra.condFormats?.length ? { condFormats: extra.condFormats } : {}),
  };
  lastCopy = { text, payload };
  return { text, html, json: JSON.stringify(payload) };
}

/** Write a block from a copy/cut EVENT (synchronous, all three types). */
export function writeClipboardEvent(e: ClipboardEvent | React.ClipboardEvent, clip: ReturnType<typeof buildClipboard>) {
  const dt = (e as ClipboardEvent).clipboardData;
  if (!dt) return;
  dt.setData("text/plain", clip.text);
  dt.setData("text/html", clip.html);
  try { dt.setData(NEXUS_MIME, clip.json); } catch { /* some browsers refuse custom types */ }
}

/** Write a block from a menu click (async API: text + html; our JSON rides on `lastCopy`). */
export async function writeClipboardAsync(clip: ReturnType<typeof buildClipboard>): Promise<void> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([clip.text], { type: "text/plain" }),
        "text/html": new Blob([clip.html], { type: "text/html" }),
      })]);
      return;
    }
  } catch { /* fall through to text */ }
  await navigator.clipboard.writeText(clip.text);
}

function fromPayload(json: string): PasteBlock | null {
  try {
    const p = JSON.parse(json) as ClipPayload;
    if (p?.v !== 1 || !Array.isArray(p.cells)) return null;
    return { cells: p.cells, origin: p.origin, cut: p.cut, types: p.types, internal: true, validations: p.validations, widths: p.widths, condFormats: p.condFormats };
  } catch {
    return null;
  }
}

/** Text of a table cell as a person sees it: <br> and block breaks become newlines. */
function cellText(td: Element): string {
  const clone = td.cloneNode(true) as Element;
  clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  clone.querySelectorAll("p,div").forEach((el) => { if (el.nextSibling) el.append("\n"); });
  return (clone.textContent ?? "").replace(/ /g, " ").replace(/\n+$/, "");
}

/**
 * An HTML table to a grid, expanding colspan/rowspan (the merged area gets the value in its first
 * cell, blanks elsewhere — what Sheets does). If the table carries Sheets' per-cell attributes
 * (older Sheets versions did: data-sheets-formula in R1C1), the formula is kept.
 */
export function parseHtmlTable(html: string): PasteCell[][] | null {
  if (!/<table/i.test(html) || typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return null;
  const grid: PasteCell[][] = [];
  const taken: boolean[][] = [];
  Array.from(table.querySelectorAll("tr")).forEach((tr, r) => {
    grid[r] ??= [];
    taken[r] ??= [];
    let c = 0;
    Array.from(tr.children).forEach((td) => {
      if (!/^(TD|TH)$/.test(td.tagName)) return;
      while (taken[r][c]) c += 1;
      const colspan = Math.max(1, Math.min(50, Number(td.getAttribute("colspan")) || 1));
      const rowspan = Math.max(1, Math.min(500, Number(td.getAttribute("rowspan")) || 1));
      const cell: PasteCell = { text: cellText(td) };
      const f = td.getAttribute("data-sheets-formula");
      if (f && f.startsWith("=")) cell.formulaR1C1 = f;
      for (let dr = 0; dr < rowspan; dr += 1) {
        grid[r + dr] ??= [];
        taken[r + dr] ??= [];
        for (let dc = 0; dc < colspan; dc += 1) {
          grid[r + dr][c + dc] = dr === 0 && dc === 0 ? cell : { text: "" };
          taken[r + dr][c + dc] = true;
        }
      }
      c += colspan;
    });
  });
  const width = Math.max(0, ...grid.map((row) => row.length));
  const out = grid.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? { text: "" }));
  while (out.length && out[out.length - 1].every((c) => c.text === "")) out.pop();
  return out.length ? out : null;
}

/** What a paste event (or a clipboard read) carries, best source first. */
export function readClipboard(data: { getData: (type: string) => string }): PasteBlock | null {
  const json = safeGet(data, NEXUS_MIME);
  if (json) { const p = fromPayload(json); if (p) return p; }
  const text = safeGet(data, "text/plain");
  if (text && lastCopy && text === lastCopy.text) {
    const p = lastCopy.payload;
    return { cells: p.cells, origin: p.origin, cut: p.cut, types: p.types, internal: true, validations: p.validations, widths: p.widths, condFormats: p.condFormats };
  }
  const html = safeGet(data, "text/html");
  if (html && !/data-nexus-sheet/.test(html)) {
    const grid = parseHtmlTable(html);
    if (grid) return { cells: grid, internal: false };
  }
  if (!text) return null;
  const rows = parseTsv(text);
  return rows.length ? { cells: rows.map((r) => r.map((t) => ({ text: t }))), internal: false } : null;
}

function safeGet(data: { getData: (type: string) => string }, type: string): string {
  try { return data.getData(type) ?? ""; } catch { return ""; }
}

/** Plain text from the async API (menu "Paste"), through the same reader. */
export async function readClipboardAsync(): Promise<PasteBlock | null> {
  const text = await navigator.clipboard.readText();
  return readClipboard({ getData: (t) => (t === "text/plain" ? text : "") });
}

/** A foreign R1C1 formula placed at (row, col), 0-based, as A1. */
export const foreignFormulaAt = (f: string, row: number, col: number) => r1c1ToA1(f, row, col);

/** Forget a cut once it has been pasted (a cut pastes once; later pastes are copies). */
export function consumeCut() {
  if (lastCopy?.payload.cut) lastCopy = { ...lastCopy, payload: { ...lastCopy.payload, cut: false } };
}
