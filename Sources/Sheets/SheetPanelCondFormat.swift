import SwiftUI

// Format ▸ Conditional formatting (web ConditionalFormatPanel.tsx) and Format ▸ Alternating colours (web
// AlternatingColorsPanel.tsx). Rules live in settings.condFormats (the FIRST matching single-colour rule wins,
// so the list's order is priority), bandings in settings.bandings.

private enum CF {
    static let OPTIONS: [[String]] = [
        ["empty", "notEmpty", "textContains", "textNotContains", "textStarts", "textEnds", "textIs"],
        ["dateIs", "dateBefore", "dateAfter"],
        ["gt", "gte", "lt", "lte", "eq", "neq", "between", "notBetween"],
        ["formula"],
    ]
    static let LABEL: [String: String] = [
        "empty": "Is empty", "notEmpty": "Is not empty", "textContains": "Text contains", "textNotContains": "Text does not contain",
        "textStarts": "Text starts with", "textEnds": "Text ends with", "textIs": "Text is exactly", "dateIs": "Date is",
        "dateBefore": "Date is before", "dateAfter": "Date is after", "gt": "Greater than", "gte": "Greater than or equal to",
        "lt": "Less than", "lte": "Less than or equal to", "eq": "Is equal to", "neq": "Is not equal to", "between": "Is between",
        "notBetween": "Is not between", "formula": "Custom formula is",
    ]
    static let DATE_MODES: [(String, String)] = [
        ("today", "Today"), ("tomorrow", "Tomorrow"), ("yesterday", "Yesterday"), ("week", "In the past week"),
        ("month", "In the past month"), ("year", "In the past year"), ("exact", "Exact date"),
    ]
    static func isDateKind(_ k: String) -> Bool { k == "dateIs" || k == "dateBefore" || k == "dateAfter" }

    static func describe(_ r: SheetCF.CondRule, _ shape: SheetShape) -> String {
        if r.type == "scale" { return T("Colour scale") }
        let k = r.cond ?? "notEmpty"
        if k == "empty" { return T("Cell is empty") }
        if k == "notEmpty" { return T("Cell is not empty") }
        if k == "formula" { return "\(T("Custom formula is")) \(r.formula.map { SheetFormula.toDisplay($0, shape) } ?? "")" }
        let v = r.values ?? []
        let label = T(LABEL[k] ?? k)
        if isDateKind(k) {
            let mode = DATE_MODES.first { $0.0 == v.first }
            let what = mode.map { $0.0 != "exact" ? T($0.1) : (v.count > 1 ? v[1] : "") } ?? (v.first ?? "")
            return SheetJS.trim("\(label) \(what)")
        }
        return SheetJS.trim("\(label) \(v.filter { !$0.isEmpty }.joined(separator: " \(T("and")) "))")
    }

    static func scaleColors(_ s: SheetCF.Scale) -> [String] {
        if let m = s.mid, m.type != "none" { return [s.min.color, m.color, s.max.color] }
        return [s.min.color, s.max.color]
    }
}

private struct CFDraft {
    var id: String
    var isNew: Bool
    var ranges: String
    var type: String
    var cond: String
    var v1: String
    var v2: String
    var dateMode: String
    var formula: String
    var style: SheetCF.CondStyle
    var scale: SheetCF.Scale

    static let defaultScale = SheetCF.Scale(min: SheetCF.ScalePoint(type: "min", color: "#ffffff"),
                                            mid: SheetCF.ScalePoint(type: "none", color: SheetCF.interpolateHex("#ffffff", "#57bb8a", 0.5)),
                                            max: SheetCF.ScalePoint(type: "max", color: "#57bb8a"))

