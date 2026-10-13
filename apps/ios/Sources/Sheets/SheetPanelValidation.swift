import SwiftUI

// Data ▸ Data validation (web DataValidationPanel.tsx + SheetGrid saveRuleFromPanel / removeRuleFromPanel): the
// sheet's rules as a list, "Add rule", and per rule: Apply to range (one or more), Criteria, the criteria's
// own fields (dropdown items with colour chip, a range of items, values, a checkbox's custom cell values, a
// custom formula), Advanced options (warning vs reject, help text, chip / arrow / plain), Remove rule / Done.
// Explicit rules live in settings.validations; a Dropdown / Multi-select COLUMN reads as a rule over its
// whole column — editing it edits the column's choices, removing it turns the column back into text.

private typealias VKind = SheetValidation.ValidationKind

private enum DV {
    static let CRITERIA: [(group: String, kinds: [(VKind, String)])] = [
        ("Dropdown", [(.list, "Dropdown"), (.listRange, "Dropdown (from a range)")]),
        ("Text", [(.textContains, "Text contains"), (.textNotContains, "Text does not contain"), (.textIs, "Text is exactly"),
                  (.email, "Text is valid email"), (.url, "Text is valid URL")]),
        ("Date", [(.dateValid, "Is valid date"), (.dateIs, "Date is"), (.dateBefore, "Date is before"), (.dateAfter, "Date is after"),
                  (.dateBetween, "Date is between")]),
        ("Number", [(.gt, "Greater than"), (.gte, "Greater than or equal to"), (.lt, "Less than"), (.lte, "Less than or equal to"),
                    (.eq, "Is equal to"), (.neq, "Is not equal to"), (.between, "Is between"), (.notBetween, "Is not between")]),
        ("Other", [(.checkbox, "Checkbox"), (.formula, "Custom formula is")]),
    ]
    static func label(_ k: VKind) -> String {
        for g in CRITERIA { if let hit = g.kinds.first(where: { $0.0 == k }) { return hit.1 } }
        return k.rawValue
    }
    static let TWO_VALUES: [VKind] = [.between, .notBetween, .dateBetween]
    static let ONE_VALUE: [VKind] = [.textContains, .textNotContains, .textIs, .dateIs, .dateBefore, .dateAfter, .gt, .gte, .lt, .lte, .eq, .neq]

    /// A chip colour → the column-option colour a dropdown COLUMN can store (web toColumnColor).
    static func columnColor(_ c: String) -> String? {
        let map = ["red": "rose", "pink": "rose", "rose": "rose", "orange": "amber", "amber": "amber", "green": "green", "teal": "green",
                   "blue": "blue", "violet": "violet", "slate": "slate", "black": "slate"]
        return map[c]
    }
}

/// A rule as the panel lists it: an explicit rule, or a dropdown column's.
private struct DVRule: Identifiable {
    var rule: SheetValidation.ValidationRule
    var columnId: String?
    var id: String { rule.id }
}

private struct DVItem: Identifiable, Equatable {
    let id = UUID()
    var value: String
    var color: String?
}

private struct DVDraft {
    var id: String
    var isNew: Bool
    var columnId: String?
    var ranges: [String]
    var kind: VKind
    var items: [DVItem]
    var v1 = ""
    var v2 = ""
    var source = ""
    var formula = ""
    var multiple = false
    var strict = false
    var display = "chip"
    var helpOn = false
    var help = ""
    var customCheckbox = false
    var checked = ""
    var unchecked = ""
}

struct SheetValidationPanel: View {
    let ctx: SheetPanelContext
    @Environment(\.dismiss) private var dismiss
    @State private var draft: DVDraft?
    @State private var errors: [String: String] = [:]
    @State private var removing = false
    @State private var advanced = false

    private var store: SheetStore { ctx.store }
    private var shape: SheetShape { store.panelShape }

    private var explicitRules: [SheetValidation.ValidationRule] {
        store.panelList("validations").compactMap { SheetValidation.ValidationRule(json: $0) }
    }

