// Spreadsheet formula engine, value parsing and display formatting — Swift port of the web/server
// engine apps/nexus-lovable-ui/src/lib/sheet-formula.ts (dev branch, Oct 2026). Read the TS file for
// the design notes; every exported TS name exists here with the same meaning:
//
//   TS free function `foo(...)`      -> `SheetFormula.foo(...)`
//   TS `CellValue` (string|number|boolean|null)
//                                    -> `SheetCellValue` (.text / .number / .bool / .empty)
//   errors ("#REF!", "#DIV/0!", …)    -> `.text("#REF!")` exactly like TS; `SheetFormula.isError(v)`
//   TS `NumFmt`                      -> `SheetFormula.NumFmt` (.num .idr .pct .date)
//   TS `TypedCell` {v, nf}           -> `SheetFormula.TypedCell`
//   TS `Detected`                    -> `SheetFormula.Detected`
//   TS `SheetShape` / `SheetData`    -> `SheetShape` / `SheetData`
//   TS `SheetEngine`                 -> `SheetEngine` (final class, same methods)
//   TS `ComputedCell`                -> `SheetComputedCell`
//   TS `unknown` stored cell values  -> `Any?` (Foundation JSON: String, NSNumber/Int/Double, Bool,
//                                       [String: Any] such as {"f": "…"} / {"v": n, "nf": "idr"} /
//                                       {"t": …, "u": …}, [Any], NSNull or nil)
//
// The display locale is module state exactly like TS (`SheetFormula.setDisplayLocale`). Formula
// functions TS delegates to @formulajs/formulajs are reimplemented with formula.js semantics in
// SheetFormulaFunctions.swift; JS number/string behaviour lives in SheetFormulaJS.swift.
// "Today" is Asia/Jakarta (UTC+7, no DST), computed without a tz database. Local-time Date maths of
// formula.js is done in UTC (what the server runs), which is identical for Jakarta (no DST).
import Foundation

/// A computed cell value. Errors are `.text("#…")`, as in the TS engine.
enum SheetCellValue: Equatable {
    case empty
    case number(Double)
    case text(String)
    case bool(Bool)

    var isEmptyOrBlank: Bool {
        switch self {
        case .empty: return true
        case .text(let s): return s.isEmpty
        default: return false
        }
    }
    var number: Double? { if case .number(let n) = self { return n }; return nil }
    var text: String? { if case .text(let s) = self { return s }; return nil }

    /// As a JSON-ish Foundation value (nil, Double, String, Bool).
    var jsonValue: Any? {
        switch self {
        case .empty: return nil
        case .number(let n): return n
        case .text(let s): return s
        case .bool(let b): return b
        }
    }
}

/// Column ids and row ids in display order.
struct SheetShape: Equatable {
    var columnIds: [String]
    var rowIds: [String]
    init(columnIds: [String], rowIds: [String]) {
        self.columnIds = columnIds
        self.rowIds = rowIds
    }
}

/// What the engine evaluates: shape, raw stored cells, column types and named ranges.
struct SheetData {
    var shape: SheetShape
    /// rowId -> colId -> raw stored value (scalar, typed cell, link, list or a formula cell).
    var cells: [String: [String: Any]]
    /// colId -> column type. Optional; dates in date columns read as serials.
    var types: [String: String]?
    /// Named ranges: NAME in upper case -> stored range "{c!r}:{c!r}".
    var names: [String: String]?

    init(shape: SheetShape, cells: [String: [String: Any]], types: [String: String]? = nil, names: [String: String]? = nil) {
        self.shape = shape
        self.cells = cells
        self.types = types
        self.names = names
    }

    /// Convenience: columns (id, type) and rows (id, cells) the way the server returns them.
    init(columns: [(id: String, type: String)], rows: [(id: String, cells: [String: Any])], names: [(name: String, range: String)]? = nil) {
        shape = SheetShape(columnIds: columns.map { $0.id }, rowIds: rows.map { $0.id })
        var c: [String: [String: Any]] = [:]
        for r in rows { c[r.id] = r.cells }
        cells = c
        var t: [String: String] = [:]
        for col in columns { t[col.id] = col.type }
        types = t
        if let names = names, !names.isEmpty {
            var m: [String: String] = [:]
            for n in names { m[n.name.uppercased()] = n.range }
            self.names = m
        } else {
            self.names = nil
        }
    }
}

enum SheetFormula {
    // MARK: - Values

    enum NumFmt: String, CaseIterable, Equatable {
        case num, idr, pct, date
    }
    static let NUM_FORMATS: [NumFmt] = [.num, .idr, .pct, .date]

    struct TypedCell: Equatable {
        var v: Double
        var nf: NumFmt
        var json: [String: Any] { ["v": v, "nf": nf.rawValue] }
    }

