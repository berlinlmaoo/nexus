import prisma from "@/lib/prisma"
import type { Prisma, User } from "@/generated/prisma/client"
import { checkProjectAccess } from "@/lib/rbac"
import {
  MAX_COLUMNS, MAX_CELLS_PER_WRITE, coerceCellValue, protectedCellsBlock, readCells, readColumns, readSheetSettings, readStyles,
  resolveSheetAccess, type SheetColumn,
} from "@/lib/project-sheets"
import {
  colLetter, computeSheet, detectInput, isFormulaCell, letterToIndex, parseDateText, parseLocaleNumber, serialToIso,
  toDisplay, toStored, type ComputedCell, type SheetShape,
} from "@/lib/sheet-formula"
import { clip, limitOf, num, str, PUBLIC_BASE } from "./util"
import { webError, type ExtraTool, type Input } from "./types"

/**
 * Project spreadsheets for GIDEON (owner, 18 Oct 2026): read them, search them, edit cells / add rows, and make a new
 * one from a table. Access is the Sheets page's own: resolveSheetAccess (VIEWER to read, MEMBER = Can edit to write),
 * protected ranges via protectedCellsBlock. Values are the grid's: formulas evaluated by the same engine the web,
 * the phones and the .xlsx export use (lib/sheet-formula.ts computeSheet), "1.5" typed into a text column is a number
 * (detectInput, Google-Sheets behaviour), "=…" is a formula stored with its references bound to column / row ids.
 *
 * Writes are cards, applied through the person's own session on the Sheets endpoints:
 *   PATCH /api/sheets/:id/cells (one atomic jsonb merge per row; the cell-history trigger writes SheetCellRevision,
 *   so the change shows in the cell's history with the person as author, and the realtime `sheet-cells` event
 *   reaches every open grid), POST /api/sheets/:id/rows for new rows, POST /api/projects/:id/sheets + PATCH
 *   /api/sheets/:id for a new sheet.
 * Race safety: every touched cell's stored value is kept on the card; Apply re-reads those cells first and refuses
 * the whole edit, naming the cells, if any of them changed meanwhile ("someone edited B5 since") — nothing is
 * written over a value the person never saw.
 */

const ROW_PAGE = 30
const ROW_PAGE_MAX = 200
const EDIT_MAX_CELLS = 500
const NEW_ROWS_MAX = 200

type Raw = Record<string, unknown>
type LoadedSheet = {
  id: string
  projectId: string
  projectName: string
  name: string
  columns: SheetColumn[]
  settings: ReturnType<typeof readSheetSettings>
  structureVersion: number
  rows: { id: string; cells: Raw; styles: Record<string, { nf?: string; dp?: number; pt?: string }> | null }[]
}

const sheetLink = (projectId: string) => `${PUBLIC_BASE}/projects/${projectId}?v=sheet`

/** Projects this person may see, as a prefilter (the per-sheet check is resolveSheetAccess). */
function visibleProjects(actorId: string): Prisma.ProjectWhereInput {
  return {
    OR: [
      { members: { some: { userId: actorId } } },
      { workspace: { members: { some: { userId: actorId, role: { in: ["ONE_ABOVE_ALL", "BOD"] } } } } },
    ],
  }
}

/** The sheet the model means: sheetId, or a sheet name and/or a project name. Never one the person cannot open. */
async function resolveSheetId(actor: User, input: Input): Promise<string> {
  const id = str(input.sheetId)
  if (id) return id
  const name = str(input.sheet) ?? str(input.name)
  const project = str(input.project) ?? str(input.projectName)
  const projectId = str(input.projectId)
  if (!name && !project && !projectId) throw new Error("Say which spreadsheet: sheetId (from nexus_search_sheets), or `sheet` (its tab name) and/or `project`.")
  const rows = await prisma.projectSheet.findMany({
    where: {
      ...(name ? { name: { contains: name, mode: "insensitive" } } : {}),
      project: {
        ...visibleProjects(actor.id),
        ...(projectId ? { id: projectId } : project ? { name: { contains: project, mode: "insensitive" } } : {}),
      },
    },
    select: { id: true, name: true, projectId: true, project: { select: { name: true } } },
    orderBy: [{ project: { updatedAt: "desc" } }, { position: "asc" }],
    take: 12,
  })
  const ok: typeof rows = []
  for (const r of rows) if ((await checkProjectAccess(actor.id, r.projectId, ["VIEWER"])).allowed) ok.push(r)
  const exact = name ? ok.filter((r) => r.name.toLowerCase() === name.toLowerCase()) : ok
  const pick = exact.length ? exact : ok
  if (pick.length === 1) return pick[0].id
  if (!pick.length) throw new Error(`No spreadsheet this person can open matches ${[name && `"${name}"`, project && `in "${project}"`].filter(Boolean).join(" ")}.`)
  const sameProject = new Set(pick.map((r) => r.projectId)).size === 1
  if (sameProject && !name) return pick[0].id // a project's first tab when only the project was named
  throw new Error(`Several spreadsheets match: ${pick.slice(0, 8).map((r) => `${r.name} (${r.project.name})`).join("; ")}. Ask which one, or pass sheetId.`)
}

