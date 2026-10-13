import SwiftUI

// Slicers on screen (web SheetSlicerPanel.tsx): the chip drawn on the grid (SlicerChip) and the "Slicer"
// editor (SlicerPanel: Data = range + column, Customise = title + background colour), plus Delete, which the
// web has no button for yet. The chip's value list is the filter menu (SheetFilterMenu).

/// The floating chip ("Status ▾"): filter icon, title (else the column's header), "N of M" while it hides
/// values, a caret. Dark pill by default, the slicer's own colour with readable text when it has one.
struct SheetSlicerChip: View {
    let title: String
    let label: String
    let bg: String?
    let active: Bool
    let shown: Int?
    let total: Int?

    var body: some View {
        let name = title.isEmpty ? label : title
        let fill: Color = bg.map { SPColors.color($0) } ?? NX.foreground
        let ink: Color = bg.map { SPColors.color(SheetGridStyle.readableText($0)) } ?? NX.background
        HStack(spacing: 8) {
            Image(systemName: active ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                .font(.system(size: 13, weight: .semibold))
            Text(name.isEmpty ? T("Select a column first") : name)
                .font(NXFont.text(12, .medium))
                .lineLimit(1)
                .opacity(name.isEmpty ? 0.7 : 1)
                .frame(maxWidth: .infinity, alignment: .leading)
            if active, let shown, let total {
                Text(String(format: T("%d of %d"), shown, total))
                    .font(NXFont.text(10))
                    .opacity(0.8)
                    .lineLimit(1)
            }
            if !name.isEmpty {
                Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold))
            }
        }
        .foregroundStyle(ink)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(fill)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(name.isEmpty ? T("Slicer") : String(format: T("Slicer: %@"), name))
    }
}

/// Opens the editor of a slicer that may have been deleted meanwhile.
struct SheetSlicerEditorHost: View {
    let ctx: SheetPanelContext
    let slicerId: String

    var body: some View {
        if let sl = ctx.store.slicer(slicerId) {
            SheetSlicerEditor(ctx: ctx, initial: sl)
        } else {
            NavigationStack {
                EmptyState(icon: "line.3.horizontal.decrease.circle", title: T("This slicer was deleted"),
                           subtitle: T("Someone removed it from the sheet."))
            }
            .spPanelPresentation()
        }
    }
}

/// Data ▸ Slicer: its range and column (Data) and its title and colour (Customise). Done saves only what was
/// changed here onto the slicer as it is then (a value picked or a move meanwhile is kept).
struct SheetSlicerEditor: View {
    let ctx: SheetPanelContext
    private let initial: SheetSlicerSpec
    @State private var draft: SheetSlicerSpec
    @State private var tab = 0
    @State private var rangeText = ""
    @State private var rangeInvalid = false
    @State private var deleting = false
    @Environment(\.dismiss) private var dismiss

    init(ctx: SheetPanelContext, initial: SheetSlicerSpec) {
        self.ctx = ctx
        self.initial = initial
        _draft = State(initialValue: initial)
    }

    private var store: SheetStore { ctx.store }
    private var shape: SheetShape { store.panelShape }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("", selection: $tab) {
                    Text(T("Data")).tag(0)
                    Text(T("Customise")).tag(1)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 12).padding(.vertical, 8)
                Form {
                    if tab == 0 { dataTab } else { customiseTab }
                    if store.canEdit {
                        Section {
                            Button(role: .destructive) { deleting = true } label: { Label(T("Delete slicer"), systemImage: "trash") }
                        }
                    }
                }
                .disabled(!store.canEdit)
            }
            .background(NX.background)
            .navigationTitle(T("Slicer"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(T("Done")) { Task { await save() } }.disabled(!store.canEdit)
                }
            }
            .onAppear { rangeText = SheetValidation.rangeToA1(draft.range, shape) }
            .background { Color.clear.alert(T("Delete this slicer?"), isPresented: $deleting) {
                Button(T("Delete"), role: .destructive) { Task { await delete() } }
                Button(T("Cancel"), role: .cancel) {}
            } message: { Text(T("Rows it hides show again. The data stays in the sheet.")) } }
        }
        .spPanelPresentation()
    }

    private var columns: [(colId: String, label: String)] { store.slicerColumns(range: draft.range) }

    @ViewBuilder private var dataTab: some View {
        Section(T("Data range")) {
            TextField("A1:E8", text: $rangeText)
                .font(.system(size: 14, design: .monospaced)).textInputAutocapitalization(.characters).autocorrectionDisabled()
                .onSubmit(applyRange)
            if rangeInvalid {
                Text(T("Enter a valid range, e.g. Sheet1!A1:B10")).font(NXFont.text(12)).foregroundStyle(NX.danger)
            }
            Button(T("Use the selected range")) { rangeText = store.panelSelectionA1; applyRange() }
        }
        Section {
            Picker(T("Column"), selection: $draft.colId) {
                if !columns.contains(where: { $0.colId == draft.colId }) {
                    Text(T("Select a column")).tag(draft.colId)
                }
                ForEach(columns.indices, id: \.self) { i in
                    Text(columns[i].label).tag(columns[i].colId)
                }
            }
        } footer: {
            Text(T("The slicer filters this column of the range for everyone. Tap it on the sheet to pick values."))
        }
    }

    @ViewBuilder private var customiseTab: some View {
        Section(T("Title")) {
            let placeholder = columns.first(where: { $0.colId == draft.colId })?.label ?? ""
            TextField(placeholder, text: Binding(get: { draft.title ?? "" }, set: { draft.title = $0.isEmpty ? nil : $0 }))
        }
        Section {
            HStack {
                Text(T("Background colour"))
                Spacer()
                SPColorButton(label: T("Background colour"), value: draft.bg) { draft.bg = $0 }
            }
        }
    }

    private func applyRange() {
        let text = SheetJS.trim(rangeText)
        if text.isEmpty || text == SheetValidation.rangeToA1(draft.range, shape) { rangeInvalid = false; return }
        if let r = SheetValidation.rangeFromA1(text, shape) {
            draft.range = r
            rangeInvalid = false
        } else {
            rangeInvalid = true
        }
    }

    private func save() async {
        applyRange()
        if rangeInvalid { tab = 0; return }
        let edited = draft
        let start = initial
        await store.updateSlicer(initial.id, label: T("slicer")) { current in
            current = SheetSlicerSpec.mergeEdits(edited, initial: start, into: current)
        }
        dismiss()
    }

    private func delete() async {
        await store.deleteSlicer(initial.id)
        dismiss()
    }
}
