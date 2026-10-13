// Custom number formats (Sheets/Excel pattern syntax, Format › Number › Custom …) — port of the
// pattern section of sheet-formula.ts. Up to four ";" sections (positive; negative; zero; text),
// colours, [>100] conditions, 0 # ? digits, grouping / scaling commas, %, E+00, fractions, _x / *x,
// "literal" and \x escapes, @ text, [$€] currency and date/time tokens. Output uses the display
// locale's marks and month names.
import Foundation

extension SheetFormula {
    struct PatternResult: Equatable {
        var text: String
        var color: String? = nil
    }

    enum PTok: Equatable {
        case lit(String)
        case ph(Character) // "0" | "#" | "?"
        case dot, comma, pct
        case exp(s: String, plus: Bool)
        case at, slash
        case digit(String)
        case date(s: String, raw: String)
        case ampm(String)
        case elapsed(u: Character, n: Int)
        case general

        var isPh: Bool { if case .ph = self { return true }; return false }
        var isDot: Bool { if case .dot = self { return true }; return false }
        var isComma: Bool { if case .comma = self { return true }; return false }
        var phChar: Character { if case .ph(let c) = self { return c }; return "0" }
        var dateLead: Character? { if case .date(let s, _) = self { return s.first }; return nil }
        var elapsedUnit: Character? { if case .elapsed(let u, _) = self { return u }; return nil }
        var isAtOrGeneral: Bool {
            switch self {
            case .at, .general: return true
            default: return false
            }
        }
    }

    struct PCond: Equatable { var op: String; var v: Double }
    struct PSection {
        var toks: [PTok]
        var color: String?
        var cond: PCond?
        var date: Bool
        var text: Bool
    }

    static let PATTERN_COLORS: [String: String] = [
        "black": "#000000", "white": "#ffffff", "red": "#ff0000", "green": "#00ff00", "blue": "#0000ff",
        "yellow": "#ffff00", "magenta": "#ff00ff", "cyan": "#00ffff",
    ]
    static let PATTERN_COLOR56: [String] = [
        "#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff", "#800000", "#008000",
        "#000080", "#808000", "#800080", "#008080", "#c0c0c0", "#808080", "#9999ff", "#993366", "#ffffcc", "#ccffff",
        "#660066", "#ff8080", "#0066cc", "#ccccff", "#000080", "#ff00ff", "#ffff00", "#00ffff", "#800080", "#800000",
        "#008080", "#0000ff", "#00ccff", "#ccffff", "#ccffcc", "#ffff99", "#99ccff", "#ff99cc", "#cc99ff", "#ffcc99",
        "#3366ff", "#33cccc", "#99cc00", "#ffcc00", "#ff9900", "#ff6600", "#666699", "#969696", "#003366", "#339966",
        "#003300", "#333300", "#993300", "#993366", "#333399", "#333333",
    ]

    static func splitPatternSections(_ p: String) -> [String] {
        let c = Array(p)
        var out: [String] = []
        var cur = ""
        var i = 0
        while i < c.count {
            let ch = c[i]
            if ch == "\"" {
                var j = i + 1
                while j < c.count && c[j] != "\"" { j += 1 }
                let end = j >= c.count ? c.count - 1 : j
                cur += String(c[i...end])
                i = end
            } else if ch == "\\" || ch == "_" || ch == "*" {
                cur.append(ch)
                if i + 1 < c.count { cur.append(c[i + 1]) }
                i += 1
            } else if ch == "[" {
                var j = i
                while j < c.count && c[j] != "]" { j += 1 }
                if j >= c.count { cur.append(ch); i += 1; continue }
                cur += String(c[i...j])
                i = j
            } else if ch == ";" {
                out.append(cur)
                cur = ""
            } else {
                cur.append(ch)
            }
            i += 1
        }
        out.append(cur)
        return out
    }

