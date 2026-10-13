// Conditional formatting for the spreadsheet — port of sheet-cf.ts. `matchCondition` judges a
// "Format cells if…" condition (the filter's "by condition" uses it too); `buildCondFormatter`
// turns a sheet's rules into "what extra style does this cell get": the FIRST matching single-colour
// rule wins, a colour scale paints the fill, and the single rule's fields win over the scale.
import Foundation

enum SheetCF {
    typealias F = SheetFormula

    /// The look a matching rule gives a cell (Sheets: bold, italic, underline, strike, text, fill).
    struct CondStyle: Equatable {
        var b = false
        var i = false
        var u = false
        var s = false
        var fc: String? = nil
        var bg: String? = nil

        init(b: Bool = false, i: Bool = false, u: Bool = false, s: Bool = false, fc: String? = nil, bg: String? = nil) {
            self.b = b; self.i = i; self.u = u; self.s = s; self.fc = fc; self.bg = bg
        }
        init(json: [String: Any]) {
            b = F.jsTruthy(json["b"]); i = F.jsTruthy(json["i"]); u = F.jsTruthy(json["u"]); s = F.jsTruthy(json["s"])
            fc = json["fc"] as? String
            bg = json["bg"] as? String
        }
        var json: [String: Any] {
            var o: [String: Any] = [:]
            if b { o["b"] = 1 }
            if i { o["i"] = 1 }
            if u { o["u"] = 1 }
            if s { o["s"] = 1 }
            if let fc = fc { o["fc"] = fc }
            if let bg = bg { o["bg"] = bg }
            return o
        }
        /// `{...base, ...self}`: fields this style sets win.
        func over(_ base: CondStyle) -> CondStyle {
            CondStyle(b: b || base.b, i: i || base.i, u: u || base.u, s: s || base.s, fc: fc ?? base.fc, bg: bg ?? base.bg)
        }
    }

    struct ScalePoint: Equatable {
        /// "min" | "max" | "num" | "pct" | "pctile" | "none"
        var type: String
        var value: String? = nil
        var color: String
        init(type: String, value: String? = nil, color: String) { self.type = type; self.value = value; self.color = color }
        init?(json: [String: Any]?) {
            guard let j = json, let t = j["type"] as? String else { return nil }
            type = t
            if let s = j["value"] as? String { value = s } else if case .number(let n) = F.kind(j["value"]) { value = SheetJS.numberToString(n) }
            color = j["color"] as? String ?? "#ffffff"
        }
        var json: [String: Any] {
            var o: [String: Any] = ["type": type, "color": color]
            if let v = value { o["value"] = v }
            return o
        }
    }

    struct Scale: Equatable {
        var min: ScalePoint
        var mid: ScalePoint? = nil
        var max: ScalePoint
    }

    struct CondRule {
        var id: String
        var ranges: [String]
        /// "single" | "scale"
        var type: String
        var cond: String? = nil
        var values: [String]? = nil
        var formula: String? = nil
        var style: CondStyle? = nil
        var scale: Scale? = nil

        init(id: String, ranges: [String], type: String, cond: String? = nil, values: [String]? = nil, formula: String? = nil,
             style: CondStyle? = nil, scale: Scale? = nil) {
            self.id = id; self.ranges = ranges; self.type = type; self.cond = cond; self.values = values
            self.formula = formula; self.style = style; self.scale = scale
        }

        /// From the settings JSON (ProjectSheet.settings.condFormats[]).
        init?(json: [String: Any]) {
            guard let t = json["type"] as? String else { return nil }
            id = json["id"] as? String ?? ""
            ranges = json["ranges"] as? [String] ?? []
            type = t
            cond = json["cond"] as? String
            values = json["values"] as? [String]
            formula = json["formula"] as? String
            style = (json["style"] as? [String: Any]).map { CondStyle(json: $0) }
            if let sc = json["scale"] as? [String: Any], let mn = ScalePoint(json: sc["min"] as? [String: Any]), let mx = ScalePoint(json: sc["max"] as? [String: Any]) {
                scale = Scale(min: mn, mid: ScalePoint(json: sc["mid"] as? [String: Any]), max: mx)
            }
        }

