// Evaluation: SheetEngine (cache + dependency graph), comparisons, criteria, the core functions,
// engineFor / evaluateCell / computeSheet — port of the evaluation section of sheet-formula.ts.
import Foundation

/// One cell of `SheetFormula.computeSheet` (TS `ComputedCell`).
struct SheetComputedCell: Equatable {
    /// Computed value: number (dates are serials), string, boolean, or an error text like "#REF!".
    var v: SheetCellValue
    /// Text to show, formatted exactly like the web grid shows it.
    var d: String
    /// Display format when the value is a formatted number.
    var nf: SheetFormula.NumFmt?
    /// True on formula cells.
    var formula: Bool = false
    /// True when v is an error.
    var error: Bool = false
}

extension SheetFormula {
    typealias Matrix = [[SheetCellValue]]

    enum NumOrErr {
        case n(Double)
        case e(String)
    }
    enum BoolOrErr {
        case b(Bool)
        case e(String)
    }

    static let KEY_SEP = "\u{1}"
    static func keyOf(_ rowId: String, _ colId: String) -> String { rowId + KEY_SEP + colId }

    static func truthy(_ v: SheetCellValue) -> BoolOrErr {
        switch v {
        case .bool(let b): return .b(b)
        case .empty: return .b(false)
        case .number(let n): return .b(n != 0)
        case .text(let s):
            if ERROR_TEXTS.contains(s) { return .e(s) }
            if s.isEmpty { return .b(false) }
            let t = SheetJS.trim(s).uppercased()
            if t == "TRUE" { return .b(true) }
            if t == "FALSE" { return .b(false) }
            guard let n = numberFromText(s) else { return .e(ERR.value) }
            return .b(n != 0)
        }
    }

    /// A scalar as a number, for arithmetic: blank is 0, text must be clearly numeric.
    static func toNum(_ v: SheetCellValue) -> NumOrErr {
        switch v {
        case .empty: return .n(0)
        case .number(let n): return .n(n)
        case .bool(let b): return .n(b ? 1 : 0)
        case .text(let s):
            if s.isEmpty { return .n(0) }
            if ERROR_TEXTS.contains(s) { return .e(s) }
            guard let n = numberFromText(s) else { return .e(ERR.value) }
            return .n(n)
        }
    }

    static func toText(_ v: SheetCellValue) -> String {
        switch v {
        case .empty: return ""
        case .bool(let b): return b ? "TRUE" : "FALSE"
        case .number(let n): return SheetJS.numberToString(SheetJS.precision15(n))
        case .text(let s): return s
        }
    }

    private static func rank(_ v: SheetCellValue) -> Int {
        switch v {
        case .bool: return 2
        case .text(let s): return s.isEmpty ? 0 : 1
        default: return 0
        }
    }

    /// Excel ordering: numbers < text < booleans; text compares case-insensitively.
    static func compare(_ a: SheetCellValue, _ b: SheetCellValue) -> Int {
        var x = a, y = b
        if case .text(let s) = x, case .number = y, let n = numberFromText(s) { x = .number(n) }
        if case .text(let s) = y, case .number = x, let n = numberFromText(s) { y = .number(n) }
        if x == .empty {
            switch y {
            case .text: x = .text("")
            case .bool: x = .bool(false)
            default: x = .number(0)
            }
        }
        if y == .empty {
            switch x {
            case .text: y = .text("")
            case .bool: y = .bool(false)
            default: y = .number(0)
            }
        }
        let rx = rank(x), ry = rank(y)
        if rx != ry { return rx - ry }
        if case .number(let p) = x, case .number(let q) = y { return p == q ? 0 : (p < q ? -1 : 1) }
        if case .bool(let p) = x, case .bool(let q) = y { return (p ? 1 : 0) - (q ? 1 : 0) }
        return SheetJS.localeCompare(jsStringOf(x).lowercased(), jsStringOf(y).lowercased())
    }

    /// String(v) in JS terms.
    static func jsStringOf(_ v: SheetCellValue) -> String {
        switch v {
        case .empty: return "null"
        case .bool(let b): return b ? "true" : "false"
        case .number(let n): return SheetJS.numberToString(n)
        case .text(let s): return s
        }
    }

