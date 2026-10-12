// A1 <-> index, A1 <-> stored (id-space) translation, separators, reference shifting, R1C1 and range
// shrinking on delete — port of the matching section of sheet-formula.ts.
import Foundation

extension SheetFormula {
    // MARK: - Character classes (ASCII, like the JS regexes)

    @inline(__always) static func isLetter(_ u: UInt32) -> Bool { (u >= 65 && u <= 90) || (u >= 97 && u <= 122) }
    @inline(__always) static func isDigitU(_ u: UInt32) -> Bool { u >= 48 && u <= 57 }
    /// [A-Za-z0-9_]
    @inline(__always) static func isWordU(_ u: UInt32) -> Bool { isLetter(u) || isDigitU(u) || u == 95 }
    /// [A-Za-z0-9_.$]
    @inline(__always) static func isIdentU(_ u: UInt32) -> Bool { isWordU(u) || u == 46 || u == 36 }
    /// [A-Za-z_$]
    @inline(__always) static func isIdentStartU(_ u: UInt32) -> Bool { isLetter(u) || u == 95 || u == 36 }

    static func scalars(_ s: String) -> [UnicodeScalar] { Array(s.unicodeScalars) }
    static func string(_ a: ArraySlice<UnicodeScalar>) -> String {
        var v = String.UnicodeScalarView()
        v.append(contentsOf: a)
        return String(v)
    }
    static func string(_ a: [UnicodeScalar]) -> String { string(a[...]) }

    static func colLetter(_ index: Int) -> String {
        var n = index
        var out = ""
        repeat {
            let code = 65 + (n % 26) // JS remainder keeps the sign: colLetter(-1) is "@"
            out = String(UnicodeScalar(UInt8(clamping: code))) + out
            n = Int((Double(n) / 26).rounded(.down)) - 1
        } while n >= 0
        return out
    }

    static func letterToIndex(_ letters: String) -> Int {
        var n = 0
        for u in letters.uppercased().unicodeScalars {
            n = n &* 26 &+ (Int(u.value) - 64)
        }
        return n - 1
    }

    /// One A1 reference as the scanner sees it (0-based). `row` is nil for "A:A".
    struct A1Ref: Equatable {
        enum Kind { case cell, col }
        var kind: Kind
        var col: Int
        var row: Int
        var absCol: Bool
        var absRow: Bool
    }

    /// CELL_RE: ^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$
    static func parseCellWord(_ w: [UnicodeScalar]) -> (absCol: Bool, letters: String, absRow: Bool, row: Int)? {
        var i = 0
        let absCol = i < w.count && w[i] == "$"
        if absCol { i += 1 }
        let ls = i
        while i < w.count && isLetter(w[i].value) { i += 1 }
        let nl = i - ls
        if nl < 1 || nl > 3 { return nil }
        let letters = string(w[ls..<i])
        let absRow = i < w.count && w[i] == "$"
        if absRow { i += 1 }
        let ds = i
        while i < w.count && isDigitU(w[i].value) { i += 1 }
        if i == ds || i != w.count { return nil }
        let d = Double(string(w[ds..<i])) ?? 0
        return (absCol, letters, absRow, Int(min(d, 1e15)) - 1)
    }

    /// COL_RE: ^(\$?)([A-Za-z]{1,3})$
    static func parseColWord(_ w: [UnicodeScalar]) -> (absCol: Bool, letters: String)? {
        var i = 0
        let absCol = i < w.count && w[i] == "$"
        if absCol { i += 1 }
        let ls = i
        while i < w.count && isLetter(w[i].value) { i += 1 }
        let nl = i - ls
        if nl < 1 || nl > 3 || i != w.count { return nil }
        return (absCol, string(w[ls..<i]))
    }

    /// Index just past a quoted string starting at `i` ("" escapes); may be src.count + 1 when unterminated.
    static func skipString(_ src: [UnicodeScalar], _ i: Int) -> Int {
        var j = i + 1
        while j < src.count {
            if src[j] == "\"" {
                if j + 1 < src.count && src[j + 1] == "\"" { j += 2; continue }
                break
            }
            j += 1
        }
        return j
    }

