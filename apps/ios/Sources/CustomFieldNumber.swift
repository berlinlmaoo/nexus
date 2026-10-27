import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// NUMBER custom fields as people in Indonesia type them — a line-by-line port of the web's
// apps/web/src/lib/custom-field-number.ts (identical to the server's src/lib copy).
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
        // A true minus (what the app prints for negatives, U+2212) reads as "-" when it is pasted back.
        var s = String(raw.filter { !$0.isWhitespace && $0 != "\u{00A0}" && $0 != "\u{202F}" }
            .map { $0 == "\u{2212}" ? "-" : $0 })
        var neg = false
        if s.count >= 2, s.hasPrefix("("), s.hasSuffix(")") { neg = true; s = String(s.dropFirst().dropLast()) }
        if s.hasPrefix("-") { neg.toggle(); s.removeFirst() }
        // A currency mark typed with the amount: "Rp", "IDR", "$", "US$", "€", "£", "¥", "₿"…
        if let r = s.range(of: "^(rp\\.?|idr|[a-z]{0,3}\\$|[€£¥₩₫₹₿])", options: [.regularExpression, .caseInsensitive]) {
            s.removeSubrange(r)
        }
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

    private static func idrFromParsed(_ p: Parsed, keep: Int = 0) -> String {
        var int = trimZeros(p.int.isEmpty ? "0" : p.int)
        if keep > 0, !p.frac.isEmpty, int.count <= 15, let n = Decimal(string: "\(int).\(p.frac)", locale: posix) {
            // Rupiah with decimal places (1…5): keep the fraction, rounded to the field's places.
            let r = string(rounded(n, keep))
            return (p.neg && r != "0" ? "-" : "") + r
        }
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
        normalize(value, idr: idr, keep: 0)
    }

    /// `keep`: the fraction digits a Rupiah field keeps (its decimal places, 1…5); 0 = whole rupiah.
    private static func normalize(_ value: String, idr: Bool, keep: Int) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "" }
        let (s, neg) = stripCurrency(trimmed)
        for m in multipliers {
            guard let r = s.range(of: m.suffix, options: [.regularExpression, .caseInsensitive]) else { continue }
            if let p = parseDigits(String(s[..<r.lowerBound]), idr: false),
               let base = Double("\(p.int.isEmpty ? "0" : p.int).\(p.frac.isEmpty ? "0" : p.frac)") {
                let n = base * m.factor
                if n.isFinite && n < 1e15 {
                    if idr && keep > 0, let d = Decimal(string: jsNumber(n), locale: posix) {
                        let r = string(rounded(d, keep))
                        return (neg && r != "0" ? "-" : "") + r
                    }
                    let v = idr ? n.rounded() : n
                    return jsNumber(neg && v != 0 ? -v : v)
                }
            }
        }
        if var p = parseDigits(s, idr: idr) {
            p.neg = neg
            if let out = idr ? idrFromParsed(p, keep: keep) : plainFromParsed(p) { return out }
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

    /// A stored Rupiah value (even a legacy "369.000") → "Rp 369.000", "−Rp 25.000" (a true minus, as
    /// AppNumber.rupiah); "" when there is no amount.
    static func formatIDR(_ value: String?) -> String {
        let idr = Style(numberFormat: "IDR")
        guard let d = decimal(value, style: idr) else { return "" }
        return format(d, style: idr)
    }

    /// The true minus sign every number format prints (web rupiah()/formatCount, run 13 owner rule).
    static let minus = "\u{2212}"

    /// A stored plain number with dot grouping ("1500000" → "1.500.000") in both languages;
    /// text that is not a number is shown as it is.
    static func formatPlain(_ value: String?) -> String {
        let raw = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty { return "" }
        let n = normalize(raw, idr: false)
        guard let d = Double(n), d.isFinite else { return raw }
        // Indonesian grouping in English too (owner rule, UI tour run 13): "1.500.000", "2,5".
        return plainID.string(from: NSNumber(value: d)) ?? n
    }

    private static let plainID: NumberFormatter = {
        let f = NumberFormatter(); f.numberStyle = .decimal; f.locale = Locale(identifier: "id_ID"); f.maximumFractionDigits = 6
        return f
    }()

    /// What a NUMBER field shows for a legacy `format` option alone ("currency-idr" or none). Kept for
    /// callers that only know that key; everything that has the field's options uses `display(_:style:)`.
    static func display(_ value: String?, format: String?) -> String {
        display(value, style: Style(format: format))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Number formats, Notion style (owner, 15 Oct 2026). A NUMBER field's options carry how its values are
// shown: `numberFormat` (number, number_with_separators, percent, BTC or an ISO currency code),
// `decimals` (0…5, absent = Default), `showAs` (number | bar | ring) with `barColor`, `divideBy` and
// `showNumber`. The legacy key `format: "currency-idr"` is still written for Rupiah, because released
// apps read only that. Same contract as the web and the server (custom-field-number.ts).
//
// Owner rules on top of Notion: every format uses Indonesian grouping in both languages (a dot for
// thousands, a comma for decimals; "Number" is grouped too), negatives use the true minus "−", Rupiah
// is "Rp 1.234.568" with 0 decimals by default and is pinned under Percent in the format list.
// ─────────────────────────────────────────────────────────────────────────────

extension CustomFieldNumber {
    enum ShowAs: String, CaseIterable, Sendable { case number, bar, ring }

    /// One entry of the Number format list: its stored code and its names in both languages.
    struct FormatInfo: Sendable {
        let code: String
        let en: String
        let id: String
        /// The name in the app language ("Rupiah (IDR)" / "Dolar AS (USD)").
        var name: String { AppLanguage.shared.lang == .id ? id : en }
        /// The name without its "(XXX)" code, for the row that shows the current choice ("Rupiah").
        var shortName: String {
            guard let r = name.range(of: " (", options: .backwards), name.hasSuffix(")") else { return name }
            return String(name[..<r.lowerBound])
        }
    }

    /// Notion's list, in Notion's order (Indonesian names as Notion's id-ID app writes them).
    static let notionFormats: [FormatInfo] = [
        .init(code: "number", en: "Number", id: "Angka"),
        .init(code: "number_with_separators", en: "Number with separators", id: "Angka dengan pemisah"),
        .init(code: "percent", en: "Percent", id: "Persen"),
        .init(code: "USD", en: "US Dollar (USD)", id: "Dolar AS (USD)"),
        .init(code: "AUD", en: "Australian dollar (AUD)", id: "Dolar Australia (AUD)"),
        .init(code: "CAD", en: "Canadian dollar (CAD)", id: "Dolar Kanada (CAD)"),
        .init(code: "SGD", en: "Singapore dollar (SGD)", id: "Dolar Singapura (SGD)"),
        .init(code: "EUR", en: "Euro (EUR)", id: "Euro (EUR)"),
        .init(code: "GBP", en: "Pound (GBP)", id: "Pound (GBP)"),
        .init(code: "JPY", en: "Yen (JPY)", id: "Yen (JPY)"),
        .init(code: "RUB", en: "Ruble (RUB)", id: "Rubel (RUB)"),
        .init(code: "INR", en: "Rupee (INR)", id: "Rupe (INR)"),
        .init(code: "KRW", en: "Won (KRW)", id: "Won (KRW)"),
        .init(code: "CNY", en: "Yuan (CNY)", id: "Yuan (CNY)"),
        .init(code: "BRL", en: "Real (BRL)", id: "Real (BRL)"),
        .init(code: "TRY", en: "Lira (TRY)", id: "Lira (TRY)"),
        .init(code: "IDR", en: "Rupiah (IDR)", id: "Rupiah (IDR)"),
        .init(code: "CHF", en: "Franc (CHF)", id: "Franc (CHF)"),
        .init(code: "HKD", en: "Hong Kong dollar (HKD)", id: "Dolar Hong Kong (HKD)"),
        .init(code: "NZD", en: "New Zealand dollar (NZD)", id: "Dolar Selandia Baru (NZD)"),
        .init(code: "SEK", en: "Swedish krona (SEK)", id: "Krona Swedia (SEK)"),
        .init(code: "NOK", en: "Norwegian krone (NOK)", id: "Krona Norwegia (NOK)"),
        .init(code: "MXN", en: "Mexican peso (MXN)", id: "Peso Meksiko (MXN)"),
        .init(code: "ZAR", en: "Rand (ZAR)", id: "Rand (ZAR)"),
        .init(code: "TWD", en: "New Taiwan dollar (TWD)", id: "Dolar Baru Taiwan (TWD)"),
        .init(code: "DKK", en: "Danish krone (DKK)", id: "Krona Denmark (DKK)"),
        .init(code: "PLN", en: "Złoty (PLN)", id: "Złoty (PLN)"),
        .init(code: "THB", en: "Baht (THB)", id: "Baht (THB)"),
        .init(code: "HUF", en: "Forint (HUF)", id: "Forint (HUF)"),
        .init(code: "CZK", en: "Koruna (CZK)", id: "Koruna (CZK)"),
        .init(code: "ILS", en: "Shekel (ILS)", id: "Shekel (ILS)"),
        .init(code: "CLP", en: "Chilean peso (CLP)", id: "Peso Chili (CLP)"),
        .init(code: "PHP", en: "Philippine peso (PHP)", id: "Peso Filipina (PHP)"),
        .init(code: "AED", en: "Dirham (AED)", id: "Dirham (AED)"),
        .init(code: "COP", en: "Colombian peso (COP)", id: "Peso Kolombia (COP)"),
        .init(code: "SAR", en: "Riyal (SAR)", id: "Riyal (SAR)"),
        .init(code: "MYR", en: "Ringgit (MYR)", id: "Ringgit (MYR)"),
        .init(code: "RON", en: "Leu (RON)", id: "Leu (RON)"),
        .init(code: "ARS", en: "Argentine peso (ARS)", id: "Peso Argentina (ARS)"),
        .init(code: "UYU", en: "Uruguayan peso (UYU)", id: "Peso Uruguay (UYU)"),
        .init(code: "PEN", en: "Peruvian sol (PEN)", id: "Sol Peru (PEN)"),
        .init(code: "VND", en: "Vietnamese dong (VND)", id: "Dong Vietnam (VND)"),
        .init(code: "PKR", en: "Pakistani rupee (PKR)", id: "Rupe Pakistan (PKR)"),
        .init(code: "NGN", en: "Nigerian naira (NGN)", id: "Naira Nigeria (NGN)"),
        .init(code: "BTC", en: "Bitcoin (BTC)", id: "Bitcoin (BTC)"),
    ]

    /// The list the app shows: Notion's, with Rupiah moved up to sit right under Percent as the first
    /// currency (owner: it is the company's currency). Everything else keeps Notion's order.
    static let formats: [FormatInfo] = {
        var list = notionFormats
        guard let i = list.firstIndex(where: { $0.code == "IDR" }),
              let p = list.firstIndex(where: { $0.code == "percent" }) else { return list }
        let idr = list.remove(at: i)
        list.insert(idr, at: p + 1)
        return list
    }()

    private static let knownCodes = Set(notionFormats.map(\.code))
    static func info(_ code: String) -> FormatInfo {
        formats.first { $0.code == code } ?? formats[1]
    }

    /// "Filter formats…": the formats whose name in the app language (its "(XXX)" code included) matches,
    /// best first — web filterNumberFormats: the query at the start of a word, then anywhere, then its
    /// letters in order within a short span (Notion's fuzzy filter: "rup" → Rupee, Rupiah, Pakistani
    /// rupee, Uruguayan peso). Ties keep the list order. Accents are ignored ("zloty" finds Złoty).
    static func filterFormats(_ query: String, lang: AppLang? = nil) -> [FormatInfo] {
        let q = fold(query.trimmingCharacters(in: .whitespaces))
        if q.isEmpty { return formats }
        let useID = (lang ?? AppLanguage.shared.lang) == .id
        var scored: [(f: FormatInfo, score: Int, index: Int)] = []
        for (idx, f) in formats.enumerated() {
            if let score = fuzzyScore(fold(useID ? f.id : f.en), q) { scored.append((f, score, idx)) }
        }
        return scored.sorted { ($0.score, $0.index) < ($1.score, $1.index) }.map(\.f)
    }

    /// 0 = the query starts a word, 1 = it is inside one, 2 = its letters in order within 4× its length.
    private static func fuzzyScore(_ text: String, _ q: String) -> Int? {
        let t = Array(text), n = Array(q)
        if let r = text.range(of: q) {
            let at = text.distance(from: text.startIndex, to: r.lowerBound)
            return at == 0 || t[at - 1] == " " || t[at - 1] == "(" ? 0 : 1
        }
        var i = 0, first = -1
        for j in t.indices where i < n.count {
            if t[j] == n[i] { if first < 0 { first = j }; i += 1 }
            if i == n.count && j - first + 1 > n.count * 4 { return nil }
        }
        return i == n.count ? 2 : nil
    }

    private static func fold(_ s: String) -> String {
        // "ł" has no decomposition, so diacritic folding keeps it: "zloty" should still find Złoty.
        s.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .replacingOccurrences(of: "ł", with: "l")
    }

    /// The bar / ring colours (Notion's ten). "default" draws green.
    static let barColors = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"]

    /// How a NUMBER field shows its values — the options object of the contract, decoded.
    struct Style: Equatable, Sendable {
        var numberFormat: String = "number_with_separators"
        /// 0…5; nil = Default.
        var decimals: Int? = nil
        var showAs: ShowAs = .number
        var barColor: String = "default"
        var divideBy: Double = 100
        var showNumber: Bool = true

        static let plain = Style()

        init() {}

        /// From the option keys (any of them may be absent). The legacy `format` decides the format only
        /// when `numberFormat` is absent or unknown to this build: "currency-idr" / "idr" / "rupiah" →
        /// Rupiah; anything else → Number with separators, which is what NEXUS showed before.
        init(numberFormat: String? = nil, format: String? = nil, decimals: Int? = nil, showAs: String? = nil,
             barColor: String? = nil, divideBy: Double? = nil, showNumber: Bool? = nil) {
            let nf = (numberFormat ?? "").trimmingCharacters(in: .whitespaces)
            if CustomFieldNumber.knownCodes.contains(nf) {
                self.numberFormat = nf
            } else if CustomFieldNumber.knownCodes.contains(nf.uppercased()) {
                self.numberFormat = nf.uppercased()   // "idr", "usd", "btc"
            } else if CustomFieldNumber.isIDR(format) {
                self.numberFormat = "IDR"
            } else {
                self.numberFormat = "number_with_separators"   // absent or unknown to this build
            }
            if let d = decimals, (0...5).contains(d) { self.decimals = d }
            if let s = showAs.flatMap({ ShowAs(rawValue: $0.lowercased()) }) { self.showAs = s }
            if let c = barColor?.lowercased(), CustomFieldNumber.barColors.contains(c) { self.barColor = c }
            if let d = divideBy, d.isFinite, d > 0 { self.divideBy = d }
            if let s = showNumber { self.showNumber = s }
        }

        /// From a field's options as JSON (a dictionary, or the bare legacy string "currency-idr").
        init(options: Any?) {
            if let s = options as? String { self.init(format: s); return }
            guard let o = options as? [String: Any] else { self.init(); return }
            func int(_ v: Any?) -> Int? {
                if let n = v as? NSNumber, !(v is Bool) { let d = n.doubleValue; return d == d.rounded() ? Int(d) : nil }
                if let s = v as? String, let n = Int(s) { return n }
                return nil
            }
            func double(_ v: Any?) -> Double? {
                if let n = v as? NSNumber, !(v is Bool) { return n.doubleValue }
                if let s = v as? String { return Double(s) }
                return nil
            }
            self.init(numberFormat: o["numberFormat"] as? String, format: o["format"] as? String, decimals: int(o["decimals"]),
                      showAs: o["showAs"] as? String, barColor: o["barColor"] as? String, divideBy: double(o["divideBy"]),
                      showNumber: o["showNumber"] as? Bool)
        }

        /// The legacy key alone (callers that know nothing else).
        init(format: String?) { self.init(numberFormat: nil, format: format) }

        var isIDR: Bool { numberFormat == "IDR" }
        var isPercent: Bool { numberFormat == "percent" }
        var isCurrency: Bool { numberFormat.count == 3 && numberFormat == numberFormat.uppercased() && numberFormat != "BTC" }
        /// Money and amounts line up on the right in a table cell (Notion right-aligns every number; the
        /// spec asks it for currencies).
        var alignsTrailing: Bool { isCurrency }

        /// The options object to save (contract keys). Default values are left out; `format` is written
        /// only for Rupiah so released apps keep showing "Rp".
        var options: [String: Any] {
            var o: [String: Any] = ["numberFormat": numberFormat]
            if isIDR { o["format"] = "currency-idr" }
            if let decimals { o["decimals"] = decimals }
            if showAs != .number { o["showAs"] = showAs.rawValue }
            if barColor != "default" { o["barColor"] = barColor }
            if divideBy != 100 { o["divideBy"] = divideBy }
            if !showNumber { o["showNumber"] = false }
            return o
        }
    }

    // MARK: storing

    /// What to STORE for a NUMBER field with this style. Rupiah with Default/0 decimals → whole rupiah
    /// digits; Rupiah with 1…5 decimals → up to that many fraction digits; anything else → a plain
    /// JS-readable number. "42%" typed into any NUMBER field stores 0.42.
    static func normalize(_ value: String, style: Style) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        // "42%" is the fraction 0.42 (what a Percent field stores) in any number field but Rupiah.
        if !style.isIDR, trimmed.hasSuffix("%") {
            let base = normalize(String(trimmed.dropLast()).trimmingCharacters(in: .whitespaces), idr: false)
            if isMachineNumber(base), let d = Decimal(string: base, locale: posix) { return string(d / 100) }
        }
        return normalize(trimmed, idr: style.isIDR, keep: style.isIDR ? (style.decimals ?? 0) : 0)
    }

    /// What the app SENDS for a NUMBER field (owner bug 27 Oct 2026): "" for an empty box, a JSON number for a
    /// number, and the typed text when it is no number. The server keeps a JSON number as it is, while the
    /// text "1.234" (one and 234 thousandths, as normalize gives it for "1,234") would be read again with the
    /// Indonesian rules as 1 234. Older servers read the number exactly as they read the text before.
    static func wireValue(_ typed: String, style: Style) -> Any {
        let out = normalize(typed, style: style)
        guard !out.isEmpty else { return "" }
        guard isMachineNumber(out), let d = Decimal(string: out, locale: posix) else { return out }
        return NSDecimalNumber(decimal: d)
    }

    private static func isMachineNumber(_ s: String) -> Bool {
        s.range(of: "^-?[0-9]+(\\.[0-9]+)?([eE][-+]?[0-9]+)?$", options: .regularExpression) != nil
    }

    private static let posix = Locale(identifier: "en_US_POSIX")

    /// A stored value as an exact decimal (Rupiah Default/0 reads id-ID grouping, "369.000" = 369 000);
    /// nil for text that is not a number.
    static func decimal(_ value: String?, style: Style) -> Decimal? {
        let raw = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty { return nil }
        // Anything but whole Rupiah stores a machine number, which reads as itself ("123.456" in a Rupiah
        // field with 3 decimal places is 123,456 rupiah, not grouping) — web storedNumber.
        let wholeRupiah = style.isIDR && (style.decimals ?? 0) == 0
        if !wholeRupiah, isMachineNumber(raw), let d = Decimal(string: raw, locale: posix) { return d }
        // In a whole-rupiah field "369.000" is a legacy typed amount (thousands grouping). A dot after four or
        // more digits ("1234.567", stored while the field still showed 3 decimals) can be no grouping: a
        // machine number, read as itself (web storedNumber).
        if wholeRupiah, raw.range(of: "^-?[0-9]{4,}\\.[0-9]+$", options: .regularExpression) != nil,
           let d = Decimal(string: raw, locale: posix) {
            return d
        }
        let n = normalize(raw, style: style)
        // The server stores what JavaScript's String(n) writes, which can be "1e-8" for a tiny fraction.
        guard !n.isEmpty, n.range(of: "^-?[0-9]+(\\.[0-9]+)?([eE][-+]?[0-9]+)?$", options: .regularExpression) != nil else { return nil }
        return Decimal(string: n, locale: posix)
    }

    private static func rounded(_ d: Decimal, _ places: Int) -> Decimal {
        var x = d, out = Decimal()
        NSDecimalRound(&out, &x, places, .plain)   // .plain: halves away from zero, like JS toFixed / Intl
        return out
    }

    /// "1234567.891", "-0.42" — POSIX digits, no exponent.
    private static func string(_ d: Decimal) -> String {
        let s = NSDecimalNumber(decimal: d).stringValue
        return s == "-0" ? "0" : s
    }

    /// Dot-grouped integer part, comma decimal: "1.234.567,891". `places` nil = the value's own digits.
    private static func grouped(_ magnitude: Decimal, places: Int?) -> String {
        let v = places.map { rounded(magnitude, $0) } ?? magnitude
        let s = string(v)
        let parts = s.split(separator: ".", omittingEmptySubsequences: false)
        var frac = parts.count > 1 ? String(parts[1]) : ""
        if let places {
            if frac.count < places { frac += String(repeating: "0", count: places - frac.count) }
            if frac.count > places { frac = String(frac.prefix(places)) }
        }
        let int = groupIDR(String(parts[0]))
        return frac.isEmpty ? int : int + "," + frac
    }

    // MARK: showing

    /// A number in this style: "1.234.567,891", "42%", "Rp 1.234.568", "US$1.234.567,89", "₿0,5",
    /// negatives with "−".
    static func format(_ value: Decimal, style: Style) -> String {
        let neg = value < 0
        let mag = neg ? -value : value
        let body: String
        switch style.numberFormat {
        case "percent":
            body = grouped(mag * 100, places: style.decimals) + "%"
        case "BTC":
            body = "₿" + grouped(mag, places: style.decimals)
        case "IDR":
            body = "Rp " + grouped(mag, places: style.decimals ?? 0)
        case let code where style.isCurrency:
            body = currency(mag, code: code, places: style.decimals)
        default:
            body = grouped(mag, places: style.decimals)
        }
        // "−0" never shows: a value that rounds to zero is just zero.
        let zero = body.allSatisfy { !$0.isNumber || $0 == "0" }
        return (neg && !zero ? minus : "") + body
    }

    /// What a NUMBER field shows: the formatted number, the text as typed when it is not a number, ""
    /// when empty.
    static func display(_ value: String?, style: Style) -> String {
        let raw = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty { return "" }
        // Text that is no number shows as typed (web formatNumberField).
        guard let d = decimal(raw, style: style) else { return raw }
        return format(d, style: style)
    }

    /// Bar / Ring fill, 0…1: value ÷ Divide by; a Percent field fills by its stored fraction (0.42 → 42%).
    static func fill(_ value: Decimal, style: Style) -> Double {
        let v = NSDecimalNumber(decimal: value).doubleValue
        let f = style.isPercent ? v : v / (style.divideBy > 0 ? style.divideBy : 100)
        guard f.isFinite else { return 0 }
        return min(max(f, 0), 1)
    }

    /// Currency symbols where Apple's id_ID data differs from the browsers' (Intl id-ID), so the app and
    /// the web print the same text.
    private static let symbolOverride: [String: String] = ["INR": "Rs ", "SAR": "SAR "]

    /// One formatter per currency, with the currency's own decimals (2 for USD, 0 for JPY / KRW).
    private static var currencyFormatters: [String: (formatter: NumberFormatter, natural: Int)] = [:]
    private static let currencyLock = NSLock()

    /// Intl.NumberFormat('id-ID', {style: 'currency'}) for a non-negative amount: "US$1.234.567,89",
    /// "€1.234.567,89", "JP¥1.234.568", "CHF 1.234.567,89". Default decimals = the currency's own.
    private static func currency(_ magnitude: Decimal, code: String, places: Int?) -> String {
        currencyLock.lock(); defer { currencyLock.unlock() }
        let entry: (formatter: NumberFormatter, natural: Int)
        if let cached = currencyFormatters[code] { entry = cached } else {
            let f = NumberFormatter()
            f.numberStyle = .currency
            f.locale = Locale(identifier: "id_ID")
            f.currencyCode = code
            if let sym = symbolOverride[code] { f.currencySymbol = sym }
            f.roundingMode = .halfUp
            entry = (f, f.maximumFractionDigits)
            currencyFormatters[code] = entry
        }
        let f = entry.formatter
        let digits = places ?? entry.natural
        f.minimumFractionDigits = digits
        f.maximumFractionDigits = digits
        let out = f.string(from: NSDecimalNumber(decimal: rounded(magnitude, digits))) ?? (code + " " + grouped(magnitude, places: digits))
        // Plain spaces only (NBSP / narrow NBSP from the formatter): the same text as the web prints.
        return out.replacingOccurrences(of: "\u{00A0}", with: " ").replacingOccurrences(of: "\u{202F}", with: " ")
            .replacingOccurrences(of: "  ", with: " ")
    }
}