async function loadSheet(actor: User, input: Input, level: "VIEWER" | "MEMBER"): Promise<LoadedSheet> {
  const sheetId = await resolveSheetId(actor, input)
  const access = await resolveSheetAccess(actor.id, sheetId, [level])
  if (!access.allowed) {
    throw new Error(access.status === 404 ? "That spreadsheet does not exist." : level === "MEMBER" ? "This person can view this spreadsheet but not edit it (editing needs Can edit in its project). Tell them so." : "This person has no access to that spreadsheet.")
  }
  const [rows, project] = await Promise.all([
    prisma.sheetRow.findMany({ where: { sheetId }, orderBy: { position: "asc" }, select: { id: true, cells: true, styles: true } }),
    prisma.project.findUnique({ where: { id: access.sheet.projectId }, select: { name: true } }),
  ])
  return {
    ...access.sheet,
    projectName: project?.name ?? "",
    rows: rows.map((r) => ({ id: r.id, cells: readCells(r.cells) as Raw, styles: r.styles ? (readStyles(r.styles) as LoadedSheet["rows"][number]["styles"]) : null })),
  }
}

const shapeOf = (s: LoadedSheet): SheetShape => ({ columnIds: s.columns.map((c) => c.id), rowIds: s.rows.map((r) => r.id) })
const isEmpty = (v: unknown) => v === undefined || v === null || v === ""

function computed(s: LoadedSheet) {
  return computeSheet(s.columns, s.rows, { locale: "id-ID", names: s.settings.namedRanges })
}

/** "B" + name, as the grid's header shows it ("B · Nominal"); an unnamed column is just its letter. */
function header(c: SheetColumn, i: number): string {
  const letter = colLetter(i)
  return c.name ? `${letter} · ${c.name}` : letter
}

// ── Read ──────────────────────────────────────────────────────────────────────────────────────────────

