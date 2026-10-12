import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// The project's Spreadsheet tab (dev web components/sheets/ProjectSheetView + SheetMobile): the formula bar
/// (name box + the cell's content, edited there), a format bar, the grid, and the sheet tabs with the save
/// state and undo / redo underneath.
struct ProjectSheetsTab: View {
    let projectId: String
    @Environment(AuthStore.self) private var auth
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var store: SheetStore?

    var body: some View {
        Group {
            if let store {
                SheetScreen(store: store)
            } else {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: projectId) {
            if store == nil || store?.projectId != projectId {
                let s = SheetStore(projectId: projectId, meId: auth.session?.userId)
                store = s
                await s.loadTabs()
            }
        }
    }
}

private struct SheetScreen: View {
    @Bindable var store: SheetStore
    @Environment(\.horizontalSizeClass) private var hSize
    @FocusState private var barFocused: Bool
    @State private var picking = false
    @State private var renameColumn: Int?
    @State private var renameSheet: SheetTabInfo?
    @State private var deleteSheet: SheetTabInfo?
    @State private var nameText = ""

    private var wide: Bool { hSize == .regular }

    var body: some View {
        VStack(spacing: 0) {
            formulaBar
            Divider().overlay(NX.border)
            if wide && store.canEdit { formatBar; Divider().overlay(NX.border) }
            content
            Divider().overlay(NX.border)
            bottomBar
        }
        .background(NX.background)
        .realtimeRoom(store.sheetId.map { "sheet:\($0)" })
        .onReceive(NotificationCenter.default.publisher(for: .nexusSheetCells)) { note in
            if let o = Self.payload(note) { store.receiveCells(o) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .nexusSheetStructure)) { note in
            store.receiveStructure(Self.payload(note) ?? [:])
        }
        .onChange(of: store.editing) { _, editing in
            // A frame later: the field is created in this same update and focus set on it now may not stick.
            DispatchQueue.main.async { barFocused = editing }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            SheetOutbox.shared.flushAll()
        }
        .sheet(isPresented: $picking) { dropdownSheet }
        .alert(T("Rename column"), isPresented: Binding(get: { renameColumn != nil }, set: { if !$0 { renameColumn = nil } })) {
            TextField(T("Column name"), text: $nameText)
            Button(T("Save")) { if let c = renameColumn { let n = nameText; Task { await store.renameColumn(c, to: n) } } }
            Button(T("Cancel"), role: .cancel) {}
        } message: { Text(T("Leave it blank to show the column's letter.")) }
        .alert(T("Rename sheet"), isPresented: Binding(get: { renameSheet != nil }, set: { if !$0 { renameSheet = nil } }), presenting: renameSheet) { tab in
            TextField(T("Sheet name"), text: $nameText)
            Button(T("Save")) { let n = nameText; Task { await store.renameSheet(tab.id, to: n) } }
            Button(T("Cancel"), role: .cancel) {}
        }
        .alert(T("Delete this sheet?"), isPresented: Binding(get: { deleteSheet != nil }, set: { if !$0 { deleteSheet = nil } }), presenting: deleteSheet) { tab in
            Button(T("Delete"), role: .destructive) { Task { await store.deleteSheet(tab.id) } }
            Button(T("Cancel"), role: .cancel) {}
        } message: { tab in
            Text(T("“%@” and everything in it is deleted. A BoD can restore it from Audit.").replacingOccurrences(of: "%@", with: tab.name))
        }
    }

