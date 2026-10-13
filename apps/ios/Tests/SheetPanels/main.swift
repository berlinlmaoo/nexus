// Linux check of the spreadsheet panels' plain logic against the web's own test files:
//   SheetPanelChartData.swift    ← lib/sheet-chart.test.mjs
//   SheetPanelPivotData.swift    ← lib/sheet-pivot.test.mjs
//   SheetPanelVersionsData.swift ← lib/sheet-versions.test.mjs + the find & replace part of sheet-datatools.test.mjs
//   SheetStats.swift             ← lib/sheet-stats.test.mjs
//   SheetRanges.swift            ← named-range / protection rules of SheetRangesPanel.tsx + SheetGrid protectedHere
// Run from the repo root:
//   docker run --rm -v "$PWD":/w -w /w swift:5.10-jammy bash -c "swiftc -O -o /tmp/t \
//     Sources/Sheets/SheetFormula*.swift Sources/Sheets/SheetNumFmt.swift Sources/Sheets/SheetValidation.swift \
//     Sources/Sheets/SheetCF.swift Sources/Sheets/SheetTypes.swift Sources/Sheets/SheetPanel*Data.swift \
//     Sources/Sheets/SheetFilter.swift Sources/Sheets/SheetStats.swift Sources/Sheets/SheetRanges.swift \
//     Tests/SheetPanels/main.swift && /tmp/t"
// Prints "checks N, fails 0" when everything matches.
import Foundation

var checks = 0
var fails = 0
func eq<T: Equatable>(_ a: T, _ b: T, _ msg: String, line: Int = #line) {
    checks += 1
    if a != b { fails += 1; print("FAIL: \(msg) — got \(a), want \(b) [line \(line)]") }
}
func near(_ a: SPPivotCell, _ b: Double, _ msg: String, line: Int = #line) {
    checks += 1
    guard case .number(let x) = a, abs(x - b) < 1e-9 else { fails += 1; print("FAIL: \(msg) — got \(a), want \(b) [line \(line)]"); return }
}

typealias F = SheetFormula

// MARK: - sheet-chart.test.mjs

