// Data validation for the spreadsheet — port of sheet-validation.ts. Rules apply to stored id-space
// ranges ("{colId!rowId}:{colId!rowId}", whole columns "{colId!*}:{colId!*}"); this turns rules into
// "which rule covers this cell" and "is this value valid", and translates ranges to/from A1 text.
import Foundation

enum SheetValidation {
    typealias F = SheetFormula

    enum ValidationKind: String, CaseIterable {
        case list, listRange
        case textContains, textNotContains, textIs, email, url
        case dateIs, dateBefore, dateAfter, dateBetween, dateValid
        case gt, gte, lt, lte, eq, neq, between, notBetween
        case checkbox, formula
    }

    struct ValidationRule {
        var id: String
        var ranges: [String]
        var kind: ValidationKind
        var values: [String]? = nil
        var colors: [String: String]? = nil
        var source: String? = nil
        var formula: String? = nil
        var multiple: Bool? = nil
        var strict: Bool? = nil
        /// "chip" | "arrow" | "plain"
        var display: String? = nil
        var help: String? = nil
        var checked: String? = nil
        var unchecked: String? = nil

        init(id: String, ranges: [String], kind: ValidationKind, values: [String]? = nil, colors: [String: String]? = nil,
             source: String? = nil, formula: String? = nil, multiple: Bool? = nil, strict: Bool? = nil, display: String? = nil,
             help: String? = nil, checked: String? = nil, unchecked: String? = nil) {
            self.id = id
            self.ranges = ranges
            self.kind = kind
            self.values = values
            self.colors = colors
            self.source = source
            self.formula = formula
            self.multiple = multiple
            self.strict = strict
            self.display = display
            self.help = help
            self.checked = checked
            self.unchecked = unchecked
        }

        /// From the settings JSON (ProjectSheet.settings.validations[]); nil when unreadable.
        init?(json: [String: Any]) {
            guard let kindS = json["kind"] as? String, let kind = ValidationKind(rawValue: kindS) else { return nil }
            id = json["id"] as? String ?? ""
            ranges = json["ranges"] as? [String] ?? []
            self.kind = kind
            values = json["values"] as? [String]
            colors = json["colors"] as? [String: String]
            source = json["source"] as? String
            formula = json["formula"] as? String
            multiple = SheetValidation.bool(json["multiple"])
            strict = SheetValidation.bool(json["strict"])
            display = json["display"] as? String
            help = json["help"] as? String
            checked = json["checked"] as? String
            unchecked = json["unchecked"] as? String
        }

        var json: [String: Any] {
            var o: [String: Any] = ["id": id, "ranges": ranges, "kind": kind.rawValue]
            if let v = values { o["values"] = v }
            if let v = colors { o["colors"] = v }
            if let v = source { o["source"] = v }
            if let v = formula { o["formula"] = v }
            if let v = multiple { o["multiple"] = v }
            if let v = strict { o["strict"] = v }
            if let v = display { o["display"] = v }
            if let v = help { o["help"] = v }
            if let v = checked { o["checked"] = v }
            if let v = unchecked { o["unchecked"] = v }
            return o
        }
    }

    static func bool(_ v: Any?) -> Bool? {
        if case .bool(let b) = F.kind(v) { return b }
        return nil
    }

    static let DROPDOWN_KINDS: [ValidationKind] = [.list, .listRange]
    static func isDropdown(_ r: ValidationRule?) -> Bool {
        guard let r = r else { return false }
        return DROPDOWN_KINDS.contains(r.kind)
    }

    struct Rect: Equatable {
        var top: Int
        var bottom: Int
        var left: Int
        var right: Int
    }

    static let RANGE = "^\\{\\$?([^!}]+)!\\$?([^}]+)\\}:\\{\\$?([^!}]+)!\\$?([^}]+)\\}\\z"

    /// A stored range as raw row / column indices (rows to the end of the sheet for whole columns).
    static func rangeRect(_ stored: String, _ shape: SheetShape) -> Rect? {
        guard let m = SheetJS.match(SheetJS.re(RANGE), stored) else { return nil }
        guard let c1 = shape.columnIds.firstIndex(of: m[1]!), let c2 = shape.columnIds.firstIndex(of: m[3]!) else { return nil }
        let r1 = m[2] == "*" ? 0 : (shape.rowIds.firstIndex(of: m[2]!) ?? -1)
        let r2 = m[4] == "*" ? shape.rowIds.count - 1 : (shape.rowIds.firstIndex(of: m[4]!) ?? -1)
        if r1 < 0 || r2 < 0 { return nil }
        return Rect(top: min(r1, r2), bottom: max(r1, r2), left: min(c1, c2), right: max(c1, c2))
    }

