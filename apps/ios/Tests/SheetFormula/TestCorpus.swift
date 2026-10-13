// Compares the Swift engine with outputs the web engine (sheet-formula.ts, dev branch) produced for
// corpus.json: ~440 formulas × 2 display locales through computeSheet, typed-input detection, number
// formats, custom patterns, scalar display, A1/stored translation and date serials.
import Foundation

private func loadCorpus() -> [String: Any]? {
    var candidates = [URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("corpus.json")]
    if CommandLine.arguments.count > 1 { candidates.insert(URL(fileURLWithPath: CommandLine.arguments[1]), at: 0) }
    candidates.append(URL(fileURLWithPath: "Tests/SheetFormula/corpus.json"))
    for u in candidates {
        if let d = try? Data(contentsOf: u), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { return j }
    }
    return nil
}

/// JSON expected value -> SheetCellValue ("-0" marks negative zero).
private func expected(_ v: Any?) -> SheetCellValue {
    switch SheetFormula.kind(v) {
    case .null: return .empty
    case .bool(let b): return .bool(b)
    case .number(let n): return .number(n)
    case .string(let s): return s == "-0" ? .number(-0.0) : .text(s)
    default: return .empty
    }
}

private func sameValue(_ a: SheetCellValue, _ b: SheetCellValue) -> Bool {
    if case .number(let x) = a, case .number(let y) = b {
        if x == 0 && y == 0 { return x.sign == y.sign }
        if x == y { return true }
        return abs(x - y) <= 1e-12 * max(abs(x), abs(y))
    }
    return a == b
}

private func jsonText(_ v: Any?) -> String {
    guard let v = v else { return "nil" }
    if let d = try? JSONSerialization.data(withJSONObject: [v], options: []), let s = String(data: d, encoding: .utf8) { return s }
    return "\(v)"
}

let corpusColumns: [(id: String, type: String)] = [
    ("a", "text"), ("b", "number"), ("c", "currency"), ("d", "date"), ("e", "text"), ("f", "text"), ("g", "text"),
]
let corpusBase: [[String: Any]] = [
    ["a": "apel", "b": 10, "c": 1500000, "d": "2026-10-01", "e": "Rp 1.500.000", "f": ["v": 0.1, "nf": "pct"]],
    ["a": "jeruk", "b": 20, "c": 2500000, "d": "2026-10-11", "e": "1.500", "f": "abc"],
    ["a": "mangga", "b": 30, "c": 500, "d": "2026-12-25", "e": ["v": 2500, "nf": "idr"], "f": true],
    ["a": "Apel", "b": -5, "d": "11/10/2026", "e": "  spaced   text ", "f": "15%"],
    ["a": "", "b": 0, "c": 750000, "d": "2025-02-28", "e": "0812345", "f": ["v": 46306, "nf": "date"]],
    ["a": "durian", "b": 2.5, "c": 100, "e": "Q4", "f": "x*y"],
    ["b": NSNull(), "c": 1000000, "d": "2024-02-29", "e": "TRUE", "f": "-12,5"],
    ["a": "kiwi", "b": 1.005, "c": 3, "d": "2026-01-31", "e": "hello world", "f": "2026-10-11"],
]

