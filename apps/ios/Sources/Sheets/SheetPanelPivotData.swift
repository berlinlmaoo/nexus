// Pivot tables for the spreadsheet — 1:1 port of the web's lib/sheet-pivot.ts (Google Sheets parity, Oct 2026).
//
// A pivot reads a source range whose first row holds the field names, groups the records below it by the
// Rows and Columns fields (multi-level), summarises the Values fields and lays the result out the way Sheets
// does: column field names on top, row field names on the bottom header row, per-group "<value> Total"
// subtotals for every level that has a deeper one, and a "Grand Total" row/column. Labels produced here are
// English ("Grand Total", "SUM of Jumlah"); the UI translates them. Foundation only; tested on Linux.
import Foundation

struct SPPivotGroup: Equatable {
    var colId: String
    /// "asc" | "desc"
    var order: String? = nil
    var totals: Bool? = nil
}

struct SPPivotValue: Equatable {
    var colId: String
    var fn: String
    /// "default" | "row" | "col" | "total"
    var showAs: String? = nil
}

struct SPPivotFilter: Equatable {
    var colId: String
    var hidden: [String]? = nil
}

/// settings.pivot of a pivot sheet (web sheet-model.ts PivotSpec).
struct SPPivotSpec: Equatable {
    var source: String
    var range: String
    var rows: [SPPivotGroup] = []
    var cols: [SPPivotGroup] = []
    var values: [SPPivotValue] = []
    var filters: [SPPivotFilter] = []

    init(source: String, range: String, rows: [SPPivotGroup] = [], cols: [SPPivotGroup] = [],
         values: [SPPivotValue] = [], filters: [SPPivotFilter] = []) {
        self.source = source; self.range = range; self.rows = rows; self.cols = cols; self.values = values; self.filters = filters
    }

    init?(json o: [String: Any]) {
        guard let source = o["source"] as? String, let range = o["range"] as? String else { return nil }
        self.source = source
        self.range = range
        func groups(_ k: String) -> [SPPivotGroup] {
            ((o[k] as? [[String: Any]]) ?? []).compactMap { g in
                guard let c = g["colId"] as? String else { return nil }
                var totals: Bool? = nil
                if case .bool(let b) = SheetFormula.kind(g["totals"]) { totals = b }
                return SPPivotGroup(colId: c, order: g["order"] as? String, totals: totals)
            }
        }
        rows = groups("rows")
        cols = groups("cols")
        values = ((o["values"] as? [[String: Any]]) ?? []).compactMap { v in
            guard let c = v["colId"] as? String else { return nil }
            return SPPivotValue(colId: c, fn: v["fn"] as? String ?? "SUM", showAs: v["showAs"] as? String)
        }
        filters = ((o["filters"] as? [[String: Any]]) ?? []).compactMap { f in
            guard let c = f["colId"] as? String else { return nil }
            return SPPivotFilter(colId: c, hidden: f["hidden"] as? [String])
        }
    }

    var json: [String: Any] {
        func group(_ g: SPPivotGroup) -> [String: Any] {
            var o: [String: Any] = ["colId": g.colId]
            if let x = g.order { o["order"] = x }
            if let x = g.totals { o["totals"] = x }
            return o
        }
        return [
            "source": source, "range": range,
            "rows": rows.map(group), "cols": cols.map(group),
            "values": values.map { v -> [String: Any] in
                var o: [String: Any] = ["colId": v.colId, "fn": v.fn]
                if let s = v.showAs { o["showAs"] = s }
                return o
            },
            "filters": filters.map { f -> [String: Any] in
                var o: [String: Any] = ["colId": f.colId]
                if let h = f.hidden { o["hidden"] = h }
                return o
            },
        ]
    }
}

/// One output cell: blank (JS null), a number, or text.
enum SPPivotCell: Equatable {
    case blank
    case number(Double)
    case text(String)

    var text: String {
        switch self {
        case .blank: return ""
        case .number(let n): return SheetJS.numberToString(n)
        case .text(let s): return s
        }
    }
}

/// The data a pivot reads (its source sheet), and a header fallback for a blank header cell.
struct SPPivotSource {
    var data: SheetData
    var engine: SheetEngine
    var headerOf: (String) -> String
}