    static func wildcardRegex(_ pattern: String) -> NSRegularExpression? {
        let c = Array(pattern)
        var re = ""
        var i = 0
        while i < c.count {
            let ch = c[i]
            if ch == "~" && i + 1 < c.count { re += SheetJS.escapeRegex(String(c[i + 1])); i += 2; continue }
            if ch == "*" { re += ".*" } else if ch == "?" { re += "." } else { re += SheetJS.escapeRegex(String(ch)) }
            i += 1
        }
        return SheetJS.regex("^\(re)\\z", caseInsensitive: true)
    }

    /// Excel-style criteria: ">100", "<=5", "<>abc", "a*", a number, or a bare value meaning equals.
    static func matchesCriteria(_ value: SheetCellValue, _ criteria: SheetCellValue) -> Bool {
        if isError(value) { return false }
        switch criteria {
        case .number, .bool:
            if value.isEmptyOrBlank { return false }
            return compare(value, criteria) == 0
        default: break
        }
        let crit = criteria.text ?? ""
        var op = ""
        for o in [">=", "<=", "<>", ">", "<", "="] where crit.hasPrefix(o) { op = o; break }
        let target = String(crit.dropFirst(op.count))
        let blank = value.isEmptyOrBlank
        if target.isEmpty {
            if op == "<>" { return !blank }
            return blank
        }
        if blank { return op == "<>" }
        let tNum = numberFromText(target)
        var vNum: Double? = nil
        if case .number(let n) = value { vNum = n } else if case .text(let s) = value { vNum = numberFromText(s) }
        if let t = tNum, let v = vNum {
            switch op {
            case ">": return v > t
            case "<": return v < t
            case ">=": return v >= t
            case "<=": return v <= t
            case "<>": return v != t
            default: return v == t
            }
        }
        let sv = toText(value)
        if op == "" || op == "=" || op == "<>" {
            var hit: Bool
            if target.contains("*") || target.contains("?") {
                hit = wildcardRegex(target).map { SheetJS.test($0, sv) } ?? false
            } else {
                hit = sv.lowercased() == target.lowercased()
            }
            return op == "<>" ? !hit : hit
        }
        let cmp = SheetJS.localeCompare(sv.lowercased(), target.lowercased())
        switch op {
        case ">": return cmp > 0
        case "<": return cmp < 0
        case ">=": return cmp >= 0
        default: return cmp <= 0
        }
    }

    /// Functions whose result is a date (so it displays as one).
    static let DATE_RESULT: Set<String> = ["TODAY", "NOW", "DATE", "DATEVALUE", "EOMONTH", "EDATE", "WORKDAY", "WORKDAY.INTL"]
    /// Functions whose result has the format of their first argument.
    static let FORMAT_OF_FIRST: Set<String> = ["SUM", "MIN", "MAX", "AVERAGE", "AVG", "MEDIAN", "ROUND", "ROUNDUP", "ROUNDDOWN", "ABS",
        "INT", "CEILING", "FLOOR", "MROUND", "TRUNC", "LARGE", "SMALL", "MODE", "AVERAGEIF", "AVERAGEIFS", "MAXIFS", "MINIFS", "SUMIFS"]

    // MARK: - Engine registry

    /// The engine for this SheetData box (one per render; see SheetEngine.derive). Swift structs have
    /// no identity, so a render wraps its SheetData in a `SheetDataBox` (TS keys a WeakMap by object).
    static func engineFor(_ box: SheetDataBox, _ previous: SheetEngine? = nil) -> SheetEngine {
        if let e = box.engine { return e }
        let e = previous.map { $0.derive(box.data) } ?? SheetEngine(box.data)
        box.engine = e
        return e
    }

    /// An engine for `data` without a per-render cache: derived from `previous` when given.
    static func engineFor(_ data: SheetData, _ previous: SheetEngine? = nil) -> SheetEngine {
        previous.map { $0.derive(data) } ?? SheetEngine(data)
    }