        var json: [String: Any] {
            var o: [String: Any] = ["id": id, "ranges": ranges, "type": type]
            if let v = cond { o["cond"] = v }
            if let v = values { o["values"] = v }
            if let v = formula { o["formula"] = v }
            if let v = style { o["style"] = v.json }
            if let sc = scale {
                var s: [String: Any] = ["min": sc.min.json, "max": sc.max.json]
                if let m = sc.mid { s["mid"] = m.json }
                o["scale"] = s
            }
            return o
        }
    }

    struct CondCtx {
        var engine: SheetEngine?
        /// Custom formula (stored form), written for `origin`.
        var formula: String? = nil
        var shape: SheetShape
        /// The cell being judged and the rule's top-left cell (raw row / column indices).
        var at: (r: Int, c: Int)
        var origin: (r: Int, c: Int)
        /// Today's serial (tests); defaults to today in Asia/Jakarta.
        var today: Double? = nil
    }

    static let DEFAULT_COND_STYLE = CondStyle(bg: "#b7e1cd")
    static let COND_PRESETS: [CondStyle] = [
        CondStyle(fc: "#000000", bg: "#b7e1cd"), CondStyle(fc: "#000000", bg: "#fce8b2"), CondStyle(fc: "#000000", bg: "#f4c7c3"),
        CondStyle(fc: "#000000", bg: "#c9daf8"), CondStyle(fc: "#000000", bg: "#d9d2e9"), CondStyle(fc: "#000000", bg: "#efefef"),
        CondStyle(fc: "#0b8043", bg: "#b7e1cd"), CondStyle(fc: "#b45f06", bg: "#fce8b2"), CondStyle(fc: "#a50e0e", bg: "#f4c7c3"),
        CondStyle(fc: "#ffffff", bg: "#57bb8a"), CondStyle(fc: "#ffffff", bg: "#e67c73"), CondStyle(fc: "#ffffff", bg: "#4285f4"),
    ]

    struct ScalePreset: Equatable { var min: String; var mid: String? = nil; var max: String }
    static let SCALE_PRESETS: [ScalePreset] = [
        ScalePreset(min: "#ffffff", max: "#57bb8a"), ScalePreset(min: "#57bb8a", max: "#ffffff"),
        ScalePreset(min: "#ffffff", max: "#e67c73"), ScalePreset(min: "#e67c73", max: "#ffffff"),
        ScalePreset(min: "#ffffff", max: "#7baaf7"), ScalePreset(min: "#ffffff", max: "#ffd666"),
        ScalePreset(min: "#e67c73", mid: "#ffd666", max: "#57bb8a"), ScalePreset(min: "#57bb8a", mid: "#ffd666", max: "#e67c73"),
        ScalePreset(min: "#e67c73", mid: "#ffffff", max: "#57bb8a"), ScalePreset(min: "#57bb8a", mid: "#ffffff", max: "#e67c73"),
    ]

    static let COND_KINDS = ["empty", "notEmpty", "textContains", "textNotContains", "textStarts", "textEnds", "textIs",
                             "dateIs", "dateBefore", "dateAfter", "gt", "gte", "lt", "lte", "eq", "neq", "between", "notBetween", "formula"]
    static let COND_ONE_VALUE = ["textContains", "textNotContains", "textStarts", "textEnds", "textIs", "dateIs", "dateBefore", "dateAfter", "gt", "gte", "lt", "lte", "eq", "neq"]
    static let COND_TWO_VALUES = ["between", "notBetween"]
    static let DATE_KEYWORDS = ["today", "tomorrow", "yesterday", "week", "month", "year", "exact"]

