// Spreadsheet formula engine.
//
// ⚠️ MIRRORED FILE — keep in sync with src/lib/sheet-formula.ts in the Next.js backend.
// The SPA is a separate Vite package and can't import from src/lib, so this exists twice, the same
// way src/lib/gamification.ts is mirrored by the SPA's lib/levels.ts. The client evaluates for
// display; the server needs the identical result for CSV export.
//
// ── Two decisions that keep formulas from wrecking the data model ────────────────────────────────
//
// 1. STORED IN ID-SPACE, DISPLAYED IN A1-SPACE.
//    A cell never stores "=SUM(B2:B9)". It stores references to column ids and row ids. A1 letters
//    are a display layer computed from the CURRENT positions. So inserting a row, reordering or
//    deleting a column never requires rewriting a single formula — which is the #1 bug source in
//    every hand-rolled spreadsheet, designed out rather than patched later.
//
// 2. EVALUATED AT RENDER, NEVER CACHED.
//    A formula cell holds only { f: "..." }; the computed value is never written back. That keeps a
//    cell save as the single atomic `cells || $patch` UPDATE, with no recalculation chain on the
//    server and no two clients racing to store different cached results.

export type CellValue = string | number | boolean | null
export type FormulaCell = { f: string }

export const isFormulaCell = (v: unknown): v is FormulaCell =>
  Boolean(v) && typeof v === "object" && typeof (v as FormulaCell).f === "string"

/** A stored reference: one cell, or a whole column. Row ids make a reference follow its row. */
export type StoredRef =
  | { k: "cell"; col: string; row: string }
  | { k: "col"; col: string }
  | { k: "range"; col: string; from: string; to: string }

export const ERR = {
  ref: "#REF!",
  div: "#DIV/0!",
  cycle: "#CYCLE!",
  name: "#NAME?",
  value: "#VALUE!",
  na: "#N/A",
} as const
export type ErrorValue = (typeof ERR)[keyof typeof ERR]
export const isError = (v: unknown): v is ErrorValue =>
  typeof v === "string" && (Object.values(ERR) as string[]).includes(v)

// ── A1 <-> index ─────────────────────────────────────────────────────────────
export function colLetter(index: number): string {
  let n = index
  let out = ""
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return out
}
export function letterToIndex(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export type SheetShape = {
  /** Column ids in display order. */
  columnIds: string[]
  /** Row ids in display order. */
  rowIds: string[]
}

// ── Translation: what the user types <-> what we store ───────────────────────

const A1 = /(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g

/**
 * "=SUM(B2:B9)+A1" -> stored form with ids baked in.
 * Returns null when a reference points outside the sheet (the caller keeps the raw text).
 */
export function toStored(display: string, shape: SheetShape): string {
  return display.replace(A1, (whole, _d1, letters: string, _d2, rowNum: string) => {
    const ci = letterToIndex(letters)
    const ri = Number(rowNum) - 1
    const col = shape.columnIds[ci]
    const row = shape.rowIds[ri]
    // Out of range now = out of range forever; leave it so it evaluates to #REF! rather than
    // silently binding to whatever later occupies that slot.
    if (!col || !row) return whole
    return `{${col}!${row}}`
  })
}

const STORED = /\{([^!}]+)!([^}]+)\}/g

/** Stored form -> what the formula bar shows, using each id's CURRENT position. */
export function toDisplay(stored: string, shape: SheetShape): string {
  const colIdx = new Map(shape.columnIds.map((id, i) => [id, i]))
  const rowIdx = new Map(shape.rowIds.map((id, i) => [id, i]))
  return stored.replace(STORED, (_whole, col: string, row: string) => {
    const ci = colIdx.get(col)
    const ri = rowIdx.get(row)
    // The column or row it pointed at is gone — that IS a #REF!, and showing it is the honest thing.
    if (ci === undefined || ri === undefined) return ERR.ref
    return `${colLetter(ci)}${ri + 1}`
  })
}

