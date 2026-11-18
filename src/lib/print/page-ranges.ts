/**
 * "1-3,5" → [[1,3],[5,5]] for IPP page-ranges (print an uploaded file, 18 Nov 2026). Pure; tested by
 * src/__tests__/print-upload.test.ts. Pages are 1-based; the result is sorted and merged (IPP wants ascending,
 * non-overlapping ranges); `count` is how many pages that prints, which is what the 50-page cap is checked against.
 */

export type PageRangeResult =
  | { ok: true; ranges: Array<[number, number]>; count: number; all: boolean }
  | { ok: false; error: string; code: "BAD_RANGE" | "OUT_OF_RANGE" }

export function parsePageRanges(text: string | null | undefined, pageCount: number): PageRangeResult {
  const raw = (text ?? "").replace(/\s+/g, "")
  if (!raw) return { ok: true, ranges: [[1, pageCount]], count: pageCount, all: true }
  if (raw.length > 200 || !/^\d+(-\d+)?(,\d+(-\d+)?)*,?$/.test(raw)) {
    return { ok: false, error: "Write pages like 1-3,5", code: "BAD_RANGE" }
  }
  const parts: Array<[number, number]> = []
  for (const piece of raw.split(",").filter(Boolean)) {
    const [a, b] = piece.split("-").map(Number)
    const lo = a
    const hi = b ?? a
    if (lo < 1 || hi < lo) return { ok: false, error: "Write pages like 1-3,5", code: "BAD_RANGE" }
    if (hi > pageCount) return { ok: false, error: `This file has ${pageCount} pages`, code: "OUT_OF_RANGE" }
    parts.push([lo, hi])
  }
  parts.sort((x, y) => x[0] - y[0])
  const ranges: Array<[number, number]> = []
  for (const r of parts) {
    const last = ranges[ranges.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else ranges.push([r[0], r[1]])
  }
  const count = ranges.reduce((n, [lo, hi]) => n + hi - lo + 1, 0)
  return { ok: true, ranges, count, all: count === pageCount }
}