    static func hex2(_ n: Double) -> String {
        let v = Int(Swift.max(0, Swift.min(255, SheetJS.round(n))))
        return String(format: "%02x", v)
    }
    static func rgb(_ h: String) -> [Double] {
        let s = SheetJS.match(SheetJS.re("^#?([0-9a-f]{6})\\z", true), SheetJS.trim(h))?[1] ?? "ffffff"
        let u = Array(s)
        return [0, 2, 4].map { Double(Int(String(u[$0...($0 + 1)]), radix: 16) ?? 255) }
    }
    /// Linear blend of two "#rrggbb" colours; t is clamped to 0…1.
    static func interpolateHex(_ a: String, _ b: String, _ t: Double) -> String {
        let k = Swift.max(0, Swift.min(1, t.isFinite ? t : 0))
        let x = rgb(a), y = rgb(b)
        var out = "#"
        for i in 0..<3 { out += hex2(x[i] + (y[i] - x[i]) * k) }
        return out
    }

    static func textOf(_ v: SheetCellValue) -> String { SheetValidation.textOf(v) }
    static func numOf(_ v: SheetCellValue) -> Double? {
        switch v {
        case .number(let n): return n
        case .text(let s): return F.parseLocaleNumber(s)?.n
        default: return nil
        }
    }
    static func numOf(_ s: String) -> Double? { F.parseLocaleNumber(s)?.n }
    static func serialOf(_ v: SheetCellValue) -> Double? {
        switch v {
        case .number(let n): return n.rounded(.down)
        case .text(let s): return F.isoToSerial(SheetJS.trim(s)) ?? F.parseDateText(s)
        default: return nil
        }
    }
    static func truthy(_ out: SheetCellValue) -> Bool {
        if F.isError(out) { return false }
        switch out {
        case .bool(let b): return b
        case .number(let n): return n != 0
        case .text(let s): return s.uppercased() == "TRUE"
        case .empty: return false
        }
    }

    /// Evaluate a stored formula written for `origin`, shifted to `at`.
    static func evalShifted(_ stored: String, _ ctx: CondCtx) -> SheetCellValue {
        guard let engine = ctx.engine else { return .empty }
        let shifted = F.toStored(F.shiftFormula(F.toDisplay(stored, ctx.shape), ctx.at.r - ctx.origin.r, ctx.at.c - ctx.origin.c), ctx.shape)
        let rowId: String? = ctx.at.r >= 0 && ctx.at.r < ctx.shape.rowIds.count ? ctx.shape.rowIds[ctx.at.r] : nil
        return engine.evaluateFormula(shifted, rowId)
    }

    /// A criteria value: "=…" is evaluated (shifted like a custom formula) when an engine is there.
    static func criterion(_ raw: String?, _ ctx: CondCtx?) -> String {
        let s = raw ?? ""
        if let c = ctx, c.engine != nil, SheetJS.trim(s).hasPrefix("=") {
            return textOf(evalShifted(F.toStored(SheetJS.trim(s), c.shape), c))
        }
        return s
    }

    static func minusMonths(_ serial: Double, _ months: Double) -> Double {
        let p = F.serialToYmdD(serial)
        let total = p.y * 12 + (p.m - 1) - months
        let ny = (total / 12).rounded(.down), nm = total.truncatingRemainder(dividingBy: 12) + 1
        let last = SheetDate.parts(SheetDate.utc(ny, nm, 0)).d
        return F.ymdToSerial(ny, nm, Swift.min(p.d, last))
    }

    /// A date criterion as an inclusive [from, to] serial span, or nil when unreadable.
    static func dateSpan(_ values: [String]?, _ today: Double) -> (Double, Double)? {
        let k = SheetJS.trim(values?.first ?? "").lowercased()
        switch k {
        case "today", "hari ini": return (today, today)
        case "tomorrow", "besok": return (today + 1, today + 1)
        case "yesterday", "kemarin": return (today - 1, today - 1)
        case "week": return (today - 7, today)
        case "month": return (minusMonths(today, 1), today)
        case "year": return (minusMonths(today, 12), today)
        case "exact":
            let v: SheetCellValue = (values?.count ?? 0) > 1 ? .text(values![1]) : .empty
            guard let d = serialOf(v) else { return nil }
            return (d, d)
        default:
            let v: SheetCellValue = values?.first.map { .text($0) } ?? .empty
            guard let d = serialOf(v) else { return nil }
            return (d, d)
        }
    }

