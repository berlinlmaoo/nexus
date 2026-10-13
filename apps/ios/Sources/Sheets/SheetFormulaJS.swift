// JavaScript-compatible primitives for the spreadsheet engine port.
//
// The web/server engine (apps/web/src/lib/sheet-formula.ts) is JavaScript, and its
// results depend on JS semantics: Number#toString (shortest round-trip), toFixed / toPrecision,
// Math.round (half up), Number(string), parseFloat, UTF-16 string lengths, Intl.NumberFormat
// (shortest decimal + half-expand rounding) and String#localeCompare("id"). This file reproduces
// exactly those so the Swift engine prints the same text as the web grid. Foundation only.
import Foundation

enum SheetJS {
    // MARK: - Whitespace / strings

    /// JS `\s` / String#trim whitespace set.
    static func isSpace(_ u: UInt32) -> Bool {
        switch u {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
            return true
        default:
            return false
        }
    }

    /// String#trim.
    static func trim(_ s: String) -> String {
        let scalars = Array(s.unicodeScalars)
        var a = 0
        var b = scalars.count
        while a < b && isSpace(scalars[a].value) { a += 1 }
        while b > a && isSpace(scalars[b - 1].value) { b -= 1 }
        if a == 0 && b == scalars.count { return s }
        var out = String.UnicodeScalarView()
        out.append(contentsOf: scalars[a..<b])
        return String(out)
    }

    static func trimStart(_ s: String) -> String {
        let scalars = Array(s.unicodeScalars)
        var a = 0
        while a < scalars.count && isSpace(scalars[a].value) { a += 1 }
        var out = String.UnicodeScalarView()
        out.append(contentsOf: scalars[a...])
        return String(out)
    }

    /// UTF-16 units of a string (JS string indexing).
    @inline(__always) static func u16(_ s: String) -> [UInt16] { Array(s.utf16) }
    @inline(__always) static func str(_ u: ArraySlice<UInt16>) -> String { String(decoding: u, as: UTF16.self) }
    @inline(__always) static func str(_ u: [UInt16]) -> String { String(decoding: u, as: UTF16.self) }

    /// String#length.
    static func length(_ s: String) -> Int { s.utf16.count }

    /// String#slice(start, end) with JS index clamping.
    static func slice(_ s: String, _ start: Int, _ end: Int? = nil) -> String {
        let u = u16(s)
        let n = u.count
        var a = start < 0 ? max(n + start, 0) : min(start, n)
        var b = end.map { $0 < 0 ? max(n + $0, 0) : min($0, n) } ?? n
        if a > n { a = n }
        if b < a { b = a }
        return str(u[a..<b])
    }

    /// String#substr(start, length).
    static func substr(_ s: String, _ start: Double, _ length: Double?) -> String {
        let u = u16(s)
        let size = Double(u.count)
        var st = toIntegerOrInfinity(start)
        if st == -.infinity { st = 0 } else if st < 0 { st = max(size + st, 0) } else { st = min(st, size) }
        let len: Double = length.map { toIntegerOrInfinity($0) } ?? size
        let resultLen = min(max(len, 0), size - st)
        if resultLen <= 0 { return "" }
        let a = Int(st)
        return str(u[a..<(a + Int(resultLen))])
    }

    /// String#indexOf(search, position).
    static func indexOf(_ s: String, _ search: String, _ position: Double = 0) -> Int {
        let h = u16(s)
        let n = u16(search)
        var p = toIntegerOrInfinity(position)
        if p.isNaN { p = 0 }
        let start = Int(min(max(p, 0), Double(h.count)))
        if n.isEmpty { return start }
        if n.count > h.count { return -1 }
        var i = start
        while i + n.count <= h.count {
            if h[i] == n[0] {
                var ok = true
                var k = 1
                while k < n.count { if h[i + k] != n[k] { ok = false; break }; k += 1 }
                if ok { return i }
            }
            i += 1
        }
        return -1
    }

    static func toIntegerOrInfinity(_ x: Double) -> Double {
        if x.isNaN { return 0 }
        if x.isInfinite { return x }
        return x < 0 ? -(-x).rounded(.down) : x.rounded(.down)
    }

    // MARK: - Numbers

    /// Math.round: half toward +Infinity, keeps -0 for negative inputs that round to zero.
    static func round(_ x: Double) -> Double {
        if !x.isFinite { return x }
        let f = x.rounded(.down)
        let r = (x - f >= 0.5) ? f + 1 : f
        if r == 0 && (x < 0 || (x == 0 && x.sign == .minus)) { return -0.0 }
        return r
    }

