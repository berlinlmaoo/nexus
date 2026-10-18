import SwiftUI

// Cell comments and cell history (web CellComments.tsx + the View ▸ Comments side panel). Both are anchored by
// (rowId, columnId), never by "C5", so sorting, inserting rows or moving columns can't detach them.

/// One cell's popover as a sheet: its comment thread and its edit history.
struct SheetCellCommentsPanel: View {
    let ctx: SheetPanelContext
    let rowId: String
    let columnId: String
    /// false when pushed from the comment list (that list owns the navigation stack).
    var standalone = true
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        if standalone {
            NavigationStack { SheetCellThreadView(ctx: ctx, rowId: rowId, columnId: columnId, onClose: { dismiss() }) }
                .spPanelPresentation()
        } else {
            SheetCellThreadView(ctx: ctx, rowId: rowId, columnId: columnId, onClose: nil)
        }
    }
}

private struct SheetCellThreadView: View {
    let ctx: SheetPanelContext
    let rowId: String
    let columnId: String
    let onClose: (() -> Void)?
    @State private var tab = 0
    @State private var draft = ""
    @State private var revisions: [SPRevision] = []
    @State private var revisionsLoading = false
    @State private var revisionsError: String?
    @State private var deleting: SPComment?
    @FocusState private var composing: Bool

    private var model: SheetCommentsModel { ctx.comments }
    private var store: SheetStore { ctx.store }
    private var thread: [SPComment] { model.thread(rowId: rowId, columnId: columnId) }
    private var openCount: Int { thread.filter { $0.resolvedAt == nil }.count }

    private var address: String {
        guard let r = store.rows.firstIndex(where: { $0.id == rowId }),
              let c = store.columns.firstIndex(where: { ($0["id"] as? String) == columnId }) else { return "" }
        return SPFormat.a1(row: r, col: c)
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $tab) {
                Text(openCount > 0 ? "\(T("Comments")) (\(openCount))" : T("Comments")).tag(0)
                Text(T("History")).tag(1)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16).padding(.vertical, 8)
            if tab == 0 { commentsTab } else { historyTab }
        }
        .background(NX.background)
        .navigationTitle(address.isEmpty ? T("Comments") : "\(T("Cell")) \(address)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let onClose { ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { onClose() } } }
            if model.busy { ToolbarItem(placement: .topBarLeading) { ProgressView() } }
        }
        .task(id: tab) { if tab == 1 { await loadHistory() } }
        .alert(T("Delete this comment?"), isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), presenting: deleting) { c in
            Button(T("Delete"), role: .destructive) { Task { await model.delete(c) } }
            Button(T("Cancel"), role: .cancel) {}
        } message: { _ in Text(T("A board member can restore it from Audit.")) }
        .alert(T("Couldn't save."), isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) {
            Button(T("OK"), role: .cancel) {}
        } message: { Text(model.error ?? "") }
    }

    // MARK: comments

    private var commentsTab: some View {
        VStack(spacing: 0) {
            List {
                if thread.isEmpty {
                    EmptyState(icon: "text.bubble", title: T("No comments on this cell yet."),
                               subtitle: store.canEdit ? T("Write the first one below. @name tags a teammate.") : "", compact: true)
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                }
                ForEach(thread) { c in row(c) }
            }
            .listStyle(.plain)
            if store.canEdit { composer }
        }
    }

    private func row(_ c: SPComment) -> some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarView(url: c.authorAvatar, initial: String((c.authorName ?? "?").prefix(1)).uppercased(), size: 28, userId: c.authorId, name: c.authorName)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(c.authorName ?? "—").font(NXFont.text(13, .semibold)).lineLimit(1)
                    Text(SPFormat.when(c.createdAt)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    if c.resolvedAt != nil {
                        Text(T("resolved")).font(NXFont.text(10, .bold)).foregroundStyle(NX.success)
                            .padding(.horizontal, 6).padding(.vertical, 1)
                            .background(NX.success.opacity(0.14), in: Capsule())
                    }
                }
                Text(c.body).font(NXFont.text(14)).foregroundStyle(NX.foreground).textSelection(.enabled)
            }
            Spacer(minLength: 0)
        }
        .opacity(c.resolvedAt == nil ? 1 : 0.55)
        .swipeActions(edge: .trailing) {
            if store.canEdit && c.authorId == model.meId {
                Button(role: .destructive) { deleting = c } label: { Label(T("Delete"), systemImage: "trash") }
            }
            if store.canEdit {
                Button { Task { await model.setResolved(c, c.resolvedAt == nil) } } label: {
                    Label(c.resolvedAt == nil ? T("Mark resolved") : T("Reopen"), systemImage: c.resolvedAt == nil ? "checkmark" : "arrow.uturn.backward")
                }
                .tint(NX.success)
            }
        }
        .contextMenu {
            if store.canEdit {
                Button { Task { await model.setResolved(c, c.resolvedAt == nil) } } label: {
                    Label(c.resolvedAt == nil ? T("Mark resolved") : T("Reopen"), systemImage: "checkmark")
                }
                if c.authorId == model.meId {
                    Button(role: .destructive) { deleting = c } label: { Label(T("Delete"), systemImage: "trash") }
                }
            }
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField(T("Write a comment… (@name to tag)"), text: $draft, axis: .vertical)
                .lineLimit(1...5)
                .focused($composing)
                .font(NXFont.text(14))
                .padding(.horizontal, 10).padding(.vertical, 8)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
            Button {
                let text = draft
                Task { if await model.add(rowId: rowId, columnId: columnId, body: text) { draft = "" } }
            } label: {
                Image(systemName: "paperplane.fill").font(.system(size: 15, weight: .semibold)).frame(width: 38, height: 38)
            }
            .buttonStyle(.borderedProminent).tint(NX.violet)
            .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.busy)
            .accessibilityLabel(T("Send comment"))
        }
        .padding(10)
        .background(NX.card)
    }

    // MARK: history

    private var historyTab: some View {
        List {
            if revisionsLoading && revisions.isEmpty {
                HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
            } else if let revisionsError, revisions.isEmpty {
                ErrorState(message: revisionsError, icon: "clock.arrow.circlepath") { Task { await loadHistory() } }
                    .listRowBackground(Color.clear)
            } else if revisions.isEmpty {
                EmptyState(icon: "clock.arrow.circlepath", title: T("No changes recorded on this cell yet."),
                           subtitle: T("Every edit made from now on shows here, with who made it."), compact: true)
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
            }
            ForEach(Array(revisions.enumerated()), id: \.offset) { _, r in revisionRow(r) }
            Section {
            } footer: {
                Text(T("History is kept for 90 days. The latest change of every cell is kept forever, so \"who put this number here\" is never lost."))
                    .font(NXFont.text(11))
            }
        }
        .listStyle(.plain)
        .refreshable { await loadHistory() }
    }

    private func revisionRow(_ r: SPRevision) -> some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarView(url: r.authorAvatar, initial: String((r.authorName ?? "?").prefix(1)).uppercased(), size: 28, userId: r.authorId, name: r.authorName)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(r.authorName ?? T("deleted account")).font(NXFont.text(13, .semibold)).lineLimit(1)
                    Text(SPFormat.when(r.createdAt)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                HStack(spacing: 4) {
                    Text(show(r.oldValue)).strikethrough().foregroundStyle(NX.mutedFg)
                    Text("→").foregroundStyle(NX.mutedFg)
                    Text(show(r.newValue)).fontWeight(.semibold)
                }
                .font(NXFont.text(13))
                .lineLimit(2)
            }
            Spacer(minLength: 0)
            if store.canEdit {
                Button {
                    store.setCells([(rowId, columnId, r.oldValue)], label: T("restore cell value"))
                    onClose?()
                } label: {
                    Image(systemName: "arrow.counterclockwise").font(.system(size: 14, weight: .medium)).frame(width: 34, height: 34)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(T("Restore to %@").replacingOccurrences(of: "%@", with: show(r.oldValue)))
            }
        }
    }

    /// A stored value as a person reads it: formulas as their A1 form, empty as an explicit label.
    private func show(_ v: Any?) -> String {
        guard let v, !(v is NSNull) else { return T("(empty)") }
        if let s = v as? String, s.isEmpty { return T("(empty)") }
        let shape = store.panelShape
        if let f = SheetFormula.formulaOf(v) {
            let d = SheetFormula.toDisplay(f, shape)
            return d.hasPrefix("=") ? d : "=\(d)"
        }
        let type = store.panelColumns.first { $0.id == columnId }?.type ?? "text"
        let text = SheetTypes.formatCell(type, v)
        if !text.isEmpty { return text }
        return v is [String: Any] || v is [Any] ? "" : SheetFormula.jsString(v)
    }

    private func loadHistory() async {
        guard let sid = store.sheetId else { return }
        revisionsLoading = true
        defer { revisionsLoading = false }
        do {
            revisions = try await SheetPanelAPI.revisions(sid, rowId: rowId, columnId: columnId)
            revisionsError = nil
        } catch {
            revisionsError = SheetPanelAPI.message(error, T("Couldn't load the history."))
        }
    }
}

