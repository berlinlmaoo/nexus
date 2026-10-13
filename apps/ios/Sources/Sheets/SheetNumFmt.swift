// Number formats for the spreadsheet: Format › Number menu items with examples, custom number /
// date-time / currency presets and the date-pattern chip model — port of sheet-numfmt.ts. Every
// example is rendered through SheetFormula's own formatter in the SHEET locale.
import Foundation

enum SheetNumFmt {
    typealias F = SheetFormula

    /// Run `fn` with the display locale switched, restoring it after.
    static func withLocale<T>(_ locale: String, _ fn: () -> T) -> T {
        let before = F.getDisplayLocale()
        F.setDisplayLocale(locale)
        defer { F.setDisplayLocale(before) }
        return fn()
    }

    /// A value under a Sheets custom number format, in `locale`. `color` is "#rrggbb".
    static func formatPattern(_ value: SheetCellValue, _ pattern: String, _ locale: String = "id-ID") -> SheetFormula.PatternResult {
        withLocale(locale) { F.formatNumberPattern(value, pattern) }
    }

    // MARK: - Format › Number menu

    struct NumberFormatItem: Equatable {
        /// NumberFormatKind or "customCurrency" | "customDate" | "customNumber" | "sep".
        var key: String
        /// English source text (translate in the UI).
        var label: String
        var example: String
    }

    static let SAMPLE_NUM = 1000.12
    /// 26 Sep 2008 15:59:00 — Sheets' own sample.
    static let SAMPLE_DT: Double = F.ymdToSerial(2008, 9, 26) + 57_540.0 / 86_400 // 15:59:00
    /// 24:01:00
    static let SAMPLE_DUR = 1 + 1 / 1440.0

    /// Sheets' Format › Number list, in order, with examples in the sheet locale.
    static func numberFormatItems(_ locale: String = "id-ID") -> [NumberFormatItem] {
        withLocale(locale) {
            func ex(_ nf: String, _ v: Double) -> String { SheetJS.trim(F.formatWithStyle(.number(v), nf, nil) ?? "") }
            let sep = NumberFormatItem(key: "sep", label: "", example: "")
            return [
                NumberFormatItem(key: "auto", label: "Automatic", example: ""),
                NumberFormatItem(key: "text", label: "Plain text", example: ""),
                sep,
                NumberFormatItem(key: "num", label: "Number", example: ex("num", SAMPLE_NUM)),
                NumberFormatItem(key: "pct", label: "Percent", example: ex("pct", 0.1012)),
                NumberFormatItem(key: "sci", label: "Scientific", example: ex("sci", 1010)),
                sep,
                NumberFormatItem(key: "acct", label: "Accounting", example: ex("acct", -SAMPLE_NUM)),
                NumberFormatItem(key: "fin", label: "Financial", example: ex("fin", -SAMPLE_NUM)),
                NumberFormatItem(key: "cur", label: "Currency", example: ex("cur", SAMPLE_NUM)),
                NumberFormatItem(key: "cur0", label: "Currency rounded", example: ex("cur0", SAMPLE_NUM)),
                sep,
                NumberFormatItem(key: "date", label: "Date", example: ex("date", SAMPLE_DT)),
                NumberFormatItem(key: "time", label: "Time", example: ex("time", SAMPLE_DT)),
                NumberFormatItem(key: "dt", label: "Date time", example: ex("dt", SAMPLE_DT)),
                NumberFormatItem(key: "dur", label: "Duration", example: ex("dur", SAMPLE_DUR)),
                sep,
                NumberFormatItem(key: "customCurrency", label: "Custom currency", example: ""),
                NumberFormatItem(key: "customDate", label: "Custom date and time", example: ""),
                NumberFormatItem(key: "customNumber", label: "Custom number format", example: ""),
            ]
        }
    }

    // MARK: - Custom number format presets

    static let NUMBER_SAMPLE = 1234.56
    static let NUMBER_PRESETS: [String] = [
        "0", "0.00", "#,##0", "#,##0.00",
        "#,##0_);(#,##0)", "#,##0_);[Red](#,##0)", "#,##0.00_);(#,##0.00)", "#,##0.00_);[Red](#,##0.00)",
        "$#,##0_);($#,##0)", "$#,##0_);[Red]($#,##0)", "$#,##0.00_);($#,##0.00)", "$#,##0.00_);[Red]($#,##0.00)",
        "@", "0%", "0.00%", "0.00E+00", "##0.0E+0", "# ?/?", "# ??/??",
        "_($* #,##0_);_($* (#,##0);_($* \"-\"_);_(@_)",
        "_(* #,##0_);_(* (#,##0);_(* \"-\"_);_(@_)",
        "_($* #,##0.00_);_($* (#,##0.00);_($* \"-\"??_);_(@_)",
        "_(* #,##0.00_);_(* (#,##0.00);_(* \"-\"??_);_(@_)",
    ]

