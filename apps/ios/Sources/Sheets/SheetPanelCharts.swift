import SwiftUI
import Charts

// Insert ▸ Chart and the sheet's charts (web SheetChart.tsx ChartView + ChartEditor.tsx). Charts made on the
// web (settings.charts) are drawn here with Swift Charts from the same data shaping (SheetPanelChartData,
// a port of lib/sheet-chart.ts); the web's floating placement on the grid is kept untouched (`at`, `w`, `h`).

// MARK: - one chart

/// One point of a cartesian chart. `x` is unique per category (repeated labels stay separate bars, as on the
/// web) and `label` is what the axis shows.
struct SPChartPoint: Identifiable {
    let id: Int
    let x: String
    let series: String
    let seriesIndex: Int
    let value: Double
}

enum SPChartFmt {
    static func num(_ v: Double) -> String { SheetFormula.formatGrouped(v, 2) }
    static func pct(_ v: Double) -> String { "\(SheetFormula.formatGrouped(v * 100, 1))%" }
}

/// A chart drawn from the sheet: title, subtitle and the plot, on the chart's background.
struct SPChartView: View {
    let spec: SPChartSpec
    let data: SheetData
    let engine: SheetEngine
    /// Drawn into an image (ImageRenderer draws no scroll views): the table chart lays out flat.
    var forExport = false

    var body: some View {
        let cd = SPChart.chartData(spec, data: data, engine: engine)
        VStack(alignment: .leading, spacing: 4) {
            if let t = spec.title, !t.isEmpty { Text(t).font(NXFont.text(15, .medium)).lineLimit(1) }
            if let s = spec.subtitle, !s.isEmpty { Text(s).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1) }
            SPChartBody(spec: spec, cd: cd, data: data, engine: engine, forExport: forExport)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(10)
        .background(spec.bg.map { SPColors.color($0) } ?? NX.card)
    }
}

private struct SPChartBody: View {
    let spec: SPChartSpec
    let cd: SPChart.ChartData
    let data: SheetData
    let engine: SheetEngine
    let forExport: Bool

    var body: some View {
        if spec.type == "scorecard" {
            SPScorecard(spec: spec, data: data, engine: engine)
        } else if cd.empty {
            placeholder
        } else if spec.type == "table" {
            SPTableChart(cd: cd, scrolls: !forExport)
        } else if spec.type == "radar" {
            SPRadarChart(cd: cd, colors: colors, grid: spec.gridlines != false)
        } else {
            SPPlot(spec: spec, cd: cd, colors: colors)
        }
    }

    private var colors: [Color] { (0..<max(cd.series.count, cd.categories.count, 1)).map { SPColors.color(SPChart.seriesColor($0, spec.colors)) } }