    static func indexOf(_ src: [UnicodeScalar], _ ch: UnicodeScalar, from: Int) -> Int {
        var j = from
        while j < src.count { if src[j] == ch { return j }; j += 1 }
        return -1
    }

    /// Walk an A1 formula and let `fn` rewrite every reference (nil keeps the text).
    static func mapA1Refs(_ formula: String, _ fn: (A1Ref, String, Int, Int) -> String?) -> String {
        let src = scalars(formula)
        var out = ""
        var i = 0
        while i < src.count {
            let ch = src[i]
            if ch == "\"" {
                let j = skipString(src, i)
                out += string(src[i..<min(j + 1, src.count)])
                i = j + 1
                continue
            }
            if ch == "{" {
                let end = indexOf(src, "}", from: i)
                if end > 0 { out += string(src[i...end]); i = end + 1; continue }
            }
            if isIdentStartU(ch.value) && !(i > 0 && isWordU(src[i - 1].value)) {
                var j = i
                while j < src.count && isIdentU(src[j].value) { j += 1 }
                let wordS = Array(src[i..<j])
                let word = string(wordS)
                var k = j
                while k < src.count && src[k] == " " { k += 1 }
                let isCall = k < src.count && src[k] == "("
                if !isCall, let cell = parseCellWord(wordS) {
                    let ref = A1Ref(kind: .cell, col: letterToIndex(cell.letters), row: cell.row, absCol: cell.absCol, absRow: cell.absRow)
                    out += fn(ref, word, i, j) ?? word
                    i = j
                    continue
                }
                if !isCall, let colA = parseColWord(wordS), j < src.count, src[j] == ":" {
                    var e = j + 1
                    while e < src.count && isIdentU(src[e].value) { e += 1 }
                    let bS = Array(src[(j + 1)..<e])
                    if let colB = parseColWord(bS) {
                        let a = A1Ref(kind: .col, col: letterToIndex(colA.letters), row: -1, absCol: colA.absCol, absRow: false)
                        let b = A1Ref(kind: .col, col: letterToIndex(colB.letters), row: -1, absCol: colB.absCol, absRow: false)
                        let bText = string(bS)
                        out += "\(fn(a, word, i, j) ?? word):\(fn(b, bText, j + 1, e) ?? bText)"
                        i = e
                        continue
                    }
                }
                out += word
                i = j
                continue
            }
            out.unicodeScalars.append(ch)
            i += 1
        }
        return out
    }

    struct A1Range: Equatable {
        var top: Int
        var left: Int
        var bottom: Int
        var right: Int
        var wholeColumn: Bool
    }

    /// Every reference in an A1 formula as a rectangle.
    static func findA1Ranges(_ formula: String) -> [A1Range] {
        var refs: [(ref: A1Ref, start: Int, end: Int)] = []
        _ = mapA1Refs(formula) { ref, _, s, e in refs.append((ref, s, e)); return nil }
        let src = scalars(formula)
        var out: [A1Range] = []
        var i = 0
        while i < refs.count {
            let a = refs[i].ref
            var joined = false
            if i + 1 < refs.count {
                let between = SheetJS.trim(string(src[refs[i].end..<refs[i + 1].start]))
                joined = between == ":"
            }
            let b = joined ? refs[i + 1].ref : a
            if joined { i += 1 }
            if a.kind == .col || b.kind == .col {
                out.append(A1Range(top: 0, left: min(a.col, b.col), bottom: 9_007_199_254_740_991, right: max(a.col, b.col), wholeColumn: true))
            } else {
                out.append(A1Range(top: min(a.row, b.row), left: min(a.col, b.col), bottom: max(a.row, b.row), right: max(a.col, b.col), wholeColumn: false))
            }
            i += 1
        }
        return out
    }

    // MARK: - Separators: stored neutral, shown Indonesian

    enum SheetLocale: String { case id, en }
    static let AMBIGUOUS = "=?"

    enum SepKind { case semi, sep, decComma, decDot, other }