    enum ERR {
        static let ref = "#REF!"
        static let div = "#DIV/0!"
        static let cycle = "#CIRCULAR!"
        static let name = "#NAME?"
        static let value = "#VALUE!"
        static let na = "#N/A"
        static let num = "#NUM!"
        /// The formula's "," could mean a decimal or an argument separator.
        static let error = "#ERROR!"
    }
    static let ERROR_TEXTS: Set<String> = ["#REF!", "#DIV/0!", "#CIRCULAR!", "#NAME?", "#VALUE!", "#N/A", "#NUM!", "#ERROR!", "#CYCLE!", "#NULL!", "#CALC!"]

    static func isError(_ v: SheetCellValue) -> Bool {
        if case .text(let s) = v { return ERROR_TEXTS.contains(s) }
        return false
    }
    static func isError(_ v: Any?) -> Bool {
        if let s = v as? String { return ERROR_TEXTS.contains(s) }
        if let c = v as? SheetCellValue { return isError(c) }
        return false
    }

    /// Kinds of a Foundation JSON value, with NSNumber booleans told apart from numbers.
    enum JSONKind {
        case null
        case bool(Bool)
        case number(Double)
        case string(String)
        case array([Any])
        case object([String: Any])
        case other
    }

    static func kind(_ value: Any?) -> JSONKind {
        guard let v = value else { return .null }
        if v is NSNull { return .null }
        if let s = v as? String { return .string(s) }
        let t = type(of: v)
        if t == Bool.self, let b = v as? Bool { return .bool(b) }
        if t == Int.self, let i = v as? Int { return .number(Double(i)) }
        if t == Double.self, let d = v as? Double { return .number(d) }
        if t == Float.self, let f = v as? Float { return .number(Double(f)) }
        if t == Int64.self, let i = v as? Int64 { return .number(Double(i)) }
        if t == Int32.self, let i = v as? Int32 { return .number(Double(i)) }
        if let c = v as? SheetCellValue {
            switch c {
            case .empty: return .null
            case .number(let n): return .number(n)
            case .text(let s): return .string(s)
            case .bool(let b): return .bool(b)
            }
        }
        if let n = v as? NSNumber {
            let ty = String(cString: n.objCType)
            if ty == "c" || ty == "B" { return .bool(n.boolValue) }
            return .number(n.doubleValue)
        }
        if let a = v as? [Any] { return .array(a) }
        if let a = v as? [Any?] { return .array(a.map { $0 ?? NSNull() }) }
        if let o = v as? [String: Any] { return .object(o) }
        if let o = v as? [String: Any?] {
            var m: [String: Any] = [:]
            for (k, x) in o { m[k] = x ?? NSNull() }
            return .object(m)
        }
        return .other
    }

    static func isFormulaCell(_ v: Any?) -> Bool { formulaOf(v) != nil }
    /// The `f` of a formula cell, else nil.
    static func formulaOf(_ v: Any?) -> String? {
        if case .object(let o) = kind(v), case .string(let f) = kind(o["f"]) { return f }
        return nil
    }

    static func isTypedCell(_ v: Any?) -> Bool { typedCell(v) != nil }
    static func typedCell(_ v: Any?) -> TypedCell? {
        guard case .object(let o) = kind(v) else { return nil }
        guard case .number(let n) = kind(o["v"]), n.isFinite else { return nil }
        guard case .string(let s) = kind(o["nf"]), let nf = NumFmt(rawValue: s) else { return nil }
        return TypedCell(v: n, nf: nf)
    }

    /// {t?, u} link cells.
    static func linkOf(_ v: Any?) -> (t: String?, u: String)? {
        guard case .object(let o) = kind(v), case .string(let u) = kind(o["u"]) else { return nil }
        var t: String? = nil
        if case .string(let s) = kind(o["t"]) { t = s }
        return (t, u)
    }

    /// JS truthiness of a JSON value.
    static func jsTruthy(_ v: Any?) -> Bool {
        switch kind(v) {
        case .null: return false
        case .bool(let b): return b
        case .number(let n): return n != 0 && !n.isNaN
        case .string(let s): return !s.isEmpty
        default: return true
        }
    }

    /// JS String(value) of a JSON value (arrays join with ",", objects "[object Object]").
    static func jsString(_ v: Any?) -> String {
        switch kind(v) {
        case .null: return v == nil ? "undefined" : "null"
        case .bool(let b): return b ? "true" : "false"
        case .number(let n): return SheetJS.numberToString(n)
        case .string(let s): return s
        case .array(let a): return a.map { jsJoinElement($0) }.joined(separator: ",")
        case .object: return "[object Object]"
        case .other: return "\(v!)"
        }
    }
    static func jsJoinElement(_ v: Any?) -> String {
        if case .null = kind(v) { return "" }
        return jsString(v)
    }
    /// Array#join(", ").
    static func joinList(_ a: [Any]) -> String { a.map { jsJoinElement($0) }.joined(separator: ", ") }

