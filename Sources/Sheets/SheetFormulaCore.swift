// The engine's own functions (SUM … XLOOKUP, TEXT) — port of SheetEngine.call and textFormat in
// sheet-formula.ts. Everything not handled here goes to the formula.js port (SheetFormulaFunctions).
import Foundation

extension SheetEngine {
    typealias Node = SheetFormula.Node

    /// Double -> Int for slicing, clamped (NaN is 0) the way JS index arithmetic behaves.
    static func clampInt(_ x: Double) -> Int {
        if x.isNaN { return 0 }
        if x > 1e9 { return 1_000_000_000 }
        if x < -1e9 { return -1_000_000_000 }
        return Int(x)
    }
    static func trunc(_ x: Double) -> Double { SheetDate.toInt(x) }

    private func num1(_ args: [Node], _ i: Int, _ dflt: Double? = nil) -> SheetFormula.NumOrErr {
        guard i < args.count else { return dflt.map { .n($0) } ?? .e(F.ERR.value) }
        return F.toNum(evalScalar(args[i]))
    }
    private func str1(_ args: [Node], _ i: Int) -> (s: String, err: String?) {
        guard i < args.count else { return ("", nil) }
        let v = evalScalar(args[i])
        if F.isError(v) { return ("", v.text!) }
        return (F.toText(v), nil)
    }
    private func arg0(_ args: [Node]) -> SheetCellValue { args.isEmpty ? .empty : evalScalar(args[0]) }

    private func withNums(_ args: [Node], _ fn: ([Double]) -> SheetCellValue) -> SheetCellValue {
        switch numbers(args) {
        case .e(let e): return .text(e)
        case .n(let n): return fn(n)
        }
    }

    func call(_ fn: String, _ args: [Node]) -> SheetCellValue {
        switch fn {
        case "SUM": return withNums(args) { .number($0.reduce(0, +)) }
        case "AVERAGE", "AVG":
            return withNums(args) { $0.isEmpty ? .text(F.ERR.div) : .number($0.reduce(0, +) / Double($0.count)) }
        case "MIN": return withNums(args) { $0.isEmpty ? .number(0) : .number(SheetJS.jsMin($0)) }
        case "MAX": return withNums(args) { $0.isEmpty ? .number(0) : .number(SheetJS.jsMax($0)) }
        case "COUNT": return withNums(args) { .number(Double($0.count)) }
        case "COUNTA":
            var c = 0
            for a in args {
                switch flat(a) {
                case .e: c += 1
                case .l(let v): c += v.filter { !$0.isEmptyOrBlank }.count
                }
            }
            return .number(Double(c))
        case "COUNTBLANK":
            var c = 0
            for a in args {
                switch flat(a) {
                case .e(let e): return .text(e)
                case .l(let v): c += v.filter { $0.isEmptyOrBlank }.count
                }
            }
            return .number(Double(c))
        case "PRODUCT": return withNums(args) { .number($0.reduce(1, *)) }
        case "MEDIAN":
            return withNums(args) { n in
                if n.isEmpty { return .text(F.ERR.num) }
                let sorted = n.sorted()
                let mid = sorted.count / 2
                return .number(sorted.count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2)
            }
        case "ROUND", "ROUNDUP", "ROUNDDOWN": return round(fn, args)
        case "ABS":
            switch num1(args, 0) { case .e(let e): return .text(e); case .n(let a): return .number(abs(a)) }
        case "INT":
            switch num1(args, 0) { case .e(let e): return .text(e); case .n(let a): return .number(a.rounded(.down)) }
        case "MOD":
            guard case .n(let a) = num1(args, 0) else { return errOf(num1(args, 0)) }
            guard case .n(let b) = num1(args, 1) else { return errOf(num1(args, 1)) }
            if b == 0 { return .text(F.ERR.div) }
            return .number(a - b * (a / b).rounded(.down))
        case "SQRT":
            switch num1(args, 0) {
            case .e(let e): return .text(e)
            case .n(let a): return a < 0 ? .text(F.ERR.num) : .number(a.squareRoot())
            }
        case "POWER":
            guard case .n(let a) = num1(args, 0) else { return errOf(num1(args, 0)) }
            guard case .n(let b) = num1(args, 1) else { return errOf(num1(args, 1)) }
            let p = SheetJS.pow(a, b)
            return p.isFinite ? .number(p) : .text(F.ERR.num)
        default:
            return callLogicText(fn, args)
        }
    }

