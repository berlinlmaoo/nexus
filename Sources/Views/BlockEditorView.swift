import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// The block editor's screen part (model: BlockEditing.swift). One row per block, in a plain VStack (no lazy
// stack, no custom geometry). Return in a line starts the next block of the same kind (a heading continues
// as text), Delete on an empty line removes it (hardware keyboard), every row has a menu: Turn into, Move up /
// down, Delete. The keyboard bar has the block type, the to-do tick and GIDEON's writing actions.
// ─────────────────────────────────────────────────────────────────────────────

struct BlockEditorView: View {
    @Bindable var model: BlockEditorModel
    var fontSize: CGFloat = 15
    /// GIDEON's writing actions (web Ask AI) on the focused block or the whole page.
    var onAI: ((GideonWriteRequest) -> Void)? = nil
    @FocusState private var focused: UUID?
    /// The line ⌘K (or the keyboard bar's link button) adds a link to.
    @State private var linkTarget: LinkTarget?
    @State private var linkRefused = false
    private struct LinkTarget: Identifiable { let id: UUID }
    /// This editor's name for EditorKeys (who owns ⌘K while it has the keyboard).
    @State private var keysOwner = "blocks-" + UUID().uuidString

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(model.rows) { row in
                BlockEditorRowView(
                    row: binding(row.id),
                    number: number(of: row.id),
                    fontSize: fontSize,
                    focused: $focused,
                    onSplit: { before, after in split(row.id, before: before, after: after) },
                    onBackspaceEmpty: { removeEmpty(row.id) },
                    menu: { rowMenu(row) }
                )
            }
            Button { addBlock() } label: {
                Label(T("Add a block"), systemImage: "plus")
                    .font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                    .frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!model.canEdit)
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) { keyboardBar }
        }
        // ⌘K adds a link to the line being typed in (web QA 13 Oct 2026, S-07: it opened the app's search
        // over the editor). Bound only while a line has the keyboard, so it is never the app's ⌘K.
        .background {
            if let id = focused, model.canEdit {
                Button("") { openLink(id) }
                    .keyboardShortcut("k", modifiers: .command)
                    .opacity(0).accessibilityHidden(true)
            }
        }
        .onChange(of: focused) { _, now in
            if now != nil { EditorKeys.shared.claim(keysOwner) } else { EditorKeys.shared.release(keysOwner) }
        }
        .onDisappear { EditorKeys.shared.release(keysOwner) }
        // Every change is copied to the device shortly after it is made (BlockEditMirror), so a closed or
        // killed app never loses it.
        .onChange(of: model.rows) { _, _ in model.noteEdit() }
        .sheet(item: $linkTarget) { target in
            LinkInsertSheet(existing: model.links(target.id),
                            onInsert: { text, href in
                                if !model.addLink(target.id, text: text, href: href) { linkRefused = true }
                                focused = target.id
                            },
                            onEdit: { link, href in
                                model.editLink(target.id, link, href: href)
                                focused = target.id
                            })
        }
        .alert(T("Links can't go in this block"), isPresented: $linkRefused) {
            Button("OK", role: .cancel) {}
        } message: { Text(T("Put the link in a text, heading, list or toggle line.")) }
    }

    private func openLink(_ id: UUID) {
        guard let row = model.rows.first(where: { $0.id == id }) else { return }
        if row.takesLinks { linkTarget = LinkTarget(id: id) } else { linkRefused = true }
    }

    // MARK: keyboard bar

    @ViewBuilder private var keyboardBar: some View {
        if let id = focused, let row = model.rows.first(where: { $0.id == id }) {
            Menu {
                ForEach(BlockKind.editable) { k in
                    Button { model.turn(id, into: k) } label: { Label(k.label, systemImage: k.symbol) }
                }
            } label: { Label(T("Turn into"), systemImage: row.kind.symbol) }
            if row.kind == .todo {
                Button { toggleChecked(id) } label: { Image(systemName: row.checked ? "checkmark.square.fill" : "square") }
                    .accessibilityLabel(row.checked ? T("Mark not done") : T("Mark done"))
            }
            if row.takesLinks {
                Button { openLink(id) } label: { Image(systemName: "link") }
                    .accessibilityLabel(T("Add a link"))
            }
            if let onAI {
                Menu {
                    GideonWriteMenuItems(selectionText: row.text, pageText: pageText, onPick: { req in onAI(req.with(blockId: id)) })
                } label: { Image("GideonLogo").renderingMode(.template) }
                .accessibilityLabel(T("Ask AI"))
            }
            Spacer()
            Button(T("Done")) { focused = nil }.bold()
        }
    }

    private var pageText: String { model.rows.map(\.text).filter { !$0.isEmpty }.joined(separator: "\n") }

    // MARK: rows

    private func binding(_ id: UUID) -> Binding<BlockRow> {
        Binding(
            get: { model.rows.first(where: { $0.id == id }) ?? BlockRow.new(.paragraph) },
            set: { new in if let i = model.rows.firstIndex(where: { $0.id == id }) { model.rows[i] = new } }
        )
    }

    /// The number a numbered-list row shows (its place in the run of numbered rows).
    private func number(of id: UUID) -> Int {
        guard let i = model.rows.firstIndex(where: { $0.id == id }), model.rows[i].kind == .numbered else { return 0 }
        var n = 1
        var j = i - 1
        while j >= 0, model.rows[j].kind == .numbered { n += 1; j -= 1 }
        return n
    }

    private func split(_ id: UUID, before: String, after: String) {
        guard let i = model.rows.firstIndex(where: { $0.id == id }) else { return }
        model.rows[i].text = before
        let kind = model.rows[i].kind
        // An empty list item + Return leaves the list (Notion).
        if kind.isList && before.isEmpty && after.isEmpty {
            model.rows[i].kind = .paragraph
            return
        }
        let nextKind: BlockKind = [.h1, .h2, .h3, .toggle, .quote, .other].contains(kind) ? .paragraph : kind
        var row = BlockRow.new(nextKind, after)
        row.listGroup = kind.isList ? model.rows[i].listGroup : nil
        model.insert(after: id, row)
        focused = row.id
    }

    private func removeEmpty(_ id: UUID) {
        guard let i = model.rows.firstIndex(where: { $0.id == id }), model.rows[i].text.isEmpty, model.rows.count > 1 else { return }
        let previous = i > 0 ? model.rows[i - 1].id : nil
        if model.rows[i].kind != .paragraph && model.rows[i].kind != .other {
            model.rows[i].kind = .paragraph       // first Delete: back to plain text
            return
        }
        model.remove(id)
        focused = previous
    }

    private func toggleChecked(_ id: UUID) {
        if let i = model.rows.firstIndex(where: { $0.id == id }) { model.rows[i].checked.toggle() }
    }

    private func addBlock() {
        let row = BlockRow.new(.paragraph)
        model.insert(after: nil, row)
        focused = row.id
    }

    @ViewBuilder private func rowMenu(_ row: BlockRow) -> some View {
        if row.kind != .other {
            Menu(T("Turn into")) {
                ForEach(BlockKind.editable) { k in
                    Button { model.turn(row.id, into: k) } label: { Label(k.label, systemImage: k.symbol) }
                }
            }
        }
        Button { model.move(row.id, by: -1) } label: { Label(T("Move up"), systemImage: "arrow.up") }
        Button { model.move(row.id, by: 1) } label: { Label(T("Move down"), systemImage: "arrow.down") }
        Button(role: .destructive) { model.remove(row.id) } label: { Label(T("Delete"), systemImage: "trash") }
    }
}