// ── Tokenizer ────────────────────────────────────────────────────────────────
type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ref"; col: string; row: string }
  | { t: "op"; v: string }
  | { t: "fn"; v: string }
  | { t: "lp" } | { t: "rp" } | { t: "comma" } | { t: "colon" }

function tokenize(src: string): Tok[] | ErrorValue {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === " " || ch === "\t") { i += 1; continue }
    if (ch === "{") {
      const end = src.indexOf("}", i)
      if (end < 0) return ERR.value
      const inner = src.slice(i + 1, end)
      const bang = inner.indexOf("!")
      if (bang < 0) return ERR.value
      out.push({ t: "ref", col: inner.slice(0, bang), row: inner.slice(bang + 1) })
      i = end + 1
      continue
    }
    if (ch === '"') {
      let j = i + 1
      let s = ""
      while (j < src.length && src[j] !== '"') { s += src[j]; j += 1 }
      if (j >= src.length) return ERR.value
      out.push({ t: "str", v: s })
      i = j + 1
      continue
    }
    if (/[0-9.]/.test(ch)) {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j])) j += 1
      const n = Number(src.slice(i, j))
      if (!Number.isFinite(n)) return ERR.value
      out.push({ t: "num", v: n })
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j += 1
      out.push({ t: "fn", v: src.slice(i, j).toUpperCase() })
      i = j
      continue
    }
    if (ch === "(") { out.push({ t: "lp" }); i += 1; continue }
    if (ch === ")") { out.push({ t: "rp" }); i += 1; continue }
    if (ch === ",") { out.push({ t: "comma" }); i += 1; continue }
    if (ch === ":") { out.push({ t: "colon" }); i += 1; continue }
    if (src.startsWith(">=", i) || src.startsWith("<=", i) || src.startsWith("<>", i)) {
      out.push({ t: "op", v: src.slice(i, i + 2) }); i += 2; continue
    }
    if ("+-*/^%<>=&".includes(ch)) { out.push({ t: "op", v: ch }); i += 1; continue }
    return ERR.value
  }
  return out
}

// ── Parser (precedence climbing) ─────────────────────────────────────────────
type Node =
  | { n: "num"; v: number }
  | { n: "str"; v: string }
  | { n: "ref"; col: string; row: string }
  | { n: "range"; a: { col: string; row: string }; b: { col: string; row: string } }
  | { n: "bin"; op: string; l: Node; r: Node }
  | { n: "neg"; e: Node }
  | { n: "call"; fn: string; args: Node[] }

const PREC: Record<string, number> = {
  "<": 1, ">": 1, "<=": 1, ">=": 1, "=": 1, "<>": 1,
  "&": 2,
  "+": 3, "-": 3,
  "*": 4, "/": 4,
  "^": 5,
}

function parse(toks: Tok[]): Node | ErrorValue {
  let p = 0
  const peek = () => toks[p]
  const eat = () => toks[p++]

  function primary(): Node | ErrorValue {
    const t = eat()
    if (!t) return ERR.value
    if (t.t === "num") return { n: "num", v: t.v }
    if (t.t === "str") return { n: "str", v: t.v }
    if (t.t === "op" && t.v === "-") {
      const e = primary()
      return isError(e) ? e : { n: "neg", e }
    }
    if (t.t === "ref") {
      // A range is written A2:A9 — after translation both ends are refs with a colon between.
      if (peek()?.t === "colon") {
        eat()
        const b = eat()
        if (!b || b.t !== "ref") return ERR.value
        return { n: "range", a: { col: t.col, row: t.row }, b: { col: b.col, row: b.row } }
      }
      return { n: "ref", col: t.col, row: t.row }
    }
    if (t.t === "lp") {
      const e = expr(0)
      if (isError(e)) return e
      if (eat()?.t !== "rp") return ERR.value
      return e
    }
    if (t.t === "fn") {
      if (peek()?.t !== "lp") return ERR.name
      eat()
      const args: Node[] = []
      if (peek()?.t === "rp") { eat(); return { n: "call", fn: t.v, args } }
      for (;;) {
        const a = expr(0)
        if (isError(a)) return a
        args.push(a)
        const nx = eat()
        if (!nx) return ERR.value
        if (nx.t === "rp") break
        if (nx.t !== "comma") return ERR.value
      }
      return { n: "call", fn: t.v, args }
    }
    return ERR.value
  }

  function expr(min: number): Node | ErrorValue {
    let left = primary()
    if (isError(left)) return left
    for (;;) {
      const t = peek()
      if (!t || t.t !== "op") break
      const prec = PREC[t.v]
      if (prec === undefined || prec < min) break
      eat()
      const right = expr(prec + 1)
      if (isError(right)) return right
      left = { n: "bin", op: t.v, l: left, r: right }
    }
    return left
  }

  const node = expr(0)
  if (isError(node)) return node
  return p === toks.length ? node : ERR.value
}

