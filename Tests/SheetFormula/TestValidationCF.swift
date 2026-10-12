// Ports of sheet-validation.test.mjs and sheet-cf.test.mjs (same cases, same expected values).
import Foundation

func runValidationTests() {
    typealias F = SheetFormula
    typealias V = SheetValidation
    F.setDisplayLocale(.idID)
    let shape = SheetShape(columnIds: ["ca", "cb", "cc"], rowIds: ["r1", "r2", "r3", "r4"])

    // ── Ranges
    eq(V.rangeFromA1("Sheet1!B2:B4", shape), "{cb!r2}:{cb!r4}", "sheet-qualified range")
    eq(V.rangeFromA1("c3", shape), "{cc!r3}:{cc!r3}", "single cell, lower case")
    eq(V.rangeFromA1("A:B", shape), "{ca!*}:{cb!*}", "whole columns")
    eq(V.rangeFromA1("A2:A", shape), "{ca!r2}:{ca!r4}", "open-ended range runs to the last row")
    eq(V.rangeFromA1("Z9", shape), nil, "outside the sheet")
    eq(V.rangeToA1("{cb!r2}:{cb!r4}", shape), "B2:B4", "back to A1")
    eq(V.rangeToA1("{cc!r3}:{cc!r3}", shape), "C3", "single cell")
    eq(V.rangeToA1("{ca!*}:{ca!*}", shape), "A:A", "whole column")
    eq(V.rangeRect("{ca!*}:{cb!*}", shape), V.Rect(top: 0, bottom: 3, left: 0, right: 1), "rect of whole columns")

    // ── Which rule covers a cell
    do {
        let a = V.ValidationRule(id: "a", ranges: ["{ca!*}:{ca!*}"], kind: .list, values: ["x"])
        let b = V.ValidationRule(id: "b", ranges: ["{ca!r2}:{ca!r2}"], kind: .checkbox)
        let at = V.buildRuleIndex([a, b], shape)
        eq(at(0, 0)?.id, "a", "column rule")
        eq(at(1, 0)?.id, "b", "a later rule wins where they overlap")
        eq(at(1, 1)?.id, nil, "uncovered cell")
    }

    // ── Criteria
    func val(_ v: Any?) -> SheetCellValue {
        switch F.kind(v) {
        case .number(let n): return .number(n)
        case .string(let s): return .text(s)
        case .bool(let b): return .bool(b)
        default: return .empty
        }
    }
    func ok2(_ rule: V.ValidationRule, _ raw: Any?, _ computed: Any?? = .none) -> Bool {
        let c: Any? = computed ?? raw
        return V.validateCell(rule, raw, val(c), engine: nil, shape: shape, at: (0, 0))
    }
    func R(_ kind: V.ValidationKind, _ values: [String]? = nil, multiple: Bool? = nil, checked: String? = nil, unchecked: String? = nil) -> V.ValidationRule {
        V.ValidationRule(id: "x", ranges: [], kind: kind, values: values, multiple: multiple, checked: checked, unchecked: unchecked)
    }
    eq(ok2(R(.list, ["Venue", "Talent"]), "Venue"), true, "dropdown item")
    eq(ok2(R(.list, ["Venue", "Talent"]), "Food"), false, "not on the list")
    eq(ok2(R(.list, ["Venue", "Talent"]), nil), true, "blank always passes")
    eq(ok2(R(.list, ["A", "B"], multiple: true), "A, B"), true, "multiple selections")
    eq(ok2(R(.list, ["A", "B"], multiple: true), "A, C"), false, "one bad item fails")
    eq(ok2(R(.textContains, ["rp"]), "Total Rp"), true, "text contains (case-insensitive)")
    eq(ok2(R(.textNotContains, ["x"]), "abc"), true, "text doesn't contain")
    eq(ok2(R(.textIs, ["OK"]), "ok"), false, "text is exactly")
    eq(ok2(R(.email), "budi@znetworks.id"), true, "valid email")
    eq(ok2(R(.email), "budi@"), false, "invalid email")
    eq(ok2(R(.url), "nexus.znetworks.id/x"), true, "valid url")
    eq(ok2(R(.url), "not a url"), false, "invalid url")
    eq(ok2(R(.gt, ["1.000"]), 1500), true, "greater than an Indonesian number")
    eq(ok2(R(.between, ["1", "10"]), 11), false, "between")
    eq(ok2(R(.notBetween, ["1", "10"]), 11), true, "not between")
    eq(ok2(R(.gte, ["5"]), "abc", "abc"), false, "text fails a number rule")
    eq(ok2(R(.dateAfter, ["01/10/2026"]), "2026-10-11", F.ymdToSerial(2026, 10, 11)), true, "date after (day-first criteria)")
    eq(ok2(R(.dateBefore, ["01/10/2026"]), "2026-10-11", F.ymdToSerial(2026, 10, 11)), false, "date before")
    eq(ok2(R(.dateBetween, ["1/10/2026", "31/10/2026"]), 46306), true, "date between")
    eq(ok2(R(.dateValid), "kemarin", "kemarin"), false, "not a date")
    eq(ok2(R(.checkbox), true), true, "checkbox TRUE")
    eq(ok2(R(.checkbox), "maybe"), false, "checkbox with another value")
    eq(ok2(R(.checkbox, checked: "Ya", unchecked: "Tidak"), "Ya"), true, "custom checked value")
    eq(V.isChecked(R(.checkbox, checked: "Ya"), "Ya"), true, "custom value reads as ticked")
    eq(V.checkboxValue(R(.checkbox, checked: "Ya", unchecked: "Tidak"), false) as? String, "Tidak", "untick writes the custom value")

    // Custom formula, relative to the rule's top-left.
    do {
        let data = SheetData(shape: shape, cells: ["r1": ["ca": 5], "r2": ["ca": -1], "r3": [:], "r4": [:]])
        let engine = SheetEngine(data)
        let rule = V.ValidationRule(id: "f", ranges: ["{ca!r1}:{ca!r4}"], kind: .formula, formula: F.toStored("=A1>0", shape))
        eq(V.validateCell(rule, 5, .number(5), engine: engine, shape: shape, at: (0, 0)), true, "custom formula on its first cell")
        eq(V.validateCell(rule, -1, .number(-1), engine: engine, shape: shape, at: (1, 0)), false, "custom formula shifted to the second row")
        let range = V.ValidationRule(id: "s", ranges: ["{cb!*}:{cb!*}"], kind: .listRange, source: "{ca!r1}:{ca!r2}")
        eq(V.dropdownOptions(range, engine, shape), ["5", "-1"], "dropdown from a range")
    }
    eq(V.invalidMessage(R(.gt, ["10"])), "Input must be greater than 10", "invalid message (English)")
    eq(V.isDropdown(R(.listRange)), true, "isDropdown")
    eq(V.pickedValues(["a", " b ", ""]), ["a", "b"], "pickedValues from a list")
}