    private static func lowerHasPrefix(_ c: [Character], _ i: Int, _ word: String) -> Bool {
        let w = Array(word)
        if i + w.count > c.count { return false }
        for k in 0..<w.count where String(c[i + k]).lowercased() != String(w[k]) { return false }
        return true
    }

    private static func bracket(_ inner: String, _ toks: inout [PTok], _ color: inout String?, _ cond: inout PCond?, _ lit: (String, inout [PTok]) -> Void) {
        if let m = SheetJS.match(SheetJS.re("^(h+|m+|s+)\\z", true), inner) {
            let w = m[1]!
            toks.append(.elapsed(u: Character(w.prefix(1).lowercased()), n: w.count))
        } else if let m = SheetJS.match(SheetJS.re("^(<=|>=|<>|<|>|=)\\s*(-?[0-9]+(?:\\.[0-9]+)?)\\z"), inner) {
            cond = PCond(op: m[1]!, v: Double(m[2]!) ?? 0)
        } else if let m = SheetJS.match(SheetJS.re("^\\$([^-]*)(?:-[0-9a-f]+)?\\z", true), inner) {
            if let s = m[1], !s.isEmpty { lit(s, &toks) }
        } else if let m = SheetJS.match(SheetJS.re("^colou?r\\s*([0-9]+)\\z", true), inner) {
            let n = Int(m[1]!) ?? 0
            if n >= 1 && n <= PATTERN_COLOR56.count { color = PATTERN_COLOR56[n - 1] }
        } else if let c = PATTERN_COLORS[inner.lowercased()] {
            color = c
        }
    }

    static func parsePatternSection(_ srcStr: String) -> PSection {
        let src = Array(srcStr)
        var toks: [PTok] = []
        var color: String?
        var cond: PCond?
        func lit(_ s: String, _ t: inout [PTok]) {
            if case .lit(let prev)? = t.last { t[t.count - 1] = .lit(prev + s) } else { t.append(.lit(s)) }
        }
        var i = 0
        while i < src.count {
            let ch = src[i]
            if ch == "\"" {
                var j = i + 1
                while j < src.count && src[j] != "\"" { j += 1 }
                lit(String(src[min(i + 1, src.count)..<j]), &toks)
                i = j + 1
                continue
            }
            if ch == "\\" { if i + 1 < src.count { lit(String(src[i + 1]), &toks) }; i += 2; continue }
            if ch == "_" { lit(" ", &toks); i += 2; continue }
            if ch == "*" { if i + 1 < src.count && src[i + 1] == " " { lit(" ", &toks) }; i += 2; continue }
            if ch == "[" {
                var j = i
                while j < src.count && src[j] != "]" { j += 1 }
                if j >= src.count { lit(String(ch), &toks); i += 1; continue }
                let inner = String(src[(i + 1)..<j])
                i = j + 1
                bracket(inner, &toks, &color, &cond, lit)
                continue
            }
            if ch == "0" || ch == "#" || ch == "?" { toks.append(.ph(ch)); i += 1; continue }
            if ch == "." { toks.append(.dot); i += 1; continue }
            if ch == "," { toks.append(.comma); i += 1; continue }
            if ch == "%" { toks.append(.pct); i += 1; continue }
            if ch == "@" { toks.append(.at); i += 1; continue }
            if ch == "/" { toks.append(.slash); i += 1; continue }
            if (ch == "E" || ch == "e") && i + 1 < src.count && (src[i + 1] == "+" || src[i + 1] == "-") {
                toks.append(.exp(s: String(ch), plus: src[i + 1] == "+"))
                i += 2
                continue
            }
            if ch >= "1" && ch <= "9" { toks.append(.digit(String(ch))); i += 1; continue }
            if lowerHasPrefix(src, i, "general") { toks.append(.general); i += 7; continue }
            if lowerHasPrefix(src, i, "am/pm") { toks.append(.ampm(String(src[i..<(i + 5)]))); i += 5; continue }
            if lowerHasPrefix(src, i, "a/p") { toks.append(.ampm(String(src[i..<(i + 3)]))); i += 3; continue }
            let lc = String(ch).lowercased()
            if lc == "y" || lc == "m" || lc == "d" || lc == "h" || lc == "s" {
                var j = i
                while j + 1 < src.count && String(src[j + 1]).lowercased() == lc { j += 1 }
                let raw = String(src[i...j])
                toks.append(.date(s: raw.lowercased(), raw: raw))
                i = j + 1
                continue
            }
            lit(String(ch), &toks)
            i += 1
        }
        let hasDate = toks.contains { t in
            switch t {
            case .date, .ampm, .elapsed: return true
            default: return false
            }
        }
        var fracSecondsOnly = true
        for idx in 0..<toks.count where toks[idx].isPh {
            var j = idx - 1
            while j >= 0 && toks[j].isPh { j -= 1 }
            let before: PTok? = j - 1 >= 0 ? toks[j - 1] : nil
            let dotHere = j >= 0 && toks[j].isDot
            var ok = false
            if dotHere, let b = before {
                ok = b.dateLead == "s" || b.elapsedUnit == "s"
            }
            if !ok { fracSecondsOnly = false; break }
        }
        let date = hasDate && fracSecondsOnly
        let hasAt = toks.contains { $0 == .at }
        let hasPhOrGeneral = toks.contains { $0.isPh || $0 == .general }
        let text = !date && hasAt && !hasPhOrGeneral
        return PSection(toks: toks, color: color, cond: cond, date: date, text: text)
    }

