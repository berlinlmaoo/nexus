// The functions sheet-formula.ts delegates to @formulajs/formulajs (MIT), reimplemented from
// formula.js 4.6.1 with its JavaScript semantics (argument coercion, quirks and all), so a sheet
// evaluates to the same values on the phone as on the web/server. Values cross this boundary as
// `SheetJSValue` (a small model of the JS values formula.js sees). Dates are JS time values in ms,
// local time == UTC (the server's zone; Jakarta has no DST, so the browser agrees).
import Foundation

indirect enum SheetJSValue {
    case undefined
    case null
    case bool(Bool)
    case num(Double)
    case str(String)
    case arr([SheetJSValue])
    case date(Double)
    case err(String)

    var isArr: Bool { if case .arr = self { return true }; return false }
    var isErr: Bool { if case .err = self { return true }; return false }
    var isDefined: Bool {
        switch self {
        case .undefined, .null: return false
        default: return true
        }
    }
}

/// A JavaScript TypeError/RangeError inside a formula.js function (the engine turns it into #VALUE!).
struct SheetJSThrow: Error {}

enum SheetFormulaLib {
    typealias V = SheetJSValue

    static let nilE = V.err("#NULL!"), div0 = V.err("#DIV/0!"), value = V.err("#VALUE!"), ref = V.err("#REF!")
    static let name = V.err("#NAME?"), num = V.err("#NUM!"), na = V.err("#N/A"), error = V.err("#ERROR!")

    /// Excel name -> formula.js function (the allow-list of sheet-formula.ts FORMULAJS).
    static let NAMES: Set<String> = [
        "INDEX", "MATCH", "SUMPRODUCT", "EOMONTH", "EDATE", "NETWORKDAYS", "NETWORKDAYS.INTL", "WORKDAY", "WORKDAY.INTL",
        "WEEKDAY", "WEEKNUM", "ISOWEEKNUM", "YEARFRAC", "DAYS", "DAYS360", "CHOOSE", "SWITCH", "XOR",
        "PROPER", "REPT", "EXACT", "SEARCH", "REPLACE", "TEXTJOIN", "CHAR", "CODE", "CLEAN",
        "CEILING", "FLOOR", "MROUND", "TRUNC", "SIGN", "PI", "EXP", "LN", "LOG", "LOG10",
        "RAND", "RANDBETWEEN", "ISEVEN", "ISODD",
        "STDEV", "STDEV.S", "STDEVP", "STDEV.P", "VAR", "VAR.S", "VARP", "VAR.P",
        "LARGE", "SMALL", "RANK", "RANK.EQ", "PERCENTILE", "PERCENTILE.INC", "QUARTILE", "QUARTILE.INC", "MODE",
        "PMT", "FV", "PV", "NPV", "IRR", "RATE", "NPER", "IPMT", "PPMT",
    ]
    static func has(_ fn: String) -> Bool { NAMES.contains(fn) }

    /// Which argument positions are dates, per function: passed as local Date objects.
    static let DATE_ARGS: [String: [Int]] = [
        "EOMONTH": [0], "EDATE": [0], "NETWORKDAYS": [0, 1, 2], "NETWORKDAYS.INTL": [0, 1, 3], "WORKDAY": [0, 2],
        "WORKDAY.INTL": [0, 3], "WEEKDAY": [0], "WEEKNUM": [0], "ISOWEEKNUM": [0], "YEARFRAC": [0, 1], "DAYS": [0, 1], "DAYS360": [0, 1],
    ]

    // MARK: - Engine <-> JS dates

    static func serialToLocalDate(_ s: Double) -> Double {
        let p = SheetFormula.serialToYmdD(s)
        let frac = s - s.rounded(.down)
        return SheetDate.local(p.y, p.m - 1, p.d, 0, 0, SheetJS.round(frac * 86_400))
    }

    static func localDateToSerial(_ t: Double) -> Double {
        let p = SheetDate.parts(t)
        let base = SheetFormula.ymdToSerial(p.y, p.m + 1, p.d)
        let secs = p.h * 3600 + p.mi * 60 + p.s
        return secs != 0 ? base + secs / 86_400 : base
    }

    static func fromFormulajs(_ out: V) -> SheetCellValue {
        switch out {
        case .err(let m): return .text(SheetFormula.ERROR_TEXTS.contains(m) ? m : SheetFormula.ERR.value)
        case .date(let t): return t.isNaN ? .text(SheetFormula.ERR.value) : .number(localDateToSerial(t))
        case .arr(let a):
            guard let first = a.first else { return .empty }
            if case .arr(let inner) = first { return fromFormulajs(inner.first ?? .undefined) }
            return fromFormulajs(first)
        case .undefined, .null: return .empty
        case .num(let n): return n.isFinite ? .number(n) : .text(SheetFormula.ERR.num)
        case .str(let s): return .text(s)
        case .bool(let b): return .bool(b)
        }
    }

    // MARK: - JS semantics

    static func toNumber(_ v: V) -> Double {
        switch v {
        case .undefined: return .nan
        case .null: return 0
        case .bool(let b): return b ? 1 : 0
        case .num(let n): return n
        case .str(let s): return SheetJS.stringToNumber(s)
        case .arr: return SheetJS.stringToNumber(toString(v))
        case .date(let t): return t
        case .err: return .nan
        }
    }

