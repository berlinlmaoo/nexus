import SwiftUI
import Observation

// Pivot tables (web PivotEditor.tsx + ProjectSheetView's pivot sheets). A pivot sheet ("Pivot Table N") keeps
// its definition in settings.pivot; the table is computed from the SOURCE sheet (SheetPanelPivotData, a port
// of lib/sheet-pivot.ts) and WRITTEN into the pivot sheet's cells, so phones, exports and the grid show it.
// Like the web, any editor who opens a pivot whose cells are out of date re-writes them; the cells are
// derived data, so that write skips the undo stack, and so does the definition (the web's savePivot).

@MainActor
@Observable
final class SheetPivotModel {
    private(set) var spec: SPPivotSpec?
    private(set) var source: SPPivotSource?
    private(set) var sourceName = ""
    private(set) var result: SPPivot.Result?
    private(set) var loading = false
    var error: String?
    private var writing = false
    private var sourceRows: [SheetRowModel] = []
    private var sourceColumns: [SheetColumn] = []

    /// Reads the open sheet's pivot definition and its source sheet, computes, and brings the cells up to date.
    func load(_ store: SheetStore) async {
        guard let o = store.settings["pivot"] as? SheetJSON, let s = SPPivotSpec(json: o) else { spec = nil; result = nil; return }
        spec = s
        loading = true
        defer { loading = false }
        do {
            let src = try await APIClient.shared.loadSheet(s.source)
            sourceName = src["name"] as? String ?? ""
            sourceColumns = ((src["columns"] as? [SheetJSON]) ?? []).compactMap { SheetColumn(json: $0) }
            sourceRows = ((src["rows"] as? [SheetJSON]) ?? []).compactMap(SheetRowModel.init)
            error = nil
            recompute()
            await writeCells(store)
        } catch {
            self.error = SheetPanelAPI.message(error, T("Couldn't load the pivot table's data."))
        }
    }

    private func recompute() {
        guard let spec else { result = nil; return }
        let cols = sourceColumns, rows = sourceRows
        let data = SheetData(columns: cols.map { ($0.id, $0.type) }, rows: rows.map { ($0.id, $0.cells) })
        let engine = SheetFormula.engineFor(data)
        let headRow: SheetRowModel? = SheetValidation.rangeRect(spec.range, data.shape).flatMap { rc in rc.top < rows.count ? rows[rc.top] : nil }
        let src = SPPivotSource(data: data, engine: engine, headerOf: { colId in
            let col = cols.first { $0.id == colId }
            var text = ""
            if let col, let headRow {
                text = SheetTypes.displayCell(col.type, headRow.cells[colId], (engine: engine, rowId: headRow.id, colId: colId))
            }
            if !text.isEmpty { return text }
            if let n = col?.name, !n.isEmpty { return n }
            return colId
        })
        source = src
        result = SPPivot.computePivot(spec, src)
    }

    var fields: [(colId: String, label: String)] {
        guard let spec, let source else { return [] }
        return SPPivot.pivotFields(source, spec.range)
    }

    func label(_ colId: String) -> String { fields.first { $0.colId == colId }?.label ?? colId }

    func values(for colId: String) -> [String] {
        guard let spec, let source else { return [] }
        return SPPivot.distinctFieldValues(source, spec.range, colId)
    }

    var suggestions: [SPPivot.Suggestion] {
        guard let spec, let source else { return [] }
        return SPPivot.pivotSuggestions(source, spec.range)
    }

    var rangeA1: String {
        guard let spec, let source else { return "" }
        return SheetValidation.rangeToA1(spec.range, source.data.shape)
    }

    /// A new definition: saved to settings.pivot (no undo, as on the web), then the cells re-written.
    func save(_ next: SPPivotSpec, _ store: SheetStore) async {
        spec = next
        recompute()
        guard store.canEdit, let sid = store.sheetId else { return }
        do {
            try await APIClient.shared.patchSheet(sid, body: ["settings": ["pivot": next.json]])
            await writeCells(store)
        } catch {
            self.error = SheetPanelAPI.message(error, T("Couldn't save."))
        }
    }