    static func scanSeparators(_ src: [UnicodeScalar], _ visit: (SepKind, Int) -> Void) {
        var i = 0
        while i < src.count {
            let ch = src[i]
            if ch == "\"" {
                let j = skipString(src, i)
                var k = i
                while k <= min(j, src.count - 1) { visit(.other, k); k += 1 }
                i = j + 1
                continue
            }
            if ch == "{" {
                let end = indexOf(src, "}", from: i)
                if end > 0 {
                    var k = i
                    while k <= end { visit(.other, k); k += 1 }
                    i = end + 1
                    continue
                }
            }
            if isIdentStartU(ch.value) {
                var j = i
                while j < src.count && isIdentU(src[j].value) { j += 1 }
                var k = i
                while k < j { visit(.other, k); k += 1 }
                i = j
                continue
            }
            if isDigitU(ch.value) {
                var j = i
                var decimal = false
                while j < src.count {
                    if isDigitU(src[j].value) { visit(.other, j); j += 1; continue }
                    let nextDigit = j + 1 < src.count && isDigitU(src[j + 1].value)
                    if !decimal && (src[j] == "," || src[j] == ".") && nextDigit {
                        visit(src[j] == "," ? .decComma : .decDot, j)
                        decimal = true
                        j += 1
                        continue
                    }
                    break
                }
                i = j
                continue
            }
            visit(ch == ";" ? .semi : ch == "," ? .sep : .other, i)
            i += 1
        }
    }

    /// What people typed -> the neutral form, or nil when its commas are ambiguous.
    static func canonicalFormula(_ a1: String) -> String? {
        let src = scalars(a1)
        var semis = 0, seps = 0, decCommas = 0
        scanSeparators(src) { k, _ in
            switch k {
            case .semi: semis += 1
            case .sep: seps += 1
            case .decComma: decCommas += 1
            default: break
            }
        }
        if semis == 0 && seps > 0 && decCommas > 0 { return nil }
        var out = String.UnicodeScalarView()
        scanSeparators(src) { k, i in
            switch k {
            case .semi: out.append(",")
            case .decComma: out.append(".")
            default: out.append(src[i])
            }
        }
        return String(out)
    }

    /// The neutral form -> how a person in `locale` reads it.
    static func localizeFormula(_ neutral: String, _ locale: SheetLocale = .id) -> String {
        if locale == .en { return neutral }
        let src = scalars(neutral)
        var out = String.UnicodeScalarView()
        scanSeparators(src) { k, i in
            switch k {
            case .sep, .semi: out.append(";")
            case .decDot: out.append(",")
            default: out.append(src[i])
            }
        }
        return String(out)
    }

    static func bindRefs(_ display: String, _ shape: SheetShape) -> String {
        mapA1Refs(display) { ref, _, _, _ in
            guard ref.col >= 0, ref.col < shape.columnIds.count else { return nil }
            let col = shape.columnIds[ref.col]
            if col.isEmpty { return nil }
            if ref.kind == .col { return "{\(ref.absCol ? "$" : "")\(col)!*}" }
            guard ref.row >= 0, ref.row < shape.rowIds.count else { return nil }
            let row = shape.rowIds[ref.row]
            if row.isEmpty { return nil }
            return "{\(ref.absCol ? "$" : "")\(col)!\(ref.absRow ? "$" : "")\(row)}"
        }
    }

    /// "=SUM(B2:B9;A1)" -> stored neutral form with ids baked in.
    static func toStored(_ display: String, _ shape: SheetShape) -> String {
        guard let neutral = canonicalFormula(display) else {
            let body = display.hasPrefix("=") ? String(display.dropFirst()) : display
            return AMBIGUOUS + bindRefs(body, shape)
        }
        return bindRefs(neutral, shape)
    }

    static let STORED_PATTERN = "\\{(\\$?)([^!}]+)!(\\$?)([^}]+)\\}"

    /// Stored form -> what the formula bar shows, using each id's CURRENT position.
    static func toDisplay(_ stored: String, _ shape: SheetShape, _ locale: SheetLocale = .id) -> String {
        if stored.hasPrefix(AMBIGUOUS) { return "=" + refsToA1(String(stored.dropFirst(AMBIGUOUS.count)), shape) }
        return localizeFormula(refsToA1(stored, shape), locale)
    }

    static func indexMap(_ ids: [String]) -> [String: Int] {
        var m: [String: Int] = [:]
        for (i, id) in ids.enumerated() { m[id] = i }
        return m
    }

