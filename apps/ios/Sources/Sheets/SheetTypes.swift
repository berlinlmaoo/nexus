// Pure helpers of the web grid (apps/nexus-lovable-ui/src/components/sheets/sheet-types.ts): column
// labels, column rules, SheetData building, cell display / edit text, typed input -> stored value,
// TSV, aggregates and the fill handle's series logic. Tailwind class tables are not ported (the web's
// optionColor returns classes; `optionColor` here returns the colour NAME).
import Foundation

/// A sheet column as the server returns it (NexusSheetColumn).
struct SheetColumn {
    var id: String
    var name: String
    /// text | number | currency | date | select | multiselect | checkbox | task | link
    var type: String
    var width: Double? = nil
    var options: [String]? = nil
    /// choice -> colour name (rose, amber, green, blue, violet, slate)
    var optionColors: [String: String]? = nil
    var color: String? = nil
    /// Column rules, raw JSON ({op, value?, style}); see `SheetTypes.Rule`.
    var rules: [[String: Any]]? = nil

    init(id: String, name: String, type: String, width: Double? = nil, options: [String]? = nil,
         optionColors: [String: String]? = nil, color: String? = nil, rules: [[String: Any]]? = nil) {
        self.id = id; self.name = name; self.type = type; self.width = width; self.options = options
        self.optionColors = optionColors; self.color = color; self.rules = rules
    }

    init?(json: [String: Any]) {
        guard let id = json["id"] as? String else { return nil }
        self.id = id
        name = json["name"] as? String ?? ""
        type = json["type"] as? String ?? "text"
        if case .number(let w) = SheetFormula.kind(json["width"]) { width = w }
        options = json["options"] as? [String]
        optionColors = json["optionColors"] as? [String: String]
        color = json["color"] as? String
        rules = json["rules"] as? [[String: Any]]
    }

    var ruleList: [SheetTypes.Rule] { (rules ?? []).compactMap { SheetTypes.Rule(json: $0) } }
}

/// A sheet row as the server returns it (NexusSheetRow).
struct SheetRowData {
    var id: String
    var cells: [String: Any]
    var styles: [String: [String: Any]]? = nil
    var height: Double? = nil
    var updatedAt: String? = nil

    init(id: String, cells: [String: Any], styles: [String: [String: Any]]? = nil, height: Double? = nil, updatedAt: String? = nil) {
        self.id = id; self.cells = cells; self.styles = styles; self.height = height; self.updatedAt = updatedAt
    }

    init?(json: [String: Any]) {
        guard let id = json["id"] as? String else { return nil }
        self.id = id
        cells = json["cells"] as? [String: Any] ?? [:]
        styles = json["styles"] as? [String: [String: Any]]
        if case .number(let h) = SheetFormula.kind(json["height"]) { height = h }
        updatedAt = json["updatedAt"] as? String
    }
}

enum SheetTypes {
    typealias F = SheetFormula

    /// English source text (translate in the UI).
    static let COLUMN_COLOR_LABEL: [String: String] = [
        "rose": "Red", "amber": "Yellow", "green": "Green", "blue": "Blue", "violet": "Purple", "slate": "Grey",
    ]
    static let CHIP_COLORS = ["rose", "amber", "green", "blue", "violet", "slate"]

    /// The chip colour NAME for one dropdown choice: an explicit pick, else the palette by position.
    static func optionColor(_ col: SheetColumn, _ value: String) -> String {
        if let explicit = col.optionColors?[value], !explicit.isEmpty {
            return CHIP_COLORS.contains(explicit) ? explicit : "slate"
        }
        guard let i = (col.options ?? []).firstIndex(of: value) else { return "slate" }
        return CHIP_COLORS[i % CHIP_COLORS.count]
    }

    /// English source text (translate in the UI).
    static let COLUMN_TYPE_LABEL: [String: String] = [
        "text": "Text", "number": "Number", "currency": "Rupiah", "date": "Date", "select": "Dropdown",
        "multiselect": "Multi-select", "checkbox": "Checkbox", "task": "Task", "link": "Link",
    ]

    static let RULE_OP_LABEL: [String: String] = [
        "gt": "greater than", "lt": "less than", "gte": "≥", "lte": "≤",
        "eq": "is equal to", "neq": "is not equal to", "contains": "contains",
        "empty": "is empty", "notEmpty": "is not empty",
    ]