    /// Evaluate one cell (shares the box's cache).
    static func evaluateCell(_ box: SheetDataBox, _ rowId: String, _ colId: String) -> SheetCellValue {
        engineFor(box).value(rowId, colId)
    }

    // MARK: - computeSheet

    /// Every non-empty cell's computed value and display text (GET /api/sheets/:id?computed=1).
    /// `rows[i].styles` maps colId -> {nf?, dp?, pt?}.
    static func computeSheet(
        _ columns: [(id: String, type: String)],
        _ rows: [(id: String, cells: [String: Any], styles: [String: [String: Any]]?)],
        locale: DisplayLocale? = nil,
        names: [(name: String, range: String)]? = nil
    ) -> [String: [String: SheetComputedCell]] {
        let before = displayLocale
        if let l = locale { setDisplayLocale(l) }
        defer { displayLocale = before }
        return computeCells(columns, rows, names)
    }

    private static func styleNum(_ v: Any?) -> Int? {
        if case .number(let n) = kind(v), n.isFinite { return Int(n) }
        return nil
    }
    private static func styleStr(_ v: Any?) -> String? {
        if case .string(let s) = kind(v) { return s }
        return nil
    }

    private static func computeCells(
        _ columns: [(id: String, type: String)],
        _ rows: [(id: String, cells: [String: Any], styles: [String: [String: Any]]?)],
        _ names: [(name: String, range: String)]?
    ) -> [String: [String: SheetComputedCell]] {
        let data = SheetData(columns: columns, rows: rows.map { ($0.id, $0.cells) }, names: names)
        let engine = SheetEngine(data)
        var out: [String: [String: SheetComputedCell]] = [:]
        for row in rows {
            var line: [String: SheetComputedCell] = [:]
            for col in columns {
                let raw = row.cells[col.id]
                switch kind(raw) {
                case .null: continue
                case .string(let s) where s.isEmpty: continue
                default: break
                }
                let v = engine.value(row.id, col.id)
                let formula = isFormulaCell(raw)
                let nf: NumFmt? = formula ? engine.format(row.id, col.id) : typedCell(raw)?.nf
                var styled: String? = nil
                if let st = row.styles?[col.id] {
                    let fallback: NumFmt? = nf ?? (col.type == "currency" ? .idr : col.type == "date" ? .date : nil)
                    styled = formatWithStyle(v, styleStr(st["nf"]), styleNum(st["dp"]), fallback, styleStr(st["pt"]))
                }
                let d = styled ?? (formula ? formatResult(col.type, v, nf) : formatScalar(col.type, raw))
                var cell = SheetComputedCell(v: v, d: d, nf: nil)
                if let f = nf, case .number = v {
                    cell.nf = f
                } else if !formula, case .number = v, col.type == "date" || col.type == "currency" {
                    cell.nf = col.type == "date" ? .date : .idr
                }
                cell.formula = formula
                cell.error = isError(v)
                line[col.id] = cell
            }
            if !line.isEmpty { out[row.id] = line }
        }
        return out
    }

    // MARK: - Autocomplete list

    struct FunctionInfo: Equatable {
        var name: String
        var args: String
        var desc: String
        var descEn: String
    }
}

/// A SheetData with identity, so one engine can be cached per render (TS WeakMap<SheetData, …>).
final class SheetDataBox {
    let data: SheetData
    fileprivate(set) var engine: SheetEngine?
    init(_ data: SheetData) { self.data = data }
}

/// Evaluates one sheet; caches every value and records reads as a dependency graph.
final class SheetEngine {
    typealias F = SheetFormula
    let data: SheetData
    let colIndex: [String: Int]
    let rowIndex: [String: Int]
    var values: [String: SheetCellValue] = [:]
    var formats: [String: SheetFormula.NumFmt?] = [:]
    /// cell key -> formula cells that read it
    var dependents: [String: Set<String>] = [:]
    var stack: [String] = []
    var stackRows: [String] = []
    var inCycle = Set<String>()
    var fmtVisiting = Set<String>()
    var volatile = Set<String>()