enum SPPivot {
    typealias F = SheetFormula

    static let FUNCTIONS = ["SUM", "COUNTA", "COUNT", "COUNTUNIQUE", "AVERAGE", "MAX", "MIN", "MEDIAN", "PRODUCT", "STDEV", "STDEVP", "VAR", "VARP"]
    static let MAX_COLUMNS = 50

    struct Result: Equatable {
        var grid: [[SPPivotCell]]
        /// nil | "num" | "pct"
        var formats: [[String?]]
        var error: String? = nil
    }

    struct Suggestion {
        var template: String
        var vars: [String: String]
        var label: String
        var spec: SPPivotSpec
    }

    // MARK: reading the source

    struct Field { var colId: String; var name: String }
    struct Source { var fields: [Field]; var rowIds: [String] }

    static func readSource(_ src: SPPivotSource, _ range: String) -> Source? {
        let shape = src.data.shape
        guard let rc = SheetValidation.rangeRect(range, shape) else { return nil }
        let headerRow = shape.rowIds[rc.top]
        var fields: [Field] = []
        for c in rc.left...rc.right {
            let colId = shape.columnIds[c]
            let v = src.engine.value(headerRow, colId)
            let text: String
            switch v {
            case .empty: text = ""
            case .number: text = F.formatValue(v, nil)
            case .bool(let b): text = b ? "TRUE" : "FALSE"
            case .text(let s): text = s
            }
            let t = SheetJS.trim(text)
            fields.append(Field(colId: colId, name: t.isEmpty ? src.headerOf(colId) : t))
        }
        let rows = rc.top + 1 <= rc.bottom ? Array(shape.rowIds[(rc.top + 1)...rc.bottom]) : []
        return Source(fields: fields, rowIds: rows)
    }

    static func isDate(_ src: SPPivotSource, _ rowId: String, _ colId: String) -> Bool {
        src.engine.format(rowId, colId) == .date
    }

    static func isBlank(_ v: SheetCellValue) -> Bool { v == .empty || v == .text("") }

    /// The text a value is filtered and listed by (dates as dates, numbers in the sheet locale).
    static func textOf(_ src: SPPivotSource, _ rowId: String, _ colId: String, _ v: SheetCellValue) -> String {
        switch v {
        case .empty: return ""
        case .bool(let b): return b ? "TRUE" : "FALSE"
        case .number: return F.formatValue(v, isDate(src, rowId, colId) ? .date : nil)
        case .text(let s): return s
        }
    }

    enum SortKey { case blank, num(Double), str(String) }

    /// A group key: equal values group together; numbers and text never mix.
    struct GroupVal { var key: String; var sort: SortKey; var label: SPPivotCell }

    static func groupVal(_ src: SPPivotSource, _ rowId: String, _ colId: String) -> GroupVal {
        let v = src.engine.value(rowId, colId)
        switch v {
        case .empty: return GroupVal(key: "b:", sort: .blank, label: .text(""))
        case .text(let s) where s.isEmpty: return GroupVal(key: "b:", sort: .blank, label: .text(""))
        case .number(let n):
            let label: SPPivotCell = isDate(src, rowId, colId) ? .text(F.formatValue(v, .date)) : .number(n)
            return GroupVal(key: "n:\(SheetJS.numberToString(n))", sort: .num(n), label: label)
        case .bool(let b):
            let t = b ? "TRUE" : "FALSE"
            return GroupVal(key: "s:\(t)", sort: .str(t), label: .text(t))
        case .text(let s):
            return GroupVal(key: "s:\(s)", sort: .str(s), label: .text(s))
        }
    }

    /// Intl.Collator("id", { numeric: true, sensitivity: "base" }), then code units.
    static func collate(_ a: String, _ b: String) -> Int {
        let r = a.compare(b, options: [.caseInsensitive, .diacriticInsensitive, .numeric, .widthInsensitive],
                          range: nil, locale: Locale(identifier: "id"))
        if r == .orderedAscending { return -1 }
        if r == .orderedDescending { return 1 }
        let ua = Array(a.utf16), ub = Array(b.utf16)
        if ua == ub { return 0 }
        return ua.lexicographicallyPrecedes(ub) ? -1 : 1
    }