func runCorpusTests() {
    typealias F = SheetFormula
    guard let corpus = loadCorpus() else { fail("corpus.json not found"); return }
    let rowIds = (1...corpusBase.count).map { "r\($0)" }
    let shape = SheetShape(columnIds: corpusColumns.map { $0.id }, rowIds: rowIds)

    // Formulas through computeSheet.
    for item in corpus["formulas"] as? [[String: Any]] ?? [] {
        let f = item["f"] as! String, loc = item["loc"] as! String
        let stored = F.toStored(f, shape)
        eq(stored, item["stored"] as! String, "toStored \(f)")
        var rows: [(id: String, cells: [String: Any], styles: [String: [String: Any]]?)] = []
        for (i, cells) in corpusBase.enumerated() {
            var c = cells
            if i == 0 { c["g"] = ["f": stored] }
            rows.append((rowIds[i], c, nil))
        }
        let res = F.computeSheet(corpusColumns, rows, locale: F.DisplayLocale(rawValue: loc)!, names: [("Total", "{b!r1}:{b!r3}")])
        guard let cell = res["r1"]?["g"] else { fail("no result for \(f) [\(loc)]"); continue }
        checks += 1
        let want = expected(item["v"])
        if !sameValue(cell.v, want) { fail("value \(f) [\(loc)] — got \(cell.v), want \(want)") }
        eq(cell.d, item["d"] as! String, "display \(f) [\(loc)]")
        eq(cell.nf?.rawValue, item["nf"] as? String, "nf \(f) [\(loc)]")
        eq(cell.error, item["error"] as! Bool, "error flag \(f) [\(loc)]")
    }

    // Base cells' computed view.
    if let views = corpus["baseView"] as? [String: [String: [String: [String: Any]]]] {
        for (loc, view) in views {
            let rows = corpusBase.enumerated().map { (id: rowIds[$0.offset], cells: $0.element, styles: [String: [String: Any]]?.none) }
            let res = F.computeSheet(corpusColumns, rows, locale: F.DisplayLocale(rawValue: loc)!)
            for (rid, line) in view {
                for (cid, c) in line {
                    let got = res[rid]?[cid]
                    eq(got?.d, c["d"] as? String, "base view d \(rid).\(cid) [\(loc)]")
                    checks += 1
                    if let g = got, !sameValue(g.v, expected(c["v"])) { fail("base view v \(rid).\(cid) [\(loc)] — got \(g.v)") }
                    eq(got?.nf?.rawValue, c["nf"] as? String, "base view nf \(rid).\(cid) [\(loc)]")
                }
                eq(res[rid]?.count, line.count, "base view cell count \(rid) [\(loc)]")
            }
        }
    }

    // Typed input.
    for item in corpus["detect"] as? [[String: Any]] ?? [] {
        F.setDisplayLocale(item["loc"] as! String)
        let s = item["s"] as! String
        let d = F.detectInput(s)
        eq(d.kind, item["kind"] as! String, "detect kind \(jsonText(s)) [\(item["loc"]!)]")
        switch d {
        case .number(let v, let nf):
            near(v, (item["v"] as? Double) ?? .nan, "detect v \(jsonText(s))")
            eq(nf?.rawValue, item["nf"] as? String, "detect nf \(jsonText(s)) [\(item["loc"]!)]")
        case .text(let t): eq(t, item["v"] as? String ?? "?", "detect text \(jsonText(s))")
        case .empty: break
        }
    }
    for item in corpus["numbers"] as? [[String: Any]] ?? [] {
        F.setDisplayLocale(item["loc"] as! String)
        let s = item["s"] as! String
        let p = F.parseLocaleNumber(s)
        eq(p?.n, item["n"] as? Double, "parseLocaleNumber \(jsonText(s)) [\(item["loc"]!)]")
        eq(p?.separators, item["sep"] as? Bool, "separators \(jsonText(s)) [\(item["loc"]!)]")
        eq(F.parseDateText(s), item["date"] as? Double, "parseDateText \(jsonText(s)) [\(item["loc"]!)]")
    }
    F.setDisplayLocale(.idID)

    // Number formats.
    for item in corpus["styles"] as? [[String: Any]] ?? [] {
        F.setDisplayLocale(item["loc"] as! String)
        let v = item["v"] as! Double
        if item.keys.contains("fv") {
            let nf = (item["fv"] as? String).flatMap { F.NumFmt(rawValue: $0) }
            eq(F.formatValue(.number(v), nf), item["r"] as! String, "formatValue \(v) \(String(describing: nf)) [\(item["loc"]!)]")
            continue
        }
        let nf = item["nf"] as? String
        let dp = (item["dp"] as? Double).map { Int($0) }
        let got = F.formatWithStyle(.number(v), nf, dp, nil, nf == "custom" ? "#,##0.0" : nil)
        eq(got, item["r"] as? String, "formatWithStyle \(v) \(nf ?? "nil") dp \(String(describing: dp)) [\(item["loc"]!)]")
    }
    for item in corpus["scalars"] as? [[String: Any]] ?? [] {
        F.setDisplayLocale(item["loc"] as! String)
        let type = item["type"] as! String
        if item["result"] != nil {
            let nf = (item["nf"] as? String).flatMap { F.NumFmt(rawValue: $0) }
            let v = expected(item["v"])
            eq(F.formatResult(type, v, nf), item["r"] as! String, "formatResult \(type) \(v) \(String(describing: nf)) [\(item["loc"]!)]")
        } else {
            let raw: Any? = item["v"] is NSNull ? nil : item["v"]
            eq(F.formatScalar(type, raw), item["r"] as! String, "formatScalar \(type) \(jsonText(raw)) [\(item["loc"]!)]")
        }
    }
    F.setDisplayLocale(.idID)

    // Custom patterns.
    for item in corpus["patterns"] as? [[String: Any]] ?? [] {
        let loc = item["loc"] as! String
        let p = item["p"] as! String
        let v = expected(item["v"])
        let r = SheetNumFmt.formatPattern(v, p, loc)
        eq(r.text, item["text"] as! String, "pattern \(jsonText(p)) \(v) [\(loc)]")
        eq(r.color, item["color"] as? String, "pattern color \(jsonText(p)) \(v) [\(loc)]")
    }

    // References, R1C1, letters, serials.
    let shp = SheetShape(columnIds: ["ca", "cb", "cc", "cd"], rowIds: ["r1", "r2", "r3", "r4", "r5"])
    for item in corpus["refs"] as? [[String: Any]] ?? [] {
        if let f = item["f"] as? String {
            eq(F.canonicalFormula(f), item["canonical"] as? String, "canonical \(f)")
            eq(F.localizeFormula(f), item["localized"] as! String, "localized \(f)")
            let stored = F.toStored(f, shp)
            eq(stored, item["stored"] as! String, "stored \(f)")
            eq(F.toDisplay(stored, shp), item["display"] as! String, "display \(f)")
            eq(F.toDisplay(stored, shp, .en), item["displayEn"] as! String, "displayEn \(f)")
            eq(F.shiftFormula(f, 1, 1), item["shift"] as! String, "shift \(f)")
            eq(F.shiftFormula(f, -1, -1), item["shiftUp"] as! String, "shiftUp \(f)")
            eq(F.rewriteForDeletion(stored, shp, rows: ["r1", "r3"], cols: ["ca"]), item["del"] as! String, "rewriteForDeletion \(f)")
            let ranges = F.findA1Ranges(f).map { "\($0.top),\($0.left),\($0.bottom),\($0.right),\($0.wholeColumn)" }
            let want = (item["ranges"] as! [[String: Any]]).map { r -> String in
                let top = Int(r["top"] as! Double), left = Int(r["left"] as! Double)
                let bottom = Int(r["bottom"] as! Double), right = Int(r["right"] as! Double)
                return "\(top),\(left),\(bottom),\(right),\(r["wholeColumn"] as! Bool)"
            }
            eq(ranges, want, "findA1Ranges \(f)")
        } else if let f = item["r1c1"] as? String {
            eq(F.r1c1ToA1(f, 4, 2), item["a1"] as! String, "r1c1ToA1 \(f)")
        } else if let c = item["col"] as? Double {
            eq(F.colLetter(Int(c)), item["letter"] as! String, "colLetter \(c)")
            eq(Double(F.letterToIndex(item["letter"] as! String)), item["back"] as! Double, "letterToIndex \(c)")
        } else if let ymd = item["ymd"] as? [Double] {
            let s = F.ymdToSerial(ymd[0], ymd[1], ymd[2])
            eq(s, item["serial"] as! Double, "ymdToSerial \(ymd)")
            let b = item["back"] as! [String: Double]
            let got = F.serialToYmdD(s)
            eq([got.y, got.m, got.d], [b["y"]!, b["m"]!, b["d"]!], "serialToYmd \(ymd)")
            eq(F.serialToIso(s), item["iso"] as! String, "serialToIso \(ymd)")
        }
    }
}