    /// A column rule (NexusSheetRule): op, optional value, style name.
    struct Rule: Equatable {
        /// gt | lt | gte | lte | eq | neq | contains | empty | notEmpty
        var op: String
        var value: String? = nil
        /// red | amber | green | blue | grey | bold
        var style: String
        init(op: String, value: String? = nil, style: String) { self.op = op; self.value = value; self.style = style }
        init?(json: [String: Any]) {
            guard let op = json["op"] as? String else { return nil }
            self.op = op
            value = json["value"] as? String
            style = json["style"] as? String ?? "grey"
        }
    }

    /// First matching rule wins; numeric when both sides look numeric, otherwise text.
    static func matchRule(_ rules: [Rule]?, _ value: SheetCellValue?) -> Rule? {
        guard let rules = rules, !rules.isEmpty else { return nil }
        let v = value ?? .empty
        let empty = v.isEmptyOrBlank
        if F.isError(v) { return rules.first { $0.op == "notEmpty" } }
        for rule in rules {
            if rule.op == "empty" { if empty { return rule }; continue }
            if rule.op == "notEmpty" { if !empty { return rule }; continue }
            if empty { continue }
            let target = rule.value ?? ""
            let targetNum = target.isEmpty ? nil : F.parseLocaleNumber(target)?.n
            let str = F.jsStringOf(v)
            if rule.op == "contains" {
                if target.isEmpty || str.lowercased().contains(target.lowercased()) { return rule }
                continue
            }
            if case .number(let a) = v, let b = targetNum {
                let hit: Bool
                switch rule.op {
                case "gt": hit = a > b
                case "lt": hit = a < b
                case "gte": hit = a >= b
                case "lte": hit = a <= b
                case "neq": hit = a != b
                default: hit = a == b
                }
                if hit { return rule }
                continue
            }
            let cmp = SheetJS.localeCompare(str, target)
            let hit: Bool
            switch rule.op {
            case "gt": hit = cmp > 0
            case "lt": hit = cmp < 0
            case "gte": hit = cmp >= 0
            case "lte": hit = cmp <= 0
            case "neq": hit = cmp != 0
            default: hit = cmp == 0
            }
            if hit { return rule }
        }
        return nil
    }

    /// Build the evaluation context once per render.
    static func buildSheetData(_ columns: [SheetColumn], _ rows: [SheetRowData], _ names: [(name: String, range: String)]? = nil) -> SheetData {
        SheetData(columns: columns.map { ($0.id, $0.type) }, rows: rows.map { ($0.id, $0.cells) }, names: names)
    }

    /// The value a cell COMPUTES to (formula result, typed number, link label…).
    static func cellValue(_ box: SheetDataBox, _ rowId: String, _ colId: String) -> SheetCellValue {
        F.engineFor(box).value(rowId, colId)
    }

    /// The choices held by a multi-select cell (a plain comma string counts).
    static func readMulti(_ value: Any?) -> [String] {
        let list: [String]
        switch F.kind(value) {
        case .array(let a): list = a.map { F.jsString($0) }
        case .null: list = [""]
        default: list = F.jsString(value).components(separatedBy: ",")
        }
        var seen = Set<String>()
        var out: [String] = []
        for v in list.map({ SheetJS.trim($0) }) where !v.isEmpty && seen.insert(v).inserted { out.append(v) }
        return out
    }

    static func isLinkCell(_ v: Any?) -> Bool { F.linkOf(v) != nil }

    /// A formula cell shows its RESULT; everything else shows itself.
    static func displayCell(_ type: String, _ raw: Any?, _ ctx: (engine: SheetEngine, rowId: String, colId: String)?) -> String {
        if let f = F.formulaOf(raw) {
            guard let c = ctx else { return f }
            return F.formatResult(type, c.engine.value(c.rowId, c.colId), c.engine.format(c.rowId, c.colId))
        }
        return F.formatScalar(type, raw)
    }

    /// The A1 form (Indonesian separators) of a formula cell for the editor; nil otherwise.
    static func editFormula(_ raw: Any?, _ shape: SheetShape, _ locale: SheetFormula.SheetLocale = .id) -> String? {
        F.formulaOf(raw).map { F.toDisplay($0, shape, locale) }
    }