    /// Deepest chain of nested cell evaluations on the native stack. A longer chain is not an
    /// error: the cell met at this depth is "deferred", nothing on the way is cached, that cell is
    /// evaluated first from the top level and the read is retried (so a 10 000-row running total
    /// works on a 512 KB thread stack, like the web). Only a chain that loops back into cells still
    /// being resolved more than a million times falls back to #VALUE!.
    static var maxDepth = 120
    private var deferredKey: (row: String, col: String)?
    private var hardLimit = false
    private var deferredPath: [String] = []
    /// Native stacks of top-level passes still waiting on a deferred cell (see resolveTop).
    private var outerStack: [String] = []
    private var fmtDeferred: (row: String, col: String)?

    init(_ data: SheetData) {
        self.data = data
        colIndex = SheetFormula.indexMap(data.shape.columnIds)
        rowIndex = SheetFormula.indexMap(data.shape.rowIds)
    }

    private static func sameDict(_ a: [String: String]?, _ b: [String: String]?) -> Bool {
        if a == nil && b == nil { return true }
        guard let a = a, let b = b else { return false }
        return a == b
    }

    /// A new engine for `next`, reusing every cached value that cannot have changed. `changedRows`
    /// (optional) limits the diff to those rows.
    func derive(_ next: SheetData, changedRows: Set<String>? = nil) -> SheetEngine {
        let fresh = SheetEngine(next)
        let a = data.shape, b = next.shape
        let same = a == b && SheetEngine.sameDict(data.types, next.types) && SheetEngine.sameDict(data.names, next.names)
        if !same { return fresh }
        var changed: [String] = []
        for rowId in b.rowIds {
            if let only = changedRows, !only.contains(rowId) { continue }
            let before = data.cells[rowId] ?? [:]
            let after = next.cells[rowId] ?? [:]
            var keys = Set(before.keys)
            keys.formUnion(after.keys)
            for k in keys where !SheetJSONValue.equal(before[k], after[k]) {
                changed.append(SheetFormula.keyOf(rowId, k))
            }
        }
        var stale = Set<String>()
        var queue = changed
        while let k = queue.popLast() {
            if stale.contains(k) { continue }
            stale.insert(k)
            if let ds = dependents[k] { queue.append(contentsOf: ds) }
        }
        for (k, v) in values where !stale.contains(k) && !volatile.contains(k) { fresh.values[k] = v }
        for (k, v) in formats where !stale.contains(k) { fresh.formats[k] = v }
        for (k, deps) in dependents where !stale.contains(k) {
            let kept = deps.filter { !stale.contains($0) }
            if !kept.isEmpty { fresh.dependents[k] = kept }
        }
        return fresh
    }

    /// Raw stored value -> engine scalar.
    func scalar(_ raw: Any?, _ colId: String) -> SheetCellValue {
        let k = F.kind(raw)
        switch k {
        case .null: return .empty
        case .array(let a): return .text(F.joinList(a))
        default: break
        }
        if let t = F.typedCell(raw) { return .number(t.v) }
        if let l = F.linkOf(raw) { return .text((l.t?.isEmpty == false) ? l.t! : l.u) }
        switch k {
        case .string(let s):
            if data.types?[colId] == "date" {
                if let ser = F.isoToSerial(s) ?? F.parseDateText(s) { return .number(ser) }
            }
            return .text(s)
        case .number(let n): return .number(n)
        case .bool(let b): return .bool(b)
        default: return .empty
        }
    }

    private func raw(_ rowId: String, _ colId: String) -> Any? { data.cells[rowId]?[colId] }

    /// The value of one cell (a formula's result, or the stored value).
    func value(_ rowId: String, _ colId: String) -> SheetCellValue {
        let r = raw(rowId, colId)
        guard F.isFormulaCell(r) else { return scalar(r, colId) }
        return stack.isEmpty ? resolveTop(rowId, colId) : valueCore(rowId, colId)
    }

