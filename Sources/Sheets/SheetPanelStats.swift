import SwiftUI
import Charts

// Data ▸ Column stats (web SheetStatsPanel.tsx over lib/sheet-stats.ts → SheetStats): one column at a time
// (‹ › to the neighbours), "Ignore rows" for header rows, a Count-by-value / Distribution bar chart, the most
// / least frequent values and the totals. Hidden and filtered rows count, like Sheets. Also the editor host
// for one chart tapped on the grid.

struct SheetStatsPanel: View {
    let ctx: SheetPanelContext
    @State private var column: Int
    @State private var ignore = 0
    @State private var chart = 0
    @State private var most = true
    @Environment(\.dismiss) private var dismiss

    init(ctx: SheetPanelContext, column: Int) {
        self.ctx = ctx
        _column = State(initialValue: column)
    }

    private var store: SheetStore { ctx.store }
    private static let tableRows = 10

    var body: some View {
        let s = stats
        NavigationStack {
            Form {
                Section { columnSwitcher; ignoreRow }
                Section {
                    Picker("", selection: $chart) {
                        Text(T("Count by value")).tag(0)
                        Text(T("Distribution")).tag(1)
                    }
                    .pickerStyle(.segmented)
                    SheetStatsBars(items: chartItems(s), empty: chart == 1 ? T("No numbers in this column.") : T("This column is empty."))
                }
                Section {
                    Picker("", selection: $most) {
                        Text(T("Most frequent")).tag(true)
                        Text(T("Least frequent")).tag(false)
                    }
                    .pickerStyle(.segmented)
                    frequencyTable(s)
                }
                Section {
                    let rows = totals(s)
                    ForEach(rows.indices, id: \.self) { i in
                        LabeledContent(rows[i].0) { Text(rows[i].1).monospacedDigit() }
                    }
                } footer: {
                    Text(T("All stats include data in hidden or filtered rows."))
                }
            }
            .navigationTitle(T("Column stats"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { dismiss() } } }
        }
        .spPanelPresentation()
    }

    // MARK: data

    private var stats: SheetStats.ColumnStats { SheetStats.columnStats(values, ignoreRows: ignore) }

    /// Every cell of the column top to bottom (model order, hidden and filtered rows included).
    private var values: [SheetStats.Input] {
        guard let snap = store.snapshot, snap.columns.indices.contains(column) else { return [] }
        let col = snap.columns[column]
        return snap.rows.map { r in
            let raw = r.cells[col.id]
            let text = SheetTypes.displayCell(col.type, raw, (engine: snap.engine, rowId: r.id, colId: col.id))
            return SheetStats.Input(value: snap.value(r.id, col.id), text: text)
        }
    }

    private var columnLabel: String {
        guard let snap = store.snapshot, snap.columns.indices.contains(column) else { return "—" }
        let name = snap.columns[column].name
        return name.isEmpty ? T("Column %@").replacingOccurrences(of: "%@", with: SheetA1.letters(column)) : name
    }

    private func chartItems(_ s: SheetStats.ColumnStats) -> [SheetStatsBars.Item] {
        if chart == 0 { return s.counts.enumerated().map { SheetStatsBars.Item(id: $0.offset, label: $0.element.text, count: $0.element.count) } }
        return s.distribution.enumerated().map { i, b in
            SheetStatsBars.Item(id: i, label: "\(Self.short(b.from))–\(Self.short(b.to))", count: b.count)
        }
    }

    private func totals(_ s: SheetStats.ColumnStats) -> [(String, String)] {
        var out: [(String, String)] = [
            (T("Total rows"), Self.number(Double(s.total))),
            (T("Empty cells"), Self.number(Double(s.empty))),
            (T("Unique values"), Self.number(Double(s.unique))),
        ]
        if s.numeric > 0 {
            out.append((T("Sum"), Self.number(s.sum)))
            out.append((T("Average"), Self.number(s.avg)))
            out.append((T("Median"), Self.number(s.median)))
            out.append((T("Minimum value"), Self.number(s.min)))
            out.append((T("Maximum value"), Self.number(s.max)))
        }
        return out
    }