async function getSheet(actor: User, input: Input) {
  const s = await loadSheet(actor, input, "VIEWER")
  const comp = computed(s)
  // The used range: rows and columns that hold anything (a blank 10 × 50 grid is mostly air).
  const usedRows = s.rows.map((r, i) => ({ r, i })).filter(({ r }) => Object.values(r.cells).some((v) => !isEmpty(v)))
  const usedCols = s.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.name || s.rows.some((r) => !isEmpty(r.cells[c.id])))
  const want = str(input.columns) ? new Set(String(input.columns).split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)) : null
  const cols = want ? usedCols.filter(({ c, i }) => want.has(colLetter(i).toLowerCase()) || want.has(c.name.toLowerCase())) : usedCols
  const limit = Math.max(1, Math.min(ROW_PAGE_MAX, Math.floor(num(input.limit) ?? ROW_PAGE)))
  const offset = Math.max(0, Math.floor(num(input.offset) ?? 0))
  const q = str(input.query)?.toLowerCase()
  const matching = q
    ? usedRows.filter(({ r }) => cols.some(({ c }) => (comp[r.id]?.[c.id]?.d ?? "").toLowerCase().includes(q)))
    : usedRows
  const pageRows = matching.slice(offset, offset + limit)
  const showFormulas = input.formulas === true || input.formulas === "true"
  const rows = pageRows.map(({ r, i }) => {
    const line: Record<string, unknown> = { row: i + 1 }
    for (const { c, i: ci } of cols) {
      const cell: ComputedCell | undefined = comp[r.id]?.[c.id]
      if (!cell) continue
      const raw = r.cells[c.id]
      line[colLetter(ci)] = showFormulas && isFormulaCell(raw) ? `${cell.d}  [${toDisplay(raw.f, shapeOf(s), "en")}]` : clip(cell.d, 200)
    }
    return line
  })
  // Totals over EVERY used row of the column (not just this page): the numbers a "berapa totalnya" needs.
  const totals: Record<string, unknown> = {}
  for (const { c, i } of cols) {
    let sum = 0, n = 0, texts = 0
    for (const { r } of usedRows) {
      const v = comp[r.id]?.[c.id]?.v
      if (typeof v === "number" && Number.isFinite(v) && comp[r.id]?.[c.id]?.nf !== "date") { sum += v; n++ } else if (!isEmpty(v)) texts++
    }
    if (n >= 2 && n >= texts) totals[colLetter(i)] = { sum: Math.round(sum * 100) / 100, count: n, avg: Math.round((sum / n) * 100) / 100 }
  }
  const rest = matching.length - offset - pageRows.length
  return {
    sheet: s.name,
    sheetId: s.id,
    project: s.projectName,
    link: sheetLink(s.projectId),
    columns: cols.map(({ c, i }) => header(c, i) + (c.type !== "text" ? ` (${c.type})` : "")),
    usedRows: usedRows.length,
    ...(q ? { matchingRows: matching.length } : {}),
    rows,
    ...(Object.keys(totals).length ? { totals, totalsNote: "sum / count / avg of the numbers in each column over all used rows (header-like text rows ignored); a total row in the sheet itself is included in the sum — check before adding it again." } : {}),
    ...(rest > 0 ? { more: `${rest} more rows — call again with offset=${offset + pageRows.length} (limit up to ${ROW_PAGE_MAX}), or query=… to find rows.` } : {}),
    note: "Values are what the grid shows (formulas computed). `row` is the sheet's row number (A1 style), for edits. Cite the sheet by name.",
  }
}

async function searchSheets(actor: User, input: Input) {
  const q = str(input.query)
  const project = str(input.project)
  const projectFilter: Prisma.ProjectWhereInput = { ...visibleProjects(actor.id), ...(project ? { name: { contains: project, mode: "insensitive" } } : {}) }
  const byName = await prisma.projectSheet.findMany({
    where: { project: projectFilter, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { project: { name: { contains: q, mode: "insensitive" } } }] } : {}) },
    select: { id: true, name: true, projectId: true, columns: true, project: { select: { name: true } }, _count: { select: { rows: true } } },
    orderBy: { updatedAt: "desc" },
    take: 40,
  })
  // Cells that contain the words (the jsonb as text: cheap, and only on sheets the prefilter allows).
  const byCell = q
    ? await prisma.$queryRaw<{ sheetId: string; rowId: string; cells: unknown }[]>`
        SELECT r."sheetId", r."id" AS "rowId", r."cells" FROM "SheetRow" r
        JOIN "ProjectSheet" s ON s."id" = r."sheetId"
        WHERE r."cells"::text ILIKE ${`%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`}
          AND s."projectId" IN (SELECT p."id" FROM "Project" p
            WHERE EXISTS (SELECT 1 FROM "ProjectMember" m WHERE m."projectId" = p."id" AND m."userId" = ${actor.id})
               OR EXISTS (SELECT 1 FROM "WorkspaceMember" w WHERE w."workspaceId" = p."workspaceId" AND w."userId" = ${actor.id} AND w."role" IN ('ONE_ABOVE_ALL', 'BOD')))
        LIMIT 60`
    : []
  const cellSheetIds = [...new Set(byCell.map((h) => h.sheetId))].filter((id) => !byName.some((s) => s.id === id))
  const extra = cellSheetIds.length
    ? await prisma.projectSheet.findMany({ where: { id: { in: cellSheetIds } }, select: { id: true, name: true, projectId: true, columns: true, project: { select: { name: true } }, _count: { select: { rows: true } } } })
    : []
  const items = []
  const limit = limitOf(input, 12, 30)
  for (const s of [...byName, ...extra]) {
    if (items.length >= limit) break
    if (!(await checkProjectAccess(actor.id, s.projectId, ["VIEWER"])).allowed) continue
    const columns = readColumns(s.columns)
    const hits = byCell.filter((h) => h.sheetId === s.id).slice(0, 3).map((h) => {
      const cells = readCells(h.cells) as Raw
      const hit = Object.entries(cells).find(([, v]) => JSON.stringify(v).toLowerCase().includes((q ?? "").toLowerCase()))
      const ci = hit ? columns.findIndex((c) => c.id === hit[0]) : -1
      return hit ? `${ci >= 0 ? header(columns[ci], ci) : "?"}: ${clip(typeof hit[1] === "string" ? hit[1] : JSON.stringify(hit[1]), 80)}` : null
    }).filter(Boolean)
    items.push({
      sheetId: s.id,
      sheet: s.name,
      project: s.project.name,
      columns: columns.filter((c) => c.name).map((c) => c.name).slice(0, 12),
      rows: s._count.rows,
      ...(hits.length ? { found: hits } : {}),
    })
  }
  return { total: items.length, items, note: items.length ? "Read one with nexus_get_sheet (sheetId)." : "No spreadsheet this person can open matches. Say so." }
}