    /// A stored range as people read it: "B2:B20", "C:C", "D5".
    static func rangeToA1(_ stored: String, _ shape: SheetShape) -> String {
        guard let m = SheetJS.match(SheetJS.re(RANGE), stored) else { return "#REF!" }
        guard let c1 = shape.columnIds.firstIndex(of: m[1]!), let c2 = shape.columnIds.firstIndex(of: m[3]!) else { return "#REF!" }
        if m[2] == "*" || m[4] == "*" { return "\(F.colLetter(c1)):\(F.colLetter(c2))" }
        guard let r1 = shape.rowIds.firstIndex(of: m[2]!), let r2 = shape.rowIds.firstIndex(of: m[4]!) else { return "#REF!" }
        let a = "\(F.colLetter(c1))\(r1 + 1)", b = "\(F.colLetter(c2))\(r2 + 1)"
        return a == b ? a : "\(a):\(b)"
    }

    private static func at<T>(_ a: [T], _ i: Int) -> T? { i >= 0 && i < a.count ? a[i] : nil }

    /// A typed range ("Sheet1!B2:B20", "b2", "C:C", "A1:C") to the stored form; nil if unreadable.
    static func rangeFromA1(_ text: String, _ shape: SheetShape) -> String? {
        var s = SheetJS.trim(text)
        s = SheetJS.replaceAll(SheetJS.re("^(?:'[^']*'|[^!]*)!"), s) { _ in "" }
        s = s.replacingOccurrences(of: "$", with: "").uppercased()
        if let m = SheetJS.match(SheetJS.re("^([A-Z]{1,3}):([A-Z]{1,3})\\z"), s) {
            guard let a = at(shape.columnIds, F.letterToIndex(m[1]!)), let b = at(shape.columnIds, F.letterToIndex(m[2]!)),
                  !a.isEmpty, !b.isEmpty else { return nil }
            return "{\(a)!*}:{\(b)!*}"
        }
        guard let m = SheetJS.match(SheetJS.re("^([A-Z]{1,3})([0-9]+)(?::([A-Z]{1,3})([0-9]+)?)?\\z"), s) else { return nil }
        let rowNum = { (d: String) -> Int in Int(min(Double(d) ?? 0, 1e15)) - 1 }
        let c1 = at(shape.columnIds, F.letterToIndex(m[1]!))
        let r1 = at(shape.rowIds, rowNum(m[2]!))
        let c2 = at(shape.columnIds, F.letterToIndex(m[3] ?? m[1]!))
        var r2: String?
        if m[3] != nil {
            r2 = m[4] != nil ? at(shape.rowIds, rowNum(m[4]!)) : shape.rowIds.last
        } else {
            r2 = r1
        }
        guard let a = c1, let b = c2, let x = r1, let y = r2, !a.isEmpty, !b.isEmpty, !x.isEmpty, !y.isEmpty else { return nil }
        return "{\(a)!\(x)}:{\(b)!\(y)}"
    }

    /// Which rule covers a cell: the LAST rule listed wins.
    static func buildRuleIndex(_ rules: [ValidationRule], _ shape: SheetShape) -> (Int, Int) -> ValidationRule? {
        let rects = rules.map { r in (rule: r, rects: r.ranges.compactMap { rangeRect($0, shape) }) }
        return { rawRow, col in
            for entry in rects.reversed() {
                for rc in entry.rects where rawRow >= rc.top && rawRow <= rc.bottom && col >= rc.left && col <= rc.right {
                    return entry.rule
                }
            }
            return nil
        }
    }

    /// The top-left cell of a rule's first readable range.
    static func ruleOrigin(_ rule: ValidationRule, _ shape: SheetShape) -> (r: Int, c: Int) {
        for x in rule.ranges { if let rc = rangeRect(x, shape) { return (rc.top, rc.left) } }
        return (0, 0)
    }

    static func textOf(_ v: SheetCellValue) -> String {
        switch v {
        case .empty: return ""
        case .number: return F.formatValue(v, nil)
        case .bool(let b): return b ? "TRUE" : "FALSE"
        case .text(let s): return s
        }
    }

    /// The choices of a dropdown rule: its items, or the distinct values of its source range.
    static func dropdownOptions(_ rule: ValidationRule, _ engine: SheetEngine?, _ shape: SheetShape) -> [String] {
        if rule.kind == .list { return (rule.values ?? []).filter { !SheetJS.trim($0).isEmpty } }
        guard rule.kind == .listRange, let source = rule.source, !source.isEmpty, let engine = engine else { return [] }
        guard let rc = rangeRect(source, shape) else { return [] }
        var out: [String] = []
        var seen = Set<String>()
        var r = rc.top
        while r <= min(rc.bottom, rc.top + 5000) {
            for c in rc.left...rc.right {
                let v = engine.value(shape.rowIds[r], shape.columnIds[c])
                if v.isEmptyOrBlank || F.isError(v) { continue }
                let t = textOf(v)
                if seen.insert(t).inserted { out.append(t) }
            }
            r += 1
        }
        return out
    }

