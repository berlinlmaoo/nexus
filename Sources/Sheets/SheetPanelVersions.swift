import SwiftUI

// File ▸ Version history (web SheetVersionPanel + SheetGrid restoreVersion): versions grouped by day, each with
// its time and editors; named versions in bold with "Name this version"; selecting a version lists the cells
// that differ from now (the web tints them on the grid); "Restore this version" writes those cells back
// through store.setCells — one undo step, and logged as new revisions, so history stays append-only.

struct SheetVersionsPanel: View {
    let ctx: SheetPanelContext
    @Environment(\.dismiss) private var dismiss
    @State private var revisions: [SPRevision] = []
    @State private var loading = true
    @State private var loadError: String?
    @State private var collapsed: Set<String> = []
    @State private var selected: String?
    @State private var preview: [PreviewCell] = []
    @State private var previewLoading = false
    @State private var naming: SPVersions.Entry?
    @State private var nameText = ""
    @State private var restoring: SPVersions.Entry?

    private var store: SheetStore { ctx.store }

    struct PreviewCell: Identifiable {
        let id: String
        let address: String
        let then: String
        let now: String
        let order: Int
    }

    private var named: [SPNamedVersion] {
        store.panelList("versions").compactMap { o in
            guard let name = o["name"] as? String, let at = o["at"] as? String else { return nil }
            return SPNamedVersion(id: o["id"] as? String ?? "", name: name, at: at)
        }
    }

    private var days: [SPVersions.Day] { SPVersions.groupVersions(revisions, named) }

    var body: some View {
        NavigationStack {
            List {
                content
            }
            .listStyle(.insetGrouped)
            .navigationTitle(T("Version history"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { dismiss() } } }
            .task { await load() }
            .refreshable { await load() }
            .alert(T("Name this version"), isPresented: Binding(get: { naming != nil }, set: { if !$0 { naming = nil } }), presenting: naming) { v in
                TextField(T("Version name"), text: $nameText)
                Button(T("Save")) { let n = nameText; Task { await name(v, n) } }
                Button(T("Cancel"), role: .cancel) {}
            }
            .alert(T("Restore this version?"), isPresented: Binding(get: { restoring != nil }, set: { if !$0 { restoring = nil } }), presenting: restoring) { v in
                Button(T("Restore")) { Task { await restore(v) } }
                Button(T("Cancel"), role: .cancel) {}
            } message: { _ in
                Text(T("Cells changed since then get their old values back. Undo puts them back again."))
            }
        }
        .spPanelPresentation()
    }