    /// Does a value meet a condition? (Text ignores case; numbers read numeric text; dates take
    /// today / tomorrow / yesterday / week / month / year or an exact date.)
    static func matchCondition(_ kind: String, _ values: [String]?, _ v: SheetCellValue, _ ctx: CondCtx? = nil) -> Bool {
        if F.isError(v) && kind != "notEmpty" && kind != "formula" { return false }
        let text = textOf(v)
        let crit = { (i: Int) -> String in criterion((values?.count ?? 0) > i ? values![i] : nil, ctx) }
        switch kind {
        case "empty": return text.isEmpty
        case "notEmpty": return !text.isEmpty
        case "textContains": let c = crit(0).lowercased(); return c.isEmpty || text.lowercased().contains(c)
        case "textNotContains": let c = crit(0).lowercased(); return !(c.isEmpty || text.lowercased().contains(c))
        case "textStarts": return text.lowercased().hasPrefix(crit(0).lowercased())
        case "textEnds": return text.lowercased().hasSuffix(crit(0).lowercased())
        case "textIs": return text.lowercased() == crit(0).lowercased()
        case "dateIs", "dateBefore", "dateAfter":
            if text.isEmpty { return false }
            let d = serialOf(v)
            let first = values?.first.map { SheetJS.trim($0).hasPrefix("=") } ?? false
            let span = dateSpan(first ? [crit(0)] : values, ctx?.today ?? F.todaySerial())
            guard let dd = d, let sp = span else { return false }
            if kind == "dateIs" { return dd >= sp.0 && dd <= sp.1 }
            if kind == "dateBefore" { return dd < sp.0 }
            return dd > sp.1
        case "gt", "gte", "lt", "lte", "eq", "neq", "between", "notBetween":
            let a = numOf(crit(0))
            let b = COND_TWO_VALUES.contains(kind) ? numOf(crit(1)) : nil
            let n = text.isEmpty ? nil : numOf(v)
            if kind == "eq" || kind == "neq" {
                let same: Bool
                if let x = n, let y = a { same = x == y } else { same = text.lowercased() == SheetJS.trim(crit(0)).lowercased() }
                return kind == "eq" ? same : !same
            }
            guard let x = n, let y = a else { return false }
            switch kind {
            case "gt": return x > y
            case "gte": return x >= y
            case "lt": return x < y
            case "lte": return x <= y
            case "between":
                guard let z = b else { return false }
                return x >= Swift.min(y, z) && x <= Swift.max(y, z)
            default:
                guard let z = b else { return false }
                return x < Swift.min(y, z) || x > Swift.max(y, z)
            }
        case "formula":
            guard let c = ctx, let f = c.formula, !f.isEmpty, c.engine != nil else { return false }
            return truthy(evalShifted(f, c))
        default: return false
        }
    }

    typealias Rect = SheetValidation.Rect

    /// The rectangles of a rule's ranges (unreadable ranges dropped).
    static func condRects(_ ranges: [String], _ shape: SheetShape) -> [Rect] {
        ranges.compactMap { SheetValidation.rangeRect($0, shape) }
    }
    static func inRects(_ rects: [Rect], _ r: Int, _ c: Int) -> Bool {
        rects.contains { r >= $0.top && r <= $0.bottom && c >= $0.left && c <= $0.right }
    }