// ── Values as the grid stores them ────────────────────────────────────────────────────────────────────

/**
 * What typing `text` into a cell of this column stores — the web grid's inputToCell (apps/web sheet-types.ts),
 * server side: "=…" is a formula with references bound to ids, numbers / Rupiah / percent / dates are detected in
 * text columns the way Google Sheets does ("1.5" is a number; "0812…" and 16+ digit ids stay text).
 */
function inputToCell(col: SheetColumn, value: unknown, shape: SheetShape): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === "number" || typeof value === "boolean") return coerceCellValue(col.type, value)
  const text = String(value)
  const trimmed = text.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("=") && trimmed.length > 1 && col.type !== "checkbox") return { f: toStored(trimmed, shape) }
  switch (col.type) {
    case "checkbox": return ["true", "1", "ya", "yes", "y", "✓", "x"].includes(trimmed.toLowerCase())
    case "link": case "multiselect": case "select": case "task": return coerceCellValue(col.type, trimmed)
    case "number":
    case "currency": {
      const d = detectInput(trimmed)
      if (d.kind === "number") return d.nf === "pct" || d.nf === "date" ? { v: d.v, nf: d.nf } : d.v
      const plain = parseLocaleNumber(trimmed)
      return plain ? plain.n : text
    }
    case "date": {
      const serial = parseDateText(trimmed)
      return serial === null ? text : serialToIso(serial)
    }
    default: {
      const d = detectInput(text)
      if (d.kind === "number") return d.nf ? { v: d.v, nf: d.nf } : d.v
      return text.slice(0, 5000)
    }
  }
}

const sameCell = (a: unknown, b: unknown) => {
  const norm = (v: unknown) => (v === undefined || v === "" ? null : v)
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}

function shown(raw: unknown, comp: ComputedCell | undefined, shape: SheetShape): string {
  if (isEmpty(raw)) return "(empty)"
  if (isFormulaCell(raw)) return `${toDisplay(raw.f, shape, "en")}${comp ? ` = ${comp.d}` : ""}`
  return clip(comp?.d ?? (typeof raw === "string" ? raw : JSON.stringify(raw)), 80) ?? ""
}

function afterText(value: unknown, stored?: unknown): string {
  if (value === null || value === undefined || value === "") return "(empty)"
  // A plain number is shown the way the grid shows the old value ("2,5" → "1,5", not "1.5"; QA final 19 Oct, E-5).
  if (typeof stored === "number" && Number.isFinite(stored)) return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 10, useGrouping: false }).format(stored)
  return clip(String(value), 80) ?? ""
}

/** "B5" → [colIndex, rowIndex] (0-based), or null. */
function parseRef(ref: string): [number, number] | null {
  const m = /^\s*\$?([A-Za-z]{1,3})\$?(\d{1,6})\s*$/.exec(ref)
  if (!m) return null
  return [letterToIndex(m[1].toUpperCase()), Number(m[2]) - 1]
}

