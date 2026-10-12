import Foundation

// The spreadsheet's basic filter, filter views and slicers — 1:1 port of the web's lib/sheet-filter.ts
// (plus compareValues from lib/sheet-datatools.ts, which its sorting uses). Foundation only; tested on
// Linux against every case of sheet-filter.test.mjs (Tests/SheetModel).
//
// A filter covers a range whose FIRST row is the header (never hidden). Each column can hide values (by
// the text the cell shows; "" is "(Blanks)"), require a condition (the same conditions as conditional
// formatting), or require a fill / text colour. Slicers add their own criteria on top, AND-ed. Rows are
// identified by id, so hidden rows survive inserts and sorting.

enum SheetFilter {
    typealias F = SheetFormula

    /// One column's filter: hidden values (by shown text), a condition, or a colour.
    struct Crit: Equatable {
        var hidden: [String]? = nil
        var cond: Cond? = nil
        var fill: String? = nil
        var text: String? = nil

        struct Cond: Equatable {
            var kind: String
            var values: [String]? = nil
            var formula: String? = nil
        }

        init(hidden: [String]? = nil, cond: Cond? = nil, fill: String? = nil, text: String? = nil) {
            self.hidden = hidden; self.cond = cond; self.fill = fill; self.text = text
        }

        init?(json: Any?) {
            guard let o = json as? [String: Any] else { return nil }
            hidden = o["hidden"] as? [String]
            if let c = o["cond"] as? [String: Any], let kind = c["kind"] as? String {
                cond = Cond(kind: kind, values: c["values"] as? [String], formula: c["formula"] as? String)
            }
            fill = o["fill"] as? String
            text = o["text"] as? String
        }

        var json: [String: Any] {
            var o: [String: Any] = [:]
            if let hidden, !hidden.isEmpty { o["hidden"] = hidden }
            if let cond {
                var c: [String: Any] = ["kind": cond.kind]
                if let v = cond.values { c["values"] = v }
                if let f = cond.formula { c["formula"] = f }
                o["cond"] = c
            }
            if let fill { o["fill"] = fill }
            if let text { o["text"] = text }
            return o
        }
    }

    struct SortSpec: Equatable {
        var colId: String
        /// "asc" | "desc"
        var dir: String

        init(colId: String, dir: String) { self.colId = colId; self.dir = dir }
        init?(json: Any?) {
            guard let o = json as? [String: Any], let c = o["colId"] as? String, let d = o["dir"] as? String, d == "asc" || d == "desc" else { return nil }
            colId = c; dir = d
        }
        var json: [String: Any] { ["colId": colId, "dir": dir] }
    }

    /// settings.filter, or one of settings.filterViews (then with id + name).
    struct Spec: Equatable {
        var range: String
        var criteria: [String: Crit] = [:]
        var sort: SortSpec? = nil
        var id: String? = nil
        var name: String? = nil

        init(range: String, criteria: [String: Crit] = [:], sort: SortSpec? = nil) {
            self.range = range; self.criteria = criteria; self.sort = sort
        }

        init?(json: Any?) {
            guard let o = json as? [String: Any], let r = o["range"] as? String else { return nil }
            range = r
            for (k, v) in (o["criteria"] as? [String: Any]) ?? [:] { if let c = Crit(json: v) { criteria[k] = c } }
            sort = SortSpec(json: o["sort"])
            id = o["id"] as? String
            name = o["name"] as? String
        }

        var json: [String: Any] {
            var o: [String: Any] = ["range": range]
            let cr = criteria.mapValues { $0.json }.filter { !$0.value.isEmpty }
            if !cr.isEmpty { o["criteria"] = cr }
            if let sort { o["sort"] = sort.json }
            if let id { o["id"] = id }
            if let name { o["name"] = name }
            return o
        }
    }

    struct Opts {
        var shape: SheetShape
        var engine: SheetEngine?
        /// The text a cell shows (formatted), used for "Filter by values".
        var display: (String, String) -> String
        /// The cell's fill / text colour (after conditional formatting), for "Filter by colour".
        var styleOf: (String, String) -> (bg: String?, fc: String?)?
        var slicers: [(colId: String, crit: Crit?)] = []
        var today: Double? = nil
    }

    /// Does a column's criteria filter anything? (A filtered column shows a solid funnel.)
    static func critActive(_ crit: Crit?) -> Bool {
        guard let c = crit else { return false }
        return !(c.hidden ?? []).isEmpty || c.cond != nil || c.fill != nil || c.text != nil
    }

    private static func sameColor(_ a: String?, _ b: String) -> Bool { (a ?? "").lowercased() == b.lowercased() }

