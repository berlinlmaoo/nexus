// node --experimental-strip-types src/lib/block-merge.test.mjs
import assert from "node:assert/strict"
import { planBlockMerge, applyPlanToList } from "./block-merge.ts"

let n = 0
const t = (name, fn) => { try { fn(); n++ } catch (e) { console.error("FAIL", name); throw e } }
const canon = (b) => JSON.stringify(b)
const merge = (base, mine, live, keepBoth = false) => {
  const plan = planBlockMerge(base, mine, live, canon, keepBoth)
  return { plan, out: applyPlanToList(live, plan) }
}

t("no change", () => {
  const { plan, out } = merge(["a", "b"], ["a", "b"], ["a", "b"])
  assert.equal(plan.changed, false); assert.deepEqual(out, ["a", "b"])
})
t("edit one block, nobody else", () => {
  assert.deepEqual(merge(["a", "b", "c"], ["a", "B", "c"], ["a", "b", "c"]).out, ["a", "B", "c"])
})
t("append, insert at top, delete", () => {
  assert.deepEqual(merge(["a", "b"], ["a", "b", "c"], ["a", "b"]).out, ["a", "b", "c"])
  assert.deepEqual(merge(["a", "b"], ["z", "a", "b"], ["a", "b"]).out, ["z", "a", "b"])
  assert.deepEqual(merge(["a", "b", "c"], ["a", "c"], ["a", "b", "c"]).out, ["a", "c"])
})
t("concurrent edits in different blocks both survive", () => {
  // The web changed c; the app changed a.
  assert.deepEqual(merge(["a", "b", "c"], ["A", "b", "c"], ["a", "b", "C"]).out, ["A", "b", "C"])
  // The web added x after b; the app added y at the end.
  assert.deepEqual(merge(["a", "b"], ["a", "b", "y"], ["a", "b", "x"]).out, ["a", "b", "x", "y"])
})
t("same block changed on both sides = conflict", () => {
  const { plan } = merge(["a", "b"], ["a", "B1"], ["a", "B2"])
  assert.deepEqual(plan.conflicts, [1])
})
t("keepBoth keeps the other version and adds mine after it", () => {
  const { plan, out } = merge(["a", "b"], ["a", "B1"], ["a", "B2"], true)
  assert.deepEqual(plan.conflicts, []); assert.deepEqual(out, ["a", "B2", "B1"])
})
t("several runs land in order", () => {
  assert.deepEqual(merge(["a", "b", "c"], ["x", "a", "y1", "y2", "b", "c", "z"], ["a", "b", "c"]).out, ["x", "a", "y1", "y2", "b", "c", "z"])
  assert.deepEqual(merge(["a", "b", "c"], ["a", "B", "C"], ["a", "b", "c"]).out, ["a", "B", "C"])
})
t("anchor changed by someone else: insert after its new version", () => {
  // base a b c; web rewrote b → bX; app inserted n after b: n follows the rewritten block.
  assert.deepEqual(merge(["a", "b", "c"], ["a", "b", "n", "c"], ["a", "bX", "c"]).out, ["a", "bX", "n", "c"])
})
t("block deleted by the web and left alone by the app stays deleted", () => {
  assert.deepEqual(merge(["a", "b", "c"], ["a", "b", "c", "d"], ["a", "c"]).out, ["a", "c", "d"])
})
console.log(`block-merge: ${n} checks passed`)
