/**
 * CSV escaping with the Excel/Sheets formula-injection guard (CWE-1236).
 *
 * Both apps strip CSV quoting and then EVALUATE any cell starting with `=`, `+`, `@`, a tab or `-`,
 * so a cell containing `=cmd|'/c calc'!A1` becomes code execution on whoever opens the export. A
 * leading apostrophe forces the cell to render as text.
 *
 * Lifted out of src/app/api/pnl/export/route.ts so the spreadsheet export shares one copy — this is
 * exactly the kind of guard that silently drifts when it gets retyped in a second file. The
 * spreadsheet export is the MORE exposed of the two, because every cell is free user input.
 *
 * Numeric values should bypass the prefix check (a real negative amount isn't an injection), which
 * is why the caller passes numbers as numbers rather than pre-stringifying them.
 */
export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return ""
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : ""
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE"
  let s = String(v)
  if (/^[=+@\t\r-]/.test(s)) s = `'${s}`
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Join rows into a CSV body. Prepends a UTF-8 BOM so Excel opens Indonesian text correctly. */
export function toCsv(rows: (string | number | boolean | null | undefined)[][], withBom = true): string {
  const body = rows.map((r) => r.map(csvCell).join(",")).join("\r\n")
  return withBom ? `﻿${body}` : body
}

/**
 * Parse a CSV body into rows of strings. Handles quoted fields containing commas/newlines/escaped
 * quotes, CRLF, a UTF-8 BOM, and semicolon delimiters (what Excel writes on an Indonesian locale).
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "")
  // Sniff the delimiter from the first line: whichever of , or ; appears more OUTSIDE quotes wins.
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ""
  let commas = 0
  let semis = 0
  let q = false
  for (const ch of firstLine) {
    if (ch === '"') q = !q
    else if (!q && ch === ",") commas += 1
    else if (!q && ch === ";") semis += 1
  }
  const delim = semis > commas ? ";" : ","

  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1 } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"' && cell === "") { quoted = true; continue }
    if (ch === delim) { row.push(cell); cell = ""; continue }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1
      row.push(cell); rows.push(row); row = []; cell = ""
      continue
    }
    cell += ch
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row) }
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === "")) rows.pop()
  return rows
}