    /// Errors other than "#CIRCULAR!" read as Sheets' own names; returns the explanation.
    static func errorHint(_ v: String, lang: String = "id") -> String {
        let id: [String: String] = [
            "#REF!": "Rujukan ke sel/kolom yang sudah dihapus atau di luar sheet.",
            "#DIV/0!": "Pembagian dengan nol.",
            "#CIRCULAR!": "Rumus ini merujuk dirinya sendiri (langsung atau lewat sel lain).",
            "#NAME?": "Nama fungsi tidak dikenal.",
            "#VALUE!": "Jenis isi salah, mis. teks dipakai sebagai angka.",
            "#N/A": "Nilai yang dicari tidak ketemu.",
            "#NUM!": "Angka tidak valid untuk fungsi ini.",
            "#ERROR!": "Koma di rumus ini bisa berarti desimal atau pemisah. Pakai ; sebagai pemisah argumen, mis. =IF(A1>1;1,5;0).",
        ]
        let en: [String: String] = [
            "#REF!": "Refers to a deleted cell/column or one outside the sheet.",
            "#DIV/0!": "Division by zero.",
            "#CIRCULAR!": "This formula refers to itself (directly or through other cells).",
            "#NAME?": "Unknown function name.",
            "#VALUE!": "Wrong kind of value, e.g. text used as a number.",
            "#N/A": "The value looked up was not found.",
            "#NUM!": "Invalid number for this function.",
            "#ERROR!": "A comma in this formula could be a decimal point or a separator. Separate arguments with ;, e.g. =IF(A1>1;1,5;0).",
        ]
        return (lang == "en" ? en : id)[v] ?? ""
    }

    // MARK: - Display locale

    enum DisplayLocale: String {
        case idID = "id-ID"
        case enUS = "en-US"
    }
    static var displayLocale: DisplayLocale = .idID
    static func setDisplayLocale(_ l: DisplayLocale) { displayLocale = l }
    static func setDisplayLocale(_ l: String) { displayLocale = l == "en-US" ? .enUS : .idID }
    static func getDisplayLocale() -> DisplayLocale { displayLocale }
    static var isEn: Bool { displayLocale == .enUS }
    static func decimalMark() -> String { isEn ? "." : "," }
    static func groupMark() -> String { isEn ? "," : "." }

    // MARK: - Dates (serials, Asia/Jakarta)

    static let EPOCH_MS: Double = -2209161600000 // Date.UTC(1899, 11, 30)
    static let DAY_MS: Double = 86_400_000
    static let JAKARTA_OFFSET_MS: Double = 7 * 3_600_000

    static func ymdToSerial(_ y: Double, _ m: Double, _ d: Double) -> Double {
        let ms = SheetDate.utc(y, m - 1, d)
        var fixed = ms
        if y >= 0 && y < 100 { fixed = SheetDate.setUTCFullYear(ms, y) }
        return SheetJS.round((fixed - EPOCH_MS) / DAY_MS)
    }

    struct YMD: Equatable { var y: Int; var m: Int; var d: Int }

    /// Calendar date of a serial (NaN-safe: invalid serials give 0/0/0).
    static func serialToYmd(_ serial: Double) -> YMD {
        let p = serialToYmdD(serial)
        guard p.y.isFinite, p.m.isFinite, p.d.isFinite else { return YMD(y: 0, m: 0, d: 0) }
        return YMD(y: Int(p.y), m: Int(p.m), d: Int(p.d))
    }
    /// Same, as doubles (NaN for dates JS can't represent).
    static func serialToYmdD(_ serial: Double) -> (y: Double, m: Double, d: Double) {
        let ms = SheetDate.timeClip(EPOCH_MS + serial.rounded(.down) * DAY_MS)
        let c = SheetDate.parts(ms)
        return (c.y, c.m + 1, c.d)
    }

    static func pad2(_ n: Double) -> String { padStart(SheetJS.numberToString(n), 2) }
    static func pad2(_ n: Int) -> String { n >= 0 && n < 10 ? "0\(n)" : "\(n)" }
    static func padStart(_ s: String, _ len: Int, _ ch: String = "0") -> String {
        let n = s.utf16.count
        return n >= len ? s : String(repeating: ch, count: len - n) + s
    }

    static func serialToIso(_ serial: Double) -> String {
        let p = serialToYmdD(serial)
        return "\(padStart(SheetJS.numberToString(p.y), 4))-\(pad2(p.m))-\(pad2(p.d))"
    }