    static func formatCell(_ type: String, _ value: Any?) -> String { F.formatScalar(type, value) }
    static func formatComputed(_ type: String, _ v: SheetCellValue, _ nf: SheetFormula.NumFmt? = nil) -> String { F.formatResult(type, v, nf) }

    /// What goes INTO the input when editing — text that, typed back, gives the same value.
    static func editValue(_ type: String, _ value: Any?) -> String {
        let k = F.kind(value)
        if case .null = k { return "" }
        if type == "checkbox" { return F.jsTruthy(value) ? "true" : "" }
        if case .array(let a) = k { return a.map { F.jsString($0) }.joined(separator: ", ") }
        if let t = F.typedCell(value) { return F.editTyped(t) }
        if let l = F.linkOf(value) { return (l.t?.isEmpty == false) ? l.t! : l.u }
        if let f = F.formulaOf(value) { return f }
        if case .number(let n) = k { return F.formatValue(.number(n), nil) }
        if case .object = k { return "" }
        return F.jsString(value)
    }

    /// Typed text -> the value to store for this column (nil = clear). One path for typing, paste,
    /// fill-from-text and replace. Returns String, Double, Bool, or a JSON object ([String: Any]).
    static func inputToCell(_ col: SheetColumn, _ text: String, _ shape: SheetShape, _ prevRaw: Any? = nil) -> Any? {
        let trimmed = SheetJS.trim(text)
        if trimmed.isEmpty { return nil }
        if trimmed.hasPrefix("=") && trimmed.utf16.count > 1 && col.type != "checkbox" {
            return ["f": F.toStored(trimmed, shape)] as [String: Any]
        }
        switch col.type {
        case "checkbox":
            return ["true", "1", "ya", "yes", "y", "✓", "x"].contains(trimmed.lowercased())
        case "link":
            let prevUrl = F.linkOf(prevRaw)?.u ?? ""
            return prevUrl.isEmpty ? trimmed : (["t": trimmed, "u": prevUrl] as [String: Any])
        case "multiselect", "select", "task":
            return trimmed
        case "number", "currency":
            if case .number(let v, let nf) = F.detectInput(trimmed) {
                if nf == .pct || nf == .date { return ["v": v, "nf": nf!.rawValue] as [String: Any] }
                return v
            }
            if let p = F.parseLocaleNumber(trimmed) { return p.n }
            return text
        case "date":
            guard let serial = F.parseDateText(trimmed) else { return text }
            return F.serialToIso(serial)
        default:
            if case .number(let v, let nf) = F.detectInput(text) {
                if let nf = nf { return ["v": v, "nf": nf.rawValue] as [String: Any] }
                return v
            }
            return text
        }
    }

    /// Two stored values are the same cell content (structural; "" and nil are the same).
    static func sameCell(_ a: Any?, _ b: Any?) -> Bool {
        func norm(_ v: Any?) -> Any? {
            switch F.kind(v) {
            case .null: return nil
            case .string(let s) where s.isEmpty: return nil
            default: return v
            }
        }
        return SheetJSONValue.equal(norm(a), norm(b))
    }

    enum SortKey: Equatable {
        case n(Double)
        case s(String)
    }

    /// Sort key: numbers (and dates, typed values, numeric ISO dates) sort as numbers, the rest as text.
    static func sortKey(_ v: SheetCellValue) -> SortKey? {
        switch v {
        case .empty: return nil
        case .number(let n): return .n(n)
        case .bool(let b): return .n(b ? 1 : 0)
        case .text(let s):
            if s.isEmpty { return nil }
            if F.isError(v) { return .s("\u{FFFF}\(s)") }
            if let iso = F.isoToSerial(s) { return .n(iso) }
            return .s(s)
        }
    }