    static func toString(_ v: V) -> String {
        switch v {
        case .undefined: return "undefined"
        case .null: return "null"
        case .bool(let b): return b ? "true" : "false"
        case .num(let n): return SheetJS.numberToString(n)
        case .str(let s): return s
        case .arr(let a):
            return a.map { e -> String in
                switch e {
                case .undefined, .null: return ""
                default: return toString(e)
                }
            }.joined(separator: ",")
        case .date(let t): return t.isNaN ? "Invalid Date" : "Date(\(SheetJS.numberToString(t)))"
        case .err(let m): return "Error: \(m)"
        }
    }

    static func truthy(_ v: V) -> Bool {
        switch v {
        case .undefined, .null: return false
        case .bool(let b): return b
        case .num(let n): return n != 0 && !n.isNaN
        case .str(let s): return !s.isEmpty
        default: return true
        }
    }

    static func isNaNjs(_ v: V) -> Bool { toNumber(v).isNaN }

    /// ToPrimitive with hint number.
    private static func primitive(_ v: V) -> V {
        switch v {
        case .arr, .err: return .str(toString(v))
        case .date(let t): return .num(t)
        default: return v
        }
    }

    /// Abstract relational comparison a < b (undefined result -> nil).
    static func lessRaw(_ a: V, _ b: V) -> Bool? {
        let pa = primitive(a), pb = primitive(b)
        if case .str(let x) = pa, case .str(let y) = pb {
            return Array(x.utf16).lexicographicallyPrecedes(Array(y.utf16))
        }
        let x = toNumber(pa), y = toNumber(pb)
        if x.isNaN || y.isNaN { return nil }
        return x < y
    }
    static func lt(_ a: V, _ b: V) -> Bool { lessRaw(a, b) ?? false }
    static func gt(_ a: V, _ b: V) -> Bool { lessRaw(b, a) ?? false }
    static func le(_ a: V, _ b: V) -> Bool { lessRaw(b, a).map { !$0 } ?? false }
    static func ge(_ a: V, _ b: V) -> Bool { lessRaw(a, b).map { !$0 } ?? false }

    static func strictEq(_ a: V, _ b: V) -> Bool {
        switch (a, b) {
        case (.undefined, .undefined), (.null, .null): return true
        case (.bool(let x), .bool(let y)): return x == y
        case (.num(let x), .num(let y)): return x == y
        case (.str(let x), .str(let y)): return x == y
        default: return false
        }
    }

    /// a + b.
    static func add(_ a: V, _ b: V) -> V {
        let pa = primitive(a), pb = primitive(b)
        if case .str = pa { return .str(toString(pa) + toString(pb)) }
        if case .str = pb { return .str(toString(pa) + toString(pb)) }
        return .num(toNumber(pa) + toNumber(pb))
    }

    /// v[i] for a numeric index (TypeError on null/undefined).
    static func at(_ v: V, _ i: Double) throws -> V {
        switch v {
        case .undefined, .null: throw SheetJSThrow()
        case .arr(let a):
            guard i.isFinite, i >= 0, i == i.rounded(.down), i < Double(a.count) else { return .undefined }
            return a[Int(i)]
        case .str(let s):
            let u = SheetJS.u16(s)
            guard i.isFinite, i >= 0, i == i.rounded(.down), i < Double(u.count) else { return .undefined }
            return .str(SheetJS.str([u[Int(i)]]))
        default: return .undefined
        }
    }

    /// v.length (TypeError on null/undefined).
    static func length(_ v: V) throws -> V {
        switch v {
        case .undefined, .null: throw SheetJSThrow()
        case .arr(let a): return .num(Double(a.count))
        case .str(let s): return .num(Double(s.utf16.count))
        default: return .undefined
        }
    }

    /// table[key] with a JS property key; nil = undefined.
    static func lookup<T>(_ table: [T?], _ key: V) -> T?? {
        let k = toString(key)
        let d = SheetJS.stringToNumber(k)
        guard SheetJS.numberToString(d) == k, d >= 0, d < Double(table.count), d == d.rounded(.down) else { return nil }
        return .some(table[Int(d)])
    }

    static func arg(_ a: [V], _ i: Int) -> V { i < a.count ? a[i] : .undefined }

    // MARK: - formula.js utils

    static func flatten(_ args: [V]) -> [V] {
        var result: [V]
        if args.count == 1 {
            if case .arr(let a) = args[0] { result = a } else { result = [args[0]] }
        } else {
            result = args
        }
        var out: [V] = []
        func walk(_ x: V) {
            if case .arr(let a) = x { a.forEach(walk) } else { out.append(x) }
        }
        result.forEach(walk)
        return out
    }

    static func numbers(_ args: [V]) -> [Double] {
        flatten(args).compactMap { if case .num(let n) = $0 { return n }; return nil }
    }

    static func parseNumber(_ v: V) -> V {
        switch v {
        case .err: return v
        case .undefined, .null: return .num(0)
        case .bool(let b): return .num(b ? 1 : 0)
        default: break
        }
        if case .str(let s) = v, s.isEmpty { return value }
        if !isNaNjs(v) { return .num(SheetJS.parseFloat(toString(v))) }
        return value
    }