    private var placeholder: some View {
        Text(T("Add a series to start visualising your data"))
            .font(NXFont.text(15)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct SPScorecard: View {
    let spec: SPChartSpec
    let data: SheetData
    let engine: SheetEngine

    var body: some View {
        let v = SPChart.scorecardValues(spec, data, engine)
        let delta: Double? = (v.key != nil && v.baseline != nil) ? v.key! - v.baseline! : nil
        let pct: Double? = (delta != nil && (v.baseline ?? 0) != 0) ? delta! / abs(v.baseline!) : nil
        let up = (delta ?? 0) >= 0
        VStack(spacing: 4) {
            if v.key == nil && v.keyText.isEmpty {
                Text(T("Add a series to start visualising your data")).font(NXFont.text(15)).foregroundStyle(NX.mutedFg)
            } else {
                Text(v.keyText).font(.system(size: 40, weight: .regular)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.4)
                if let delta {
                    let amount: String = pct.map { SheetFormula.formatGrouped(abs($0) * 100, 1) + "%" } ?? SPChartFmt.num(abs(delta))
                    let deltaText: String = (up ? "▲ " : "▼ ") + amount
                    Text(deltaText)
                        .font(NXFont.text(13, .medium))
                        .foregroundStyle(up ? Color(red: 0.07, green: 0.45, blue: 0.2) : Color(red: 0.65, green: 0.05, blue: 0.05))
                }
                if let x = spec.xTitle, !x.isEmpty { Text(x).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct SPTableChart: View {
    let cd: SPChart.ChartData
    let scrolls: Bool

    var body: some View {
        if scrolls {
            ScrollView([.vertical, .horizontal]) { table }
        } else {
            table.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).clipped()
        }
    }

    private var table: some View {
        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 4) {
            GridRow {
                if cd.labels { Text(cd.xName.isEmpty ? T("Label") : cd.xName).fontWeight(.semibold) }
                ForEach(cd.series.indices, id: \.self) { j in Text(cd.series[j].name).fontWeight(.semibold).gridColumnAlignment(.trailing) }
            }
            Divider()
            ForEach(cd.categories.prefix(500).indices, id: \.self) { i in
                GridRow {
                    if cd.labels { Text(cd.categories[i]) }
                    ForEach(cd.series.indices, id: \.self) { j in
                        Text(cd.series[j].values[i].map(SPChartFmt.num) ?? "").monospacedDigit()
                    }
                }
            }
        }
        .font(NXFont.text(12))
        .padding(4)
    }
}

/// Radar: one polygon per series over the categories (Swift Charts has no polar marks).
private struct SPRadarChart: View {
    let cd: SPChart.ChartData
    let colors: [Color]
    let grid: Bool

    var body: some View {
        Canvas { ctx, size in
            let n = cd.categories.count
            guard n >= 3 else { return }
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let radius = max(10, min(size.width, size.height) / 2 - 24)
            let top = cd.series.flatMap { $0.values.compactMap { $0 } }.max() ?? 1
            let scale = top > 0 ? top : 1
            func point(_ i: Int, _ r: CGFloat) -> CGPoint {
                let a = Double(i) / Double(n) * 2 * .pi - .pi / 2
                return CGPoint(x: center.x + r * CGFloat(cos(a)), y: center.y + r * CGFloat(sin(a)))
            }
            if grid {
                for ring in 1...4 {
                    var p = Path()
                    for i in 0..<n {
                        let q = point(i, radius * CGFloat(ring) / 4)
                        if i == 0 { p.move(to: q) } else { p.addLine(to: q) }
                    }
                    p.closeSubpath()
                    ctx.stroke(p, with: .color(.gray.opacity(0.3)), lineWidth: 0.5)
                }
            }
            for (k, s) in cd.series.enumerated() {
                var p = Path()
                for i in 0..<n {
                    let v = i < s.values.count ? (s.values[i] ?? 0) : 0
                    let q = point(i, radius * CGFloat(max(0, v) / scale))
                    if i == 0 { p.move(to: q) } else { p.addLine(to: q) }
                }
                p.closeSubpath()
                let c = k < colors.count ? colors[k] : .blue
                ctx.fill(p, with: .color(c.opacity(0.2)))
                ctx.stroke(p, with: .color(c), lineWidth: 1.5)
            }
            for i in 0..<n {
                let q = point(i, radius + 12)
                ctx.draw(Text(cd.categories[i]).font(.system(size: 9)).foregroundColor(.secondary), at: q)
            }
        }
    }
}

/// Every cartesian / pie type through Swift Charts.
private struct SPPlot: View {
    let spec: SPChartSpec
    let cd: SPChart.ChartData
    let colors: [Color]

    /// Unique x keys: a repeated label gets zero-width spaces so it stays its own category.
    private var xKeys: [String] {
        var seen: [String: Int] = [:]
        return cd.categories.map { c in
            let n = seen[c, default: 0]
            seen[c] = n + 1
            return n == 0 ? c : c + String(repeating: "\u{200B}", count: n)
        }
    }

    private var seriesNames: [String] {
        var seen: [String: Int] = [:]
        return cd.series.map { s in
            let n = seen[s.name, default: 0]
            seen[s.name] = n + 1
            return n == 0 ? s.name : s.name + String(repeating: "\u{200B}", count: n)
        }
    }

    private var points: [SPChartPoint] {
        let keys = xKeys, names = seriesNames
        var out: [SPChartPoint] = []
        for (k, s) in cd.series.enumerated() {
            for (i, v) in s.values.enumerated() where i < keys.count {
                if let v { out.append(SPChartPoint(id: out.count, x: keys[i], series: names[k], seriesIndex: k, value: v)) }
            }
        }
        return out
    }

    private var legendPosition: String {
        if let l = spec.legend { return l }
        let pie = spec.type == "pie" || spec.type == "donut"
        if pie { return "right" }
        return cd.series.count > 1 && spec.type != "histogram" && spec.type != "waterfall" ? "top" : "none"
    }

    var body: some View {
        chart
            .modifier(SPLegend(position: legendPosition))
            .modifier(SPAxisTitles(x: spec.xTitle, y: spec.yTitle))
            .modifier(SPYDomain(yMin: spec.yMin, yMax: spec.yMax, values: points.map { $0.value }, enabled: spec.type != "pie" && spec.type != "donut"))
            .modifier(SPGrid(on: spec.gridlines != false))
    }

    @ViewBuilder private var chart: some View {
        switch spec.type {
        case "bar", "barStacked", "bar100":
            SPBars(points: points, names: seriesNames, colors: colors, horizontal: true, stacking: SPChart.stackingOf(spec.type), labels: spec.dataLabels == true)
        case "line", "lineSmooth":
            SPLines(points: points, names: seriesNames, colors: colors, smooth: spec.type == "lineSmooth", labels: spec.dataLabels == true)
        case "area", "areaStacked", "area100", "areaStepped":
            SPAreas(points: points, names: seriesNames, colors: colors, stacking: SPChart.stackingOf(spec.type), stepped: spec.type == "areaStepped")
        case "pie", "donut":
            SPPie(cd: cd, keys: xKeys, colors: (0..<max(cd.categories.count, 1)).map { SPColors.color(SPChart.seriesColor($0, spec.colors)) },
                  donut: spec.type == "donut", labels: spec.dataLabels != false)
        case "scatter", "bubble":
            SPScatter(cd: cd, names: seriesNames, colors: colors, bubble: spec.type == "bubble")
        case "combo":
            SPCombo(points: points, names: seriesNames, colors: colors, labels: spec.dataLabels == true)
        case "histogram":
            SPHistogram(cd: cd, color: colors.first ?? .blue, labels: spec.dataLabels == true)
        case "waterfall":
            SPWaterfall(cd: cd, keys: xKeys, up: colors.first ?? .blue,
                        down: SPColors.color(spec.colors.flatMap { $0.count > 1 ? $0[1] : nil } ?? "#ea4335"))
        default:
            SPBars(points: points, names: seriesNames, colors: colors, horizontal: false, stacking: SPChart.stackingOf(spec.type), labels: spec.dataLabels == true)
        }
    }
}

private struct SPLegend: ViewModifier {
    let position: String
    @ViewBuilder func body(content: Content) -> some View {
        switch position {
        case "none": content.chartLegend(.hidden)
        case "bottom": content.chartLegend(position: .bottom)
        case "left": content.chartLegend(position: .leading)
        case "right": content.chartLegend(position: .trailing)
        default: content.chartLegend(position: .top)
        }
    }
}

private struct SPAxisTitles: ViewModifier {
    let x: String?
    let y: String?
    @ViewBuilder func body(content: Content) -> some View {
        let xs = x ?? "", ys = y ?? ""
        if !xs.isEmpty && !ys.isEmpty {
            content.chartXAxisLabel(xs).chartYAxisLabel(ys)
        } else if !xs.isEmpty {
            content.chartXAxisLabel(xs)
        } else if !ys.isEmpty {
            content.chartYAxisLabel(ys)
        } else {
            content
        }
    }
}

private struct SPYDomain: ViewModifier {
    let yMin: Double?
    let yMax: Double?
    let values: [Double]
    let enabled: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if enabled && (yMin != nil || yMax != nil) {
            let lo = yMin ?? min(0, values.min() ?? 0)
            let hi = yMax ?? max(lo + 1, values.max() ?? lo + 1)
            content.chartYScale(domain: lo...max(hi, lo + 0.000001))
        } else {
            content
        }
    }
}

private struct SPGrid: ViewModifier {
    let on: Bool
    @ViewBuilder func body(content: Content) -> some View {
        content.chartYAxis {
            AxisMarks { _ in
                AxisGridLine().foregroundStyle(on ? Color.gray.opacity(0.3) : Color.clear)
                AxisValueLabel()
            }
        }
    }
}

private struct SPBars: View {
    let points: [SPChartPoint]
    let names: [String]
    let colors: [Color]
    let horizontal: Bool
    /// "none" | "standard" | "percent"
    let stacking: String
    let labels: Bool

    var body: some View {
        Chart(points) { p in
            if horizontal {
                if stacking == "none" {
                    BarMark(x: .value("Value", p.value), y: .value("Category", p.x))
                        .foregroundStyle(by: .value("Series", p.series))
                        .position(by: .value("Series", p.series), axis: .vertical)
                        .annotation(position: .trailing) { label(p.value) }
                } else {
                    BarMark(x: .value("Value", p.value), y: .value("Category", p.x), stacking: stacking == "percent" ? .normalized : .standard)
                        .foregroundStyle(by: .value("Series", p.series))
                }
            } else {
                if stacking == "none" {
                    BarMark(x: .value("Category", p.x), y: .value("Value", p.value))
                        .foregroundStyle(by: .value("Series", p.series))
                        .position(by: .value("Series", p.series))
                        .annotation(position: .top) { label(p.value) }
                } else {
                    BarMark(x: .value("Category", p.x), y: .value("Value", p.value), stacking: stacking == "percent" ? .normalized : .standard)
                        .foregroundStyle(by: .value("Series", p.series))
                }
            }
        }
        .chartForegroundStyleScale(domain: names, range: Array(colors.prefix(max(names.count, 1))))
    }

    @ViewBuilder private func label(_ v: Double) -> some View {
        if labels { Text(SPChartFmt.num(v)).font(.system(size: 9)).foregroundStyle(.secondary) }
    }
}

private struct SPLines: View {
    let points: [SPChartPoint]
    let names: [String]
    let colors: [Color]
    let smooth: Bool
    let labels: Bool

    var body: some View {
        let dots = points.count / max(names.count, 1) <= 30
        Chart(points) { p in
            LineMark(x: .value("Category", p.x), y: .value("Value", p.value))
                .foregroundStyle(by: .value("Series", p.series))
                .interpolationMethod(smooth ? .monotone : .linear)
                .lineStyle(StrokeStyle(lineWidth: 2))
            if dots {
                PointMark(x: .value("Category", p.x), y: .value("Value", p.value))
                    .foregroundStyle(by: .value("Series", p.series))
                    .symbolSize(18)
                    .annotation(position: .top) {
                        if labels { Text(SPChartFmt.num(p.value)).font(.system(size: 9)).foregroundStyle(.secondary) }
                    }
            }
        }
        .chartForegroundStyleScale(domain: names, range: Array(colors.prefix(max(names.count, 1))))
    }
}

private struct SPAreas: View {
    let points: [SPChartPoint]
    let names: [String]
    let colors: [Color]
    let stacking: String
    let stepped: Bool

    var body: some View {
        let method: MarkStackingMethod = stacking == "percent" ? .normalized : (stacking == "standard" ? .standard : .unstacked)
        Chart(points) { p in
            AreaMark(x: .value("Category", p.x), y: .value("Value", p.value), stacking: method)
                .foregroundStyle(by: .value("Series", p.series))
                .interpolationMethod(stepped ? .stepStart : .linear)
                .opacity(0.45)
            LineMark(x: .value("Category", p.x), y: .value("Value", p.value))
                .foregroundStyle(by: .value("Series", p.series))
                .interpolationMethod(stepped ? .stepStart : .linear)
                .opacity(stacking == "none" ? 1 : 0)
        }
        .chartForegroundStyleScale(domain: names, range: Array(colors.prefix(max(names.count, 1))))
    }
}

private struct SPPie: View {
    let cd: SPChart.ChartData
    let keys: [String]
    let colors: [Color]
    let donut: Bool
    let labels: Bool

    private struct Slice: Identifiable {
        let id: Int
        let key: String
        let value: Double
    }

    var body: some View {
        let s = cd.series.first
        let slices: [Slice] = keys.indices.compactMap { (i: Int) -> Slice? in
            let v = (s.flatMap { i < $0.values.count ? $0.values[i] : nil } ?? 0)
            return v > 0 ? Slice(id: i, key: keys[i], value: v) : nil
        }
        let total = slices.reduce(0) { $0 + $1.value }
        Chart(slices) { x in
            SectorMark(angle: .value("Value", x.value), innerRadius: .ratio(donut ? 0.5 : 0), angularInset: 1)
                .foregroundStyle(by: .value("Category", x.key))
                .annotation(position: .overlay) {
                    if labels && total > 0 && x.value / total >= 0.05 {
                        Text(SPChartFmt.pct(x.value / total)).font(.system(size: 10, weight: .semibold)).foregroundStyle(.white)
                    }
                }
        }
        .chartForegroundStyleScale(domain: slices.map { $0.key }, range: slices.map { $0.id < colors.count ? colors[$0.id] : Color.blue })
    }
}

private struct SPScatter: View {
    let cd: SPChart.ChartData
    let names: [String]
    let colors: [Color]
    let bubble: Bool

    private struct Pt: Identifiable {
        let id: Int
        let series: String
        let x: Double
        let y: Double
        let z: Double
    }

    private var pts: [Pt] {
        let numericX = cd.xKind == "num" || cd.xKind == "date"
        var out: [Pt] = []
        func val(_ s: Int, _ i: Int) -> Double? { s < cd.series.count && i < cd.series[s].values.count ? cd.series[s].values[i] : nil }
        if bubble {
            let name = names.indices.contains(numericX ? 0 : 1) ? names[numericX ? 0 : 1] : ""
            for i in cd.categories.indices {
                let x = numericX ? cd.xValues[i] : val(0, i)
                let y = numericX ? val(0, i) : val(1, i)
                let z = (numericX ? val(1, i) : val(2, i)) ?? 1
                if let x, let y { out.append(Pt(id: out.count, series: name, x: x, y: y, z: z)) }
            }
        } else {
            for (k, s) in cd.series.enumerated() {
                for i in cd.categories.indices {
                    let x: Double? = numericX ? cd.xValues[i] : Double(i + 1)
                    if let x, i < s.values.count, let y = s.values[i] { out.append(Pt(id: out.count, series: names[k], x: x, y: y, z: 1)) }
                }
            }
        }
        return out
    }

    var body: some View {
        let list = pts
        let zMax = max(list.map { abs($0.z) }.max() ?? 1, 0.000001)
        Chart(list) { p in
            PointMark(x: .value("X", p.x), y: .value("Y", p.y))
                .foregroundStyle(by: .value("Series", p.series))
                .symbolSize(bubble ? 40 + 860 * abs(p.z) / zMax : 30)
                .opacity(bubble ? 0.6 : 1)
        }
        .chartForegroundStyleScale(domain: names.isEmpty ? [""] : names, range: Array(colors.prefix(max(names.count, 1))))
    }
}

private struct SPCombo: View {
    let points: [SPChartPoint]
    let names: [String]
    let colors: [Color]
    let labels: Bool

    var body: some View {
        Chart(points) { p in
            if p.seriesIndex == 0 {
                BarMark(x: .value("Category", p.x), y: .value("Value", p.value))
                    .foregroundStyle(by: .value("Series", p.series))
            } else {
                LineMark(x: .value("Category", p.x), y: .value("Value", p.value))
                    .foregroundStyle(by: .value("Series", p.series))
                    .lineStyle(StrokeStyle(lineWidth: 2))
                PointMark(x: .value("Category", p.x), y: .value("Value", p.value))
                    .foregroundStyle(by: .value("Series", p.series))
                    .symbolSize(18)
            }
        }
        .chartForegroundStyleScale(domain: names, range: Array(colors.prefix(max(names.count, 1))))
    }
}

private struct SPHistogram: View {
    let cd: SPChart.ChartData
    let color: Color
    let labels: Bool

    private struct Bin: Identifiable {
        let id: Int
        let label: String
        let count: Int
    }

    var body: some View {
        let bins = SPChart.histogramBins(cd.series.flatMap { $0.values })
        let list = bins.enumerated().map { i, b in Bin(id: i, label: "\(SPChartFmt.num(b.from))–\(SPChartFmt.num(b.to))", count: b.count) }
        Chart(list) { b in
            BarMark(x: .value("Bin", b.label), y: .value("Count", b.count))
                .foregroundStyle(color)
                .annotation(position: .top) {
                    if labels { Text("\(b.count)").font(.system(size: 9)).foregroundStyle(.secondary) }
                }
        }
    }
}

private struct SPWaterfall: View {
    let cd: SPChart.ChartData
    let keys: [String]
    let up: Color
    let down: Color

    private struct Step: Identifiable {
        let id: Int
        let x: String
        let lo: Double
        let hi: Double
        let kind: String
    }

    var body: some View {
        let steps = SPChart.waterfallSteps(cd.series.first?.values ?? [])
        let list = steps.enumerated().map { i, s in
            Step(id: i, x: s.kind == "total" ? T("Total") : (i < keys.count ? keys[i] : "\(i + 1)"),
                 lo: min(s.start, s.end), hi: max(s.start, s.end), kind: s.kind)
        }
        Chart(list) { s in
            BarMark(x: .value("Category", s.x), yStart: .value("Start", s.lo), yEnd: .value("End", s.hi))
                .foregroundStyle(s.kind == "total" ? Color.gray : (s.kind == "down" ? down : up))
        }
    }
}

// MARK: - the Charts panel

struct SheetChartsPanel: View {
    let ctx: SheetPanelContext
    @Environment(\.dismiss) private var dismiss
    @State private var path: [String] = []
    @State private var editing: SPChartSpec?

    private var store: SheetStore { ctx.store }
    private var charts: [SPChartSpec] { store.panelList("charts").compactMap { SPChartSpec(json: $0) } }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if charts.isEmpty {
                    EmptyState(icon: "chart.bar.xaxis", title: T("No charts yet"),
                               subtitle: T("Select the data, then insert a chart. Charts made on the web show here too."),
                               actionTitle: store.canEdit ? T("Insert chart") : nil, actionIcon: "plus") { insert() }
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                }
                ForEach(charts) { c in
                    NavigationLink(value: c.id) { chartCard(c) }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(T("Charts"))
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: String.self) { id in SheetChartDetail(ctx: ctx, chartId: id, onEdit: { editing = $0 }) }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { dismiss() } }
                if store.canEdit {
                    ToolbarItem(placement: .primaryAction) {
                        Button { insert() } label: { Label(T("Insert chart"), systemImage: "plus") }
                    }
                }
            }
            .sheet(item: $editing) { spec in SheetChartEditor(ctx: ctx, initial: spec) }
        }
        .spPanelPresentation()
    }

    @ViewBuilder private func chartCard(_ c: SPChartSpec) -> some View {
        if let snap = store.snapshot {
            VStack(alignment: .leading, spacing: 6) {
                SPChartView(spec: c, data: snap.engine.data, engine: snap.engine)
                    .frame(height: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .allowsHitTesting(false)
                Text((c.title ?? "").isEmpty ? T(SPChart.typeLabel(c.type)) : c.title!)
                    .font(NXFont.text(13, .medium)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            .padding(.vertical, 4)
        }
    }

    /// Insert ▸ Chart: a chart of the selection (or the data region around the active cell), editor open.
    private func insert() {
        guard store.canEdit, let snap = store.snapshot, let sel = store.panelSelectionRect else { return }
        let rc = store.selection.isSingleCell ? SheetChartsPanel.currentRegion(sel, snap) : sel
        let shape = snap.shape
        guard rc.bottom < shape.rowIds.count, rc.right < shape.columnIds.count else { return }
        let range = "{\(shape.columnIds[rc.left])!\(shape.rowIds[rc.top])}:{\(shape.columnIds[rc.right])!\(shape.rowIds[rc.bottom])}"
        let picked = SPChart.defaultChart(rc, snap.engine.data, snap.engine)
        let atCol = shape.columnIds[min(shape.columnIds.count - 1, rc.right + 1)]
        var spec = SPChartSpec(id: SPChart.newId("ch"), type: picked.type, ranges: [range],
                               at: ["r": shape.rowIds[rc.top], "c": atCol, "dx": 16, "dy": 0], w: 600, h: 371)
        spec.headers = picked.headers
        spec.labels = picked.labels
        let list = store.panelList("charts") + [spec.json]
        let saved = spec
        Task {
            await store.panelSaveSettings(["charts": list], label: T("insert chart"), pushUndo: ctx.pushUndo)
            editing = saved
        }
    }

    /// The block of filled cells around a cell (web SheetGrid currentRegion), in model indices.
    static func currentRegion(_ start: SheetValidation.Rect, _ snap: SheetBridge.Snapshot) -> SheetValidation.Rect {
        let maxR = snap.rows.count - 1, maxC = snap.columns.count - 1
        func filled(_ r: Int, _ c: Int) -> Bool {
            guard r >= 0, r <= maxR, c >= 0, c <= maxC, let v = snap.rows[r].cells[snap.columns[c].id] else { return false }
            if v is NSNull { return false }
            if let s = v as? String { return !s.isEmpty }
            return true
        }
        var rc = start
        var grew = true
        while grew {
            grew = false
            if rc.top > 0 && (rc.left...rc.right).contains(where: { filled(rc.top - 1, $0) }) { rc.top -= 1; grew = true }
            if rc.bottom < maxR && (rc.left...rc.right).contains(where: { filled(rc.bottom + 1, $0) }) { rc.bottom += 1; grew = true }
            if rc.left > 0 && (rc.top...rc.bottom).contains(where: { filled($0, rc.left - 1) }) { rc.left -= 1; grew = true }
            if rc.right < maxC && (rc.top...rc.bottom).contains(where: { filled($0, rc.right + 1) }) { rc.right += 1; grew = true }
        }
        return rc
    }
}

/// One chart full size, with Edit / Duplicate / Delete.
private struct SheetChartDetail: View {
    let ctx: SheetPanelContext
    let chartId: String
    let onEdit: (SPChartSpec) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var deleting = false
    @State private var anchor = SPAnchorRef()

    private var store: SheetStore { ctx.store }
    private var spec: SPChartSpec? { store.panelList("charts").compactMap { SPChartSpec(json: $0) }.first { $0.id == chartId } }

    var body: some View {
        Group {
            if let spec, let snap = store.snapshot {
                SPChartView(spec: spec, data: snap.engine.data, engine: snap.engine)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .background(SPAnchorView(ref: anchor))
                    .padding(12)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                EmptyState(icon: "chart.bar.xaxis", title: T("This chart was deleted"), subtitle: T("Someone removed it from the sheet."))
            }
        }
        .background(NX.background)
        .navigationTitle(spec.map { ($0.title ?? "").isEmpty ? T(SPChart.typeLabel($0.type)) : $0.title! } ?? T("Charts"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let spec {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        if store.canEdit {
                            Button { onEdit(spec) } label: { Label(T("Edit chart"), systemImage: "pencil") }
                            Button { duplicate(spec) } label: { Label(T("Duplicate"), systemImage: "plus.square.on.square") }
                        }
                        Button { download(spec) } label: { Label(T("Download as PNG image"), systemImage: "arrow.down.circle") }
                        if store.canEdit {
                            Button(role: .destructive) { deleting = true } label: { Label(T("Delete chart"), systemImage: "trash") }
                        }
                    } label: { Image(systemName: "ellipsis.circle") }
                    .accessibilityLabel(T("More"))
                }
            }
        }
        .alert(T("Delete this chart?"), isPresented: $deleting) {
            Button(T("Delete"), role: .destructive) { Task { await delete() } }
            Button(T("Cancel"), role: .cancel) {}
        } message: { Text(T("The data stays in the sheet; only the chart goes.")) }
    }

    private func download(_ spec: SPChartSpec) {
        guard let snap = store.snapshot else { return }
        SPChartExport.download(spec: spec, data: snap.engine.data, engine: snap.engine, anchor: anchor.view)
    }

    private func duplicate(_ spec: SPChartSpec) {
        var copy = spec
        copy.id = SPChart.newId("ch")
        var at = spec.at
        at["dx"] = ((at["dx"] as? NSNumber)?.doubleValue ?? 0) + 24
        at["dy"] = ((at["dy"] as? NSNumber)?.doubleValue ?? 0) + 24
        copy.at = at
        let list = store.panelList("charts") + [copy.json]
        Task { await store.panelSaveSettings(["charts": list], label: T("copy chart"), pushUndo: ctx.pushUndo) }
    }

    private func delete() async {
        let list = store.panelList("charts").filter { ($0["id"] as? String) != chartId }
        await store.panelSaveSettings(["charts": SheetPanelAPI.orNull(list)], label: T("delete chart"), pushUndo: ctx.pushUndo)
        dismiss()
    }
}

// MARK: - chart editor

/// "Chart editor" (web ChartEditor.tsx): Setup (type, stacking, data range, series, aggregate, switch
/// rows/columns, header row, label column) and Customise (titles, background, series colours, legend, axis
/// titles and bounds, gridlines, data labels). The chart redraws live above the form; Done saves.
struct SheetChartEditor: View {
    let ctx: SheetPanelContext
    @State var spec: SPChartSpec
    /// The chart as the editor opened it: Done saves only what differs from it.
    private let initial: SPChartSpec
    @Environment(\.dismiss) private var dismiss
    @State private var tab = 0
    @State private var rangeText = ""
    @State private var rangeInvalid = false
    @State private var yMinText = ""
    @State private var yMaxText = ""
    /// The preview, for the iPad share popover of Download.
    @State private var anchor = SPAnchorRef()

    init(ctx: SheetPanelContext, initial: SPChartSpec) {
        self.ctx = ctx
        self.initial = initial
        _spec = State(initialValue: initial)
    }

    private var store: SheetStore { ctx.store }
    private var shape: SheetShape { store.panelShape }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let snap = store.snapshot {
                    SPChartView(spec: spec, data: snap.engine.data, engine: snap.engine)
                        .frame(height: 200)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .background(SPAnchorView(ref: anchor))
                        .overlay(alignment: .bottomTrailing) { SPChartDownloadButton { download(snap) } }
                        .padding(.horizontal, 12).padding(.top, 8)
                }
                Picker("", selection: $tab) {
                    Text(T("Setup")).tag(0)
                    Text(T("Customise")).tag(1)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 12).padding(.vertical, 8)
                Form {
                    if tab == 0 { setup } else { customise }
                }
            }
            .background(NX.background)
            .navigationTitle(T("Chart editor"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { Task { await save() } } }
            }
            .onAppear {
                rangeText = SPChart.rangesToA1(spec.ranges, shape)
                yMinText = spec.yMin.map { SheetJS.numberToString($0) } ?? ""
                yMaxText = spec.yMax.map { SheetJS.numberToString($0) } ?? ""
            }
        }
        .spPanelPresentation()
    }

