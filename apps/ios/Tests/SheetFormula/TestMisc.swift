// Swift-only checks: deep dependency chains (no native stack overflow), long cycles, engineFor /
// SheetDataBox caching, derive(changedRows:), and the clipboard round trips.
import Foundation

func runMiscTests() {
    typealias F = SheetFormula
    F.setDisplayLocale(.idID)

    // Deep chains and a long cycle, far beyond SheetEngine.maxDepth.
    do {
        let n = 3000
        let rows = (0..<n).map { "r\($0)" }
        var cells: [String: [String: Any]] = [:]
        for i in 0..<n {
            var m: [String: Any] = [:]
            m["a"] = i == n - 1 ? 1 : ["f": "=SUM({a!\(rows[i + 1])};1)*1"]
            m["b"] = i == 0 ? ["v": 1, "nf": "idr"] : ["f": "={b!\(rows[i - 1])}+1"]
            m["c"] = ["f": "={c!\(rows[(i + 1) % n])}+1"]
            m["d"] = ["f": "=IFERROR({c!\(rows[i])};0)"]
            cells[rows[i]] = m
        }
        let e = SheetEngine(SheetData(shape: SheetShape(columnIds: ["a", "b", "c", "d"], rowIds: rows), cells: cells))
        eq(e.value(rows[0], "a"), .number(Double(n)), "downward chain of 3000")
        eq(e.value(rows[n - 1], "b"), .number(Double(n)), "upward chain of 3000")
        eq(e.format(rows[n - 1], "b"), .idr, "format through a chain of 3000")
        eq(e.value(rows[7], "c"), .text(F.ERR.cycle), "a 3000-cell cycle is circular")
        eq(e.value(rows[9], "c"), .text(F.ERR.cycle), "every cell on it")
        eq(e.value(rows[9], "d"), .number(0), "a reader of the cycle can catch it")
    }

    // engineFor caches per box; derive(changedRows:) only diffs the given rows.
    do {
        let shape = SheetShape(columnIds: ["a", "b"], rowIds: ["r1", "r2"])
        let box = SheetDataBox(SheetData(shape: shape, cells: ["r1": ["a": 2, "b": ["f": "={a!r1}*3"]], "r2": ["a": 5]]))
        let e1 = F.engineFor(box)
        eq(F.evaluateCell(box, "r1", "b"), .number(6), "evaluateCell")
        ok(F.engineFor(box) === e1, "one engine per box")
        var next = box.data
        next.cells["r1"]?["a"] = 4
        let box2 = SheetDataBox(next)
        let e2 = F.engineFor(box2, e1)
        eq(e2.value("r1", "b"), .number(12), "derived engine recomputes the dependent")
        let e3 = e1.derive(next, changedRows: ["r2"])
        eq(e3.value("r1", "b"), .number(6), "changedRows limits the diff (stale by request)")
    }

    // Clipboard: our JSON round trip, HTML tables, TSV fallback, cut once.
    do {
        typealias C = SheetClipboard
        C.lastCopy = nil
        let cells: [[C.ClipCell]] = [
            [C.ClipCell(text: "Rp 1.500", raw: ["v": 1500, "nf": "idr"]), C.ClipCell(text: "3", raw: ["f": "={a!r1}*2"], formula: "=A1*2")],
            [C.ClipCell(text: "a\tb"), C.ClipCell(text: "line1\nline2", style: ["b": 1])],
        ]
        let clip = C.buildClipboard(cells, origin: (r: 2, c: 1), cut: true, types: ["currency", "text"], widths: [120, 80])
        eq(clip.text, "Rp 1.500\t3\n\"a\tb\"\t\"line1\nline2\"", "TSV of display strings")
        ok(clip.html.contains("<td style=\"border:1px solid #ccc;padding:2px 3px;vertical-align:bottom\">line1<br>line2</td>"), "HTML keeps line breaks")
        let p = C.fromPayload(clip.json)
        eq(p?.cells.count, 2, "payload rows")
        eq(p?.cells[0][1].formula, "=A1*2", "payload formula")
        eq(p?.origin?.r, 2, "payload origin")
        eq(p?.cut, true, "payload cut")
        eq(p?.widths ?? [], [120, 80], "payload widths")
        ok(SheetJSONValue.equal(p?.cells[0][0].raw, ["v": 1500, "nf": "idr"]), "payload raw value")
        let viaText = C.readClipboard { $0 == "text/plain" ? clip.text : nil }
        eq(viaText?.internal, true, "plain text matching the last copy reads our payload")
        C.consumeCut()
        eq(C.lastCopy?.payload.cut, false, "a cut pastes once")
        let html = "<html><body><table><tr><td colspan=\"2\">A &amp; B</td><td data-sheets-formula=\"=R[0]C[-1]\">x</td></tr><tr><td>1<br>2</td><td>Rp&nbsp;5</td></tr></table></body></html>"
        let fromHtml = C.readClipboard { $0 == "text/html" ? html : ($0 == "text/plain" ? "ignored" : nil) }
        eq(fromHtml?.internal, false, "foreign HTML")
        eq(fromHtml?.cells.map { $0.map { $0.text } } ?? [], [["A & B", "", "x"], ["1\n2", "Rp 5", ""]], "HTML table with colspan")
        eq(fromHtml?.cells[0][2].formulaR1C1, "=R[0]C[-1]", "Sheets formula attribute kept")
        let tsv = C.readClipboard { $0 == "text/plain" ? "1\t2\n3\t4\n" : nil }
        eq(tsv?.cells.map { $0.map { $0.text } } ?? [], [["1", "2"], ["3", "4"]], "TSV fallback")
        eq(C.foreignFormulaAt("=R[0]C[-1]*2", 4, 2), "=B5*2", "foreign R1C1 formula")
    }

    // SheetTypes odds and ends.
    do {
        let cols = [SheetColumn(id: "a", name: "A", type: "currency"), SheetColumn(id: "b", name: "B", type: "text")]
        let rows = [SheetRowData(id: "r1", cells: ["a": 1000, "b": ["f": "={a!r1}*2"]]), SheetRowData(id: "r2", cells: ["a": "#N/A", "b": "x"])]
        let data = SheetTypes.buildSheetData(cols, rows)
        let e = SheetEngine(data)
        eq(SheetTypes.displayCell("text", rows[0].cells["b"], (e, "r1", "b")), "Rp 2.000", "displayCell of a formula")
        eq(SheetTypes.editFormula(rows[0].cells["b"], data.shape), "=A1*2", "editFormula")
        let agg = SheetTypes.aggregate(rows, cols[0], e)
        eq([agg.sum, Double(agg.filled), Double(agg.numeric), Double(agg.count)], [1000, 1, 1, 2], "aggregate")
        eq(SheetTypes.optionColor(SheetColumn(id: "x", name: "X", type: "select", options: ["a", "b"], optionColors: ["b": "green"]), "a"), "rose", "palette by position")
        eq(SheetTypes.optionColor(SheetColumn(id: "x", name: "X", type: "select", options: ["a", "b"], optionColors: ["b": "green"]), "b"), "green", "explicit chip colour")
        eq(F.SUPPORTED_FUNCTIONS.count, 90, "autocomplete list")
        eq(F.errorHint("#DIV/0!", lang: "en"), "Division by zero.", "errorHint en")
        eq(F.formulaError("=SUM(1;"), "#VALUE!", "formulaError")
        eq(F.formulaError("=SUM(1)"), nil, "formulaError ok")
        for fn in F.SUPPORTED_FUNCTIONS {
            let shape = SheetShape(columnIds: ["a"], rowIds: ["r1"])
            let v = SheetEngine(SheetData(shape: shape, cells: ["r1": ["a": ["f": "=\(fn.name)(1)"]]])).value("r1", "a")
            ok(v != .text(F.ERR.name), "\(fn.name) is implemented")
        }
    }
}
