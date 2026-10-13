import SwiftUI

// Edit ▸ Find and replace (web DataDialogs FindReplaceDialog + SheetGrid findCells / replaceIn): Find,
// Replace with, Search (this sheet / the selected range), match case, entire cell, regular expressions,
// formulas, links; Find next / previous move the selection; Replace and Replace all write through
// store.setCells, so each is ONE undo step.

struct SheetFindPanel: View {
    let ctx: SheetPanelContext
    @Environment(\.dismiss) private var dismiss
    @State private var find = ""
    @State private var replace = ""
    @State private var inRange = false
    @State private var matchCase = false
    @State private var entire = false
    @State private var regex = false
    @State private var formulas = false
    @State private var links = false
    @State private var status: String?
    /// The block "Specific range" searches, taken when the panel opened (later hits move the selection).
    @State private var range: SheetValidation.Rect?

    private var store: SheetStore { ctx.store }
    private var options: SPFind.Options {
        SPFind.Options(find: find, replace: replace, matchCase: matchCase, entire: entire, regex: regex)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(T("Find"), text: $find)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .onSubmit { step(1) }
                        .onChange(of: find) { _, _ in status = nil }
                    if store.canEdit {
                        TextField(T("Replace with"), text: $replace)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                }
                Section {
                    Picker(T("Search"), selection: $inRange) {
                        Text(T("This sheet")).tag(false)
                        Text(T("Specific range")).tag(true)
                    }
                    .disabled(range == nil)
                    Toggle(T("Match case"), isOn: $matchCase)
                    Toggle(T("Match entire cell contents"), isOn: $entire)
                    Toggle(T("Search using regular expressions"), isOn: $regex)
                    Toggle(T("Also search within formulas"), isOn: $formulas)
                    Toggle(T("Also search within links"), isOn: $links)
                }
                .font(NXFont.text(14))
                Section {
                    HStack(spacing: 10) {
                        Button { step(-1) } label: { Label(T("Previous"), systemImage: "chevron.up") }
                        Button { step(1) } label: { Label(T("Find"), systemImage: "chevron.down") }
                    }
                    .buttonStyle(.bordered)
                    .disabled(find.isEmpty)
                    if store.canEdit {
                        HStack(spacing: 10) {
                            Button(T("Replace")) { replaceOne() }
                            Button(T("Replace all")) { replaceAll() }
                        }
                        .buttonStyle(.bordered)
                        .disabled(find.isEmpty)
                    }
                } footer: {
                    if let status { Text(status).font(NXFont.text(13)) }
                }
            }
            .navigationTitle(T("Find and replace"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { dismiss() } } }
            .onAppear {
                if !store.selection.isSingleCell, let rc = store.panelSelectionRect { range = rc }
            }
            .onChange(of: matchCase) { _, _ in status = nil }
            .onChange(of: entire) { _, _ in status = nil }
            .onChange(of: regex) { _, _ in status = nil }
        }
        .spPanelPresentation()
    }

    // MARK: search

    /// Hits as visible positions, row by row (web: view × columns).
    private func hits() -> [SheetPos] {
        guard let snap = store.snapshot, SPFind.buildMatcher(options) != nil else { return [] }
        var out: [SheetPos] = []
        for (vr, r) in store.visRows.enumerated() {
            if inRange, let rc = range, r < rc.top || r > rc.bottom { continue }
            for (vc, c) in store.visCols.enumerated() {
                if inRange, let rc = range, c < rc.left || c > rc.right { continue }
                guard let text = cellText(snap, r, c) else { continue }
                if SPFind.textMatches(text, options) { out.append(SheetPos(r: vr, c: vc)) }
            }
        }
        return out
    }

    /// What a cell is searched by: its formula (with "formulas") or its shown value, a link's text and
    /// address (with "links"), else the value as edited.
    private func cellText(_ snap: SheetBridge.Snapshot, _ r: Int, _ c: Int) -> String? {
        guard snap.rows.indices.contains(r), snap.columns.indices.contains(c) else { return nil }
        let row = snap.rows[r], col = snap.columns[c]
        guard let raw = row.cells[col.id], !(raw is NSNull) else { return nil }
        if SheetFormula.isFormulaCell(raw) {
            return formulas ? (SheetTypes.editFormula(raw, snap.shape) ?? "")
                : SheetTypes.displayCell(col.type, raw, (engine: snap.engine, rowId: row.id, colId: col.id))
        }
        if links, let link = SheetFormula.linkOf(raw) { return "\(link.t ?? "") \(link.u)" }
        return SheetTypes.editValue(col.type, raw)
    }

    private func step(_ dir: Int) {
        let list = hits()
        guard !list.isEmpty else { status = T("No more results"); return }
        let a = store.selection.active
        let next: SheetPos
        if dir > 0 {
            next = list.first { $0.r > a.r || ($0.r == a.r && $0.c > a.c) } ?? list[0]
        } else {
            next = list.last { $0.r < a.r || ($0.r == a.r && $0.c < a.c) } ?? list[list.count - 1]
        }
        store.select(next)
        let i = (list.firstIndex(of: next) ?? 0) + 1
        status = T("%1 of %2").replacingOccurrences(of: "%1", with: "\(i)").replacingOccurrences(of: "%2", with: "\(list.count)")
    }

    // MARK: replace

    private func replaceOne() {
        let list = hits()
        let a = store.selection.active
        guard list.contains(a) else {
            if list.isEmpty { status = T("No more results") } else { step(1) }
            return
        }
        let n = replace(in: [a])
        report(n)
        if n > 0 {
            let after = hits()
            if let next = after.first(where: { $0.r > a.r || ($0.r == a.r && $0.c > a.c) }) ?? after.first { store.select(next) }
        }
    }

    private func replaceAll() { report(replace(in: hits())) }

    private func report(_ n: Int) {
        if n == 0 { status = T("No more results"); return }
        let tpl = n == 1 ? T("1 instance of %@ replaced") : T("%d instances of %@ replaced").replacingOccurrences(of: "%d", with: "\(n)")
        status = tpl.replacingOccurrences(of: "%@", with: find)
    }

    /// Replaces in the given cells; one setCells call = one undo step. Returns how many matches were replaced.
    private func replace(in cells: [SheetPos]) -> Int {
        guard store.canEdit, let snap = store.snapshot else { return 0 }
        var changes: [(String, String, Any?)] = []
        var count = 0
        for p in cells {
            guard let r = store.modelRow(p.r), let c = store.modelCol(p.c), snap.rows.indices.contains(r), snap.columns.indices.contains(c) else { continue }
            let row = snap.rows[r], col = snap.columns[c]
            let raw = row.cells[col.id]
            if SheetFormula.isFormulaCell(raw) {
                if !formulas { continue }
                let res = SPFind.replaceText(SheetTypes.editFormula(raw, snap.shape) ?? "", options)
                if res.count == 0 { continue }
                count += res.count
                let next: Any? = res.text.hasPrefix("=") ? ["f": SheetFormula.toStored(res.text, snap.shape)]
                    : SheetTypes.inputToCell(col, res.text, snap.shape, raw)
                changes.append((row.id, col.id, next))
                continue
            }
            let res = SPFind.replaceText(SheetTypes.editValue(col.type, raw), options)
            if res.count == 0 { continue }
            count += res.count
            let next: Any?
            if let link = SheetFormula.linkOf(raw) {
                next = SheetJS.trim(res.text).isEmpty ? nil : ["t": res.text, "u": link.u]
            } else {
                next = SheetTypes.inputToCell(col, res.text, snap.shape, raw)
            }
            changes.append((row.id, col.id, next))
        }
        if !changes.isEmpty { store.setCells(changes, label: T("find and replace")) }
        return count
    }
}