    @ViewBuilder private var content: some View {
        if loading && revisions.isEmpty {
            HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
        } else if let loadError, revisions.isEmpty {
            ErrorState(message: loadError, icon: "clock.arrow.circlepath") { Task { await load() } }.listRowBackground(Color.clear)
        } else if days.isEmpty {
            EmptyState(icon: "clock.arrow.circlepath", title: T("No versions yet"),
                       subtitle: T("Every edit is recorded here, grouped into versions."), compact: true)
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
        } else {
            ForEach(days, id: \.day) { d in
                Section {
                    if !collapsed.contains(d.day) {
                        ForEach(d.versions, id: \.at) { v in versionRow(v) }
                    }
                } header: {
                    Button {
                        if collapsed.contains(d.day) { collapsed.remove(d.day) } else { collapsed.insert(d.day) }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: collapsed.contains(d.day) ? "chevron.right" : "chevron.down").font(.system(size: 10, weight: .semibold))
                            Text(SPFormat.day(d.day))
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func isSelected(_ v: SPVersions.Entry) -> Bool { v.current ? selected == nil || selected == v.at : selected == v.at }

    private func versionRow(_ v: SPVersions.Entry) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { Task { await select(v) } } label: {
                VStack(alignment: .leading, spacing: 3) {
                    if let n = v.name { Text(n).font(NXFont.text(14, .bold)) }
                    Text(SPFormat.when(v.at)).font(NXFont.text(13, v.name == nil ? .semibold : .regular))
                        .foregroundStyle(v.name == nil ? NX.foreground : NX.mutedFg)
                    if v.current { Text(T("Current version")).font(NXFont.text(12)).italic().foregroundStyle(NX.mutedFg) }
                    ForEach(Array(v.authors.prefix(4).enumerated()), id: \.offset) { _, a in
                        HStack(spacing: 6) {
                            Circle().fill(SPColors.color(SPVersions.editorColor(a.id))).frame(width: 8, height: 8)
                            Text(a.name ?? T("deleted account")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        }
                    }
                    if v.authors.count > 4 {
                        Text(T("+%d more").replacingOccurrences(of: "%d", with: "\(v.authors.count - 4)"))
                            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if isSelected(v) && !v.current { selectedDetail(v) }
        }
        .listRowBackground(isSelected(v) ? NX.accentBg : NX.card)
        .contextMenu {
            if store.canEdit {
                Button { nameText = v.name ?? ""; naming = v } label: { Label(T("Name this version"), systemImage: "pencil") }
                if !v.current {
                    Button { restoring = v } label: { Label(T("Restore this version"), systemImage: "clock.arrow.circlepath") }
                }
            }
        }
        .swipeActions(edge: .trailing) {
            if store.canEdit {
                Button { nameText = v.name ?? ""; naming = v } label: { Label(T("Name"), systemImage: "pencil") }.tint(NX.violet)
            }
        }
    }

    @ViewBuilder private func selectedDetail(_ v: SPVersions.Entry) -> some View {
        if previewLoading {
            ProgressView().frame(maxWidth: .infinity)
        } else {
            Text(preview.isEmpty ? T("Same as the current version.")
                 : (preview.count == 1 ? T("1 cell differs from now:") : T("%d cells differ from now:")).replacingOccurrences(of: "%d", with: "\(preview.count)"))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            ForEach(preview.prefix(30)) { p in
                HStack(spacing: 6) {
                    Text(p.address).font(.system(size: 11, design: .monospaced)).foregroundStyle(NX.mutedFg).frame(minWidth: 38, alignment: .leading)
                    Text(p.then).fontWeight(.semibold).lineLimit(1)
                    Text("←").foregroundStyle(NX.mutedFg)
                    Text(p.now).strikethrough().foregroundStyle(NX.mutedFg).lineLimit(1)
                }
                .font(NXFont.text(12))
            }
            if preview.count > 30 {
                Text(T("+%d more").replacingOccurrences(of: "%d", with: "\(preview.count - 30)")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            if store.canEdit && !preview.isEmpty {
                Button { restoring = v } label: { Text(T("Restore this version")).frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent).tint(NX.violet)
            }
        }
    }

    // MARK: actions

    private func load() async {
        guard let sid = store.sheetId else { loading = false; return }
        loading = true
        defer { loading = false }
        do {
            revisions = try await SheetPanelAPI.revisions(sid, limit: 2000)
            loadError = nil
        } catch {
            loadError = SheetPanelAPI.message(error, T("Couldn't load the history."))
        }
    }

    /// The sheet as of `at`: today's cells with every later change undone.
    private func stateAt(_ at: String) async -> (rows: [SPVersions.RowCells], changed: Set<String>)? {
        guard let sid = store.sheetId else { return nil }
        do {
            let later = try await SheetPanelAPI.revisions(sid, after: at)
            let rows = store.rows.map { SPVersions.RowCells(id: $0.id, cells: $0.cells) }
            return SPVersions.stateAt(rows, later, at)
        } catch {
            store.notice = SheetPanelAPI.message(error, T("Couldn't load the history."))
            return nil
        }
    }

    private func select(_ v: SPVersions.Entry) async {
        if v.current { selected = nil; preview = []; return }
        selected = v.at
        previewLoading = true
        defer { previewLoading = false }
        guard let st = await stateAt(v.at), selected == v.at, let snap = store.snapshot else { return }
        var out: [PreviewCell] = []
        var thenById: [String: [String: Any]] = [:]
        for r in st.rows { thenById[r.id] = r.cells }
        for key in st.changed {
            let (rowId, colId) = SPVersions.splitKey(key)
            guard let r = store.rows.firstIndex(where: { $0.id == rowId }),
                  let c = snap.columns.firstIndex(where: { $0.id == colId }) else { continue }
            let col = snap.columns[c]
            let then = thenById[rowId]?[colId]
            out.append(PreviewCell(id: key, address: SPFormat.a1(row: r, col: c), then: text(then, col.type),
                                   now: snap.display(row: r, col: c).text, order: r * 10_000 + c))
        }
        preview = out.sorted { $0.order < $1.order }
    }

    private func text(_ v: Any?, _ type: String) -> String {
        guard let v, !(v is NSNull) else { return T("(empty)") }
        if let f = SheetFormula.formulaOf(v) { let d = SheetFormula.toDisplay(f, store.panelShape); return d.hasPrefix("=") ? d : "=\(d)" }
        let s = SheetTypes.formatCell(type, v)
        return s.isEmpty ? T("(empty)") : s
    }

    private func restore(_ v: SPVersions.Entry) async {
        guard store.canEdit, let st = await stateAt(v.at) else { return }
        var thenById: [String: [String: Any]] = [:]
        for r in st.rows { thenById[r.id] = r.cells }
        let liveCols = Set(store.panelColumns.map { $0.id })
        var changes: [(String, String, Any?)] = []
        for key in st.changed {
            let (rowId, colId) = SPVersions.splitKey(key)
            guard let then = thenById[rowId], liveCols.contains(colId) else { continue }
            changes.append((rowId, colId, then[colId]))
        }
        selected = nil
        preview = []
        if !changes.isEmpty { store.setCells(changes, label: T("restore version")) }
        store.notice = T("Version restored.")
        await load()
    }

    private func name(_ v: SPVersions.Entry, _ text: String) async {
        let n = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else { return }
        var list = store.panelList("versions").filter { ($0["at"] as? String) != v.at }
        list.append(["id": SPChart.newId("ver"), "name": n, "at": v.at])
        await store.panelSaveSettings(["versions": list], label: T("name version"), pushUndo: ctx.pushUndo)
    }
}