    /// Numbers numerically and before text, text by the Indonesian collation, blanks last (either order).
    static func compareGroup(_ a: GroupVal, _ b: GroupVal, _ desc: Bool) -> Int {
        switch (a.sort, b.sort) {
        case (.blank, .blank): return 0
        case (.blank, _): return 1
        case (_, .blank): return -1
        default: break
        }
        var r: Int
        switch (a.sort, b.sort) {
        case (.num(let x), .num(let y)): r = x < y ? -1 : (x > y ? 1 : 0)
        case (.num, _): r = -1
        case (_, .num): r = 1
        case (.str(let x), .str(let y)): r = collate(x, y)
        default: r = 0
        }
        return desc ? -r : r
    }

    // MARK: summarising

    static let NUMERIC_TYPES: Set<String> = ["number", "currency", "percent"]

    static func summarize(_ fn: String, _ vals: [SheetCellValue], _ numericColumn: Bool) -> SPPivotCell {
        var nums: [Double] = []
        var nonBlank = 0
        var distinct = Set<String>()
        for v in vals {
            if isBlank(v) { continue }
            nonBlank += 1
            switch v {
            case .number(let n):
                distinct.insert("n:\(SheetJS.numberToString(n))")
                nums.append(n)
            case .bool(let b):
                distinct.insert("s:\(b ? "true" : "false")")
            case .text(let s):
                distinct.insert("s:\(s)")
                if numericColumn && !F.isError(v), let n = F.numberFromText(s) { nums.append(n) }
            case .empty: break
            }
        }
        let n = nums.count
        let sum = nums.reduce(0, +)
        func variance(_ sample: Bool) -> SPPivotCell {
            if n < (sample ? 2 : 1) { return .text("#DIV/0!") }
            let mean = sum / Double(n)
            let ss = nums.reduce(0) { $0 + ($1 - mean) * ($1 - mean) }
            return .number(ss / Double(sample ? n - 1 : n))
        }
        switch fn {
        case "SUM": return .number(sum)
        case "COUNTA": return .number(Double(nonBlank))
        case "COUNT": return .number(Double(n))
        case "COUNTUNIQUE": return .number(Double(distinct.count))
        case "AVERAGE": return n > 0 ? .number(sum / Double(n)) : .text("#DIV/0!")
        case "MAX": return .number(nums.max() ?? 0)
        case "MIN": return .number(nums.min() ?? 0)
        case "MEDIAN":
            if n == 0 { return .text("#NUM!") }
            let s = nums.sorted()
            return .number(n % 2 == 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2)
        case "PRODUCT": return .number(n > 0 ? nums.reduce(1, *) : 0)
        case "VAR": return variance(true)
        case "VARP": return variance(false)
        case "STDEV":
            if case .number(let x) = variance(true) { return .number(x.squareRoot()) }
            return variance(true)
        case "STDEVP":
            if case .number(let x) = variance(false) { return .number(x.squareRoot()) }
            return variance(false)
        default: return .text("#VALUE!")
        }
    }

    // MARK: group trees

    struct Rec { var rowId: String; var rowPath: [String]; var colPath: [String] }
    final class Node {
        let val: GroupVal
        let path: [String]
        var children: [Node] = []
        init(val: GroupVal, path: [String]) { self.val = val; self.path = path }
    }

    static func buildTree(_ recs: [Rec], _ groups: [SPPivotGroup], _ vals: (Rec, Int) -> GroupVal, _ pathOf: (Rec) -> [String]) -> [Node] {
        func build(_ subset: [Rec], _ level: Int, _ prefix: [String]) -> [Node] {
            if level >= groups.count { return [] }
            var order: [String] = []
            var byKey: [String: (val: GroupVal, recs: [Rec])] = [:]
            for r in subset {
                let k = pathOf(r)[level]
                if byKey[k] == nil { byKey[k] = (vals(r, level), []); order.append(k) }
                byKey[k]?.recs.append(r)
            }
            let desc = groups[level].order == "desc"
            // Stable sort, as Array.prototype.sort is.
            let sorted = order.enumerated().sorted { x, y in
                let c = compareGroup(byKey[x.element]!.val, byKey[y.element]!.val, desc)
                return c != 0 ? c < 0 : x.offset < y.offset
            }.map { $0.element }
            return sorted.map { k in
                let g = byKey[k]!
                let node = Node(val: g.val, path: prefix + [g.val.key])
                node.children = build(g.recs, level + 1, node.path)
                return node
            }
        }
        return build(recs, 0, [])
    }