func runCFTests() {
    typealias F = SheetFormula
    typealias C = SheetCF
    let shape = SheetShape(columnIds: ["ca", "cb", "cc"], rowIds: ["r1", "r2", "r3", "r4", "r5"])
    let today = F.ymdToSerial(2026, 10, 12)
    func val(_ v: Any?) -> SheetCellValue {
        switch F.kind(v) {
        case .number(let n): return .number(n)
        case .string(let s): return .text(s)
        case .bool(let b): return .bool(b)
        default: return .empty
        }
    }
    let m = { (kind: String, values: [String], v: Any?) -> Bool in
        C.matchCondition(kind, values, val(v), C.CondCtx(engine: nil, shape: shape, at: (0, 0), origin: (0, 0), today: today))
    }

    // ── Conditions
    eq(m("empty", [], nil), true, "empty: null")
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
    eq(m("lte", ["10"], nil), false, "empty never passes less-or-equal")
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

    // ── Custom formula, shifted from the rule's top-left
    let data = SheetData(shape: shape, cells: [
        "r1": ["ca": 5, "cb": "Buah"], "r2": ["ca": -1, "cb": "Sayur"], "r3": ["ca": 30, "cb": "Buah"],
        "r4": ["ca": 2], "r5": ["ca": "x"],
    ])
    let engine = SheetEngine(data)
    do {
        let formula = F.toStored("=A1>3", shape)
        let ctx = { (r: Int) in C.CondCtx(engine: engine, formula: formula, shape: shape, at: (r, 1), origin: (0, 1), today: today) }
        eq(C.matchCondition("formula", nil, .empty, ctx(0)), true, "custom formula on the first cell")
        eq(C.matchCondition("formula", nil, .empty, ctx(1)), false, "custom formula shifted one row down")
        eq(C.matchCondition("formula", nil, .empty, ctx(2)), true, "custom formula shifted two rows down")
        var noEngine = ctx(0)
        noEngine.engine = nil
        eq(C.matchCondition("formula", nil, .empty, noEngine), false, "no engine: formula never matches")
    }

    // ── Colours
    eq(C.interpolateHex("#ffffff", "#000000", 0.5), "#808080", "midway grey")
    eq(C.interpolateHex("#ffffff", "#57bb8a", 0), "#ffffff", "t=0 is the first colour")
    eq(C.interpolateHex("#ffffff", "#57bb8a", 2), "#57bb8a", "t is clamped")
    eq(C.DEFAULT_COND_STYLE, C.CondStyle(bg: "#b7e1cd"), "default style is Sheets' green")
    eq(C.COND_PRESETS.count >= 12, true, "twelve presets")
    eq(C.SCALE_PRESETS[0], C.ScalePreset(min: "#ffffff", max: "#57bb8a"), "default scale white → green")

    // ── Formatter: first matching single rule wins; scales combine
    do {
        let all = "{ca!r1}:{ca!r5}"
        let scale = C.Scale(min: C.ScalePoint(type: "min", color: "#ffffff"), max: C.ScalePoint(type: "max", color: "#000000"))
        let rules = [
            C.CondRule(id: "a", ranges: [all], type: "single", cond: "gt", values: ["10"], style: C.CondStyle(b: true, bg: "#f4c7c3")),
            C.CondRule(id: "b", ranges: [all], type: "single", cond: "notEmpty", style: C.CondStyle(bg: "#b7e1cd")),
            C.CondRule(id: "s", ranges: [all], type: "scale", scale: scale),
            C.CondRule(id: "t", ranges: ["{cb!r1}:{cb!r5}"], type: "single", cond: "textIs", values: ["buah"], style: C.CondStyle(fc: "#0b8043")),
        ]
        let fmt = C.buildCondFormatter(rules, shape, engine, today)
        eq(fmt(2, 0), C.CondStyle(b: true, bg: "#f4c7c3"), "earlier rule wins and overrides the scale fill")
        eq(fmt(0, 0), C.CondStyle(bg: "#b7e1cd"), "second rule when the first doesn't match")
        eq(fmt(4, 0), C.CondStyle(bg: "#b7e1cd"), "text gets the single rule but no scale colour")
        eq(fmt(0, 1), C.CondStyle(fc: "#0b8043"), "text rule on another column")
        eq(fmt(1, 1), nil, "no rule matches")
        eq(fmt(0, 2), nil, "outside every range")
        let scaleOnly = C.buildCondFormatter([rules[2]], shape, engine, today)
        eq(scaleOnly(1, 0), C.CondStyle(bg: "#ffffff"), "minimum gets the min colour")
        eq(scaleOnly(2, 0), C.CondStyle(bg: "#000000"), "maximum gets the max colour")
        eq(scaleOnly(3, 0)?.bg, C.interpolateHex("#ffffff", "#000000", 3 / 31.0), "between is interpolated")
        eq(scaleOnly(4, 0), nil, "non-numbers get nothing")
        var withMidRule = rules[2]
        withMidRule.scale = C.Scale(min: C.ScalePoint(type: "num", value: "0", color: "#ff0000"),
                                    mid: C.ScalePoint(type: "num", value: "5", color: "#ffffff"),
                                    max: C.ScalePoint(type: "num", value: "10", color: "#00ff00"))
        let withMid = C.buildCondFormatter([withMidRule], shape, engine, today)
        eq(withMid(0, 0)?.bg, "#ffffff", "value at the midpoint gets the mid colour")
        eq(withMid(2, 0)?.bg, "#00ff00", "above the max point")
        eq(withMid(3, 0)?.bg, C.interpolateHex("#ff0000", "#ffffff", 2 / 5.0), "below the midpoint blends min → mid")
        eq(C.scalePointValue(C.ScalePoint(type: "pctile", value: "50", color: "#fff"), [1, 2, 3, 4]), 2.5, "percentile interpolates")
    }
}