    static func sign(_ x: Double) -> Double {
        if x.isNaN { return .nan }
        if x > 0 { return 1 }
        if x < 0 { return -1 }
        return x
    }

    static func jsMax(_ xs: [Double]) -> Double {
        var m = -Double.infinity
        for x in xs {
            if x.isNaN { return .nan }
            if x > m || (x == 0 && m == 0 && m.sign == .minus) { m = x }
        }
        return m
    }

    static func jsMin(_ xs: [Double]) -> Double {
        var m = Double.infinity
        for x in xs {
            if x.isNaN { return .nan }
            if x < m || (x == 0 && m == 0 && x.sign == .minus) { m = x }
        }
        return m
    }

    /// `x ** y` / Math.pow with JS's special cases (pow(1, NaN) is NaN, pow(±1, ±Inf) is NaN).
    static func pow(_ x: Double, _ y: Double) -> Double {
        if y.isNaN { return .nan }
        if y == 0 { return 1 }
        if (x == 1 || x == -1) && y.isInfinite { return .nan }
        return Foundation.pow(x, y)
    }

    /// ToInt32.
    static func toInt32(_ x: Double) -> Int32 {
        if !x.isFinite || x == 0 { return 0 }
        let t = x < 0 ? -(-x).rounded(.down) : x.rounded(.down)
        let m = t.truncatingRemainder(dividingBy: 4294967296)
        var u = m < 0 ? m + 4294967296 : m
        if u >= 2147483648 { u -= 4294967296 }
        return Int32(u)
    }

    static func toUint16(_ x: Double) -> UInt16 {
        if !x.isFinite || x == 0 { return 0 }
        let t = x < 0 ? -(-x).rounded(.down) : x.rounded(.down)
        let m = t.truncatingRemainder(dividingBy: 65536)
        let u = m < 0 ? m + 65536 : m
        return UInt16(u)
    }

    /// Shortest round-trip decimal digits of a finite positive x: value = 0.d1d2…dk × 10^n.
    static func shortestDigits(_ x: Double) -> (digits: [UInt8], n: Int) {
        let desc = "\(x)"
        var mant = Substring(desc)
        var exp = 0
        if let e = desc.firstIndex(where: { $0 == "e" || $0 == "E" }) {
            mant = desc[desc.startIndex..<e]
            exp = Int(desc[desc.index(after: e)...]) ?? 0
        }
        var digits: [UInt8] = []
        var pointPos = 0
        var seenPoint = false
        for ch in mant {
            if ch == "." { seenPoint = true; continue }
            guard let v = ch.asciiValue, v >= 48, v <= 57 else { continue }
            digits.append(v - 48)
            if !seenPoint { pointPos += 1 }
        }
        pointPos += exp
        while let f = digits.first, f == 0, digits.count > 1 { digits.removeFirst(); pointPos -= 1 }
        while let l = digits.last, l == 0, digits.count > 1 { digits.removeLast() }
        if digits == [0] { return ([0], 1) }
        return (digits, pointPos)
    }

    /// Number#toString() / String(number).
    static func numberToString(_ x: Double) -> String {
        if x.isNaN { return "NaN" }
        if x == .infinity { return "Infinity" }
        if x == -.infinity { return "-Infinity" }
        if x == 0 { return "0" }
        if x < 0 { return "-" + numberToString(-x) }
        let (d, n) = shortestDigits(x)
        let k = d.count
        let ds = String(d.map { Character(UnicodeScalar($0 + 48)) })
        if k <= n && n <= 21 { return ds + String(repeating: "0", count: n - k) }
        if 0 < n && n <= 21 {
            let i = ds.index(ds.startIndex, offsetBy: n)
            return String(ds[..<i]) + "." + String(ds[i...])
        }
        if -6 < n && n <= 0 { return "0." + String(repeating: "0", count: -n) + ds }
        let e = n - 1
        let es = e >= 0 ? "+\(e)" : "\(e)"
        if k == 1 { return ds + "e" + es }
        let i = ds.index(after: ds.startIndex)
        return String(ds[..<i]) + "." + String(ds[i...]) + "e" + es
    }

    /// Exact-ish decimal digits of finite positive x (61 significant digits): value = 0.d… × 10^n.
    static func exactDigits(_ x: Double) -> (digits: [UInt8], n: Int) {
        let s = String(format: "%.60e", x)
        guard let e = s.firstIndex(of: "e") else { return ([0], 1) }
        let exp = Int(s[s.index(after: e)...]) ?? 0
        var digits: [UInt8] = []
        for ch in s[s.startIndex..<e] {
            if let v = ch.asciiValue, v >= 48, v <= 57 { digits.append(v - 48) }
        }
        return (digits, exp + 1)
    }

