// Second web-engine corpus (corpus2.json): a whole 12×8 grid of chained / relative / whole-column
// formulas with cell styles through computeSheet (both locales), the sheet-types helpers
// (inputToCell, editValue, displayCell, readMulti, sameCell, sortKey, TSV, fillValues, matchRule),
// validateCell and CF matchCondition.
import Foundation

private func load2() -> [String: Any]? {
    let u = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("corpus2.json")
    for url in [u, URL(fileURLWithPath: "Tests/SheetFormula/corpus2.json")] {
        if let d = try? Data(contentsOf: url), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { return j }
    }
    return nil
}

private func nn(_ v: Any?) -> Any? { v is NSNull ? nil : v }

private func cv(_ v: Any?) -> SheetCellValue {
    switch SheetFormula.kind(v) {
    case .number(let n): return .number(n)
    case .string(let s): return s == "-0" ? .number(-0.0) : .text(s)
    case .bool(let b): return .bool(b)
    case .array(let a): return .text(SheetFormula.joinList(a))
    default: return .empty
    }
}

private func same(_ a: SheetCellValue, _ b: SheetCellValue) -> Bool {
    if case .number(let x) = a, case .number(let y) = b {
        if x == 0 && y == 0 { return x.sign == y.sign }
        return x == y || abs(x - y) <= 1e-12 * max(abs(x), abs(y))
    }
    return a == b
}

private func show(_ v: Any?) -> String {
    guard let v = nn(v) else { return "null" }
    if let d = try? JSONSerialization.data(withJSONObject: [v]), let s = String(data: d, encoding: .utf8) { return s }
    return "\(v)"
}

