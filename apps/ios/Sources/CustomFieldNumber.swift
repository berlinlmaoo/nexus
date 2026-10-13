import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// NUMBER custom fields as people in Indonesia type them — a line-by-line port of the web's
// apps/nexus-lovable-ui/src/lib/custom-field-number.ts (identical to the server's src/lib copy).
//
// Owner bug (12 Oct 2026): "369.000" typed into a Rupiah field was stored as the text "369.000" and read
// back as 369 → "Rp 369". The server now normalises every NUMBER write; the app does the same before it
// sends, so what it stores is a plain machine number either way: digits only for Rupiah ("369000"), a
// JS-readable number for plain fields ("1500", "2.5").
//
// Rules (Sheets' id-ID parser): "." groups thousands, "," is the decimal mark, and when both appear the
// last one is the decimal mark. A Rupiah field reads one extra case as grouping: a separator followed by
// three or more digits ("369.000", "13.600000", "280,000") is never a fraction. One or two digits after
// the last separator ("150.000,50") are cents and are rounded. "1,5jt" = 1 500 000, "250rb" = 250 000.
//
// Change the rules in all three copies together (web, server, here).
// ─────────────────────────────────────────────────────────────────────────────

enum CustomFieldNumber {
    /// A NUMBER field's display format from its options ("currency-idr", also "idr" / "rupiah").
    static func isIDR(_ format: String?) -> Bool {
        guard let f = format?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() else { return false }
        return f == "currency-idr" || f == "idr" || f == "rupiah"
    }

    private struct Parsed { var neg: Bool; var int: String; var frac: String }

    private static func matches(_ s: String, _ pattern: String) -> Bool {
        s.range(of: pattern, options: .regularExpression) != nil
    }

    private static func onlyDigits(_ s: String) -> String {
        String(s.unicodeScalars.filter { $0.value >= 48 && $0.value <= 57 }.map(Character.init))
    }

    /// Spaces, a leading/trailing sign, "(…)" for a negative, "Rp"/"Rp."/"IDR", and the "no cents" dash.
    private static func stripCurrency(_ raw: String) -> (s: String, neg: Bool) {
        var s = String(raw.filter { !$0.isWhitespace && $0 != "\u{00A0}" && $0 != "\u{202F}" })
        var neg = false
        if s.count >= 2, s.hasPrefix("("), s.hasSuffix(")") { neg = true; s = String(s.dropFirst().dropLast()) }
        if s.hasPrefix("-") { neg.toggle(); s.removeFirst() }
        let lower = s.lowercased()
        if lower.hasPrefix("rp.") { s = String(s.dropFirst(3)) }
        else if lower.hasPrefix("rp") { s = String(s.dropFirst(2)) }
        else if lower.hasPrefix("idr") { s = String(s.dropFirst(3)) }
        if s.hasPrefix("-") { neg.toggle(); s.removeFirst() }
        else if s.hasPrefix("+") { s.removeFirst() }
        // "Rp 50.000,-" / "Rp 50.000,00-".
        s = s.replacingOccurrences(of: "[.,]?-+$", with: "", options: .regularExpression)
        return (s, neg)
    }

    private static func validGrouping(_ x: String, _ g: Character) -> Bool {
        let parts = x.split(separator: g, omittingEmptySubsequences: false).map(String.init)
        guard let first = parts.first, matches(first, "^[0-9]{1,3}$") else { return false }
        return parts.dropFirst().allSatisfy { matches($0, "^[0-9]{3}$") }
    }

    private static func parseDigits(_ input: String, idr: Bool) -> Parsed? {
        guard matches(input, "^([0-9][0-9.,]*|[.,][0-9]+)$") else { return nil }
        let s = input.replacingOccurrences(of: "[.,]+$", with: "", options: .regularExpression)
        let dots = s.filter { $0 == "." }.count
        let commas = s.filter { $0 == "," }.count
        if dots > 0 && commas > 0 {
            let lastDot = s.lastIndex(of: ".")!, lastComma = s.lastIndex(of: ",")!
            let dec: Character = lastDot > lastComma ? "." : ","
            let grp: Character = dec == "." ? "," : "."
            let parts = s.split(separator: dec, omittingEmptySubsequences: false).map(String.init)
            if parts.count != 2 {
                // "1.500.000.00,5"-style noise: only a Rupiah field can still read it (as grouping).
                return idr ? Parsed(neg: false, int: onlyDigits(s), frac: "") : nil
            }
            let a = parts[0], b = parts[1]
            if idr && b.count >= 3 { return Parsed(neg: false, int: onlyDigits(s), frac: "") }
            if !idr && !validGrouping(a, grp) { return nil }
            return Parsed(neg: false, int: a.filter { $0 != grp }, frac: b)
        }
        if dots > 0 || commas > 0 {
            let ch: Character = dots > 0 ? "." : ","
            let parts = s.split(separator: ch, omittingEmptySubsequences: false).map(String.init)
            if parts.count > 2 {
                if !idr && !validGrouping(s, ch) { return nil }
                return Parsed(neg: false, int: parts.joined(), frac: "")
            }
            let a = parts[0], b = parts.count > 1 ? parts[1] : ""
            if idr {
                // Three or more digits after the mark: grouping ("369.000", "13.600000", "280,000").
                return b.count >= 3 ? Parsed(neg: false, int: a + b, frac: "") : Parsed(neg: false, int: a, frac: b)
            }
            // Plain numbers, id-ID: a lone "." groups only when exactly three digits follow ("1.500");
            // a lone "," is always the decimal mark ("1,5").
            let grouped = ch == "." && b.count == 3 && matches(a, "^[1-9][0-9]{0,2}$")
            return grouped ? Parsed(neg: false, int: a + b, frac: "") : Parsed(neg: false, int: a, frac: b)
        }
        return Parsed(neg: false, int: s, frac: "")
    }