    private static var patternCache: [String: [PSection]] = [:]
    private static let patternLock = NSLock()
    static func patternSections(_ pattern: String) -> [PSection] {
        patternLock.lock()
        defer { patternLock.unlock() }
        if let s = patternCache[pattern] { return s }
        let secs = splitPatternSections(pattern).prefix(4).map { parsePatternSection($0) }
        if patternCache.count > 500 { patternCache.removeAll() }
        patternCache[pattern] = Array(secs)
        return Array(secs)
    }

    static func condHolds(_ c: PCond, _ n: Double) -> Bool {
        switch c.op {
        case "<": return n < c.v
        case "<=": return n <= c.v
        case ">": return n > c.v
        case ">=": return n >= c.v
        case "<>": return n != c.v
        default: return n == c.v
        }
    }

    /// x rounded to f decimals as a plain digit string.
    static func fixedDigits(_ x: Double, _ f: Int) -> String {
        if abs(x) < 1e15 {
            let shifted = SheetJS.stringToNumber("\(SheetJS.numberToString(x))e\(f)")
            if shifted.isFinite { return SheetJS.toFixed(SheetJS.round(shifted) / SheetJS.pow(10, Double(f)), f) }
        }
        return SheetJS.toFixed(x, f)
    }

    static func groupDigits(_ digits: String) -> String {
        // digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep) — group every run of digits.
        let sep = groupMark()
        let chars = Array(digits)
        var out = ""
        var i = 0
        while i < chars.count {
            if chars[i].isASCII && chars[i].isNumber {
                var j = i
                while j < chars.count && chars[j].isASCII && chars[j].isNumber { j += 1 }
                let run = chars[i..<j]
                for (k, c) in run.enumerated() {
                    if k > 0 && (run.count - k) % 3 == 0 { out += sep }
                    out.append(c)
                }
                i = j
            } else {
                out.append(chars[i])
                i += 1
            }
        }
        return out
    }

    /// Fill integer placeholders right-to-left; the leftmost one takes every remaining digit.
    static func fillInt(_ digits: String, _ phs: [Character]) -> [String] {
        var out = Array(repeating: "", count: phs.count)
        var rest = Array(digits)
        var k = phs.count - 1
        while k >= 0 {
            if !rest.isEmpty {
                if k == 0 { out[k] = String(rest); rest = [] } else { out[k] = String(rest.removeLast()) }
            } else {
                out[k] = phs[k] == "0" ? "0" : phs[k] == "?" ? " " : ""
            }
            k -= 1
        }
        return out
    }

