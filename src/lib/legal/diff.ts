// Legal: before → after diffs, for comparing two versions of a document and for showing what GIDEON proposes.
// Pure, no imports (node src/lib/legal/diff.test.mjs).

export type Segment = { type: "same" | "del" | "ins"; text: string }

/** Longest-common-subsequence table walk over two token lists → same / del / ins runs. */
function lcsOps<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): { type: "same" | "del" | "ins"; a?: number; b?: number }[] {
  const n = a.length
  const m = b.length
  // Trim the common head and tail first: versions differ in a few places, so the table stays small.
  let head = 0
  while (head < n && head < m && eq(a[head], b[head])) head++
  let tail = 0
  while (tail < n - head && tail < m - head && eq(a[n - 1 - tail], b[m - 1 - tail])) tail++
  const A = a.slice(head, n - tail)
  const B = b.slice(head, m - tail)
  // The table is A × B cells; past a few million (two long, wholly different texts) read the middle as
  // removed-then-added instead of spending hundreds of MB and blocking the server to align it.
  if (A.length * B.length > 4_000_000) {
    const out: { type: "same" | "del" | "ins"; a?: number; b?: number }[] = []
    for (let k = 0; k < head; k++) out.push({ type: "same", a: k, b: k })
    A.forEach((_, i) => out.push({ type: "del", a: head + i }))
    B.forEach((_, j) => out.push({ type: "ins", b: head + j }))
    for (let k = 0; k < tail; k++) out.push({ type: "same", a: n - tail + k, b: m - tail + k })
    return out
  }
  const rows = A.length + 1
  const cols = B.length + 1
  const dp = new Uint32Array(rows * cols)
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      dp[i * cols + j] = eq(A[i], B[j]) ? dp[(i + 1) * cols + j + 1] + 1 : Math.max(dp[(i + 1) * cols + j], dp[i * cols + j + 1])
    }
  }
  const out: { type: "same" | "del" | "ins"; a?: number; b?: number }[] = []
  for (let k = 0; k < head; k++) out.push({ type: "same", a: k, b: k })
  let i = 0
  let j = 0
  while (i < A.length && j < B.length) {
    if (eq(A[i], B[j])) { out.push({ type: "same", a: head + i, b: head + j }); i++; j++ }
    else if (dp[(i + 1) * cols + j] >= dp[i * cols + j + 1]) { out.push({ type: "del", a: head + i }); i++ }
    else { out.push({ type: "ins", b: head + j }); j++ }
  }
  while (i < A.length) out.push({ type: "del", a: head + i++ })
  while (j < B.length) out.push({ type: "ins", b: head + j++ })
  for (let k = 0; k < tail; k++) out.push({ type: "same", a: n - tail + k, b: m - tail + k })
  return out
}

/** Word-level diff of two texts: words and the spaces between them are the tokens. */
export function diffWords(before: string, after: string): Segment[] {
  const tok = (s: string) => s.match(/\s+|[^\s]+/g) ?? []
  const a = tok(before)
  const b = tok(after)
  const raw: Segment[] = lcsOps(a, b, (x, y) => x === y).map((op) => ({ type: op.type, text: op.type === "ins" ? b[op.b!] : a[op.a!] }))
  // A lone space that happens to match between two changes splits one edit into "del ins del ins"; read
  // such a run as one change: everything removed, then everything added.
  const out: Segment[] = []
  const push = (type: Segment["type"], text: string) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last && last.type === type) last.text += text
    else out.push({ type, text })
  }
  let i = 0
  while (i < raw.length) {
    if (raw[i].type === "same") { push("same", raw[i].text); i++; continue }
    let j = i
    let del = ""
    let ins = ""
    for (;;) {
      while (j < raw.length && raw[j].type !== "same") { if (raw[j].type === "del") del += raw[j].text; else ins += raw[j].text; j++ }
      // Absorb a whitespace-only match only when another change follows it.
      if (j + 1 < raw.length && /^\s+$/.test(raw[j].text) && raw[j + 1].type !== "same") { del += raw[j].text; ins += raw[j].text; j++; continue }
      break
    }
    push("del", del)
    push("ins", ins)
    i = j
  }
  return out
}

export type ParagraphDiff =
  | { type: "same"; a: number; b: number; text: string }
  | { type: "removed"; a: number; text: string }
  | { type: "added"; b: number; text: string }
  | { type: "changed"; a: number; b: number; before: string; after: string; segments: Segment[] }

/** Paragraph-level diff; a removed paragraph followed by an added one reads as one changed paragraph. */
export function diffParagraphs(a: string[], b: string[]): ParagraphDiff[] {
  const ops = lcsOps(a, b, (x, y) => x === y)
  const out: ParagraphDiff[] = []
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]
    if (op.type === "same") { out.push({ type: "same", a: op.a!, b: op.b!, text: a[op.a!] }); continue }
    // Collect a block of dels and inss, then pair them up in order.
    const dels: number[] = []
    const inss: number[] = []
    while (k < ops.length && ops[k].type !== "same") {
      if (ops[k].type === "del") dels.push(ops[k].a!)
      else inss.push(ops[k].b!)
      k++
    }
    k--
    const pairs = Math.min(dels.length, inss.length)
    for (let p = 0; p < pairs; p++) {
      out.push({ type: "changed", a: dels[p], b: inss[p], before: a[dels[p]], after: b[inss[p]], segments: diffWords(a[dels[p]], b[inss[p]]) })
    }
    for (const d of dels.slice(pairs)) out.push({ type: "removed", a: d, text: a[d] })
    for (const i of inss.slice(pairs)) out.push({ type: "added", b: i, text: b[i] })
  }
  return out
}