    /// One row (or column) of the output: a leaf group, a subtotal, or the grand total.
    struct Line {
        var kind: String
        var path: [String]
        var labels: [Int: SPPivotCell]
        var level: Int
    }

    static func linesOf(_ tree: [Node], _ groups: [SPPivotGroup], _ withTotals: Bool) -> [Line] {
        var out: [Line] = []
        func walk(_ nodes: [Node], _ level: Int) {
            for node in nodes {
                let first = out.count
                if level == groups.count - 1 {
                    out.append(Line(kind: "leaf", path: node.path, labels: [:], level: level))
                } else {
                    walk(node.children, level + 1)
                    if withTotals && groups[level].totals != false {
                        let label = node.val.label == .text("") ? "" : node.val.label.text
                        var line = Line(kind: "sub", path: node.path, labels: [:], level: level)
                        line.labels[level] = .text(SheetJS.trim("\(label) Total"))
                        out.append(line)
                    }
                }
                // Sheets shows a group's label once, on its first line.
                if out.count > first { out[first].labels[level] = node.val.label }
            }
        }
        walk(tree, 0)
        if withTotals && !groups.isEmpty && groups[0].totals != false {
            out.append(Line(kind: "grand", path: [], labels: [0: .text("Grand Total")], level: 0))
        }
        return out
    }

    // MARK: computePivot

    static func valueLabel(_ v: SPPivotValue, _ name: String) -> String { "\(v.fn) of \(name)" }

