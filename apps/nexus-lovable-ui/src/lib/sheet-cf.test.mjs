// node --experimental-strip-types src/lib/sheet-cf.test.mjs   (from apps/nexus-lovable-ui)
//
// Conditional formatting: conditions (shared with the filter), rule priority, colour scales.
import assert from "node:assert/strict"

const F = await import("./sheet-formula.ts")
const C = await import("./sheet-cf.ts")

let n = 0
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); n++ }

const shape = { columnIds: ["ca", "cb", "cc"], rowIds: ["r1", "r2", "r3", "r4", "r5"] }
const today = F.ymdToSerial(2026, 10, 12)
const m = (kind, values, v, extra = {}) => C.matchCondition(kind, values, v, { engine: null, shape, at: { r: 0, c: 0 }, origin: { r: 0, c: 0 }, today, ...extra })

// ── Conditions ──────────────────────────────────────────────────────────────────────────────────
eq(m("empty", [], null), true, "empty: null")
eq(m("empty", [], ""), true, "empty: empty string")
eq(m("empty", [], 0), false, "zero is not empty")
eq(m("notEmpty", [], "x"), true, "not empty")
eq(m("textContains", ["APEL"], "apel merah"), true, "contains ignores case")
eq(m("textNotContains", ["x"], "apel"), true, "does not contain")
eq(m("textStarts", ["ap"], "Apel"), true, "starts with")
eq(m("textEnds", ["EL"], "Apel"), true, "ends with")
eq(m("textEnds", ["ap"], "Apel"), false, "does not end with")
eq(m("textIs", ["baru"], "Baru"), true, "text is exactly (case-insensitive)")
eq(m("textIs", ["baru"], "Baru lagi"), false, "text is exactly: not a prefix")
eq(m("gt", ["10"], 12), true, "greater than")
eq(m("gt", ["10"], "12"), true, "numeric text compares as a number")
eq(m("gt", ["1.000"], 1500), true, "Indonesian thousands in the criterion")
eq(m("gte", ["10"], 10), true, "greater or equal")
eq(m("lt", ["10"], "abc"), false, "text never passes a number comparison")
eq(m("lte", ["10"], null), false, "empty never passes less-or-equal")
eq(m("eq", ["5"], 5), true, "equal number")
eq(m("eq", ["Baru"], "baru"), true, "equal falls back to text")
eq(m("neq", ["5"], 6), true, "not equal")
eq(m("between", ["10", "1"], 5), true, "between, bounds in any order")
eq(m("notBetween", ["1", "10"], 11), true, "not between")
eq(m("between", ["1", "10"], 11), false, "outside between")
eq(m("dateIs", ["today"], today), true, "date is today (serial)")
eq(m("dateIs", ["today"], "2026-10-12"), true, "date is today (ISO text)")
eq(m("dateIs", ["tomorrow"], today + 1), true, "tomorrow")
eq(m("dateIs", ["yesterday"], today), false, "not yesterday")
eq(m("dateIs", ["week"], today - 3), true, "in the past week")
eq(m("dateIs", ["week"], today - 20), false, "older than a week")
eq(m("dateIs", ["month"], F.ymdToSerial(2026, 9, 20)), true, "in the past month")
eq(m("dateIs", ["year"], F.ymdToSerial(2025, 12, 1)), true, "in the past year")
eq(m("dateIs", ["11/10/2026"], F.ymdToSerial(2026, 10, 11)), true, "exact date, day first")
eq(m("dateIs", ["exact", "11/10/2026"], F.ymdToSerial(2026, 10, 11)), true, "exact date via keyword")
eq(m("dateBefore", ["today"], today - 1), true, "date before today")
eq(m("dateAfter", ["week"], today - 1), false, "date after the past week means after today")
eq(m("dateAfter", ["01/10/2026"], "2026-10-05"), true, "date after an exact date")
eq(m("dateBefore", ["today"], "kemarin"), false, "text that isn't a date")
eq(m("gt", ["1"], "#DIV/0!"), false, "errors never match")