    static func phChars(_ toks: [PTok], _ idx: [Int]) -> [Character] { idx.map { toks[$0].phChar } }

    static func literalText(_ t: PTok) -> String {
        switch t {
        case .lit(let s), .digit(let s): return s
        case .dot: return "."
        case .comma: return ","
        case .pct: return "%"
        case .slash: return "/"
        case .date(_, let raw): return raw
        case .ampm(let s): return s
        case .exp(let s, let plus): return s + (plus ? "+" : "-")
        case .ph(let c): return c == "?" ? " " : String(c)
        default: return ""
        }
    }

    static func renderPlainNumber(_ x: Double, _ toks: [PTok]) -> String {
        let ph = toks.indices.filter { toks[$0].isPh }
        if ph.isEmpty {
            return toks.map { $0.isAtOrGeneral ? formatValue(.number(x), nil) : literalText($0) }.joined()
        }
        let first = ph[0], last = ph[ph.count - 1]
        var dec = -1
        for i in 0..<toks.count where toks[i].isDot {
            if (i > first && i <= last + 1) || i == first - 1 { dec = i; break }
        }
        let intIdx = ph.filter { dec < 0 || $0 < dec }
        let fracIdx = ph.filter { dec >= 0 && $0 > dec }
        var skip = Set<Int>()
        var grouping = false
        var scale = 0
        if let f0 = intIdx.first, let li = intIdx.last {
            var i = f0 + 1
            while i < li { if toks[i].isComma { grouping = true; skip.insert(i) }; i += 1 }
            i = li + 1
            while i < toks.count && toks[i].isComma { scale += 1; skip.insert(i); i += 1 }
        }
        let pcts = toks.filter { $0 == .pct }.count
        let value = (x * SheetJS.pow(100, Double(pcts))) / SheetJS.pow(1000, Double(scale))
        let fixed = fixedDigits(value, fracIdx.count)
        let parts = fixed.split(separator: ".", maxSplits: 1, omittingEmptySubsequences: false)
        let intRaw = String(parts[0])
        let fracRaw = parts.count > 1 ? String(parts[1]) : ""
        let intDigits = intRaw == "0" ? "" : intRaw
        let intFill = fillInt(intDigits, phChars(toks, intIdx))
        var intMap: [Int: String] = [:]
        if grouping {
            let joined = intFill.joined()
            let lead = String(joined.prefix { $0 == " " })
            intMap[intIdx[0]] = lead + groupDigits(String(joined.dropFirst(lead.count)))
            for i in intIdx.dropFirst() { intMap[i] = "" }
        } else {
            for (k, i) in intIdx.enumerated() { intMap[i] = intFill[k] }
        }
        let fracPh = phChars(toks, fracIdx)
        var fracOut = fracRaw.map { String($0) }
        var k = fracOut.count - 1
        while k >= 0 {
            let p: Character? = k < fracPh.count ? fracPh[k] : nil
            if fracOut[k] != "0" || p == "0" { break }
            fracOut[k] = p == "?" ? " " : ""
            k -= 1
        }
        var fracMap: [Int: String] = [:]
        for (k2, i) in fracIdx.enumerated() { fracMap[i] = k2 < fracOut.count ? fracOut[k2] : "" }
        var out = ""
        for i in 0..<toks.count {
            if skip.contains(i) { continue }
            if let s = intMap[i] { out += s } else if let s = fracMap[i] { out += s } else if i == dec {
                out += (intIdx.isEmpty ? intDigits : "") + decimalMark()
            } else if toks[i].isAtOrGeneral {
                continue
            } else {
                out += literalText(toks[i])
            }
        }
        return out
    }