    /// PERCENTILE.INC over sorted numbers.
    static func percentile(_ sorted: [Double], _ p: Double) -> Double {
        if sorted.isEmpty { return 0 }
        let k = Swift.max(0, Swift.min(1, p)) * Double(sorted.count - 1)
        let lo = Int(k.rounded(.down)), hi = Int(k.rounded(.up))
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - Double(lo))
    }

    /// A scale point's threshold over the range's numbers; nil when it can't be read.
    static func scalePointValue(_ p: ScalePoint, _ sorted: [Double]) -> Double? {
        guard let min = sorted.first, let max = sorted.last else { return nil }
        let x: Double? = (p.value ?? "").isEmpty ? nil : F.parseLocaleNumber(p.value!)?.n
        switch p.type {
        case "min": return min
        case "max": return max
        case "num": return x
        case "pct": return x.map { min + ((max - min) * $0) / 100 }
        case "pctile": return x.map { percentile(sorted, $0 / 100) }
        default: return nil
        }
    }

    /// The fill a colour scale gives a number, given the range's sorted numbers.
    static func scaleColor(_ scale: Scale, _ n: Double, _ sorted: [Double]) -> String? {
        guard let lo = scalePointValue(scale.min, sorted), let hi = scalePointValue(scale.max, sorted) else { return nil }
        var mid: Double? = nil
        if let m = scale.mid, m.type != "none" { mid = scalePointValue(m, sorted) }
        if hi <= lo { return n <= lo ? scale.min.color : scale.max.color }
        if n <= lo { return scale.min.color }
        if n >= hi { return scale.max.color }
        if let md = mid, let mp = scale.mid, md > lo && md < hi {
            return n <= md
                ? interpolateHex(scale.min.color, mp.color, (n - lo) / (md - lo))
                : interpolateHex(mp.color, scale.max.color, (n - md) / (hi - md))
        }
        return interpolateHex(scale.min.color, scale.max.color, (n - lo) / (hi - lo))
    }

    /// The sheet's rules as a per-cell lookup (nil when no rule styles the cell).
    static func buildCondFormatter(_ rules: [CondRule], _ shape: SheetShape, _ engine: SheetEngine?, _ today: Double? = nil) -> (Int, Int) -> CondStyle? {
        final class Prepared {
            let rule: CondRule
            let rects: [Rect]
            let origin: (r: Int, c: Int)
            var sorted: [Double]?
            init(_ rule: CondRule, _ rects: [Rect]) {
                self.rule = rule
                self.rects = rects
                origin = rects.first.map { ($0.top, $0.left) } ?? (0, 0)
            }
        }
        let prepared = rules.map { Prepared($0, condRects($0.ranges, shape)) }
        if !prepared.contains(where: { !$0.rects.isEmpty }) { return { _, _ in nil } }
        func valueAt(_ r: Int, _ c: Int) -> SheetCellValue {
            guard let e = engine, r >= 0, r < shape.rowIds.count, c >= 0, c < shape.columnIds.count else { return .empty }
            return e.value(shape.rowIds[r], shape.columnIds[c])
        }
        func numbersOf(_ rects: [Rect]) -> [Double] {
            var out: [Double] = []
            for rc in rects {
                var r = rc.top
                while r <= Swift.min(rc.bottom, rc.top + 20000) {
                    for c in rc.left...rc.right {
                        if case .number(let n) = valueAt(r, c), n.isFinite { out.append(n) }
                    }
                    r += 1
                }
            }
            return out.sorted()
        }
        return { rawRow, col in
            var single: CondStyle? = nil
            var scaled: CondStyle? = nil
            var value: SheetCellValue? = nil
            for p in prepared {
                if single != nil && scaled != nil { break }
                if !inRects(p.rects, rawRow, col) { continue }
                if value == nil { value = valueAt(rawRow, col) }
                if p.rule.type == "scale" {
                    guard scaled == nil, let scale = p.rule.scale, case .number(let n)? = value else { continue }
                    if p.sorted == nil { p.sorted = numbersOf(p.rects) }
                    if let bg = scaleColor(scale, n, p.sorted!) { scaled = CondStyle(bg: bg) }
                } else if single == nil, let cond = p.rule.cond {
                    let ctx = CondCtx(engine: engine, formula: p.rule.formula, shape: shape, at: (rawRow, col), origin: p.origin, today: today)
                    if matchCondition(cond, p.rule.values, value ?? .empty, ctx) { single = p.rule.style ?? DEFAULT_COND_STYLE }
                }
            }
            if single == nil && scaled == nil { return nil }
            return (single ?? CondStyle()).over(scaled ?? CondStyle())
        }
    }

    static func newCondId() -> String { SheetValidation.randomId("cf_") }
}