    private static func formatter(_ digits: Int) -> NumberFormatter {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: AppLanguage.shared.lang == .id ? "id_ID" : "en_US")
        f.maximumFractionDigits = digits
        return f
    }

    /// Intl.NumberFormat(locale, { maximumFractionDigits: 8 }), "—" for nothing.
    static func number(_ n: Double?) -> String {
        guard let n else { return "—" }
        return formatter(8).string(from: NSNumber(value: n)) ?? "\(n)"
    }

    static func short(_ n: Double) -> String { formatter(1).string(from: NSNumber(value: n)) ?? "\(n)" }

    // MARK: pieces

    private var columnSwitcher: some View {
        let count = store.snapshot?.columns.count ?? 0
        return HStack(spacing: 8) {
            Text(columnLabel).font(NXFont.text(14, .semibold)).lineLimit(1)
            Spacer(minLength: 4)
            Button { column = max(0, column - 1) } label: { Image(systemName: "chevron.left") }
                .buttonStyle(.borderless)
                .disabled(column <= 0)
                .accessibilityLabel(T("Previous column"))
            Button { column = min(count - 1, column + 1) } label: { Image(systemName: "chevron.right") }
                .buttonStyle(.borderless)
                .disabled(column >= count - 1)
                .accessibilityLabel(T("Next column"))
        }
    }

    private var ignoreRow: some View {
        Stepper(value: $ignore, in: 0...max(0, store.rows.count)) {
            HStack {
                Text(T("Ignore rows"))
                Spacer()
                Text("\(ignore)").monospacedDigit().foregroundStyle(NX.mutedFg)
            }
        }
    }

    @ViewBuilder private func frequencyTable(_ s: SheetStats.ColumnStats) -> some View {
        let list = most ? s.frequency : Array(s.frequency.reversed())
        if list.isEmpty {
            Text(T("This column is empty.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
        } else {
            HStack {
                Text(T("Value")).font(NXFont.text(11, .medium)).foregroundStyle(NX.mutedFg)
                Spacer()
                Text(T("Frequency")).font(NXFont.text(11, .medium)).foregroundStyle(NX.mutedFg)
            }
            ForEach(Array(list.prefix(Self.tableRows).enumerated()), id: \.offset) { _, row in
                HStack {
                    Text(row.text).font(NXFont.text(13, .semibold)).lineLimit(1)
                    Spacer()
                    Text(Self.number(Double(row.count))).monospacedDigit()
                }
            }
        }
    }
}

/// The stats panel's bar chart (Swift Charts), at most 40 bars like the web; labels when there are few.
struct SheetStatsBars: View {
    struct Item: Identifiable {
        let id: Int
        let label: String
        let count: Int
    }

    let items: [Item]
    let empty: String

    var body: some View {
        if items.isEmpty {
            Text(empty).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                .frame(maxWidth: .infinity, minHeight: 120)
        } else {
            let shown = Array(items.prefix(40))
            let labelled = shown.count <= 12
            Chart(shown) { it in
                BarMark(x: .value("Value", "\(it.id)"), y: .value("Count", it.count))
                    .foregroundStyle(NX.violet.opacity(0.8))
            }
            .chartXAxis {
                AxisMarks { value in
                    AxisValueLabel {
                        if labelled, let s = value.as(String.self), let i = Int(s), i < shown.count {
                            Text(shown[i].label).font(.system(size: 9)).lineLimit(1)
                        }
                    }
                }
            }
            .frame(height: 170)
        }
    }
}

/// One chart's editor opened from the grid (the chart may have been deleted meanwhile).
struct SheetChartEditorHost: View {
    let ctx: SheetPanelContext
    let chartId: String

    var body: some View {
        if let spec = ctx.store.chartSpecs.first(where: { $0.id == chartId }) {
            SheetChartEditor(ctx: ctx, initial: spec)
        } else {
            NavigationStack {
                EmptyState(icon: "chart.bar.xaxis", title: T("This chart was deleted"), subtitle: T("Someone removed it from the sheet."))
            }
            .spPanelPresentation()
        }
    }
}