// ── Evaluation ───────────────────────────────────────────────────────────────

export type SheetData = {
  shape: SheetShape
  /** rowId -> colId -> raw stored value (scalar or a formula cell). */
  cells: Map<string, Record<string, unknown>>
}

const num = (v: CellValue): number | ErrorValue => {
  if (v === null || v === "") return 0
  if (typeof v === "number") return v
  if (typeof v === "boolean") return v ? 1 : 0
  if (isError(v)) return v as ErrorValue
  const n = Number(String(v).replace(/[^\d.-]/g, ""))
  return Number.isFinite(n) ? n : ERR.value
}

/**
 * Evaluate one cell.
 *
 * `visiting` carries the chain of cells currently being resolved — re-entering one is a cycle, and
 * returning #CYCLE! instead of recursing is what stops A1→B1→A1 blowing the stack.
 */
export function evaluateCell(
  data: SheetData,
  rowId: string,
  colId: string,
  visiting: Set<string> = new Set(),
): CellValue {
  const raw = data.cells.get(rowId)?.[colId]
  if (!isFormulaCell(raw)) return (raw ?? null) as CellValue

  const key = `${rowId}!${colId}`
  if (visiting.has(key)) return ERR.cycle
  visiting.add(key)
  try {
    const src = raw.f.startsWith("=") ? raw.f.slice(1) : raw.f
    const toks = tokenize(src)
    if (isError(toks)) return toks
    const ast = parse(toks)
    if (isError(ast)) return ast
    return evalNode(ast, data, visiting)
  } finally {
    visiting.delete(key)
  }
}

/**
 * Expand a range into every cell in the rectangle between its two corners, in current display order.
 *
 * Both ends are resolved by their CURRENT index, so A1:C9 stays "those three columns, those nine
 * rows" even after someone reorders columns — the corners move with their ids.
 */
function expandRange(
  data: SheetData,
  a: { col: string; row: string },
  b: { col: string; row: string },
): { col: string; row: string }[] | ErrorValue {
  const cols = data.shape.columnIds
  const rowsOrder = data.shape.rowIds
  const c1 = cols.indexOf(a.col)
  const c2 = cols.indexOf(b.col)
  const r1 = rowsOrder.indexOf(a.row)
  const r2 = rowsOrder.indexOf(b.row)
  // A corner whose column or row was deleted makes the whole range meaningless.
  if (c1 < 0 || c2 < 0 || r1 < 0 || r2 < 0) return ERR.ref

  const [cFrom, cTo] = c1 <= c2 ? [c1, c2] : [c2, c1]
  const [rFrom, rTo] = r1 <= r2 ? [r1, r2] : [r2, r1]
  const out: { col: string; row: string }[] = []
  for (let ri = rFrom; ri <= rTo; ri += 1) {
    for (let ci = cFrom; ci <= cTo; ci += 1) out.push({ col: cols[ci], row: rowsOrder[ri] })
  }
  return out
}

/**
 * Excel-style criteria: ">100", "<=5", "<>abc", or a bare value meaning equals.
 * Shared by SUMIF / COUNTIF / AVERAGEIF / SUMIFS / COUNTIFS so they can't drift apart.
 */