    // MARK: - Date/time presets and the chip model

    /// 5 Aug 1930 13:25:59 (a Tuesday).
    static let DATE_SAMPLE: Double = F.ymdToSerial(1930, 8, 5) + 48_359.0 / 86_400 // 13:25:59

    static func datePresets(_ locale: String = "id-ID") -> [String] {
        [
            "yyyy-mm-dd", "mm-dd-yyyy", "m/d/yy", "mm-dd-yy", "m/d", "mm-dd", "d-mmm", "dd-mmm-yyyy", "mmmm d yyyy",
            "mmmm d, yyyy", "dd/mm/yyyy", "d mmm yyyy", "dddd, dd mmmm yyyy", "dddd", "h:mm:ss AM/PM", "h:mm AM/PM",
            "hh:mm", "hh:mm:ss", "hh.mm.ss", "[h]:mm:ss", "yyyy-mm-dd hh:mm:ss", "dd/mm/yyyy hh.mm.ss",
            locale == "en-US" ? "dddd, mmmm d, yyyy \"at\" h:mm:ss AM/PM" : "dddd, dd mmmm yyyy \"pukul\" hh.mm.ss",
        ]
    }
    static let DATE_PRESETS: [String] = datePresets("id-ID")

    enum DateField: String, CaseIterable {
        case year, month, day, weekday, hour, minute, second, ampm, elapsedH, elapsedM, elapsedS
    }

    enum DatePart: Equatable {
        case token(field: DateField, code: String)
        case lit(String)
    }

    struct DateFieldInfo { var field: DateField; var label: String; var codes: [String] }
    static let DATE_FIELDS: [DateFieldInfo] = [
        DateFieldInfo(field: .year, label: "Year", codes: ["yyyy", "yy"]),
        DateFieldInfo(field: .month, label: "Month", codes: ["m", "mm", "mmm", "mmmm", "mmmmm"]),
        DateFieldInfo(field: .day, label: "Day", codes: ["d", "dd"]),
        DateFieldInfo(field: .weekday, label: "Day of week", codes: ["ddd", "dddd"]),
        DateFieldInfo(field: .hour, label: "Hour", codes: ["h", "hh"]),
        DateFieldInfo(field: .minute, label: "Minute", codes: ["m", "mm"]),
        DateFieldInfo(field: .second, label: "Second", codes: ["s", "ss"]),
        DateFieldInfo(field: .ampm, label: "AM/PM", codes: ["AM/PM", "A/P"]),
        DateFieldInfo(field: .elapsedH, label: "Elapsed hours", codes: ["[h]", "[hh]"]),
        DateFieldInfo(field: .elapsedM, label: "Elapsed minutes", codes: ["[m]", "[mm]"]),
        DateFieldInfo(field: .elapsedS, label: "Elapsed seconds", codes: ["[s]", "[ss]"]),
    ]

    /// A date pattern as chips + literal separators ("yyyy-mm-dd" -> Year, "-", Month, "-", Day).
    static func parseDatePattern(_ pattern: String) -> [DatePart] {
        var raw: [DatePart] = []
        func lit(_ s: String) {
            if case .lit(let prev)? = raw.last { raw[raw.count - 1] = .lit(prev + s) } else { raw.append(.lit(s)) }
        }
        let re = SheetJS.re("\"([^\"]*)\"|\\\\(.)|\\[(h+|m+|s+)\\]|(am/pm|a/p)|(y+|m+|d+|h+|s+)|([\\s\\S])", true)
        let ns = pattern as NSString
        for m in re.matches(in: pattern, options: [], range: NSRange(location: 0, length: ns.length)) {
            func g(_ i: Int) -> String? {
                let r = m.range(at: i)
                return r.location == NSNotFound ? nil : ns.substring(with: r)
            }
            if let s = g(1) { lit(s) } else if let s = g(2) { lit(s) } else if let s = g(3), !s.isEmpty {
                let u = s.prefix(1).lowercased()
                let field: DateField = u == "h" ? .elapsedH : u == "m" ? .elapsedM : .elapsedS
                raw.append(.token(field: field, code: "[\(s.lowercased())]"))
            } else if let s = g(4), !s.isEmpty {
                raw.append(.token(field: .ampm, code: s.count > 3 ? "AM/PM" : "A/P"))
            } else if let s = g(5), !s.isEmpty {
                let code = s.lowercased()
                let c = code.first!
                let field: DateField = c == "y" ? .year : c == "d" ? (code.count >= 3 ? .weekday : .day) : c == "h" ? .hour : c == "s" ? .second : .month
                raw.append(.token(field: field, code: c == "y" ? (code.count <= 2 ? "yy" : "yyyy") : code))
            } else if let s = g(6) {
                lit(s)
            }
        }
        // "m"/"mm" right after an hour or right before a second are minutes.
        let tokenIdx = raw.indices.filter { if case .token = raw[$0] { return true }; return false }
        func field(_ i: Int) -> DateField? { if case .token(let f, _) = raw[i] { return f }; return nil }
        var updates: [(Int, DatePart)] = []
        for (k, i) in tokenIdx.enumerated() {
            guard case .token(let f, let code) = raw[i], f == .month, code.count <= 2 else { continue }
            let prev = k > 0 ? field(tokenIdx[k - 1]) : nil
            let next = k + 1 < tokenIdx.count ? field(tokenIdx[k + 1]) : nil
            if prev == .hour || prev == .elapsedH || next == .second || next == .elapsedS { updates.append((i, .token(field: .minute, code: code))) }
        }
        for (i, p) in updates { raw[i] = p }
        return raw
    }

