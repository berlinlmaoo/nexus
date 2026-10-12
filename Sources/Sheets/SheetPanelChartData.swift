// Charts for the spreadsheet — 1:1 port of the web's lib/sheet-chart.ts (Google Sheets parity, 12 Oct 2026):
// what a chart's ranges mean as categories and series, the chart Sheets picks when you insert one, and the
// maths behind the histogram and waterfall types. Foundation only; tested on Linux (Tests/SheetPanels).
//
// A chart's ranges are stored in id space (like formulas and data validation), so inserting rows or
// columns never detaches it. Several ranges are read side by side, Sheets' "A1:A8,C1:C8".
import Foundation

/// One chart of settings.charts (web sheet-model.ts ChartSpec). Unknown keys survive a round trip.
struct SPChartSpec: Identifiable {
    var id: String
    var type: String
    var ranges: [String]
    /// Anchor cell (row id, column id) and offset; the web places the chart there.
    var at: [String: Any]
    var w: Double
    var h: Double
    var title: String?
    var subtitle: String?
    var headers: Bool?
    var labels: Bool?
    var transpose: Bool?
    /// "sum" | "avg" | "count" | "min" | "max"
    var aggregate: String?
    var colors: [String]?
    var bg: String?
    /// "top" | "bottom" | "right" | "left" | "none"
    var legend: String?
    var xTitle: String?
    var yTitle: String?
    var dataLabels: Bool?
    var gridlines: Bool?
    var yMin: Double?
    var yMax: Double?
    var key: String?
    var baseline: String?
    private var raw: [String: Any] = [:]

    init(id: String, type: String, ranges: [String], at: [String: Any] = [:], w: Double = 600, h: Double = 371) {
        self.id = id; self.type = type; self.ranges = ranges; self.at = at; self.w = w; self.h = h
    }

    init?(json o: [String: Any]) {
        guard let id = o["id"] as? String else { return nil }
        raw = o
        self.id = id
        type = o["type"] as? String ?? "column"
        ranges = o["ranges"] as? [String] ?? []
        at = o["at"] as? [String: Any] ?? [:]
        w = (o["w"] as? NSNumber)?.doubleValue ?? 600
        h = (o["h"] as? NSNumber)?.doubleValue ?? 371
        title = o["title"] as? String
        subtitle = o["subtitle"] as? String
        headers = SPChartSpec.flag(o["headers"])
        labels = SPChartSpec.flag(o["labels"])
        transpose = SPChartSpec.flag(o["transpose"])
        aggregate = o["aggregate"] as? String
        colors = o["colors"] as? [String]
        bg = o["bg"] as? String
        legend = o["legend"] as? String
        xTitle = o["xTitle"] as? String
        yTitle = o["yTitle"] as? String
        dataLabels = SPChartSpec.flag(o["dataLabels"])
        gridlines = SPChartSpec.flag(o["gridlines"])
        yMin = SPChartSpec.number(o["yMin"])
        yMax = SPChartSpec.number(o["yMax"])
        key = o["key"] as? String
        baseline = o["baseline"] as? String
    }

    private static func flag(_ v: Any?) -> Bool? {
        if case .bool(let b) = SheetFormula.kind(v) { return b }
        return nil
    }

    private static func number(_ v: Any?) -> Double? {
        if case .number(let n) = SheetFormula.kind(v) { return n }
        return nil
    }

    var json: [String: Any] {
        var o = raw
        o["id"] = id
        o["type"] = type
        o["ranges"] = ranges
        o["at"] = at
        o["w"] = w
        o["h"] = h
        func put(_ k: String, _ v: Any?) { if let v { o[k] = v } else { o.removeValue(forKey: k) } }
        put("title", title.flatMap { $0.isEmpty ? nil : $0 })
        put("subtitle", subtitle.flatMap { $0.isEmpty ? nil : $0 })
        put("headers", headers)
        put("labels", labels)
        put("transpose", transpose)
        put("aggregate", aggregate)
        put("colors", colors)
        put("bg", bg)
        put("legend", legend)
        put("xTitle", xTitle.flatMap { $0.isEmpty ? nil : $0 })
        put("yTitle", yTitle.flatMap { $0.isEmpty ? nil : $0 })
        put("dataLabels", dataLabels)
        put("gridlines", gridlines)
        put("yMin", yMin)
        put("yMax", yMax)
        put("key", key)
        put("baseline", baseline)
        return o
    }
}