func chartTests() {
    let cols = ["ca", "cb", "cc", "cd", "ce"]
    func sheet(_ rows: [[Any?]], _ types: [String: String]? = nil) -> (data: SheetData, engine: SheetEngine, shape: SheetShape) {
        let rowIds = rows.indices.map { "r\($0 + 1)" }
        var cells: [String: [String: Any]] = [:]
        for (i, row) in rows.enumerated() {
            var rec: [String: Any] = [:]
            for (j, v) in row.enumerated() { if let v { rec[cols[j]] = v } }
            cells[rowIds[i]] = rec
        }
        let data = SheetData(shape: SheetShape(columnIds: cols, rowIds: rowIds), cells: cells, types: types)
        return (data, F.engineFor(data), data.shape)
    }
    func R(_ a: String, _ b: String) -> String { "{\(a)}:{\(b)}" }

    let fiveRows = SheetShape(columnIds: cols, rowIds: ["r1", "r2", "r3", "r4", "r5"])
    let fruit = sheet([
        ["Nama", "Kategori", "Jumlah", "Tanggal"],
        ["Apel", "Buah", 12, "2026-10-01"],
        ["Bayam", "Sayur", 5, "2026-10-03"],
        ["Ceri", "Buah", 30, "2026-10-05"],
        ["Apel", "Buah", ["f": F.toStored("=C2/2", fiveRows)], "2026-10-02"],
    ], ["cd": "date"])
    func cd(_ ranges: [String], headers: Bool? = nil, labels: Bool? = nil, transpose: Bool? = nil, aggregate: String? = nil,
            _ s: (data: SheetData, engine: SheetEngine, shape: SheetShape)) -> SPChart.ChartData {
        SPChart.chartData(ranges: ranges, headers: headers, labels: labels, transpose: transpose, aggregate: aggregate, data: s.data, engine: s.engine)
    }
    do {
        let d = cd([R("ca!r1", "cc!r5")], fruit)
        eq(d.headerRow, true, "row 1 detected as header (text over numbers)")
        eq(d.labels, true, "column A detected as labels (text)")
        eq(d.categories, ["Apel", "Bayam", "Ceri", "Apel"], "categories from column A")
        eq(d.series.map { $0.name }, ["Jumlah"], "text-only column B is not a series")
        eq(d.series[0].values, [12, 5, 30, 6], "values include formula results")
        eq(d.series[0].source, 2, "series source column")
        eq(d.xName, "Nama", "x-axis chip name")
        eq(d.empty, false, "not empty")
    }
    do {
        let d = cd([R("ca!r1", "cc!r5")], headers: false, fruit)
        eq(d.categories[0], "Nama", "headers off: row 1 is data")
        eq(d.series[0].name, "C", "headers off: series named after its column")
        eq(d.series[0].values[0], nil, "non-numeric value -> null")
    }
    do {
        let d = cd([R("ca!r1", "cc!r5")], labels: false, fruit)
        eq(d.categories, ["1", "2", "3", "4"], "labels off: categories are row numbers")
        eq(d.labels, false, "labels flag")
    }
    do {
        let d = cd([R("ca!r1", "cc!r5")], aggregate: "sum", fruit)
        eq(d.categories, ["Apel", "Bayam", "Ceri"], "aggregate: distinct categories in order")
        eq(d.series[0].values, [18, 5, 30], "aggregate sum")
        eq(cd([R("ca!r1", "cc!r5")], aggregate: "avg", fruit).series[0].values, [9, 5, 30], "aggregate average")
        eq(cd([R("ca!r1", "cc!r5")], aggregate: "count", fruit).series[0].values, [2, 1, 1], "aggregate count")
        eq(cd([R("ca!r1", "cc!r5")], aggregate: "max", fruit).series[0].values, [12, 5, 30], "aggregate max")
    }
    do {
        let d = cd([R("cd!r1", "cd!r5"), R("cc!r1", "cc!r5")], fruit)
        eq(d.xKind, "date", "date x-axis")
        eq(d.categories[0], F.formatDateSerial(F.ymdToSerial(2026, 10, 1)), "date category text uses the cell format")
        eq(d.series[0].name, "Jumlah", "multi-range: second range is the series")
        eq(d.series[0].values, [12, 5, 30, 6], "multi-range values side by side")
    }
    let wide = sheet([["", "Q1", "Q2", "Q3"], ["Venue", 10, 20, 30], ["Talent", 1, 2, 3]])
    do {
        let d = cd([R("ca!r1", "cd!r3")], wide)
        eq(d.series.map { $0.name }, ["Q1", "Q2", "Q3"], "unswitched: columns are series")
        let t = cd([R("ca!r1", "cd!r3")], transpose: true, wide)
        eq(t.categories, ["Q1", "Q2", "Q3"], "switched: row 1 becomes the x-axis")
        eq(t.series.map { $0.name }, ["Venue", "Talent"], "switched: rows are series")
        eq(t.series[0].values, [10, 20, 30], "switched values")
        eq(t.series[1].source, 2, "switched series source is the sheet row")
    }
    do {
        let blank = sheet([[], []])
        eq(cd([R("ca!r1", "cb!r2")], blank).empty, true, "empty range")
        eq(cd(["{zz!r1}:{zz!r2}"], fruit).empty, true, "invalid range")
        eq(cd([], fruit).empty, true, "no ranges")
        eq(cd([R("ca!r1", "cb!r5")], fruit).empty, true, "text only: nothing to plot")
    }
    do {
        typealias Rect = SheetValidation.Rect
        func pick(_ r: Rect, _ s: (data: SheetData, engine: SheetEngine, shape: SheetShape)) -> String { SPChart.defaultChart(r, s.data, s.engine).type }
        eq(pick(Rect(top: 0, bottom: 4, left: 0, right: 2), fruit), "column", "repeated labels: column")
        eq(pick(Rect(top: 1, bottom: 1, left: 2, right: 2), fruit), "scorecard", "single cell: scorecard")
        let pie = sheet([["Item", "Biaya"], ["Venue", 10], ["Talent", 5], ["Food", 3]])
        let p = SPChart.defaultChart(Rect(top: 0, bottom: 3, left: 0, right: 1), pie.data, pie.engine)
        eq([p.type, "\(p.headers)", "\(p.labels)"], ["pie", "true", "true"], "one series, few distinct positive slices: pie")
        let neg = sheet([["Item", "Saldo"], ["A", 10], ["B", -5]])
        eq(pick(Rect(top: 0, bottom: 2, left: 0, right: 1), neg), "column", "a negative value: column")
        let xy = sheet([["X", "Y"], [1, 2], [2, 4], [3, 9]])
        let x = SPChart.defaultChart(Rect(top: 0, bottom: 3, left: 0, right: 1), xy.data, xy.engine)
        eq([x.type, "\(x.headers)", "\(x.labels)"], ["scatter", "true", "true"], "numeric x: scatter")
        var dayRows: [[Any?]] = [["Tanggal", "Sales"]]
        for i in 0..<12 { dayRows.append([String(format: "2026-10-%02d", i + 1), i * 3]) }
        let days = sheet(dayRows, ["ca": "date"])
        eq(pick(Rect(top: 0, bottom: 12, left: 0, right: 1), days), "line", "many dates: line")
    }
    do {
        let bins = SPChart.histogramBins([1, 2, 2, 3, 4, 5, 10, nil], 3)
        eq(bins.count, 3, "three buckets")
        eq(bins.map { $0.count }, [4, 2, 1], "bucket counts")
        eq(bins[2].to, 10, "last bucket ends at the max")
        eq(bins.reduce(0) { $0 + $1.count }, 7, "every number counted once")
        eq(SPChart.histogramBins([4, 4, 4]), [SPChart.HistogramBin(from: 4, to: 4, count: 3)], "all equal: one bucket")
        eq(SPChart.histogramBins([]), [], "no numbers")
        eq(SPChart.histogramBins((0..<16).map { Double($0) }).count, 5, "Sturges' rule")
        let w = SPChart.waterfallSteps([10, -3, nil, 5])
        eq(w.map { "\($0.start),\($0.end),\($0.kind)" }, ["0.0,10.0,up", "10.0,7.0,down", "7.0,7.0,up", "7.0,12.0,up", "0.0,12.0,total"], "waterfall running total")
        eq(SPChart.waterfallSteps([1, 2], total: false).count, 2, "waterfall without total")
    }
    do {
        let shape = fruit.shape
        eq(SPChart.rangesFromA1("Sheet1!A1:C5, E1:E5", shape) ?? [], [R("ca!r1", "cc!r5"), R("ce!r1", "ce!r5")], "typed ranges")
        eq(SPChart.rangesFromA1("A1:C5, nope", shape) == nil, true, "one bad part fails")
        eq(SPChart.rangesToA1([R("ca!r1", "cc!r5"), R("ce!r1", "ce!r5")], shape), "A1:C5, E1:E5", "ranges as text")
        eq(SPChart.addSeriesColumn([R("ca!r1", "cc!r5")], 4, shape), [R("ca!r1", "cc!r5"), R("ce!r1", "ce!r5")], "add series column")
        eq(SPChart.removeSeriesSource([R("ca!r1", "cc!r5")], 1, shape), [R("ca!r1", "ca!r5"), R("cc!r1", "cc!r5")], "remove a middle column splits the range")
        eq(SPChart.removeSeriesSource([R("ca!r1", "cc!r5")], 2, shape), [R("ca!r1", "cb!r5")], "remove the last column")
        eq(SPChart.removeSeriesSource(["{ca!*}:{cb!*}"], 1, shape), ["{ca!*}:{ca!*}"], "whole columns stay whole")
        eq(SPChart.removeSeriesSource([R("ca!r1", "cd!r3")], 2, shape, byRow: true), [R("ca!r1", "cd!r2")], "switched: remove a row")
    }
    do {
        eq(SPChart.stackingOf("column100"), "percent", "stacking of 100% column")
        eq(SPChart.withStacking("bar", "standard"), "barStacked", "stacked bar")
        eq(SPChart.withStacking("pie", "standard"), "pie", "pie has no stacking")
        eq(SPChart.seriesColor(1, nil), "#ea4335", "default second colour")
        eq(SPChart.seriesColor(0, ["#111111"], ["#222222"]), "#111111", "own colour wins")
        eq(SPChart.seriesColor(1, ["#111111"], ["#222222", "#333333"]), "#333333", "theme accents next")
    }
    do {
        // Scorecard: the summed first series, and a key cell.
        var spec = SPChartSpec(id: "c", type: "scorecard", ranges: [R("ca!r1", "cc!r5")])
        let v = SPChart.scorecardValues(spec, fruit.data, fruit.engine)
        eq(v.key, 53, "scorecard sums the first series")
        spec.key = R("cc!r4", "cc!r4")
        eq(SPChart.scorecardValues(spec, fruit.data, fruit.engine).key, 30, "scorecard key cell")
        // JSON round trip keeps unknown keys.
        let json: [String: Any] = ["id": "ch_1", "type": "line", "ranges": ["{ca!r1}:{cb!r2}"], "at": ["r": "r1", "c": "ca"], "w": 600, "h": 371, "future": 1]
        let back = SPChartSpec(json: json)!.json
        eq(back["future"] as? Int, 1, "unknown keys survive")
        eq(back["type"] as? String, "line", "type survives")
    }
}

