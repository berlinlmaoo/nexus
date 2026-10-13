// Tiny assertion harness (no XCTest) shared by the SheetFormula test files.
import Foundation

var checks = 0
var fails = 0

func fail(_ msg: String) {
    fails += 1
    if fails <= 200 { print("FAIL:", msg) }
}

func eq<T: Equatable>(_ a: T, _ b: T, _ msg: String, file: String = #file, line: Int = #line) {
    checks += 1
    if a != b { fail("\(msg) — got \(a), want \(b) [\((file as NSString).lastPathComponent):\(line)]") }
}

func near(_ a: Double?, _ b: Double, _ msg: String, line: Int = #line) {
    checks += 1
    guard let a = a, abs(a - b) < 1e-9 else { fail("\(msg) — got \(String(describing: a)), want \(b) [line \(line)]"); return }
}

func ok(_ c: Bool, _ msg: String, line: Int = #line) {
    checks += 1
    if !c { fail("\(msg) [line \(line)]") }
}

typealias CV = SheetCellValue
func num(_ n: Double) -> CV { .number(n) }
func txt(_ s: String) -> CV { .text(s) }

/// Build an engine from an A1 grid; "=…" strings become formulas (TS test helper `sheet`).
struct TestSheet {
    let e: SheetEngine
    let data: SheetData
    let cols: [String]
    let rows: [String]

    init(_ grid: [[Any?]], types: [String]? = nil) {
        let width = grid.map { $0.count }.max() ?? 0
        cols = (0..<width).map { "c\($0)" }
        rows = (0..<grid.count).map { "r\($0)" }
        let shp = SheetShape(columnIds: cols, rowIds: rows)
        var cells: [String: [String: Any]] = [:]
        for (ri, line) in grid.enumerated() {
            var m: [String: Any] = [:]
            for (ci, v) in line.enumerated() {
                guard let v = v else { continue }
                if let s = v as? String, s.hasPrefix("=") { m[cols[ci]] = ["f": SheetFormula.toStored(s, shp)] } else { m[cols[ci]] = v }
            }
            cells[rows[ri]] = m
        }
        var t: [String: String]? = nil
        if let types = types {
            var tt: [String: String] = [:]
            for (i, c) in cols.enumerated() { tt[c] = i < types.count ? types[i] : "text" }
            t = tt
        }
        data = SheetData(shape: shp, cells: cells, types: t)
        e = SheetEngine(data)
    }

    private func pos(_ a1: String) -> (String, String) {
        let letters = a1.prefix { $0.isLetter }
        let digits = Int(a1.dropFirst(letters.count))!
        return (rows[digits - 1], cols[SheetFormula.letterToIndex(String(letters))])
    }
    func at(_ a1: String) -> CV { let p = pos(a1); return e.value(p.0, p.1) }
    func fmt(_ a1: String) -> SheetFormula.NumFmt? { let p = pos(a1); return e.format(p.0, p.1) }
}