    static func daysIn(_ y: Double, _ m: Double) -> Double {
        SheetDate.parts(SheetDate.utc(y, m, 0)).d
    }
    static func validYmd(_ y: Double, _ m: Double, _ d: Double) -> Bool {
        y >= 1900 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m)
    }

    /// "2026-10-11" -> serial; anything else -> nil.
    static func isoToSerial(_ s: Any?) -> Double? {
        guard case .string(let str) = kind(s) else { return nil }
        guard let m = SheetJS.match(SheetJS.re("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})\\z"), SheetJS.trim(str)) else { return nil }
        let y = Double(m[1]!)!, mo = Double(m[2]!)!, d = Double(m[3]!)!
        return validYmd(y, mo, d) ? ymdToSerial(y, mo, d) : nil
    }

    /// Today in Asia/Jakarta as a serial.
    static func todaySerial(_ now: Date = Date()) -> Double {
        let j = (now.timeIntervalSince1970 * 1000).rounded(.down) + JAKARTA_OFFSET_MS
        let p = SheetDate.parts(j)
        return ymdToSerial(p.y, p.m + 1, p.d)
    }
    static func nowSerial(_ now: Date = Date()) -> Double {
        let j = (now.timeIntervalSince1970 * 1000).rounded(.down) + JAKARTA_OFFSET_MS
        return (j - EPOCH_MS) / DAY_MS
    }

    static let MONTHS: [String: Int] = [
        "jan": 1, "januari": 1, "january": 1,
        "feb": 2, "februari": 2, "february": 2, "peb": 2,
        "mar": 3, "maret": 3, "march": 3,
        "apr": 4, "april": 4,
        "mei": 5, "may": 5,
        "jun": 6, "juni": 6, "june": 6,
        "jul": 7, "juli": 7, "july": 7,
        "agu": 8, "agt": 8, "ags": 8, "agustus": 8, "aug": 8, "august": 8,
        "sep": 9, "sept": 9, "september": 9,
        "okt": 10, "oktober": 10, "oct": 10, "october": 10,
        "nov": 11, "nop": 11, "november": 11, "nopember": 11,
        "des": 12, "desember": 12, "dec": 12, "december": 12,
    ]
    static let MONTH_SHORT_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
    static let MONTH_LONG_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
    static let DAY_LONG_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"]
    static let DAY_SHORT_ID = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"]
    static let MONTH_SHORT_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    static let MONTH_LONG_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    static let DAY_LONG_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    static let DAY_SHORT_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    private static func pick(_ a: [String], _ i: Double) -> String {
        guard i.isFinite, i >= 0, i < Double(a.count), i == i.rounded(.down) else { return "" }
        return a[Int(i)]
    }
    /// Month (1–12) name in the display locale.
    static func monthName(_ m: Double, _ long: Bool) -> String {
        let list = long ? (isEn ? MONTH_LONG_EN : MONTH_LONG_ID) : (isEn ? MONTH_SHORT_EN : MONTH_SHORT_ID)
        return pick(list, m - 1)
    }
    /// Weekday (0 = Sunday) name in the display locale.
    static func weekdayName(_ dow: Double, _ long: Bool) -> String {
        let list = long ? (isEn ? DAY_LONG_EN : DAY_LONG_ID) : (isEn ? DAY_SHORT_EN : DAY_SHORT_ID)
        return pick(list, dow)
    }
    /// 0 = Sunday; serial 0 (1899-12-30) was a Saturday.
    static func weekdayOf(_ serial: Double) -> Double {
        let a = serial.rounded(.down).truncatingRemainder(dividingBy: 7)
        return (a + 7 + 6).truncatingRemainder(dividingBy: 7)
    }

    /// A date as Indonesians type it (day first; month first in en-US), to a serial.
    static func parseDateText(_ raw: String) -> Double? {
        let s = SheetJS.trim(raw)
        if let iso = isoToSerial(s) { return iso }
        if let m = SheetJS.match(SheetJS.re("^([0-9]{1,2})[/\\-.]([0-9]{1,2})[/\\-.]([0-9]{4}|[0-9]{2})\\z"), s) {
            let d = Double(isEn ? m[2]! : m[1]!)!
            let mo = Double(isEn ? m[1]! : m[2]!)!
            var y = Double(m[3]!)!
            if m[3]!.count == 2 { y += 2000 }
            return validYmd(y, mo, d) ? ymdToSerial(y, mo, d) : nil
        }
        if let m = SheetJS.match(SheetJS.re("^([0-9]{1,2})\\s+([A-Za-z]+)\\.?,?\\s+([0-9]{4})\\z"), s) {
            let d = Double(m[1]!)!, y = Double(m[3]!)!
            guard let mo = MONTHS[m[2]!.lowercased()] else { return nil }
            return validYmd(y, Double(mo), d) ? ymdToSerial(y, Double(mo), d) : nil
        }
        if let m = SheetJS.match(SheetJS.re("^([A-Za-z]+)\\.?\\s+([0-9]{1,2}),?\\s+([0-9]{4})\\z"), s) {
            let d = Double(m[2]!)!, y = Double(m[3]!)!
            guard let mo = MONTHS[m[1]!.lowercased()] else { return nil }
            return validYmd(y, Double(mo), d) ? ymdToSerial(y, Double(mo), d) : nil
        }
        return nil
    }

    // MARK: - Numbers as typed in Indonesia

    private static func allDigits(_ s: Substring) -> Bool { !s.isEmpty && s.allSatisfy { $0.isASCII && $0.isNumber } }
    private static func onlyDigits(_ s: String) -> Bool { s.allSatisfy { $0 >= "0" && $0 <= "9" } }

    private static func validGrouping(_ x: String, _ g: Character) -> Bool {
        let parts = x.split(separator: g, omittingEmptySubsequences: false)
        guard let first = parts.first, allDigits(first), first.count <= 3 else { return false }
        return parts.dropFirst().allSatisfy { $0.count == 3 && allDigits($0) }
    }

    struct ParsedNumber: Equatable { var n: Double; var separators: Bool }

    static func parseLocaleNumber(_ raw: String) -> ParsedNumber? {
        var s = SheetJS.trim(raw)
        if s.isEmpty { return nil }
        var neg = false
        if s.count >= 2, s.hasPrefix("("), s.hasSuffix(")"), !s.contains(where: { $0 == "\n" || $0 == "\r" || $0 == "\u{2028}" || $0 == "\u{2029}" }) {
            neg = true
            s = SheetJS.trim(String(s.dropFirst().dropLast()))
        }
        if s.hasPrefix("-") { neg = !neg; s = SheetJS.trim(String(s.dropFirst())) } else if s.hasPrefix("+") { s = SheetJS.trim(String(s.dropFirst())) }
        guard SheetJS.fullMatch(SheetJS.re("^([0-9][0-9.,]*|[.,][0-9]+)\\z"), s) else { return nil }
        if s.hasSuffix(".") || s.hasSuffix(",") { return nil }
        let dots = s.filter { $0 == "." }.count
        let commas = s.filter { $0 == "," }.count
        var intPart = s
        var frac = ""
        if dots > 0 && commas > 0 {
            let lastDot = s.lastIndex(of: ".")!, lastComma = s.lastIndex(of: ",")!
            let dec: Character = lastDot > lastComma ? "." : ","
            let grp: Character = dec == "." ? "," : "."
            let parts = s.split(separator: dec, omittingEmptySubsequences: false)
            if parts.count != 2 { return nil }
            if !validGrouping(String(parts[0]), grp) { return nil }
            intPart = parts[0].filter { $0 != grp }
            frac = String(parts[1])
        } else if dots > 0 || commas > 0 {
            let ch: Character = dots > 0 ? "." : ","
            let parts = s.split(separator: ch, omittingEmptySubsequences: false)
            if parts.count > 2 {
                if !validGrouping(s, ch) { return nil }
                intPart = parts.joined()
            } else {
                let a = String(parts[0]), b = String(parts[1])
                let looksGrouped = String(ch) == groupMark() && b.count == 3 && SheetJS.fullMatch(SheetJS.re("^[1-9][0-9]{0,2}\\z"), a)
                if looksGrouped { intPart = a + b } else { intPart = a; frac = b }
            }
        }
        if !onlyDigits(intPart) || !onlyDigits(frac) || (intPart + frac).isEmpty { return nil }
        let n = Double("\(intPart.isEmpty ? "0" : intPart).\(frac.isEmpty ? "0" : frac)") ?? .nan
        if !n.isFinite { return nil }
        return ParsedNumber(n: neg ? -n : n, separators: dots + commas > 0)
    }

    enum Detected: Equatable {
        case empty
        case text(String)
        case number(Double, NumFmt?)

        var kind: String {
            switch self {
            case .empty: return "empty"
            case .text: return "text"
            case .number: return "number"
            }
        }
        /// The number, for `.number`.
        var v: Double? { if case .number(let n, _) = self { return n }; return nil }
        var nf: NumFmt? { if case .number(_, let f) = self { return f }; return nil }
    }

    /// What a piece of typed/pasted text IS (text columns, paste, import).
    static func detectInput(_ text: String) -> Detected {
        let s = SheetJS.trim(text)
        if s.isEmpty { return .empty }
        if s.utf16.count > 40 { return .text(text) }
        let digits = s.unicodeScalars.filter { $0.value >= 48 && $0.value <= 57 }.count
        if digits == 0 { return .text(text) }
        if s.hasPrefix("+") { return .text(text) }
        if s.hasSuffix("%") {
            var body = String(s.dropLast())
            while let last = body.unicodeScalars.last, SheetJS.isSpace(last.value) { body = String(body.unicodeScalars.dropLast()) }
            let hasLineBreak = body.unicodeScalars.contains { $0 == "\n" || $0 == "\r" || $0.value == 0x2028 || $0.value == 0x2029 }
            if !hasLineBreak {
                if let p = parseLocaleNumber(body) { return .number(p.n / 100, .pct) }
                return .text(text)
            }
        }
        if let m = SheetJS.match(SheetJS.re("^(-?)\\s*(?:rp\\.?|idr)\\s*(-?)\\s*([0-9.,]+?)(?:,-)?\\z", true), s) {
            guard let p = parseLocaleNumber(m[3]!) else { return .text(text) }
            let neg = (m[1] == "-") != (m[2] == "-")
            return .number(neg ? -p.n : p.n, .idr)
        }
        if let date = parseDateText(s) { return .number(date, .date) }
        guard let p = parseLocaleNumber(s) else { return .text(text) }
        var bare = Substring(s)
        while let f = bare.first, f == "-" || f == "(" { bare = bare.dropFirst() }
        if bare.hasSuffix(")") { bare = bare.dropLast() }
        let bs = Array(bare.unicodeScalars)
        if bs.count >= 2 && bs[0] == "0" && bs[1].value >= 48 && bs[1].value <= 57 { return .text(text) }
        if digits > 15 { return .text(text) }
        return .number(p.n, p.separators ? .num : nil)
    }

    /// Numeric value of text that is clearly a number/Rupiah/percent/date, else nil.
    static func numberFromText(_ s: String) -> Double? {
        if let iso = isoToSerial(s) { return iso }
        if case .number(let v, _) = detectInput(s) { return v }
        return nil
    }

    // MARK: - Display formatting

    static func numberFormat(_ v: Double, maxFrac: Int, grouping: Bool, minFrac: Int = 0) -> String {
        SheetJS.intlFormat(v, maxFrac: maxFrac, minFrac: minFrac, grouping: grouping, decimal: decimalMark(), group: groupMark())
    }
    static func formatRupiah(_ n: Double) -> String { "Rp \(numberFormat(n, maxFrac: 2, grouping: true))" }
    static func formatGrouped(_ n: Double, _ maxFrac: Int = 2) -> String { numberFormat(n, maxFrac: maxFrac, grouping: true) }

    /// "11 Okt 2026" ("Oct 11, 2026" in en-US).
    static func formatDateSerial(_ serial: Double) -> String {
        if !serial.isFinite { return SheetJS.numberToString(serial) }
        let p = serialToYmdD(serial)
        let ys = SheetJS.numberToString(p.y)
        // An out-of-range month reads "undefined", as JS array indexing does.
        let mi = p.m - 1
        let ok = mi.isFinite && mi >= 0 && mi < 12
        let mon = ok ? (isEn ? MONTH_SHORT_EN : MONTH_SHORT_ID)[Int(mi)] : "undefined"
        if isEn { return "\(mon) \(SheetJS.numberToString(p.d)), \(ys)" }
        return "\(pad2(p.d)) \(mon) \(ys)"
    }
    /// What goes back into the editor for a date (en-US: "9/26/2008").
    static func editDateSerial(_ serial: Double) -> String {
        let p = serialToYmdD(serial)
        let ys = SheetJS.numberToString(p.y)
        if isEn { return "\(SheetJS.numberToString(p.m))/\(SheetJS.numberToString(p.d))/\(ys)" }
        return "\(pad2(p.d))/\(pad2(p.m))/\(ys)"
    }

    /// A value with an explicit format. Errors print as-is.
    static func formatValue(_ v: SheetCellValue, _ nf: NumFmt?) -> String {
        switch v {
        case .empty: return ""
        case .bool(let b): return b ? "TRUE" : "FALSE"
        case .text(let s):
            if s.isEmpty { return "" }
            if nf == .date, let ser = isoToSerial(s) { return formatDateSerial(ser) }
            return s
        case .number(let n):
            if !n.isFinite { return ERR.num }
            switch nf {
            case .idr?: return formatRupiah(n)
            case .num?: return formatGrouped(n, 6)
            case .pct?: return "\(numberFormat(n * 100, maxFrac: 4, grouping: true))%"
            case .date?: return editDateSerial(n)
            case nil: return numberFormat(n, maxFrac: 10, grouping: false)
            }
        }
    }

    /// The text a TypedCell is edited as.
    static func editTyped(_ c: TypedCell) -> String {
        switch c.nf {
        case .idr: return formatRupiah(c.v)
        case .num: return formatGrouped(c.v, 10)
        case .pct: return "\(numberFormat(c.v * 100, maxFrac: 10, grouping: true))%"
        case .date: return editDateSerial(c.v)
        }
    }

    /// A plain stored scalar under its column type.
    static func formatScalar(_ type: String, _ value: Any?) -> String {
        let k = kind(value)
        switch k {
        case .null: return ""
        case .string(let s) where s.isEmpty: return ""
        case .array(let a): return joinList(a)
        default: break
        }
        if let t = typedCell(value) { return formatValue(.number(t.v), t.nf) }
        if let l = linkOf(value) { return (l.t?.isEmpty == false) ? l.t! : l.u }
        if case .object = k { return "" }
        if case .other = k { return "" }
        switch type {
        case "currency":
            if case .number(let n) = k { return formatRupiah(n) }
            return jsString(value)
        case "number":
            if case .number(let n) = k { return formatGrouped(n) }
            return jsString(value)
        case "date":
            if case .number(let n) = k { return formatDateSerial(n) }
            let str = jsString(value)
            if let ser = parseDateText(str) { return formatDateSerial(ser) }
            return str
        case "checkbox":
            return jsTruthy(value) ? "✓" : ""
        default:
            if case .number(let n) = k { return formatValue(.number(n), nil) }
            if case .bool(let b) = k { return b ? "TRUE" : "FALSE" }
            return jsString(value)
        }
    }

    /// The display locale's currency symbol.
    static func currencySymbol() -> String { isEn ? "$" : "Rp" }

    /// A number under a cell's explicit number format (`nf` style kind, `dp` decimals, `pt` pattern).
    /// Returns nil when the style doesn't change how this value reads.
    static func formatWithStyle(_ v: SheetCellValue, _ nf: String?, _ dp: Int?, _ inferred: NumFmt? = nil, _ pt: String? = nil) -> String? {
        if nf == "custom", let pt = pt, !pt.isEmpty, case .text(let s) = v, !s.isEmpty, !isError(v) {
            let r = formatNumberPattern(v, pt).text
            return r == s ? nil : r
        }
        guard case .number(let n) = v, n.isFinite else { return nil }
        let auto = nf == nil || nf == "" || nf == "auto"
        if auto && dp == nil { return nil }
        let kindName: String? = auto ? inferred?.rawValue : nf
        let fixed = dp ?? 2
        let sym = currencySymbol()
        switch kindName {
        case "idr"?: return "Rp \(numberFormat(n, maxFrac: dp ?? 2, grouping: true, minFrac: dp ?? 0))"
        case "pct"?: return "\(numberFormat(n * 100, maxFrac: dp ?? 2, grouping: true, minFrac: dp ?? 0))%"
        case "date"?: return editDateSerial(n)
        case "text"?: return SheetJS.numberToString(n)
        case "sci"?:
            let zeros = fixed > 0 ? "." + String(repeating: "0", count: fixed) : ""
            return formatNumberPattern(v, "0\(zeros)E+00").text
        case "acct"?:
            if n == 0 { return "\(sym) - " }
            let body = numberFormat(abs(n), maxFrac: fixed, grouping: true, minFrac: fixed)
            return n < 0 ? "\(sym) (\(body))" : "\(sym) \(body) "
        case "fin"?:
            let body = numberFormat(abs(n), maxFrac: fixed, grouping: true, minFrac: fixed)
            return n < 0 ? "(\(body))" : body
        case "cur"?, "cur0"?:
            let d = dp ?? (kindName == "cur0" ? 0 : 2)
            let body = numberFormat(abs(n), maxFrac: d, grouping: true, minFrac: d)
            let hasNonZero = body.contains { $0 >= "1" && $0 <= "9" }
            return "\(n < 0 && hasNonZero ? "-" : "")\(sym)\(body)"
        case "time"?: return formatNumberPattern(v, isEn ? "h:mm:ss AM/PM" : "hh.mm.ss").text
        case "dt"?: return formatNumberPattern(v, isEn ? "m/d/yyyy hh:mm:ss" : "dd/mm/yyyy hh.mm.ss").text
        case "dur"?: return formatNumberPattern(v, "[h]:mm:ss").text
        case "custom"?:
            if let pt = pt, !pt.isEmpty { return formatNumberPattern(v, pt).text }
            return nil
        default: return numberFormat(n, maxFrac: dp ?? 2, grouping: true, minFrac: dp ?? 0)
        }
    }

    /// How many decimals a number shows right now (toolbar "decimals −/+").
    static func decimalsShown(_ text: String) -> Int {
        var t = text
        if t.hasSuffix("%") { t.removeLast() }
        let pattern = isEn ? "\\.([0-9]+)" : ",([0-9]+)"
        guard let m = SheetJS.match(SheetJS.re(pattern), t) else { return 0 }
        return m[1]!.utf16.count
    }

    /// A formula's computed result under its column type and inferred format.
    static func formatResult(_ type: String, _ v: SheetCellValue, _ nf: NumFmt?) -> String {
        if isError(v) { return v.text! }
        if v.isEmptyOrBlank { return "" }
        if type == "date", case .number(let n) = v, nf == .date || nf == nil { return formatScalar(type, n) }
        if let nf = nf { return formatValue(v, nf) }
        if case .number(let n) = v, type == "currency" || type == "number" || type == "date" { return formatScalar(type, n) }
        if type == "checkbox" {
            if v == .bool(true) || v == .number(1) { return "✓" }
            return formatValue(v, nil)
        }
        return formatValue(v, nil)
    }
}