// MARK: - sheet-pivot.test.mjs

func pivotTests() {
    let cols = ["cn", "ck", "cj", "ct", "cs"]
    let table: [[Any?]] = [
        ["Nama", "Kategori", "Jumlah", "Tanggal", "Status"],
        ["Apel", "Buah", 12, "2026-10-01", "Baru"],
        ["Bayam", "Sayur", 5, "2026-10-03", "Proses"],
        ["Ceri", "Buah", 30, "2026-10-05", "Selesai"],
        ["Durian", "Buah", 2, "2026-10-02", "Baru"],
        ["Edamame", "Sayur", 18, "2026-10-08", "Proses"],
        ["Apel", "Buah", 12, "2026-10-01", "Baru"],
        ["Fig", "Buah", 7, "2026-10-09", "Selesai"],
    ]
    func makeSrc(_ rowsData: [[Any?]], _ colIds: [String] = cols, _ types: [String: String] = ["ct": "date"]) -> SPPivotSource {
        let rowIds = rowsData.indices.map { "r\($0 + 1)" }
        var cells: [String: [String: Any]] = [:]
        for (i, r) in rowsData.enumerated() {
            var rec: [String: Any] = [:]
            for (j, v) in r.enumerated() { if let v { rec[colIds[j]] = v } }
            cells[rowIds[i]] = rec
        }
        let data = SheetData(shape: SheetShape(columnIds: colIds, rowIds: rowIds), cells: cells, types: types)
        return SPPivotSource(data: data, engine: F.engineFor(data), headerOf: { "Column \($0)" })
    }
    let src = makeSrc(table)
    let RANGE = "{cn!r1}:{cs!r8}"
    func pv(rows: [SPPivotGroup] = [], cols: [SPPivotGroup] = [], values: [SPPivotValue] = [], filters: [SPPivotFilter] = [], range: String? = nil) -> SPPivot.Result {
        SPPivot.computePivot(SPPivotSpec(source: "s1", range: range ?? RANGE, rows: rows, cols: cols, values: values, filters: filters), src)
    }
    func t(_ s: String) -> SPPivotCell { .text(s) }
    func n(_ x: Double) -> SPPivotCell { .number(x) }
    let blank = SPPivotCell.blank
    let ck = SPPivotGroup(colId: "ck"), cs = SPPivotGroup(colId: "cs")
    let sumJ = SPPivotValue(colId: "cj", fn: "SUM")

    do {
        let r = pv(rows: [ck], values: [sumJ])
        eq(r.grid[0], [t("Kategori"), t("SUM of Jumlah")], "header: row field name + value label")
        eq(r.grid[1], [t("Buah"), n(63)], "Buah sum")
        eq(r.grid[2], [t("Sayur"), n(23)], "Sayur sum")
        eq(r.grid[3], [t("Grand Total"), n(86)], "grand total row")
        eq(r.formats[1], [nil, "num"], "value cells are numbers")
        eq(r.error, nil, "no error")
    }
    do {
        let r = pv(rows: [SPPivotGroup(colId: "ck", order: "desc")], values: [sumJ])
        eq(r.grid.map { $0[0] }, [t("Kategori"), t("Sayur"), t("Buah"), t("Grand Total")], "descending groups")
    }
    do {
        let r = pv(rows: [ck], cols: [cs], values: [sumJ])
        eq(r.grid[0], [t("SUM of Jumlah"), t("Status"), blank, blank, blank], "top row")
        eq(r.grid[1], [t("Kategori"), t("Baru"), t("Proses"), t("Selesai"), t("Grand Total")], "column values + grand total column")
        eq(r.grid[2], [t("Buah"), n(26), blank, n(37), n(63)], "Buah across statuses")
        eq(r.grid[3], [t("Sayur"), blank, n(23), blank, n(23)], "Sayur across statuses")
        eq(r.grid[4], [t("Grand Total"), n(26), n(23), n(37), n(86)], "grand total row")
        eq(r.grid.allSatisfy { $0.count == 5 }, true, "rectangular")
    }
    do {
        let r = pv(rows: [ck, cs], values: [sumJ])
        eq(r.grid.map { Array($0.prefix(3)) }, [
            [t("Kategori"), t("Status"), t("SUM of Jumlah")],
            [t("Buah"), t("Baru"), n(26)],
            [blank, t("Selesai"), n(37)],
            [t("Buah Total"), blank, n(63)],
            [t("Sayur"), t("Proses"), n(23)],
            [t("Sayur Total"), blank, n(23)],
            [t("Grand Total"), blank, n(86)],
        ], "two row levels with subtotals")
        let noSub = pv(rows: [SPPivotGroup(colId: "ck", totals: false), cs], values: [sumJ])
        eq(noSub.grid.count, 4, "totals off: no subtotals and no grand total")
    }
    do {
        func one(_ fn: String, _ colId: String = "cj") -> SPPivotCell { pv(values: [SPPivotValue(colId: colId, fn: fn)]).grid[1][0] }
        eq(one("SUM"), n(86), "SUM")
        eq(one("COUNTA", "cn"), n(7), "COUNTA")
        eq(one("COUNT"), n(7), "COUNT")
        eq(one("COUNT", "cn"), n(0), "COUNT of text")
        eq(one("COUNTUNIQUE", "cn"), n(6), "COUNTUNIQUE")
        near(one("AVERAGE"), 86.0 / 7, "AVERAGE")
        eq(one("MAX"), n(30), "MAX")
        eq(one("MIN"), n(2), "MIN")
        eq(one("MEDIAN"), n(12), "MEDIAN")
        eq(one("PRODUCT"), n(12 * 5 * 30 * 2 * 18 * 12 * 7), "PRODUCT")
        let xs: [Double] = [12, 5, 30, 2, 18, 12, 7], m = 86.0 / 7
        let ss = xs.reduce(0) { $0 + ($1 - m) * ($1 - m) }
        near(one("VAR"), ss / 6, "VAR")
        near(one("VARP"), ss / 7, "VARP")
        near(one("STDEV"), (ss / 6).squareRoot(), "STDEV")
        near(one("STDEVP"), (ss / 7).squareRoot(), "STDEVP")
        eq(one("AVERAGE", "cn"), t("#DIV/0!"), "AVERAGE of no numbers")
        eq(pv(values: [sumJ]).grid[0], [t("SUM of Jumlah")], "values only: one header")
    }
    do {
        let total = pv(rows: [ck], cols: [cs], values: [SPPivotValue(colId: "cj", fn: "SUM", showAs: "total")])
        near(total.grid[2][1], 26.0 / 86, "% of grand total")
        eq(total.grid[4][4], n(1), "grand total = 100%")
        eq(total.formats[2][1], "pct", "pct format")
        let row = pv(rows: [ck], cols: [cs], values: [SPPivotValue(colId: "cj", fn: "SUM", showAs: "row")])
        near(row.grid[2][1], 26.0 / 63, "% of row")
        eq(row.grid[3][4], n(1), "row total = 100%")
        let col = pv(rows: [ck], cols: [cs], values: [SPPivotValue(colId: "cj", fn: "SUM", showAs: "col")])
        near(col.grid[2][1], 1, "% of column")
        near(col.grid[4][4], 1, "column grand total")
    }
    do {
        let r = pv(rows: [ck], cols: [cs], values: [sumJ, SPPivotValue(colId: "cn", fn: "COUNTA")])
        eq(Array(r.grid[2].prefix(3)), [t("Kategori"), t("SUM of Jumlah"), t("COUNTA of Nama")], "value labels row")
        eq(Array(r.grid[3].prefix(3)), [t("Buah"), n(26), n(3)], "two values per status")
        eq(r.grid[0].count, 1 + 4 * 2, "width = labels + columns × values")
    }
    do {
        let r = pv(rows: [ck], values: [sumJ], filters: [SPPivotFilter(colId: "cs", hidden: ["Baru"])])
        eq(r.grid.map { $0[1] }, [t("SUM of Jumlah"), n(37), n(23), n(60)], "Baru rows filtered out")
        let all = pv(rows: [ck], values: [sumJ], filters: [SPPivotFilter(colId: "cs", hidden: ["Baru", "Proses", "Selesai"])])
        eq(all.grid, [[t("Kategori"), t("SUM of Jumlah")], [t("Grand Total"), blank]], "everything hidden")
    }
    do {
        eq(pv(rows: [cs]).grid, [[t("Status")], [t("Baru")], [t("Proses")], [t("Selesai")]], "labels only, no totals")
        eq(pv(rows: [ck], cols: [cs]).grid[1], [t("Kategori"), t("Baru"), t("Proses"), t("Selesai")], "column labels without grand total")
        eq(pv().grid, [], "empty spec = empty grid")
    }
    do {
        let s = makeSrc([["K", "V"], [10, 1], ["b", 1], [9, 1], ["A", 1], [nil, 1], [100, 1]], ["ca", "cb"], [:])
        let r = SPPivot.computePivot(SPPivotSpec(source: "s", range: "{ca!r1}:{cb!r7}", rows: [SPPivotGroup(colId: "ca")], values: [SPPivotValue(colId: "cb", fn: "SUM")]), s)
        eq(r.grid.map { $0[0] }, [t("K"), n(9), n(10), n(100), t("A"), t("b"), t(""), t("Grand Total")], "numbers first, text by locale, blanks last")
        let d = pv(rows: [SPPivotGroup(colId: "ct")], values: [SPPivotValue(colId: "cj", fn: "COUNT")])
        if case .text = d.grid[1][0] { eq(true, true, "") } else { eq(false, true, "date group label shown as a date") }
        eq(d.grid.count, 8, "6 distinct dates + header + total")
    }
    do {
        eq(pv(range: "{zz!r1}:{cs!r8}").error, "invalid range", "bad range")
        let s = makeSrc([["", "V"], ["x", 1]], ["ca", "cb"], [:])
        eq(SPPivot.computePivot(SPPivotSpec(source: "s", range: "{ca!r1}:{cb!r2}", rows: [SPPivotGroup(colId: "ca")]), s).grid[0], [t("Column ca")], "blank header falls back")
        let h = makeSrc([["K", "V"]], ["ca", "cb"], [:])
        eq(SPPivot.computePivot(SPPivotSpec(source: "s", range: "{ca!r1}:{cb!r1}", rows: [SPPivotGroup(colId: "ca")], values: [SPPivotValue(colId: "cb", fn: "SUM")]), h).grid,
           [[t("K"), t("SUM of V")], [t("Grand Total"), blank]], "header-only range")
        var wideRows: [[Any?]] = [["K", "V"]]
        for i in 0..<60 { wideRows.append(["k\(i)", i]) }
        let wide = makeSrc(wideRows, ["ca", "cb"], [:])
        let w = SPPivot.computePivot(SPPivotSpec(source: "s", range: "{ca!r1}:{cb!r61}", cols: [SPPivotGroup(colId: "ca")], values: [SPPivotValue(colId: "cb", fn: "SUM")]), wide)
        eq(w.error, "too many columns", "column cap")
        eq(w.grid.allSatisfy { $0.count == 50 }, true, "truncated to 50")
    }
    do {
        eq(SPPivot.distinctFieldValues(src, RANGE, "cs"), ["Baru", "Proses", "Selesai"], "distinct statuses")
        eq(SPPivot.distinctFieldValues(src, RANGE, "cn").count, 6, "distinct names")
        eq(SPPivot.distinctFieldValues(src, RANGE, "zz"), [], "unknown field")
        eq(SPPivot.pivotFields(src, RANGE).map { $0.label }, ["Nama", "Kategori", "Jumlah", "Tanggal", "Status"], "fields")
        let sug = SPPivot.pivotSuggestions(src, RANGE)
        eq(sug.count, 4, "four suggestions")
        eq(sug[0].label, "SUM of Jumlah for each Nama", "first suggestion")
        eq(sug[1].template, "SUM of {value} for each {row} by {col}", "template with column")
        eq(sug[1].vars, ["value": "Jumlah", "row": "Nama", "col": "Kategori"], "vars")
        var applied = sug[1].spec
        applied.source = "s1"
        eq(Array(SPPivot.computePivot(applied, src).grid[1].prefix(3)), [t("Nama"), t("Buah"), t("Sayur")], "suggestion spec computes")
        eq(SPPivot.pivotSuggestions(src, "{cn!r1}:{cs!r1}").count, 0, "no data rows, no suggestions")
    }
}