    private static func trimZeros(_ digits: String) -> String {
        let t = digits.replacingOccurrences(of: "^0+(?=[0-9])", with: "", options: .regularExpression)
        return t.isEmpty ? "0" : t
    }

    /// Adds one to a non-negative decimal digit string ("999" → "1000"), exact for any length.
    private static func incrementDigits(_ d: String) -> String {
        var a = Array(d)
        var i = a.count - 1
        while i >= 0 {
            if a[i] == "9" { a[i] = "0"; i -= 1 }
            else { a[i] = Character(String((a[i].wholeNumberValue ?? 0) + 1)); return String(a) }
        }
        return "1" + String(a)
    }

    private static func idrFromParsed(_ p: Parsed) -> String {
        var int = trimZeros(p.int.isEmpty ? "0" : p.int)
        if let first = p.frac.first?.wholeNumberValue, first >= 5 { int = incrementDigits(int) }
        return (p.neg && int != "0" ? "-" : "") + int
    }

    /// A number the way JavaScript's String(n) writes it for the values this can produce.
    private static func jsNumber(_ n: Double) -> String {
        if n == 0 { return "0" }
        if n == n.rounded(), abs(n) < 1e15 { return String(Int64(n)) }
        return String(n)
    }

    private static func plainFromParsed(_ p: Parsed) -> String? {
        let int = trimZeros(p.int.isEmpty ? "0" : p.int)
        let frac = p.frac.replacingOccurrences(of: "0+$", with: "", options: .regularExpression)
        if int.count > 15 { return nil }
        guard let n = Double("\(int).\(frac.isEmpty ? "0" : frac)"), n.isFinite else { return nil }
        return jsNumber(p.neg && n != 0 ? -n : n)
    }

    private static let multipliers: [(suffix: String, factor: Double)] = [
        ("(rb|ribu|k)$", 1_000),
        ("(jt|juta)$", 1_000_000),
    ]

    /// What to STORE for a NUMBER field. Rupiah → integer digits ("Rp 369.000" → "369000", "1,5jt" →
    /// "1500000"); plain → a JS-readable number ("1.500" → "1500", "2,5" → "2.5"). Empty → "". Text that
    /// is not a number: Rupiah keeps its digits, plain keeps the text unchanged (nothing is destroyed).
    static func normalize(_ value: String, idr: Bool) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "" }
        let (s, neg) = stripCurrency(trimmed)
        for m in multipliers {
            guard let r = s.range(of: m.suffix, options: [.regularExpression, .caseInsensitive]) else { continue }
            if let p = parseDigits(String(s[..<r.lowerBound]), idr: false),
               let base = Double("\(p.int.isEmpty ? "0" : p.int).\(p.frac.isEmpty ? "0" : p.frac)") {
                let n = base * m.factor
                if n.isFinite && n < 1e15 {
                    let v = idr ? n.rounded() : n
                    return jsNumber(neg && v != 0 ? -v : v)
                }
            }
        }
        if var p = parseDigits(s, idr: idr) {
            p.neg = neg
            if let out = idr ? idrFromParsed(p) : plainFromParsed(p) { return out }
        }
        if idr { return onlyDigits(value) }
        return trimmed
    }

    /// "369000" → "369.000" (id-ID grouping, no currency sign) — for inputs while typing.
    static func groupIDR(_ digits: String) -> String {
        let neg = digits.trimmingCharacters(in: .whitespaces).hasPrefix("-")
        let d = onlyDigits(digits)
        if d.isEmpty { return "" }
        let t = Array(trimZeros(d))
        var out = ""
        for (i, c) in t.enumerated() {
            if i > 0 && (t.count - i) % 3 == 0 { out.append(".") }
            out.append(c)
        }
        return (neg ? "-" : "") + out
    }

    /// A stored Rupiah value (even a legacy "369.000") → "Rp 369.000"; "" when there is no amount.
    static func formatIDR(_ value: String?) -> String {
        let n = normalize(value ?? "", idr: true)
        if n.isEmpty { return "" }
        let neg = n.hasPrefix("-")
        return (neg ? "-" : "") + "Rp " + groupIDR(neg ? String(n.dropFirst()) : n)
    }

    /// A stored plain number grouped in the app's language ("1500000" → "1,500,000" / "1.500.000");
    /// text that is not a number is shown as it is.
    static func formatPlain(_ value: String?) -> String {
        let raw = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty { return "" }
        let n = normalize(raw, idr: false)
        guard let d = Double(n), d.isFinite else { return raw }
        let f = AppLanguage.shared.lang == .id ? plainID : plainEN
        return f.string(from: NSNumber(value: d)) ?? n
    }

    private static let plainID: NumberFormatter = {
        let f = NumberFormatter(); f.numberStyle = .decimal; f.locale = Locale(identifier: "id_ID"); f.maximumFractionDigits = 6
        return f
    }()
    private static let plainEN: NumberFormatter = {
        let f = NumberFormatter(); f.numberStyle = .decimal; f.locale = Locale(identifier: "en_US"); f.maximumFractionDigits = 6
        return f
    }()

    /// What a NUMBER field shows: Rupiah with "Rp", plain grouped; "" when empty.
    static func display(_ value: String?, format: String?) -> String {
        isIDR(format) ? formatIDR(value) : formatPlain(value)
    }
}