/// JavaScript Date arithmetic on epoch milliseconds (local time == UTC here; Jakarta has no DST).
enum SheetDate {
    static let maxMs: Double = 8.64e15

    static func timeClip(_ t: Double) -> Double {
        if !t.isFinite || abs(t) > maxMs { return .nan }
        return t < 0 ? -(-t).rounded(.down) : t.rounded(.down)
    }

    /// Days since 1970-01-01 of a proleptic Gregorian (year, month 1–12, day 1).
    static func daysFromCivil(_ y0: Double, _ m: Double, _ d: Double) -> Double {
        let y = m <= 2 ? y0 - 1 : y0
        let eraF = (y / 400).rounded(.down)
        let yoe = y - eraF * 400
        let mp = m > 2 ? m - 3 : m + 9
        let doy = ((153 * mp + 2) / 5).rounded(.down) + d - 1
        let doe = yoe * 365 + (yoe / 4).rounded(.down) - (yoe / 100).rounded(.down) + doy
        return eraF * 146097 + doe - 719468
    }

    static func civilFromDays(_ z0: Double) -> (y: Double, m: Double, d: Double) {
        let z = z0 + 719468
        let era = (z / 146097).rounded(.down)
        let doe = z - era * 146097
        let yoe = ((doe - (doe / 1460).rounded(.down) + (doe / 36524).rounded(.down) - (doe / 146096).rounded(.down)) / 365).rounded(.down)
        let y = yoe + era * 400
        let doy = doe - (365 * yoe + (yoe / 4).rounded(.down) - (yoe / 100).rounded(.down))
        let mp = ((5 * doy + 2) / 153).rounded(.down)
        let d = doy - ((153 * mp + 2) / 5).rounded(.down) + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        return (m <= 2 ? y + 1 : y, m, d)
    }