    /// The picked items of a (multi-)dropdown cell.
    static func pickedValues(_ raw: Any?) -> [String] {
        switch F.kind(raw) {
        case .null: return []
        case .string(let s) where s.isEmpty: return []
        case .array(let a): return a.map { SheetJS.trim(F.jsString($0)) }.filter { !$0.isEmpty }
        default:
            return F.jsString(raw).components(separatedBy: ",").map { SheetJS.trim($0) }.filter { !$0.isEmpty }
        }
    }

    /// Is the checkbox ticked? TRUE, or the rule's custom "checked" value.
    static func isChecked(_ rule: ValidationRule?, _ raw: Any?) -> Bool {
        if case .bool(true) = F.kind(raw) { return true }
        if let c = rule?.checked, !c.isEmpty {
            if case .null = F.kind(raw) { return "" == c }
            return F.jsString(raw) == c
        }
        if case .string(let s) = F.kind(raw) { return SheetJS.trim(s).uppercased() == "TRUE" }
        return false
    }

    /// The value a checkbox writes when toggled (String, Bool or nil).
    static func checkboxValue(_ rule: ValidationRule?, _ on: Bool) -> Any? {
        let checked = rule?.checked ?? "", unchecked = rule?.unchecked ?? ""
        if !checked.isEmpty || !unchecked.isEmpty {
            if on { return checked.isEmpty ? true : checked }
            return rule?.unchecked
        }
        return on
    }

    static func asSerial(_ v: SheetCellValue) -> Double? {
        switch v {
        case .number(let n): return n
        case .text(let s): return F.isoToSerial(s) ?? F.parseDateText(s)
        default: return nil
        }
    }

    static func criteriaSerial(_ s: String?, today: Double? = nil) -> Double? {
        guard let s = s, !s.isEmpty else { return nil }
        let t = SheetJS.trim(s).lowercased()
        let now = today ?? F.todaySerial()
        if t == "today" || t == "hari ini" { return now }
        if t == "tomorrow" || t == "besok" { return now + 1 }
        if t == "yesterday" || t == "kemarin" { return now - 1 }
        return F.parseDateText(s)
    }

    static func criteriaNumber(_ s: String?) -> Double? {
        guard let s = s, !s.isEmpty else { return nil }
        return F.parseLocaleNumber(s)?.n
    }

    private static func isBlankRaw(_ raw: Any?) -> Bool {
        switch F.kind(raw) {
        case .null: return true
        case .string(let s): return s.isEmpty
        case .array(let a): return a.isEmpty
        default: return false
        }
    }