    /// Round digits (value 0.d × 10^n) half-up to `frac` fraction digits; returns the integer digits of value×10^frac.
    static func roundHalfUp(_ digits: [UInt8], _ n: Int, _ frac: Int) -> [UInt8] {
        let count = n + frac
        if count < 0 { return [0] }
        if count == 0 { return [(digits.first ?? 0) >= 5 ? 1 : 0] }
        var out: [UInt8] = []
        out.reserveCapacity(count + 1)
        for i in 0..<count { out.append(i < digits.count ? digits[i] : 0) }
        let next = count < digits.count ? digits[count] : 0
        if next >= 5 {
            var i = out.count - 1
            while i >= 0 {
                if out[i] == 9 { out[i] = 0; i -= 1 } else { out[i] += 1; break }
            }
            if i < 0 { out.insert(1, at: 0) }
        }
        while out.count > 1 && out[0] == 0 { out.removeFirst() }
        return out
    }

    static func digitString(_ d: [UInt8]) -> String {
        String(String.UnicodeScalarView(d.map { UnicodeScalar($0 + 48) }))
    }

    /// Number#toFixed(f).
    static func toFixed(_ x: Double, _ f: Int) -> String {
        if x.isNaN { return "NaN" }
        if abs(x) >= 1e21 || x.isInfinite { return numberToString(x) }
        let neg = x < 0
        let ax = abs(x)
        var ds: [UInt8]
        if ax == 0 { ds = [0] } else {
            let (d, n) = exactDigits(ax)
            ds = roundHalfUp(d, n, f)
        }
        var s = digitString(ds)
        if f > 0 {
            if s.count < f + 1 { s = String(repeating: "0", count: f + 1 - s.count) + s }
            let i = s.index(s.endIndex, offsetBy: -f)
            s = String(s[..<i]) + "." + String(s[i...])
        }
        return (neg ? "-" : "") + s
    }

    /// Number(x.toPrecision(15)).
    static func precision15(_ x: Double) -> Double {
        if !x.isFinite || x == 0 { return x }
        let neg = x < 0
        let (d, n) = exactDigits(abs(x))
        var keep = Array(d.prefix(15))
        var nn = n
        if d.count > 15 && d[15] >= 5 {
            var i = keep.count - 1
            while i >= 0 {
                if keep[i] == 9 { keep[i] = 0; i -= 1 } else { keep[i] += 1; break }
            }
            if i < 0 { keep.insert(1, at: 0); keep.removeLast(); nn += 1 }
        }
        let v = Double(digitString(keep) + "e\(nn - keep.count)") ?? x
        return neg ? -v : v
    }

    private static func isDigit(_ u: UInt8) -> Bool { u >= 48 && u <= 57 }

    /// Length of the longest StrUnsignedDecimalLiteral prefix (digits, ".", exponent), 0 if none.
    private static func decimalPrefix(_ b: [UInt8], _ start: Int) -> Int {
        var i = start
        var intDigits = 0
        while i < b.count && isDigit(b[i]) { i += 1; intDigits += 1 }
        var fracDigits = 0
        if i < b.count && b[i] == 46 {
            var j = i + 1
            while j < b.count && isDigit(b[j]) { j += 1; fracDigits += 1 }
            if intDigits > 0 || fracDigits > 0 { i = j }
        }
        if intDigits == 0 && fracDigits == 0 { return 0 }
        if i < b.count && (b[i] == 101 || b[i] == 69) {
            var j = i + 1
            if j < b.count && (b[j] == 43 || b[j] == 45) { j += 1 }
            var ed = 0
            while j < b.count && isDigit(b[j]) { j += 1; ed += 1 }
            if ed > 0 { i = j }
        }
        return i - start
    }