enum SPChart {
    typealias F = SheetFormula
    typealias Rect = SheetValidation.Rect

    /// Sheets' default series colours, in order.
    static let SERIES_COLORS = [
        "#4285f4", "#ea4335", "#fbbc04", "#34a853", "#ff6d01", "#46bdc6",
        "#7baaf7", "#f07b72", "#fcd04f", "#71c287", "#ff994d", "#7ed1d7",
    ]

    /// Colour of series `i`: the chart's own, else the sheet theme's accents, else Sheets' defaults.
    static func seriesColor(_ i: Int, _ colors: [String]?, _ theme: [String]? = nil) -> String {
        if let colors, i < colors.count, !colors[i].isEmpty { return colors[i] }
        if let theme, !theme.isEmpty { return theme[i % theme.count] }
        return SERIES_COLORS[i % SERIES_COLORS.count]
    }

    enum Kind { case num, date, text, bool, error, empty }
    struct GCell {
        var v: SheetCellValue
        var kind: Kind
        var text: String
    }
    static let EMPTY = GCell(v: .empty, kind: .empty, text: "")

    static let MAX_ROWS = 2000
    static let MAX_COLS = 200

    static func readCell(_ data: SheetData, _ engine: SheetEngine, _ r: Int, _ c: Int) -> GCell {
        guard r >= 0, c >= 0, r < data.shape.rowIds.count, c < data.shape.columnIds.count else { return EMPTY }
        let rowId = data.shape.rowIds[r], colId = data.shape.columnIds[c]
        let v = engine.value(rowId, colId)
        if v == .empty || v == .text("") { return EMPTY }
        if F.isError(v) { return GCell(v: v, kind: .error, text: v.text ?? "") }
        let type = data.types?[colId] ?? "text"
        let nf = engine.format(rowId, colId)
        let text = F.formatResult(type, v, nf)
        switch v {
        case .number:
            return GCell(v: v, kind: nf == .date || type == "date" ? .date : .num, text: text)
        case .bool:
            return GCell(v: v, kind: .bool, text: text)
        case .text(let s):
            if nf == .date, let serial = F.isoToSerial(s) { return GCell(v: .number(serial), kind: .date, text: text) }
            return GCell(v: v, kind: .text, text: text)
        case .empty:
            return EMPTY
        }
    }

    struct Matrix {
        var m: [[GCell]]
        var colSrc: [Int]
        var rowSrc: [Int]
    }

    /// The ranges read side by side into one matrix (rows × columns), trailing empty rows dropped.
    static func matrixOf(_ rects: [Rect], _ data: SheetData, _ engine: SheetEngine) -> Matrix {
        let height = min(MAX_ROWS, max(0, rects.map { $0.bottom - $0.top + 1 }.max() ?? 0))
        var cols: [(src: Int, rect: Rect)] = []
        outer: for rect in rects {
            var c = rect.left
            while c <= rect.right {
                if cols.count >= MAX_COLS { break outer }
                cols.append((c, rect))
                c += 1
            }
        }
        var m: [[GCell]] = []
        for i in 0..<height {
            m.append(cols.map { col in col.rect.top + i <= col.rect.bottom ? readCell(data, engine, col.rect.top + i, col.src) : EMPTY })
        }
        while let last = m.last, last.allSatisfy({ $0.kind == .empty }) { m.removeLast() }
        let top = rects.first?.top ?? 0
        return Matrix(m: m, colSrc: cols.map { $0.src }, rowSrc: m.indices.map { top + $0 })
    }

    static func transposeM(_ m: [[GCell]]) -> [[GCell]] {
        guard let first = m.first else { return [] }
        return first.indices.map { j in m.map { $0[j] } }
    }

    static func isNumeric(_ k: Kind) -> Bool { k == .num || k == .date }