function matchesCriteria(value: CellValue, criteria: CellValue): boolean {
  if (value === null || value === "" || isError(value)) return false
  const crit = String(criteria ?? "").trim()
  const m = /^(>=|<=|<>|>|<|=)?(.*)$/.exec(crit)
  const op = m?.[1] ?? "="
  const target = (m?.[2] ?? "").trim()
  const targetNum = Number(target)
  const asNum = num(value)

  if (target !== "" && Number.isFinite(targetNum) && !isError(asNum)) {
    const a = asNum as number
    switch (op) {
      case ">": return a > targetNum
      case "<": return a < targetNum
      case ">=": return a >= targetNum
      case "<=": return a <= targetNum
      case "<>": return a !== targetNum
      default: return a === targetNum
    }
  }
  const sv = String(value).toLowerCase()
  const tv = target.toLowerCase()
  return op === "<>" ? sv !== tv : sv === tv
}

/** A range's cells laid out as rows × columns — VLOOKUP needs the shape, not a flat list. */
function rangeGrid(node: Node, data: SheetData): { rows: { col: string; row: string }[][] } | ErrorValue {
  if (node.n !== "range") return ERR.ref
  const cells = expandRange(data, node.a, node.b)
  if (isError(cells)) return cells
  const width = new Set(cells.map((c) => c.col)).size
  const rows: { col: string; row: string }[][] = []
  for (let i = 0; i < cells.length; i += width) rows.push(cells.slice(i, i + width))
  return { rows }
}

function flatten(node: Node, data: SheetData, visiting: Set<string>): CellValue[] | ErrorValue {
  if (node.n === "range") {
    const cells = expandRange(data, node.a, node.b)
    if (isError(cells)) return cells
    return cells.map((c) => evaluateCell(data, c.row, c.col, visiting))
  }
  const v = evalNode(node, data, visiting)
  return isError(v) ? (v as ErrorValue) : [v]
}