    private var rules: [DVRule] {
        var out: [DVRule] = []
        for col in store.panelColumns where col.type == "select" || col.type == "multiselect" {
            let opts = col.options ?? []
            var colors: [String: String] = [:]
            for (i, o) in opts.enumerated() { colors[o] = col.optionColors?[o] ?? SheetTypes.CHIP_COLORS[i % SheetTypes.CHIP_COLORS.count] }
            let r = SheetValidation.ValidationRule(id: "col:\(col.id)", ranges: ["{\(col.id)!*}:{\(col.id)!*}"], kind: .list, values: opts,
                                                   colors: colors, multiple: col.type == "multiselect", display: "chip")
            out.append(DVRule(rule: r, columnId: col.id))
        }
        out += explicitRules.map { DVRule(rule: $0, columnId: nil) }
        return out
    }

    var body: some View {
        NavigationStack {
            Group {
                if draft != nil { editor } else { list }
            }
            .navigationTitle(T("Data validation rules"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .alert(T("Remove this rule?"), isPresented: $removing) {
                Button(T("Remove rule"), role: .destructive) { Task { await remove() } }
                Button(T("Cancel"), role: .cancel) {}
            } message: {
                Text(draft?.columnId != nil ? T("The column turns back into a plain text column; its values stay.")
                     : T("The cells keep their values; they're just no longer checked."))
            }
        }
        .spPanelPresentation()
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        if draft != nil {
            ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { draft = nil; errors = [:] } }
            if store.canEdit { ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { Task { await save() } } } }
        } else {
            ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { dismiss() } }
        }
    }

    // MARK: list

    private var list: some View {
        List {
            if rules.isEmpty {
                EmptyState(icon: "checklist", title: T("No rules yet"),
                           subtitle: T("Select cells, then add a rule: a dropdown, a checkbox, or a check on text, dates or numbers."),
                           actionTitle: store.canEdit ? T("Add rule") : nil) { newRule() }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
            } else {
                ForEach(rules) { r in
                    Button { edit(r) } label: { ruleRow(r) }.buttonStyle(.plain)
                }
                if store.canEdit {
                    Button { newRule() } label: { Label(T("Add rule"), systemImage: "plus") }
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func ruleRow(_ r: DVRule) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(r.rule.ranges.map { "\(store.name)!\(SheetValidation.rangeToA1($0, shape))" }.joined(separator: ", "))
                .font(.system(size: 11, design: .monospaced)).foregroundStyle(NX.mutedFg).lineLimit(1)
            Text(summary(r.rule)).font(NXFont.text(14, .medium)).lineLimit(2)
            if r.rule.kind == .list, let vals = r.rule.values, !vals.isEmpty {
                HStack(spacing: 4) {
                    ForEach(Array(vals.prefix(5).enumerated()), id: \.offset) { _, v in
                        Text(v).font(NXFont.text(11, .medium)).lineLimit(1)
                            .foregroundStyle(SheetChip.textColor(r.rule.colors?[v]))
                            .padding(.horizontal, 7).padding(.vertical, 2)
                            .background(SheetChip.fillColor(r.rule.colors?[v]), in: Capsule())
                    }
                    if vals.count > 5 { Text("+\(vals.count - 5)").font(NXFont.text(11)).foregroundStyle(NX.mutedFg) }
                }
            }
            if r.columnId != nil { Text(T("Dropdown column")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private func summary(_ r: SheetValidation.ValidationRule) -> String {
        switch r.kind {
        case .list: return T("Dropdown")
        case .listRange: return "\(T("Dropdown (from a range)")): \(r.source.map { SheetValidation.rangeToA1($0, shape) } ?? "")"
        case .formula: return "\(T("Custom formula is")) \(r.formula.map { SheetFormula.toDisplay($0, shape) } ?? "")"
        default:
            let v = r.values ?? []
            return v.isEmpty ? T(DV.label(r.kind)) : "\(T(DV.label(r.kind))) \(v.joined(separator: " \(T("and")) "))"
        }
    }

    // MARK: editor

    private var editor: some View {
        Form {
            if let d = draft { editorSections(d) }
        }
    }

    private func binding<V>(_ kp: WritableKeyPath<DVDraft, V>, _ fallback: V) -> Binding<V> {
        Binding(get: { draft?[keyPath: kp] ?? fallback }, set: { draft?[keyPath: kp] = $0 })
    }

    @ViewBuilder private func editorSections(_ d: DVDraft) -> some View {
        let locked = !store.canEdit || d.columnId != nil
        Section {
            ForEach(d.ranges.indices, id: \.self) { i in
                HStack {
                    SPRangeField(title: T("Apply to range"), text: Binding(get: { draft.flatMap { i < $0.ranges.count ? $0.ranges[i] : nil } ?? "" }, set: { draft?.ranges[i] = $0 }),
                                 selection: store.panelSelectionA1, invalid: errors["range\(i)"] != nil, disabled: locked)
                    if d.ranges.count > 1 && !locked {
                        Button { draft?.ranges.remove(at: i) } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg) }
                            .buttonStyle(.borderless).accessibilityLabel(T("Remove range"))
                    }
                }
            }
            if !locked { Button(T("Add another range")) { draft?.ranges.append("") } }
        } header: { Text(T("Apply to range")) } footer: {
            if d.columnId != nil { Text(T("This dropdown comes from the column's type, so it covers the whole column.")) }
        }

        Section(T("Criteria")) {
            Picker(T("Criteria"), selection: Binding(get: { draft?.kind ?? .list }, set: { setKind($0) })) {
                ForEach(DV.CRITERIA.indices, id: \.self) { gi in
                    Section(T(DV.CRITERIA[gi].group)) {
                        ForEach(DV.CRITERIA[gi].kinds.indices, id: \.self) { ki in
                            Text(T(DV.CRITERIA[gi].kinds[ki].1)).tag(DV.CRITERIA[gi].kinds[ki].0)
                        }
                    }
                }
            }
            .disabled(locked)
            criteriaFields(d)
        }

        if d.columnId == nil {
            Section {
                DisclosureGroup(T("Advanced options"), isExpanded: $advanced) {
                    Toggle(T("Show help text for a selected cell"), isOn: binding(\.helpOn, false))
                    if d.helpOn {
                        TextField(T("Enter help text"), text: binding(\.help, ""), axis: .vertical).lineLimit(2...4)
                    }
                    Picker(T("If the data is invalid:"), selection: binding(\.strict, false)) {
                        Text(T("Show a warning")).tag(false)
                        Text(T("Reject the input")).tag(true)
                    }
                    if d.kind == .list || d.kind == .listRange {
                        Picker(T("Display style"), selection: binding(\.display, "chip")) {
                            Text(T("Chip")).tag("chip")
                            Text(T("Arrow")).tag("arrow")
                            Text(T("Plain text")).tag("plain")
                        }
                    }
                }
                .disabled(!store.canEdit)
            }
        }

        if store.canEdit {
            Section {
                Button(T("Remove rule"), role: .destructive) { if d.isNew { draft = nil } else { removing = true } }
            }
        }
    }

    @ViewBuilder private func criteriaFields(_ d: DVDraft) -> some View {
        switch d.kind {
        case .list:
            ForEach(d.items) { it in itemRow(it) }
                .onMove { from, to in draft?.items.move(fromOffsets: from, toOffset: to) }
                .onDelete { idx in draft?.items.remove(atOffsets: idx) }
            if store.canEdit { Button(T("Add another item")) { draft?.items.append(DVItem(value: "")) } }
            Toggle(T("Allow multiple selections"), isOn: binding(\.multiple, false)).disabled(!store.canEdit)
        case .listRange:
            SPRangeField(title: T("Range of items"), text: binding(\.source, ""), selection: store.panelSelectionA1,
                         invalid: errors["source"] != nil, disabled: !store.canEdit, placeholder: "A2:A20")
            Toggle(T("Allow multiple selections"), isOn: binding(\.multiple, false)).disabled(!store.canEdit)
        case .formula:
            TextField("=A2>0", text: binding(\.formula, ""))
                .font(.system(size: 14, design: .monospaced)).textInputAutocapitalization(.never).autocorrectionDisabled()
                .disabled(!store.canEdit)
            Text(T("Written for the first cell of the range; it shifts for the others, like a filled formula.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            if let e = errors["formula"] { Text(e).font(NXFont.text(12)).foregroundStyle(NX.danger) }
        case .checkbox:
            Toggle(T("Use custom cell values"), isOn: binding(\.customCheckbox, false)).disabled(!store.canEdit)
            if d.customCheckbox {
                TextField(T("Ticked"), text: binding(\.checked, "")).disabled(!store.canEdit)
                TextField(T("Unticked"), text: binding(\.unchecked, "")).disabled(!store.canEdit)
            }
        default:
            if DV.ONE_VALUE.contains(d.kind) || DV.TWO_VALUES.contains(d.kind) {
                let date = d.kind.rawValue.hasPrefix("date")
                TextField(date ? "11/10/2026" : T("Value or formula"), text: binding(\.v1, "")).disabled(!store.canEdit)
                if DV.TWO_VALUES.contains(d.kind) {
                    TextField(date ? "31/10/2026" : T("Second value"), text: binding(\.v2, "")).disabled(!store.canEdit)
                }
                if let e = errors["value"] { Text(e).font(NXFont.text(12)).foregroundStyle(NX.danger) }
            }
        }
    }

    private func itemRow(_ it: DVItem) -> some View {
        HStack(spacing: 8) {
            Menu {
                ForEach(SPColors.STYLE_COLORS.indices, id: \.self) { ci in
                    Button(T(SPColors.STYLE_COLORS[ci].name)) { setItem(it.id) { $0.color = SPColors.STYLE_COLORS[ci].key } }
                }
                Button(T("Default (grey)")) { setItem(it.id) { $0.color = nil } }
            } label: {
                Circle().fill(it.color == nil ? NX.muted : SPColors.color(it.color)).frame(width: 20, height: 20)
                    .overlay(Circle().strokeBorder(NX.border))
            }
            .disabled(!store.canEdit)
            .accessibilityLabel(T("Chip colour"))
            TextField(T("Value"), text: Binding(get: { draft?.items.first { $0.id == it.id }?.value ?? "" },
                                               set: { v in setItem(it.id) { $0.value = v } }))
                .disabled(!store.canEdit)
        }
    }

    private func setItem(_ id: UUID, _ edit: (inout DVItem) -> Void) {
        guard let i = draft?.items.firstIndex(where: { $0.id == id }) else { return }
        edit(&draft!.items[i])
    }

    private func setKind(_ k: VKind) {
        guard var d = draft else { return }
        d.kind = k
        d.v1 = ""
        d.v2 = ""
        if k == .list && d.items.isEmpty { d.items = [DVItem(value: T("Option 1")), DVItem(value: T("Option 2"))] }
        draft = d
        errors = [:]
    }

    // MARK: actions

    private func newRule() {
        let sel = SheetValidation.rangeFromA1(store.panelSelectionA1, shape).map { SheetValidation.rangeToA1($0, shape) } ?? ""
        draft = DVDraft(id: "v_" + String(SPChart.newId("x").dropFirst(2)), isNew: true, columnId: nil, ranges: [sel], kind: .list,
                        items: [DVItem(value: T("Option 1")), DVItem(value: T("Option 2"))])
        errors = [:]
        advanced = false
    }

    private func edit(_ r: DVRule) {
        let rule = r.rule
        var d = DVDraft(id: rule.id, isNew: false, columnId: r.columnId, ranges: rule.ranges.map { SheetValidation.rangeToA1($0, shape) },
                        kind: rule.kind,
                        items: rule.kind == .list ? (rule.values ?? []).map { DVItem(value: $0, color: rule.colors?[$0]) } : [])
        let vals = rule.kind == .list ? [] : (rule.values ?? [])
        d.v1 = vals.first ?? ""
        d.v2 = vals.count > 1 ? vals[1] : ""
        d.source = rule.source.map { SheetValidation.rangeToA1($0, shape) } ?? ""
        d.formula = rule.formula.map { SheetFormula.toDisplay($0, shape) } ?? ""
        d.multiple = rule.multiple == true
        d.strict = rule.strict == true
        d.display = rule.display ?? "chip"
        d.helpOn = !(rule.help ?? "").isEmpty
        d.help = rule.help ?? ""
        d.customCheckbox = rule.checked != nil || rule.unchecked != nil
        d.checked = rule.checked ?? ""
        d.unchecked = rule.unchecked ?? ""
        draft = d
        errors = [:]
        advanced = false
    }

    private func save() async {
        guard let d = draft else { return }
        var errs: [String: String] = [:]
        var ranges: [String] = []
        for (i, r) in d.ranges.enumerated() {
            if let s = SheetValidation.rangeFromA1(r, shape) { ranges.append(s) } else { errs["range\(i)"] = T("Invalid range") }
        }
        var source: String?
        if d.kind == .listRange {
            source = SheetValidation.rangeFromA1(d.source, shape)
            if source == nil { errs["source"] = T("Invalid range") }
        }
        var formula: String?
        if d.kind == .formula {
            let f = d.formula.trimmingCharacters(in: .whitespaces)
            if f.isEmpty { errs["formula"] = T("Enter a formula") } else { formula = SheetFormula.toStored(f.hasPrefix("=") ? f : "=\(f)", shape) }
        }
        let a = d.v1.trimmingCharacters(in: .whitespaces), b = d.v2.trimmingCharacters(in: .whitespaces)
        if DV.ONE_VALUE.contains(d.kind) && a.isEmpty { errs["value"] = T("Enter a value") }
        if DV.TWO_VALUES.contains(d.kind) && (a.isEmpty || b.isEmpty) { errs["value"] = T("Enter both values") }
        errors = errs
        if !errs.isEmpty { return }

        let items = d.items.map { DVItem(value: $0.value.trimmingCharacters(in: .whitespaces), color: $0.color) }.filter { !$0.value.isEmpty }
        var unique: [String] = []
        for it in items where !unique.contains(it.value) { unique.append(it.value) }
        var rule = SheetValidation.ValidationRule(id: d.id, ranges: ranges, kind: d.kind)
        let dropdown = d.kind == .list || d.kind == .listRange
        if d.kind == .list {
            rule.values = unique
            var colors: [String: String] = [:]
            for it in items { if let c = it.color { colors[it.value] = c } }
            if !colors.isEmpty { rule.colors = colors }
        }
        if DV.ONE_VALUE.contains(d.kind) { rule.values = [a] }
        if DV.TWO_VALUES.contains(d.kind) { rule.values = [a, b] }
        rule.source = source
        rule.formula = formula
        if dropdown && d.multiple { rule.multiple = true }
        if d.strict { rule.strict = true }
        if dropdown && d.display != "chip" { rule.display = d.display }
        let help = d.help.trimmingCharacters(in: .whitespacesAndNewlines)
        if d.helpOn && !help.isEmpty { rule.help = String(help.prefix(500)) }
        if d.kind == .checkbox && d.customCheckbox {
            let on = d.checked.trimmingCharacters(in: .whitespaces), off = d.unchecked.trimmingCharacters(in: .whitespaces)
            rule.checked = on.isEmpty ? "TRUE" : on
            rule.unchecked = off.isEmpty ? "FALSE" : off
        }

        if let colId = d.columnId {
            let finalRule = rule
            await store.panelPatchColumn(colId, label: T("data validation"), pushUndo: ctx.pushUndo) { col in
                var next = col
                next["type"] = finalRule.multiple == true ? "multiselect" : "select"
                next["options"] = finalRule.values ?? []
                var oc: [String: String] = [:]
                for (k, v) in finalRule.colors ?? [:] { if let c = DV.columnColor(v) { oc[k] = c } }
                next["optionColors"] = oc
                return next
            }
        } else {
            var list = store.panelList("validations")
            if let i = list.firstIndex(where: { ($0["id"] as? String) == rule.id }) { list[i] = rule.json } else { list.append(rule.json) }
            await store.panelSaveSettings(["validations": list], label: T("data validation"), pushUndo: ctx.pushUndo)
        }
        draft = nil
    }

    private func remove() async {
        guard let d = draft else { return }
        if let colId = d.columnId {
            await store.panelPatchColumn(colId, label: T("remove data validation"), pushUndo: ctx.pushUndo) { col in
                var next = col
                next["type"] = "text"
                return next
            }
        } else {
            let list = store.panelList("validations").filter { ($0["id"] as? String) != d.id }
            await store.panelSaveSettings(["validations": SheetPanelAPI.orNull(list)], label: T("remove data validation"), pushUndo: ctx.pushUndo)
        }
        draft = nil
    }
}