/** A column by letter ("C") or by its header name. */
function columnIndex(s: LoadedSheet, key: string): number {
  const k = key.trim()
  if (/^[A-Za-z]{1,3}$/.test(k)) {
    const i = letterToIndex(k.toUpperCase())
    if (i >= 0 && i < s.columns.length) return i
  }
  const i = s.columns.findIndex((c) => c.name.toLowerCase() === k.toLowerCase())
  if (i >= 0) return i
  throw new Error(`No column "${key}" in ${s.name} (columns: ${s.columns.map((c, j) => header(c, j)).slice(0, 15).join(", ")}).`)
}

// ── Edit ──────────────────────────────────────────────────────────────────────────────────────────────

type Change = { rowId: string; colId: string; ref: string; before: unknown; after: unknown; beforeText: string; afterText: string }

async function describeEdit(actor: User, input: Input) {
  const s = await loadSheet(actor, input, "MEMBER")
  const shape = shapeOf(s)
  const comp = computed(s)
  const byCell = new Map<string, Change>()
  const put = (ci: number, ri: number, value: unknown) => {
    const col = s.columns[ci]
    const row = s.rows[ri]
    if (!col) throw new Error(`Column ${colLetter(ci)} does not exist in ${s.name} (it has ${s.columns.length}).`)
    if (!row) throw new Error(`Row ${ri + 1} does not exist in ${s.name} (it has ${s.rows.length}); use addRows for new rows.`)
    const after = inputToCell(col, value, shape)
    const before = row.cells[col.id]
    const ref = `${colLetter(ci)}${ri + 1}`
    if (sameCell(before, after)) { byCell.delete(ref); return }
    byCell.set(ref, { rowId: row.id, colId: col.id, ref, before: before ?? null, after, beforeText: shown(before, comp[row.id]?.[col.id], shape), afterText: afterText(value, after) })
  }

  // 1) Single cells: [{ cell: "B5", value }]
  for (const e of Array.isArray(input.edits) ? (input.edits as Raw[]) : []) {
    const at = parseRef(String(e?.cell ?? e?.ref ?? ""))
    if (!at) throw new Error(`"${String(e?.cell ?? "")}" is not a cell like B5.`)
    put(at[0], at[1], e.value ?? null)
  }
  // 2) Fill a column over a row range: { column: "C" | name, fromRow, toRow, value } — a value with {r} gets the row
  //    number ("=A{r}*B{r}"), so one formula fills down like the fill handle.
  const fill = input.fill && typeof input.fill === "object" ? (input.fill as Raw) : null
  if (fill) {
    const ci = columnIndex(s, String(fill.column ?? ""))
    const from = Math.floor(num(fill.fromRow) ?? 0), to = Math.floor(num(fill.toRow) ?? 0)
    if (from < 1 || to < from) throw new Error("fill needs fromRow ≤ toRow (sheet row numbers, from 1).")
    if (to - from + 1 > EDIT_MAX_CELLS) throw new Error(`At most ${EDIT_MAX_CELLS} cells in one card.`)
    const values = Array.isArray(fill.values) ? (fill.values as unknown[]) : null
    for (let r = from; r <= to; r++) {
      const v = values ? values[r - from] : fill.value
      put(ci, r - 1, typeof v === "string" ? v.replace(/\{r\}/g, String(r)) : v ?? null)
    }
  }
  // 3) New rows at the end of the used range: [{ "A": …, "Nominal": … }] or [[a, b, c]]
  const addRows: Raw[] = []
  const newRowsPreview: string[] = []
  const rawAdd = Array.isArray(input.addRows) ? (input.addRows as unknown[]) : []
  if (rawAdd.length > NEW_ROWS_MAX) throw new Error(`At most ${NEW_ROWS_MAX} new rows in one card.`)
  for (const r of rawAdd) {
    const cells: Raw = {}
    const parts: string[] = []
    const entries: [number, unknown][] = Array.isArray(r) ? r.map((v, i) => [i, v] as [number, unknown]) : Object.entries((r ?? {}) as Raw).map(([k, v]) => [columnIndex(s, k), v] as [number, unknown])
    for (const [ci, v] of entries) {
      const col = s.columns[ci]
      if (!col) throw new Error(`Column ${colLetter(ci)} does not exist in ${s.name}.`)
      const stored = inputToCell(col, v, shape)
      if (stored === null) continue
      cells[col.id] = stored
      parts.push(`${colLetter(ci)}: ${afterText(v)}`)
    }
    if (Object.keys(cells).length) { addRows.push(cells); newRowsPreview.push(parts.join(" · ")) }
  }
  const changes = [...byCell.values()]
  if (!changes.length && !addRows.length) throw new Error("Nothing would change in the sheet (the cells already hold those values).")
  if (changes.length > EDIT_MAX_CELLS || changes.length > MAX_CELLS_PER_WRITE) throw new Error(`At most ${EDIT_MAX_CELLS} cells in one card; split the edit.`)
  // Protected ranges (Data › Protect): refused now, and by the endpoint again on Apply.
  const blocked = await protectedCellsBlock(actor.id, s, changes.map((c) => ({ rowId: c.rowId, colId: c.colId })))
  if (blocked) throw new Error(`${blocked} Tell the person; nothing was proposed.`)

  const lastUsed = [...s.rows].reverse().find((r) => Object.values(r.cells).some((v) => !isEmpty(v)))
  const diff = changes.slice(0, 40).map((c) => ({ field: c.ref, from: c.beforeText, to: c.afterText }))
  if (changes.length > 40) diff.push({ field: "…", from: "", to: `${changes.length - 40} more cells (listed below)` })
  if (addRows.length) diff.push({ field: "New rows", from: "", to: `${addRows.length} after row ${lastUsed ? s.rows.indexOf(lastUsed) + 1 : 0}` })
  const preview = [
    ...changes.map((c) => `${c.ref}: ${c.beforeText} → ${c.afterText}`),
    ...newRowsPreview.map((p, i) => `+ new row ${i + 1}: ${p}`),
  ].join("\n")
  return {
    summary: `Edit ${s.name} (${s.projectName}): ${changes.length ? `${changes.length} cell${changes.length === 1 ? "" : "s"}` : ""}${changes.length && addRows.length ? " + " : ""}${addRows.length ? `${addRows.length} new row${addRows.length === 1 ? "" : "s"}` : ""}`.slice(0, 300),
    diff,
    projectId: s.projectId,
    store: {
      sheetId: s.id,
      sheetName: s.name,
      projectId: s.projectId,
      changes: changes.map(({ rowId, colId, ref, before, after }) => ({ rowId, colId, ref, before, after })),
      addRows,
      afterRowId: lastUsed?.id ?? null,
      sheetEdit: {
        sheet: s.name, project: s.projectName,
        cells: changes.slice(0, 200).map((c) => ({ ref: c.ref, from: c.beforeText, to: c.afterText })),
        newRows: newRowsPreview.slice(0, 50),
      },
    },
    preview,
    note: "NOT changed yet. The card below shows every cell before → after; nothing is written until the person taps Apply. If any of those cells is edited by someone meanwhile, Apply refuses and says which. Say so in one sentence.",
  }
}