    /// Number(string) (StringToNumber).
    static func stringToNumber(_ raw: String) -> Double {
        let s = trim(raw)
        if s.isEmpty { return 0 }
        let b = Array(s.utf8)
        if b.count > 2 && b[0] == 48 {
            let p = b[1] | 0x20
            let radix: Int? = p == 120 ? 16 : p == 111 ? 8 : p == 98 ? 2 : nil
            if let r = radix {
                var v: Double = 0
                for c in b[2...] {
                    guard let d = Int(String(UnicodeScalar(c)), radix: r) else { return .nan }
                    v = v * Double(r) + Double(d)
                }
                return v
            }
        }
        var i = 0
        var neg = false
        if b[0] == 43 || b[0] == 45 { neg = b[0] == 45; i = 1 }
        let rest = String(decoding: b[i...], as: UTF8.self)
        if rest == "Infinity" { return neg ? -.infinity : .infinity }
        let len = decimalPrefix(b, i)
        if len == 0 || i + len != b.count { return .nan }
        let v = Double(String(decoding: b[i..<(i + len)], as: UTF8.self)) ?? .nan
        return neg ? -v : v
    }

    /// parseFloat(string).
    static func parseFloat(_ raw: String) -> Double {
        let s = trimStart(raw)
        let b = Array(s.utf8)
        if b.isEmpty { return .nan }
        var i = 0
        var neg = false
        if b[0] == 43 || b[0] == 45 { neg = b[0] == 45; i = 1 }
        if String(decoding: b[i...], as: UTF8.self).hasPrefix("Infinity") { return neg ? -.infinity : .infinity }
        let len = decimalPrefix(b, i)
        if len == 0 { return .nan }
        let v = Double(String(decoding: b[i..<(i + len)], as: UTF8.self)) ?? .nan
        return neg ? -v : v
    }

    /// parseInt(string, 10).
    static func parseInt10(_ raw: String) -> Double {
        let b = Array(trimStart(raw).utf8)
        var i = 0
        var neg = false
        if i < b.count && (b[i] == 43 || b[i] == 45) { neg = b[i] == 45; i += 1 }
        var v: Double = 0
        var any = false
        while i < b.count && isDigit(b[i]) { v = v * 10 + Double(b[i] - 48); i += 1; any = true }
        if !any { return .nan }
        return neg ? -v : v
    }

    // MARK: - Intl.NumberFormat

    /// Intl.NumberFormat(locale, {maximumFractionDigits, minimumFractionDigits, useGrouping}).format(x):
    /// shortest decimal, rounded half-expand, "-" on any negative value (including -0).
    static func intlFormat(_ x: Double, maxFrac: Int, minFrac: Int, grouping: Bool, decimal: String, group: String) -> String {
        if x.isNaN { return "NaN" }
        if x.isInfinite { return x < 0 ? "-∞" : "∞" }
        let neg = x < 0 || (x == 0 && x.sign == .minus)
        let ax = abs(x)
        var intPart: [UInt8]
        var frac: [UInt8]
        if ax == 0 {
            intPart = [0]
            frac = []
        } else {
            let (d, n) = shortestDigits(ax)
            let all = roundHalfUp(d, n, maxFrac)
            var padded = all
            if padded.count < maxFrac + 1 { padded = Array(repeating: 0, count: maxFrac + 1 - padded.count) + padded }
            intPart = Array(padded[0..<(padded.count - maxFrac)])
            frac = Array(padded[(padded.count - maxFrac)...])
        }
        while frac.count > minFrac, frac.last == 0 { frac.removeLast() }
        while frac.count < minFrac { frac.append(0) }
        var ints = digitString(intPart)
        if grouping && ints.count > 3 {
            var out = ""
            let chars = Array(ints)
            for (i, c) in chars.enumerated() {
                if i > 0 && (chars.count - i) % 3 == 0 { out += group }
                out.append(c)
            }
            ints = out
        }
        var s = ints
        if !frac.isEmpty { s += decimal + digitString(frac) }
        return (neg ? "-" : "") + s
    }

    // MARK: - localeCompare("id")

    private static let punctOrder: [UInt32: Int] = {
        let order = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$"
        var m: [UInt32: Int] = [:]
        for (i, s) in order.unicodeScalars.enumerated() { m[s.value] = i + 1 }
        return m
    }()

    private struct CollKey {
        var primary: [UInt32] = []
        var secondary: [UInt32] = []
        var tertiary: [UInt32] = []
    }

    private static func primaryWeight(_ s: UnicodeScalar) -> UInt32? {
        let v = s.value
        if v < 0x20 && !(0x09...0x0D).contains(v) { return nil }
        if v == 0x7F { return nil }
        if isSpace(v) { return 0x100 + v }
        if let p = punctOrder[v] { return 0x20000 + UInt32(p) }
        if v >= 48 && v <= 57 { return 0x40000 + v }
        let props = s.properties
        if props.isAlphabetic || props.numericType != nil {
            let lower = String(s).lowercased().unicodeScalars.first?.value ?? v
            if lower >= 97 && lower <= 122 { return 0x50000 + lower }
            return 0x60000 + lower
        }
        return 0x30000 + v
    }