    /// The typed source range, in the source sheet's cells; false when unreadable.
    func setRange(_ text: String, _ store: SheetStore) async -> Bool {
        guard var s = spec, let source, let r = SheetValidation.rangeFromA1(text, source.data.shape) else { return false }
        s.range = r
        await save(s, store)
        return true
    }

    /// "Grand Total", "SUM of Jumlah", "Apel Total" in the interface language (web tr()).
    static func translate(_ c: SPPivotCell) -> SPPivotCell {
        guard case .text(let v) = c else { return c }
        if v == "Grand Total" { return .text(T("Grand Total")) }
        if let m = SheetJS.match(SheetJS.re("^([A-Z]+) of (.+)$"), v), let fn = m[1], let name = m[2] {
            return .text(T("%1 of %2").replacingOccurrences(of: "%1", with: fn).replacingOccurrences(of: "%2", with: name))
        }
        if let m = SheetJS.match(SheetJS.re("^(.+) Total$"), v), let name = m[1] {
            return .text(T("%@ Total").replacingOccurrences(of: "%@", with: name))
        }
        return c
    }

    private static func textOfStored(_ v: Any?) -> String {
        switch SheetFormula.kind(v) {
        case .null: return ""
        case .string(let s): return s
        case .number(let n): return SheetJS.numberToString(n)
        case .bool(let b): return b ? "true" : "false"
        default: return SheetFormula.jsString(v)
        }
    }

    private static func json(_ c: SPPivotCell) -> Any {
        switch c {
        case .blank: return NSNull()
        case .number(let n): return n
        case .text(let s): return s
        }
    }

    /// Writes the computed table into the pivot sheet when what is stored differs (web ProjectSheetView).
    func writeCells(_ store: SheetStore) async {
        guard let result, store.canEdit, !writing, let sid = store.sheetId else { return }
        let grid = result.grid.map { row in row.map { Self.translate($0) } }
        let width = max(1, grid.map { $0.count }.max() ?? 0)
        let colIds = store.columns.compactMap { $0["id"] as? String }
        let same = grid.count <= store.rows.count && width <= colIds.count && store.rows.enumerated().allSatisfy { i, row in
            colIds.enumerated().allSatisfy { j, cid in
                let want = i < grid.count && j < grid[i].count ? grid[i][j].text : ""
                return want == Self.textOfStored(row.cells[cid])
            }
        }
        if same { return }
        writing = true
        defer { writing = false }
        do {
            var cols = store.columns
            if width > cols.count {
                let more: [SheetJSON] = (0..<(width - cols.count)).map { _ in ["name": "", "type": "text"] }
                let o = try await APIClient.shared.patchSheet(sid, body: ["columns": cols + more], structureVersion: store.structureVersion)
                store.structureVersion = o["structureVersion"] as? Int
                cols = (o["columns"] as? [SheetJSON]) ?? cols
            }
            var rowIds = store.rows.map { $0.id }
            var stored: [String: [String: Any]] = [:]
            for r in store.rows { stored[r.id] = r.cells }
            if grid.count > rowIds.count {
                let created = try await APIClient.shared.addSheetRows(sid, count: grid.count - rowIds.count, afterRowId: rowIds.last)
                rowIds += created.compactMap { $0["id"] as? String }
            }
            let ids = cols.compactMap { $0["id"] as? String }
            var edits: [SheetCellEdit] = []
            for (i, rowId) in rowIds.enumerated() {
                var values: [String: Any] = [:]
                var differs = false
                for (j, cid) in ids.enumerated() {
                    let cell: SPPivotCell = i < grid.count && j < grid[i].count ? grid[i][j] : .blank
                    values[cid] = Self.json(cell)
                    if cell.text != Self.textOfStored(stored[rowId]?[cid]) { differs = true }
                }
                if differs { edits.append(SheetCellEdit(rowId: rowId, values: values)) }
            }
            let grand = T("Grand Total")
            var styles: [SheetCellEdit] = []
            for i in 0..<min(grid.count, rowIds.count) {
                var values: [String: Any] = [:]
                let isTotal = i == 0 || (grid[i].first?.text ?? "") == grand
                for j in 0..<min(width, ids.count) {
                    let f = i < result.formats.count && j < result.formats[i].count ? result.formats[i][j] : nil
                    if isTotal {
                        var st: [String: Any] = ["b": 1]
                        if f == "pct" { st["nf"] = "pct" }
                        values[ids[j]] = st
                    } else {
                        values[ids[j]] = f == "pct" ? ["nf": "pct"] : NSNull()
                    }
                }
                styles.append(SheetCellEdit(rowId: rowIds[i], values: values))
            }
            for start in stride(from: 0, to: max(edits.count, styles.count), by: 200) {
                let e = Array(edits[min(start, edits.count)..<min(start + 200, edits.count)])
                let s = Array(styles[min(start, styles.count)..<min(start + 200, styles.count)])
                try await APIClient.shared.patchSheetCells(sid, edits: e, styles: s)
            }
            await store.reload()
        } catch {
            self.error = SheetPanelAPI.message(error, T("Couldn't update the pivot table."))
        }
    }
}

