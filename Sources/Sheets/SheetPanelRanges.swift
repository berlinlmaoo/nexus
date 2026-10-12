import SwiftUI

// Data ▸ Named ranges and Data ▸ Protect sheets and ranges (web SheetRangesPanel.tsx), saved in
// settings.namedRanges / settings.protections exactly as the web saves them (one undo step each, through
// SheetStore.setSettings). Named ranges work in formulas at once (the snapshot reads them). Protections: a
// "Show a warning" range asks before an edit (centred alert on the sheet screen), a restricted one refuses
// edits from anyone but its owner, its editors and leads — here before sending, and on the server anyway.
// Only managers add / change protections, like the web.

// MARK: - store helpers

extension SheetStore {
    var namedRanges: [SheetRanges.Named] { ((settings["namedRanges"] as? [Any]) ?? []).compactMap { SheetRanges.Named(json: $0) } }

    func saveNamedRanges(_ list: [SheetRanges.Named]) async {
        let value: Any? = list.isEmpty ? nil : list.map { $0.json }
        await setSettings(["namedRanges": value], label: T("named ranges"))
    }

    func saveProtections(_ list: [SheetRanges.Protection]) async {
        let value: Any? = list.isEmpty ? nil : list.map { $0.json }
        await setSettings(["protections": value], label: T("protected ranges"))
    }

    /// Selects a block given in model indices (what is visible of it).
    func selectModelRect(_ rc: SheetValidation.Rect) {
        let rowsIn = visRows.indices.filter { visRows[$0] >= rc.top && visRows[$0] <= rc.bottom }
        let colsIn = visCols.indices.filter { visCols[$0] >= rc.left && visCols[$0] <= rc.right }
        guard let t = rowsIn.first, let b = rowsIn.last, let l = colsIn.first, let r = colsIn.last else {
            notice = T("That range is hidden right now.")
            return
        }
        select(SheetPos(r: t, c: l))
        if t != b || l != r { select(SheetPos(r: b, c: r), extend: true) }
    }

    /// "Sheet1!B2:C9" for a stored range.
    func sheetA1(_ stored: String) -> String {
        "\(name.isEmpty ? "Sheet1" : name)!\(SheetValidation.rangeToA1(stored, panelShape))"
    }
}

// MARK: - named ranges

struct SheetNamedRangesPanel: View {
    let ctx: SheetPanelContext
    @Environment(\.dismiss) private var dismiss
    @State private var draft: Draft?
    @State private var touched = false

    struct Draft {
        var id: String?
        var name: String
        var range: String
    }

    private var store: SheetStore { ctx.store }
    private var ranges: [SheetRanges.Named] { store.namedRanges }
    private var base: String { AppLanguage.shared.lang == .id ? "RentangBernama" : "NamedRange" }