    /// Chips back to a pattern; literals that contain letters/digits are quoted.
    static func joinDatePattern(_ parts: [DatePart]) -> String {
        parts.map { p -> String in
            switch p {
            case .token(_, let code): return code
            case .lit(let text):
                if text.isEmpty { return "" }
                if SheetJS.fullMatch(SheetJS.re("^[\\s\\-/:.,()]*\\z"), text) { return text }
                return "\"\(text.replacingOccurrences(of: "\"", with: ""))\""
            }
        }.joined()
    }

    /// How one chip renders the sample ("Bulan (08)").
    static func datePartSample(_ field: DateField, _ code: String, _ locale: String = "id-ID", _ sample: Double = DATE_SAMPLE) -> String {
        if field == .minute {
            let parts = formatPattern(.number(sample), "h:\(code)", locale).text.components(separatedBy: ":")
            return parts.count > 1 ? parts[1] : ""
        }
        if field == .hour && code.count == 1 { return formatPattern(.number(sample), "h", locale).text }
        return formatPattern(.number(sample), code, locale).text
    }

    // MARK: - Currencies (ISO 4217 minor units)

    struct Currency: Equatable {
        var code: String
        var nameEn: String
        var nameId: String
        var symbol: String
        var decimals: Int
    }
    static let CURRENCIES: [Currency] = [
        Currency(code: "IDR", nameEn: "Indonesian Rupiah", nameId: "Rupiah Indonesia", symbol: "Rp", decimals: 0),
        Currency(code: "USD", nameEn: "US Dollar", nameId: "Dolar AS", symbol: "$", decimals: 2),
        Currency(code: "EUR", nameEn: "Euro", nameId: "Euro", symbol: "€", decimals: 2),
        Currency(code: "SGD", nameEn: "Singapore Dollar", nameId: "Dolar Singapura", symbol: "S$", decimals: 2),
        Currency(code: "MYR", nameEn: "Malaysian Ringgit", nameId: "Ringgit Malaysia", symbol: "RM", decimals: 2),
        Currency(code: "JPY", nameEn: "Japanese Yen", nameId: "Yen Jepang", symbol: "¥", decimals: 0),
        Currency(code: "GBP", nameEn: "British Pound", nameId: "Pound Inggris", symbol: "£", decimals: 2),
        Currency(code: "AUD", nameEn: "Australian Dollar", nameId: "Dolar Australia", symbol: "A$", decimals: 2),
        Currency(code: "CNY", nameEn: "Chinese Yuan", nameId: "Yuan Tiongkok", symbol: "CN¥", decimals: 2),
        Currency(code: "KRW", nameEn: "South Korean Won", nameId: "Won Korea Selatan", symbol: "₩", decimals: 0),
        Currency(code: "THB", nameEn: "Thai Baht", nameId: "Baht Thailand", symbol: "฿", decimals: 2),
        Currency(code: "INR", nameEn: "Indian Rupee", nameId: "Rupee India", symbol: "₹", decimals: 2),
        Currency(code: "KWD", nameEn: "Kuwaiti Dinar", nameId: "Dinar Kuwait", symbol: "din", decimals: 3),
        Currency(code: "HKD", nameEn: "Hong Kong Dollar", nameId: "Dolar Hong Kong", symbol: "HK$", decimals: 2),
        Currency(code: "TWD", nameEn: "New Taiwan Dollar", nameId: "Dolar Taiwan Baru", symbol: "NT$", decimals: 2),
        Currency(code: "PHP", nameEn: "Philippine Peso", nameId: "Peso Filipina", symbol: "₱", decimals: 2),
        Currency(code: "VND", nameEn: "Vietnamese Dong", nameId: "Dong Vietnam", symbol: "₫", decimals: 0),
        Currency(code: "BND", nameEn: "Brunei Dollar", nameId: "Dolar Brunei", symbol: "B$", decimals: 2),
        Currency(code: "NZD", nameEn: "New Zealand Dollar", nameId: "Dolar Selandia Baru", symbol: "NZ$", decimals: 2),
        Currency(code: "CAD", nameEn: "Canadian Dollar", nameId: "Dolar Kanada", symbol: "CA$", decimals: 2),
        Currency(code: "CHF", nameEn: "Swiss Franc", nameId: "Franc Swiss", symbol: "CHF", decimals: 2),
        Currency(code: "SAR", nameEn: "Saudi Riyal", nameId: "Riyal Saudi", symbol: "SR", decimals: 2),
        Currency(code: "AED", nameEn: "UAE Dirham", nameId: "Dirham Uni Emirat Arab", symbol: "AED", decimals: 2),
        Currency(code: "QAR", nameEn: "Qatari Riyal", nameId: "Riyal Qatar", symbol: "QR", decimals: 2),
        Currency(code: "BHD", nameEn: "Bahraini Dinar", nameId: "Dinar Bahrain", symbol: "din", decimals: 3),
        Currency(code: "OMR", nameEn: "Omani Rial", nameId: "Rial Oman", symbol: "Rial", decimals: 3),
        Currency(code: "TRY", nameEn: "Turkish Lira", nameId: "Lira Turki", symbol: "₺", decimals: 2),
        Currency(code: "RUB", nameEn: "Russian Ruble", nameId: "Rubel Rusia", symbol: "₽", decimals: 2),
        Currency(code: "BRL", nameEn: "Brazilian Real", nameId: "Real Brasil", symbol: "R$", decimals: 2),
        Currency(code: "MXN", nameEn: "Mexican Peso", nameId: "Peso Meksiko", symbol: "MX$", decimals: 2),
        Currency(code: "ZAR", nameEn: "South African Rand", nameId: "Rand Afrika Selatan", symbol: "R", decimals: 2),
        Currency(code: "EGP", nameEn: "Egyptian Pound", nameId: "Pound Mesir", symbol: "E£", decimals: 2),
        Currency(code: "PKR", nameEn: "Pakistani Rupee", nameId: "Rupee Pakistan", symbol: "Rs", decimals: 2),
        Currency(code: "BDT", nameEn: "Bangladeshi Taka", nameId: "Taka Bangladesh", symbol: "৳", decimals: 2),
        Currency(code: "LKR", nameEn: "Sri Lankan Rupee", nameId: "Rupee Sri Lanka", symbol: "Rs", decimals: 2),
        Currency(code: "SEK", nameEn: "Swedish Krona", nameId: "Krona Swedia", symbol: "kr", decimals: 2),
        Currency(code: "NOK", nameEn: "Norwegian Krone", nameId: "Krone Norwegia", symbol: "kr", decimals: 2),
        Currency(code: "DKK", nameEn: "Danish Krone", nameId: "Krone Denmark", symbol: "kr", decimals: 2),
        Currency(code: "PLN", nameEn: "Polish Zloty", nameId: "Zloty Polandia", symbol: "zł", decimals: 2),
        Currency(code: "ILS", nameEn: "Israeli New Shekel", nameId: "Shekel Baru Israel", symbol: "₪", decimals: 2),
        Currency(code: "MMK", nameEn: "Myanmar Kyat", nameId: "Kyat Myanmar", symbol: "K", decimals: 2),
        Currency(code: "KHR", nameEn: "Cambodian Riel", nameId: "Riel Kamboja", symbol: "៛", decimals: 2),
    ]

    static let CURRENCY_VARIANTS = ["symbol", "symbolRounded", "symbolParen", "symbolRed", "symbolAfter", "code"]

    /// The Sheets pattern for a currency in a variant ("IDR" -> "\"Rp\"#,##0"). Unknown codes use the code.
    static func currencyPattern(_ code: String, _ variant: String = "symbol") -> String {
        let c = CURRENCIES.first { $0.code == code } ?? Currency(code: code, nameEn: code, nameId: code, symbol: code, decimals: 2)
        let dec = variant == "symbolRounded" ? 0 : c.decimals
        let num = "#,##0" + (dec > 0 ? "." + String(repeating: "0", count: dec) : "")
        let sym = "\"" + c.symbol.replacingOccurrences(of: "\"", with: "") + "\""
        switch variant {
        case "symbolParen": return "\(sym)\(num);(\(sym)\(num))"
        case "symbolRed": return "\(sym)\(num);[Red]-\(sym)\(num)"
        case "symbolAfter": return "\(num) \(sym)"
        case "code": return "\"\(c.code) \"\(num)"
        default: return "\(sym)\(num)"
        }
    }
}