    private func errOf(_ r: SheetFormula.NumOrErr) -> SheetCellValue {
        if case .e(let e) = r { return .text(e) }
        return .text(F.ERR.value)
    }

    private func round(_ fn: String, _ args: [Node]) -> SheetCellValue {
        guard case .n(let a) = num1(args, 0) else { return errOf(num1(args, 0)) }
        guard case .n(let d) = num1(args, 1, 0) else { return errOf(num1(args, 1, 0)) }
        let f = SheetJS.pow(10, SheetEngine.trunc(d))
        let x = SheetJS.precision15(abs(a) * f)
        let r: Double
        if fn == "ROUND" { r = SheetJS.round(x) } else if fn == "ROUNDUP" { r = x.rounded(.up) } else { r = x.rounded(.down) }
        return .number(SheetJS.sign(a) * r / f)
    }

    private func callLogicText(_ fn: String, _ args: [Node]) -> SheetCellValue {
        switch fn {
        case "IF":
            if args.count < 2 { return .text(F.ERR.value) }
            switch F.truthy(evalScalar(args[0])) {
            case .e(let e): return .text(e)
            case .b(let c):
                if c { return evalScalar(args[1]) }
                return args.count > 2 ? evalScalar(args[2]) : .bool(false)
            }
        case "IFS":
            var i = 0
            while i + 1 < args.count {
                switch F.truthy(evalScalar(args[i])) {
                case .e(let e): return .text(e)
                case .b(let c): if c { return evalScalar(args[i + 1]) }
                }
                i += 2
            }
            return .text(F.ERR.na)
        case "IFERROR":
            let v = arg0(args)
            if !F.isError(v) { return v }
            return args.count > 1 ? evalScalar(args[1]) : .text("")
        case "IFNA":
            let v = arg0(args)
            if v != .text(F.ERR.na) { return v }
            return args.count > 1 ? evalScalar(args[1]) : .text("")
        case "AND", "OR": return andOr(fn, args)
        case "NOT":
            switch F.truthy(arg0(args)) { case .e(let e): return .text(e); case .b(let b): return .bool(!b) }
        case "TRUE": return .bool(true)
        case "FALSE": return .bool(false)
        case "ISBLANK": return .bool(arg0(args).isEmptyOrBlank)
        case "ISNUMBER": if case .number = arg0(args) { return .bool(true) }; return .bool(false)
        case "ISTEXT":
            let v = arg0(args)
            if case .text = v { return .bool(!F.isError(v)) }
            return .bool(false)
        case "ISERROR": return .bool(F.isError(arg0(args)))
        case "ISNA": return .bool(arg0(args) == .text(F.ERR.na))
        default: return callText(fn, args)
        }
    }

    private func andOr(_ fn: String, _ args: [Node]) -> SheetCellValue {
        var vals: [Bool] = []
        for a in args {
            let list: [SheetCellValue]
            if a.isRange {
                switch flat(a) {
                case .e(let e): return .text(e)
                case .l(let l): list = l
                }
            } else {
                list = [evalScalar(a)]
            }
            for x in list {
                if a.isRange {
                    if x == .empty { continue }
                    if case .text = x { continue }
                }
                switch F.truthy(x) {
                case .e(let e): return .text(e)
                case .b(let b): vals.append(b)
                }
            }
        }
        if vals.isEmpty { return .text(F.ERR.value) }
        return .bool(fn == "AND" ? vals.allSatisfy { $0 } : vals.contains(true))
    }

    /// TRIM: String#trim then collapse \s+ to one space.
    static func collapseSpaces(_ s: String) -> String {
        var out = String.UnicodeScalarView()
        var inSpace = false
        for u in SheetJS.trim(s).unicodeScalars {
            if SheetJS.isSpace(u.value) {
                if !inSpace { out.append(" ") }
                inSpace = true
            } else {
                out.append(u)
                inSpace = false
            }
        }
        return String(out)
    }

    /// SUBSTITUTE: replace the nth (or every) non-overlapping occurrence.
    static func substitute(_ s: String, _ from: String, _ to: String, nth: Double?) -> String {
        let h = SheetJS.u16(s), n = SheetJS.u16(from), t = SheetJS.u16(to)
        var out: [UInt16] = []
        var i = 0
        var count: Double = 0
        while i < h.count {
            if i + n.count <= h.count && Array(h[i..<(i + n.count)]) == n {
                count += 1
                if nth == nil || count == SheetEngine.trunc(nth!) { out.append(contentsOf: t) } else { out.append(contentsOf: n) }
                i += n.count
            } else {
                out.append(h[i])
                i += 1
            }
        }
        return SheetJS.str(out)
    }