/// One block: its marker and its text field (or, for a block the app does not edit, the reader's drawing).
struct BlockEditorRowView<MenuContent: View>: View {
    @Binding var row: BlockRow
    let number: Int
    let fontSize: CGFloat
    var focused: FocusState<UUID?>.Binding
    let onSplit: (String, String) -> Void
    let onBackspaceEmpty: () -> Void
    @ViewBuilder let menu: () -> MenuContent

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            marker
            content
            // The field shows plain text, so a line that carries a link says so (⌘K lists and edits them).
            if row.takesLinks && !BlockConvert.links(row).isEmpty {
                Image(systemName: "link").font(.system(size: fontSize - 4, weight: .semibold)).foregroundStyle(NX.violetText)
                    .accessibilityLabel(T("Has a link"))
            }
        }
        .padding(.vertical, 2)
        .contextMenu { menu() }
    }

    @ViewBuilder private var marker: some View {
        switch row.kind {
        case .bullet:
            Text("•").font(NXFont.text(fontSize)).foregroundStyle(NX.mutedFg).frame(width: 18)
        case .numbered:
            Text("\(number).").font(NXFont.text(fontSize)).foregroundStyle(NX.mutedFg).frame(minWidth: 18, alignment: .trailing)
        case .todo:
            Button { row.checked.toggle() } label: {
                Image(systemName: row.checked ? "checkmark.square.fill" : "square")
                    .font(.system(size: fontSize)).foregroundStyle(row.checked ? NX.violetText : NX.mutedFg)
                    .frame(width: 28, height: 28).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(row.checked ? T("Done") : T("Not done"))
        case .toggle:
            Image(systemName: "chevron.right").font(.system(size: fontSize - 3, weight: .semibold)).foregroundStyle(NX.mutedFg).frame(width: 18)
        case .quote:
            Rectangle().fill(NX.foreground.opacity(0.6)).frame(width: 3, height: fontSize + 6)
        default:
            EmptyView()
        }
    }

    @ViewBuilder private var content: some View {
        if row.kind == .other, let raw = row.raw, let node = Self.node(raw) {
            // Kept as it is (callout, code, table, image…): drawn by the reader, moved or deleted from the menu.
            BlockDocView(doc: node, fontSize: fontSize)
        } else {
            TextField(placeholder, text: textBinding, axis: .vertical)
                .font(font)
                .foregroundStyle(row.kind == .todo && row.checked ? NX.mutedFg : NX.foreground)
                .strikethrough(row.kind == .todo && row.checked)
                .focused(focused, equals: row.id)
                .onKeyPress(.delete) {
                    if row.text.isEmpty { onBackspaceEmpty(); return .handled }
                    return .ignored
                }
        }
    }

    /// Return arrives as a newline in a vertical field: split the block there.
    private var textBinding: Binding<String> {
        Binding(
            get: { row.text },
            set: { new in
                if let r = new.range(of: "\n"), row.kind != .quote {
                    onSplit(String(new[..<r.lowerBound]), String(new[r.upperBound...]).replacingOccurrences(of: "\n", with: " "))
                } else {
                    row.text = new
                }
            }
        )
    }

    private var placeholder: String {
        switch row.kind {
        case .h1, .h2, .h3: return row.kind.label
        case .todo: return T("To-do item")
        case .toggle: return T("Toggle")
        case .bullet, .numbered: return T("List")
        default: return T("Type something…")
        }
    }

    private var font: Font {
        switch row.kind {
        case .h1: return NXFont.display(fontSize + 9, .bold)
        case .h2: return NXFont.display(fontSize + 5, .bold)
        case .h3: return NXFont.display(fontSize + 2, .bold)
        case .toggle: return NXFont.text(fontSize, .semibold)
        default: return NXFont.text(fontSize)
        }
    }

    /// A one-block document for the reader.
    static func node(_ raw: RawJSON) -> BlockNode? {
        guard let data = try? JSONSerialization.data(withJSONObject: ["type": "doc", "content": [raw]]) else { return nil }
        return try? JSONDecoder().decode(BlockNode.self, from: data)
    }
}