    static func renderScientific(_ x: Double, _ toks: [PTok], _ expAt: Int) -> String {
        let mant = Array(toks[0..<expAt])
        guard case .exp(let es, let plus) = toks[expAt] else { return "" }
        var j = expAt + 1
        var expPh: [Character] = []
        while j < toks.count && toks[j].isPh { expPh.append(toks[j].phChar); j += 1 }
        let after = toks[j...]
        var d = -1
        for i in 0..<mant.count where mant[i].isDot { d = i; break }
        let intCount = mant.indices.filter { mant[$0].isPh && (d < 0 || $0 < d) }.count
        let fracCount = d < 0 ? 0 : mant.indices.filter { mant[$0].isPh && $0 > d }.count
        var e: Double = 0
        if x != 0 {
            e = log10(x).rounded(.down)
            if intCount > 1 { e = (e / Double(intCount)).rounded(.down) * Double(intCount) } else if intCount == 0 { e += 1 }
        }
        var m = x / SheetJS.pow(10, e)
        if x != 0 && intCount <= 1 {
            let limit: Double = intCount == 0 ? 1 : 10
            if SheetJS.stringToNumber(fixedDigits(m, fracCount)) >= limit { e += 1; m = x / SheetJS.pow(10, e) }
        }
        let body = renderPlainNumber(m, mant)
        let sign = e < 0 ? "-" : plus ? "+" : ""
        let minDigits = expPh.filter { $0 == "0" }.count
        let expDigits = padStart(SheetJS.numberToString(abs(e)), minDigits)
        return "\(body)\(es)\(sign)\(expDigits)\(after.map { literalText($0) }.joined())"
    }

    static func approxFraction(_ f: Double, _ maxDen: Int) -> (Double, Double) {
        var best = (SheetJS.round(f), 1.0)
        var err = abs(f - best.0)
        var den = 2
        while den <= maxDen && err > 1e-12 {
            let num = SheetJS.round(f * Double(den))
            let e = abs(f - num / Double(den))
            if e < err - 1e-12 { best = (num, Double(den)); err = e }
            den += 1
        }
        return best
    }

    static func renderFraction(_ x: Double, _ toks: [PTok], _ slashAt: Int) -> String {
        var a = slashAt - 1
        while a >= 0 && toks[a].isPh { a -= 1 }
        let numIdx = Array((a + 1)..<slashAt)
        var b = slashAt + 1
        var denIdx: [Int] = []
        while b < toks.count {
            if toks[b].isPh { denIdx.append(b); b += 1; continue }
            if case .digit = toks[b] { denIdx.append(b); b += 1; continue }
            break
        }
        let denText = denIdx.map { i -> String in
            if case .digit(let s) = toks[i] { return s }
            return String(toks[i].phChar)
        }.joined()
        let fixedDen: Double = SheetJS.fullMatch(SheetJS.re("^[1-9][0-9]*\\z"), denText) ? (Double(denText) ?? 0) : 0
        let intIdx = toks.indices.filter { toks[$0].isPh && $0 <= a }
        var whole: Double = intIdx.isEmpty ? 0 : x.rounded(.down)
        let f = x - whole
        var nu: Double, de: Double
        if fixedDen != 0 {
            nu = SheetJS.round(f * fixedDen); de = fixedDen
        } else {
            let maxDen = Int(SheetJS.pow(10, Double(denIdx.count))) - 1
            (nu, de) = approxFraction(f, maxDen)
        }
        if !intIdx.isEmpty && nu == de && de > 0 { whole += 1; nu = 0 }
        let intFill = fillInt(whole != 0 ? SheetJS.numberToString(whole) : "", phChars(toks, intIdx))
        let numFill = fillInt(SheetJS.numberToString(nu), phChars(toks, numIdx))
        var denOut = SheetJS.numberToString(de)
        if fixedDen == 0 {
            let denPh = phChars(toks, denIdx)
            while denOut.count < denPh.count {
                let c = denPh[denOut.count]
                denOut += c == "?" ? " " : c == "0" ? "0" : ""
                if c == "#" { break }
            }
        }
        let dropFraction = !intIdx.isEmpty && nu == 0
        let lastInt = intIdx.last ?? -1
        var out = ""
        for i in 0..<toks.count {
            if let k = intIdx.firstIndex(of: i) { out += intFill[k]; continue }
            if i > a && i < b {
                if dropFraction { continue }
                if let nk = numIdx.firstIndex(of: i) { out += numFill[nk] } else if i == slashAt { out += "/" + denOut }
                continue
            }
            if dropFraction && i > lastInt && i <= a { continue }
            out += toks[i].isAtOrGeneral ? "" : literalText(toks[i])
        }
        if dropFraction && whole == 0 && out.unicodeScalars.allSatisfy({ SheetJS.isSpace($0.value) }) { out = "0" }
        return out
    }

