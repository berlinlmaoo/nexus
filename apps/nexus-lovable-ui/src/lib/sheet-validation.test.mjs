// node --experimental-strip-types src/lib/sheet-validation.test.mjs   (from apps/nexus-lovable-ui)
//
// Data validation: ranges typed the Sheets way <-> stored id-space ranges, which rule covers a cell,
// and whether a value passes each kind of criteria.
import assert from "node:assert/strict"

const F = await import("./sheet-formula.ts")
const V = await import("./sheet-validation.ts")

let n = 0
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++ }

const shape = { columnIds: ["ca", "cb", "cc"], rowIds: ["r1", "r2", "r3", "r4"] }

// ── Ranges ──────────────────────────────────────────────────────────────────────────────────────
eq(V.rangeFromA1("Sheet1!B2:B4", shape), "{cb!r2}:{cb!r4}", "sheet-qualified range")
eq(V.rangeFromA1("c3", shape), "{cc!r3}:{cc!r3}", "single cell, lower case")
eq(V.rangeFromA1("A:B", shape), "{ca!*}:{cb!*}", "whole columns")
eq(V.rangeFromA1("A2:A", shape), "{ca!r2}:{ca!r4}", "open-ended range runs to the last row")
eq(V.rangeFromA1("Z9", shape), null, "outside the sheet")
eq(V.rangeToA1("{cb!r2}:{cb!r4}", shape), "B2:B4", "back to A1")
eq(V.rangeToA1("{cc!r3}:{cc!r3}", shape), "C3", "single cell")
eq(V.rangeToA1("{ca!*}:{ca!*}", shape), "A:A", "whole column")
eq(V.rangeRect("{ca!*}:{cb!*}", shape), { top: 0, bottom: 3, left: 0, right: 1 }, "rect of whole columns")

// ── Which rule covers a cell ────────────────────────────────────────────────────────────────────
{
  const a = { id: "a", kind: "list", values: ["x"], ranges: ["{ca!*}:{ca!*}"] }
  const b = { id: "b", kind: "checkbox", ranges: ["{ca!r2}:{ca!r2}"] }
  const at = V.buildRuleIndex([a, b], shape)
  eq(at(0, 0)?.id, "a", "column rule")
  eq(at(1, 0)?.id, "b", "a later rule wins where they overlap")
  eq(at(1, 1), null, "uncovered cell")
}

// ── Criteria ────────────────────────────────────────────────────────────────────────────────────
const ctx = { engine: null, shape, at: { r: 0, c: 0 } }
const ok = (rule, raw, computed = raw) => V.validateCell({ id: "x", ranges: [], ...rule }, raw, computed ?? null, ctx)
eq(ok({ kind: "list", values: ["Venue", "Talent"] }, "Venue"), true, "dropdown item")
eq(ok({ kind: "list", values: ["Venue", "Talent"] }, "Food"), false, "not on the list")
eq(ok({ kind: "list", values: ["Venue", "Talent"] }, null), true, "blank always passes")
eq(ok({ kind: "list", values: ["A", "B"], multiple: true }, "A, B"), true, "multiple selections")
eq(ok({ kind: "list", values: ["A", "B"], multiple: true }, "A, C"), false, "one bad item fails")
eq(ok({ kind: "textContains", values: ["rp"] }, "Total Rp"), true, "text contains (case-insensitive)")
eq(ok({ kind: "textNotContains", values: ["x"] }, "abc"), true, "text doesn't contain")
eq(ok({ kind: "textIs", values: ["OK"] }, "ok"), false, "text is exactly")
eq(ok({ kind: "email" }, "budi@znetworks.id"), true, "valid email")
eq(ok({ kind: "email" }, "budi@"), false, "invalid email")
eq(ok({ kind: "url" }, "nexus.znetworks.id/x"), true, "valid url")
eq(ok({ kind: "url" }, "not a url"), false, "invalid url")
eq(ok({ kind: "gt", values: ["1.000"] }, 1500), true, "greater than an Indonesian number")
eq(ok({ kind: "between", values: ["1", "10"] }, 11), false, "between")
eq(ok({ kind: "notBetween", values: ["1", "10"] }, 11), true, "not between")
eq(ok({ kind: "gte", values: ["5"] }, "abc", "abc"), false, "text fails a number rule")
eq(ok({ kind: "dateAfter", values: ["01/10/2026"] }, "2026-10-11", F.ymdToSerial(2026, 10, 11)), true, "date after (day-first criteria)")
eq(ok({ kind: "dateBefore", values: ["01/10/2026"] }, "2026-10-11", F.ymdToSerial(2026, 10, 11)), false, "date before")
eq(ok({ kind: "dateBetween", values: ["1/10/2026", "31/10/2026"] }, 46306), true, "date between")
eq(ok({ kind: "dateValid" }, "kemarin", "kemarin"), false, "not a date")
eq(ok({ kind: "checkbox" }, true), true, "checkbox TRUE")
eq(ok({ kind: "checkbox" }, "maybe"), false, "checkbox with another value")
eq(ok({ kind: "checkbox", checked: "Ya", unchecked: "Tidak" }, "Ya"), true, "custom checked value")
eq(V.isChecked({ kind: "checkbox", checked: "Ya" }, "Ya"), true, "custom value reads as ticked")
eq(V.checkboxValue({ kind: "checkbox", checked: "Ya", unchecked: "Tidak" }, false), "Tidak", "untick writes the custom value")

// Custom formula, relative to the rule's top-left: =A1>0 on A1:A4 checks each row's own A.
{
  const data = {
    shape,
    cells: new Map([["r1", { ca: 5 }], ["r2", { ca: -1 }], ["r3", {}], ["r4", {}]]),
  }
  const engine = new F.SheetEngine(data)
  const rule = { id: "f", kind: "formula", ranges: ["{ca!r1}:{ca!r4}"], formula: F.toStored("=A1>0", shape) }
  eq(V.validateCell(rule, 5, 5, { engine, shape, at: { r: 0, c: 0 } }), true, "custom formula on its first cell")
  eq(V.validateCell(rule, -1, -1, { engine, shape, at: { r: 1, c: 0 } }), false, "custom formula shifted to the second row")
  const range = { id: "s", kind: "listRange", ranges: ["{cb!*}:{cb!*}"], source: "{ca!r1}:{ca!r2}" }
  eq(V.dropdownOptions(range, engine, shape), ["5", "-1"], "dropdown from a range")
}

console.log(`sheet-validation: ${n} checks passed`)