    static func toInt(_ x: Double) -> Double {
        if x.isNaN { return .nan }
        if x.isInfinite { return x }
        return x < 0 ? -(-x).rounded(.down) : x.rounded(.down)
    }

    /// MakeDay(year, month (0-based, may overflow), date).
    static func makeDay(_ year: Double, _ month: Double, _ date: Double) -> Double {
        if !year.isFinite || !month.isFinite || !date.isFinite { return .nan }
        let y = toInt(year), m = toInt(month), dt = toInt(date)
        let ym = y + (m / 12).rounded(.down)
        let mn = m - (m / 12).rounded(.down) * 12
        if abs(ym) > 400_000 { return .nan }
        return daysFromCivil(ym, mn + 1, 1) + dt - 1
    }

    static func makeTime(_ h: Double, _ mi: Double, _ s: Double, _ ms: Double) -> Double {
        if !h.isFinite || !mi.isFinite || !s.isFinite || !ms.isFinite { return .nan }
        return toInt(h) * 3_600_000 + toInt(mi) * 60_000 + toInt(s) * 1000 + toInt(ms)
    }

    /// Date.UTC(y, m, d, …) (years 0–99 mean 1900–1999).
    static func utc(_ y: Double, _ m: Double, _ d: Double, _ h: Double = 0, _ mi: Double = 0, _ s: Double = 0) -> Double {
        var yr = y
        if !y.isNaN { let yi = toInt(y); if yi >= 0 && yi <= 99 { yr = 1900 + yi } }
        return timeClip(makeDay(yr, m, d) * 86_400_000 + makeTime(h, mi, s, 0))
    }