    private func callText(_ fn: String, _ args: [Node]) -> SheetCellValue {
        switch fn {
        case "CONCAT", "CONCATENATE":
            var s = ""
            for a in args {
                switch flat(a) {
                case .e(let e): return .text(e)
                case .l(let l):
                    for x in l {
                        if F.isError(x) { return x }
                        s += F.toText(x)
                    }
                }
            }
            return .text(s)
        case "LEN":
            let s = str1(args, 0)
            if let e = s.err { return .text(e) }
            return .number(Double(s.s.utf16.count))
        case "UPPER":
            let s = str1(args, 0)
            return s.err.map { .text($0) } ?? .text(s.s.uppercased())
        case "LOWER":
            let s = str1(args, 0)
            return s.err.map { .text($0) } ?? .text(s.s.lowercased())
        case "TRIM":
            let s = str1(args, 0)
            return s.err.map { .text($0) } ?? .text(SheetEngine.collapseSpaces(s.s))
        case "LEFT", "RIGHT":
            let s = str1(args, 0)
            if let e = s.err { return .text(e) }
            guard case .n(let n) = num1(args, 1, 1) else { return errOf(num1(args, 1, 1)) }
            if n < 0 { return .text(F.ERR.value) }
            let k = SheetEngine.clampInt(SheetEngine.trunc(n))
            if fn == "LEFT" { return .text(SheetJS.slice(s.s, 0, k)) }
            return .text(k == 0 ? "" : SheetJS.slice(s.s, -k))
        case "MID":
            let s = str1(args, 0)
            if let e = s.err { return .text(e) }
            guard case .n(let start) = num1(args, 1) else { return errOf(num1(args, 1)) }
            guard case .n(let len) = num1(args, 2) else { return errOf(num1(args, 2)) }
            if start < 1 || len < 0 { return .text(F.ERR.value) }
            let from = SheetEngine.trunc(start) - 1
            let to = from + SheetEngine.trunc(len)
            return .text(SheetJS.slice(s.s, SheetEngine.clampInt(from), SheetEngine.clampInt(to)))
        case "FIND":
            let needle = str1(args, 0)
            if let e = needle.err { return .text(e) }
            let hay = str1(args, 1)
            if let e = hay.err { return .text(e) }
            guard case .n(let from) = num1(args, 2, 1) else { return errOf(num1(args, 2, 1)) }
            let pos = SheetEngine.trunc(from) - 1
            let at = SheetJS.indexOf(hay.s, needle.s, pos.isNaN ? .nan : Swift.max(0, pos))
            return at < 0 ? .text(F.ERR.value) : .number(Double(at + 1))
        case "SUBSTITUTE":
            let s = str1(args, 0)
            if let e = s.err { return .text(e) }
            let from = str1(args, 1)
            if let e = from.err { return .text(e) }
            let to = str1(args, 2)
            if let e = to.err { return .text(e) }
            if from.s.isEmpty { return .text(s.s) }
            if args.count > 3 {
                guard case .n(let nth) = num1(args, 3) else { return errOf(num1(args, 3)) }
                return .text(SheetEngine.substitute(s.s, from.s, to.s, nth: nth))
            }
            return .text(SheetEngine.substitute(s.s, from.s, to.s, nth: nil))
        case "TEXT":
            let v = arg0(args)
            if F.isError(v) { return v }
            let f = str1(args, 1)
            if let e = f.err { return .text(e) }
            return SheetFormula.textFormat(v, f.s)
        case "VALUE":
            let v = arg0(args)
            if F.isError(v) { return v }
            switch v {
            case .number: return v
            case .empty: return .number(0)
            case .text(let s) where s.isEmpty: return .number(0)
            default:
                guard let n = F.numberFromText(F.jsStringOf(v)) else { return .text(F.ERR.value) }
                return .number(n)
            }
        default: return callDates(fn, args)
        }
    }