    /// Does a cell's value pass its rule? Blank always passes. `raw` is the stored value, `computed`
    /// the engine's value, `at` the cell's raw position (custom formulas shift from the rule's top-left).
    static func validateCell(_ rule: ValidationRule, _ raw: Any?, _ computed: SheetCellValue,
                             engine: SheetEngine?, shape: SheetShape, at: (r: Int, c: Int)) -> Bool {
        if rule.kind == .checkbox {
            switch F.kind(raw) {
            case .null, .bool: return true
            case .string(let s) where s.isEmpty: return true
            default: break
            }
            let s = F.jsString(raw)
            let checked = rule.checked ?? "", unchecked = rule.unchecked ?? ""
            if !checked.isEmpty || !unchecked.isEmpty { return s == rule.checked || s == rule.unchecked }
            let up = SheetJS.trim(s).uppercased()
            return up == "TRUE" || up == "FALSE"
        }
        if isBlankRaw(raw) { return true }
        if F.isError(computed) { return false }
        let text = SheetJS.trim(textOf(computed))
        let values = rule.values ?? []
        let v0 = values.first ?? ""
        switch rule.kind {
        case .list, .listRange:
            let options = Set(dropdownOptions(rule, engine, shape))
            let picked: [String]
            if rule.multiple == true {
                picked = pickedValues(raw)
            } else if F.isFormulaCell(raw) {
                picked = [text]
            } else if case .array(let a) = F.kind(raw) {
                picked = [SheetJS.trim(F.joinList(a))]
            } else {
                picked = [SheetJS.trim(F.jsString(raw))]
            }
            return picked.allSatisfy { options.contains($0) }
        case .textContains: return text.lowercased().contains(v0.lowercased()) || v0.isEmpty
        case .textNotContains: return !(text.lowercased().contains(v0.lowercased()) || v0.isEmpty)
        case .textIs: return text == v0
        case .email: return SheetJS.fullMatch(SheetJS.re("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}\\z"), text)
        case .url: return SheetJS.fullMatch(SheetJS.re("^(https?://)?([A-Za-z0-9_-]+\\.)+[A-Za-z0-9_-]{2,}(/\\S*)?\\z", true), text)
        case .dateValid: return asSerial(computed) != nil
        case .dateIs, .dateBefore, .dateAfter, .dateBetween:
            guard let v = asSerial(computed), let a = criteriaSerial(values.first) else { return false }
            let b = criteriaSerial(values.count > 1 ? values[1] : nil)
            let d = v.rounded(.down)
            switch rule.kind {
            case .dateIs: return d == a
            case .dateBefore: return d < a
            case .dateAfter: return d > a
            default:
                guard let b = b else { return false }
                return d >= min(a, b) && d <= max(a, b)
            }
        case .gt, .gte, .lt, .lte, .eq, .neq, .between, .notBetween:
            var v: Double?
            if case .number(let n) = computed { v = n } else { v = criteriaNumber(text) }
            guard let x = v, let a = criteriaNumber(values.first) else { return false }
            let b = criteriaNumber(values.count > 1 ? values[1] : nil)
            switch rule.kind {
            case .gt: return x > a
            case .gte: return x >= a
            case .lt: return x < a
            case .lte: return x <= a
            case .eq: return x == a
            case .neq: return x != a
            case .between:
                guard let b = b else { return false }
                return x >= min(a, b) && x <= max(a, b)
            default:
                guard let b = b else { return false }
                return x < min(a, b) || x > max(a, b)
            }
        case .formula:
            guard let f = rule.formula, !f.isEmpty, let engine = engine else { return true }
            let origin = ruleOrigin(rule, shape)
            let shifted = F.toStored(F.shiftFormula(F.toDisplay(f, shape), at.r - origin.r, at.c - origin.c), shape)
            let rowId: String? = at.r >= 0 && at.r < shape.rowIds.count ? shape.rowIds[at.r] : nil
            let out = engine.evaluateFormula(shifted, rowId)
            if F.isError(out) { return false }
            switch out {
            case .bool(let b): return b
            case .number(let n): return n != 0
            case .text(let s): return s.uppercased() == "TRUE"
            case .empty: return false
            }
        case .checkbox: return true
        }
    }

    /// Default translator: English text with {name} placeholders filled.
    static func englishText(_ en: String, _ vars: [String: String]) -> String {
        var s = en
        for (k, v) in vars { s = s.replacingOccurrences(of: "{\(k)}", with: v) }
        return s
    }

    /// The message shown for an invalid value: the rule's help text, else Sheets' default wording
    /// (English source text through `t`, like the web's t()).
    static func invalidMessage(_ rule: ValidationRule, _ t: (String, [String: String]) -> String = englishText) -> String {
        if let h = rule.help, !h.isEmpty { return h }
        let v = rule.values ?? []
        let v0 = v.first ?? "", v1 = v.count > 1 ? v[1] : ""
        switch rule.kind {
        case .list, .listRange: return t("Input must be an item on the specified list", [:])
        case .checkbox: return t("Input must be a checkbox value", [:])
        case .email: return t("Input must be a valid email address", [:])
        case .url: return t("Input must be a valid URL", [:])
        case .dateValid: return t("Input must be a valid date", [:])
        case .textContains: return t("Input must contain \"{v}\"", ["v": v0])
        case .textNotContains: return t("Input must not contain \"{v}\"", ["v": v0])
        case .textIs: return t("Input must be exactly \"{v}\"", ["v": v0])
        case .dateIs: return t("Input must be the date {v}", ["v": v0])
        case .dateBefore: return t("Input must be a date before {v}", ["v": v0])
        case .dateAfter: return t("Input must be a date after {v}", ["v": v0])
        case .dateBetween: return t("Input must be a date between {a} and {b}", ["a": v0, "b": v1])
        case .gt: return t("Input must be greater than {v}", ["v": v0])
        case .gte: return t("Input must be greater than or equal to {v}", ["v": v0])
        case .lt: return t("Input must be less than {v}", ["v": v0])
        case .lte: return t("Input must be less than or equal to {v}", ["v": v0])
        case .eq: return t("Input must be equal to {v}", ["v": v0])
        case .neq: return t("Input must not be equal to {v}", ["v": v0])
        case .between: return t("Input must be between {a} and {b}", ["a": v0, "b": v1])
        case .notBetween: return t("Input must not be between {a} and {b}", ["a": v0, "b": v1])
        case .formula: return t("Input must satisfy the custom formula", [:])
        }
    }

    static func randomId(_ prefix: String) -> String {
        let chars = Array("0123456789abcdefghijklmnopqrstuvwxyz")
        return prefix + String((0..<8).map { _ in chars[Int.random(in: 0..<chars.count)] })
    }
    static func newRuleId() -> String { randomId("v_") }
}