/// View ▸ Comments: every cell with an open comment; a tap selects the cell and opens its thread.
struct SheetAllCommentsPanel: View {
    let ctx: SheetPanelContext
    @Environment(\.dismiss) private var dismiss

    private struct Item: Identifiable {
        let id: String
        let rowId: String
        let columnId: String
        let address: String
        let text: String
        let count: Int
        let order: Int
    }

    private var items: [Item] {
        let store = ctx.store
        var out: [Item] = []
        for (key, n) in ctx.comments.counts {
            let (rowId, colId) = SPVersions.splitKey(key)
            guard let r = store.rows.firstIndex(where: { $0.id == rowId }),
                  let c = store.columns.firstIndex(where: { ($0["id"] as? String) == colId }) else { continue }
            let text = store.snapshot?.display(row: r, col: c).text ?? ""
            out.append(Item(id: key, rowId: rowId, columnId: colId, address: SPFormat.a1(row: r, col: c), text: text, count: n,
                            order: r * 10_000 + c))
        }
        return out.sorted { $0.order < $1.order }
    }

    var body: some View {
        NavigationStack {
            List {
                if items.isEmpty {
                    EmptyState(icon: "text.bubble", title: T("No open comments on this sheet."),
                               subtitle: T("Select a cell and choose Comment to start a thread. Resolved threads don't show here."), compact: true)
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                }
                ForEach(items) { it in
                    NavigationLink {
                        SheetCellCommentsPanel(ctx: ctx, rowId: it.rowId, columnId: it.columnId, standalone: false)
                            .onAppear { ctx.store.panelSelect(rowId: it.rowId, columnId: it.columnId) }
                    } label: {
                        HStack(spacing: 10) {
                            Text(it.address).font(.system(size: 12, design: .monospaced)).foregroundStyle(NX.mutedFg).frame(minWidth: 44, alignment: .leading)
                            Text(it.text.isEmpty ? "—" : it.text).font(NXFont.text(14)).lineLimit(1)
                            Spacer(minLength: 4)
                            Text((it.count == 1 ? T("1 comment") : T("%d comments")).replacingOccurrences(of: "%d", with: "\(it.count)"))
                                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(T("Comments"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { dismiss() } } }
            .refreshable { await ctx.comments.reload() }
        }
        .spPanelPresentation()
    }
}