    /// Sheets' guess: row 1 is a header when it is all text while the rows below hold numbers.
    static func autoHeaders(_ m: [[GCell]]) -> Bool {
        if m.count < 2 { return false }
        let first = m[0].filter { $0.kind != .empty }
        if first.isEmpty || !first.allSatisfy({ $0.kind == .text }) { return false }
        return m.dropFirst().contains { row in row.contains { isNumeric($0.kind) } }
    }

    /// Column A is the labels (x-axis) when it holds text or dates and there's something to plot beside it.
    static func autoLabels(_ m: [[GCell]], _ headers: Bool) -> Bool {
        guard let first = m.first, first.count >= 2 else { return false }
        let body = m.dropFirst(headers ? 1 : 0).map { $0[0] }.filter { $0.kind != .empty }
        return !body.isEmpty && body.allSatisfy { $0.kind == .text || $0.kind == .date || $0.kind == .bool }
    }

    struct Series: Equatable {
        var name: String
        var values: [Double?]
        /// A sheet column index, or a sheet row index when rows/columns are switched.
        var source: Int
    }

    struct ChartData: Equatable {
        var categories: [String] = []
        var series: [Series] = []
        var headerRow = false
        var labels = false
        /// "text" | "date" | "num" | "none"
        var xKind = "none"
        var xValues: [Double?] = []
        var xName = ""
        var xSource = -1
        var empty = true
    }

    static func rectsOf(_ ranges: [String], _ shape: SheetShape) -> [Rect] {
        ranges.compactMap { SheetValidation.rangeRect($0, shape) }
    }

    static func aggregateValues(_ fn: String, _ values: [Double]) -> Double? {
        if fn == "count" { return Double(values.count) }
        if values.isEmpty { return nil }
        switch fn {
        case "sum": return values.reduce(0, +)
        case "avg": return values.reduce(0, +) / Double(values.count)
        case "min": return values.min()
        case "max": return values.max()
        default: return nil
        }
    }

    private static func numberOf(_ c: GCell) -> Double? {
        guard isNumeric(c.kind) else { return nil }
        return c.v.number
    }

    /// The categories and series a chart draws from its ranges and Setup options.
    static func chartData(ranges: [String], headers: Bool? = nil, labels labelsOpt: Bool? = nil, transpose: Bool? = nil,
                          aggregate: String? = nil, data: SheetData, engine: SheetEngine) -> ChartData {
        let rects = rectsOf(ranges, data.shape)
        if rects.isEmpty { return ChartData() }
        let base = matrixOf(rects, data, engine)
        if base.m.isEmpty { return ChartData() }
        let switched = transpose == true
        let m = switched ? transposeM(base.m) : base.m
        let colSrc = switched ? base.rowSrc : base.colSrc
        guard let row0 = m.first, !row0.isEmpty else { return ChartData() }

        let headerRow = headers ?? autoHeaders(m)
        let labels = labelsOpt ?? autoLabels(m, headerRow)
        let body = Array(m.dropFirst(headerRow ? 1 : 0))
        func nameOf(_ j: Int) -> String {
            let h = headerRow ? (j < m[0].count ? m[0][j].text : "") : ""
            if !h.isEmpty { return h }
            return switched ? String(colSrc[j] + 1) : F.colLetter(colSrc[j])
        }

        let xCells = labels ? body.map { $0[0] } : []
        let xNonEmpty = xCells.filter { $0.kind != .empty }
        let xKind: String
        if !labels { xKind = "none" }
        else if !xNonEmpty.isEmpty && xNonEmpty.allSatisfy({ $0.kind == .date }) { xKind = "date" }
        else if !xNonEmpty.isEmpty && xNonEmpty.allSatisfy({ $0.kind == .num }) { xKind = "num" }
        else { xKind = "text" }
        var categories = labels ? xCells.map { $0.text } : body.indices.map { String($0 + 1) }
        var xValues: [Double?] = labels ? xCells.map { numberOf($0) } : body.indices.map { Double($0 + 1) }

        var series: [Series] = []
        var j = labels ? 1 : 0
        while j < row0.count {
            let cells = body.map { $0[j] }
            if cells.contains(where: { isNumeric($0.kind) }) {
                series.append(Series(name: nameOf(j), values: cells.map { numberOf($0) }, source: colSrc[j]))
            }
            j += 1
        }

        if let fn = aggregate, labels {
            var order: [String] = []
            var idx: [String: [Int]] = [:]
            for (i, c) in categories.enumerated() {
                if idx[c] == nil { idx[c] = []; order.append(c) }
                idx[c]?.append(i)
            }
            for k in series.indices {
                let vals = series[k].values
                series[k].values = order.map { c in aggregateValues(fn, (idx[c] ?? []).compactMap { vals[$0] }) }
            }
            xValues = order.map { c in xValues[idx[c]![0]] }
            categories = order
        }

        return ChartData(categories: categories, series: series, headerRow: headerRow, labels: labels, xKind: xKind,
                         xValues: xValues, xName: labels ? nameOf(0) : "", xSource: labels ? colSrc[0] : -1,
                         empty: series.isEmpty || categories.isEmpty)
    }