    /// A top-level read: evaluate, and when the chain was too deep, resolve the deferred cell first.
    /// The native stack of the deferred pass stays on `outerStack`, so a dependency cycle that runs
    /// through several passes is still seen as one stack — exactly the JS engine's #CIRCULAR!.
    private func resolveTop(_ rowId: String, _ colId: String) -> SheetCellValue {
        var work: [(row: String, col: String, frame: Int)] = [(rowId, colId, 0)]
        var result: SheetCellValue = .empty
        var steps = 0
        while let top = work.last {
            deferredKey = nil
            result = valueCore(top.row, top.col)
            steps += 1
            if let d = deferredKey, !hardLimit {
                if steps < 1_000_000 {
                    outerStack.append(contentsOf: deferredPath)
                    work.append((d.row, d.col, deferredPath.count))
                    continue
                }
                hardLimit = true
                result = valueCore(top.row, top.col)
                hardLimit = false
            }
            deferredKey = nil
            work.removeLast()
            outerStack.removeLast(min(top.frame, outerStack.count))
        }
        return result
    }

    private func valueCore(_ rowId: String, _ colId: String) -> SheetCellValue {
        let r = raw(rowId, colId)
        guard let f = F.formulaOf(r) else { return scalar(r, colId) }
        let key = F.keyOf(rowId, colId)
        if let cached = values[key] { return cached }
        if let at = stack.firstIndex(of: key) {
            for i in at..<stack.count { inCycle.insert(stack[i]) }
            return .text(F.ERR.cycle)
        }
        if !outerStack.isEmpty, let at = outerStack.firstIndex(of: key) {
            for i in at..<outerStack.count { inCycle.insert(outerStack[i]) }
            for k in stack { inCycle.insert(k) }
            return .text(F.ERR.cycle)
        }
        if stack.count >= SheetEngine.maxDepth {
            if !hardLimit && deferredKey == nil { deferredKey = (rowId, colId); deferredPath = stack }
            return .text(F.ERR.value)
        }
        stack.append(key)
        stackRows.append(rowId)
        var v: SheetCellValue
        switch F.compile(F.resolveNames(f, data.names)) {
        case .error(let e): v = .text(e)
        case .node(let ast): v = evalScalar(ast)
        }
        if case .number(let n) = v, !n.isFinite { v = .text(F.ERR.num) }
        stack.removeLast()
        stackRows.removeLast()
        if inCycle.contains(key) { v = .text(F.ERR.cycle) }
        // A pass that hit the depth limit computed placeholders: keep nothing from it.
        if deferredKey == nil || hardLimit { values[key] = v }
        return v
    }

    /// The display format of a cell's value.
    func format(_ rowId: String, _ colId: String) -> SheetFormula.NumFmt? {
        let r = raw(rowId, colId)
        if let t = F.typedCell(r) { return t.nf }
        guard F.isFormulaCell(r) else {
            let type = data.types?[colId]
            if type == "currency" { return .idr }
            if type == "date" { return .date }
            if case .string(let s) = F.kind(r), F.isoToSerial(s) != nil { return .date }
            return nil
        }
        if fmtVisiting.isEmpty { return formatTop(rowId, colId) }
        return formatCore(rowId, colId)
    }

    private func formatTop(_ rowId: String, _ colId: String) -> SheetFormula.NumFmt? {
        var work: [(row: String, col: String)] = [(rowId, colId)]
        var pending = Set([F.keyOf(rowId, colId)])
        var result: SheetFormula.NumFmt? = nil
        while let top = work.last {
            fmtDeferred = nil
            result = formatCore(top.row, top.col)
            if let d = fmtDeferred {
                let dk = F.keyOf(d.row, d.col)
                fmtDeferred = nil
                if !pending.contains(dk) {
                    pending.insert(dk)
                    work.append(d)
                    continue
                }
            }
            work.removeLast()
            pending.remove(F.keyOf(top.row, top.col))
        }
        return result
    }