    private static func payload(_ note: Notification) -> SheetJSON? {
        guard let s = note.userInfo?[RealtimeKey.json] as? String, let d = s.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: d)) as? SheetJSON
    }

    // MARK: content

    @ViewBuilder private var content: some View {
        if store.loading && store.rows.isEmpty {
            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let err = store.loadError, store.rows.isEmpty {
            ErrorState(message: err, icon: "tablecells") { Task { await store.loadTabs() } }
        } else if store.tabs.isEmpty {
            EmptyState(icon: "tablecells", title: T("No spreadsheet yet"),
                       subtitle: T("A sheet for this project's numbers, lists and formulas. Add one to start."),
                       actionTitle: T("Add a sheet"), actionIcon: "plus") {
                Task { await store.addSheet() }
            }
        } else {
            SheetGridView(store: store, actions: actions)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var actions: SheetGridActions {
        SheetGridActions(
            beginEdit: { text in
                guard store.canEdit else { return }
                if store.snapshot?.dropdown(row: store.modelRow(store.selection.active.r) ?? 0,
                                            col: store.modelCol(store.selection.active.c) ?? 0) != nil, text == nil {
                    picking = true
                } else {
                    store.beginEdit(with: text)
                }
            },
            copy: { cut in copy(cut: cut) },
            paste: { paste() },
            menu: { p in menu(p) },
            tappedCheckbox: { p in store.toggleCheckbox(p) }
        )
    }

    // MARK: formula bar

    private var formulaBar: some View {
        HStack(spacing: 8) {
            Text(store.nameBox.isEmpty ? "—" : store.nameBox)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(NX.mutedFg)
                .lineLimit(1)
                .frame(minWidth: 52)
                .padding(.horizontal, 6).padding(.vertical, 6)
                .background(NX.muted, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            Text("fx").font(.system(size: 13, weight: .semibold, design: .serif)).italic().foregroundStyle(NX.mutedFg)
            barField
            if store.editing {
                Button { store.cancelEdit() } label: {
                    Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).frame(width: 34, height: 34)
                }
                .buttonStyle(.bordered)
                .accessibilityLabel(T("Cancel"))
                Button { store.commitEdit(move: nil) } label: {
                    Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).frame(width: 34, height: 34)
                }
                .buttonStyle(.borderedProminent).tint(NX.violet)
                .accessibilityLabel(T("Save"))
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(NX.card)
    }

    @ViewBuilder private var barField: some View {
        let dropdown = store.snapshot?.dropdown(row: store.modelRow(store.selection.active.r) ?? -1,
                                                col: store.modelCol(store.selection.active.c) ?? -1)
        if dropdown != nil && !store.editing {
            Button { if store.canEdit { picking = true } } label: {
                HStack {
                    Text(store.activeEditText.isEmpty ? T("Choose…") : store.activeEditText)
                        .font(NXFont.text(14)).foregroundStyle(store.activeEditText.isEmpty ? NX.mutedFg : NX.foreground).lineLimit(1)
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(NX.mutedFg)
                }
                .padding(.horizontal, 8).frame(height: 34)
                .background(NX.background, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
            }
            .buttonStyle(.plain)
        } else if store.editing {
            TextField(T("Type a value or a formula…"), text: $store.draft)
                .focused($barFocused)
                .font(.system(size: 14, design: store.draft.hasPrefix("=") ? .monospaced : .default))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .padding(.horizontal, 8).frame(height: 34)
                .background(NX.background, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.violet.opacity(0.6)))
                .onAppear { barFocused = true }
                .onSubmit { store.commitEdit(move: (1, 0)) }
                .onChange(of: store.draft) { _, _ in store.draftChanged() }
                // Esc cancels (bughunt: Esc in the formula bar used to keep the typing); Tab saves and moves right.
                .onKeyPress(.escape) { store.cancelEdit(); return .handled }
                .onKeyPress(.tab) { store.commitEdit(move: (0, 1)); return .handled }
        } else {
            Button { if store.canEdit { store.beginEdit() } } label: {
                Text(store.activeEditText.isEmpty ? (store.canEdit ? T("Tap to type") : " ") : store.activeEditText)
                    .font(.system(size: 14, design: store.activeEditText.hasPrefix("=") ? .monospaced : .default))
                    .foregroundStyle(store.activeEditText.isEmpty ? NX.mutedFg : NX.foreground)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 8).frame(height: 34)
                    .background(NX.background, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(T("Cell content"))
        }
    }

    // MARK: format bar (iPad / Mac)

    private var formatBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                SheetToolButton(icon: "arrow.uturn.backward", label: T("Undo"), enabled: store.canUndo) { Task { await store.undo() } }
                SheetToolButton(icon: "arrow.uturn.forward", label: T("Redo"), enabled: store.canRedo) { Task { await store.redo() } }
                Divider().frame(height: 20).padding(.horizontal, 4)
                SheetToolButton(icon: "bold", label: T("Bold"), on: store.activeStyle["b"] != nil) { store.toggleStyleFlag("b", label: T("bold")) }
                SheetToolButton(icon: "italic", label: T("Italic"), on: store.activeStyle["i"] != nil) { store.toggleStyleFlag("i", label: T("italic")) }
                SheetToolButton(icon: "strikethrough", label: T("Strikethrough"), on: store.activeStyle["s"] != nil) { store.toggleStyleFlag("s", label: T("strikethrough")) }
                Divider().frame(height: 20).padding(.horizontal, 4)
                alignButton("l", icon: "text.alignleft", label: T("Align left"))
                alignButton("c", icon: "text.aligncenter", label: T("Align center"))
                alignButton("r", icon: "text.alignright", label: T("Align right"))
                SheetToolButton(icon: "text.word.spacing", label: T("Wrap text"), on: store.activeStyle["w"] != nil) { store.toggleStyleFlag("w", label: T("wrap text")) }
                Divider().frame(height: 20).padding(.horizontal, 4)
                numberFormatMenu
                insertMenu
            }
            .padding(.horizontal, 8).padding(.vertical, 4)
        }
        .background(NX.card)
    }

    private func alignButton(_ value: String, icon: String, label: String) -> some View {
        SheetToolButton(icon: icon, label: label, on: (store.activeStyle["ha"] as? String) == value) {
            store.setStyles(label: T("alignment")) { st in
                var next = st
                next["ha"] = value
                return next
            }
        }
    }

    private var numberFormatMenu: some View {
        Menu {
            Button(T("Automatic")) { setNumberFormat(nil) }
            Button(T("Number")) { setNumberFormat("num") }
            Button(T("Rupiah")) { setNumberFormat("idr") }
            Button(T("Percent")) { setNumberFormat("pct") }
            Button(T("Date")) { setNumberFormat("date") }
            Button(T("Plain text")) { setNumberFormat("text") }
        } label: {
            Label(T("Format"), systemImage: "number").font(NXFont.text(13, .medium)).foregroundStyle(NX.foreground)
                .padding(.horizontal, 8).frame(height: 32)
        }
        .accessibilityLabel(T("Number format"))
    }

    private func setNumberFormat(_ nf: String?) {
        store.setStyles(label: T("number format")) { st in
            var next = st
            next["nf"] = nf
            next["dp"] = nil
            next["pt"] = nil
            return next
        }
    }

    private var insertMenu: some View {
        Menu {
            rowColumnItems
        } label: {
            Label(T("Rows & columns"), systemImage: "tablecells.badge.ellipsis").font(NXFont.text(13, .medium)).foregroundStyle(NX.foreground)
                .padding(.horizontal, 8).frame(height: 32)
        }
    }

    @ViewBuilder private var rowColumnItems: some View {
        Button { Task { await store.insertRows(above: true) } } label: { Label(T("Insert row above"), systemImage: "arrow.up.to.line") }
        Button { Task { await store.insertRows(above: false) } } label: { Label(T("Insert row below"), systemImage: "arrow.down.to.line") }
        Button { Task { await store.insertColumns(left: true) } } label: { Label(T("Insert column left"), systemImage: "arrow.left.to.line") }
        Button { Task { await store.insertColumns(left: false) } } label: { Label(T("Insert column right"), systemImage: "arrow.right.to.line") }
        Button { Task { await store.addRows(count: 100, after: nil) } } label: { Label(T("Add 100 rows at the bottom"), systemImage: "plus") }
        Divider()
        Button(role: .destructive) { Task { await store.deleteSelectedRows() } } label: { Label(T("Delete rows"), systemImage: "trash") }
        Button(role: .destructive) { Task { await store.deleteSelectedColumns() } } label: { Label(T("Delete columns"), systemImage: "trash") }
    }

    // MARK: bottom bar: sheet tabs, save state, undo / redo, sum

    private var bottomBar: some View {
        HStack(spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(store.tabs.filter { !$0.hidden }) { tab in
                        sheetTab(tab)
                    }
                    if store.canEdit {
                        Button { Task { await store.addSheet() } } label: {
                            Image(systemName: "plus").font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.mutedFg)
                                .frame(width: 34, height: 34).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(T("Add a sheet"))
                    }
                }
                .padding(.horizontal, 8)
            }
            saveState
            if !wide && store.canEdit {
                SheetToolButton(icon: "arrow.uturn.backward", label: T("Undo"), enabled: store.canUndo) { Task { await store.undo() } }
                SheetToolButton(icon: "arrow.uturn.forward", label: T("Redo"), enabled: store.canRedo) { Task { await store.redo() } }
                Menu { rowColumnItems } label: {
                    Image(systemName: "ellipsis.circle").font(.system(size: 16)).foregroundStyle(NX.mutedFg).frame(width: 36, height: 36)
                }
                .accessibilityLabel(T("More"))
            }
        }
        .padding(.trailing, 6)
        .frame(minHeight: 44)
        .background(NX.card)
        .overlay(alignment: .top) {
            if let notice = store.notice {
                Text(notice).font(NXFont.text(12, .medium)).foregroundStyle(NX.foreground)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(.regularMaterial, in: Capsule())
                    .offset(y: -40)
                    .onTapGesture { store.notice = nil }
                    .task(id: notice) {
                        try? await Task.sleep(nanoseconds: 4_000_000_000)
                        if store.notice == notice { store.notice = nil }
                    }
            }
        }
    }

    private func sheetTab(_ tab: SheetTabInfo) -> some View {
        let on = tab.id == store.sheetId
        return Button { Task { await store.open(tab.id) } } label: {
            Text(tab.name.isEmpty ? T("Sheet") : tab.name)
                .font(NXFont.text(13, on ? .semibold : .regular))
                .foregroundStyle(on ? NX.violetText : NX.mutedFg)
                .lineLimit(1)
                .padding(.horizontal, 12).frame(height: 30)
                .background(on ? NX.violet.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            if store.canEdit {
                Button { nameText = tab.name; renameSheet = tab } label: { Label(T("Rename…"), systemImage: "pencil") }
                Button { Task { await store.duplicateSheet(tab.id) } } label: { Label(T("Duplicate"), systemImage: "plus.square.on.square") }
            }
            if store.canManage && tab.position != 0 {
                Button(role: .destructive) { deleteSheet = tab } label: { Label(T("Delete"), systemImage: "trash") }
            }
        }
    }

    @ViewBuilder private var saveState: some View {
        if store.pendingCount > 0 && store.offline {
            Label("\(store.pendingCount)", systemImage: "icloud.slash")
                .font(NXFont.text(11, .semibold)).foregroundStyle(NX.warning)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(NX.warning.opacity(0.14), in: Capsule())
                .accessibilityLabel(T("Offline — %d changes waiting").replacingOccurrences(of: "%d", with: "\(store.pendingCount)"))
        } else if store.saving || store.pendingCount > 0 {
            Text(T("Saving…")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
        } else if let sum = selectionSum {
            Text(sum).font(NXFont.text(11, .medium)).foregroundStyle(NX.mutedFg).lineLimit(1)
        }
    }

    /// "Sum: 1.234" for a block of numbers (status bar, Sheets).
    private var selectionSum: String? {
        guard !store.selection.isSingleCell, let snap = store.snapshot else { return nil }
        var total = 0.0, count = 0
        for range in store.selection.ranges {
            for p in range.positions {
                guard let r = store.modelRow(p.r), let c = store.modelCol(p.c), let n = snap.number(row: r, col: c) else { continue }
                total += n
                count += 1
            }
        }
        guard count > 0 else { return nil }
        return T("Sum: %@").replacingOccurrences(of: "%@", with: snap.formatNumber(total))
    }

    // MARK: dropdown

    @ViewBuilder private var dropdownSheet: some View {
        let r = store.modelRow(store.selection.active.r) ?? -1
        let c = store.modelCol(store.selection.active.c) ?? -1
        if let dd = store.snapshot?.dropdown(row: r, col: c) {
            SheetDropdownPicker(options: dd.options, colors: dd.colors, multiple: dd.multiple, picked: dd.picked) { values in
                store.pick(values)
            }
        }
    }

    // MARK: clipboard + menu

    private static let nexusType = "com.znetworks.nexus.sheet"

    private func copy(cut: Bool) {
        guard let out = store.copyPayload(cut: cut) else { return }
        var item: [String: Any] = [UTType.utf8PlainText.identifier: out.tsv, UTType.html.identifier: out.html]
        if let data = out.json.data(using: .utf8) { item[Self.nexusType] = data }
        UIPasteboard.general.setItems([item])
        if cut { store.clearSelection() }
    }

    private func paste() {
        let pb = UIPasteboard.general
        let json = pb.data(forPasteboardType: Self.nexusType).flatMap { String(data: $0, encoding: .utf8) }
        let html = pb.data(forPasteboardType: UTType.html.identifier).flatMap { String(data: $0, encoding: .utf8) }
        let text = pb.string
        guard json != nil || html != nil || text != nil else { return }
        Task { await store.paste(json: json, html: html, text: text) }
    }

    private func menu(_ p: SheetPos) -> UIMenu? {
        var items: [UIMenuElement] = []
        items.append(UIAction(title: T("Copy"), image: UIImage(systemName: "doc.on.doc")) { _ in copy(cut: false) })
        if store.canEdit {
            items.insert(UIAction(title: T("Cut"), image: UIImage(systemName: "scissors")) { _ in copy(cut: true) }, at: 0)
            items.append(UIAction(title: T("Paste"), image: UIImage(systemName: "doc.on.clipboard")) { _ in paste() })
            items.append(UIAction(title: T("Clear"), image: UIImage(systemName: "eraser"), attributes: .destructive) { _ in store.clearSelection() })
            let rows = UIMenu(title: T("Rows"), image: UIImage(systemName: "arrow.up.and.down"), children: [
                UIAction(title: T("Insert row above")) { _ in Task { await store.insertRows(above: true) } },
                UIAction(title: T("Insert row below")) { _ in Task { await store.insertRows(above: false) } },
                UIAction(title: T("Delete rows"), attributes: .destructive) { _ in Task { await store.deleteSelectedRows() } },
            ])
            let cols = UIMenu(title: T("Columns"), image: UIImage(systemName: "arrow.left.and.right"), children: [
                UIAction(title: T("Insert column left")) { _ in Task { await store.insertColumns(left: true) } },
                UIAction(title: T("Insert column right")) { _ in Task { await store.insertColumns(left: false) } },
                UIAction(title: T("Rename column…")) { _ in nameText = store.columnName(p.c); renameColumn = p.c },
                UIAction(title: T("Delete columns"), attributes: .destructive) { _ in Task { await store.deleteSelectedColumns() } },
            ])
            items.append(rows)
            items.append(cols)
        }
        return UIMenu(children: items)
    }
}

/// One format-bar button: an icon, a soft fill when its format is on.
private struct SheetToolButton: View {
    let icon: String
    let label: String
    var on = false
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(enabled ? (on ? NX.violetText : NX.foreground) : NX.mutedFg.opacity(0.5))
                .frame(width: 34, height: 32)
                .background(on ? NX.violet.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .hoverEffect(.highlight)
        .accessibilityLabel(label)
    }
}

/// A dropdown cell's choices (data validation list or a select column): one, or several for a multi-select.
private struct SheetDropdownPicker: View {
    let options: [String]
    let colors: [String: String]
    let multiple: Bool
    @State var picked: [String]
    let onDone: ([String]) -> Void
    @Environment(\.dismiss) private var dismiss

    init(options: [String], colors: [String: String], multiple: Bool, picked: [String], onDone: @escaping ([String]) -> Void) {
        self.options = options
        self.colors = colors
        self.multiple = multiple
        _picked = State(initialValue: picked)
        self.onDone = onDone
    }

    var body: some View {
        NavigationStack {
            List {
                if options.isEmpty {
                    EmptyState(icon: "list.bullet", title: T("No choices yet"),
                               subtitle: T("Add choices to this dropdown on the web (Data › Data validation)."), compact: true)
                }
                ForEach(options, id: \.self) { option in
                    Button {
                        if multiple {
                            if picked.contains(option) { picked.removeAll { $0 == option } } else { picked.append(option) }
                        } else {
                            onDone(picked.first == option ? [] : [option])
                            dismiss()
                        }
                    } label: {
                        HStack {
                            Text(option)
                                .font(NXFont.text(14, .medium))
                                .foregroundStyle(SheetChip.textColor(colors[option]))
                                .padding(.horizontal, 10).padding(.vertical, 4)
                                .background(SheetChip.fillColor(colors[option]), in: Capsule())
                            Spacer()
                            if picked.contains(option) { Image(systemName: "checkmark").foregroundStyle(NX.violetText) }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .navigationTitle(T("Choose"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() } }
                if multiple {
                    ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { onDone(picked); dismiss() } }
                }
                if !picked.isEmpty && !multiple {
                    ToolbarItem(placement: .bottomBar) { Button(T("Clear"), role: .destructive) { onDone([]); dismiss() } }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