    private var chartData: SPChart.ChartData? {
        guard let snap = store.snapshot else { return nil }
        return SPChart.chartData(spec, data: snap.engine.data, engine: snap.engine)
    }

    @ViewBuilder private var setup: some View {
        Section(T("Chart type")) {
            Picker(T("Chart type"), selection: $spec.type) {
                ForEach(SPChart.TYPE_GROUPS.indices, id: \.self) { gi in
                    Section(T(SPChart.TYPE_GROUPS[gi].group)) {
                        ForEach(SPChart.TYPE_GROUPS[gi].types.indices, id: \.self) { ti in
                            Text(T(SPChart.TYPE_GROUPS[gi].types[ti].label)).tag(SPChart.TYPE_GROUPS[gi].types[ti].type)
                        }
                    }
                }
            }
            if SPChart.stackFamily(spec.type) != nil {
                Picker(T("Stacking"), selection: Binding(get: { SPChart.stackingOf(spec.type) }, set: { spec.type = SPChart.withStacking(spec.type, $0) })) {
                    Text(T("None")).tag("none")
                    Text(T("Standard")).tag("standard")
                    Text("100%").tag("percent")
                }
            }
        }
        Section(T("Data range")) {
            TextField("A1:C8", text: $rangeText)
                .font(.system(size: 14, design: .monospaced)).textInputAutocapitalization(.characters).autocorrectionDisabled()
                .onSubmit(applyRange)
            if rangeInvalid { Text(T("Invalid range")).font(NXFont.text(12)).foregroundStyle(NX.danger) }
            Button(T("Use the selected range")) { rangeText = store.panelSelectionA1; applyRange() }
        }
        if let cd = chartData {
            Section(T("Series")) {
                if cd.labels { LabeledContent(T("X-axis"), value: cd.xName) }
                ForEach(cd.series.indices, id: \.self) { i in
                    HStack {
                        Circle().fill(SPColors.color(SPChart.seriesColor(i, spec.colors))).frame(width: 10, height: 10)
                        Text(cd.series[i].name)
                        Spacer()
                        Button(T("Remove")) {
                            spec.ranges = SPChart.removeSeriesSource(spec.ranges, cd.series[i].source, shape, byRow: spec.transpose == true)
                            rangeText = SPChart.rangesToA1(spec.ranges, shape)
                        }
                        .buttonStyle(.borderless)
                    }
                }
                if spec.transpose != true {
                    Menu(T("Add series")) {
                        ForEach(store.panelColumns.indices, id: \.self) { c in
                            Button(store.panelColumns[c].name.isEmpty ? SheetFormula.colLetter(c) : "\(SheetFormula.colLetter(c)) · \(store.panelColumns[c].name)") {
                                spec.ranges = SPChart.addSeriesColumn(spec.ranges, c, shape)
                                rangeText = SPChart.rangesToA1(spec.ranges, shape)
                            }
                        }
                    }
                }
            }
            Section {
                Picker(T("Aggregate"), selection: Binding(get: { spec.aggregate ?? "" }, set: { spec.aggregate = $0.isEmpty ? nil : $0 })) {
                    Text(T("None")).tag("")
                    Text(T("Sum")).tag("sum")
                    Text(T("Average")).tag("avg")
                    Text(T("Count")).tag("count")
                    Text(T("Max")).tag("max")
                    Text(T("Min")).tag("min")
                }
                Toggle(T("Switch rows/columns"), isOn: Binding(get: { spec.transpose == true }, set: { spec.transpose = $0 ? true : nil }))
                Toggle(T("Use row 1 as headers"), isOn: Binding(get: { cd.headerRow }, set: { spec.headers = $0 }))
                Toggle(T("Use column A as labels"), isOn: Binding(get: { cd.labels }, set: { spec.labels = $0 }))
            }
        }
    }