    static func chartData(_ spec: SPChartSpec, data: SheetData, engine: SheetEngine) -> ChartData {
        chartData(ranges: spec.ranges, headers: spec.headers, labels: spec.labels, transpose: spec.transpose,
                  aggregate: spec.aggregate, data: data, engine: engine)
    }

    /// What Insert ▸ Chart picks for a selection (Sheets' recommendation).
    static func defaultChart(_ rect: Rect, _ data: SheetData, _ engine: SheetEngine) -> (type: String, headers: Bool, labels: Bool) {
        if rect.top == rect.bottom && rect.left == rect.right { return ("scorecard", false, false) }
        let m = matrixOf([rect], data, engine).m
        let headers = autoHeaders(m)
        let body = Array(m.dropFirst(headers ? 1 : 0))
        let width = m.first?.count ?? 0
        let firstCol = body.compactMap { $0.first }.filter { $0.kind != .empty }
        if width >= 2 && !firstCol.isEmpty && firstCol.allSatisfy({ $0.kind == .num }) { return ("scatter", headers, true) }
        let labels = autoLabels(m, headers)
        var seriesCols: [Int] = []
        var j = labels ? 1 : 0
        while j < width {
            if body.contains(where: { isNumeric($0[j].kind) }) { seriesCols.append(j) }
            j += 1
        }
        if labels && !firstCol.isEmpty && firstCol.allSatisfy({ $0.kind == .date }) && body.count >= 10 { return ("line", headers, labels) }
        if labels && seriesCols.count == 1 && body.count >= 2 && body.count <= 8 {
            let vals = body.map { $0[seriesCols[0]] }
            let names = body.map { $0[0].text }
            let allPositive = vals.allSatisfy { $0.kind == .num && ($0.v.number ?? 0) > 0 }
            // Repeated labels (two "Apel" rows) read as separate bars, not slices — Sheets keeps a column chart.
            if allPositive && Set(names).count == names.count { return ("pie", headers, labels) }
        }
        return ("column", headers, labels)
    }

    struct HistogramBin: Equatable {
        var from: Double
        var to: Double
        var count: Int
    }

    /// Equal-width buckets over the numbers (Sturges' rule unless a count is given); the last includes the max.
    static func histogramBins(_ values: [Double?], _ bucketCount: Int? = nil) -> [HistogramBin] {
        let xs = values.compactMap { $0 }.filter { $0.isFinite }
        guard let lo = xs.min(), let hi = xs.max() else { return [] }
        if lo == hi { return [HistogramBin(from: lo, to: hi, count: xs.count)] }
        let sturges: Double = log2(Double(xs.count)).rounded(.up) + 1
        let guess: Double = bucketCount.map { Double($0) } ?? sturges
        let k: Int = max(1, min(100, Int(guess.rounded(.toNearestOrAwayFromZero))))
        let width: Double = (hi - lo) / Double(k)
        var bins: [HistogramBin] = []
        for i in 0..<k {
            let from: Double = lo + Double(i) * width
            let to: Double = i == k - 1 ? hi : lo + Double(i + 1) * width
            bins.append(HistogramBin(from: from, to: to, count: 0))
        }
        for v in xs {
            let slot: Double = ((v - lo) / width).rounded(.down)
            bins[min(k - 1, Int(slot))].count += 1
        }
        return bins
    }