    /// Does one row pass one column's criteria?
    static func passesCrit(_ crit: Crit, _ rowId: String, _ colId: String, at: (r: Int, c: Int), origin: (r: Int, c: Int), _ opts: Opts) -> Bool {
        if let h = crit.hidden, !h.isEmpty, h.contains(opts.display(rowId, colId)) { return false }
        if let cond = crit.cond {
            let v: SheetCellValue = opts.engine.map { $0.value(rowId, colId) } ?? .text(opts.display(rowId, colId))
            let ctx = SheetCF.CondCtx(engine: opts.engine, formula: cond.formula, shape: opts.shape, at: at, origin: origin, today: opts.today)
            if !SheetCF.matchCondition(cond.kind, cond.values, v, ctx) { return false }
        }
        if crit.fill != nil || crit.text != nil {
            let st = opts.styleOf(rowId, colId)
            if let fill = crit.fill, !sameColor(st?.bg ?? "#ffffff", fill) { return false }
            if let text = crit.text, !sameColor(st?.fc ?? "#000000", text) { return false }
        }
        return true
    }

    struct Result {
        var hidden: Set<String>
        var headerRow: Int
        var rect: SheetValidation.Rect?
    }

    /// Which body rows the filter (and any slicers) hide.
    static func applyFilter(_ filter: Spec, _ opts: Opts) -> Result {
        var hidden = Set<String>()
        guard let rect = SheetValidation.rangeRect(filter.range, opts.shape) else { return Result(hidden: hidden, headerRow: -1, rect: nil) }
        var checks: [(colId: String, c: Int, crit: Crit)] = []
        func add(_ colId: String, _ crit: Crit?) {
            if let c = opts.shape.columnIds.firstIndex(of: colId), let crit, critActive(crit) { checks.append((colId, c, crit)) }
        }
        // Object.entries order: the criteria as stored. Order does not change the result (AND).
        for colId in filter.criteria.keys.sorted() { add(colId, filter.criteria[colId]) }
        for s in opts.slicers { add(s.colId, s.crit) }
        if checks.isEmpty { return Result(hidden: hidden, headerRow: rect.top, rect: rect) }
        if rect.top + 1 <= rect.bottom {
            for r in (rect.top + 1)...rect.bottom {
                guard r < opts.shape.rowIds.count else { continue }
                let rowId = opts.shape.rowIds[r]
                for ch in checks {
                    // Custom formulas are written for the first data row of the column.
                    if !passesCrit(ch.crit, rowId, ch.colId, at: (r, ch.c), origin: (rect.top + 1, ch.c), opts) { hidden.insert(rowId); break }
                }
            }
        }
        return Result(hidden: hidden, headerRow: rect.top, rect: rect)
    }

    /// Body row ids in sorted order (one key or several). Numbers before text, empty cells last in both
    /// directions, text compared the Indonesian way; ties keep their order.
    static func sortedRowIds(_ rowIds: [String], _ keys: [SortSpec], _ valueOf: (String, String) -> SheetCellValue) -> [String] {
        var idx: [(id: String, i: Int, key: [SheetCellValue])] = []
        for (i, id) in rowIds.enumerated() { idx.append((id: id, i: i, key: keys.map { valueOf(id, $0.colId) })) }
        let sorted = idx.sorted { (a: (id: String, i: Int, key: [SheetCellValue]), b: (id: String, i: Int, key: [SheetCellValue])) -> Bool in
            for k in 0..<keys.count {
                let d = compareValues(a.key[k], b.key[k], keys[k].dir)
                if d != 0 { return d < 0 }
            }
            return a.i < b.i
        }
        return sorted.map { $0.id }
    }

    /// The distinct shown values of a column for "Filter by values": "(Blanks)" (key "") first, then A→Z.
    static func distinctValues(_ rowIds: [String], _ colId: String, _ display: (String, String) -> String) -> [(text: String, count: Int)] {
        var counts: [String: Int] = [:]
        var order: [String] = []
        for id in rowIds {
            let t = display(id, colId)
            if counts[t] == nil { order.append(t) }
            counts[t, default: 0] += 1
        }
        let list = order.map { (text: $0, count: counts[$0] ?? 0) }
        return stableSorted(list) { a, b in
            if a.text == b.text { return 0 }
            if a.text.isEmpty { return -1 }
            if b.text.isEmpty { return 1 }
            return collatorCompare(a.text, b.text)
        }
    }

    /// The colours present in a column (for "Filter by colour" / "Sort by colour").
    static func colorsInColumn(_ rowIds: [String], _ colId: String, _ styleOf: (String, String) -> (bg: String?, fc: String?)?) -> (fills: [String], texts: [String]) {
        var fills: [String] = [], texts: [String] = []
        for id in rowIds {
            let st = styleOf(id, colId)
            if let bg = st?.bg?.lowercased(), !bg.isEmpty, !fills.contains(bg) { fills.append(bg) }
            if let fc = st?.fc?.lowercased(), !fc.isEmpty, !texts.contains(fc) { texts.append(fc) }
        }
        return (fills, texts)
    }