    private func formatCore(_ rowId: String, _ colId: String) -> SheetFormula.NumFmt? {
        let r = raw(rowId, colId)
        if let t = F.typedCell(r) { return t.nf }
        guard let f = F.formulaOf(r) else { return format(rowId, colId) }
        let key = F.keyOf(rowId, colId)
        if let hit = formats[key] { return hit }
        if fmtVisiting.contains(key) { return nil }
        if fmtVisiting.count >= SheetEngine.maxDepth {
            if fmtDeferred == nil { fmtDeferred = (rowId, colId) }
            return nil
        }
        fmtVisiting.insert(key)
        var nf: SheetFormula.NumFmt? = nil
        if case .node(let ast) = F.compile(F.resolveNames(f, data.names)) { nf = formatOf(ast) }
        fmtVisiting.remove(key)
        if fmtDeferred == nil { formats[key] = .some(nf) }
        return nf
    }

    /// Evaluate a stored formula that lives in no cell, as if in row `rowId`.
    func evaluateFormula(_ stored: String, _ rowId: String? = nil) -> SheetCellValue {
        let src = stored.hasPrefix("=") ? stored : "=\(stored)"
        let compiled = F.compile(F.resolveNames(src, data.names))
        if case .error(let e) = compiled { return .text(e) }
        guard case .node(let ast) = compiled else { return .text(F.ERR.value) }
        stackRows.append(rowId ?? "")
        defer { stackRows.removeLast() }
        let v = evalScalar(ast)
        if case .number(let n) = v, !n.isFinite { return .text(F.ERR.num) }
        return v
    }

    // MARK: internals

    func read(_ rowId: String, _ colId: String) -> SheetCellValue {
        if let top = stack.last {
            dependents[F.keyOf(rowId, colId), default: []].insert(top)
        }
        return stack.isEmpty ? value(rowId, colId) : valueCore(rowId, colId)
    }

    /// Row ids and column ids a range covers, in display order; nil when a corner is gone.
    func rangeIds(_ node: SheetFormula.RangeNode) -> (rows: ArraySlice<String>, cols: ArraySlice<String>)? {
        guard let c1 = colIndex[node.c1], let c2 = colIndex[node.c2] else { return nil }
        let cols = data.shape.columnIds[min(c1, c2)...max(c1, c2)]
        guard let r1n = node.r1, let r2n = node.r2 else { return (data.shape.rowIds[...], cols) }
        guard let r1 = rowIndex[r1n], let r2 = rowIndex[r2n] else { return nil }
        return (data.shape.rowIds[min(r1, r2)...max(r1, r2)], cols)
    }

    enum MatOrErr {
        case m(SheetFormula.Matrix)
        case e(String)
    }
    enum ListOrErr {
        case l([SheetCellValue])
        case e(String)
    }

    func matrix(_ node: SheetFormula.Node) -> MatOrErr {
        if case .range(let rn) = node {
            guard let ids = rangeIds(rn) else { return .e(F.ERR.ref) }
            return .m(ids.rows.map { r in ids.cols.map { c in read(r, c) } })
        }
        return .m([[evalScalar(node)]])
    }

    /// Every value an argument contributes (ranges flattened row by row).
    func flat(_ node: SheetFormula.Node) -> ListOrErr {
        switch matrix(node) {
        case .e(let e): return .e(e)
        case .m(let m): return .l(m.flatMap { $0 })
        }
    }

    func evalScalar(_ node: SheetFormula.Node) -> SheetCellValue {
        switch node {
        case .num(let v): return .number(v)
        case .str(let v): return .text(v)
        case .bool(let v): return .bool(v)
        case .err(let v): return .text(v)
        case .ref(let col, let row):
            guard colIndex[col] != nil, rowIndex[row] != nil else { return .text(F.ERR.ref) }
            return read(row, col)
        case .range(let rn):
            guard let ids = rangeIds(rn) else { return .text(F.ERR.ref) }
            let here = stackRows.last ?? ""
            if ids.cols.count == 1, !here.isEmpty, ids.rows.contains(here) { return read(here, ids.cols.first!) }
            if let r0 = ids.rows.first, let c0 = ids.cols.first { return read(r0, c0) }
            return .empty
        case .neg(let e):
            switch F.toNum(evalScalar(e)) {
            case .e(let err): return .text(err)
            case .n(let n): return .number(-n)
            }
        case .pct(let e):
            switch F.toNum(evalScalar(e)) {
            case .e(let err): return .text(err)
            case .n(let n): return .number(n / 100)
            }
        case .bin(let op, let l, let r):
            return evalBinary(op, l, r)
        case .call(let fn, let args):
            return call(fn, args)
        }
    }