    static func parseNumberArray(_ arr: [V]) -> V {
        if arr.isEmpty { return value }
        var out = arr
        var i = arr.count - 1
        while i >= 0 {
            if case .err = arr[i] { return arr[i] }
            let p = parseNumber(arr[i])
            if case .err = p { return p }
            out[i] = p
            i -= 1
        }
        return .arr(out)
    }

    static func parseString(_ v: V) -> V {
        switch v {
        case .err: return v
        case .undefined, .null: return .str("")
        default: return .str(toString(v))
        }
    }

    static func parseBool(_ v: V) -> V {
        switch v {
        case .bool, .err: return v
        case .num(let n): return .bool(n != 0)
        case .str(let s):
            let up = s.uppercased()
            if up == "TRUE" { return .bool(true) }
            if up == "FALSE" { return .bool(false) }
        case .date(let t): if !t.isNaN { return .bool(true) }
        default: break
        }
        return value
    }

    /// formula.js serialToDate (with the 1900 leap-year bug).
    static func serialToDate(_ serial0: Double) -> Double {
        var serial = serial0
        if serial < 60 { serial += 1 }
        let utcDays = (serial - 25569).rounded(.down)
        let dateInfo = SheetDate.timeClip(utcDays * 86400 * 1000)
        let fractional = serial - serial.rounded(.down) + 0.0000001
        var totalSeconds = (86400 * fractional).rounded(.down)
        let seconds = totalSeconds.truncatingRemainder(dividingBy: 60)
        totalSeconds -= seconds
        let hours = (totalSeconds / 3600).rounded(.down)
        let minutes = (totalSeconds / 60).rounded(.down).truncatingRemainder(dividingBy: 60)
        let p = SheetDate.parts(dateInfo)
        var days = p.d, month = p.m
        if serial >= 60 && serial < 61 { days = 29; month = 1 }
        return SheetDate.local(p.y, month, days, hours, minutes, seconds)
    }

    static func dateToSerial(_ t: Double) -> Double {
        let d1900 = SheetDate.local(1900, 0, 1)
        let addOn: Double = t > -22038912e5 ? 2 : 1
        return ((t - d1900) / 86_400_000).rounded(.up) + addOn
    }

    static func parseDate(_ v: V) -> V {
        if !isNaNjs(v) {
            if case .date = v { return v }
            let d = SheetJS.parseFloat(toString(v))
            if d < 0 || d >= 2958466 { return num }
            return .date(serialToDate(d))
        }
        if case .str(let s) = v {
            // Only an exact ISO day parses here (numberFromText already took every other date form).
            if let m = SheetJS.match(SheetJS.re("^([0-9]{4})-([0-9]{2})-([0-9]{2})\\z"), s) {
                let y = Double(m[1]!)!, mo = Double(m[2]!)!, d = Double(m[3]!)!
                if mo >= 1 && mo <= 12 && d >= 1 && d <= SheetFormula.daysIn(y, mo) {
                    return .date(SheetDate.timeClip(SheetDate.makeDay(y, mo - 1, d) * 86_400_000))
                }
            }
        }
        return value
    }

    static func firstErr(_ vs: V...) -> V? { vs.first { $0.isErr } }

    // MARK: - Dispatch