    /// Sort by colour: rows with the colour first, others keep their order.
    static func sortByColor(_ rowIds: [String], _ colId: String, _ color: String, kind: String, _ styleOf: (String, String) -> (bg: String?, fc: String?)?) -> [String] {
        func has(_ id: String) -> Bool { sameColor(kind == "fill" ? styleOf(id, colId)?.bg : styleOf(id, colId)?.fc, color) }
        return rowIds.filter(has) + rowIds.filter { !has($0) }
    }

    // MARK: - compareValues (lib/sheet-datatools.ts)

    /// Rank of a value in an ascending sort: numbers, then text, then booleans, then errors; empty last.
    private static func rank(_ v: SheetCellValue) -> Int {
        switch v {
        case .empty: return 9
        case .text(let s):
            if s.isEmpty { return 9 }
            return F.isError(v) ? 3 : 1
        case .number: return 0
        case .bool: return 2
        }
    }

    /// Compare two cell values for sorting. Empty cells always go last, whatever the direction.
    static func compareValues(_ a: SheetCellValue, _ b: SheetCellValue, _ dir: String = "asc") -> Int {
        let ra = rank(a), rb = rank(b)
        if ra == 9 || rb == 9 { return ra == rb ? 0 : (ra == 9 ? 1 : -1) }
        var d = 0
        if ra != rb {
            d = ra - rb
        } else if ra == 0 {
            let x = a.number ?? 0, y = b.number ?? 0
            d = x < y ? -1 : (x > y ? 1 : 0)
        } else if ra == 2 {
            let x = boolNum(a), y = boolNum(b)
            d = x - y
        } else {
            d = collatorCompare(textOf(a), textOf(b))
        }
        return dir == "desc" ? -d : d
    }

    private static func boolNum(_ v: SheetCellValue) -> Int { if case .bool(let b) = v { return b ? 1 : 0 }; return 0 }
    private static func textOf(_ v: SheetCellValue) -> String {
        switch v {
        case .empty: return ""
        case .text(let s): return s
        case .number(let n): return SheetJS.numberToString(n)
        case .bool(let b): return b ? "true" : "false"
        }
    }

    // MARK: - Intl.Collator("id", { numeric: true, sensitivity: "base" })

    /// Base-sensitivity, numeric collation: case and accents ignored, digit runs compared as numbers,
    /// punctuation < digits < letters (CLDR root order for the Latin text a sheet holds).
    static func collatorCompare(_ a: String, _ b: String) -> Int {
        let ta = collTokens(a), tb = collTokens(b)
        let n = min(ta.count, tb.count)
        for i in 0..<n {
            let x = ta[i], y = tb[i]
            switch (x, y) {
            case (.number(let p), .number(let q)):
                if p.count != q.count { return p.count < q.count ? -1 : 1 }
                if p != q { return p < q ? -1 : 1 }
            case (.char(let p), .char(let q)):
                if p != q { return p < q ? -1 : 1 }
            case (.number, .char(let q)):
                // A digit run against a character: digits sort with the digit weight.
                return digitWeight < q ? -1 : 1
            case (.char(let p), .number):
                return p < digitWeight ? -1 : 1
            }
        }
        return ta.count == tb.count ? 0 : (ta.count < tb.count ? -1 : 1)
    }

    private enum CollToken { case number(String), char(UInt32) }
    private static let digitWeight: UInt32 = 0x40000

    private static func collTokens(_ s: String) -> [CollToken] {
        let folded = s.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
        var out: [CollToken] = []
        var digits = ""
        func flush() {
            if !digits.isEmpty {
                var d = Substring(digits)
                while d.count > 1, d.first == "0" { d = d.dropFirst() }
                out.append(.number(String(d)))
                digits = ""
            }
        }
        for sc in folded.unicodeScalars {
            if sc.value >= 48 && sc.value <= 57 { digits.unicodeScalars.append(sc); continue }
            flush()
            guard let w = primaryWeight(sc) else { continue }
            out.append(.char(w))
        }
        flush()
        return out
    }

    private static func primaryWeight(_ s: UnicodeScalar) -> UInt32? {
        let v = s.value
        if v < 0x20 && !(0x09...0x0D).contains(v) { return nil }
        if v == 0x7F { return nil }
        if v == 0x20 || (0x09...0x0D).contains(v) || v == 0xA0 { return 0x100 + v }
        let props = s.properties
        if props.isAlphabetic || props.numericType != nil {
            if v >= 97 && v <= 122 { return 0x50000 + v }
            return 0x60000 + v
        }
        // Punctuation and symbols before digits and letters.
        return 0x20000 + v
    }

    /// Array#sort with a comparator: stable (insertion order on ties), as every JS engine is today.
    static func stableSorted<T>(_ list: [T], _ cmp: (T, T) -> Int) -> [T] {
        list.enumerated().sorted { a, b in
            let d = cmp(a.element, b.element)
            return d != 0 ? d < 0 : a.offset < b.offset
        }.map(\.element)
    }
}