struct SheetPivotPanel: View {
    let ctx: SheetPanelContext
    @Environment(\.dismiss) private var dismiss
    @State private var model = SheetPivotModel()
    @State private var tab = 0
    @State private var rangeText = ""
    @State private var rangeInvalid = false
    @State private var createRange = ""
    @State private var createInvalid = false
    @State private var creating = false

    private var store: SheetStore { ctx.store }
    private var isPivot: Bool { store.settings["pivot"] is SheetJSON }

    var body: some View {
        NavigationStack {
            Group {
                if isPivot { pivotContent } else { createContent }
            }
            .background(NX.background)
            .navigationTitle(isPivot ? T("Pivot table") : T("Create pivot table"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { dismiss() } } }
            .task(id: store.sheetId) {
                await model.load(store)
                rangeText = model.rangeA1
            }
            .alert(T("Couldn't save."), isPresented: Binding(get: { model.error != nil && isPivot && model.result != nil }, set: { if !$0 { model.error = nil } })) {
                Button(T("OK"), role: .cancel) {}
            } message: { Text(model.error ?? "") }
        }
        .spPanelPresentation()
    }

    // MARK: not a pivot sheet: Insert ▸ Pivot table

    private var createContent: some View {
        Form {
            Section {
                SPRangeField(title: T("Data range"), text: $createRange, selection: store.panelSelectionA1, invalid: createInvalid,
                             disabled: !store.canEdit, placeholder: T("e.g. Sheet1!A1:D100"))
            } header: { Text(T("Data range")) } footer: {
                Text(T("The first row holds the field names. The pivot table goes into a new sheet and follows this data."))
            }
            Section {
                Button { Task { await create() } } label: {
                    HStack { Text(T("Create")); if creating { Spacer(); ProgressView() } }
                }
                .disabled(!store.canEdit || creating)
            } footer: {
                if !store.canEdit { Text(T("You can view this spreadsheet but not change it.")) }
            }
        }
        .onAppear {
            if createRange.isEmpty, let snap = store.snapshot, let sel = store.panelSelectionRect {
                let rc = store.selection.isSingleCell ? SheetChartsPanel.currentRegion(sel, snap) : sel
                createRange = SPFormat.a1(row: rc.top, col: rc.left) + ":" + SPFormat.a1(row: rc.bottom, col: rc.right)
            }
        }
    }

