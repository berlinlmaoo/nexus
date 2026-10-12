import SwiftUI

/// A column's filter menu, like Sheets' (web FilterMenu.tsx): Sort A → Z / Z → A, Filter by colour, Filter
/// by condition and Filter by values (Select all / Clear, "Showing N", search, a checklist with counts and
/// "(Blanks)"), then Cancel / OK. A custom-formula condition is typed in display form ("=C2>10"); the store
/// saves it in the stored form like other formulas.
struct SheetFilterMenu: View {
    let data: SheetStore.FilterMenuData
    let canEdit: Bool
    let onSort: (Bool) -> Void
    let onApply: (SheetFilter.Crit?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var hidden: Set<String>
    @State private var kind: String
    @State private var value1: String
    @State private var value2: String
    @State private var dateMode: String
    @State private var formula: String
    @State private var fill: String?
    @State private var textColor: String?
    @State private var query = ""

    /// web ConditionalFormatPanel COND_OPTIONS / COND_LABEL (nil = a divider).
    static let kinds: [(String, String)] = [
        ("empty", "Is empty"), ("notEmpty", "Is not empty"), ("textContains", "Text contains"),
        ("textNotContains", "Text does not contain"), ("textStarts", "Text starts with"), ("textEnds", "Text ends with"),
        ("textIs", "Text is exactly"), ("dateIs", "Date is"), ("dateBefore", "Date is before"), ("dateAfter", "Date is after"),
        ("gt", "Greater than"), ("gte", "Greater than or equal to"), ("lt", "Less than"), ("lte", "Less than or equal to"),
        ("eq", "Is equal to"), ("neq", "Is not equal to"), ("between", "Is between"), ("notBetween", "Is not between"),
        ("formula", "Custom formula is"),
    ]
    static let dateModes: [(String, String)] = [
        ("today", "Today"), ("tomorrow", "Tomorrow"), ("yesterday", "Yesterday"), ("week", "In the past week"),
        ("month", "In the past month"), ("year", "In the past year"), ("exact", "Exact date"),
    ]
    private static let oneValue: Set<String> = ["textContains", "textNotContains", "textStarts", "textEnds", "textIs", "dateIs", "dateBefore", "dateAfter",
                                                "gt", "gte", "lt", "lte", "eq", "neq"]
    private static let twoValues: Set<String> = ["between", "notBetween"]
    private static func isDate(_ k: String) -> Bool { k == "dateIs" || k == "dateBefore" || k == "dateAfter" }

    init(data: SheetStore.FilterMenuData, canEdit: Bool, onSort: @escaping (Bool) -> Void, onApply: @escaping (SheetFilter.Crit?) -> Void) {
        self.data = data
        self.canEdit = canEdit
        self.onSort = onSort
        self.onApply = onApply
        _hidden = State(initialValue: Set(data.crit?.hidden ?? []))
        _fill = State(initialValue: data.crit?.fill)
        _textColor = State(initialValue: data.crit?.text)
        // condDraft (web): a date condition stores [mode] or [exact date] / ["exact", date].
        let c = data.crit?.cond
        let v = c?.values ?? []
        var k = c?.kind ?? "none"
        var v1 = "", v2 = "", mode = "today", f = ""
        if let c {
            if Self.isDate(c.kind) {
                let known = Self.dateModes.first { $0.0 == v.first }?.0
                mode = known ?? ((v.first ?? "").isEmpty ? "today" : "exact")
                v1 = mode == "exact" ? (known != nil ? (v.count > 1 ? v[1] : "") : (v.first ?? "")) : ""
            } else {
                v1 = v.first ?? ""
                v2 = v.count > 1 ? v[1] : ""
                f = c.formula ?? ""
            }
        } else {
            k = "none"
        }
        _kind = State(initialValue: k)
        _value1 = State(initialValue: v1)
        _value2 = State(initialValue: v2)
        _dateMode = State(initialValue: mode)
        _formula = State(initialValue: f)
    }

    /// One distinct value of the column ("" = blanks) and how many rows show it.
    private struct ValueRow: Identifiable {
        let text: String
        let count: Int
        var id: String { text }
    }

    private var allRows: [ValueRow] { data.values.map { ValueRow(text: $0.text, count: $0.count) } }

    private var shown: [ValueRow] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return allRows }
        return allRows.filter { ($0.text.isEmpty ? T("(Blanks)") : $0.text).lowercased().contains(q) }
    }

    var body: some View {
        NavigationStack {
            List {
                if canEdit {
                    Section {
                        Button { onSort(true); dismiss() } label: { Label(T("Sort A → Z"), systemImage: "arrow.up") }
                        Button { onSort(false); dismiss() } label: { Label(T("Sort Z → A"), systemImage: "arrow.down") }
                    }
                }
                if !data.fills.isEmpty || !data.texts.isEmpty || fill != nil || textColor != nil {
                    colourSection
                }
                conditionSection
                valuesSection
            }
            .navigationTitle(data.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(T("OK")) { apply() }.disabled(!canEdit) }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder private var colourSection: some View {
        Section(T("Filter by colour")) {
            colourPicker(T("Fill colour"), options: data.fills, selection: $fill)
            colourPicker(T("Text colour"), options: data.texts, selection: $textColor)
        }
    }

    private func colourPicker(_ title: String, options: [String], selection: Binding<String?>) -> some View {
        Picker(title, selection: selection) {
            Text(T("None")).tag(String?.none)
            ForEach(options, id: \.self) { hex in
                HStack {
                    Circle().fill(Color(uiColor: SheetBridge.hexColor(hex) ?? .clear)).frame(width: 14, height: 14)
                    Text(hex).font(.system(size: 13, design: .monospaced))
                }
                .tag(String?.some(hex))
            }
        }
    }

    @ViewBuilder private var conditionSection: some View {
        Section(T("Filter by condition")) {
            Picker(T("Condition"), selection: $kind) {
                Text(T("None")).tag("none")
                ForEach(Self.kinds.indices, id: \.self) { i in Text(T(Self.kinds[i].1)).tag(Self.kinds[i].0) }
            }
            if Self.isDate(kind) {
                Picker(T("Date"), selection: $dateMode) {
                    ForEach(Self.dateModes.indices, id: \.self) { i in Text(T(Self.dateModes[i].1)).tag(Self.dateModes[i].0) }
                }
                if dateMode == "exact" {
                    TextField("11/10/2026", text: $value1).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
            } else if Self.oneValue.contains(kind) || Self.twoValues.contains(kind) {
                TextField(T("Value or formula"), text: $value1).textInputAutocapitalization(.never).autocorrectionDisabled()
                if Self.twoValues.contains(kind) {
                    TextField(T("Value or formula"), text: $value2).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
            } else if kind == "formula" {
                TextField("=C2>10", text: $formula)
                    .font(.system(size: 14, design: .monospaced))
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
            }
        }
        .onChange(of: kind) { _, _ in
            value1 = ""
            value2 = ""
            dateMode = "today"
            formula = ""
        }
    }

    @ViewBuilder private var valuesSection: some View {
        Section {
            HStack(spacing: 12) {
                Button(T("Select all (%d)").replacingOccurrences(of: "%d", with: "\(shown.count)")) {
                    for v in shown { hidden.remove(v.text) }
                }
                .buttonStyle(.borderless)
                Button(T("Clear")) {
                    for v in shown { hidden.insert(v.text) }
                }
                .buttonStyle(.borderless)
                Spacer()
                Text(T("Showing %d").replacingOccurrences(of: "%d", with: "\(shown.count)"))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            .font(NXFont.text(13, .medium))
            TextField(T("Search values"), text: $query).textInputAutocapitalization(.never).autocorrectionDisabled()
            if data.values.isEmpty {
                EmptyState(icon: "line.3.horizontal.decrease", title: T("No values yet"),
                           subtitle: T("The rows under this filter's header are empty."), compact: true)
            } else if shown.isEmpty {
                Text(T("No matching values")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }
            ForEach(shown) { v in
                Button {
                    if hidden.contains(v.text) { hidden.remove(v.text) } else { hidden.insert(v.text) }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: hidden.contains(v.text) ? "square" : "checkmark.square.fill")
                            .foregroundStyle(hidden.contains(v.text) ? NX.mutedFg : NX.violetText)
                        Text(v.text.isEmpty ? T("(Blanks)") : v.text)
                            .font(NXFont.text(14))
                            .italic(v.text.isEmpty)
                            .foregroundStyle(v.text.isEmpty ? NX.mutedFg : NX.foreground)
                            .lineLimit(1)
                        Spacer()
                        Text("\(v.count)").font(NXFont.text(12)).foregroundStyle(NX.mutedFg).monospacedDigit()
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        } header: {
            Text(T("Filter by values"))
        }
    }

    /// condOut (web): the condition as stored, or nil.
    private var condition: SheetFilter.Crit.Cond? {
        switch kind {
        case "none": return nil
        case "formula":
            let f = formula.trimmingCharacters(in: .whitespaces)
            return f.isEmpty ? nil : SheetFilter.Crit.Cond(kind: "formula", formula: f)
        default:
            let a = value1.trimmingCharacters(in: .whitespaces), b = value2.trimmingCharacters(in: .whitespaces)
            if Self.isDate(kind) { return SheetFilter.Crit.Cond(kind: kind, values: dateMode == "exact" ? [a] : [dateMode]) }
            if Self.twoValues.contains(kind) { return SheetFilter.Crit.Cond(kind: kind, values: [a, b]) }
            if Self.oneValue.contains(kind) { return SheetFilter.Crit.Cond(kind: kind, values: [a]) }
            return SheetFilter.Crit.Cond(kind: kind)
        }
    }

    private func apply() {
        var next = SheetFilter.Crit()
        let h = data.values.map { $0.text }.filter { hidden.contains($0) }
        if !h.isEmpty { next.hidden = h }
        next.cond = condition
        next.fill = fill
        next.text = textColor
        onApply(SheetFilter.critActive(next) ? next : nil)
        dismiss()
    }
}