    struct WaterfallStep: Equatable {
        var start: Double
        var end: Double
        var value: Double
        /// "up" | "down" | "total"
        var kind: String
    }

    /// Running-total bars: each value rises or falls from where the last ended; a final total bar from 0.
    static func waterfallSteps(_ values: [Double?], total: Bool = true) -> [WaterfallStep] {
        var out: [WaterfallStep] = []
        var run = 0.0
        for raw in values {
            let v = (raw?.isFinite ?? false) ? raw! : 0
            out.append(WaterfallStep(start: run, end: run + v, value: v, kind: v < 0 ? "down" : "up"))
            run += v
        }
        if !out.isEmpty && total { out.append(WaterfallStep(start: 0, end: run, value: run, kind: "total")) }
        return out
    }

    /// A scorecard's key value (the `key` cell, else the first series summed) and its baseline.
    static func scorecardValues(_ spec: SPChartSpec, _ data: SheetData, _ engine: SheetEngine)
        -> (key: Double?, keyText: String, baseline: Double?, baselineText: String) {
        func cellOf(_ stored: String?) -> GCell? {
            guard let stored, let rc = SheetValidation.rangeRect(stored, data.shape) else { return nil }
            return readCell(data, engine, rc.top, rc.left)
        }
        func toNum(_ c: GCell?) -> Double? { c.flatMap { numberOf($0) } }
        var keyCell = cellOf(spec.key)
        if keyCell == nil {
            let rects = rectsOf(spec.ranges, data.shape)
            if rects.count == 1, rects[0].top == rects[0].bottom, rects[0].left == rects[0].right {
                keyCell = readCell(data, engine, rects[0].top, rects[0].left)
            }
        }
        var key = toNum(keyCell)
        var keyText = keyCell?.text ?? ""
        if keyCell == nil {
            let cd = chartData(spec, data: data, engine: engine)
            let vals = cd.series.first?.values.compactMap { $0 } ?? []
            key = vals.isEmpty ? nil : vals.reduce(0, +)
            keyText = key.map { F.formatGrouped($0) } ?? ""
        }
        let b = cellOf(spec.baseline)
        return (key, keyText, toNum(b), b?.text ?? "")
    }

    // MARK: editing ranges from the chart editor

    /// Ranges as typed: "A1:C8, E1:E8".
    static func rangesToA1(_ ranges: [String], _ shape: SheetShape) -> String {
        ranges.map { SheetValidation.rangeToA1($0, shape) }.joined(separator: ", ")
    }

    /// "Sheet1!A1:C8, E1:E8" → stored ranges; nil when any part can't be read.
    static func rangesFromA1(_ text: String, _ shape: SheetShape) -> [String]? {
        let parts = text.split(whereSeparator: { $0 == "," || $0 == ";" })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        if parts.isEmpty { return nil }
        var out: [String] = []
        for p in parts {
            guard let s = SheetValidation.rangeFromA1(p, shape) else { return nil }
            out.append(s)
        }
        return out
    }

    private static func rangeParts(_ stored: String) -> [String?]? {
        SheetJS.match(SheetJS.re(SheetValidation.RANGE), stored)
    }

    /// "Add series": another column beside the data, over the same rows as the first range.
    static func addSeriesColumn(_ ranges: [String], _ colIndex: Int, _ shape: SheetShape) -> [String] {
        guard colIndex >= 0, colIndex < shape.columnIds.count else { return ranges }
        let colId = shape.columnIds[colIndex]
        if let first = ranges.first, let m = rangeParts(first), m[2] == "*" || m[4] == "*" {
            return ranges + ["{\(colId)!*}:{\(colId)!*}"]
        }
        let rc = ranges.first.flatMap { SheetValidation.rangeRect($0, shape) }
        let ti = rc?.top ?? 0, bi = rc?.bottom ?? shape.rowIds.count - 1
        guard ti >= 0, bi >= 0, ti < shape.rowIds.count, bi < shape.rowIds.count else { return ranges }
        return ranges + ["{\(colId)!\(shape.rowIds[ti])}:{\(colId)!\(shape.rowIds[bi])}"]
    }

