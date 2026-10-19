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
    /// The column whose filter menu is open (the funnel on the filter's header row).
    @State private var filterColumn: Int?
    /// The slicer whose value list is open (its chip on the grid tapped again).
    @State private var slicerMenu: String?
    /// iPhone: the Format sheet.
    @State private var formatting = false
    /// The open panel (find, comments, versions, validation, conditional formats, charts, pivot): ONE
    /// enum-driven sheet, presented from a background so this view doesn't stack another .sheet.
    @State private var panel: SheetPanelKind?
    @State private var comments = SheetCommentsModel()
    /// Format › Rotation › Custom angle (centred alert with a number field).
    @State private var askingAngle = false
    @State private var angleText = ""

    private var wide: Bool { hSize == .regular }

    // Split in three so the type checker finishes (one chain of ~25 modifiers timed out).
    var body: some View { withAlerts(withSheets(base)) }

    private var base: some View {
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
        // R-19 `project-changed`: tabs added, renamed, reordered or deleted elsewhere, and cell comments.
        // The grid itself stays on `sheet-cells` / `sheet-structure`.
        .onReceive(NotificationCenter.default.publisher(for: .nexusProjectChanged)) { note in
            let info = note.userInfo
            if let pid = info?[RealtimeKey.projectId] as? String, pid != store.projectId { return }
            switch info?[RealtimeKey.kind] as? String {
            case "sheets": Task { await store.refreshTabs() }
            case "sheet-comments":
                if let id = info?[RealtimeKey.itemId] as? String, id != store.sheetId { return }
                Task { await comments.reload() }
            case nil: Task { await store.refreshTabs() }
            default: break
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .nexusRoomRevoked)) { note in
            guard let id = store.sheetId, (note.userInfo?[RealtimeKey.room] as? String) == "sheet:\(id)" else { return }
            store.notice = T("Your access to this project changed")
            Task { await store.reload() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .nexusSheetStructure)) { note in
            store.receiveStructure(Self.payload(note) ?? [:])
            // Catch-up after a reconnect (or a structure change): comment threads and markers too —
            // open thread panels read from this model, so they follow.
            Task { await comments.reload() }
        }
        .onChange(of: store.editing) { _, editing in
            // A frame later: the field is created in this same update and focus set on it now may not stick.
            DispatchQueue.main.async { barFocused = editing }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            SheetOutbox.shared.flushAll()
        }
    }

    private func withSheets<V: View>(_ v: V) -> some View {
        // One .sheet per host view (two on the same view leave buttons dead): each on its own background.
        v.background { Color.clear.sheet(isPresented: $picking) { dropdownSheet } }
        .background { Color.clear.sheet(isPresented: Binding(get: { filterColumn != nil }, set: { if !$0 { filterColumn = nil } })) { filterSheet } }
        .background { Color.clear.sheet(isPresented: Binding(get: { slicerMenu != nil }, set: { if !$0 { slicerMenu = nil } })) { slicerSheet } }
        .background { Color.clear.sheet(isPresented: $formatting) { SheetGridFormatSheet(store: store) } }
        .background { Color.clear.sheet(item: $panel) { kind in SheetPanelHost(kind: kind, ctx: panelContext) } }
        .task(id: store.sheetId) { await comments.load(store.sheetId) }
        // New / resolved comments redraw the corner markers.
        .onChange(of: comments.version) { _, _ in store.version += 1 }
    }

    private func withAlerts<V: View>(_ v: V) -> some View {
        // Alerts each on their own background: one presentation per view (two on one view leave one dead).
        v.background { Color.clear.alert(T("Rename column"), isPresented: Binding(get: { renameColumn != nil }, set: { if !$0 { renameColumn = nil } })) {
            TextField(T("Column name"), text: $nameText)
            Button(T("Save")) { if let c = renameColumn { let n = nameText; Task { await store.renameColumn(c, to: n) } } }
            Button(T("Cancel"), role: .cancel) {}
        } message: { Text(T("Leave it blank to show the column's letter.")) } }
        .background { Color.clear.alert(T("Rename sheet"), isPresented: Binding(get: { renameSheet != nil }, set: { if !$0 { renameSheet = nil } }), presenting: renameSheet) { tab in
            TextField(T("Sheet name"), text: $nameText)
            Button(T("Save")) { let n = nameText; Task { await store.renameSheet(tab.id, to: n) } }
            Button(T("Cancel"), role: .cancel) {}
        } }
        .background { Color.clear.alert(T("Delete this sheet?"), isPresented: Binding(get: { deleteSheet != nil }, set: { if !$0 { deleteSheet = nil } }), presenting: deleteSheet) { tab in
            Button(T("Delete"), role: .destructive) { Task { await store.deleteSheet(tab.id) } }
            Button(T("Cancel"), role: .cancel) {}
        } message: { tab in
            Text(T("“%@” and everything in it is deleted. A board member can restore it from Audit.").replacingOccurrences(of: "%@", with: tab.name))
        } }
        // A "Show a warning" protected range (web "Heads up!").
        .background { Color.clear.alert(T("Heads up!"), isPresented: Binding(get: { store.protectPrompt != nil }, set: { if !$0 { store.protectPrompt = nil } })) {
            Button(T("OK")) { store.answerProtectPrompt(true) }
            Button(T("OK, don't show this again for 5 minutes")) { store.answerProtectPrompt(true, mute: true) }
            Button(T("Cancel"), role: .cancel) { store.answerProtectPrompt(false) }
        } message: {
            Text(T("You are trying to edit a protected part of this sheet. Do this only if you are sure the change is needed."))
        } }
        .background { Color.clear.alert(T("Custom angle"), isPresented: $askingAngle) {
            TextField(T("Degrees (−90 to 90)"), text: $angleText).keyboardType(.numbersAndPunctuation)
            Button(T("Apply")) {
                let raw = angleText.replacingOccurrences(of: ",", with: ".").replacingOccurrences(of: "−", with: "-")
                if let v = Double(SheetJS.trim(raw)), v.isFinite { store.setRotation(Int(v.rounded())) }
            }
            Button(T("Cancel"), role: .cancel) {}
        } message: { Text(T("Tilt the text counter-clockwise by this many degrees.")) } }
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
                    store.guardProtected([store.selection.active]) { picking = true }
                } else {
                    store.beginEdit(with: text)
                }
            },
            copy: { cut in copy(cut: cut) },
            paste: { paste() },
            menu: { p in menu(p) },
            tappedCheckbox: { p in store.toggleCheckbox(p) },
            filterMenu: { c in filterColumn = c },
            commentCount: { p in
                guard let r = store.rowId(p.r), let c = store.columnId(p.c) else { return 0 }
                return comments.count(rowId: r, columnId: c)
            },
            openChart: { id in openPanel(.chart(id)) },
            openSlicer: { id in
                if store.editing { store.commitEdit(move: nil) }
                slicerMenu = id
            },
            editSlicer: { id in openPanel(.slicer(id)) }
        )
    }

    private var panelContext: SheetPanelContext {
        SheetPanelContext(store: store, comments: comments, pushUndo: { entry in store.push(entry) })
    }

    /// Data ▸ Add a slicer: placed beside the data, its editor opened (web addSlicer).
    private func addSlicer() {
        if store.editing { store.commitEdit(move: nil) }
        Task {
            if let id = await store.addSlicer() { openPanel(.slicer(id)) }
        }
    }

    private func openPanel(_ k: SheetPanelKind) {
        if store.editing { store.commitEdit(move: nil) }
        panel = k
    }

    // MARK: formula bar

    private var formulaBar: some View {
        HStack(spacing: 8) {
            Text(store.nameBox.isEmpty ? "—" : store.nameBox)
                .accessibilityIdentifier("sheet.activeCell")
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
                .accessibilityLabel(T("Cancel")).accessibilityIdentifier("sheet.formula.cancel")
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
            Button { if store.canEdit { store.guardProtected([store.selection.active]) { picking = true } } } label: {
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
                .accessibilityIdentifier("sheet.formula.edit")
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
                Text(store.activeEditText.isEmpty ? (store.canEdit ? PlatformWording.tapOrClick(tap: "Tap to type", click: "Click to type") : " ") : store.activeEditText)
                    .font(.system(size: 14, design: store.activeEditText.hasPrefix("=") ? .monospaced : .default))
                    .foregroundStyle(store.activeEditText.isEmpty ? NX.mutedFg : NX.foreground)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 8).frame(height: 34)
                    .background(NX.background, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain).accessibilityIdentifier("sheet.formula.begin")
            .accessibilityLabel(T("Cell content"))
        }
    }

    // MARK: format bar (iPad / Mac)

    private var formatBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                historyTools
                barDivider
                numberTools
                barDivider
                textTools
                barDivider
                alignTools
                barDivider
                sheetTools
            }
            .padding(.horizontal, 8).padding(.vertical, 4)
        }
        .background(NX.card)
    }

    private var historyTools: some View {
        HStack(spacing: 2) {
            SheetToolButton(icon: "arrow.uturn.backward", label: T("Undo"), enabled: store.canUndo) { Task { await store.undo() } }
            SheetToolButton(icon: "arrow.uturn.forward", label: T("Redo"), enabled: store.canRedo) { Task { await store.redo() } }
        }
    }

    private var numberTools: some View {
        HStack(spacing: 2) {
            numberFormatMenu
            SheetToolButton(icon: "arrow.left.to.line.compact", label: T("Decrease decimal places")) { store.changeDecimals(-1) }
            SheetToolButton(icon: "arrow.right.to.line.compact", label: T("Increase decimal places")) { store.changeDecimals(1) }
            fontFamilyMenu
            fontSizeMenu
        }
    }

    private var textTools: some View {
        HStack(spacing: 2) {
            SheetToolButton(icon: "bold", label: T("Bold"), on: store.activeStyle["b"] != nil) { store.toggleStyleFlag("b", label: T("bold")) }
            SheetToolButton(icon: "italic", label: T("Italic"), on: store.activeStyle["i"] != nil) { store.toggleStyleFlag("i", label: T("italic")) }
            SheetToolButton(icon: "strikethrough", label: T("Strikethrough"), on: store.activeStyle["s"] != nil) { store.toggleStyleFlag("s", label: T("strikethrough")) }
            colourTools
            mergeMenu
        }
    }

    private var colourTools: some View {
        HStack(spacing: 2) {
            SheetPopoverButton(icon: "character", label: T("Text colour"), swatch: swatch(store.activeStyle["fc"], fallback: NX.foreground)) { close in
                SheetGridPalette(selected: store.activeStyle["fc"] as? String, resetTitle: T("Reset")) { hex in store.setTextColor(hex); close() }
            }
            SheetPopoverButton(icon: "drop.fill", label: T("Fill colour"), swatch: swatch(store.activeStyle["bg"], fallback: .clear)) { close in
                SheetGridPalette(selected: store.activeStyle["bg"] as? String, resetTitle: T("Reset")) { hex in store.setFillColor(hex); close() }
            }
            SheetPopoverButton(icon: "square.grid.3x3", label: T("Borders")) { close in
                SheetGridBordersPanel { preset, line, color in store.applyBorders(preset, line: line, color: color); close() }
            }
        }
    }

    private var alignTools: some View {
        HStack(spacing: 2) {
            alignButton("l", icon: "text.alignleft", label: T("Align left"))
            alignButton("c", icon: "text.aligncenter", label: T("Align center"))
            alignButton("r", icon: "text.alignright", label: T("Align right"))
            verticalMenu
            wrapMenu
            rotationMenu
        }
    }

    private var sheetTools: some View {
        HStack(spacing: 2) {
            SheetToolButton(icon: "line.3.horizontal.decrease", label: store.hasFilter ? T("Remove filter") : T("Create a filter"),
                            on: store.hasFilter) { Task { await store.toggleFilter() } }
            viewMenu
            dataMenu
            insertMenu
            Menu { SheetPanelMenuItems(store: store) { openPanel($0) } } label: {
                Label(T("Tools"), systemImage: "wand.and.stars").font(NXFont.text(13, .medium)).foregroundStyle(NX.foreground)
                    .padding(.horizontal, 8).frame(height: 32)
            }
        }
    }

    private var barDivider: some View { Divider().frame(height: 20).padding(.horizontal, 4) }

    private func swatch(_ value: Any?, fallback: Color) -> Color {
        guard let hex = SheetGridStyle.toHex(value as? String), let ui = SheetBridge.hexColor(hex) else { return fallback }
        return Color(uiColor: ui)
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

    /// A menu row with a tick when it is the current choice.
    @ViewBuilder private func checkLabel(_ title: String, _ on: Bool) -> some View {
        if on { Label(title, systemImage: "checkmark") } else { Text(title) }
    }

    private func barMenu<Content: View>(_ title: String, icon: String, @ViewBuilder _ content: () -> Content) -> some View {
        Menu { content() } label: {
            Label(title, systemImage: icon).font(NXFont.text(13, .medium)).foregroundStyle(NX.foreground)
                .padding(.horizontal, 8).frame(height: 32)
        }
        .accessibilityLabel(title)
    }

    private var numberFormatMenu: some View {
        Menu {
            ForEach(SheetNumberFormatPicker.formats.indices, id: \.self) { i in
                let f = SheetNumberFormatPicker.formats[i]
                Button { setNumberFormat(f.0) } label: { checkLabel(T(f.1), (store.activeStyle["nf"] as? String) == f.0) }
            }
            Divider()
            Button { openPanel(.customCurrency) } label: { Text(T("Custom currency…")) }
            Button { openPanel(.customDate) } label: { Text(T("Custom date and time…")) }
            Button { openPanel(.customNumber) } label: {
                checkLabel(T("Custom number format…"), (store.activeStyle["nf"] as? String) == "custom")
            }
        } label: {
            Label(T("Format"), systemImage: "number").font(NXFont.text(13, .medium)).foregroundStyle(NX.foreground)
                .padding(.horizontal, 8).frame(height: 32)
        }
        .accessibilityLabel(T("Number format"))
    }

    private func setNumberFormat(_ nf: String?) {
        store.patchSelection(["nf": nf, "dp": nil, "pt": nil], label: T("number format"))
    }

    private var fontSizeMenu: some View {
        Menu {
            ForEach(SheetGridStyle.fontSizesPt, id: \.self) { pt in
                Button { store.setFontSize(pt) } label: { checkLabel("\(pt)", Int(store.activeFontPt) == pt) }
            }
        } label: {
            HStack(spacing: 3) {
                Text(Self.ptText(store.activeFontPt)).font(.system(size: 13, weight: .medium)).monospacedDigit()
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(NX.foreground)
            .padding(.horizontal, 8).frame(height: 32)
        }
        .accessibilityLabel(T("Font size"))
    }

    private var fontFamilyMenu: some View {
        let current = SheetGridText.family(store.activeStyle)
        return Menu {
            Button { store.setFontFamily(nil) } label: { checkLabel(T("Default (Sans Serif)"), current == nil) }
            Divider()
            ForEach(SheetGridText.fontFamilies.indices, id: \.self) { i in
                let name = SheetGridText.fontFamilies[i].name
                Button { store.setFontFamily(name) } label: { checkLabel(name, current?.lowercased() == name.lowercased()) }
            }
        } label: {
            HStack(spacing: 3) {
                Text(current ?? T("Default")).font(SheetGridFonts.preview(current)).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(NX.foreground)
            .frame(maxWidth: 120)
            .padding(.horizontal, 8).frame(height: 32)
        }
        .accessibilityLabel(T("Font"))
    }

    private var rotationMenu: some View {
        let rot = SheetGridText.rotation(store.activeStyle)
        return Menu {
            ForEach(SheetGridText.rotationPresets.indices, id: \.self) { i in
                let preset = SheetGridText.rotationPresets[i]
                let on = SheetGridText.rotation(preset.value.map { ["rt": $0] }) == rot
                Button { store.setRotation(preset.value) } label: { checkLabel(T(preset.label), on) }
            }
            Divider()
            Button {
                angleText = rot.vertical ? "0" : "\(Int(rot.degrees))"
                askingAngle = true
            } label: { Text(T("Custom angle…")) }
        } label: {
            Image(systemName: rot.isNone ? "textformat.abc" : "textformat.abc.dottedunderline")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(rot.isNone ? NX.foreground : NX.violetText)
                .rotationEffect(.degrees(rot.vertical ? 90 : -rot.degrees))
                .frame(width: 34, height: 32)
        }
        .accessibilityLabel(T("Text rotation"))
    }

    private static func ptText(_ pt: Double) -> String { pt == pt.rounded() ? "\(Int(pt))" : String(format: "%.1f", pt) }

    private var mergeMenu: some View {
        Menu { mergeItems } label: {
            Image(systemName: "square.split.2x1").font(.system(size: 14, weight: .medium)).foregroundStyle(NX.foreground)
                .frame(width: 34, height: 32)
        }
        .accessibilityLabel(T("Merge cells"))
    }

    @ViewBuilder private var mergeItems: some View {
        Button(T("Merge all")) { Task { await store.merge("all") } }.disabled(!store.canMerge)
        Button(T("Merge vertically")) { Task { await store.merge("vertical") } }.disabled(!store.canMerge || store.selection.current.rowCount < 2)
        Button(T("Merge horizontally")) { Task { await store.merge("horizontal") } }.disabled(!store.canMerge || store.selection.current.colCount < 2)
        Button(T("Unmerge")) { Task { await store.merge("unmerge") } }.disabled(store.mergedHere.isEmpty)
    }

    private var verticalMenu: some View {
        let va = store.activeStyle["va"] as? String ?? "b"
        return Menu {
            Button { store.setVerticalAlign("t") } label: { checkLabel(T("Top"), va == "t") }
            Button { store.setVerticalAlign("m") } label: { checkLabel(T("Middle"), va == "m") }
            Button { store.setVerticalAlign("b") } label: { checkLabel(T("Bottom"), va == "b") }
        } label: {
            Image(systemName: "arrow.up.and.down.text.horizontal").font(.system(size: 14, weight: .medium)).foregroundStyle(NX.foreground)
                .frame(width: 34, height: 32)
        }
        .accessibilityLabel(T("Vertical align"))
    }

    private var wrapMenu: some View {
        let mode = SheetGridStyle.wrapMode(store.activeStyle)
        return Menu {
            Button { store.setWrapMode("o") } label: { checkLabel(T("Overflow"), mode == "o") }
            Button { store.setWrapMode("w") } label: { checkLabel(T("Wrap"), mode == "w") }
            Button { store.setWrapMode("c") } label: { checkLabel(T("Clip"), mode == "c") }
        } label: {
            Image(systemName: "text.word.spacing").font(.system(size: 14, weight: .medium))
                .foregroundStyle(mode == "o" ? NX.foreground : NX.violetText)
                .frame(width: 34, height: 32)
        }
        .accessibilityLabel(T("Text wrapping"))
    }

    private var viewMenu: some View {
        barMenu(T("View"), icon: "eye") { viewItems }
    }

    /// View: Freeze (rows / columns, up to the active one), gridlines, hidden rows / columns.
    @ViewBuilder private var viewItems: some View {
        Menu(T("Freeze")) {
            Button { Task { await store.freezeRows(0) } } label: { checkLabel(T("No rows"), store.frozenRowsSetting == 0) }
            Button { Task { await store.freezeRows(1) } } label: { checkLabel(T("1 row"), store.frozenRowsSetting == 1) }
            Button { Task { await store.freezeRows(2) } } label: { checkLabel(T("2 rows"), store.frozenRowsSetting == 2) }
            Button { let n = store.activeRowNumber; Task { await store.freezeRows(n) } } label: {
                checkLabel(T("Up to row %d").replacingOccurrences(of: "%d", with: "\(store.activeRowNumber)"),
                           store.frozenRowsSetting == store.activeRowNumber && store.activeRowNumber > 2)
            }
            .disabled(store.activeRowNumber > 20)
            Divider()
            Button { Task { await store.freezeCols(0) } } label: { checkLabel(T("No columns"), store.frozenColsSetting == 0) }
            Button { Task { await store.freezeCols(1) } } label: { checkLabel(T("1 column"), store.frozenColsSetting == 1) }
            Button { Task { await store.freezeCols(2) } } label: { checkLabel(T("2 columns"), store.frozenColsSetting == 2) }
            Button { let n = store.activeColNumber; Task { await store.freezeCols(n) } } label: {
                checkLabel(T("Up to column %@").replacingOccurrences(of: "%@", with: SheetA1.letters(store.activeColNumber - 1)),
                           store.frozenColsSetting == store.activeColNumber && store.activeColNumber > 2)
            }
            .disabled(store.activeColNumber > 10)
        }
        .disabled(!store.canEdit)
        Button { Task { await store.toggleGridlines() } } label: { checkLabel(T("Gridlines"), store.showGridlines) }
            .disabled(!store.canEdit)
        Divider()
        Button(T("Show hidden rows (%d)").replacingOccurrences(of: "%d", with: "\(store.hiddenRowCount)")) { Task { await store.unhideAllRows() } }
            .disabled(!store.canEdit || store.hiddenRowCount == 0)
        Button(T("Show hidden columns (%d)").replacingOccurrences(of: "%d", with: "\(store.hiddenColCount)")) { Task { await store.unhideAllColumns() } }
            .disabled(!store.canEdit || store.hiddenColCount == 0)
    }

    private var dataMenu: some View {
        barMenu(T("Data"), icon: "line.3.horizontal.decrease.circle") { dataItems }
    }

    /// Data: the filter, filter views, sorting the selected range by the active column.
    @ViewBuilder private var dataItems: some View {
        Button { Task { await store.toggleFilter() } } label: {
            Label(store.hasFilter ? T("Remove filter") : T("Create a filter"), systemImage: "line.3.horizontal.decrease")
        }
        .disabled(!store.canEdit)
        Menu(T("Filter views")) {
            Button { store.openFilterView(nil) } label: { checkLabel(T("None"), store.activeFilterView == nil) }
            ForEach(store.filterViews.indices, id: \.self) { i in
                let v = store.filterViews[i]
                Button { store.openFilterView(v.id) } label: { checkLabel(v.name ?? T("Filter view"), store.activeFilterView == v.id) }
            }
            Divider()
            Button { Task { await store.createFilterView() } } label: { Label(T("Create new filter view"), systemImage: "plus") }
                .disabled(!store.canEdit)
        }
        Button { addSlicer() } label: { Label(T("Add a slicer"), systemImage: "slider.horizontal.below.rectangle") }
            .disabled(!store.canEdit)
        Divider()
        let col = SheetA1.letters(store.activeColNumber - 1)
        Button { let c = store.selection.active.c; Task { await store.sortRange(byColumn: c, ascending: true) } } label: {
            Label(T("Sort range by column %@ (A to Z)").replacingOccurrences(of: "%@", with: col), systemImage: "arrow.up")
        }
        .disabled(!store.canEdit || store.selection.current.rowCount < 2)
        Button { let c = store.selection.active.c; Task { await store.sortRange(byColumn: c, ascending: false) } } label: {
            Label(T("Sort range by column %@ (Z to A)").replacingOccurrences(of: "%@", with: col), systemImage: "arrow.down")
        }
        .disabled(!store.canEdit || store.selection.current.rowCount < 2)
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
        Button { Task { await store.hideSelectedRows() } } label: { Label(T("Hide rows"), systemImage: "eye.slash") }
        Button { Task { await store.hideSelectedColumns() } } label: { Label(T("Hide columns"), systemImage: "eye.slash") }
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
                Menu {
                    Button { formatting = true } label: { Label(T("Format…"), systemImage: "textformat") }
                    Menu { viewItems } label: { Label(T("View"), systemImage: "eye") }
                    Menu { dataItems } label: { Label(T("Data"), systemImage: "line.3.horizontal.decrease.circle") }
                    Menu { mergeItems } label: { Label(T("Merge cells"), systemImage: "square.split.2x1") }
                    Divider()
                    rowColumnItems
                    Divider()
                    SheetPanelMenuItems(store: store) { openPanel($0) }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.system(size: 16)).foregroundStyle(NX.mutedFg).frame(width: 36, height: 36)
                }
                .accessibilityLabel(T("More"))
            } else if !store.canEdit {
                // Viewers (any width; the format bar is for editors): comments, history and charts.
                Menu { SheetPanelMenuItems(store: store) { openPanel($0) } } label: {
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

    // MARK: filter menu

    @ViewBuilder private var filterSheet: some View {
        if let c = filterColumn, let data = store.filterMenuData(column: c) {
            SheetFilterMenu(data: data, canEdit: store.canEdit,
                            onSort: { asc in Task { await store.sortFilter(column: c, ascending: asc) } },
                            onApply: { crit in Task { await store.setFilterCriteria(column: data.columnId, crit) } })
        }
    }

    /// A slicer's value list: the filter menu over its column; OK saves the slicer's criteria.
    @ViewBuilder private var slicerSheet: some View {
        if let id = slicerMenu, let data = store.slicerMenuData(id) {
            SheetFilterMenu(data: data, canEdit: store.canEdit,
                            onSort: { asc in Task { await store.sortSlicer(id, ascending: asc) } },
                            onApply: { crit in Task { await store.setSlicerCriteria(id, crit) } })
        }
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
        // Comments are for viewers too.
        items.append(UIAction(title: T("Comment"), image: UIImage(systemName: "text.bubble")) { _ in
            if let r = store.rowId(p.r), let c = store.columnId(p.c) { openPanel(.cellComments(rowId: r, columnId: c)) }
        })
        if store.canEdit {
            items.insert(UIAction(title: T("Cut"), image: UIImage(systemName: "scissors")) { _ in copy(cut: true) }, at: 0)
            items.append(UIAction(title: T("Paste"), image: UIImage(systemName: "doc.on.clipboard")) { _ in paste() })
            items.append(UIAction(title: T("Clear"), image: UIImage(systemName: "eraser"), attributes: .destructive) { _ in store.clearSelection() })
            let rowN = store.activeRowNumber, colN = store.activeColNumber
            let freezeRow = UIAction(title: T("Freeze up to row %d").replacingOccurrences(of: "%d", with: "\(rowN)"),
                                     attributes: rowN > 20 ? .disabled : []) { _ in Task { await store.freezeRows(rowN) } }
            let freezeCol = UIAction(title: T("Freeze up to column %@").replacingOccurrences(of: "%@", with: SheetA1.letters(colN - 1)),
                                     attributes: colN > 10 ? .disabled : []) { _ in Task { await store.freezeCols(colN) } }
            let rows = UIMenu(title: T("Rows"), image: UIImage(systemName: "arrow.up.and.down"), children: [
                UIAction(title: T("Insert row above")) { _ in Task { await store.insertRows(above: true) } },
                UIAction(title: T("Insert row below")) { _ in Task { await store.insertRows(above: false) } },
                UIAction(title: T("Hide rows"), image: UIImage(systemName: "eye.slash")) { _ in Task { await store.hideSelectedRows() } },
                freezeRow,
                UIAction(title: T("Delete rows"), attributes: .destructive) { _ in Task { await store.deleteSelectedRows() } },
            ])
            let cols = UIMenu(title: T("Columns"), image: UIImage(systemName: "arrow.left.and.right"), children: [
                UIAction(title: T("Insert column left")) { _ in Task { await store.insertColumns(left: true) } },
                UIAction(title: T("Insert column right")) { _ in Task { await store.insertColumns(left: false) } },
                UIAction(title: T("Rename column…")) { _ in nameText = store.columnName(p.c); renameColumn = p.c },
                UIAction(title: T("Hide columns"), image: UIImage(systemName: "eye.slash")) { _ in Task { await store.hideSelectedColumns() } },
                freezeCol,
                UIAction(title: T("Delete columns"), attributes: .destructive) { _ in Task { await store.deleteSelectedColumns() } },
            ])
            items.append(rows)
            items.append(cols)
            let canMerge = store.canMerge, merged = !store.mergedHere.isEmpty
            if canMerge || merged {
                items.append(UIMenu(title: T("Merge cells"), image: UIImage(systemName: "square.split.2x1"), children: [
                    UIAction(title: T("Merge all"), attributes: canMerge ? [] : .disabled) { _ in Task { await store.merge("all") } },
                    UIAction(title: T("Unmerge"), attributes: merged ? [] : .disabled) { _ in Task { await store.merge("unmerge") } },
                ]))
            }
            if store.selection.current.rowCount > 1 {
                let c = store.selection.active.c
                items.append(UIMenu(title: T("Sort range"), image: UIImage(systemName: "arrow.up.arrow.down"), children: [
                    UIAction(title: T("A to Z")) { _ in Task { await store.sortRange(byColumn: c, ascending: true) } },
                    UIAction(title: T("Z to A")) { _ in Task { await store.sortRange(byColumn: c, ascending: false) } },
                ]))
            }
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