function evalNode(node: Node, data: SheetData, visiting: Set<string>): CellValue {
  switch (node.n) {
    case "num": return node.v
    case "str": return node.v
    case "ref": {
      if (!data.shape.columnIds.includes(node.col) || !data.shape.rowIds.includes(node.row)) return ERR.ref
      return evaluateCell(data, node.row, node.col, visiting)
    }
    case "range": {
      // A bare range outside a function collapses to its first value, like Excel's implicit
      // intersection — rare, but better defined than throwing.
      const vals = flatten(node, data, visiting)
      return isError(vals) ? vals : (vals[0] ?? null)
    }
    case "neg": {
      const v = num(evalNode(node.e, data, visiting))
      return isError(v) ? v : -v
    }
    case "bin": {
      const l = evalNode(node.l, data, visiting)
      if (isError(l)) return l
      const r = evalNode(node.r, data, visiting)
      if (isError(r)) return r
      if (node.op === "&") return `${l ?? ""}${r ?? ""}`
      if ([">", "<", ">=", "<=", "=", "<>"].includes(node.op)) {
        const cmp = typeof l === "string" || typeof r === "string"
          ? String(l ?? "").localeCompare(String(r ?? ""))
          : (num(l) as number) - (num(r) as number)
        switch (node.op) {
          case ">": return cmp > 0
          case "<": return cmp < 0
          case ">=": return cmp >= 0
          case "<=": return cmp <= 0
          case "=": return cmp === 0
          default: return cmp !== 0
        }
      }
      const a = num(l); if (isError(a)) return a
      const b = num(r); if (isError(b)) return b
      switch (node.op) {
        case "+": return a + b
        case "-": return a - b
        case "*": return a * b
        case "/": return b === 0 ? ERR.div : a / b
        case "^": return a ** b
        default: return ERR.value
      }
    }
    case "call": {
      const gather = (): CellValue[] | ErrorValue => {
        const out: CellValue[] = []
        for (const arg of node.args) {
          const vals = flatten(arg, data, visiting)
          if (isError(vals)) return vals
          out.push(...vals)
        }
        return out
      }
      const nums = (): number[] | ErrorValue => {
        const vals = gather()
        if (isError(vals)) return vals
        const out: number[] = []
        for (const v of vals) {
          if (v === null || v === "") continue
          const n = num(v)
          if (isError(n)) return n
          out.push(n)
        }
        return out
      }

      switch (node.fn) {
        case "SUM": { const n = nums(); return isError(n) ? n : n.reduce((s, x) => s + x, 0) }
        case "AVERAGE":
        case "AVG": { const n = nums(); if (isError(n)) return n; return n.length ? n.reduce((s, x) => s + x, 0) / n.length : 0 }
        case "MIN": { const n = nums(); if (isError(n)) return n; return n.length ? Math.min(...n) : 0 }
        case "MAX": { const n = nums(); if (isError(n)) return n; return n.length ? Math.max(...n) : 0 }
        case "COUNT": { const n = nums(); return isError(n) ? n : n.length }
        case "COUNTA": { const v = gather(); return isError(v) ? v : v.filter((x) => x !== null && x !== "").length }
        case "ROUND": {
          const v = gather(); if (isError(v)) return v
          const a = num(v[0] ?? 0); if (isError(a)) return a
          const d = num(v[1] ?? 0); if (isError(d)) return d
          const f = 10 ** d
          return Math.round(a * f) / f
        }
        case "ABS": { const v = gather(); if (isError(v)) return v; const a = num(v[0] ?? 0); return isError(a) ? a : Math.abs(a) }
        case "IF": {
          if (node.args.length < 2) return ERR.value
          const cond = evalNode(node.args[0], data, visiting)
          if (isError(cond)) return cond
          const truthy = typeof cond === "boolean" ? cond : (num(cond) as number) !== 0
          const branch = truthy ? node.args[1] : node.args[2]
          return branch ? evalNode(branch, data, visiting) : false
        }
        case "CONCAT":
        case "CONCATENATE": { const v = gather(); return isError(v) ? v : v.map((x) => (x === null ? "" : String(x))).join("") }
        case "PRODUCT": { const n = nums(); return isError(n) ? n : n.reduce((s, x) => s * x, 1) }
        case "MEDIAN": {
          const n = nums(); if (isError(n)) return n
          if (!n.length) return 0
          const sorted = [...n].sort((a, b) => a - b)
          const mid = Math.floor(sorted.length / 2)
          return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
        }
        case "SQRT": { const v = gather(); if (isError(v)) return v; const a = num(v[0] ?? 0); if (isError(a)) return a; return a < 0 ? ERR.value : Math.sqrt(a) }
        case "POWER": { const v = gather(); if (isError(v)) return v; const a = num(v[0] ?? 0); if (isError(a)) return a; const b = num(v[1] ?? 0); return isError(b) ? b : a ** b }
        case "LEN": { const v = gather(); return isError(v) ? v : String(v[0] ?? "").length }
        case "UPPER": { const v = gather(); return isError(v) ? v : String(v[0] ?? "").toUpperCase() }
        case "LOWER": { const v = gather(); return isError(v) ? v : String(v[0] ?? "").toLowerCase() }
        case "TRIM": { const v = gather(); return isError(v) ? v : String(v[0] ?? "").trim() }
        case "TODAY": return new Date().toISOString().slice(0, 10)
        // ── Conditional aggregates ──────────────────────────────────────────
        case "SUMIF":
        case "AVERAGEIF":
        case "COUNTIF": {
          if (node.args.length < 2) return ERR.value
          const range = flatten(node.args[0], data, visiting)
          if (isError(range)) return range
          const crit = evalNode(node.args[1], data, visiting)
          if (isError(crit)) return crit
          // SUMIF/AVERAGEIF take an optional third range to actually add up — Excel's real signature.
          const target = node.args[2] ? flatten(node.args[2], data, visiting) : range
          if (isError(target)) return target

          const hits: number[] = []
          let count = 0
          range.forEach((v, i) => {
            if (!matchesCriteria(v, crit)) return
            count += 1
            const t = num(target[i] ?? null)
            if (!isError(t)) hits.push(t as number)
          })
          if (node.fn === "COUNTIF") return count
          const total = hits.reduce((s, x) => s + x, 0)
          return node.fn === "SUMIF" ? total : (hits.length ? total / hits.length : 0)
        }
        case "SUMIFS":
        case "COUNTIFS": {
          // SUMIFS(sumRange, critRange1, crit1, …) / COUNTIFS(critRange1, crit1, …)
          const isSum = node.fn === "SUMIFS"
          const pairsStart = isSum ? 1 : 0
          if (node.args.length < pairsStart + 2 || (node.args.length - pairsStart) % 2 !== 0) return ERR.value
          const sumRange = isSum ? flatten(node.args[0], data, visiting) : null
          if (sumRange && isError(sumRange)) return sumRange

          const conditions: { values: CellValue[]; crit: CellValue }[] = []
          for (let i = pairsStart; i < node.args.length; i += 2) {
            const vals = flatten(node.args[i], data, visiting)
            if (isError(vals)) return vals
            const c = evalNode(node.args[i + 1], data, visiting)
            if (isError(c)) return c
            conditions.push({ values: vals, crit: c })
          }
          const length = conditions[0]?.values.length ?? 0
          let total = 0
          let count = 0
          for (let i = 0; i < length; i += 1) {
            if (!conditions.every((c) => matchesCriteria(c.values[i] ?? null, c.crit))) continue
            count += 1
            if (sumRange) {
              const t = num(sumRange[i] ?? null)
              if (!isError(t)) total += t as number
            }
          }
          return isSum ? total : count
        }
        case "COUNTBLANK": {
          const v = gather()
          return isError(v) ? v : v.filter((x) => x === null || x === "").length
        }
        // ── Lookup ──────────────────────────────────────────────────────────
        case "VLOOKUP": {
          // VLOOKUP(kunci, rentang, nomorKolom, [FALSE]) — exact match only. Approximate match needs
          // the range pre-sorted and silently returns the wrong row when it isn't, so it's refused
          // rather than half-supported.
          if (node.args.length < 3) return ERR.value
          const key = evalNode(node.args[0], data, visiting)
          if (isError(key)) return key
          const grid = rangeGrid(node.args[1], data)
          if (isError(grid)) return grid
          const idxRaw = num(evalNode(node.args[2], data, visiting))
          if (isError(idxRaw)) return idxRaw
          const idx = Math.trunc(idxRaw as number)
          if (idx < 1) return ERR.value
          const needle = String(key ?? "").trim().toLowerCase()
          for (const row of grid.rows) {
            const first = row[0]
            if (!first) continue
            const v = evaluateCell(data, first.row, first.col, visiting)
            if (String(v ?? "").trim().toLowerCase() !== needle) continue
            const cell = row[idx - 1]
            if (!cell) return ERR.ref
            return evaluateCell(data, cell.row, cell.col, visiting)
          }
          return ERR.na
        }
        // ── Logic ───────────────────────────────────────────────────────────
        case "IFERROR": {
          const v = evalNode(node.args[0], data, visiting)
          if (!isError(v)) return v
          return node.args[1] ? evalNode(node.args[1], data, visiting) : ""
        }
        case "AND":
        case "OR": {
          const v = gather()
          if (isError(v)) return v
          const truthy = v.map((x) => (typeof x === "boolean" ? x : (num(x) as number) !== 0))
          return node.fn === "AND" ? truthy.every(Boolean) : truthy.some(Boolean)
        }
        case "NOT": {
          const v = gather()
          if (isError(v)) return v
          const x = v[0]
          return !(typeof x === "boolean" ? x : (num(x) as number) !== 0)
        }
        // ── More maths ──────────────────────────────────────────────────────
        case "ROUNDUP":
        case "ROUNDDOWN": {
          const v = gather(); if (isError(v)) return v
          const a = num(v[0] ?? 0); if (isError(a)) return a
          const d = num(v[1] ?? 0); if (isError(d)) return d
          const f = 10 ** (d as number)
          const x = (a as number) * f
          return (node.fn === "ROUNDUP" ? Math.ceil(x) : Math.floor(x)) / f
        }
        case "INT": { const v = gather(); if (isError(v)) return v; const a = num(v[0] ?? 0); return isError(a) ? a : Math.floor(a as number) }
        case "MOD": {
          const v = gather(); if (isError(v)) return v
          const a = num(v[0] ?? 0); if (isError(a)) return a
          const b = num(v[1] ?? 0); if (isError(b)) return b
          return (b as number) === 0 ? ERR.div : (a as number) % (b as number)
        }
        // ── Text ────────────────────────────────────────────────────────────
        case "LEFT":
        case "RIGHT": {
          const v = gather(); if (isError(v)) return v
          const str = String(v[0] ?? "")
          const n2 = v.length > 1 ? num(v[1] ?? 1) : 1
          if (isError(n2)) return n2
          const k = Math.max(0, Math.trunc(n2 as number))
          return node.fn === "LEFT" ? str.slice(0, k) : str.slice(str.length - k)
        }
        case "MID": {
          const v = gather(); if (isError(v)) return v
          const str = String(v[0] ?? "")
          const start = num(v[1] ?? 1); if (isError(start)) return start
          const len = num(v[2] ?? 0); if (isError(len)) return len
          const from = Math.max(0, Math.trunc(start as number) - 1)
          return str.slice(from, from + Math.max(0, Math.trunc(len as number)))
        }
        case "FIND": {
          const v = gather(); if (isError(v)) return v
          const needle = String(v[0] ?? "")
          const hay = String(v[1] ?? "")
          const at = hay.indexOf(needle)
          return at < 0 ? ERR.value : at + 1
        }
        case "SUBSTITUTE": {
          const v = gather(); if (isError(v)) return v
          return String(v[0] ?? "").split(String(v[1] ?? "")).join(String(v[2] ?? ""))
        }
        // ── Dates ───────────────────────────────────────────────────────────
        case "YEAR":
        case "MONTH":
        case "DAY": {
          const v = gather(); if (isError(v)) return v
          const d = new Date(String(v[0] ?? ""))
          if (Number.isNaN(d.getTime())) return ERR.value
          return node.fn === "YEAR" ? d.getFullYear() : node.fn === "MONTH" ? d.getMonth() + 1 : d.getDate()
        }
        case "DATEDIF": {
          // DATEDIF(mulai, selesai, "D"|"M"|"Y")
          const v = gather(); if (isError(v)) return v
          const a = new Date(String(v[0] ?? ""))
          const b = new Date(String(v[1] ?? ""))
          if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return ERR.value
          const unit = String(v[2] ?? "D").toUpperCase()
          const days = Math.round((b.getTime() - a.getTime()) / 86_400_000)
          if (unit === "D") return days
          let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
          if (b.getDate() < a.getDate()) months -= 1
          return unit === "M" ? months : Math.trunc(months / 12)
        }
        default: return ERR.name
      }
    }
    default: return ERR.value
  }
}