    /// Insert › Pivot table › New sheet: "Pivot Table N", fed by the range of this sheet (web createPivot).
    private func create() async {
        guard let sid = store.sheetId, let range = SheetValidation.rangeFromA1(createRange, store.panelShape) else { createInvalid = true; return }
        createInvalid = false
        creating = true
        defer { creating = false }
        do {
            let used = Set(store.tabs.map { $0.name })
            var n = 1
            while used.contains("Pivot Table \(n)") { n += 1 }
            guard let newId = try await APIClient.shared.createSheet(store.projectId, name: "Pivot Table \(n)") else { return }
            let spec = SPPivotSpec(source: sid, range: range)
            try await APIClient.shared.patchSheet(newId, body: ["settings": ["pivot": spec.json]])
            store.tabs = try await APIClient.shared.projectSheets(store.projectId).sorted { $0.position < $1.position }
            await store.open(newId)
        } catch {
            store.notice = SheetPanelAPI.message(error, T("Couldn't create the sheet."))
        }
    }

    // MARK: a pivot sheet

    @ViewBuilder private var pivotContent: some View {
        VStack(spacing: 0) {
            Picker("", selection: $tab) {
                Text(T("Table")).tag(0)
                Text(T("Pivot table editor")).tag(1)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 12).padding(.vertical, 8)
            if model.loading && model.result == nil {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = model.error, model.result == nil {
                ErrorState(message: err, icon: "tablecells") { Task { await model.load(store) } }
            } else if tab == 0 {
                table
            } else {
                editor
            }
        }
    }

    @ViewBuilder private var table: some View {
        if let r = model.result, !r.grid.isEmpty {
            ScrollView([.vertical, .horizontal]) {
                Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                    ForEach(Array(r.grid.prefix(500).enumerated()), id: \.offset) { i, row in
                        GridRow {
                            ForEach(Array(row.enumerated()), id: \.offset) { j, c in
                                cellView(SheetPivotModel.translate(c), format: i < r.formats.count && j < r.formats[i].count ? r.formats[i][j] : nil,
                                         bold: i == 0 || (row.first.map { SheetPivotModel.translate($0).text } == T("Grand Total")))
                            }
                        }
                    }
                }
                .padding(8)
            }
            if r.error == "too many columns" {
                Text(T("Only the first 50 columns are shown.")).font(NXFont.text(12)).foregroundStyle(NX.warning).padding(8)
            }
        } else {
            EmptyState(icon: "tablecells", title: T("This pivot table is empty"),
                       subtitle: T("Add rows, columns or values in the editor to build it."),
                       actionTitle: store.canEdit ? T("Open editor") : nil, actionIcon: "slider.horizontal.3") { tab = 1 }
                .frame(maxHeight: .infinity)
        }
    }

    private func cellView(_ c: SPPivotCell, format: String?, bold: Bool) -> some View {
        let text: String
        switch c {
        case .blank: text = ""
        case .text(let s): text = s
        case .number(let n): text = format == "pct" ? SPChartFmt.pct(n) : SheetFormula.formatGrouped(n, 2)
        }
        let numeric: Bool = { if case .number = c { return true }; return false }()
        return Text(text)
            .font(NXFont.text(13, bold ? .semibold : .regular))
            .monospacedDigit()
            .lineLimit(1)
            .frame(minWidth: 90, maxWidth: 220, alignment: numeric ? .trailing : .leading)
            .padding(.horizontal, 8).padding(.vertical, 6)
            .overlay(Rectangle().strokeBorder(NX.border, lineWidth: 0.5))
    }

    // MARK: editor

    private var editor: some View {
        Form {
            if let spec = model.spec {
                Section {
                    TextField(T("Range"), text: $rangeText)
                        .font(.system(size: 14, design: .monospaced)).textInputAutocapitalization(.characters).autocorrectionDisabled()
                        .onSubmit { Task { rangeInvalid = !(await model.setRange(rangeText, store)) } }
                    if rangeInvalid { Text(T("Invalid range")).font(NXFont.text(12)).foregroundStyle(NX.danger) }
                } header: {
                    Text(model.sourceName.isEmpty ? T("Data range") : "\(T("Data range")) · \(model.sourceName)")
                }
                if spec.rows.isEmpty && spec.cols.isEmpty && spec.values.isEmpty && !model.suggestions.isEmpty {
                    Section(T("Suggested")) {
                        ForEach(model.suggestions.indices, id: \.self) { i in
                            let s = model.suggestions[i]
                            Button(suggestionLabel(s)) {
                                var next = s.spec
                                next.source = spec.source
                                next.range = spec.range
                                save(next)
                            }
                        }
                    }
                }
                groupSection(T("Rows"), spec.rows, \.rows)
                groupSection(T("Columns"), spec.cols, \.cols)
                valuesSection(spec)
                filtersSection(spec)
                if !(spec.rows.isEmpty && spec.cols.isEmpty && spec.values.isEmpty && spec.filters.isEmpty) {
                    Section {
                        Button(T("Clear all"), role: .destructive) {
                            var next = spec
                            next.rows = []; next.cols = []; next.values = []; next.filters = []
                            save(next)
                        }
                    }
                }
            }
        }
        .disabled(!store.canEdit)
    }