    @ViewBuilder private var customise: some View {
        Section(T("Chart & axis titles")) {
            TextField(T("Chart title"), text: Binding(get: { spec.title ?? "" }, set: { spec.title = $0 }))
            TextField(T("Chart subtitle"), text: Binding(get: { spec.subtitle ?? "" }, set: { spec.subtitle = $0 }))
            TextField(T("Horizontal axis title"), text: Binding(get: { spec.xTitle ?? "" }, set: { spec.xTitle = $0 }))
            TextField(T("Vertical axis title"), text: Binding(get: { spec.yTitle ?? "" }, set: { spec.yTitle = $0 }))
        }
        Section(T("Chart style")) {
            HStack {
                Text(T("Background colour"))
                Spacer()
                SPColorButton(label: T("Background colour"), value: spec.bg) { spec.bg = $0 }
            }
            Picker(T("Legend"), selection: Binding(get: { spec.legend ?? "auto" }, set: { spec.legend = $0 == "auto" ? nil : $0 })) {
                Text(T("Auto")).tag("auto")
                Text(T("Above the chart")).tag("top")
                Text(T("Below the chart")).tag("bottom")
                Text(T("Left of the chart")).tag("left")
                Text(T("Right of the chart")).tag("right")
                Text(T("None")).tag("none")
            }
            Toggle(T("Data labels"), isOn: Binding(get: { spec.dataLabels ?? (spec.type == "pie" || spec.type == "donut") },
                                                  set: { spec.dataLabels = $0 }))
            Toggle(T("Major gridlines"), isOn: Binding(get: { spec.gridlines != false }, set: { spec.gridlines = $0 ? nil : false }))
        }
        if let cd = chartData, !cd.series.isEmpty {
            Section(T("Series")) {
                ForEach(cd.series.indices, id: \.self) { i in
                    HStack {
                        Text(cd.series[i].name)
                        Spacer()
                        SPColorButton(label: T("Colour"), value: SPChart.seriesColor(i, spec.colors)) { c in setSeriesColor(i, c) }
                    }
                }
            }
        }
        Section(T("Vertical axis")) {
            TextField(T("Min"), text: $yMinText).keyboardType(.numbersAndPunctuation)
                .onChange(of: yMinText) { _, v in spec.yMin = SheetFormula.parseLocaleNumber(v)?.n }
            TextField(T("Max"), text: $yMaxText).keyboardType(.numbersAndPunctuation)
                .onChange(of: yMaxText) { _, v in spec.yMax = SheetFormula.parseLocaleNumber(v)?.n }
        }
    }