    init(rule r: SheetCF.CondRule, shape: SheetShape, isNew: Bool) {
        id = r.id
        self.isNew = isNew
        ranges = r.ranges.map { SheetValidation.rangeToA1($0, shape) }.joined(separator: ", ")
        type = r.type
        cond = r.cond ?? "notEmpty"
        let v = r.values ?? []
        v1 = v.first ?? ""
        v2 = v.count > 1 ? v[1] : ""
        dateMode = "today"
        if CF.isDateKind(cond) {
            let known = CF.DATE_MODES.contains { $0.0 == v.first }
            dateMode = known ? (v.first ?? "today") : (v.first.map { $0.isEmpty ? "today" : "exact" } ?? "today")
            v1 = dateMode == "exact" ? (known ? (v.count > 1 ? v[1] : "") : (v.first ?? "")) : ""
            v2 = ""
        }
        formula = r.formula.map { SheetFormula.toDisplay($0, shape) } ?? ""
        style = r.style ?? SheetCF.DEFAULT_COND_STYLE
        if var sc = r.scale {
            if sc.mid == nil { sc.mid = CFDraft.defaultScale.mid }
            scale = sc
        } else {
            scale = CFDraft.defaultScale
        }
    }

    /// The draft as a rule, and what's missing (web fromDraft with strict).
    func rule(_ shape: SheetShape) -> (rule: SheetCF.CondRule?, errors: [String: String]) {
        var errors: [String: String] = [:]
        let parts = ranges.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let stored = parts.map { SheetValidation.rangeFromA1($0, shape) }
        if parts.isEmpty || stored.contains(where: { $0 == nil }) { errors["range"] = T("Invalid range") }
        let valid = stored.compactMap { $0 }
        if valid.isEmpty { return (nil, errors) }
        if type == "scale" {
            func needs(_ p: SheetCF.ScalePoint) -> Bool { ["num", "pct", "pctile"].contains(p.type) && (p.value ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
            if needs(scale.min) || needs(scale.max) || (scale.mid.map(needs) ?? false) { errors["value"] = T("Enter a value") }
            var sc = scale
            if let m = sc.mid, m.type == "none" { sc.mid = nil }
            return (SheetCF.CondRule(id: id, ranges: valid, type: "scale", scale: sc), errors)
        }
        var values: [String]?
        var f: String?
        let a = v1.trimmingCharacters(in: .whitespaces), b = v2.trimmingCharacters(in: .whitespaces)
        if cond == "formula" {
            let x = formula.trimmingCharacters(in: .whitespaces)
            if x.isEmpty { errors["formula"] = T("Enter a formula") } else { f = SheetFormula.toStored(x.hasPrefix("=") ? x : "=\(x)", shape) }
        } else if CF.isDateKind(cond) {
            if dateMode == "exact" {
                if a.isEmpty { errors["value"] = T("Enter a value") }
                values = [a]
            } else {
                values = [dateMode]
            }
        } else if SheetCF.COND_TWO_VALUES.contains(cond) {
            if a.isEmpty || b.isEmpty { errors["value"] = T("Enter both values") }
            values = [a, b]
        } else if SheetCF.COND_ONE_VALUE.contains(cond) {
            if a.isEmpty { errors["value"] = T("Enter a value") }
            values = [a]
        }
        return (SheetCF.CondRule(id: id, ranges: valid, type: "single", cond: cond, values: values, formula: f, style: style), errors)
    }
}

struct SheetCondFormatPanel: View {
    let ctx: SheetPanelContext
    @Environment(\.dismiss) private var dismiss
    @State private var draft: CFDraft?
    @State private var errors: [String: String] = [:]
    @State private var deleting: SheetCF.CondRule?

    private var store: SheetStore { ctx.store }
    private var shape: SheetShape { store.panelShape }
    private var rules: [SheetCF.CondRule] { store.panelList("condFormats").compactMap { SheetCF.CondRule(json: $0) } }

    var body: some View {
        NavigationStack {
            Group {
                if draft != nil { editor } else { list }
            }
            .navigationTitle(T("Conditional format rules"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if draft != nil {
                    ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { draft = nil; errors = [:] } }
                    if store.canEdit { ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { Task { await done() } } } }
                } else {
                    ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { dismiss() } }
                }
            }
            .alert(T("Delete this rule?"), isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), presenting: deleting) { r in
                Button(T("Delete"), role: .destructive) { Task { await save(rules.filter { $0.id != r.id }, label: T("conditional formatting")) } }
                Button(T("Cancel"), role: .cancel) {}
            } message: { _ in Text(T("The cells keep their values; only this formatting goes.")) }
            .onAppear(perform: openOnSelection)
        }
        .spPanelPresentation()
    }

    /// Opening on a selection no rule touches starts a new "Is not empty" rule (web, like Sheets).
    private func openOnSelection() {
        guard store.canEdit, draft == nil, let sel = store.panelSelectionRect else { return }
        let covered = rules.contains { r in
            r.ranges.contains { x in
                guard let rc = SheetValidation.rangeRect(x, shape) else { return false }
                return rc.top <= sel.bottom && sel.top <= rc.bottom && rc.left <= sel.right && sel.left <= rc.right
            }
        }
        if !covered { newRule() }
    }

    // MARK: list

    private var list: some View {
        List {
            if rules.isEmpty {
                EmptyState(icon: "paintpalette", title: T("No conditional formatting yet"),
                           subtitle: T("Select cells, then add a rule: colour cells that match a condition, or a colour scale."),
                           actionTitle: store.canEdit ? T("Add rule") : nil) { newRule() }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
            } else {
                Section {
                    ForEach(Array(rules.enumerated()), id: \.element.id) { i, r in
                        ruleRow(r, index: i, count: rules.count)
                    }
                    .onMove { from, to in
                        var next = rules
                        next.move(fromOffsets: from, toOffset: to)
                        let final = next
                        Task { await save(final, label: T("conditional formatting")) }
                    }
                } footer: {
                    Text(T("The first matching rule wins: drag to change the order."))
                }
                if store.canEdit {
                    Button { newRule() } label: { Label(T("Add another rule"), systemImage: "plus") }
                }
            }
        }
        .listStyle(.insetGrouped)
        .moveDisabled(!store.canEdit)
    }

    private func ruleRow(_ r: SheetCF.CondRule, index i: Int, count: Int) -> some View {
        HStack(spacing: 10) {
            Button { draft = CFDraft(rule: r, shape: shape, isNew: false); errors = [:] } label: {
                HStack(spacing: 10) {
                    if r.type == "scale", let sc = r.scale {
                        SPGradientBar(colors: CF.scaleColors(sc), height: 32).frame(width: 40)
                    } else {
                        let st = r.style ?? SheetCF.CondStyle()
                        SPStyleSwatch(fill: st.bg, text: st.fc, bold: st.b, italic: st.i, underline: st.u, strike: st.s)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(CF.describe(r, shape)).font(NXFont.text(14, .semibold)).lineLimit(2)
                        Text(r.ranges.map { SheetValidation.rangeToA1($0, shape) }.joined(separator: ", "))
                            .font(.system(size: 11, design: .monospaced)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .swipeActions(edge: .trailing) {
            if store.canEdit {
                Button(role: .destructive) { deleting = r } label: { Label(T("Delete rule"), systemImage: "trash") }
            }
        }
        .contextMenu {
            if store.canEdit {
                Button { move(i, i - 1) } label: { Label(T("Move up"), systemImage: "arrow.up") }.disabled(i == 0)
                Button { move(i, i + 1) } label: { Label(T("Move down"), systemImage: "arrow.down") }.disabled(i == count - 1)
                Button(role: .destructive) { deleting = r } label: { Label(T("Delete rule"), systemImage: "trash") }
            }
        }
    }

    private func move(_ from: Int, _ to: Int) {
        var next = rules
        guard to >= 0, to < next.count, from != to else { return }
        let m = next.remove(at: from)
        next.insert(m, at: to)
        let final = next
        Task { await save(final, label: T("conditional formatting")) }
    }

    // MARK: editor

    private func bind<V>(_ kp: WritableKeyPath<CFDraft, V>, _ fallback: V) -> Binding<V> {
        Binding(get: { draft?[keyPath: kp] ?? fallback }, set: { draft?[keyPath: kp] = $0 })
    }

    private var editor: some View {
        Form {
            if let d = draft {
                Section {
                    Picker("", selection: bind(\.type, "single")) {
                        Text(T("Single colour")).tag("single")
                        Text(T("Colour scale")).tag("scale")
                    }
                    .pickerStyle(.segmented)
                    .disabled(!store.canEdit)
                }
                Section(T("Apply to range")) {
                    SPRangeField(title: T("Apply to range"), text: bind(\.ranges, ""), selection: store.panelSelectionA1,
                                 invalid: errors["range"] != nil, disabled: !store.canEdit, placeholder: "A1:B10, D2:D")
                }
                if d.type == "single" { singleSections(d) } else { scaleSections(d) }
                if store.canEdit {
                    Section {
                        Button { Task { if await done() { newRule() } } } label: { Label(T("Add another rule"), systemImage: "plus") }
                        if !d.isNew, let r = rules.first(where: { $0.id == d.id }) {
                            Button(T("Delete rule"), role: .destructive) { deleting = r; draft = nil }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private func singleSections(_ d: CFDraft) -> some View {
        Section(T("Format cells if…")) {
            Picker(T("Format cells if…"), selection: Binding(get: { draft?.cond ?? "notEmpty" }, set: { v in
                draft?.cond = v; draft?.v1 = ""; draft?.v2 = ""; draft?.dateMode = "today"
            })) {
                ForEach(CF.OPTIONS.indices, id: \.self) { gi in
                    Section {
                        ForEach(CF.OPTIONS[gi], id: \.self) { k in Text(T(CF.LABEL[k] ?? k)).tag(k) }
                    }
                }
            }
            .disabled(!store.canEdit)
            if CF.isDateKind(d.cond) {
                Picker(T("Date"), selection: bind(\.dateMode, "today")) {
                    ForEach(CF.DATE_MODES.indices, id: \.self) { i in Text(T(CF.DATE_MODES[i].1)).tag(CF.DATE_MODES[i].0) }
                }
                .disabled(!store.canEdit)
                if d.dateMode == "exact" { TextField("11/10/2026", text: bind(\.v1, "")).disabled(!store.canEdit) }
            } else if SheetCF.COND_ONE_VALUE.contains(d.cond) || SheetCF.COND_TWO_VALUES.contains(d.cond) {
                TextField(T("Value or formula"), text: bind(\.v1, "")).disabled(!store.canEdit)
                if SheetCF.COND_TWO_VALUES.contains(d.cond) { TextField(T("Value or formula"), text: bind(\.v2, "")).disabled(!store.canEdit) }
            } else if d.cond == "formula" {
                TextField("=C2>10", text: bind(\.formula, ""))
                    .font(.system(size: 14, design: .monospaced)).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .disabled(!store.canEdit)
                Text(T("Written for the first cell of the range; it shifts for the others, like a filled formula.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            if let e = errors["value"] ?? errors["formula"] { Text(e).font(NXFont.text(12)).foregroundStyle(NX.danger) }
        }
        Section(T("Formatting style")) {
            presetGrid
            HStack(spacing: 4) {
                styleToggle("bold", T("Bold"), d.style.b) { draft?.style.b.toggle() }
                styleToggle("italic", T("Italic"), d.style.i) { draft?.style.i.toggle() }
                styleToggle("underline", T("Underline"), d.style.u) { draft?.style.u.toggle() }
                styleToggle("strikethrough", T("Strikethrough"), d.style.s) { draft?.style.s.toggle() }
                Spacer(minLength: 4)
                SPColorButton(label: T("Text colour"), value: d.style.fc, icon: "textformat", disabled: !store.canEdit) { draft?.style.fc = $0 }
                SPColorButton(label: T("Fill colour"), value: d.style.bg, icon: "paintbrush.pointed", disabled: !store.canEdit) { draft?.style.bg = $0 }
            }
            Button(T("No formatting")) { draft?.style = SheetCF.CondStyle() }.disabled(!store.canEdit)
        }
    }

    private var presetGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 6), spacing: 6) {
            ForEach(SheetCF.COND_PRESETS.indices, id: \.self) { i in
                let p = SheetCF.COND_PRESETS[i]
                Button { draft?.style.fc = p.fc; draft?.style.bg = p.bg } label: {
                    SPStyleSwatch(fill: p.bg, text: p.fc, size: 40)
                }
                .buttonStyle(.plain)
                .disabled(!store.canEdit)
                .accessibilityLabel(T("Style %d").replacingOccurrences(of: "%d", with: "\(i + 1)"))
            }
        }
        .padding(.vertical, 4)
    }

    private func styleToggle(_ icon: String, _ label: String, _ on: Bool, _ toggle: @escaping () -> Void) -> some View {
        Button(action: toggle) {
            Image(systemName: icon).font(.system(size: 14, weight: .medium))
                .frame(width: 32, height: 30)
                .background(on ? NX.violet.opacity(0.14) : Color.clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .foregroundStyle(on ? NX.violetText : NX.foreground)
        }
        .buttonStyle(.plain)
        .disabled(!store.canEdit)
        .accessibilityLabel(label)
    }

    @ViewBuilder private func scaleSections(_ d: CFDraft) -> some View {
        Section(T("Preview")) {
            SPGradientBar(colors: CF.scaleColors(d.scale), height: 26)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)], spacing: 6) {
                ForEach(SheetCF.SCALE_PRESETS.indices, id: \.self) { i in
                    let p = SheetCF.SCALE_PRESETS[i]
                    Button { applyScalePreset(p) } label: { SPGradientBar(colors: [p.min, p.mid, p.max].compactMap { $0 }, height: 24) }
                        .buttonStyle(.plain)
                        .disabled(!store.canEdit)
                        .accessibilityLabel(T("Colour scale %d").replacingOccurrences(of: "%d", with: "\(i + 1)"))
                }
            }
        }
        scalePointSection(T("Minpoint"), \.scale.min, [("min", "Min value"), ("num", "Number"), ("pct", "Percent"), ("pctile", "Percentile")])
        scalePointSection(T("Midpoint"), \.midPoint, [("none", "None"), ("num", "Number"), ("pct", "Percent"), ("pctile", "Percentile")])
        scalePointSection(T("Maxpoint"), \.scale.max, [("max", "Max value"), ("num", "Number"), ("pct", "Percent"), ("pctile", "Percentile")])
        if let e = errors["value"] { Section { Text(e).font(NXFont.text(12)).foregroundStyle(NX.danger) } }
    }

    private func scalePointSection(_ title: String, _ kp: WritableKeyPath<CFDraft, SheetCF.ScalePoint>, _ types: [(String, String)]) -> some View {
        let p = draft?[keyPath: kp] ?? SheetCF.ScalePoint(type: "none", color: "#ffffff")
        let valueOn = ["num", "pct", "pctile"].contains(p.type)
        return Section(title) {
            Picker(T("Point type"), selection: Binding(get: { draft?[keyPath: kp].type ?? "none" }, set: { t in
                guard var q = draft?[keyPath: kp] else { return }
                q.type = t
                q.value = (t == "pct" || t == "pctile") ? ((q.value ?? "").isEmpty ? "50" : q.value) : (t == "num" ? (q.value ?? "") : nil)
                draft?[keyPath: kp] = q
            })) {
                ForEach(types.indices, id: \.self) { i in Text(T(types[i].1)).tag(types[i].0) }
            }
            .disabled(!store.canEdit)
            if valueOn {
                TextField(T("Value"), text: Binding(get: { draft?[keyPath: kp].value ?? "" }, set: { draft?[keyPath: kp].value = $0 }))
                    .keyboardType(.numbersAndPunctuation)
                    .disabled(!store.canEdit)
            }
            HStack {
                Text(T("Colour"))
                Spacer()
                SPColorButton(label: T("Colour"), value: p.color, allowReset: false, disabled: !store.canEdit || p.type == "none") { c in
                    if let c { draft?[keyPath: kp].color = c }
                }
            }
        }
    }

    private func applyScalePreset(_ p: SheetCF.ScalePreset) {
        guard var d = draft else { return }
        d.scale.min.color = p.min
        d.scale.max.color = p.max
        if let mid = p.mid {
            let keep = d.scale.mid.flatMap { $0.type != "none" ? $0.type : nil } ?? "pctile"
            let v = d.scale.mid?.value.flatMap { $0.isEmpty ? nil : $0 } ?? "50"
            d.scale.mid = SheetCF.ScalePoint(type: keep, value: v, color: mid)
        } else {
            d.scale.mid = SheetCF.ScalePoint(type: "none", color: SheetCF.interpolateHex(p.min, p.max, 0.5))
        }
        draft = d
    }

    // MARK: actions

    private func newRule() {
        let sel = SheetValidation.rangeFromA1(store.panelSelectionA1, shape).map { [$0] } ?? []
        let r = SheetCF.CondRule(id: SPChart.newId("cf"), ranges: sel, type: "single", cond: "notEmpty", style: SheetCF.DEFAULT_COND_STYLE)
        draft = CFDraft(rule: r, shape: shape, isNew: true)
        errors = [:]
    }

    /// Validates and saves the rule being edited; false when something is missing.
    @discardableResult
    private func done() async -> Bool {
        guard let d = draft else { return false }
        let out = d.rule(shape)
        errors = out.errors
        guard let rule = out.rule, out.errors.isEmpty else { return false }
        var next = rules
        if let i = next.firstIndex(where: { $0.id == rule.id }) { next[i] = rule } else { next.append(rule) }
        draft = nil
        await save(next, label: T("conditional formatting"))
        return true
    }

    private func save(_ next: [SheetCF.CondRule], label: String) async {
        await store.panelSaveSettings(["condFormats": SheetPanelAPI.orNull(next.map { $0.json })], label: label, pushUndo: ctx.pushUndo)
    }
}

private extension CFDraft {
    /// The scale's midpoint, never nil while editing (web DEFAULT_SCALE.mid).
    var midPoint: SheetCF.ScalePoint {
        get { scale.mid ?? CFDraft.defaultScale.mid! }
        set { scale.mid = newValue }
    }
}

// MARK: - alternating colours

private enum Band {
    /// Sheets' 12 "Default styles": header colour, band 1 (white), band 2.
    static let PRESETS: [(header: String, c1: String, c2: String)] = [
        ("#bdbdbd", "#ffffff", "#f3f3f3"), ("#4dd0e1", "#ffffff", "#e0f7fa"), ("#63d297", "#ffffff", "#e7f9ef"),
        ("#f7cb4d", "#ffffff", "#fef8e3"), ("#f46524", "#ffffff", "#ffe6dd"), ("#5b95f9", "#ffffff", "#e8f0fe"),
        ("#26a69a", "#ffffff", "#ddf2f0"), ("#78909c", "#ffffff", "#ebeff1"), ("#cca677", "#ffffff", "#f8f2eb"),
        ("#8bc34a", "#ffffff", "#eef7e3"), ("#8989eb", "#ffffff", "#e8e7fc"), ("#bdbdbd", "#ffffff", "#f3f3f3"),
    ]
}

struct SheetAlternatingColorsPanel: View {
    let ctx: SheetPanelContext
    @Environment(\.dismiss) private var dismiss
    @State private var id = ""
    @State private var existing: String?
    @State private var range = ""
    @State private var headerOn = true
    @State private var footerOn = false
    @State private var header = Band.PRESETS[0].header
    @State private var c1 = Band.PRESETS[0].c1
    @State private var c2 = Band.PRESETS[0].c2
    @State private var footer = Band.PRESETS[0].header
    @State private var invalid = false
    @State private var removing = false
    @State private var loaded = false

    private var store: SheetStore { ctx.store }
    private var shape: SheetShape { store.panelShape }

    var body: some View {
        NavigationStack {
            Form {
                Section(T("Apply to range")) {
                    SPRangeField(title: T("Apply to range"), text: $range, selection: store.panelSelectionA1, invalid: invalid, disabled: !store.canEdit)
                }
                Section(T("Styles")) {
                    Toggle(T("Header"), isOn: $headerOn)
                    Toggle(T("Footer"), isOn: $footerOn)
                }
                Section(T("Default styles")) {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 6), spacing: 6) {
                        ForEach(Band.PRESETS.indices, id: \.self) { i in presetButton(i) }
                    }
                    .padding(.vertical, 4)
                }
                Section(T("Custom styles")) {
                    if headerOn { colorRow(T("Header"), header) { header = $0 } }
                    colorRow(T("Colour 1"), c1) { c1 = $0 }
                    colorRow(T("Colour 2"), c2) { c2 = $0 }
                    if footerOn { colorRow(T("Footer"), footer) { footer = $0 } }
                }
                if existing != nil && store.canEdit {
                    Section {
                        Button(T("Remove alternating colours"), role: .destructive) { removing = true }
                    }
                }
            }
            .disabled(!store.canEdit)
            .navigationTitle(T("Alternating colours"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() } }
                if store.canEdit { ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { Task { await done() } } } }
            }
            .alert(T("Remove alternating colours?"), isPresented: $removing) {
                Button(T("Remove"), role: .destructive) { Task { await remove() } }
                Button(T("Cancel"), role: .cancel) {}
            }
            .onAppear(perform: load)
        }
        .spPanelPresentation()
    }

    private func presetButton(_ i: Int) -> some View {
        let p = Band.PRESETS[i]
        let on = p.header == header && p.c1 == c1 && p.c2 == c2
        return Button { header = p.header; c1 = p.c1; c2 = p.c2; footer = p.header } label: {
            VStack(spacing: 0) {
                if headerOn { SPColors.color(p.header).frame(height: 7) }
                SPColors.color(p.c1).frame(height: 7)
                SPColors.color(p.c2).frame(height: 7)
                SPColors.color(p.c1).frame(height: 7)
                if footerOn { SPColors.color(p.header).frame(height: 7) }
            }
            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(on ? NX.violet : Color.black.opacity(0.1), lineWidth: on ? 2 : 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(T("Style %d").replacingOccurrences(of: "%d", with: "\(i + 1)"))
    }

    private func colorRow(_ label: String, _ value: String, _ set: @escaping (String) -> Void) -> some View {
        HStack {
            Text(label).font(NXFont.text(13)).frame(maxWidth: .infinity, minHeight: 30)
                .background(SPColors.color(value), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .foregroundStyle(Color.black)
            SPColorButton(label: label, value: value, allowReset: false) { c in if let c { set(c) } }
        }
    }

    /// The banding under the selection's top-left cell, else a new one over the selection.
    private func load() {
        guard !loaded else { return }
        loaded = true
        let sel = store.panelSelectionRect
        for b in store.panelList("bandings") {
            guard let r = b["range"] as? String, let rc = SheetValidation.rangeRect(r, shape), let sel else { continue }
            if rc.top <= sel.top && rc.bottom >= sel.top && rc.left <= sel.left && rc.right >= sel.left {
                existing = b["id"] as? String
                id = existing ?? ""
                range = SheetValidation.rangeToA1(r, shape)
                headerOn = b["header"] is String
                footerOn = b["footer"] is String
                header = b["header"] as? String ?? Band.PRESETS[0].header
                c1 = b["c1"] as? String ?? Band.PRESETS[0].c1
                c2 = b["c2"] as? String ?? Band.PRESETS[0].c2
                footer = b["footer"] as? String ?? header
                return
            }
        }
        id = SPChart.newId("band")
        range = store.panelSelectionA1
    }

    private func done() async {
        guard let stored = SheetValidation.rangeFromA1(range, shape) else { invalid = true; return }
        var b: SheetJSON = ["id": id, "range": stored, "c1": c1, "c2": c2]
        if headerOn { b["header"] = header }
        if footerOn { b["footer"] = footer }
        var list = store.panelList("bandings").filter { ($0["id"] as? String) != id && ($0["id"] as? String) != existing }
        list.append(b)
        await store.panelSaveSettings(["bandings": list], label: T("alternating colours"), pushUndo: ctx.pushUndo)
        dismiss()
    }

    private func remove() async {
        guard let existing else { return }
        let list = store.panelList("bandings").filter { ($0["id"] as? String) != existing }
        await store.panelSaveSettings(["bandings": SheetPanelAPI.orNull(list)], label: T("remove alternating colours"), pushUndo: ctx.pushUndo)
        dismiss()
    }
}