    private func suggestionLabel(_ s: SPPivot.Suggestion) -> String {
        var t = T(s.template)
        for (k, v) in s.vars { t = t.replacingOccurrences(of: "{\(k)}", with: v) }
        return t
    }

    private func save(_ next: SPPivotSpec) { Task { await model.save(next, store) } }

    private func addMenu(_ add: @escaping (String) -> Void) -> some View {
        Menu {
            if model.fields.isEmpty { Text(T("No fields in this range")) }
            ForEach(model.fields.indices, id: \.self) { i in
                Button(model.fields[i].label) { add(model.fields[i].colId) }
            }
        } label: { Label(T("Add field"), systemImage: "plus") }
    }

    private func groupSection(_ title: String, _ list: [SPPivotGroup], _ kp: WritableKeyPath<SPPivotSpec, [SPPivotGroup]>) -> some View {
        Section(title) {
            ForEach(list.indices, id: \.self) { i in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(model.label(list[i].colId)).font(NXFont.text(14, .semibold))
                        Spacer()
                        rowActions(count: list.count, i: i, move: { d in update(kp) { $0.swapAt(i, i + d) } }, remove: { update(kp) { $0.remove(at: i) } })
                    }
                    Picker(T("Order"), selection: Binding(get: { list[i].order ?? "asc" }, set: { v in update(kp) { $0[i].order = v } })) {
                        Text(T("Ascending")).tag("asc")
                        Text(T("Descending")).tag("desc")
                    }
                    Toggle(T("Show totals"), isOn: Binding(get: { list[i].totals != false }, set: { v in update(kp) { $0[i].totals = v } }))
                }
            }
            addMenu { colId in update(kp) { $0.append(SPPivotGroup(colId: colId, order: "asc", totals: true)) } }
        }
    }

    private func valuesSection(_ spec: SPPivotSpec) -> some View {
        Section(T("Values")) {
            ForEach(spec.values.indices, id: \.self) { i in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(model.label(spec.values[i].colId)).font(NXFont.text(14, .semibold))
                        Spacer()
                        rowActions(count: spec.values.count, i: i, move: { d in updateValues { $0.swapAt(i, i + d) } }, remove: { updateValues { $0.remove(at: i) } })
                    }
                    Picker(T("Summarise by"), selection: Binding(get: { spec.values[i].fn }, set: { v in updateValues { $0[i].fn = v } })) {
                        ForEach(SPPivot.FUNCTIONS, id: \.self) { f in Text(f).tag(f) }
                    }
                    Picker(T("Show as"), selection: Binding(get: { spec.values[i].showAs ?? "default" }, set: { v in updateValues { $0[i].showAs = v } })) {
                        Text(T("Default")).tag("default")
                        Text(T("% of row")).tag("row")
                        Text(T("% of column")).tag("col")
                        Text(T("% of grand total")).tag("total")
                    }
                }
            }
            addMenu { colId in
                // A field that looks numeric is summed, anything else counted (web PivotEditor add()).
                let sample = model.values(for: colId).filter { !$0.isEmpty }
                let numeric = !sample.isEmpty && sample.allSatisfy { SheetJS.fullMatch(SheetJS.re("^[-+]?(?:rp\\.?\\s*)?[\\d.,]+%?$", true), SheetJS.trim($0)) }
                updateValues { $0.append(SPPivotValue(colId: colId, fn: numeric ? "SUM" : "COUNTA", showAs: "default")) }
            }
        }
    }

    private func filtersSection(_ spec: SPPivotSpec) -> some View {
        Section(T("Filters")) {
            ForEach(spec.filters.indices, id: \.self) { i in
                let f = spec.filters[i]
                let all = model.values(for: f.colId)
                let hidden = f.hidden ?? []
                NavigationLink {
                    SheetPivotFilterValues(title: model.label(f.colId), values: all, hidden: hidden) { next in
                        updateFilters { $0[i].hidden = next }
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.label(f.colId)).font(NXFont.text(14, .semibold))
                        Text(hidden.isEmpty ? T("Showing all items")
                             : T("Showing %1 of %2 items").replacingOccurrences(of: "%1", with: "\(all.count - hidden.filter { all.contains($0) }.count)")
                                .replacingOccurrences(of: "%2", with: "\(all.count)"))
                            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    }
                }
                .swipeActions { Button(T("Remove"), role: .destructive) { updateFilters { $0.remove(at: i) } } }
            }
            addMenu { colId in updateFilters { $0.append(SPPivotFilter(colId: colId, hidden: [])) } }
        }
    }

    private func rowActions(count: Int, i: Int, move: @escaping (Int) -> Void, remove: @escaping () -> Void) -> some View {
        HStack(spacing: 2) {
            Button { move(-1) } label: { Image(systemName: "chevron.up") }.disabled(i == 0).accessibilityLabel(T("Move up"))
            Button { move(1) } label: { Image(systemName: "chevron.down") }.disabled(i == count - 1).accessibilityLabel(T("Move down"))
            Button(role: .destructive) { remove() } label: { Image(systemName: "xmark") }.accessibilityLabel(T("Remove"))
        }
        .buttonStyle(.borderless)
        .font(.system(size: 13, weight: .semibold))
    }

    private func update(_ kp: WritableKeyPath<SPPivotSpec, [SPPivotGroup]>, _ edit: (inout [SPPivotGroup]) -> Void) {
        guard var next = model.spec else { return }
        edit(&next[keyPath: kp])
        save(next)
    }

    private func updateValues(_ edit: (inout [SPPivotValue]) -> Void) {
        guard var next = model.spec else { return }
        edit(&next.values)
        save(next)
    }

    private func updateFilters(_ edit: (inout [SPPivotFilter]) -> Void) {
        guard var next = model.spec else { return }
        edit(&next.filters)
        save(next)
    }
}