    private func evalBinary(_ op: String, _ ln: SheetFormula.Node, _ rn: SheetFormula.Node) -> SheetCellValue {
        let l = evalScalar(ln)
        if F.isError(l) { return l }
        let r = evalScalar(rn)
        if F.isError(r) { return r }
        if op == "&" { return .text(F.toText(l) + F.toText(r)) }
        if F.PREC[op] == 1 {
            let c = F.compare(l, r)
            switch op {
            case ">": return .bool(c > 0)
            case "<": return .bool(c < 0)
            case ">=": return .bool(c >= 0)
            case "<=": return .bool(c <= 0)
            case "=": return .bool(c == 0)
            default: return .bool(c != 0)
            }
        }
        guard case .n(let a) = F.toNum(l) else { if case .e(let e) = F.toNum(l) { return .text(e) }; return .empty }
        guard case .n(let b) = F.toNum(r) else { if case .e(let e) = F.toNum(r) { return .text(e) }; return .empty }
        switch op {
        case "+": return .number(a + b)
        case "-": return .number(a - b)
        case "*": return .number(a * b)
        case "/": return b == 0 ? .text(F.ERR.div) : .number(a / b)
        case "^":
            let p = SheetJS.pow(a, b)
            return p.isFinite ? .number(p) : .text(F.ERR.num)
        default: return .text(F.ERR.value)
        }
    }

    enum NumsOrErr {
        case n([Double])
        case e(String)
    }

    /// Numbers for SUM-like functions: ranges skip blanks/text/booleans, direct arguments must be numeric.
    func numbers(_ args: [SheetFormula.Node]) -> NumsOrErr {
        var out: [Double] = []
        for arg in args {
            if arg.isRange {
                switch flat(arg) {
                case .e(let e): return .e(e)
                case .l(let vals):
                    for v in vals {
                        if F.isError(v) { return .e(v.text!) }
                        if case .number(let n) = v { out.append(n) } else if case .text(let s) = v, !s.isEmpty, let n = F.numberFromText(s) { out.append(n) }
                    }
                }
                continue
            }
            let v = evalScalar(arg)
            if F.isError(v) { return .e(v.text!) }
            if v.isEmptyOrBlank { continue }
            switch F.toNum(v) {
            case .e(let e): return .e(e)
            case .n(let n): out.append(n)
            }
        }
        return .n(out)
    }

    /// Conditional aggregate core shared by *IF and *IFS.
    func matchingIndices(_ pairs: [(range: SheetFormula.Node, crit: SheetFormula.Node)]) -> (idx: [Int], length: Int, err: String?) {
        var length = -1
        var keep: [Bool] = []
        for p in pairs {
            let vals: [SheetCellValue]
            switch flat(p.range) {
            case .e(let e): return ([], 0, e)
            case .l(let l): vals = l
            }
            let c = evalScalar(p.crit)
            if F.isError(c) { return ([], 0, c.text!) }
            if length < 0 { length = vals.count; keep = Array(repeating: true, count: length) }
            for i in 0..<length where keep[i] {
                let v = i < vals.count ? vals[i] : .empty
                if !F.matchesCriteria(v, c) { keep[i] = false }
            }
        }
        var idx: [Int] = []
        for (i, k) in keep.enumerated() where k { idx.append(i) }
        return (idx, max(0, length), nil)
    }

    func markVolatile() {
        if let top = stack.last { volatile.insert(top) }
    }