    static func computePivot(_ spec: SPPivotSpec, _ src: SPPivotSource) -> Result {
        guard let source = readSource(src, spec.range) else { return Result(grid: [], formats: [], error: "invalid range") }
        var nameOf: [String: String] = [:]
        for f in source.fields { nameOf[f.colId] = f.name }
        let rows = spec.rows.filter { nameOf[$0.colId] != nil }
        let cols = spec.cols.filter { nameOf[$0.colId] != nil }
        let values = spec.values.filter { nameOf[$0.colId] != nil }
        let filters = spec.filters.filter { nameOf[$0.colId] != nil }

        // Records, minus the filtered-out ones.
        var recs: [Rec] = []
        for rowId in source.rowIds {
            var hidden = false
            for f in filters {
                guard let h = f.hidden, !h.isEmpty else { continue }
                if h.contains(textOf(src, rowId, f.colId, src.engine.value(rowId, f.colId))) { hidden = true; break }
            }
            if hidden { continue }
            recs.append(Rec(rowId: rowId,
                            rowPath: rows.map { groupVal(src, rowId, $0.colId).key },
                            colPath: cols.map { groupVal(src, rowId, $0.colId).key }))
        }

        let R = rows.count, C = cols.count, V = values.count
        if R == 0 && C == 0 && V == 0 { return Result(grid: [], formats: []) }

        let withTotals = V > 0
        let rowTree = buildTree(recs, rows, { r, l in groupVal(src, r.rowId, rows[l].colId) }, { $0.rowPath })
        let colTree = buildTree(recs, cols, { r, l in groupVal(src, r.rowId, cols[l].colId) }, { $0.colPath })
        let rowLines: [Line] = R > 0 ? linesOf(rowTree, rows, withTotals)
            : (V > 0 ? [Line(kind: "grand", path: [], labels: [:], level: 0)] : [])
        let colLines: [Line] = C > 0 ? linesOf(colTree, cols, withTotals) : [Line(kind: "grand", path: [], labels: [:], level: 0)]

        let L = max(R, C > 0 ? 1 : 0)
        let per = max(V, 1)
        let width = L + (C == 0 && V == 0 ? 0 : colLines.count * per)
        func blankRow() -> [SPPivotCell] { Array(repeating: .blank, count: width) }
        var grid: [[SPPivotCell]] = []
        var formats: [[String?]] = []
        func push(_ cells: [SPPivotCell], _ fmt: [String?]? = nil) {
            grid.append(cells)
            formats.append(fmt ?? Array(repeating: nil, count: width))
        }
        let vLabels = values.map { valueLabel($0, nameOf[$0.colId] ?? $0.colId) }

        // Header rows.
        if C > 0 {
            var top = blankRow()
            if V == 1 { top[0] = .text(vLabels[0]) }
            for (i, g) in cols.enumerated() where L + i < width { top[L + i] = .text(nameOf[g.colId] ?? g.colId) }
            push(top)
            for l in 0..<C {
                var row = blankRow()
                for (i, line) in colLines.enumerated() { if let lab = line.labels[l] { row[L + i * per] = lab } }
                if l == C - 1 && V <= 1 { for (i, g) in rows.enumerated() { row[i] = .text(nameOf[g.colId] ?? g.colId) } }
                push(row)
            }
            if V > 1 {
                var row = blankRow()
                for (i, g) in rows.enumerated() { row[i] = .text(nameOf[g.colId] ?? g.colId) }
                for i in colLines.indices { for (j, lab) in vLabels.enumerated() { row[L + i * per + j] = .text(lab) } }
                push(row)
            }
        } else {
            var row = blankRow()
            for (i, g) in rows.enumerated() { row[i] = .text(nameOf[g.colId] ?? g.colId) }
            for (j, lab) in vLabels.enumerated() { row[L + j] = .text(lab) }
            push(row)
        }

        // Buckets: records per row path prefix ("" = all).
        func pk(_ p: [String]) -> String { p.joined(separator: "\u{1}") }
        var rowBuckets: [String: [Rec]] = [:]
        for r in recs {
            for d in 0...R { rowBuckets[pk(Array(r.rowPath.prefix(d))), default: []].append(r) }
        }
        func numericCol(_ colId: String) -> Bool { NUMERIC_TYPES.contains(src.data.types?[colId] ?? "") }
        var memo: [String: SPPivotCell] = [:]
        func cell(_ rp: [String], _ cp: [String], _ vi: Int) -> SPPivotCell {
            let key = "\(pk(rp))\u{2}\(pk(cp))\u{2}\(vi)"
            if let hit = memo[key] { return hit }
            let ck = pk(cp)
            let inBucket = (rowBuckets[pk(rp)] ?? []).filter { pk(Array($0.colPath.prefix(cp.count))) == ck }
            let v = values[vi]
            let out: SPPivotCell = inBucket.isEmpty ? .blank
                : summarize(v.fn, inBucket.map { src.engine.value($0.rowId, v.colId) }, numericCol(v.colId))
            memo[key] = out
            return out
        }
        func shown(_ rp: [String], _ cp: [String], _ vi: Int) -> SPPivotCell {
            let raw = cell(rp, cp, vi)
            let mode = values[vi].showAs ?? "default"
            guard mode != "default", case .number(let x) = raw else { return raw }
            let denom = mode == "row" ? cell(rp, [], vi) : mode == "col" ? cell([], cp, vi) : cell([], [], vi)
            guard case .number(let d) = denom else { return denom }
            return d == 0 ? .text("#DIV/0!") : .number(x / d)
        }

        // Data rows.
        for line in rowLines {
            var row = blankRow()
            var fmt: [String?] = Array(repeating: nil, count: width)
            for (i, lab) in line.labels where i < L { row[i] = lab }
            if V > 0 {
                for (i, cl) in colLines.enumerated() {
                    for (j, v) in values.enumerated() {
                        let at = L + i * per + j
                        let out = shown(line.path, cl.path, j)
                        row[at] = out
                        if case .number = out { fmt[at] = (v.showAs ?? "default") == "default" ? "num" : "pct" }
                    }
                }
            }
            push(row, fmt)
        }

        if width > MAX_COLUMNS {
            return Result(grid: grid.map { Array($0.prefix(MAX_COLUMNS)) }, formats: formats.map { Array($0.prefix(MAX_COLUMNS)) },
                          error: "too many columns")
        }
        return Result(grid: grid, formats: formats)
    }

    // MARK: editor helpers