// MARK: - sheet-versions.test.mjs

func versionTests() {
    func rev(_ at: String, _ rowId: String, _ col: String, _ old: Any?, _ new: Any?, _ author: (String, String) = ("u1", "Ann")) -> SPRevision {
        SPRevision(rowId: rowId, columnId: col, oldValue: old, newValue: new, createdAt: at, authorId: author.0, authorName: author.1)
    }
    let bob = ("u2", "Bob")
    let revs = [
        rev("2026-10-12T03:00:00Z", "r1", "a", nil, 1),
        rev("2026-10-12T03:10:00Z", "r1", "b", nil, "x", bob),
        rev("2026-10-12T03:20:00Z", "r1", "a", 1, 2),
        rev("2026-10-12T05:00:00Z", "r2", "a", nil, 7),
        rev("2026-10-12T16:30:00Z", "r1", "a", 2, 3, bob),
    ]
    do {
        let days = SPVersions.groupVersions(revs, [])
        eq(days[0].day, "2026-10-12", "16:30Z is 23:30 WIB on the 12th")
        let all = days.flatMap { $0.versions }
        eq(all.count, 3, "three bursts")
        eq(all[0].current, true, "newest is current")
        eq(all[1].current, false, "only one current")
        eq(all[2].count, 3, "first burst has 3 edits")
        eq(all[2].at, "2026-10-12T03:20:00Z", "version at = its last edit")
        eq(all[2].from, "2026-10-12T03:00:00Z", "version from = its first edit")
        eq(all[2].authors.map { $0.id }, ["u1", "u2"], "authors, newest editor first")
        eq(SPVersions.groupVersions(revs, [], gapMinutes: 5).flatMap { $0.versions }.count, 5, "a 5-minute gap splits every edit")
        eq(SPVersions.groupVersions([], []).count, 0, "no revisions, no versions")
    }
    do {
        let d = SPVersions.groupVersions([rev("2026-10-12T16:50:00Z", "r1", "a", 1, 2), rev("2026-10-12T17:05:00Z", "r1", "a", 2, 3)], [])
        eq(d.map { $0.day }, ["2026-10-13", "2026-10-12"], "midnight WIB splits the burst")
        eq(SPVersions.dayKey("2026-10-12T17:00:00Z"), "2026-10-13", "dayKey uses +7")
        eq(SPVersions.dayKey("2026-10-12T17:00:00Z", 0), "2026-10-12", "dayKey with offset 0")
        eq(SPVersions.dayKey("2026-10-12T17:00:00.123Z"), "2026-10-13", "fractional seconds")
    }
    do {
        let named = [SPNamedVersion(id: "v1", name: "Before cleanup", at: "2026-10-12T03:10:00Z")]
        let all = SPVersions.groupVersions(revs, named).flatMap { $0.versions }
        eq(all.count, 4, "a named version cuts the burst")
        eq(all[3].name, "Before cleanup", "named version labelled")
        eq(all[3].at, "2026-10-12T03:10:00Z", "named version ends at its time")
        eq(all[2].name, nil, "later version unnamed")
        let renamed = SPVersions.groupVersions(revs, named + [SPNamedVersion(id: "v2", name: "Renamed", at: "2026-10-12T03:10:00Z")]).flatMap { $0.versions }
        eq(renamed[3].name, "Renamed", "latest naming wins")
    }
    do {
        let rows = [SPVersions.RowCells(id: "r1", cells: ["a": 3, "b": "x"]), SPVersions.RowCells(id: "r2", cells: ["a": 7])]
        let s = SPVersions.stateAt(rows, revs, "2026-10-12T03:00:00Z")
        eq(s.rows[0].cells.keys.sorted(), ["a"], "r1 as of 03:00: only a")
        eq(s.rows[0].cells["a"] as? Int, 1, "r1 a = 1")
        eq(s.rows[1].cells.isEmpty, true, "r2 empty at 03:00")
        eq(s.changed.sorted(), ["r1:a", "r1:b", "r2:a"], "changed cells")
        eq(rows[0].cells["a"] as? Int, 3, "input rows untouched")
        let now = SPVersions.stateAt(rows, revs, "2026-10-12T16:30:00Z")
        eq(now.changed.count, 0, "nothing changed at the newest edit")
        eq(now.rows[0].cells["a"] as? Int, 3, "at the newest edit = current")
        let ghost = SPVersions.stateAt(rows, [rev("2026-10-12T20:00:00Z", "gone", "a", 1, 2)], "2026-10-12T00:00:00Z")
        eq(ghost.changed.count, 0, "revisions of deleted rows skipped")
        let back = SPVersions.stateAt([SPVersions.RowCells(id: "r1", cells: ["a": 5])],
                                      [rev("2026-10-12T04:00:00Z", "r1", "a", 5, 6), rev("2026-10-12T05:00:00Z", "r1", "a", 6, 5)], "2026-10-12T03:00:00Z")
        eq(back.changed.count, 0, "edited and put back = not changed")
    }
    do {
        eq(SPVersions.changedSince(revs, "2026-10-12T05:00:00Z"), ["r1:a": "u2"], "changedSince is exclusive")
        let m = SPVersions.changedBetween(revs, "2026-10-12T02:00:00Z", "2026-10-12T03:20:00Z")
        eq(m.keys.sorted(), ["r1:a", "r1:b"], "changedBetween window")
        eq(m["r1:a"], "u1", "latest editor in the window")
        let days = SPVersions.groupVersions(revs, [])
        eq(SPVersions.previousVersionAt(days, "2026-10-12T05:00:00Z"), "2026-10-12T03:20:00Z", "previous version")
        eq(SPVersions.previousVersionAt(days, "2026-10-12T03:20:00Z"), nil, "oldest has no previous")
    }
}

