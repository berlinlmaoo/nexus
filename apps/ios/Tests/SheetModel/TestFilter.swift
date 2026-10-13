import Foundation

// lib/sheet-filter.test.mjs, case by case, then the grid's pure pieces (SheetGridModel.swift).

private func eq<T: Equatable>(_ a: T, _ b: T, _ what: String) {
    check(a == b, "\(what): got \(a), want \(b)")
}

func runFilterTests() {
    let X = SheetFilter.self
    let shape = SheetShape(columnIds: ["nama", "kat", "jml"], rowIds: ["h", "r1", "r2", "r3", "r4", "r5", "x"])
    let cells: [String: [String: Any]] = [
        "h": ["nama": "Nama", "kat": "Kategori", "jml": "Jumlah"],
        "r1": ["nama": "Apel", "kat": "Buah", "jml": 12],
        "r2": ["nama": "Bayam", "kat": "Sayur", "jml": 5],
        "r3": ["nama": "Ceri", "kat": "Buah", "jml": 30],
        "r4": ["nama": "Durian", "kat": "", "jml": 2],
        "r5": ["nama": "edamame", "kat": "Sayur", "jml": 18],
        "x": ["nama": "outside"],
    ]
    let engine = SheetEngine(SheetData(shape: shape, cells: cells))
    let display: (String, String) -> String = { r, c in
        switch engine.value(r, c) {
        case .empty: return ""
        case .text(let s): return s
        case .number(let n): return SheetJS.numberToString(n)
        case .bool(let b): return b ? "true" : "false"
        }
    }
    let styles: [String: [String: (bg: String?, fc: String?)]] = ["r1": ["kat": (bg: "#B7E1CD", fc: nil)], "r3": ["kat": (bg: "#b7e1cd", fc: "#ff0000")]]
    let styleOf: (String, String) -> (bg: String?, fc: String?)? = { r, c in styles[r]?[c] }
    let range = "{nama!h}:{jml!r5}"
    let opts = SheetFilter.Opts(shape: shape, engine: engine, display: display, styleOf: styleOf)
    func hidden(_ criteria: [String: SheetFilter.Crit], slicers: [(colId: String, crit: SheetFilter.Crit?)] = []) -> [String] {
        var o = opts
        o.slicers = slicers
        return X.applyFilter(SheetFilter.Spec(range: range, criteria: criteria), o).hidden.sorted()
    }
    typealias C = SheetFilter.Crit
    typealias K = SheetFilter.Crit.Cond

    let res = X.applyFilter(SheetFilter.Spec(range: range), opts)
    eq(res.headerRow, 0, "header row is the range's first row")
    eq(res.rect, SheetValidation.Rect(top: 0, bottom: 5, left: 0, right: 2), "range rect")
    eq(res.hidden.count, 0, "no criteria hides nothing")
    eq(hidden(["kat": C(hidden: ["Sayur"])]), ["r2", "r5"], "hide a value")
    eq(hidden(["kat": C(hidden: [""])]), ["r4"], "hide (Blanks)")
    eq(hidden(["kat": C(hidden: ["Kategori"])]), [], "the header is never hidden")
    eq(hidden(["jml": C(cond: K(kind: "gt", values: ["10"]))]), ["r2", "r4"], "filter by condition")
    eq(hidden(["jml": C(cond: K(kind: "between", values: ["5", "18"]))]), ["r3", "r4"], "between")
    eq(hidden(["nama": C(cond: K(kind: "textStarts", values: ["e"]))]), ["r1", "r2", "r3", "r4"], "text starts with, case-insensitive")
    eq(hidden(["kat": C(fill: "#b7e1cd")]), ["r2", "r4", "r5"], "filter by fill colour (case-insensitive hex)")
    eq(hidden(["kat": C(text: "#ff0000")]), ["r1", "r2", "r4", "r5"], "filter by text colour")
    eq(hidden(["kat": C(hidden: ["Sayur"]), "jml": C(cond: K(kind: "lt", values: ["20"]))]), ["r2", "r3", "r5"], "two columns AND")
    eq(hidden([:], slicers: [(colId: "kat", crit: C(hidden: ["Buah"]))]), ["r1", "r3"], "slicer criteria")
    eq(hidden(["jml": C(cond: K(kind: "gt", values: ["10"]))], slicers: [(colId: "kat", crit: C(hidden: ["Buah"]))]), ["r1", "r2", "r3", "r4"], "slicers AND with the filter")
    eq(hidden(["jml": C(cond: K(kind: "formula", formula: SheetFormula.toStored("=C2>10", shape)))]), ["r2", "r4"], "custom formula relative to the first data row")
    eq(X.applyFilter(SheetFilter.Spec(range: "{zz!h}:{jml!r5}"), opts).rect, nil, "unreadable range")
    eq(X.critActive(C(hidden: [])), false, "empty hidden list isn't a filter")
    eq(X.critActive(C(cond: K(kind: "notEmpty"))), true, "a condition is a filter")

    // Sorting
    let body = ["r1", "r2", "r3", "r4", "r5"]
    let val: (String, String) -> SheetCellValue = { engine.value($0, $1) }
    typealias S = SheetFilter.SortSpec
    eq(X.sortedRowIds(body, [S(colId: "jml", dir: "asc")], val), ["r4", "r2", "r1", "r5", "r3"], "numbers ascending")
    eq(X.sortedRowIds(body, [S(colId: "jml", dir: "desc")], val), ["r3", "r5", "r1", "r2", "r4"], "numbers descending")
    eq(X.sortedRowIds(body, [S(colId: "kat", dir: "asc")], val), ["r1", "r3", "r2", "r5", "r4"], "text ascending, blank last, stable")
    eq(X.sortedRowIds(body, [S(colId: "kat", dir: "desc")], val), ["r2", "r5", "r1", "r3", "r4"], "descending keeps blanks last")
    eq(X.sortedRowIds(body, [S(colId: "kat", dir: "asc"), S(colId: "jml", dir: "desc")], val), ["r3", "r1", "r5", "r2", "r4"], "two sort keys")
    eq(X.sortedRowIds(body, [S(colId: "nama", dir: "asc")], val), ["r1", "r2", "r3", "r4", "r5"], "case-insensitive text order")

    // Distinct values & colours
    let dv = X.distinctValues(body, "kat", display)
    eq(dv.map(\.text), ["", "Buah", "Sayur"], "distinct values with (Blanks) first")
    eq(dv.map(\.count), [1, 2, 2], "distinct value counts")
    eq(X.distinctValues(body, "jml", display).map(\.text), ["2", "5", "12", "18", "30"], "numeric text sorts naturally")
    let colors = X.colorsInColumn(body, "kat", styleOf)
    eq(colors.fills, ["#b7e1cd"], "fills present in a column")
    eq(colors.texts, ["#ff0000"], "text colours present in a column")
    eq(X.sortByColor(body, "kat", "#ff0000", kind: "text", styleOf), ["r3", "r1", "r2", "r4", "r5"], "sort by text colour")

    // JSON round trip of a stored filter
    let spec = SheetFilter.Spec(json: ["range": range, "criteria": ["kat": ["hidden": ["Sayur"]], "jml": ["cond": ["kind": "gt", "values": ["10"]]]], "sort": ["colId": "jml", "dir": "desc"]])
    eq(spec?.criteria["kat"]?.hidden ?? [], ["Sayur"], "spec reads hidden values")
    eq(spec?.sort, S(colId: "jml", dir: "desc"), "spec reads its sort")
    let back = SheetFilter.Spec(json: spec?.json)
    eq(back, spec, "spec JSON round trip")
    eq(X.collatorCompare("apel", "Apel"), 0, "base sensitivity ignores case")
    eq(X.collatorCompare("item 9", "item 10"), -1, "numeric collation")
    eq(X.collatorCompare("éclair", "eclair"), 0, "base sensitivity ignores accents")
}