async function applyEdit(input: Input, call: Parameters<NonNullable<ExtraTool["web"]>>[1]) {
  const sheetId = String(input.sheetId ?? "")
  const changes = (Array.isArray(input.changes) ? input.changes : []) as { rowId: string; colId: string; ref: string; before: unknown; after: unknown }[]
  const addRows = (Array.isArray(input.addRows) ? input.addRows : []) as Raw[]
  if (changes.length) {
    // Race check: the cells as they are NOW against what the card showed.
    const rows = await prisma.sheetRow.findMany({ where: { sheetId, id: { in: [...new Set(changes.map((c) => c.rowId))] } }, select: { id: true, cells: true } })
    const now = new Map(rows.map((r) => [r.id, readCells(r.cells) as Raw]))
    const moved = changes.filter((c) => !now.has(c.rowId) || !sameCell(now.get(c.rowId)?.[c.colId], c.before))
    if (moved.length) {
      return { ok: false, message: `Not applied: ${moved.slice(0, 8).map((c) => c.ref).join(", ")}${moved.length > 8 ? ` and ${moved.length - 8} more` : ""} changed (or the row was deleted) after this card was made. Nothing was changed — ask GIDEON again · Tidak diterapkan: sel itu berubah setelah kartu dibuat. Tidak ada yang diubah — minta GIDEON lagi.` }
    }
    const byRow = new Map<string, Raw>()
    for (const c of changes) byRow.set(c.rowId, { ...(byRow.get(c.rowId) ?? {}), [c.colId]: c.after })
    const r = await call({ method: "PATCH", path: `/api/sheets/${sheetId}/cells`, json: { edits: [...byRow].map(([rowId, values]) => ({ rowId, values })) } })
    if (!r.ok) return { ok: false, message: webError(r, "Couldn't save the cells") }
  }
  if (addRows.length) {
    const r = await call({ method: "POST", path: `/api/sheets/${sheetId}/rows`, json: { rows: addRows, ...(input.afterRowId ? { afterRowId: input.afterRowId } : {}) } })
    if (!r.ok) return { ok: false, message: `${changes.length ? "The cells were saved, but the new rows were not: " : ""}${webError(r, "Couldn't add the rows")}` }
  }
  return { ok: true, link: `/projects/${String(input.projectId ?? "")}?v=sheet`, result: { sheetId, cells: changes.length, rows: addRows.length } }
}