    /// Download ▸ PNG of the chart as edited so far.
    private func download(_ snap: SheetBridge.Snapshot) {
        SPChartExport.download(spec: spec, data: snap.engine.data, engine: snap.engine, anchor: anchor.view)
    }

    private func setSeriesColor(_ i: Int, _ c: String?) {
        var list = spec.colors ?? []
        while list.count <= i { list.append("") }
        list[i] = c ?? ""
        while let last = list.last, last.isEmpty { list.removeLast() }
        spec.colors = list.isEmpty ? nil : list
    }

    private func applyRange() {
        if let r = SPChart.rangesFromA1(rangeText, shape) {
            spec.ranges = r
            rangeInvalid = false
        } else {
            rangeInvalid = true
        }
    }

    private func save() async {
        applyRange()
        if rangeInvalid { tab = 0; return }
        // Read the charts fresh: the chart may have been moved / resized on the grid while this was open.
        var list = store.panelList("charts")
        if let i = list.firstIndex(where: { ($0["id"] as? String) == spec.id }) {
            list[i] = SPChartSpec.mergeEdits(spec, initial: initial, into: list[i])
        } else {
            list.append(spec.json)
        }
        await store.panelSaveSettings(["charts": list], label: T("edit chart"), pushUndo: ctx.pushUndo)
        dismiss()
    }
}

/// The editor preview's Download button (a small round button in its corner).
private struct SPChartDownloadButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.down.circle")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(NX.foreground)
                .frame(width: 32, height: 32)
                .background(.regularMaterial, in: Circle())
        }
        .buttonStyle(.plain)
        .padding(6)
        .accessibilityLabel(T("Download as PNG image"))
        .help(T("Download as PNG image"))
    }
}