// MARK: - find & replace (sheet-datatools.test.mjs)

func findTests() {
    typealias O = SPFind.Options
    eq(SPFind.textMatches("Apel merah", O(find: "apel")), true, "case-insensitive by default")
    eq(SPFind.textMatches("Apel merah", O(find: "apel", matchCase: true)), false, "match case")
    eq(SPFind.textMatches("Apel merah", O(find: "Apel", entire: true)), false, "entire cell")
    eq(SPFind.textMatches("Apel", O(find: "apel", entire: true)), true, "entire cell, any case")
    eq(SPFind.textMatches("a.b", O(find: ".")), true, "dot is literal without regex")
    eq(SPFind.textMatches("ab", O(find: ".", entire: true)), false, "literal dot doesn't match a letter")
    eq(SPFind.textMatches("2026-10-12", O(find: "^\\d{4}", regex: true)), true, "regular expression")
    eq(SPFind.buildMatcher(O(find: "(", regex: true)) == nil, true, "invalid regex")
    eq(SPFind.buildMatcher(O(find: "")) == nil, true, "empty search")
    func rep(_ s: String, _ o: O) -> String { let r = SPFind.replaceText(s, o); return "\(r.text)|\(r.count)" }
    eq(rep("apel Apel APEL", O(find: "apel", replace: "jeruk")), "jeruk jeruk jeruk|3", "replace all, any case")
    eq(rep("apel Apel", O(find: "apel", replace: "jeruk", matchCase: true)), "jeruk Apel|1", "replace, match case")
    eq(rep("Rp $5", O(find: "$5", replace: "$10")), "Rp $10|1", "dollar signs are literal without regex")
    eq(rep("Santoso, Budi", O(find: "(\\w+), (\\w+)", replace: "$2 $1", regex: true)), "Budi Santoso|1", "regex groups")
    eq(rep("abc", O(find: "x", replace: "y")), "abc|0", "no match")
}