    static func renderNumberSection(_ x: Double, _ sec: PSection) -> String {
        let toks = sec.toks
        if let expAt = toks.firstIndex(where: { if case .exp = $0 { return true }; return false }),
           toks[0..<expAt].contains(where: { $0.isPh }) {
            return renderScientific(x, toks, expAt)
        }
        let slashAt = toks.indices.first { i in
            guard toks[i] == .slash, i > 0, toks[i - 1].isPh, i + 1 < toks.count else { return false }
            if toks[i + 1].isPh { return true }
            if case .digit = toks[i + 1] { return true }
            return false
        }
        if let s = slashAt { return renderFraction(x, toks, s) }
        return renderPlainNumber(x, toks)
    }

    private static func timeish(_ t: PTok?, _ unitCh: Character) -> Bool {
        guard let t = t else { return false }
        return t.dateLead == unitCh || t.elapsedUnit == unitCh
    }

    static func renderDateSection(_ n: Double, _ sec: PSection) -> String {
        let toks = sec.toks
        let elapsed = toks.contains { $0.elapsedUnit != nil }
        let neg = n < 0
        let v = abs(n)
        var fracDigits = 0
        var i = 0
        while i < toks.count {
            if !toks[i].isPh { i += 1; continue }
            var c = 0
            while i + c < toks.count && toks[i + c].isPh { c += 1 }
            fracDigits = max(fracDigits, min(c, 3))
            i += c + 1
        }
        let unit = SheetJS.pow(10, Double(fracDigits))
        let totalUnits = SheetJS.round(v * 86400 * unit)
        let totalSec = (totalUnits / unit).rounded(.down)
        let fracUnits = totalUnits - totalSec * unit
        let day = (totalSec / 86400).rounded(.down)
        let sod = totalSec - day * 86400
        let H = (sod / 3600).rounded(.down)
        let M = (sod.truncatingRemainder(dividingBy: 3600) / 60).rounded(.down)
        let S = sod.truncatingRemainder(dividingBy: 60)
        let ymd = serialToYmdD(day)
        let dow = weekdayOf(day)
        let ampm = toks.contains { if case .ampm = $0 { return true }; return false }
        let sig = toks.indices.filter { idx in
            switch toks[idx] {
            case .date, .elapsed, .ampm: return true
            default: return false
            }
        }
        var minuteAt = Set<Int>()
        for (k, idx) in sig.enumerated() {
            guard case .date(let s, _) = toks[idx], s.first == "m", s.count <= 2 else { continue }
            let prev: PTok? = k > 0 ? toks[sig[k - 1]] : nil
            let next: PTok? = k + 1 < sig.count ? toks[sig[k + 1]] : nil
            if timeish(prev, "h") || timeish(next, "s") { minuteAt.insert(idx) }
        }
        let num = SheetJS.numberToString
        var out = ""
        i = 0
        while i < toks.count {
            let t = toks[i]
            switch t {
            case .date(let s, _):
                let len = s.count
                switch s.first! {
                case "y": out += len <= 2 ? pad2(ymd.y.truncatingRemainder(dividingBy: 100)) : num(ymd.y)
                case "d": out += len == 1 ? num(ymd.d) : len == 2 ? pad2(ymd.d) : weekdayName(dow, len >= 4)
                case "h":
                    var h = H
                    if ampm { h = H.truncatingRemainder(dividingBy: 12); if h == 0 { h = 12 } }
                    out += len == 1 ? num(h) : pad2(h)
                case "s": out += len == 1 ? num(S) : pad2(S)
                default:
                    if minuteAt.contains(i) {
                        out += len == 1 ? num(M) : pad2(M)
                    } else if len == 1 {
                        out += num(ymd.m)
                    } else if len == 2 {
                        out += pad2(ymd.m)
                    } else if len == 3 {
                        out += monthName(ymd.m, false)
                    } else if len == 4 {
                        out += monthName(ymd.m, true)
                    } else {
                        out += String(monthName(ymd.m, true).prefix(1))
                    }
                }
            case .elapsed(let u, let nn):
                let total = u == "h" ? (totalSec / 3600).rounded(.down) : u == "m" ? (totalSec / 60).rounded(.down) : totalSec
                out += padStart(num(total), nn)
            case .ampm(let s):
                let pm = H >= 12
                let word = s.count > 3 ? (pm ? "PM" : "AM") : (pm ? "P" : "A")
                let first = String(s.prefix(1))
                out += first == first.lowercased() ? word.lowercased() : word
            case .ph:
                var c = 0
                while i + c < toks.count && toks[i + c].isPh { c += 1 }
                out += String(padStart(num(fracUnits), fracDigits).prefix(c))
                i += c - 1
            default:
                out += t.isAtOrGeneral ? "" : literalText(t)
            }
            i += 1
        }
        return neg && (elapsed || !out.isEmpty) ? "-\(out)" : out
    }