    /// Copy/paste interchange: TSV like Excel and Google Sheets put on text/plain.
    static func toTsv(_ rows: [[String]]) -> String {
        rows.map { r in
            r.map { c in
                c.unicodeScalars.contains { $0 == "\t" || $0 == "\n" || $0 == "\"" }
                    ? "\"\(c.replacingOccurrences(of: "\"", with: "\"\""))\"" : c
            }.joined(separator: "\t")
        }.joined(separator: "\n")
    }

    /// Parse pasted TSV (quoted cells may hold tabs/newlines, like Excel emits).
    static func parseTsv(_ text: String) -> [[String]] {
        let u = Array(text.unicodeScalars)
        var rows: [[String]] = []
        var row: [String] = []
        var cell = String.UnicodeScalarView()
        var quoted = false
        var i = 0
        while i < u.count {
            let ch = u[i]
            if quoted {
                if ch == "\"" {
                    if i + 1 < u.count && u[i + 1] == "\"" { cell.append("\""); i += 1 } else { quoted = false }
                } else {
                    cell.append(ch)
                }
                i += 1
                continue
            }
            if ch == "\"" && cell.isEmpty { quoted = true; i += 1; continue }
            if ch == "\t" { row.append(String(cell)); cell = String.UnicodeScalarView(); i += 1; continue }
            if ch == "\n" || ch == "\r" {
                if ch == "\r" && i + 1 < u.count && u[i + 1] == "\n" { i += 1 }
                row.append(String(cell)); rows.append(row); row = []; cell = String.UnicodeScalarView()
                i += 1
                continue
            }
            cell.append(ch)
            i += 1
        }
        if !cell.isEmpty || !row.isEmpty { row.append(String(cell)); rows.append(row) }
        while let last = rows.last, last.allSatisfy({ $0.isEmpty }) { rows.removeLast() }
        return rows
    }

    struct Aggregate: Equatable {
        var sum: Double
        var avg: Double
        var filled: Int
        var numeric: Int
        var count: Int
        var min: Double
        var max: Double
    }

    /// Footer / status-bar aggregates over computed values.
    static func aggregate(_ rows: [SheetRowData], _ col: SheetColumn, _ engine: SheetEngine? = nil) -> Aggregate {
        var sum: Double = 0, numeric = 0, filled = 0
        var mn = Double.infinity, mx = -Double.infinity
        for r in rows {
            let raw = r.cells[col.id]
            var v: SheetCellValue
            var other = false
            if let e = engine {
                v = e.value(r.id, col.id)
            } else if F.isFormulaCell(raw) {
                v = .empty
            } else {
                switch F.kind(raw) {
                case .null: v = .empty
                case .number(let n): v = .number(n)
                case .string(let s): v = .text(s)
                case .bool(let b): v = .bool(b)
                default: v = .empty; other = true
                }
            }
            if !other && (v.isEmptyOrBlank || F.isError(v)) { continue }
            filled += 1
            if case .number(let n) = v {
                sum += n; numeric += 1
                mn = SheetJS.jsMin([mn, n]); mx = SheetJS.jsMax([mx, n])
            }
        }
        return Aggregate(sum: sum, avg: numeric > 0 ? sum / Double(numeric) : 0, filled: filled, numeric: numeric, count: rows.count, min: mn, max: mx)
    }

    private static func ymdOf(_ s: Double) -> (y: Double, m: Double, d: Double) {
        let p = SheetDate.parts(SheetDate.timeClip(F.EPOCH_MS + s * 86_400_000))
        return (p.y, p.m, p.d)
    }

    private static func isBlank(_ v: Any?) -> Bool {
        switch F.kind(v) {
        case .null: return true
        case .string(let s): return s.isEmpty
        default: return false
        }
    }

    /// What dragging the fill handle produces: continue a series (numbers, dates by day or month,
    /// typed numbers, "Hari 1"), else repeat the block. Values are stored-cell values.
    static func fillValues(_ source: [Any?], _ count: Int) -> [Any?] {
        var out: [Any?] = []
        let present = source.filter { !isBlank($0) }
        func repeatBlock() -> [Any?] {
            (0..<count).map { i in source.isEmpty ? nil : source[i % source.count] }
        }

        let serials: [Double?] = present.map { v in
            if let t = F.typedCell(v), t.nf == .date { return t.v }
            return F.isoToSerial(v)
        }
        if !present.isEmpty && serials.allSatisfy({ $0 != nil }) {
            let isIso: Bool = { if case .string = F.kind(present[0]) { return true }; return false }()
            func wrap(_ serial: Double) -> Any { isIso ? F.serialToIso(serial) : (["v": serial, "nf": "date"] as [String: Any]) }
            let ss = serials.map { $0! }
            if ss.count >= 2 {
                let a = ymdOf(ss[0]), b = ymdOf(ss[1])
                let monthStep = (b.y - a.y) * 12 + (b.m - a.m)
                let byMonth = a.d == b.d && monthStep != 0 && ss.enumerated().allSatisfy { i, s in
                    let x = ymdOf(s)
                    return x.d == a.d && (x.y - a.y) * 12 + (x.m - a.m) == monthStep * Double(i)
                }
                if byMonth {
                    let last = ymdOf(ss[ss.count - 1])
                    for i in 1...max(count, 1) where i <= count {
                        let t = SheetDate.parts(SheetDate.utc(last.y, last.m + monthStep * Double(i), 1))
                        let dim = SheetDate.parts(SheetDate.utc(t.y, t.m + 1, 0)).d
                        let ms = SheetDate.utc(t.y, t.m, min(a.d, dim))
                        out.append(wrap(SheetJS.round((ms - F.EPOCH_MS) / 86_400_000)))
                    }
                    return out
                }
            }
            let step = ss.count >= 2 ? ss[1] - ss[0] : 1
            let constant = ss.indices.allSatisfy { $0 == 0 || ss[$0] - ss[$0 - 1] == step }
            if constant && step != 0 {
                var next = ss[ss.count - 1]
                for _ in 0..<count { next += step; out.append(wrap(next)) }
                return out
            }
        }

        let typed = present.compactMap { F.typedCell($0) }
        if present.count >= 2 && typed.count == present.count && typed.allSatisfy({ $0.nf != .date }) {
            let step = typed[1].v - typed[0].v
            let ok = typed.indices.allSatisfy { $0 == 0 || abs(typed[$0].v - typed[$0 - 1].v - step) < 1e-9 }
            if step != 0 && ok {
                var next = typed[typed.count - 1].v
                for _ in 0..<count { next += step; out.append(["v": next, "nf": typed[0].nf.rawValue] as [String: Any]) }
                return out
            }
        }

        let clean = present.filter { v in
            switch F.kind(v) {
            case .array, .object, .other: return false
            default: return true
            }
        }
        if clean.count != present.count { return repeatBlock() }

        let nums = clean.compactMap { v -> Double? in if case .number(let n) = F.kind(v) { return n }; return nil }
        if clean.count >= 2 && nums.count == clean.count {
            let step = nums[1] - nums[0]
            let constant = nums.indices.allSatisfy { $0 == 0 || nums[$0] - nums[$0 - 1] == step }
            if constant && step != 0 {
                var next = nums[nums.count - 1]
                for _ in 0..<count { next += step; out.append(next) }
                return out
            }
        }

        let strs = clean.compactMap { v -> String? in if case .string(let s) = F.kind(v) { return s }; return nil }
        if !clean.isEmpty && strs.count == clean.count, let m = trailingNumber(strs[strs.count - 1]) {
            let prefix = m.prefix
            let samePrefix = strs.allSatisfy { $0.hasPrefix(prefix) }
            var step: Double = 1
            if strs.count >= 2 {
                let lastN = SheetJS.stringToNumber(trailingDigits(strs[strs.count - 1]) ?? "x")
                let prevN = trailingDigits(strs[strs.count - 2]).map { SheetJS.stringToNumber($0) } ?? .nan
                step = lastN - prevN
            }
            let bareSingle = strs.count == 1 && prefix.isEmpty
            if samePrefix && !bareSingle && step.isFinite && step != 0 {
                var n = SheetJS.stringToNumber(m.digits)
                for _ in 0..<count { n += step; out.append("\(prefix)\(SheetJS.numberToString(n))") }
                return out
            }
        }
        return repeatBlock()
    }

    /// /(\d+)$/ on a string.
    private static func trailingDigits(_ s: String) -> String? {
        let u = Array(s.unicodeScalars)
        var i = u.count
        while i > 0 && u[i - 1].value >= 48 && u[i - 1].value <= 57 { i -= 1 }
        if i == u.count { return nil }
        return F.string(u[i...])
    }

    /// /^(.*?)(\d+)$/ (no line breaks before the digits).
    private static func trailingNumber(_ s: String) -> (prefix: String, digits: String)? {
        guard let d = trailingDigits(s) else { return nil }
        let u = Array(s.unicodeScalars)
        let prefix = Array(u[0..<(u.count - d.unicodeScalars.count)])
        if prefix.contains(where: { $0 == "\n" || $0 == "\r" || $0.value == 0x2028 || $0.value == 0x2029 }) { return nil }
        return (F.string(prefix), d)
    }
}