// MARK: - sheet-stats.test.mjs (every check, same order)

func statsTests() {
    let S = SheetStats.self
    func num(_ v: Double) -> SheetStats.Input { SheetStats.Input(value: .number(v), text: SheetJS.numberToString(v)) }
    func txt(_ t: String) -> SheetStats.Input { SheetStats.Input(value: .text(t), text: t) }
    let blank = SheetStats.Input(value: .empty, text: "")
    // The Sheets sample: header "Jumlah", then 12 5 30 2 18 12 7, then empties.
    let col = [txt("Jumlah"), num(12), num(5), num(30), num(2), num(18), num(12), num(7), blank, blank]
    do {
        let s = S.columnStats(col, ignoreRows: 0)
        eq(s.total, 10, "total rows")
        eq(s.empty, 2, "empty cells")
        eq(s.unique, 7, "unique incl. the header text")
        eq(s.numeric, 7, "numeric count")
        eq(s.sum, 86, "sum")
        eq(((s.avg ?? 0) * 1e8).rounded() / 1e8, 12.28571429, "average")
        eq(s.median, 12, "median (odd)")
        eq(s.min, 2, "min")
        eq(s.max, 30, "max")
        eq(s.frequency[0], SheetStats.FrequencyRow(text: "12", count: 2), "most frequent first")
        eq(s.counts.map(\.text), ["2", "5", "7", "12", "18", "30", "Jumlah"], "counts: numbers by value, then text")
    }
    do {
        let s = S.columnStats(col, ignoreRows: 1)
        eq(s.total, 9, "ignore 1 header row")
        eq(s.unique, 6, "header no longer counted")
        eq(S.columnStats(col, ignoreRows: 100).total, 0, "ignore more rows than exist")
        eq(S.columnStats(col, ignoreRows: 100).sum, nil, "no numbers → sum null")
    }
    do {
        let s = S.columnStats([num(1), num(2), num(3), num(4)])
        eq(s.median, 2.5, "median (even)")
        let t = S.columnStats([txt("b"), txt("a"), txt("b"), txt("c"), SheetStats.Input(value: .text(""), text: "")])
        eq(t.frequency.map(\.text), ["b", "a", "c"], "ties in natural order")
        eq(t.empty, 1, "empty string counts as empty")
        eq(t.distribution, [], "no histogram for text")
    }
    do {
        eq(S.histogram([]), [], "empty histogram")
        eq(S.histogram([5, 5, 5]), [SheetStats.Bin(from: 5, to: 5, count: 3)], "one bin when all equal")
        let h = S.histogram([2, 5, 30, 2, 18, 12, 7, 12])
        eq(h.reduce(0) { $0 + $1.count }, 8, "every value lands in a bin")
        eq(h[0].from, 2, "first bin starts at min")
        eq(h[h.count - 1].to, 30, "last bin ends at max")
        eq(h.count, 4, "Sturges: ceil(log2 8 + 1) = 4 bins")
    }
    // Beyond the web file: natural order of text with numbers, any case.
    eq(S.columnStats([txt("item 10"), txt("Item 9"), txt("item 1")]).counts.map(\.text), ["item 1", "Item 9", "item 10"], "numeric-aware, case-blind")
}

