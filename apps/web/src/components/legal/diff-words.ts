// Word-level diff for the editor's live "before → after" while someone types. The same algorithm as the
// server's src/lib/legal/diff.ts (diffWords), which renders compares and GIDEON proposals; keep them alike.

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
export function diffWordsClient(before: string, after: string): Segment[] {
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
