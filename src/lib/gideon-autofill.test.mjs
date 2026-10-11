// node --experimental-strip-types src/lib/gideon-autofill.test.mjs
import assert from "node:assert/strict"
import { autofillPrompt, coerceAutofillValue, extractJsonObject } from "./gideon-autofill-core.ts"

const sel = { id: "f1", name: "Category", type: "SELECT", options: ["Bug", "Feature"], mode: "classify", prompt: null }
assert.equal(coerceAutofillValue(sel, "bug"), "Bug")
assert.equal(coerceAutofillValue(sel, "Chore"), null)
assert.deepEqual(coerceAutofillValue({ ...sel, type: "MULTI_SELECT" }, ["feature", "x", "Feature"]), ["Feature"])
assert.equal(coerceAutofillValue({ ...sel, type: "NUMBER", options: [] }, "Rp 1.500.000"), 1500000)
assert.equal(coerceAutofillValue({ ...sel, type: "DATE", options: [] }, "2026-10-20"), "2026-10-20")
assert.equal(coerceAutofillValue({ ...sel, type: "DATE", options: [] }, "next week"), null)
assert.equal(coerceAutofillValue({ ...sel, type: "URL", options: [] }, "javascript:alert(1)"), null)
assert.equal(coerceAutofillValue({ ...sel, type: "TEXT", options: [], mode: "summary" }, "  a   b "), "a b")
assert.deepEqual(extractJsonObject('```json\n{"t1": {"f1": "Bug"}}\n```'), { t1: { f1: "Bug" } })
assert.equal(extractJsonObject("no json"), null)
const p = autofillPrompt("Atlas", [sel], [{ id: "t1", title: "Crash on login", description: "", status: "TODO", priority: "HIGH", due: null, section: "To do", assignees: [], fields: {} }])
assert.match(p, /Do NOT call any tools/)
assert.match(p, /exactly one of \["Bug","Feature"\]/)
console.log("gideon-autofill ok")