// ── Custom formula, shifted from the rule's top-left ─────────────────────────────────────────────
const data = {
  shape,
  cells: new Map([
    ["r1", { ca: 5, cb: "Buah" }], ["r2", { ca: -1, cb: "Sayur" }], ["r3", { ca: 30, cb: "Buah" }],
    ["r4", { ca: 2 }], ["r5", { ca: "x" }],
  ]),
}
const engine = new F.SheetEngine(data)
{
  const formula = F.toStored("=A1>3", shape)
  const ctx = (r) => ({ engine, formula, shape, at: { r, c: 1 }, origin: { r: 0, c: 1 }, today })
  eq(C.matchCondition("formula", undefined, null, ctx(0)), true, "custom formula on the first cell")
  eq(C.matchCondition("formula", undefined, null, ctx(1)), false, "custom formula shifted one row down")
  eq(C.matchCondition("formula", undefined, null, ctx(2)), true, "custom formula shifted two rows down")
  eq(C.matchCondition("formula", undefined, null, { ...ctx(0), engine: null }), false, "no engine: formula never matches")
}

// ── Colours ─────────────────────────────────────────────────────────────────────────────────────
eq(C.interpolateHex("#ffffff", "#000000", 0.5), "#808080", "midway grey")
eq(C.interpolateHex("#ffffff", "#57bb8a", 0), "#ffffff", "t=0 is the first colour")
eq(C.interpolateHex("#ffffff", "#57bb8a", 2), "#57bb8a", "t is clamped")
eq(C.DEFAULT_COND_STYLE, { bg: "#b7e1cd" }, "default style is Sheets' green")
eq(C.COND_PRESETS.length >= 12, true, "twelve presets")
eq(C.SCALE_PRESETS[0], { min: "#ffffff", max: "#57bb8a" }, "default scale white → green")

// ── Formatter: first matching single rule wins; scales combine ──────────────────────────────────
{
  const all = "{ca!r1}:{ca!r5}"
  const rules = [
    { id: "a", ranges: [all], type: "single", cond: "gt", values: ["10"], style: { bg: "#f4c7c3", b: 1 } },
    { id: "b", ranges: [all], type: "single", cond: "notEmpty", style: { bg: "#b7e1cd" } },
    { id: "s", ranges: [all], type: "scale", scale: { min: { type: "min", color: "#ffffff" }, max: { type: "max", color: "#000000" } } },
    { id: "t", ranges: ["{cb!r1}:{cb!r5}"], type: "single", cond: "textIs", values: ["buah"], style: { fc: "#0b8043" } },
  ]
  const fmt = C.buildCondFormatter(rules, shape, engine, today)
  eq(fmt(2, 0), { bg: "#f4c7c3", b: 1 }, "earlier rule wins and overrides the scale fill")
  eq(fmt(0, 0), { bg: "#b7e1cd" }, "second rule when the first doesn't match")
  eq(fmt(4, 0), { bg: "#b7e1cd" }, "text gets the single rule but no scale colour")
  eq(fmt(0, 1), { fc: "#0b8043" }, "text rule on another column")
  eq(fmt(1, 1), null, "no rule matches")
  eq(fmt(0, 2), null, "outside every range")
  const scaleOnly = C.buildCondFormatter([rules[2]], shape, engine, today)
  eq(scaleOnly(1, 0), { bg: "#ffffff" }, "minimum gets the min colour")
  eq(scaleOnly(2, 0), { bg: "#000000" }, "maximum gets the max colour")
  eq(scaleOnly(3, 0).bg, C.interpolateHex("#ffffff", "#000000", 3 / 31), "between is interpolated")
  eq(scaleOnly(4, 0), null, "non-numbers get nothing")
  const withMid = C.buildCondFormatter([{ ...rules[2], scale: { min: { type: "num", value: "0", color: "#ff0000" }, mid: { type: "num", value: "5", color: "#ffffff" }, max: { type: "num", value: "10", color: "#00ff00" } } }], shape, engine, today)
  eq(withMid(0, 0).bg, "#ffffff", "value at the midpoint gets the mid colour")
  eq(withMid(2, 0).bg, "#00ff00", "above the max point")
  eq(withMid(3, 0).bg, C.interpolateHex("#ff0000", "#ffffff", 2 / 5), "below the midpoint blends min → mid")
  eq(C.scalePointValue({ type: "pctile", value: "50", color: "#fff" }, [1, 2, 3, 4]), 2.5, "percentile interpolates")
}

console.log(`sheet-cf: ${n} checks passed`)