    func aggregateAt(_ kind: String, _ target: [SheetCellValue], _ idx: [Int]) -> SheetCellValue {
        var picked: [Double] = []
        for i in idx {
            let v: SheetCellValue = i < target.count ? target[i] : .empty
            if F.isError(v) { return v }
            if case .number(let n) = v { picked.append(n) } else if case .text(let s) = v, let n = F.numberFromText(s) { picked.append(n) }
        }
        if kind == "sum" { return .number(picked.reduce(0, +)) }
        if kind == "avg" { return picked.isEmpty ? .text(F.ERR.div) : .number(picked.reduce(0, +) / Double(picked.count)) }
        if picked.isEmpty { return .number(0) }
        return .number(kind == "max" ? SheetJS.jsMax(picked) : SheetJS.jsMin(picked))
    }

    // MARK: format inference

    func formatOf(_ node: SheetFormula.Node) -> SheetFormula.NumFmt? {
        switch node {
        case .ref(let col, let row):
            return colIndex[col] != nil && rowIndex[row] != nil ? format(row, col) : nil
        case .range(let rn): return rangeFormat(rn)
        case .neg(let e): return formatOf(e)
        case .pct: return .pct
        case .bin(let op, let ln, let rn):
            let l = formatOf(ln), r = formatOf(rn)
            if op == "+" || op == "-" {
                if l == .date && r == .date { return op == "-" ? nil : .date }
                if l == .date || r == .date { return .date }
                return l ?? r
            }
            if op == "*" { return [l, r].compactMap { $0 }.first { $0 != .pct && $0 != .date } }
            if op == "/" {
                if let l = l, l != .pct, l != .date, r != l { return l }
                return nil
            }
            return nil
        case .call(let fn, let args):
            return callFormat(fn, args)
        default: return nil
        }
    }

    private func callFormat(_ fn: String, _ args: [SheetFormula.Node]) -> SheetFormula.NumFmt? {
        if F.DATE_RESULT.contains(fn) { return .date }
        if fn == "IF" {
            if args.count > 1, let f = formatOf(args[1]) { return f }
            if args.count > 2, let f = formatOf(args[2]) { return f }
            return nil
        }
        if fn == "IFERROR" || fn == "IFNA" { return args.first.flatMap { formatOf($0) } }
        if fn == "SUMIF" {
            if args.count > 2 { return formatOf(args[2]) }
            return args.first.flatMap { formatOf($0) }
        }
        if fn == "XLOOKUP" { return args.count > 2 ? formatOf(args[2]) : nil }
        if fn == "INDEX" { return args.first.flatMap { formatOf($0) } }
        if fn == "VLOOKUP" { return nil }
        if F.FORMAT_OF_FIRST.contains(fn) {
            for a in args {
                if let f = formatOf(a) { return f == .pct && fn.hasPrefix("SUM") ? .pct : f }
            }
        }
        return nil
    }

    func rangeFormat(_ node: SheetFormula.RangeNode) -> SheetFormula.NumFmt? {
        guard let ids = rangeIds(node) else { return nil }
        if ids.cols.count == 1 {
            let type = data.types?[ids.cols.first!]
            if type == "currency" { return .idr }
            if type == "date" { return .date }
        }
        var seen = 0
        for r in ids.rows {
            for c in ids.cols {
                let rv = raw(r, c)
                if case .null = F.kind(rv) { continue }
                if let t = F.typedCell(rv) { return t.nf }
                if F.isFormulaCell(rv), let f = format(r, c) { return f }
                seen += 1
                if seen > 200 { return nil }
            }
        }
        return nil
    }
}

/// Structural equality of Foundation JSON values (TS: === for scalars, JSON.stringify for objects).
enum SheetJSONValue {
    static func equal(_ a: Any?, _ b: Any?) -> Bool {
        let ka = SheetFormula.kind(a), kb = SheetFormula.kind(b)
        switch (ka, kb) {
        case (.null, .null): return (a == nil) == (b == nil)
        case (.bool(let x), .bool(let y)): return x == y
        case (.number(let x), .number(let y)): return x == y
        case (.string(let x), .string(let y)): return x == y
        case (.array(let x), .array(let y)):
            return x.count == y.count && zip(x, y).allSatisfy { equal($0, $1) }
        case (.object(let x), .object(let y)):
            return x.count == y.count && x.allSatisfy { k, v in y[k] != nil && equal(v, y[k]) }
        default: return false
        }
    }
}