    static func call(_ fn: String, _ a: [V]) throws -> V {
        switch fn {
        case "INDEX": return try INDEX(arg(a, 0), arg(a, 1), arg(a, 2))
        case "MATCH": return try MATCH(a)
        case "SUMPRODUCT": return try SUMPRODUCT(a)
        case "EOMONTH": return EOMONTH(arg(a, 0), arg(a, 1))
        case "EDATE": return EDATE(arg(a, 0), arg(a, 1))
        case "NETWORKDAYS": return try NETWORKDAYSINTL(arg(a, 0), arg(a, 1), .num(1), arg(a, 2))
        case "NETWORKDAYS.INTL": return try NETWORKDAYSINTL(arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3))
        case "WORKDAY": return try WORKDAYINTL(arg(a, 0), arg(a, 1), .num(1), arg(a, 2))
        case "WORKDAY.INTL": return try WORKDAYINTL(arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3))
        case "WEEKDAY": return try WEEKDAY(arg(a, 0), arg(a, 1))
        case "WEEKNUM": return WEEKNUM(arg(a, 0), arg(a, 1))
        case "ISOWEEKNUM": return ISOWEEKNUM(arg(a, 0))
        case "YEARFRAC": return YEARFRAC(arg(a, 0), arg(a, 1), arg(a, 2))
        case "DAYS": return DAYS(arg(a, 0), arg(a, 1))
        case "DAYS360": return DAYS360(arg(a, 0), arg(a, 1), arg(a, 2))
        case "CHOOSE": return CHOOSE(a)
        case "SWITCH": return SWITCH(a)
        case "XOR": return XOR(a)
        default: return try callText(fn, a)
        }
    }

    private static func callText(_ fn: String, _ a: [V]) throws -> V {
        switch fn {
        case "PROPER": return PROPER(arg(a, 0))
        case "REPT": return try REPT(arg(a, 0), arg(a, 1))
        case "EXACT":
            if a.count != 2 { return na }
            if let e = firstErr(a[0], a[1]) { return e }
            return .bool(toString(parseString(a[0])) == toString(parseString(a[1])))
        case "SEARCH": return SEARCH(arg(a, 0), arg(a, 1), arg(a, 2))
        case "REPLACE": return REPLACE(arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3))
        case "TEXTJOIN": return TEXTJOIN(a)
        case "CHAR":
            let n = parseNumber(arg(a, 0))
            if case .num(let x) = n, x == 0 { return value }
            if n.isErr { return n }
            return .str(SheetJS.str([SheetJS.toUint16(toNumber(n))]))
        case "CODE":
            let t = arg(a, 0)
            if t.isErr { return t }
            let text: V = truthy(t) ? t : .str("")
            guard case .str(let s) = text else { throw SheetJSThrow() }
            guard let u = s.utf16.first else { return value }
            return .num(Double(u))
        case "CLEAN":
            let t = arg(a, 0)
            if t.isErr { return t }
            let text: V = truthy(t) ? t : .str("")
            guard case .str(let s) = text else { throw SheetJSThrow() }
            return .str(String(String.UnicodeScalarView(s.unicodeScalars.filter { $0.value > 0x1F })))
        default: return try callMath(fn, a)
        }
    }

    private static func num2(_ a: V, _ b: V) -> (Double, Double)? {
        guard case .num(let x) = a, case .num(let y) = b else { return nil }
        return (x, y)
    }

    private static func callMath(_ fn: String, _ a: [V]) throws -> V {
        switch fn {
        case "CEILING":
            let n = parseNumber(arg(a, 0)), s = parseNumber(arg(a, 1))
            if let e = firstErr(n, s) { return e }
            let (x, y) = num2(n, s)!
            if y == 0 { return .num(0) }
            if x > 0 && y < 0 { return num }
            return .num((x / y).rounded(.up) * y)
        case "FLOOR":
            let n = parseNumber(arg(a, 0)), s = parseNumber(arg(a, 1))
            if let e = firstErr(n, s) { return e }
            let (x, y) = num2(n, s)!
            if y == 0 || y.isNaN { return div0 }
            if x > 0 && y < 0 { return num }
            return .num((x / y).rounded(.down) * y)
        case "MROUND":
            let n = parseNumber(arg(a, 0)), m = parseNumber(arg(a, 1))
            if let e = firstErr(n, m) { return e }
            let (x, y) = num2(n, m)!
            if x * y == 0 { return .num(0) }
            if x * y < 0 { return num }
            return .num(SheetJS.round(x / y) * y)
        case "TRUNC":
            let n = parseNumber(arg(a, 0)), d = parseNumber(arg(a, 1))
            if let e = firstErr(n, d) { return e }
            let (x, y) = num2(n, d)!
            let sign: Double = x > 0 ? 1 : -1
            let p = SheetJS.pow(10, y)
            return .num((sign * (abs(x) * p).rounded(.down)) / p)
        case "SIGN":
            let n = parseNumber(arg(a, 0))
            guard case .num(let x) = n else { return n }
            return .num(x < 0 ? -1 : x == 0 ? 0 : 1)
        case "PI": return .num(Double.pi)
        case "EXP":
            if a.isEmpty { return na }
            if a.count > 1 { return error }
            let n = parseNumber(a[0])
            guard case .num(let x) = n else { return n }
            return .num(Foundation.exp(x))
        case "LN":
            let n = parseNumber(arg(a, 0))
            guard case .num(let x) = n else { return n }
            return x == 0 ? num : .num(Foundation.log(x))
        case "LOG":
            let n = parseNumber(arg(a, 0))
            let b: V = truthy(arg(a, 1)) ? parseNumber(arg(a, 1)) : .num(10)
            if let e = firstErr(n, b) { return e }
            let (x, y) = num2(n, b)!
            if x == 0 || y == 0 { return num }
            return .num(Foundation.log(x) / Foundation.log(y))
        case "LOG10":
            let n = parseNumber(arg(a, 0))
            guard case .num(let x) = n else { return n }
            return x == 0 ? num : .num(Foundation.log(x) / Foundation.log(10))
        case "RAND": return .num(Double.random(in: 0..<1))
        case "RANDBETWEEN":
            let lo = parseNumber(arg(a, 0)), hi = parseNumber(arg(a, 1))
            if let e = firstErr(lo, hi) { return e }
            let (x, y) = num2(lo, hi)!
            return .num(x + ((y - x + 1) * Double.random(in: 0..<1)).rounded(.up) - 1)
        case "ISEVEN", "ISODD":
            let bit = SheetJS.toInt32(abs(toNumber(arg(a, 0))).rounded(.down)) & 1
            return .bool(fn == "ISEVEN" ? bit == 0 : bit != 0)
        default: return try SheetFormulaStats.call(fn, a)
        }
    }

    // MARK: - Lookup

    static func INDEX(_ array: V, _ row0: V, _ col0: V) throws -> V {
        if let e = firstErr(array, row0, col0) { return e }
        guard case .arr(let rows) = array else { return value }
        let oneDim = !rows.isEmpty && !rows[0].isArr
        var row = row0, col = col0
        if oneDim && !truthy(col) {
            col = row
            row = .num(1)
        } else {
            col = truthy(col) ? col : .num(1)
            row = truthy(row) ? row : .num(1)
        }
        if lt(col, .num(0)) || lt(row, .num(0)) { return value }
        let n = V.num(Double(rows.count))
        if oneDim && strictEq(row, .num(1)) && le(col, n) {
            return try at(array, toNumber(col) - 1)
        }
        if le(row, n) {
            let r = try at(array, toNumber(row) - 1)
            if le(col, try length(r)) { return try at(r, toNumber(col) - 1) }
        }
        return ref
    }

    static func matchRegex(_ lookup: String) -> NSRegularExpression? {
        var s = lookup.lowercased()
        s = s.replacingOccurrences(of: "?", with: ".")
        s = s.replacingOccurrences(of: "*", with: ".*")
        s = s.replacingOccurrences(of: "~", with: "\\")
        s = s.replacingOccurrences(of: "+", with: "\\+")
        s = s.replacingOccurrences(of: "(", with: "\\(")
        s = s.replacingOccurrences(of: ")", with: "\\)")
        s = s.replacingOccurrences(of: "[", with: "\\[")
        s = s.replacingOccurrences(of: "]", with: "\\]")
        return SheetJS.regex("^" + s + "\\z")
    }

    static func MATCH(_ a: [V]) throws -> V {
        let lv = arg(a, 0)
        let isZero: Bool = { if case .num(let n) = lv { return n == 0 }; return false }()
        if (!truthy(lv) && !isZero) || !truthy(arg(a, 1)) { return na }
        var mt = arg(a, 2)
        if a.count == 2 { mt = .num(1) }
        let list = flatten([arg(a, 1)])
        guard case .num(let m) = mt, m == -1 || m == 0 || m == 1 else { return na }
        var index: Int? = nil
        var indexValue: V = .undefined
        for (idx, item) in list.enumerated() {
            if m == 1 {
                if strictEq(item, lv) { return .num(Double(idx + 1)) }
                if lt(item, lv) && (!truthy(indexValue) || gt(item, indexValue)) { index = idx + 1; indexValue = item }
            } else if m == 0 {
                if case .str(let ls) = lv, case .str(let isv) = item {
                    guard let re = matchRegex(ls) else { throw SheetJSThrow() }
                    if SheetJS.test(re, isv.lowercased()) { return .num(Double(idx + 1)) }
                } else if strictEq(item, lv) {
                    return .num(Double(idx + 1))
                }
            } else {
                if strictEq(item, lv) { return .num(Double(idx + 1)) }
                if gt(item, lv) && (!truthy(indexValue) || lt(item, indexValue)) { index = idx + 1; indexValue = item }
            }
        }
        if let i = index, i != 0 { return .num(Double(i)) }
        return na
    }

    static func SUMPRODUCT(_ a: [V]) throws -> V {
        if a.isEmpty { return value }
        var result: Double = 0
        let len = toNumber(try length(a[0]))
        var i = 0.0
        while i < len {
            let first = try at(a[0], i)
            if case .arr = first {
                let jl = toNumber(try length(first))
                var j = 0.0
                while j < jl {
                    var product: Double = 1
                    for k in 0..<a.count {
                        let v = try at(try at(a[k], i), j)
                        if v.isErr { return v }
                        let p = parseNumber(v)
                        if p.isErr { return p }
                        product *= toNumber(p)
                    }
                    result += product
                    j += 1
                }
            } else {
                var product: Double = 1
                for k in 0..<a.count {
                    let v = try at(a[k], i)
                    if v.isErr { return v }
                    let p = parseNumber(v)
                    if p.isErr { return p }
                    product *= toNumber(p)
                }
                result += product
            }
            i += 1
        }
        return .num(result)
    }

    static func CHOOSE(_ a: [V]) -> V {
        if a.count < 2 { return na }
        let index = a[0]
        if lt(index, .num(1)) || gt(index, .num(254)) { return value }
        if lt(.num(Double(a.count)), add(index, .num(1))) { return value }
        if let hit = lookup(a.map { Optional($0) }, index) { return hit ?? .undefined }
        return .undefined
    }

    static func SWITCH(_ a: [V]) -> V {
        if a.isEmpty { return value }
        let target = a[0]
        let argc = a.count - 1
        let switchCount = argc / 2
        let hasDefault = argc % 2 != 0
        for i in 0..<switchCount where strictEq(target, a[i * 2 + 1]) { return a[i * 2 + 2] }
        return hasDefault ? a[a.count - 1] : na
    }

    static func XOR(_ a: [V]) -> V {
        var result: Double? = nil
        for v in flatten(a) {
            if v.isErr { return v }
            switch v {
            case .undefined, .null, .str: continue
            default: break
            }
            if result == nil { result = 0 }
            if truthy(v) { result! += 1 }
        }
        guard let r = result else { return value }
        return .bool(SheetJS.toInt32(abs(r).rounded(.down)) & 1 != 0)
    }

    // MARK: - Text

    static func PROPER(_ t: V) -> V {
        if t.isErr { return t }
        if case .num(let n) = t, n.isNaN { return value }
        let s = toString(parseString(t))
        var out = String.UnicodeScalarView()
        let sc = Array(s.unicodeScalars)
        var i = 0
        while i < sc.count {
            let u = sc[i].value
            let isWord = (u >= 48 && u <= 57) || (u >= 65 && u <= 90) || (u >= 97 && u <= 122) || u == 95
            if !isWord { out.append(sc[i]); i += 1; continue }
            var j = i + 1
            while j < sc.count && !SheetJS.isSpace(sc[j].value) { j += 1 }
            out.append(contentsOf: String(sc[i]).uppercased().unicodeScalars)
            var rest = String.UnicodeScalarView()
            rest.append(contentsOf: sc[(i + 1)..<j])
            out.append(contentsOf: String(rest).lowercased().unicodeScalars)
            i = j
        }
        return .str(String(out))
    }

    static func REPT(_ t: V, _ times: V) throws -> V {
        if let e = firstErr(t, times) { return e }
        let text = toString(parseString(t))
        let n = parseNumber(times)
        if n.isErr { return n }
        let len = toNumber(add(n, .num(1)))
        guard len.isFinite, len >= 0, len == len.rounded(.down), len <= 4294967295 else { throw SheetJSThrow() }
        let count = Int(len) - 1
        if count <= 0 || text.isEmpty { return .str("") }
        if count * text.utf16.count > 536_870_888 { throw SheetJSThrow() }
        return .str(String(repeating: text, count: count))
    }

    static func SEARCH(_ find: V, _ within: V, _ start: V) -> V {
        guard case .str(let f) = find, case .str(let w) = within else { return value }
        let st: V = { if case .undefined = start { return .num(0) }; return start }()
        let pos = toNumber(st) - 1
        let foundAt = SheetJS.indexOf(w.lowercased(), f.lowercased(), pos) + 1
        return foundAt == 0 ? value : .num(Double(foundAt))
    }

    static func REPLACE(_ old: V, _ numChars: V, _ length: V, _ new: V) -> V {
        let nc = parseNumber(numChars), ln = parseNumber(length)
        guard !nc.isErr, !ln.isErr, case .str(let o) = old, case .str(let n) = new else { return value }
        let start = toNumber(nc) - 1
        return .str(SheetJS.substr(o, 0, start) + n + SheetJS.substr(o, start + toNumber(ln), nil))
    }

    static func TEXTJOIN(_ a: [V]) -> V {
        var ignore = arg(a, 1)
        if case .bool = ignore {} else { ignore = parseBool(ignore) }
        if a.count < 3 { return na }
        var delimiter = a[0]
        if !delimiter.isDefined { delimiter = .str("") }
        let flatArgs = flatten([.arr(Array(a[2...]))])
        let toJoin = truthy(ignore) ? flatArgs.filter { truthy($0) } : flatArgs
        func piece(_ v: V) -> String {
            if case .undefined = v { return "" }
            if case .null = v { return "" }
            return toString(v)
        }
        if case .arr = delimiter {
            let delims = flatten([delimiter])
            var out = ""
            var index = 0
            for (i, item) in toJoin.enumerated() {
                out += piece(item)
                if i < toJoin.count - 1 {
                    out += piece(index < delims.count ? delims[index] : .undefined)
                    index += 1
                    if index == delims.count { index = 0 }
                }
            }
            return .str(out)
        }
        return .str(toJoin.map(piece).joined(separator: toString(delimiter)))
    }

    // MARK: - Dates

    static let WEEK_STARTS: [Double?] = [nil, 0, 1, nil, nil, nil, nil, nil, nil, nil, nil, nil, 1, 2, 3, 4, 5, 6, 0]
    static let WEEK_TYPES: [[Double]?] = [
        [], [1, 2, 3, 4, 5, 6, 7], [7, 1, 2, 3, 4, 5, 6], [6, 0, 1, 2, 3, 4, 5], [], [], [], [], [], [], [],
        [7, 1, 2, 3, 4, 5, 6], [6, 7, 1, 2, 3, 4, 5], [5, 6, 7, 1, 2, 3, 4], [4, 5, 6, 7, 1, 2, 3], [3, 4, 5, 6, 7, 1, 2],
        [2, 3, 4, 5, 6, 7, 1], [1, 2, 3, 4, 5, 6, 7],
    ]
    static let WEEKEND_TYPES: [[Double]?] = [
        [], [6, 0], [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], nil, nil, nil,
        [0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6],
    ]

    private static func dateOf(_ v: V) -> Double? { if case .date(let t) = v { return t }; return nil }

    static func DAYS(_ end: V, _ start: V) -> V {
        let e = parseDate(end), s = parseDate(start)
        if e.isErr { return e }
        if s.isErr { return s }
        return .num(dateToSerial(SheetDate.startOfDay(dateOf(e)!)) - dateToSerial(SheetDate.startOfDay(dateOf(s)!)))
    }

    static func DAYS360(_ start: V, _ end: V, _ method0: V) -> V {
        let method = parseBool(truthy(method0) ? method0 : .str("false"))
        let s = parseDate(start), e = parseDate(end)
        if s.isErr { return s }
        if e.isErr { return e }
        if method.isErr { return method }
        let sp = SheetDate.parts(dateOf(s)!), ep = SheetDate.parts(dateOf(e)!)
        let sm = sp.m
        var em = ep.m
        var sd: Double, ed: Double
        if truthy(method) {
            sd = sp.d == 31 ? 30 : sp.d
            ed = ep.d == 31 ? 30 : ep.d
        } else {
            let smd = SheetDate.parts(SheetDate.local(sp.y, sm + 1, 0)).d
            let emd = SheetDate.parts(SheetDate.local(ep.y, em + 1, 0)).d
            sd = sp.d == smd ? 30 : sp.d
            if ep.d == emd {
                if sd < 30 { em += 1; ed = 1 } else { ed = 30 }
            } else {
                ed = ep.d
            }
        }
        return .num(360 * (ep.y - sp.y) + 30 * (em - sm) + (ed - sd))
    }

    static func EDATE(_ start: V, _ months: V) -> V {
        let s = parseDate(start)
        if s.isErr { return s }
        if isNaNjs(months) { return value }
        var t = dateOf(s)!
        var storedDay = SheetDate.parts(t).d
        t = SheetDate.setDate(t, 1)
        let m = SheetJS.parseInt10(toString(months))
        t = SheetDate.setMonth(t, SheetDate.parts(t).m + m)
        let p = SheetDate.parts(t)
        if storedDay > 28 {
            let table: [Double] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
            var dim: Double = p.m.isNaN ? .nan : table[Int(p.m)]
            let y = p.y
            if p.m == 1 && ((y.truncatingRemainder(dividingBy: 4) == 0 && y.truncatingRemainder(dividingBy: 100) != 0) || y.truncatingRemainder(dividingBy: 400) == 0) { dim = 29 }
            storedDay = SheetJS.jsMin([storedDay, dim])
        }
        return .date(SheetDate.setDate(t, storedDay))
    }

    static func EOMONTH(_ start: V, _ months: V) -> V {
        let s = parseDate(start)
        if s.isErr { return s }
        if isNaNjs(months) { return value }
        let m = SheetJS.parseInt10(toString(months))
        let p = SheetDate.parts(dateOf(s)!)
        return .date(SheetDate.local(p.y, p.m + m + 1, 0))
    }

    static func ISOWEEKNUM(_ date: V) -> V {
        let d = parseDate(date)
        if d.isErr { return d }
        var t = SheetDate.startOfDay(dateOf(d)!)
        let p = SheetDate.parts(t)
        let dow = p.dow == 0 || p.dow.isNaN ? 7 : p.dow
        t = SheetDate.setDate(t, p.d + 4 - dow)
        let yearStart = SheetDate.local(SheetDate.parts(t).y, 0, 1)
        return .num((((t - yearStart) / 86_400_000 + 1) / 7).rounded(.up))
    }

    private static func holidaysList(_ h: V) -> [V] {
        switch h {
        case .undefined: return []
        case .arr(let a): return a
        default: return [h]
        }
    }

    private static func sameDay(_ a: Double, _ b: Double) -> Bool {
        let x = SheetDate.parts(a), y = SheetDate.parts(b)
        return x.d == y.d && x.m == y.m && x.y == y.y
    }

    static func NETWORKDAYSINTL(_ start: V, _ end: V, _ weekend0: V, _ holidays0: V) throws -> V {
        let s = parseDate(start)
        if s.isErr { return s }
        let e = parseDate(end)
        if e.isErr { return e }
        var isMask = false
        var maskDays: [Double] = []
        let maskIndex: [Double] = [1, 2, 3, 4, 5, 6, 0]
        var weekend: [Double]? = nil
        if case .undefined = weekend0 {
            weekend = WEEKEND_TYPES[1]
        } else if case .str(let ws) = weekend0, SheetJS.fullMatch(SheetJS.re("^[0|1]{7}\\z"), ws) {
            isMask = true
            for (i, ch) in ws.enumerated() where ch == "1" { maskDays.append(maskIndex[i]) }
            weekend = []
        } else {
            weekend = (lookup(WEEKEND_TYPES, weekend0) ?? nil) ?? nil
        }
        guard let wk = weekend else { return value }
        var hol: [Double] = []
        for h in holidaysList(holidays0) {
            let p = parseDate(h)
            if p.isErr { return p }
            hol.append(dateOf(p)!)
        }
        let st = dateOf(s)!, en = dateOf(e)!
        let days = SheetJS.round((en - st) / 86_400_000) + 1
        if days > 5_000_000 { throw SheetJSThrow() }
        var total = days
        var day = st
        var i = 0.0
        while i < days {
            let d = SheetDate.parts(day).dow
            var dec = isMask ? maskDays.contains(d) : (d == (wk.count > 0 ? wk[0] : .nan) || d == (wk.count > 1 ? wk[1] : .nan))
            for h in hol where sameDay(h, day) { dec = true; break }
            if dec { total -= 1 }
            day = SheetDate.setDate(day, SheetDate.parts(day).d + 1)
            i += 1
        }
        return .num(total)
    }

    static func WEEKDAY(_ serial: V, _ returnType0: V) throws -> V {
        let d = parseDate(serial)
        if d.isErr { return d }
        let rt: V = { if case .undefined = returnType0 { return .num(1) }; return returnType0 }()
        let day = SheetDate.parts(dateOf(d)!).dow
        guard let row = lookup(WEEK_TYPES, rt), let types = row else { throw SheetJSThrow() }
        guard day.isFinite, day >= 0, Int(day) < types.count else { return .undefined }
        return .num(types[Int(day)])
    }

    static func WEEKNUM(_ serial: V, _ returnType0: V) -> V {
        let d = parseDate(serial)
        if d.isErr { return d }
        let rt: V = { if case .undefined = returnType0 { return .num(1) }; return returnType0 }()
        if case .num(let n) = rt, n == 21 { return ISOWEEKNUM(d) }
        let weekStart: Double = (lookup(WEEK_STARTS, rt) ?? nil) ?? .nan
        let t = dateOf(d)!
        var jan = SheetDate.local(SheetDate.parts(t).y, 0, 1)
        let jd = SheetDate.parts(jan).dow
        let inc: Double = jd < weekStart ? 1 : 0
        jan -= abs(jd - weekStart) * 86_400_000
        return .num(((t - jan) / 86_400_000 / 7 + 1).rounded(.down) + inc)
    }

    static func WORKDAYINTL(_ start: V, _ days0: V, _ weekend0: V, _ holidays0: V) throws -> V {
        let s = parseDate(start)
        if s.isErr { return s }
        let dn = parseNumber(days0)
        if dn.isErr { return dn }
        let days = toNumber(dn)
        let weekend: [Double]?
        if case .undefined = weekend0 { weekend = WEEKEND_TYPES[1] } else { weekend = (lookup(WEEKEND_TYPES, weekend0) ?? nil) ?? nil }
        guard let wk = weekend else { return value }
        var hol: [Double] = []
        for h in holidaysList(holidays0) {
            let p = parseDate(h)
            if p.isErr { return p }
            hol.append(dateOf(p)!)
        }
        if abs(days) > 2_000_000 { throw SheetJSThrow() }
        var t = dateOf(s)!
        var d = 0.0
        let sign = SheetJS.sign(days)
        let w0 = wk.count > 0 ? wk[0] : .nan, w1 = wk.count > 1 ? wk[1] : .nan
        while d < days * sign {
            t = SheetDate.setDate(t, SheetDate.parts(t).d + sign)
            let day = SheetDate.parts(t).dow
            if day == w0 || day == w1 { continue }
            for h in hol where sameDay(h, t) { d -= 1; break }
            d += 1
        }
        if SheetDate.parts(t).y < 1900 { return value }
        return .date(t)
    }

    private static func isLeapYear(_ y: Double) -> Bool { SheetDate.parts(SheetDate.local(y, 1, 29)).m == 1 }
    private static func daysBetween(_ a: Double, _ b: Double) -> Double { ((b - a) / 1000 / 60 / 60 / 24).rounded(.up) }

    static func YEARFRAC(_ start: V, _ end: V, _ basis0: V) -> V {
        let s = parseDate(start)
        if s.isErr { return s }
        let e = parseDate(end)
        if e.isErr { return e }
        let basis: V = truthy(basis0) ? basis0 : .num(0)
        let st = dateOf(s)!, en = dateOf(e)!
        let sp = SheetDate.parts(st), ep = SheetDate.parts(en)
        var sd = sp.d, ed = ep.d
        let sm = sp.m + 1, sy = sp.y, em = ep.m + 1, ey = ep.y
        guard case .num(let b) = basis else { return .undefined }
        switch b {
        case 0:
            if sd == 31 && ed == 31 { sd = 30; ed = 30 } else if sd == 31 { sd = 30 } else if sd == 30 && ed == 31 { ed = 30 }
            return .num((ed + em * 30 + ey * 360 - (sd + sm * 30 + sy * 360)) / 360)
        case 1:
            let feb29Between: () -> Bool = {
                let mar1y1 = SheetDate.local(sy, 2, 1)
                if isLeapYear(sy) && st < mar1y1 && en >= mar1y1 { return true }
                let mar1y2 = SheetDate.local(ey, 2, 1)
                return isLeapYear(ey) && en >= mar1y2 && st < mar1y2
            }
            if sy == ey || (sy + 1 == ey && (sm > em || (sm == em && sd >= ed))) {
                var ylength: Double = 365
                if (sy == ey && isLeapYear(sy)) || feb29Between() || (em == 1 && ed == 29) { ylength = 366 }
                return .num(daysBetween(st, en) / ylength)
            }
            let years = ey - sy + 1
            let days = (SheetDate.local(ey + 1, 0, 1) - SheetDate.local(sy, 0, 1)) / 1000 / 60 / 60 / 24
            return .num(daysBetween(st, en) / (days / years))
        case 2: return .num(daysBetween(st, en) / 360)
        case 3: return .num(daysBetween(st, en) / 365)
        case 4: return .num((ed + em * 30 + ey * 360 - (sd + sm * 30 + sy * 360)) / 360)
        default: return .undefined
        }
    }
}