// MARK: - named / protected ranges (SheetRangesPanel.tsx rules, SheetGrid.tsx protectedHere)

func rangesTests() {
    let R = SheetRanges.self
    let list = [SheetRanges.Named(id: "nr1", name: "Harga", range: "{a!r1}:{a!r3}")]
    eq(R.validateRangeName("", existing: list), "Enter a name", "empty name")
    eq(R.validateRangeName("  ", existing: list), "Enter a name", "blank name")
    eq(R.validateRangeName("Total_2026.q1", existing: list), nil, "letters, digits, _ and .")
    eq(R.validateRangeName("_x", existing: list), nil, "underscore first")
    eq(R.validateRangeName("Pendapatan", existing: list), nil, "fine")
    eq(R.validateRangeName("1abc", existing: list) != nil, true, "digit first")
    eq(R.validateRangeName("a b", existing: list) != nil, true, "space")
    eq(R.validateRangeName("true", existing: list), "TRUE and FALSE can't be used as names", "TRUE")
    eq(R.validateRangeName("A1", existing: list), "Names can't look like a cell reference, e.g. A1 or R1C1", "A1")
    eq(R.validateRangeName("abc123", existing: list), "Names can't look like a cell reference, e.g. A1 or R1C1", "ABC123")
    eq(R.validateRangeName("r1c1", existing: list), "Names can't look like a cell reference, e.g. A1 or R1C1", "R1C1")
    eq(R.validateRangeName("abcd1", existing: list), nil, "four letters + digits is a name")
    eq(R.validateRangeName("harga", existing: list), "That name is already used by another range", "duplicate, any case")
    eq(R.validateRangeName("harga", existing: list, selfId: "nr1"), nil, "renaming itself")
    eq(R.validateRangeName(String(repeating: "a", count: 251), existing: list), "Names can be at most 250 characters", "too long")
    eq(R.validateRangeName("Pénjualan", existing: list), nil, "unicode letters")
    eq(R.nextName(list, base: "NamedRange"), "NamedRange1", "first free name")
    eq(R.nextName([SheetRanges.Named(id: "x", name: "namedrange1", range: "")], base: "NamedRange"), "NamedRange2", "next free, any case")

    // protections: a 5×5 sheet, ranges by model rect
    let rects: [String: SheetValidation.Rect] = [
        "B2:C3": SheetValidation.Rect(top: 1, bottom: 2, left: 1, right: 2),
        "A1:A1": SheetValidation.Rect(top: 0, bottom: 0, left: 0, right: 0),
        "E1:E5": SheetValidation.Rect(top: 0, bottom: 4, left: 4, right: 4),
    ]
    let rect: (String) -> SheetValidation.Rect? = { rects[$0] }
    let warn = SheetRanges.Protection(id: "p1", range: "B2:C3", sheet: false, mode: "warn", by: "u1")
    let restrict = SheetRanges.Protection(id: "p2", range: "A1:A1", sheet: false, mode: "restrict", editors: ["u1", "u2"], by: "u1")
    let wholeSheet = SheetRanges.Protection(id: "p3", range: nil, sheet: true, except: ["E1:E5"], mode: "restrict", editors: ["u1"], by: "u1")
    func hit(_ l: [SheetRanges.Protection], _ r: Int, _ c: Int, _ me: String, manage: Bool = false) -> SheetRanges.Hit? {
        R.protectedHere(l, row: r, col: c, me: me, canManage: manage, rect: rect)
    }
    eq(hit([warn], 1, 1, "u9"), .warn, "warn inside")
    eq(hit([warn], 3, 3, "u9"), nil, "outside")
    eq(hit([warn], 1, 1, "u1"), .warn, "the owner is warned too")
    eq(hit([restrict], 0, 0, "u9"), .deny, "restricted, not an editor")
    eq(hit([restrict], 0, 0, "u2"), nil, "listed editor")
    eq(hit([restrict], 0, 0, "u9", manage: true), nil, "a lead may edit")
    eq(hit([warn, restrict], 0, 0, "u9"), .deny, "deny wins")
    eq(hit([wholeSheet], 3, 3, "u9"), .deny, "whole sheet")
    eq(hit([wholeSheet], 2, 4, "u9"), nil, "except cells stay open")
    eq(hit([SheetRanges.Protection(id: "p4", range: "gone", sheet: false, mode: "restrict")], 0, 0, "u9"), nil, "a range that no longer resolves protects nothing")
    // stored shape (web finish())
    eq(SheetRanges.Protection.editorsFor(mode: "warn", owner: "u1", custom: true, picked: ["u2"]), nil, "warn has no editors")
    eq(SheetRanges.Protection.editorsFor(mode: "restrict", owner: "u1", custom: false, picked: ["u2"]), ["u1"], "only you")
    eq(SheetRanges.Protection.editorsFor(mode: "restrict", owner: "u1", custom: true, picked: ["u2", "u1", "u3"]), ["u1", "u2", "u3"], "custom, owner first, no repeats")
    let j = wholeSheet.json
    eq(j["sheet"] as? Bool, true, "sheet flag")
    eq(j["range"] == nil, true, "no range on a sheet protection")
    eq(j["except"] as? [String], ["E1:E5"], "except kept")
    eq(SheetRanges.Protection(json: j), wholeSheet, "round trip")
    eq(SheetRanges.Protection(json: ["id": "x", "mode": "restrict"]) == nil, true, "neither a range nor the sheet")
    eq(SheetRanges.Protection(json: ["id": "x", "range": "A1:A1", "mode": "odd"])?.mode, "warn", "unknown mode = warn (server)")
    var described = warn
    described.desc = "  Harga  "
    eq(described.json["desc"] as? String, "Harga", "description trimmed")
}