// ── Create ────────────────────────────────────────────────────────────────────────────────────────────

async function resolveEditableProject(actor: User, input: Input): Promise<{ id: string; name: string }> {
  const id = str(input.projectId)
  const name = str(input.project) ?? str(input.projectName)
  if (!id && !name) throw new Error("Say which project the spreadsheet goes in (project name).")
  const rows = await prisma.project.findMany({
    where: { ...visibleProjects(actor.id), ...(id ? { id } : { name: { contains: name!, mode: "insensitive" } }) },
    select: { id: true, name: true },
    orderBy: { updatedAt: "desc" },
    take: 8,
  })
  const exact = name ? rows.filter((r) => r.name.toLowerCase() === name.toLowerCase()) : rows
  const pick = exact.length ? exact : rows
  if (!pick.length) throw new Error(`No project this person can see is named like "${name ?? id}".`)
  if (pick.length > 1) throw new Error(`Several projects match: ${pick.map((p) => p.name).join(", ")}. Ask which one.`)
  if (!(await checkProjectAccess(actor.id, pick[0].id, ["MEMBER"])).allowed) throw new Error(`This person cannot add a spreadsheet to ${pick[0].name} (it needs Can edit there). Tell them so.`)
  return pick[0]
}

async function describeCreate(actor: User, input: Input) {
  const project = await resolveEditableProject(actor, input)
  const name = (str(input.name) ?? str(input.title) ?? "").slice(0, 80)
  if (!name) throw new Error("name is required (the new tab's name).")
  const columns = (Array.isArray(input.columns) ? input.columns : []).map((c) => String(c ?? "").trim().slice(0, 80))
  if (!columns.length) throw new Error("columns is required: the header names, in order.")
  if (columns.length > MAX_COLUMNS) throw new Error(`At most ${MAX_COLUMNS} columns.`)
  const rows = (Array.isArray(input.rows) ? input.rows : []) as unknown[][]
  if (rows.length > 500) throw new Error("At most 500 rows in one card.")
  const clean = rows.map((r) => (Array.isArray(r) ? r : []).slice(0, columns.length).map((v) => (v === null || v === undefined ? "" : typeof v === "number" || typeof v === "boolean" ? v : String(v).slice(0, 5000))))
  const table = [columns.join(" | "), columns.map(() => "---").join(" | "), ...clean.slice(0, 60).map((r) => r.map((v) => String(v)).join(" | "))].join("\n") + (clean.length > 60 ? `\n… ${clean.length - 60} more rows` : "")
  return {
    summary: `New spreadsheet “${name}” in ${project.name}: ${columns.length} columns × ${clean.length} rows`.slice(0, 300),
    diff: [
      { field: "Project", to: project.name },
      { field: "Title", to: name },
      { field: "Columns", to: columns.join(", ").slice(0, 300) },
      { field: "Rows", to: String(clean.length) },
    ],
    projectId: project.id,
    store: { projectId: project.id, projectName: project.name, name, columns, rows: clean },
    preview: table,
    note: "NOT created yet. The card below shows the table; it becomes a new tab in the project's Spreadsheet when the person taps Create. Say so in one sentence.",
  }
}