    private static func collationKey(_ s: String) -> CollKey {
        var k = CollKey()
        for sc in s.decomposedStringWithCanonicalMapping.unicodeScalars {
            if sc.properties.generalCategory == .nonspacingMark {
                if !k.secondary.isEmpty { k.secondary[k.secondary.count - 1] = sc.value }
                continue
            }
            guard let p = primaryWeight(sc) else { continue }
            k.primary.append(p)
            k.secondary.append(0)
            let isUpper = sc.properties.isUppercase
            k.tertiary.append(isUpper ? 1 : 0)
        }
        return k
    }

    private static func cmp(_ a: [UInt32], _ b: [UInt32]) -> Int {
        let n = Swift.min(a.count, b.count)
        for i in 0..<n where a[i] != b[i] { return a[i] < b[i] ? -1 : 1 }
        return a.count == b.count ? 0 : (a.count < b.count ? -1 : 1)
    }

    /// String#localeCompare(other, "id") — an approximation of the CLDR root collation that is
    /// exact for the ASCII/Latin text a sheet holds (punctuation < digits < letters, accents and case
    /// as later levels).
    static func localeCompare(_ a: String, _ b: String) -> Int {
        if a == b { return 0 }
        let ka = collationKey(a), kb = collationKey(b)
        let p = cmp(ka.primary, kb.primary)
        if p != 0 { return p }
        let s = cmp(ka.secondary, kb.secondary)
        if s != 0 { return s }
        return cmp(ka.tertiary, kb.tertiary)
    }

    // MARK: - Regex helpers

    /// Escape for NSRegularExpression (mirrors JS `s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`).
    static func escapeRegex(_ s: String) -> String {
        var out = ""
        for ch in s {
            if ".*+?^${}()|[]\\".contains(ch) { out.append("\\") }
            out.append(ch)
        }
        return out
    }

    static func regex(_ pattern: String, caseInsensitive: Bool = false) -> NSRegularExpression? {
        try? NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : [])
    }

    static func fullMatch(_ re: NSRegularExpression, _ s: String) -> Bool {
        let ns = s as NSString
        guard let m = re.firstMatch(in: s, options: [], range: NSRange(location: 0, length: ns.length)) else { return false }
        return m.range.location == 0 && m.range.length == ns.length
    }

    /// First match's capture groups (nil for groups that did not take part).
    static func match(_ re: NSRegularExpression, _ s: String) -> [String?]? {
        let ns = s as NSString
        guard let m = re.firstMatch(in: s, options: [], range: NSRange(location: 0, length: ns.length)) else { return nil }
        var out: [String?] = []
        for i in 0..<m.numberOfRanges {
            let r = m.range(at: i)
            out.append(r.location == NSNotFound ? nil : ns.substring(with: r))
        }
        return out
    }

    static func test(_ re: NSRegularExpression, _ s: String) -> Bool {
        let ns = s as NSString
        return re.firstMatch(in: s, options: [], range: NSRange(location: 0, length: ns.length)) != nil
    }

    /// Cached compiled regexes for fixed patterns.
    private static var cache: [String: NSRegularExpression] = [:]
    private static let cacheLock = NSLock()
    static func re(_ pattern: String, _ ci: Bool = false) -> NSRegularExpression {
        let key = (ci ? "i:" : "s:") + pattern
        cacheLock.lock()
        defer { cacheLock.unlock() }
        if let r = cache[key] { return r }
        let r = try! NSRegularExpression(pattern: pattern, options: ci ? [.caseInsensitive] : [])
        cache[key] = r
        return r
    }

    /// `s.replace(re, fn)` over every match; fn gets the capture groups.
    static func replaceAll(_ re: NSRegularExpression, _ s: String, _ fn: ([String?]) -> String) -> String {
        let ns = s as NSString
        let matches = re.matches(in: s, options: [], range: NSRange(location: 0, length: ns.length))
        if matches.isEmpty { return s }
        var out = ""
        var last = 0
        for m in matches {
            out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            var groups: [String?] = []
            for i in 0..<m.numberOfRanges {
                let r = m.range(at: i)
                groups.append(r.location == NSNotFound ? nil : ns.substring(with: r))
            }
            out += fn(groups)
            last = m.range.location + m.range.length
        }
        out += ns.substring(from: last)
        return out
    }
}