    /// Every distinct value of a field (as filter text: "" = blank), in ascending group order.
    static func distinctFieldValues(_ src: SPPivotSource, _ range: String, _ colId: String) -> [String] {
        guard let source = readSource(src, range), source.fields.contains(where: { $0.colId == colId }) else { return [] }
        var order: [String] = []
        var seen: [String: GroupVal] = [:]
        for rowId in source.rowIds {
            let text = textOf(src, rowId, colId, src.engine.value(rowId, colId))
            if seen[text] == nil { seen[text] = groupVal(src, rowId, colId); order.append(text) }
        }
        return order.enumerated().sorted { x, y in
            let c = compareGroup(seen[x.element]!, seen[y.element]!, false)
            return c != 0 ? c < 0 : x.offset < y.offset
        }.map { $0.element }
    }

    /// The source range's fields (header names), for the editor's field lists.
    static func pivotFields(_ src: SPPivotSource, _ range: String) -> [(colId: String, label: String)] {
        (readSource(src, range)?.fields ?? []).map { ($0.colId, $0.name) }
    }

    /// Up to four ready-made pivots, like Sheets' "Suggested" cards.
    static func pivotSuggestions(_ src: SPPivotSource, _ range: String) -> [Suggestion] {
        guard let source = readSource(src, range), !source.rowIds.isEmpty else { return [] }
        struct Stat { var field: Field; var numeric: Bool; var distinct: Int; var nonBlank: Int }
        let stats: [Stat] = source.fields.map { field in
            var nums = 0, nonBlank = 0, dates = 0
            var distinct = Set<String>()
            for rowId in source.rowIds {
                let v = src.engine.value(rowId, field.colId)
                if isBlank(v) { continue }
                nonBlank += 1
                distinct.insert(textOf(src, rowId, field.colId, v))
                if case .number = v { nums += 1; if isDate(src, rowId, field.colId) { dates += 1 } }
            }
            return Stat(field: field, numeric: nonBlank > 0 && nums * 2 >= nonBlank && dates * 2 < nonBlank, distinct: distinct.count, nonBlank: nonBlank)
        }
        let numeric = stats.filter { $0.numeric }
        let cats = stats.filter { !$0.numeric && $0.nonBlank > 0 && $0.distinct >= 1 }
        guard let row = cats.first else { return [] }
        let col = cats.dropFirst().enumerated().sorted { a, b in
            a.element.distinct != b.element.distinct ? a.element.distinct < b.element.distinct : a.offset < b.offset
        }.first?.element
        var out: [Suggestion] = []
        func add(_ template: String, _ vars: [String: String], rows: [SPPivotGroup], cols: [SPPivotGroup] = [], values: [SPPivotValue]) {
            if out.count >= 4 { return }
            var label = template
            for (k, v) in vars { label = label.replacingOccurrences(of: "{\(k)}", with: v) }
            out.append(Suggestion(template: template, vars: vars, label: label,
                                  spec: SPPivotSpec(source: "", range: range, rows: rows, cols: cols, values: values, filters: [])))
        }
        func g(_ s: Stat) -> SPPivotGroup { SPPivotGroup(colId: s.field.colId, order: "asc", totals: true) }
        func val(_ s: Stat, _ fn: String) -> SPPivotValue { SPPivotValue(colId: s.field.colId, fn: fn, showAs: "default") }
        if let num = numeric.first {
            add("SUM of {value} for each {row}", ["value": num.field.name, "row": row.field.name], rows: [g(row)], values: [val(num, "SUM")])
            if let col {
                add("SUM of {value} for each {row} by {col}", ["value": num.field.name, "row": row.field.name, "col": col.field.name],
                    rows: [g(row)], cols: [g(col)], values: [val(num, "SUM")])
            }
            add("AVERAGE of {value} for each {row}", ["value": num.field.name, "row": row.field.name], rows: [g(row)], values: [val(num, "AVERAGE")])
        }
        if let col {
            add("COUNTA of {value} for each {row}", ["value": row.field.name, "row": col.field.name], rows: [g(col)], values: [val(row, "COUNTA")])
        } else {
            add("COUNTA of {value} for each {row}", ["value": row.field.name, "row": row.field.name], rows: [g(row)], values: [val(row, "COUNTA")])
        }
        return out
    }
}