    var body: some View {
        NavigationStack {
            Group {
                if let d = draft { form(d) } else { list }
            }
            .navigationTitle(T("Named ranges"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
        }
        .spPanelPresentation()
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        if draft != nil {
            ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { draft = nil; touched = false } }
            ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { Task { await done() } } }
        } else {
            ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { dismiss() } }
            if store.canEdit {
                ToolbarItem(placement: .primaryAction) {
                    Button { add() } label: { Label(T("Add a range"), systemImage: "plus") }
                }
            }
        }
    }

    private var list: some View {
        List {
            if ranges.isEmpty {
                EmptyState(icon: "character.cursor.ibeam", title: T("No named ranges yet"),
                           subtitle: T("Name a range to use it in formulas instead of A1 references."),
                           actionTitle: store.canEdit ? T("Add a range") : nil, actionIcon: "plus") { add() }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
            }
            ForEach(ranges, id: \.id) { r in row(r) }
            Section { tip }
        }
        .listStyle(.insetGrouped)
    }

    private func row(_ r: SheetRanges.Named) -> some View {
        Button { jump(r) } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(r.name).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                Text(store.sheetA1(r.range)).font(.system(size: 12, design: .monospaced)).foregroundStyle(NX.mutedFg)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing) {
            if store.canEdit {
                Button(role: .destructive) { remove(r) } label: { Label(T("Delete"), systemImage: "trash") }
                Button { draft = Draft(id: r.id, name: r.name, range: store.sheetA1(r.range)) } label: { Label(T("Edit"), systemImage: "pencil") }
            }
        }
        .contextMenu {
            if store.canEdit {
                Button { draft = Draft(id: r.id, name: r.name, range: store.sheetA1(r.range)) } label: { Label(T("Edit"), systemImage: "pencil") }
                Button(role: .destructive) { remove(r) } label: { Label(T("Delete"), systemImage: "trash") }
            }
        }
    }

    private var tip: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(T("Tip"), systemImage: "lightbulb").font(NXFont.text(13, .semibold))
            Text(T("Use named ranges in formulas. They are easier to read and to reuse.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            Text("=SUM(\(base)1)").font(.system(size: 12, design: .monospaced))
        }
    }

    private func form(_ d: Draft) -> some View {
        let nameError = SheetRanges.validateRangeName(d.name, existing: ranges, selfId: d.id)
        let rangeError = SheetValidation.rangeFromA1(d.range, store.panelShape) == nil
        return Form {
            Section(T("Name")) {
                TextField(T("Name"), text: Binding(get: { draft?.name ?? "" }, set: { draft?.name = $0 }))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if touched, let nameError {
                    Text(T(nameError)).font(NXFont.text(12)).foregroundStyle(NX.danger)
                }
            }
            Section(T("Range")) {
                SPRangeField(title: T("Range"), text: Binding(get: { draft?.range ?? "" }, set: { draft?.range = $0 }),
                             selection: store.storedRange(store.selection.current).map { store.sheetA1($0) } ?? "",
                             invalid: touched && rangeError, placeholder: T("e.g. Sheet1!A1:B10"))
            }
            Section { tip }
        }
    }

    private func add() {
        guard store.canEdit else { return }
        let sel = store.storedRange(store.selection.current).map { store.sheetA1($0) } ?? ""
        draft = Draft(id: nil, name: SheetRanges.nextName(ranges, base: base), range: sel)
        touched = false
    }

    private func done() async {
        touched = true
        guard let d = draft, SheetRanges.validateRangeName(d.name, existing: ranges, selfId: d.id) == nil,
              let stored = SheetValidation.rangeFromA1(d.range, store.panelShape) else { return }
        let item = SheetRanges.Named(id: d.id ?? SPChart.newId("nr"), name: SheetJS.trim(d.name), range: stored)
        var next = ranges
        if let id = d.id, let i = next.firstIndex(where: { $0.id == id }) { next[i] = item } else { next.append(item) }
        draft = nil
        touched = false
        await store.saveNamedRanges(next)
    }

    private func remove(_ r: SheetRanges.Named) {
        let next = ranges.filter { $0.id != r.id }
        Task { await store.saveNamedRanges(next) }
    }

    private func jump(_ r: SheetRanges.Named) {
        guard let rc = SheetValidation.rangeRect(r.range, store.panelShape) else { return }
        store.selectModelRect(rc)
        dismiss()
    }
}

// MARK: - protected sheets and ranges

struct SheetProtectedRangesPanel: View {
    let ctx: SheetPanelContext
    @Environment(\.dismiss) private var dismiss
    @State private var draft: Draft?
    @State private var step = 0
    @State private var error: String?
    @State private var members: [Member] = []

    struct Member: Identifiable {
        let id: String
        let name: String
    }

    struct Draft {
        var id: String?
        var desc = ""
        var sheet = false
        var range = ""
        var exceptOn = false
        var except = ""
        var mode = "warn"
        var custom = false
        var editors: [String] = []
        var by: String?
    }

    private var store: SheetStore { ctx.store }
    private var list: [SheetRanges.Protection] { store.protections }
    private var me: String { store.meId ?? "" }
    private var selectionA1: String { store.storedRange(store.selection.current).map { store.sheetA1($0) } ?? "" }