    static func refsToA1(_ stored: String, _ shape: SheetShape) -> String {
        let colIdx = indexMap(shape.columnIds)
        let rowIdx = indexMap(shape.rowIds)
        return SheetJS.replaceAll(SheetJS.re(STORED_PATTERN), stored) { g in
            let ac = g[1] ?? "", col = g[2] ?? "", ar = g[3] ?? "", row = g[4] ?? ""
            guard let ci = colIdx[col] else { return ERR.ref }
            if row == "*" { return "\(ac)\(colLetter(ci))" }
            guard let ri = rowIdx[row] else { return ERR.ref }
            return "\(ac)\(colLetter(ci))\(ar)\(ri + 1)"
        }
    }

    /// Move a formula by (dRow, dCol) like copy/paste and the fill handle.
    static func shiftFormula(_ a1: String, _ dRow: Int, _ dCol: Int) -> String {
        if dRow == 0 && dCol == 0 { return a1 }
        return mapA1Refs(a1) { ref, _, _, _ in
            let col = ref.absCol ? ref.col : ref.col + dCol
            if col < 0 { return ERR.ref }
            if ref.kind == .col { return "\(ref.absCol ? "$" : "")\(colLetter(col))" }
            let row = ref.absRow ? ref.row : ref.row + dRow
            if row < 0 { return ERR.ref }
            return "\(ref.absCol ? "$" : "")\(colLetter(col))\(ref.absRow ? "$" : "")\(row + 1)"
        }
    }

    /// R1C1 part: "[-1]" (relative), "5" (absolute) or nothing.
    private static func r1c1Part(_ src: [UnicodeScalar], _ i: inout Int) -> (spec: String?, ok: Bool) {
        if i < src.count && src[i] == "[" {
            var j = i + 1
            if j < src.count && src[j] == "-" { j += 1 }
            let ds = j
            while j < src.count && isDigitU(src[j].value) { j += 1 }
            if j == ds || j >= src.count || src[j] != "]" { return (nil, false) }
            let spec = string(src[i...j])
            i = j + 1
            return (spec, true)
        }
        let ds = i
        while i < src.count && isDigitU(src[i].value) { i += 1 }
        return (i > ds ? string(src[ds..<i]) : nil, true)
    }

    /// Google Sheets / Excel R1C1 to A1 for the cell at (row, col), 0-based.
    static func r1c1ToA1(_ formula: String, _ row: Int, _ col: Int) -> String {
        let src = scalars(formula)
        var out = ""
        var i = 0
        while i < src.count {
            let ch = src[i]
            if ch == "\"" {
                let j = skipString(src, i)
                out += string(src[i..<min(j + 1, src.count)])
                i = j + 1
                continue
            }
            let prevWord = i > 0 && isWordU(src[i - 1].value)
            if (ch == "R" || ch == "r") && !prevWord {
                var j = i + 1
                let rp = r1c1Part(src, &j)
                // The regex backtracks an unmatched "[" to "no part"; an empty part is then followed by C.
                var matched = false
                var rSpec: String? = nil, cSpec: String? = nil
                var end = j
                if rp.ok, j < src.count, src[j] == "C" || src[j] == "c" {
                    var k = j + 1
                    let cp = r1c1Part(src, &k)
                    func bad(_ p: Int) -> Bool { p < src.count && (isWordU(src[p].value) || src[p] == "(") }
                    if cp.ok && !bad(k) {
                        matched = true; rSpec = rp.spec; cSpec = cp.spec; end = k
                    } else if !bad(j + 1) {
                        // Backtrack: no column part, the lookahead sees what follows "C".
                        matched = true; rSpec = rp.spec; cSpec = nil; end = j + 1
                    }
                }
                if matched {
                    func part(_ spec: String?, _ base: Int) -> (v: Int, abs: Bool) {
                        guard let s = spec else { return (base, false) }
                        if s.hasPrefix("[") { return (base + (Int(s.dropFirst().dropLast()) ?? 0), false) }
                        return ((Int(s) ?? 0) - 1, true)
                    }
                    let r = part(rSpec, row)
                    let c = part(cSpec, col)
                    if r.v < 0 || c.v < 0 { out += ERR.ref } else {
                        out += "\(c.abs ? "$" : "")\(colLetter(c.v))\(r.abs ? "$" : "")\(r.v + 1)"
                    }
                    i = end
                    continue
                }
            }
            out.unicodeScalars.append(ch)
            i += 1
        }
        return out
    }