    private func callDates(_ fn: String, _ args: [Node]) -> SheetCellValue {
        switch fn {
        case "TODAY": markVolatile(); return .number(F.todaySerial())
        case "NOW": markVolatile(); return .number(F.nowSerial())
        case "DATE":
            guard case .n(let y) = num1(args, 0) else { return errOf(num1(args, 0)) }
            guard case .n(let m) = num1(args, 1) else { return errOf(num1(args, 1)) }
            guard case .n(let d) = num1(args, 2) else { return errOf(num1(args, 2)) }
            let s = F.ymdToSerial(SheetEngine.trunc(y), SheetEngine.trunc(m), SheetEngine.trunc(d))
            return s < 0 ? .text(F.ERR.num) : .number(s)
        case "DATEVALUE":
            let s = str1(args, 0)
            if let e = s.err { return .text(e) }
            guard let v = F.parseDateText(s.s) else { return .text(F.ERR.value) }
            return .number(v)
        case "YEAR", "MONTH", "DAY":
            guard case .n(let s) = num1(args, 0) else { return errOf(num1(args, 0)) }
            if s < 0 { return .text(F.ERR.num) }
            let p = F.serialToYmdD(s)
            return .number(fn == "YEAR" ? p.y : fn == "MONTH" ? p.m : p.d)
        case "DATEDIF": return datedif(args)
        case "SUMIF", "AVERAGEIF", "COUNTIF":
            if args.count < 2 { return .text(F.ERR.value) }
            let hit = matchingIndices([(args[0], args[1])])
            if let e = hit.err { return .text(e) }
            if fn == "COUNTIF" { return .number(Double(hit.idx.count)) }
            switch flat(args.count > 2 ? args[2] : args[0]) {
            case .e(let e): return .text(e)
            case .l(let target): return aggregateAt(fn == "SUMIF" ? "sum" : "avg", target, hit.idx)
            }
        case "SUMIFS", "AVERAGEIFS", "MAXIFS", "MINIFS", "COUNTIFS":
            let withTarget = fn != "COUNTIFS"
            let start = withTarget ? 1 : 0
            if args.count < start + 2 || (args.count - start) % 2 != 0 { return .text(F.ERR.value) }
            var pairs: [(range: Node, crit: Node)] = []
            var i = start
            while i < args.count { pairs.append((args[i], args[i + 1])); i += 2 }
            let hit = matchingIndices(pairs)
            if let e = hit.err { return .text(e) }
            if !withTarget { return .number(Double(hit.idx.count)) }
            switch flat(args[0]) {
            case .e(let e): return .text(e)
            case .l(let target):
                let kind = fn == "SUMIFS" ? "sum" : fn == "AVERAGEIFS" ? "avg" : fn == "MAXIFS" ? "max" : "min"
                return aggregateAt(kind, target, hit.idx)
            }
        case "VLOOKUP", "HLOOKUP": return vhlookup(fn, args)
        case "XLOOKUP": return xlookup(args)
        default:
            let name = SheetFormulaLib.has(fn) ? fn : fn.replacingOccurrences(of: ".", with: "")
            if !SheetFormulaLib.has(name) { return .text(F.ERR.name) }
            return callFormulajs(fn, name, args)
        }
    }

    private func datedif(_ args: [Node]) -> SheetCellValue {
        guard case .n(let a) = num1(args, 0) else { return errOf(num1(args, 0)) }
        guard case .n(let b) = num1(args, 1) else { return errOf(num1(args, 1)) }
        if b < a { return .text(F.ERR.num) }
        let u = str1(args, 2)
        let unit = u.err != nil ? "D" : (u.s.isEmpty ? "D" : u.s.uppercased())
        if unit == "D" { return .number(b.rounded(.down) - a.rounded(.down)) }
        let A = F.serialToYmdD(a), B = F.serialToYmdD(b)
        var months = (B.y - A.y) * 12 + (B.m - A.m)
        if B.d < A.d { months -= 1 }
        switch unit {
        case "M": return .number(months)
        case "Y": return .number(SheetEngine.trunc(months / 12))
        case "YM": return .number(months.truncatingRemainder(dividingBy: 12))
        case "MD":
            if B.d >= A.d { return .number(B.d - A.d) }
            let py = B.m == 1 ? B.y - 1 : B.y
            let pm = B.m == 1 ? 12 : B.m - 1
            return .number(B.d + F.daysIn(py, pm) - A.d)
        default: return .text(F.ERR.num)
        }
    }