    var body: some View {
        NavigationStack {
            Group {
                if let d = draft {
                    if step == 1 { permissions(d) } else { what(d) }
                } else {
                    overview
                }
            }
            .navigationTitle(draft != nil && step == 1 ? T("Range editing permissions") : T("Protected sheets and ranges"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .task { await loadMembers() }
        }
        .spPanelPresentation()
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        if draft == nil {
            ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { dismiss() } }
            if store.canManage {
                ToolbarItem(placement: .primaryAction) {
                    Button { start() } label: { Label(T("Add a sheet or range"), systemImage: "plus") }
                }
            }
        } else if step == 0 {
            ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { draft = nil } }
            ToolbarItem(placement: .confirmationAction) { Button(T("Set permissions")) { toNext() } }
        } else {
            ToolbarItem(placement: .cancellationAction) { Button(T("Back")) { step = 0 } }
            ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { Task { await finish() } } }
        }
    }

    // MARK: list

    private var overview: some View {
        List {
            if list.isEmpty {
                EmptyState(icon: "lock", title: T("Nothing is protected yet"),
                           subtitle: T("Protect a range so it isn't changed by accident, or so only some people can edit it."),
                           actionTitle: store.canManage ? T("Add a sheet or range") : nil, actionIcon: "plus") { start() }
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
            }
            ForEach(list, id: \.id) { p in row(p) }
        }
        .listStyle(.insetGrouped)
    }

    private func label(_ p: SheetRanges.Protection) -> String {
        let sheetName = store.name.isEmpty ? "Sheet1" : store.name
        if p.sheet {
            guard !p.except.isEmpty else { return sheetName }
            let ranges = p.except.map { SheetValidation.rangeToA1($0, store.panelShape) }.joined(separator: ", ")
            return T("%1$@ except %2$@").replacingOccurrences(of: "%1$@", with: sheetName).replacingOccurrences(of: "%2$@", with: ranges)
        }
        return p.range.map { store.sheetA1($0) } ?? "\(sheetName)!#REF!"
    }

    private func row(_ p: SheetRanges.Protection) -> some View {
        Button { if store.canManage { open(p) } } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: p.mode == "warn" ? "exclamationmark.shield" : "lock.fill")
                    .font(.system(size: 14)).foregroundStyle(NX.mutedFg).frame(width: 20)
                VStack(alignment: .leading, spacing: 2) {
                    Text((p.desc ?? "").isEmpty ? label(p) : p.desc!).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                    if !(p.desc ?? "").isEmpty {
                        Text(label(p)).font(.system(size: 12, design: .monospaced)).foregroundStyle(NX.mutedFg)
                    }
                    Text(p.mode == "warn" ? T("Shows a warning") : T("Restricted")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing) {
            if store.canManage {
                Button(role: .destructive) { remove(p) } label: { Label(T("Delete"), systemImage: "trash") }
            }
        }
        .contextMenu {
            if store.canManage {
                Button { open(p) } label: { Label(T("Edit"), systemImage: "pencil") }
                Button(role: .destructive) { remove(p) } label: { Label(T("Delete"), systemImage: "trash") }
            }
        }
    }

    // MARK: step 1 — what

    private func what(_ d: Draft) -> some View {
        Form {
            Section {
                TextField(T("Enter a description"), text: Binding(get: { draft?.desc ?? "" }, set: { draft?.desc = $0 }))
            }
            Section {
                Picker("", selection: Binding(get: { draft?.sheet ?? false }, set: { draft?.sheet = $0; error = nil })) {
                    Text(T("Range")).tag(false)
                    Text(T("Sheet")).tag(true)
                }
                .pickerStyle(.segmented)
                if d.sheet {
                    Text(store.name.isEmpty ? "Sheet1" : store.name).font(NXFont.text(14))
                    Toggle(T("Except certain cells"), isOn: Binding(get: { draft?.exceptOn ?? false }, set: { on in
                        draft?.exceptOn = on
                        if on, (draft?.except ?? "").isEmpty { draft?.except = store.nameBox }
                    }))
                    if d.exceptOn {
                        TextField("A1:B5, D2:D9", text: Binding(get: { draft?.except ?? "" }, set: { draft?.except = $0 }))
                            .font(.system(size: 14, design: .monospaced))
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                    }
                } else {
                    SPRangeField(title: T("Range"), text: Binding(get: { draft?.range ?? "" }, set: { draft?.range = $0 }),
                                 selection: selectionA1, invalid: false, placeholder: T("e.g. Sheet1!A1:B10"))
                }
                if let error {
                    Text(T(error)).font(NXFont.text(12)).foregroundStyle(NX.danger)
                }
            }
        }
    }

    // MARK: step 2 — who

    private func permissions(_ d: Draft) -> some View {
        Form {
            Section {
                Picker(T("Range editing permissions"), selection: Binding(get: { draft?.mode ?? "warn" }, set: { draft?.mode = $0 })) {
                    Text(T("Show a warning when editing this range")).tag("warn")
                    Text(T("Restrict who can edit this range")).tag("restrict")
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }
            if d.mode == "restrict" {
                Section(T("Who can edit")) {
                    Picker(T("Who can edit"), selection: Binding(get: { draft?.custom ?? false }, set: { draft?.custom = $0 })) {
                        Text(T("Only you")).tag(false)
                        Text(T("Custom")).tag(true)
                    }
                    if d.custom { memberRows(d) }
                }
            }
        }
    }

    @ViewBuilder private func memberRows(_ d: Draft) -> some View {
        if members.isEmpty {
            Text(T("No other members in this project.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
        }
        ForEach(members) { m in
            let owner = m.id == (d.by ?? me)
            Toggle(isOn: Binding(get: { owner || (draft?.editors ?? []).contains(m.id) }, set: { on in
                guard !owner else { return }
                if on { draft?.editors.append(m.id) } else { draft?.editors.removeAll { $0 == m.id } }
            })) {
                HStack {
                    Text(m.name).lineLimit(1)
                    if owner { Text(T("Owner")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg) }
                }
            }
            .disabled(owner)
        }
    }

    // MARK: actions

    private func start() {
        guard store.canManage else { return }
        draft = Draft(range: selectionA1, by: me)
        step = 0
        error = nil
    }

    private func open(_ p: SheetRanges.Protection) {
        let shape = store.panelShape
        var d = Draft(id: p.id, desc: p.desc ?? "", sheet: p.sheet, range: p.range.map { store.sheetA1($0) } ?? selectionA1,
                      exceptOn: !p.except.isEmpty, except: p.except.map { SheetValidation.rangeToA1($0, shape) }.joined(separator: ", "),
                      mode: p.mode, custom: false, editors: p.editors ?? [], by: p.by)
        d.custom = (p.editors ?? []).contains { $0 != (p.by ?? me) }
        draft = d
        step = 0
        error = nil
    }

    private func exceptRanges(_ d: Draft) -> [String]? {
        let parts = d.except.split(separator: ",").map { SheetJS.trim(String($0)) }.filter { !$0.isEmpty }
        var out: [String] = []
        for p in parts {
            guard let s = SheetValidation.rangeFromA1(p, store.panelShape) else { return nil }
            out.append(s)
        }
        return out
    }

    private func toNext() {
        guard let d = draft else { return }
        if !d.sheet && SheetValidation.rangeFromA1(d.range, store.panelShape) == nil {
            error = "Enter a valid range, e.g. Sheet1!A1:B10"
            return
        }
        if d.sheet && d.exceptOn && exceptRanges(d) == nil {
            error = "Enter a valid range, e.g. Sheet1!A1:B10"
            return
        }
        error = nil
        step = 1
    }

    private func finish() async {
        guard let d = draft else { return }
        let owner = d.by ?? me
        let stored = d.sheet ? nil : SheetValidation.rangeFromA1(d.range, store.panelShape)
        let except = d.sheet && d.exceptOn ? (exceptRanges(d) ?? []) : []
        let editors = SheetRanges.Protection.editorsFor(mode: d.mode, owner: owner, custom: d.custom, picked: d.editors)
        let item = SheetRanges.Protection(id: d.id ?? SPChart.newId("pr"), range: stored, sheet: d.sheet, except: except,
                                          desc: SheetJS.trim(d.desc).isEmpty ? nil : SheetJS.trim(d.desc), mode: d.mode,
                                          editors: editors, by: owner.isEmpty ? nil : owner)
        var next = list
        if let id = d.id, let i = next.firstIndex(where: { $0.id == id }) { next[i] = item } else { next.append(item) }
        draft = nil
        step = 0
        await store.saveProtections(next)
    }

    private func remove(_ p: SheetRanges.Protection) {
        let next = list.filter { $0.id != p.id }
        Task { await store.saveProtections(next) }
    }

    /// The project's members (web project-members-lite), for "Custom" editors.
    private func loadMembers() async {
        guard members.isEmpty else { return }
        let path = "/api/projects/\(SheetPanelAPI.enc(store.projectId))/members"
        guard let res = try? await APIClient.shared.perform(APIClient.shared.makeRequest(path)),
              (res.1 as? HTTPURLResponse)?.statusCode == 200,
              let any = try? JSONSerialization.jsonObject(with: res.0) else { return }
        let arr = (any as? [[String: Any]]) ?? ((any as? [String: Any])?["members"] as? [[String: Any]]) ?? []
        var out: [Member] = []
        for m in arr {
            let user = m["user"] as? [String: Any]
            guard let id = (m["userId"] as? String) ?? (user?["id"] as? String), !id.isEmpty,
                  !out.contains(where: { $0.id == id }) else { continue }
            let name = (user?["name"] as? String) ?? (user?["email"] as? String) ?? ""
            out.append(Member(id: id, name: name))
        }
        members = out
    }
}