    /// After rows/columns are deleted: shrink every range whose CORNER was deleted. `shape` is the
    /// shape BEFORE the deletion.
    static func rewriteForDeletion(_ stored: String, _ shape: SheetShape, rows delRows: Set<String> = [], cols delCols: Set<String> = []) -> String {
        if delRows.isEmpty && delCols.isEmpty { return stored }
        let colIdx = indexMap(shape.columnIds)
        let rowIdx = indexMap(shape.rowIds)
        let pattern = "\\{(\\$?)([^!}]+)!(\\$?)([^}]+)\\}:\\{(\\$?)([^!}]+)!(\\$?)([^}]+)\\}"
        return SheetJS.replaceAll(SheetJS.re(pattern), stored) { g in
            let whole = g[0] ?? ""
            let ac1 = g[1] ?? "", c1 = g[2] ?? "", ar1 = g[3] ?? "", r1 = g[4] ?? ""
            let ac2 = g[5] ?? "", c2 = g[6] ?? "", ar2 = g[7] ?? "", r2 = g[8] ?? ""
            let touched = delCols.contains(c1) || delCols.contains(c2) || (r1 != "*" && delRows.contains(r1)) || (r2 != "*" && delRows.contains(r2))
            if !touched { return whole }
            guard let ci1 = colIdx[c1], let ci2 = colIdx[c2] else { return whole }
            let cLo = min(ci1, ci2), cHi = max(ci1, ci2)
            var nl = cLo, nh = cHi
            while nl <= cHi && delCols.contains(shape.columnIds[nl]) { nl += 1 }
            while nh >= cLo && delCols.contains(shape.columnIds[nh]) { nh -= 1 }
            if nl > nh { return ERR.ref }
            let ordered = ci1 <= ci2
            let loAc = ordered ? ac1 : ac2, hiAc = ordered ? ac2 : ac1
            let colLo = shape.columnIds[nl], colHi = shape.columnIds[nh]
            if r1 == "*" || r2 == "*" { return "{\(loAc)\(colLo)!*}:{\(hiAc)\(colHi)!*}" }
            guard let ri1 = rowIdx[r1], let ri2 = rowIdx[r2] else { return whole }
            let rLo = min(ri1, ri2), rHi = max(ri1, ri2)
            let topAbs = ri1 <= ri2 ? ar1 : ar2
            let botAbs = ri1 <= ri2 ? ar2 : ar1
            var tl = rLo, th = rHi
            while tl <= rHi && delRows.contains(shape.rowIds[tl]) { tl += 1 }
            while th >= rLo && delRows.contains(shape.rowIds[th]) { th -= 1 }
            if tl > th { return ERR.ref }
            return "{\(loAc)\(colLo)!\(topAbs)\(shape.rowIds[tl])}:{\(hiAc)\(colHi)!\(botAbs)\(shape.rowIds[th])}"
        }
    }

    /// Put named ranges into a stored formula (bare words that are defined names become their range).
    static func resolveNames(_ f: String, _ names: [String: String]?) -> String {
        guard let names = names, !names.isEmpty else { return f }
        let src = scalars(f)
        var out = ""
        var i = 0
        while i < src.count {
            let ch = src[i]
            if ch == "\"" {
                let j = skipString(src, i)
                out += string(src[i..<min(j + 1, src.count)])
                i = j + 1
                continue
            }
            if ch == "{" {
                let end = indexOf(src, "}", from: i)
                if end > 0 { out += string(src[i...end]); i = end + 1; continue }
            }
            let u = ch.value
            if (isLetter(u) || u == 95) && !(i > 0 && isIdentU(src[i - 1].value)) {
                var j = i
                while j < src.count && (isWordU(src[j].value) || src[j] == ".") { j += 1 }
                let word = string(src[i..<j])
                var k = j
                while k < src.count && src[k] == " " { k += 1 }
                let blocked = k < src.count && (src[k] == "(" || src[k] == "!")
                out += (blocked ? nil : names[word.uppercased()]) ?? word
                i = j
                continue
            }
            out.unicodeScalars.append(ch)
            i += 1
        }
        return out
    }
}