    private func vhlookup(_ fn: String, _ args: [Node]) -> SheetCellValue {
        if args.count < 3 { return .text(F.ERR.value) }
        let key = evalScalar(args[0])
        if F.isError(key) { return key }
        let grid: SheetFormula.Matrix
        switch matrix(args[1]) {
        case .e(let e): return .text(e)
        case .m(let m): grid = m
        }
        guard case .n(let idx) = num1(args, 2) else { return errOf(num1(args, 2)) }
        let n = SheetEngine.trunc(idx)
        if n < 1 { return .text(F.ERR.value) }
        if fn == "VLOOKUP" {
            for row in grid {
                guard let first = row.first, !first.isEmptyOrBlank, F.compare(first, key) == 0 else { continue }
                if n > Double(row.count) { return .text(F.ERR.ref) }
                return row[Int(n) - 1]
            }
        } else {
            let first = grid.first ?? []
            for c in 0..<first.count {
                if first[c].isEmptyOrBlank || F.compare(first[c], key) != 0 { continue }
                if n > Double(grid.count) { return .text(F.ERR.ref) }
                let row = grid[Int(n) - 1]
                return c < row.count ? row[c] : .empty
            }
        }
        return .text(F.ERR.na)
    }

    private func xlookup(_ args: [Node]) -> SheetCellValue {
        if args.count < 3 { return .text(F.ERR.value) }
        let key = evalScalar(args[0])
        if F.isError(key) { return key }
        let look: SheetFormula.Matrix, ret: SheetFormula.Matrix
        switch matrix(args[1]) { case .e(let e): return .text(e); case .m(let m): look = m }
        switch matrix(args[2]) { case .e(let e): return .text(e); case .m(let m): ret = m }
        let vertical = look.count > 1 || (look.first?.count ?? 0) <= 1
        let keys: [SheetCellValue] = vertical ? look.map { $0.first ?? .empty } : (look.first ?? [])
        guard case .n(let mode) = num1(args, 4, 0) else { return errOf(num1(args, 4, 0)) }
        guard case .n(let search) = num1(args, 5, 1) else { return errOf(num1(args, 5, 1)) }
        var order = Array(keys.indices)
        if search < 0 { order.reverse() }
        var best = -1
        for i in order {
            let k = keys[i]
            if mode == 2, case .text(let ks) = key {
                if let re = F.wildcardRegex(ks), SheetJS.test(re, F.toText(k)) { best = i; break }
                continue
            }
            if !k.isEmptyOrBlank && F.compare(k, key) == 0 { best = i; break }
            if mode == -1 && !k.isEmptyOrBlank && F.compare(k, key) < 0 && (best < 0 || F.compare(k, keys[best]) > 0) { best = i }
            if mode == 1 && !k.isEmptyOrBlank && F.compare(k, key) > 0 && (best < 0 || F.compare(k, keys[best]) < 0) { best = i }
        }
        if best < 0 { return args.count > 3 ? evalScalar(args[3]) : .text(F.ERR.na) }
        // `ret[best]?.[0] ?? ERR.ref`: a blank result is nullish too, so it reads #REF!.
        let picked: SheetCellValue?
        if vertical {
            picked = best < ret.count ? ret[best].first : nil
        } else {
            picked = (ret.first.map { best < $0.count ? $0[best] : nil }) ?? nil
        }
        guard let p = picked, p != .empty else { return .text(F.ERR.ref) }
        return p
    }

    // MARK: formula.js bridge

    static func jsv(_ v: SheetCellValue) -> SheetJSValue {
        switch v {
        case .empty: return .null
        case .number(let n): return .num(n)
        case .text(let s): return .str(s)
        case .bool(let b): return .bool(b)
        }
    }

    private static func asDate(_ v: SheetCellValue) -> SheetJSValue {
        switch v {
        case .number(let n): return .date(SheetFormulaLib.serialToLocalDate(n))
        case .text(let s) where !s.isEmpty:
            guard let ser = F.numberFromText(s) else { return .str(s) }
            return .date(SheetFormulaLib.serialToLocalDate(ser))
        default: return jsv(v)
        }
    }

    func callFormulajs(_ fn: String, _ lib: String, _ args: [Node]) -> SheetCellValue {
        let dateAt = Set(SheetFormulaLib.DATE_ARGS[fn] ?? [])
        var passed: [SheetJSValue] = []
        for (i, a) in args.enumerated() {
            if a.isRange {
                let m: SheetFormula.Matrix
                switch matrix(a) {
                case .e(let e): return .text(e)
                case .m(let mm): m = mm
                }
                for row in m { for v in row where F.isError(v) { return v } }
                if dateAt.contains(i) {
                    passed.append(.arr(m.flatMap { $0 }.filter { !$0.isEmptyOrBlank }.map { SheetEngine.asDate($0) }))
                } else {
                    passed.append(.arr(m.map { .arr($0.map { SheetEngine.jsv($0) }) }))
                }
                continue
            }
            let v = evalScalar(a)
            if F.isError(v) { return v }
            passed.append(dateAt.contains(i) ? SheetEngine.asDate(v) : SheetEngine.jsv(v))
        }
        do {
            return SheetFormulaLib.fromFormulajs(try SheetFormulaLib.call(lib, passed))
        } catch {
            return .text(F.ERR.value)
        }
    }
}