    /// new Date(y, m, d, h, mi, s) in local time (== UTC here).
    static func local(_ y: Double, _ m: Double, _ d: Double = 1, _ h: Double = 0, _ mi: Double = 0, _ s: Double = 0) -> Double {
        utc(y, m, d, h, mi, s)
    }

    struct Parts { var y, m, d, dow, h, mi, s, ms: Double }

    /// getFullYear/getMonth (0-based)/getDate/getDay/… of a time value (NaN parts for NaN).
    static func parts(_ t: Double) -> Parts {
        if t.isNaN { return Parts(y: .nan, m: .nan, d: .nan, dow: .nan, h: .nan, mi: .nan, s: .nan, ms: .nan) }
        let day = (t / 86_400_000).rounded(.down)
        let within = t - day * 86_400_000
        let c = civilFromDays(day)
        var dow = (day + 4).truncatingRemainder(dividingBy: 7)
        if dow < 0 { dow += 7 }
        let h = (within / 3_600_000).rounded(.down)
        let mi = ((within - h * 3_600_000) / 60_000).rounded(.down)
        let s = ((within - h * 3_600_000 - mi * 60_000) / 1000).rounded(.down)
        let ms = within - h * 3_600_000 - mi * 60_000 - s * 1000
        return Parts(y: c.y, m: c.m - 1, d: c.d, dow: dow, h: h, mi: mi, s: s, ms: ms)
    }

    static func timeWithin(_ t: Double) -> Double {
        let day = (t / 86_400_000).rounded(.down)
        return t - day * 86_400_000
    }

    static func setUTCFullYear(_ t: Double, _ y: Double) -> Double {
        let base = t.isNaN ? 0 : t
        let p = parts(base)
        return timeClip(makeDay(y, p.m, p.d) * 86_400_000 + timeWithin(base))
    }
    static func setDate(_ t: Double, _ d: Double) -> Double {
        if t.isNaN { return .nan }
        let p = parts(t)
        return timeClip(makeDay(p.y, p.m, d) * 86_400_000 + timeWithin(t))
    }
    static func setMonth(_ t: Double, _ m: Double) -> Double {
        if t.isNaN { return .nan }
        let p = parts(t)
        return timeClip(makeDay(p.y, m, p.d) * 86_400_000 + timeWithin(t))
    }
    static func startOfDay(_ t: Double) -> Double {
        if t.isNaN { return .nan }
        return (t / 86_400_000).rounded(.down) * 86_400_000
    }
}
