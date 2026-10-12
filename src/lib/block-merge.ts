/**
 * Block-level three-way merge for edits that do not come from a live editor (the iOS app, 12 Oct 2026).
 *
 * The app loads a page (or a task body), edits it offline or online, and sends back BOTH what it started
 * from (`base`) and what it ended with (`mine`). The server holds the live document (`live`: the Yjs room
 * when one is open, else the stored JSON) which web collaborators may have changed meanwhile. This plans
 * the app's changes as operations on the LIVE top-level block list:
 *   - a base block the app removed (or rewrote) is deleted from live — only if live still has it unchanged;
 *   - a block the app added (or the rewritten version) is inserted after the live copy of the base block that
 *     precedes it in `mine`, and after anything collaborators added right there;
 *   - a block the app removed or rewrote that someone else ALSO changed (it is no longer in live as it was)
 *     is a conflict. With `keepBoth`, the other person's version stays and the app's is inserted next to it.
 * Blocks nobody touched stay exactly as they are in live (their Yjs items are not recreated), so concurrent
 * typing elsewhere in the page is never disturbed.
 *
 * Pure: no imports. `canon` turns one block into a comparable string (canonicalDoc of a one-block doc).
 * Tested by block-merge.test.mjs.
 */

export type MergeOp =
  | { type: "delete"; liveIndex: number }
  | { type: "insert"; liveIndex: number; nodes: unknown[]; order: number }

export type MergePlan = { ops: MergeOp[]; conflicts: number[]; changed: boolean }

/** Longest common subsequence of two string lists, as index pairs in order. */
export function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length, m = b.length
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: Array<[number, number]> = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return out
}

export function planBlockMerge(base: unknown[], mine: unknown[], live: unknown[], canon: (b: unknown) => string, keepBoth = false): MergePlan {
  const A = base.map(canon), M = mine.map(canon), L = live.map(canon)
  const bm = lcsPairs(A, M)
  const bl = lcsPairs(A, L)
  const keptBase = new Set(bm.map(([i]) => i))
  const baseOfMine = new Map<number, number>(bm.map(([i, j]) => [j, i]))
  const baseToLive = new Map<number, number>(bl)
  const liveFromBase = new Set<number>(bl.map(([, l]) => l))

  const ops: MergeOp[] = []
  const conflicts: number[] = []

  // Deletions: base blocks the app no longer has.
  for (let i = 0; i < A.length; i++) {
    if (keptBase.has(i)) continue
    const li = baseToLive.get(i)
    if (li !== undefined) ops.push({ type: "delete", liveIndex: li })
    else if (!keepBoth) conflicts.push(i)
  }

  // Insertions: runs of the app's new blocks, each placed after the live copy of the base block before it.
  let order = 0
  let run: unknown[] = []
  let anchorBase = -1
  const flush = () => {
    if (!run.length) return
    let at = 0
    for (let b = anchorBase; b >= 0; b--) {
      const li = baseToLive.get(b)
      if (li !== undefined) { at = li + 1; break }
    }
    // After whatever someone else added (or rewrote) right there: the app's block follows the live
    // neighbourhood it was written into instead of jumping in front of a collaborator's new block.
    while (at < L.length && !liveFromBase.has(at)) at++
    ops.push({ type: "insert", liveIndex: at, nodes: run, order: order++ })
    run = []
  }
  for (let j = 0; j < M.length; j++) {
    const b = baseOfMine.get(j)
    if (b === undefined) { run.push(mine[j]); continue }
    flush()
    anchorBase = b
  }
  flush()

  // Apply from the end: higher live indices first; at one index, the delete before the inserts, and later
  // runs before earlier ones (so earlier runs end up first).
  ops.sort((x, y) => {
    if (x.liveIndex !== y.liveIndex) return y.liveIndex - x.liveIndex
    if (x.type !== y.type) return x.type === "delete" ? -1 : 1
    return x.type === "insert" && y.type === "insert" ? y.order - x.order : 0
  })
  return { ops, conflicts, changed: ops.length > 0 }
}

/** Applies a plan to a plain array (the stored JSON when no live room is open; also used by the tests). */
export function applyPlanToList<T>(live: T[], plan: MergePlan): T[] {
  const out = [...live]
  for (const op of plan.ops) {
    if (op.type === "delete") out.splice(op.liveIndex, 1)
    else out.splice(op.liveIndex, 0, ...(op.nodes as T[]))
  }
  return out
}