func runGridModelTests() {
    typealias G = SheetGridStyle
    // Borders: "all" over a 2×2 block stores each inner edge once.
    let rect = G.Rect(top: 0, bottom: 1, left: 0, right: 1)
    let a00 = G.applyBorderPreset("all", r: 0, c: 0, rect: rect, current: nil)
    let a11 = G.applyBorderPreset("all", r: 1, c: 1, rect: rect, current: nil)
    eq(a00, G.Borders(t: G.Edge(s: "thin"), b: G.Edge(s: "thin"), l: G.Edge(s: "thin"), r: G.Edge(s: "thin")), "all: top-left cell has four edges")
    eq(a11, G.Borders(t: nil, b: G.Edge(s: "thin"), l: nil, r: G.Edge(s: "thin")), "all: inner edges stored once")
    eq(G.applyBorderPreset("outer", r: 1, c: 0, rect: rect, current: nil), G.Borders(b: G.Edge(s: "thin"), l: G.Edge(s: "thin")), "outer: bottom-left corner")
    eq(G.applyBorderPreset("inner", r: 0, c: 0, rect: rect, current: nil), G.Borders(b: G.Edge(s: "thin"), r: G.Edge(s: "thin")), "inner")
    eq(G.applyBorderPreset("horizontal", r: 1, c: 1, rect: rect, current: nil), nil, "horizontal: the last row draws nothing")
    eq(G.applyBorderPreset("clear", r: 0, c: 0, rect: rect, current: ["bd": "tb"]), nil, "clear")
    eq(G.applyBorderPreset("top", r: 0, c: 1, rect: rect, current: nil, line: "dashed", color: "#FF0000"), G.Borders(t: G.Edge(s: "dashed", c: "#ff0000")), "line style and colour")
    eq(G.cellBorders(["bd": "lt", "bx": ["t": ["s": "thick"]]]), G.Borders(t: G.Edge(s: "thick"), l: G.Edge(s: "thin")), "bx wins over legacy bd")
    let neighbour = G.clearNeighbourEdge(["bx": ["b": ["s": "thin"], "r": ["s": "thin"]]], side: "b")
    if case .some(let b) = neighbour { eq(b, G.Borders(r: G.Edge(s: "thin")), "neighbour keeps its other side") } else { check(false, "neighbour edge cleared") }
    if case .none = G.clearNeighbourEdge(nil, side: "r") { check(true, "") } else { check(false, "nothing to clear on a bare neighbour") }
    let changes = G.borderChanges(preset: "outer", rows: [4, 5], cols: [2], above: 3, leftCol: 1, line: "thin", color: nil) { r, c in
        r == 3 && c == 2 ? ["bx": ["b": ["s": "thin"]], "b": 1] : nil
    }
    eq(changes.count, 3, "outer over 2 cells + the cell above sharing the edge")
    eq(changes.last.map { "\($0.0):\($0.1)" } ?? "", "3:2", "the cell above is cleared")
    eq((changes.last?.2?["b"] as? Int) ?? 0, 1, "the cell above keeps its other formats")
    check(changes.last?.2?["bx"] == nil, "the cell above loses the shared edge")
    let patched = G.patchStyle(["b": 1, "bd": "t"], ["bd": nil, "fc": "#ff0000", "i": false])
    eq(patched?.count ?? 0, 2, "patchStyle drops nil / false keys")
    eq(G.patchStyle(["b": 1], ["b": nil]) == nil, true, "patchStyle: empty style is nil")

    // Colours, fonts, numbers
    eq(G.toHex("#ABC"), "#aabbcc", "short hex")
    eq(G.toHex("amber"), "#fbbf24", "legacy colour name")
    eq(G.toHex("nope"), nil, "unknown colour")
    eq(G.readableText("#000000"), "#ffffff", "white on black")
    eq(G.readableText("#ffe599"), "#000000", "black on light yellow")
    eq(G.fontPt(["fs": 13]), 10, "13px is 10pt")
    eq(G.fontPt(["fp": 14, "fs": 30]), 14, "fp wins")
    eq(G.wrapMode(["w": 1]), "w", "legacy wrap flag")
    eq(G.wrapMode(["w": 1, "wr": "c"]), "c", "wr wins")
    eq(G.decimalsShown("1.234,50", english: false), 2, "id-ID decimals")
    eq(G.decimalsShown("12.5%", english: true), 1, "en-US percent decimals")
    eq(G.decimalsShown("1.234", english: false), 0, "thousands separator is not a decimal")
    eq(G.palette.flatMap { $0 }.count, 80, "80 swatches")

    // Merges
    let rowIds = ["a", "b", "c", "d", "e"], colIds = ["x", "y", "z"]
    let specs = [SheetMerges.Spec(r: "a", c: "x", rs: 2, cs: 2), SheetMerges.Spec(r: "c", c: "z", rs: 3, cs: 1), SheetMerges.Spec(r: "e", c: "y", rs: 1, cs: 1)]
    let all = SheetMerges.resolve(specs, rowIds: rowIds, colIds: colIds, visRows: [0, 1, 2, 3, 4], visCols: [0, 1, 2])
    eq(all, [SheetRange(SheetPos(r: 0, c: 0), SheetPos(r: 1, c: 1)), SheetRange(SheetPos(r: 2, c: 2), SheetPos(r: 4, c: 2))], "merges in screen space; 1×1 dropped")
    let hid = SheetMerges.resolve(specs, rowIds: rowIds, colIds: colIds, visRows: [0, 2, 3, 4], visCols: [0, 2])
    eq(hid, [SheetRange(SheetPos(r: 1, c: 1), SheetPos(r: 3, c: 1))], "hidden rows / cols shrink a merge; one visible cell = no merge")
    eq(SheetMerges.at(SheetPos(r: 1, c: 1), in: all), all[0], "merge at a covered cell")
    let grown = SheetMerges.expand(SheetRange(SheetPos(r: 1, c: 1), SheetPos(r: 2, c: 2)), with: all)
    eq(grown, SheetRange(SheetPos(r: 0, c: 0), SheetPos(r: 4, c: 2)), "a selection grows to whole merges")
    let rowIndex: (SheetMerges.Spec) -> Int? = { rowIds.firstIndex(of: $0.r) }
    eq(SheetMerges.freezeCuts(specs, n: 1, rows: true, index: rowIndex), true, "freezing 1 row cuts the A1:B2 merge")
    eq(SheetMerges.freezeCuts(specs, n: 2, rows: true, index: rowIndex), false, "freezing 2 rows is fine")
    eq(SheetMerges.freezeCuts(specs, n: 0, rows: true, index: rowIndex), false, "unfreeze is always fine")

    // Overflow
    typealias Cell = SheetSpill.Cell
    func cell(_ text: Double, _ align: String = "l", empty: Bool = false, spill: Bool = true) -> Cell {
        Cell(width: 100, empty: empty, canSpill: spill, textWidth: text, align: align)
    }
    let blank = Cell(width: 100, empty: true, canSpill: false, textWidth: 0, align: "l")
    var out = SheetSpill.row([cell(250), blank, blank, blank])
    eq(out.extents[0], SheetSpill.Extent(left: 0, right: 200), "left text runs right over two empty cells")
    eq(out.hideRightLine, [true, true, false, false], "lines under the text hidden")
    out = SheetSpill.row([cell(250), blank, cell(10)])
    eq(out.extents[0].right, 100, "stops at the first non-empty neighbour")
    out = SheetSpill.row([blank, blank, cell(250, "r")])
    eq(out.extents[2], SheetSpill.Extent(left: 200, right: 0), "right-aligned text runs left")
    eq(out.hideRightLine, [true, true, false], "right-aligned spill lines")
    out = SheetSpill.row([blank, cell(250, "c"), blank])
    eq(out.extents[1], SheetSpill.Extent(left: 100, right: 100), "centred text runs both ways")
    eq(out.hideRightLine, [true, true, false], "centred spill lines")
    out = SheetSpill.row([cell(250, spill: false), blank])
    eq(out.extents[0].right, 0, "numbers / wrapped text never spill")
    out = SheetSpill.row([cell(80), blank])
    eq(out.extents[0].right, 0, "text that fits does not spill")
    out = SheetSpill.row([cell(250), blank, blank], barrier: 1)
    eq(out.extents[0].right, 0, "never across the frozen edge")

    // Hidden gaps
    let gaps = SheetHiddenGaps.gaps(visible: [0, 3, 4], count: 6, hidden: { [1, 2, 5].contains($0) })
    eq(gaps[1] ?? [], [1, 2], "hidden before a visible row")
    eq(gaps[3] ?? [], [5], "hidden after the last")
    check(gaps[0] == nil && gaps[2] == nil, "no gap where nothing is hidden")
}