    /// A value under a Sheets custom number format, in the display locale.
    static func formatNumberPattern(_ value: SheetCellValue, _ pattern: String) -> PatternResult {
        switch value {
        case .empty: return PatternResult(text: "")
        case .bool(let b): return PatternResult(text: b ? "TRUE" : "FALSE")
        case .text(let s):
            if s.isEmpty { return PatternResult(text: "") }
            let secs = patternSections(pattern)
            let sec: PSection? = secs.count > 3 ? secs[3] : (secs.count == 1 && secs[0].text ? secs[0] : nil)
            guard let sc = sec, !isError(value) else { return PatternResult(text: s) }
            let t = sc.toks.map { $0 == .at ? s : literalText($0) }.joined()
            return PatternResult(text: t, color: sc.color)
        case .number(let n):
            if !n.isFinite { return PatternResult(text: ERR.num) }
            let secs = patternSections(pattern)
            let s0 = secs[0]
            let s1: PSection? = secs.count > 1 ? secs[1] : nil
            let s2: PSection? = secs.count > 2 ? secs[2] : nil
            var sec: PSection
            var which = 0
            var signed = false
            if s0.cond != nil || s1?.cond != nil {
                let firstOk = s0.cond.map { condHolds($0, n) } ?? (n > 0 || (n == 0 && s2 == nil))
                if firstOk {
                    sec = s0
                } else if let one = s1, one.cond == nil || condHolds(one.cond!, n) {
                    sec = one; which = 1
                } else if let two = s2 {
                    sec = two; which = 2
                } else if let one = s1 {
                    sec = one; which = 1
                } else {
                    sec = s0
                }
                signed = n < 0 && !(which == 1 && s1?.cond == nil)
            } else if n > 0 || (n == 0 && s2 == nil) || (n < 0 && s1 == nil) {
                sec = s0
                signed = n < 0
            } else if n < 0 {
                sec = s1!
            } else {
                sec = s2!
            }
            if sec.text { return PatternResult(text: formatValue(.number(n), nil), color: sec.color) }
            if sec.date { return PatternResult(text: renderDateSection(signed ? n : abs(n), sec), color: sec.color) }
            let body = renderNumberSection(abs(n), sec)
            let hasNZ = body.contains { $0 >= "1" && $0 <= "9" }
            return PatternResult(text: signed && hasNZ ? "-\(body)" : body, color: sec.color)
        }
    }
}