/** Every function the engine actually implements, with what the autocomplete shows. Keeping this
 *  list next to the switch above is what stops the dropdown from offering functions that don't work. */
export const SUPPORTED_FUNCTIONS: { name: string; args: string; desc: string }[] = [
  { name: "SUM", args: "(angka; …)", desc: "Jumlahin deret angka atau sel." },
  { name: "SUMIF", args: "(rentang; kriteria)", desc: "Jumlahin yang memenuhi syarat, mis. \">100\"." },
  { name: "AVERAGE", args: "(angka; …)", desc: "Rata-rata dari angka atau sel." },
  { name: "MEDIAN", args: "(angka; …)", desc: "Nilai tengah." },
  { name: "MIN", args: "(angka; …)", desc: "Nilai terkecil." },
  { name: "MAX", args: "(angka; …)", desc: "Nilai terbesar." },
  { name: "COUNT", args: "(rentang)", desc: "Hitung sel yang isinya angka." },
  { name: "COUNTA", args: "(rentang)", desc: "Hitung sel yang nggak kosong." },
  { name: "PRODUCT", args: "(angka; …)", desc: "Kaliin semua angka." },
  { name: "ROUND", args: "(angka; digit)", desc: "Bulatkan ke sekian angka di belakang koma." },
  { name: "ABS", args: "(angka)", desc: "Nilai mutlak (buang tanda minus)." },
  { name: "SQRT", args: "(angka)", desc: "Akar kuadrat." },
  { name: "POWER", args: "(angka; pangkat)", desc: "Pangkat." },
  { name: "IF", args: "(syarat; kalau benar; kalau salah)", desc: "Pilih nilai berdasarkan syarat." },
  { name: "CONCAT", args: "(teks; …)", desc: "Sambung teks jadi satu." },
  { name: "LEN", args: "(teks)", desc: "Jumlah karakter." },
  { name: "UPPER", args: "(teks)", desc: "Jadiin HURUF BESAR." },
  { name: "LOWER", args: "(teks)", desc: "Jadiin huruf kecil." },
  { name: "TRIM", args: "(teks)", desc: "Buang spasi berlebih." },
  { name: "TODAY", args: "()", desc: "Tanggal hari ini." },
  { name: "COUNTIF", args: "(rentang; kriteria)", desc: "Hitung yang memenuhi syarat." },
  { name: "COUNTIFS", args: "(rentang; kriteria; …)", desc: "Hitung yang memenuhi banyak syarat." },
  { name: "SUMIFS", args: "(rentang jumlah; rentang; kriteria; …)", desc: "Jumlahin dengan banyak syarat." },
  { name: "AVERAGEIF", args: "(rentang; kriteria)", desc: "Rata-rata yang memenuhi syarat." },
  { name: "COUNTBLANK", args: "(rentang)", desc: "Hitung sel yang kosong." },
  { name: "VLOOKUP", args: "(kunci; rentang; nomor kolom)", desc: "Cari baris, ambil kolom ke-N. Cocok persis." },
  { name: "IFERROR", args: "(nilai; kalau error)", desc: "Ganti hasil error dengan nilai lain." },
  { name: "AND", args: "(syarat; …)", desc: "Benar kalau semuanya benar." },
  { name: "OR", args: "(syarat; …)", desc: "Benar kalau salah satu benar." },
  { name: "NOT", args: "(syarat)", desc: "Kebalikan dari syarat." },
  { name: "ROUNDUP", args: "(angka; digit)", desc: "Bulatkan ke atas." },
  { name: "ROUNDDOWN", args: "(angka; digit)", desc: "Bulatkan ke bawah." },
  { name: "INT", args: "(angka)", desc: "Buang koma, bulatkan ke bawah." },
  { name: "MOD", args: "(angka; pembagi)", desc: "Sisa bagi." },
  { name: "LEFT", args: "(teks; jumlah)", desc: "Ambil karakter dari kiri." },
  { name: "RIGHT", args: "(teks; jumlah)", desc: "Ambil karakter dari kanan." },
  { name: "MID", args: "(teks; mulai; jumlah)", desc: "Ambil karakter dari tengah." },
  { name: "FIND", args: "(cari; teks)", desc: "Posisi teks yang dicari." },
  { name: "SUBSTITUTE", args: "(teks; lama; baru)", desc: "Ganti sebagian teks." },
  { name: "YEAR", args: "(tanggal)", desc: "Ambil tahunnya." },
  { name: "MONTH", args: "(tanggal)", desc: "Ambil bulannya." },
  { name: "DAY", args: "(tanggal)", desc: "Ambil tanggalnya." },
  { name: "DATEDIF", args: "(mulai; selesai; \"D\"|\"M\"|\"Y\")", desc: "Selisih tanggal dalam hari/bulan/tahun." },
]