// MARK: - chart editor save (merged into the chart as it is now)

func chartMergeTests() {
    var initial = SPChartSpec(id: "c1", type: "column", ranges: ["{a!r1}:{b!r5}"], at: ["r": "r1", "c": "c", "dx": 16, "dy": 0], w: 600, h: 371)
    initial.title = "Old"
    // Meanwhile the chart was dragged and resized on the grid (and someone set a subtitle on the web).
    var current = initial.json
    current["at"] = ["r": "r9", "c": "e", "dx": 4, "dy": 2] as [String: Any]
    current["w"] = 420.0
    current["h"] = 300.0
    current["subtitle"] = "Web"
    var edited = initial
    edited.title = "New"
    edited.type = "line"
    edited.legend = "bottom"
    let out = SPChartSpec.mergeEdits(edited, initial: initial, into: current)
    eq(out["title"] as? String, "New", "edited title saved")
    eq(out["type"] as? String, "line", "edited type saved")
    eq(out["legend"] as? String, "bottom", "edited legend saved")
    eq((out["at"] as? [String: Any])?["r"] as? String, "r9", "position from the grid kept")
    eq((out["w"] as? NSNumber)?.doubleValue, 420, "width from the grid kept")
    eq((out["h"] as? NSNumber)?.doubleValue, 300, "height from the grid kept")
    eq(out["subtitle"] as? String, "Web", "a field the editor didn't touch keeps the newer value")
    var cleared = initial
    cleared.title = nil
    eq(SPChartSpec.mergeEdits(cleared, initial: initial, into: initial.json)["title"] == nil, true, "a cleared title is removed")
}

chartTests()
chartMergeTests()
pivotTests()
versionTests()
findTests()
statsTests()
rangesTests()
print("checks \(checks), fails \(fails)")