/// "Filter by values": tick the values to show.
private struct SheetPivotFilterValues: View {
    let title: String
    let values: [String]
    @State var hidden: Set<String>
    let onChange: ([String]) -> Void
    @State private var query = ""

    init(title: String, values: [String], hidden: [String], onChange: @escaping ([String]) -> Void) {
        self.title = title
        self.values = values
        _hidden = State(initialValue: Set(hidden))
        self.onChange = onChange
    }

    private var shown: [String] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? values : values.filter { $0.lowercased().contains(q) }
    }

    var body: some View {
        List {
            Section {
                Button(T("Select all")) { hidden = []; commit() }
                Button(T("Clear")) { hidden = Set(values); commit() }
            }
            Section {
                if shown.isEmpty { Text(T("No matching values")).foregroundStyle(NX.mutedFg) }
                ForEach(shown, id: \.self) { v in
                    Button {
                        if hidden.contains(v) { hidden.remove(v) } else { hidden.insert(v) }
                        commit()
                    } label: {
                        HStack {
                            Text(v.isEmpty ? T("(Blanks)") : v).foregroundStyle(NX.foreground)
                            Spacer()
                            if !hidden.contains(v) { Image(systemName: "checkmark").foregroundStyle(NX.violetText) }
                        }
                    }
                }
            }
        }
        .searchable(text: $query, prompt: T("Search"))
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func commit() { onChange(values.filter { hidden.contains($0) }) }
}