async function applyCreate(input: Input, call: Parameters<NonNullable<ExtraTool["web"]>>[1]) {
  const projectId = String(input.projectId ?? "")
  const headers = (Array.isArray(input.columns) ? input.columns : []).map(String)
  const rows = (Array.isArray(input.rows) ? input.rows : []) as unknown[][]
  // 1) The tab, exactly like "Add sheet" (a blank 10 × 50 grid).
  const created = await call({ method: "POST", path: `/api/projects/${projectId}/sheets`, json: { name: String(input.name ?? "") } })
  const sheetId = created.body?.id as string | undefined
  if (!created.ok || !sheetId) return { ok: false, message: webError(created, "Couldn't create the sheet") }
  // 2) Header names (and more columns when the table is wider than 10): the structure PATCH with its version.
  const fresh = await prisma.projectSheet.findUnique({ where: { id: sheetId }, select: { columns: true, structureVersion: true } })
  const base = readColumns(fresh?.columns)
  const cols = headers.map((h, i) => (base[i] ? { ...base[i], name: h } : { name: h, type: "text", width: 140 }))
  for (let i = headers.length; i < base.length; i++) cols.push(base[i])
  const st = await call({ method: "PATCH", path: `/api/sheets/${sheetId}`, json: { columns: cols, structureVersion: fresh?.structureVersion ?? 0 } })
  if (!st.ok) return { ok: false, message: `The sheet was made but its headers were not set: ${webError(st, "Couldn't set the columns")}`, link: `/projects/${projectId}?v=sheet` }
  // 3) Enough rows, then the values through the cells endpoint (grid detection: numbers, Rupiah, dates, formulas).
  const after = await prisma.projectSheet.findUnique({ where: { id: sheetId }, select: { columns: true } })
  const columns = readColumns(after?.columns)
  let rowIds = (await prisma.sheetRow.findMany({ where: { sheetId }, orderBy: { position: "asc" }, select: { id: true } })).map((r) => r.id)
  if (rows.length > rowIds.length) {
    const add = await call({ method: "POST", path: `/api/sheets/${sheetId}/rows`, json: { count: rows.length - rowIds.length, ...(rowIds.length ? { afterRowId: rowIds[rowIds.length - 1] } : {}) } })
    if (!add.ok) return { ok: false, message: webError(add, "Couldn't add rows"), link: `/projects/${projectId}?v=sheet` }
    rowIds = (await prisma.sheetRow.findMany({ where: { sheetId }, orderBy: { position: "asc" }, select: { id: true } })).map((r) => r.id)
  }
  const shape: SheetShape = { columnIds: columns.map((c) => c.id), rowIds }
  const edits = rows.map((r, ri) => {
    const values: Raw = {}
    r.forEach((v, ci) => { const col = columns[ci]; if (col) { const c = inputToCell(col, v, shape); if (c !== null) values[col.id] = c } })
    return { rowId: rowIds[ri], values }
  }).filter((e) => Object.keys(e.values).length)
  for (let i = 0; i < edits.length; i += 400) {
    const r = await call({ method: "PATCH", path: `/api/sheets/${sheetId}/cells`, json: { edits: edits.slice(i, i + 400) } })
    if (!r.ok) return { ok: false, message: `The sheet was made but some values were not written: ${webError(r, "Couldn't write the values")}`, link: `/projects/${projectId}?v=sheet` }
  }
  return { ok: true, link: `/projects/${projectId}?v=sheet`, result: { sheetId } }
}

export const sheetTools: Record<string, ExtraTool> = {
  search_sheets: { read: searchSheets, stepArg: (i) => str(i.query) ?? str(i.project) ?? null },
  get_sheet: { read: getSheet, stepArg: (i) => str(i.sheet) ?? str(i.project) ?? null },
  edit_sheet_cells: {
    describe: describeEdit,
    web: (input, call) => applyEdit(input, call),
    stepArg: (i) => str(i.sheet) ?? str(i.project) ?? null,
  },
  create_sheet: {
    describe: describeCreate,
    web: (input, call) => applyCreate(input, call),
    stepArg: (i) => str(i.name) ?? str(i.title) ?? null,
  },
}