func runCorpus2Tests() {
    typealias F = SheetFormula
    typealias T = SheetTypes
    guard let c = load2() else { fail("corpus2.json not found"); return }

    // Whole grid.
    let columns: [(id: String, type: String)] = [("a", "text"), ("b", "number"), ("c", "currency"), ("d", "date"), ("g", "text"), ("h", "number"), ("i", "date"), ("j", "checkbox")]
    let gridRows = ((c["grid"] as? [String: Any])?["rows"] as? [[String: Any]]) ?? []
    let rows: [(id: String, cells: [String: Any], styles: [String: [String: Any]]?)] = gridRows.map {
        ($0["id"] as! String, $0["cells"] as? [String: Any] ?? [:], $0["styles"] as? [String: [String: Any]])
    }
    for (loc, view) in (c["gridOut"] as? [String: [String: [String: [String: Any]]]]) ?? [:] {
        let res = F.computeSheet(columns, rows, locale: F.DisplayLocale(rawValue: loc)!)
        for (rid, line) in view {
            for (cid, cell) in line {
                let got = res[rid]?[cid]
                let tag = "grid \(rid).\(cid) [\(loc)]"
                checks += 1
                if got == nil || !same(got!.v, cv(cell["v"])) { fail("\(tag) v — got \(String(describing: got?.v)), want \(show(cell["v"]))") }
                eq(got?.d, cell["d"] as? String, "\(tag) d")
                eq(got?.nf?.rawValue, cell["nf"] as? String, "\(tag) nf")
                eq(got?.formula ?? false, (cell["formula"] as? Bool) ?? false, "\(tag) formula")
                eq(got?.error ?? false, (cell["error"] as? Bool) ?? false, "\(tag) error")
            }
            eq(res[rid]?.count ?? 0, line.count, "grid \(rid) cell count [\(loc)]")
        }
        eq(res.count, view.count, "grid row count [\(loc)]")
    }

    // sheet-types.
    let typeShape = SheetShape(columnIds: ["x", "y"], rowIds: ["r1", "r2"])
    for item in c["inputToCell"] as? [[String: Any]] ?? [] {
        F.setDisplayLocale(item["loc"] as! String)
        let type = item["type"] as! String, s = item["s"] as! String
        let prev: Any? = type == "link" ? (["t": "old", "u": "http://u"] as [String: Any]) : nil
        let got = T.inputToCell(SheetColumn(id: "x", name: "X", type: type), s, typeShape, prev)
        checks += 1
        if !SheetJSONValue.equal(got, nn(item["r"])) { fail("inputToCell \(type) \(show(s)) [\(item["loc"]!)] — got \(show(got)), want \(show(item["r"]))") }
    }
    F.setDisplayLocale(.idID)
    for item in c["editValue"] as? [[String: Any]] ?? [] {
        let type = item["type"] as! String, v = nn(item["v"])
        eq(T.editValue(type, v), item["r"] as! String, "editValue \(type) \(show(v))")
        eq(T.formatCell(type, v), item["cell"] as! String, "formatCell \(type) \(show(v))")
        eq(T.displayCell(type, v, nil), item["display"] as! String, "displayCell \(type) \(show(v))")
    }
    for item in c["readMulti"] as? [[String: Any]] ?? [] {
        eq(T.readMulti(nn(item["v"])), item["r"] as! [String], "readMulti \(show(item["v"]))")
    }
    for item in c["sameCell"] as? [[String: Any]] ?? [] {
        eq(T.sameCell(nn(item["a"]), nn(item["b"])), item["r"] as! Bool, "sameCell \(show(item["a"])) \(show(item["b"]))")
    }
    for item in c["sortKey"] as? [[String: Any]] ?? [] {
        let got = T.sortKey(cv(item["v"]))
        var want: T.SortKey? = nil
        if let o = item["r"] as? [String: Any] {
            if let n = o["n"] as? Double { want = .n(n) } else if let s = o["s"] as? String { want = .s(s) }
        }
        eq(got, want, "sortKey \(show(item["v"]))")
    }
    for item in c["tsv"] as? [[String: Any]] ?? [] {
        let s = item["s"] as! String
        eq(T.parseTsv(s), item["rows"] as! [[String]], "parseTsv \(show(s))")
        eq(T.toTsv(T.parseTsv(s)), item["back"] as! String, "toTsv(parseTsv) \(show(s))")
    }
    for item in c["toTsv"] as? [[String: Any]] ?? [] {
        eq(T.toTsv(item["rows"] as! [[String]]), item["r"] as! String, "toTsv")
    }
    for item in c["fill"] as? [[String: Any]] ?? [] {
        let src = (item["s"] as! [Any]).map { nn($0) }
        let got = T.fillValues(src, 4)
        let want = (item["r"] as! [Any]).map { nn($0) }
        checks += 1
        let okAll = got.count == want.count && zip(got, want).allSatisfy { SheetJSONValue.equal($0, $1) }
        if !okAll { fail("fillValues \(show(item["s"])) — got \(show(got.map { $0 ?? NSNull() })), want \(show(item["r"]))") }
    }
    let rules = [
        T.Rule(op: "gt", value: "1.000", style: "red"), T.Rule(op: "contains", value: "batal", style: "grey"),
        T.Rule(op: "empty", style: "amber"), T.Rule(op: "eq", value: "Selesai", style: "green"), T.Rule(op: "lt", value: "m", style: "blue"),
    ]
    for item in c["matchRule"] as? [[String: Any]] ?? [] {
        eq(T.matchRule(rules, cv(item["v"]))?.style, item["r"] as? String, "matchRule \(show(item["v"]))")
    }

    // Validation.
    let vshape = SheetShape(columnIds: ["ca", "cb"], rowIds: ["r1", "r2"])
    for item in c["validate"] as? [[String: Any]] ?? [] {
        let kind = SheetValidation.ValidationKind(rawValue: item["kind"] as! String)!
        let rule = SheetValidation.ValidationRule(id: "x", ranges: [], kind: kind, values: item["values"] as? [String])
        let raw = nn(item["v"])
        let got = SheetValidation.validateCell(rule, raw, cv(raw), engine: nil, shape: vshape, at: (0, 0))
        eq(got, item["r"] as! Bool, "validateCell \(kind) \(show(item["values"])) \(show(raw))")
    }
    // CF conditions.
    let today = F.ymdToSerial(2026, 10, 12)
    for item in c["cond"] as? [[String: Any]] ?? [] {
        let kind = item["kind"] as! String
        let ctx = SheetCF.CondCtx(engine: nil, shape: vshape, at: (0, 0), origin: (0, 0), today: today)
        let got = SheetCF.matchCondition(kind, item["values"] as? [String], cv(item["v"]), ctx)
        eq(got, item["r"] as! Bool, "matchCondition \(kind) \(show(item["values"])) \(show(item["v"]))")
    }
}