    /// Remove one series: cut its column (or its row, when rows/columns are switched) out of every range
    /// that holds it, splitting a range in two when the series sits in the middle.
    static func removeSeriesSource(_ ranges: [String], _ source: Int, _ shape: SheetShape, byRow: Bool = false) -> [String] {
        var out: [String] = []
        for stored in ranges {
            guard let m = rangeParts(stored), let rc = SheetValidation.rangeRect(stored, shape) else { out.append(stored); continue }
            let lo = byRow ? rc.top : rc.left, hi = byRow ? rc.bottom : rc.right
            if source < lo || source > hi { out.append(stored); continue }
            let whole = m[2] == "*" || m[4] == "*"
            func make(_ a: Int, _ b: Int) -> String {
                if byRow {
                    let c1 = shape.columnIds[rc.left], c2 = shape.columnIds[rc.right]
                    return "{\(c1)!\(shape.rowIds[a])}:{\(c2)!\(shape.rowIds[b])}"
                }
                let c1 = shape.columnIds[a], c2 = shape.columnIds[b]
                return whole ? "{\(c1)!*}:{\(c2)!*}" : "{\(c1)!\(shape.rowIds[rc.top])}:{\(c2)!\(shape.rowIds[rc.bottom])}"
            }
            if source > lo { out.append(make(lo, source - 1)) }
            if source < hi { out.append(make(source + 1, hi)) }
        }
        return out
    }

    // MARK: type families (editor + renderer)

    static let STACK_FAMILY: [(String, [String])] = [
        ("column", ["column", "columnStacked", "column100"]),
        ("bar", ["bar", "barStacked", "bar100"]),
        ("area", ["area", "areaStacked", "area100"]),
    ]

    static func stackFamily(_ type: String) -> String? {
        STACK_FAMILY.first { $0.1.contains(type) }?.0
    }

    /// "none" | "standard" | "percent"
    static func stackingOf(_ type: String) -> String {
        guard let fam = STACK_FAMILY.first(where: { $0.1.contains(type) }), let i = fam.1.firstIndex(of: type) else { return "none" }
        return i == 1 ? "standard" : i == 2 ? "percent" : "none"
    }

    static func withStacking(_ type: String, _ stacking: String) -> String {
        guard let fam = STACK_FAMILY.first(where: { $0.1.contains(type) }) else { return type }
        return fam.1[stacking == "standard" ? 1 : stacking == "percent" ? 2 : 0]
    }

    /// Every chart type with its Sheets name, in the picker's groups (web ChartEditor CHART_GROUPS).
    static let TYPE_GROUPS: [(group: String, types: [(type: String, label: String)])] = [
        ("Line", [("line", "Line chart"), ("lineSmooth", "Smooth line chart")]),
        ("Combo", [("combo", "Combo chart")]),
        ("Area", [("area", "Area chart"), ("areaStacked", "Stacked area chart"), ("area100", "100% stacked area chart"), ("areaStepped", "Stepped area chart")]),
        ("Column", [("column", "Column chart"), ("columnStacked", "Stacked column chart"), ("column100", "100% stacked column chart")]),
        ("Bar", [("bar", "Bar chart"), ("barStacked", "Stacked bar chart"), ("bar100", "100% stacked bar chart")]),
        ("Pie", [("pie", "Pie chart"), ("donut", "Doughnut chart")]),
        ("Scatter", [("scatter", "Scatter chart"), ("bubble", "Bubble chart")]),
        ("Other", [("waterfall", "Waterfall chart"), ("histogram", "Histogram chart"), ("radar", "Radar chart"), ("scorecard", "Scorecard chart"), ("table", "Table chart")]),
    ]

    static func typeLabel(_ type: String) -> String {
        for g in TYPE_GROUPS { if let t = g.types.first(where: { $0.type == type }) { return t.label } }
        return "Chart"
    }

    /// A new id like the web's newId(prefix).
    static func newId(_ prefix: String) -> String {
        let chars = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        return prefix + "_" + String((0..<8).map { _ in chars[Int.random(in: 0..<chars.count)] })
    }
}