extension SheetFormula {
    /// TEXT(value; format) with locale output: "#,##0" -> "1.500.000", "dd/mm/yyyy", "dddd", "0,0%".
    static func textFormat(_ v: SheetCellValue, _ fmt: String) -> SheetCellValue {
        let f = fmt
        let unquoted = SheetJS.replaceAll(SheetJS.re("\"[^\"]*\""), f) { _ in "" }
        let isDate = SheetJS.test(SheetJS.re("[dmy]", true), unquoted) && !SheetJS.test(SheetJS.re("[0#]"), unquoted)
        if isDate {
            var s: Double? = nil
            if case .number(let n) = v { s = n } else if case .text(let t) = v { s = numberFromText(t) }
            guard let ser = s else { return .text(ERR.value) }
            let p = serialToYmdD(ser)
            let dow = weekdayOf(ser)
            let pattern = "\"([^\"]*)\"|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d"
            let out = SheetJS.replaceAll(SheetJS.re(pattern, true), f) { g in
                if let lit = g[1] { return lit }
                switch (g[0] ?? "").lowercased() {
                case "yyyy": return SheetJS.numberToString(p.y)
                case "yy": return SheetJS.slice(SheetJS.numberToString(p.y), -2)
                case "mmmm": return monthName(p.m, true)
                case "mmm": return monthName(p.m, false)
                case "mm": return pad2(p.m)
                case "m": return SheetJS.numberToString(p.m)
                case "dddd": return weekdayName(dow, true)
                case "ddd":
                    if isEn { return weekdayName(dow, false) }
                    return SheetJS.slice(pickLongId(dow), 0, 3)
                case "dd": return pad2(p.d)
                default: return SheetJS.numberToString(p.d)
                }
            }
            return .text(out)
        }
        var n: Double? = nil
        switch v {
        case .number(let x): n = x
        case .bool(let b): n = b ? 1 : 0
        case .empty: n = 0
        case .text(let s): n = s.isEmpty ? 0 : numberFromText(s)
        }
        guard let num = n else {
            if case .text = v { return v }
            return .text(ERR.value)
        }
        let chars = Array(f)
        var i = 0
        while i < chars.count && chars[i] != "0" && chars[i] != "#" { i += 1 }
        if i >= chars.count { return .text(toText(.number(num))) }
        let prefix = String(chars[0..<i])
        var j = i + 1
        while j < chars.count && "#0,.".contains(chars[j]) { j += 1 }
        let pattern = String(chars[i..<j])
        var pct = ""
        if j < chars.count && chars[j] == "%" { pct = "%"; j += 1 }
        let suffix = String(chars[j...])
        let pc = Array(pattern)
        let lastDot = pc.lastIndex(of: ".") ?? -1
        let lastComma = pc.lastIndex(of: ",") ?? -1
        var dec: Character? = nil
        if lastDot >= 0 && lastComma >= 0 {
            dec = lastDot > lastComma ? "." : ","
        } else if lastDot >= 0 || lastComma >= 0 {
            let mark: Character = lastDot >= 0 ? "." : ","
            let at = max(lastDot, lastComma)
            let after = pc.count - at - 1
            dec = after == 3 && pc[0..<at].contains("#") ? nil : mark
        }
        var intPat = pattern
        var fracPat = ""
        if let d = dec, let at = pc.lastIndex(of: d) {
            intPat = String(pc[0..<at])
            fracPat = String(pc[(at + 1)...])
        }
        let decimals = fracPat.filter { $0 == "0" || $0 == "#" }.count
        let minDec = fracPat.filter { $0 == "0" }.count
        let grouping = intPat.contains(".") || intPat.contains(",")
        let value = pct.isEmpty ? num : num * 100
        let body = numberFormat(value, maxFrac: decimals, grouping: grouping, minFrac: minDec)
        return .text("\(prefix.replacingOccurrences(of: "\"", with: ""))\(body)\(pct)\(suffix.replacingOccurrences(of: "\"", with: ""))")
    }

    private static func pickLongId(_ dow: Double) -> String {
        guard dow.isFinite, dow >= 0, dow < 7 else { return "" }
        return DAY_LONG_ID[Int(dow)]
    }
}
