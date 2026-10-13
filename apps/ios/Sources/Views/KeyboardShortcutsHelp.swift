import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Every keyboard shortcut of the app on one sheet (iPad keyboard, Mac), like the web's "?" / ⌘/ dialog
// (ShortcutsHelp.tsx + lib/keyboard.ts APP_SHORTCUTS, QA 13 Oct 2026). Opened by ⌘/ from the sidebar
// root (AdaptiveRoot) and from Settings › Appearance.
//
// Lists only what this app actually binds — keep it in step with the `.keyboardShortcut` /
// `UIKeyCommand` handlers it names: AdaptiveRoot (⌘1…⌘7, ⌘K, ⌘\, ⌘/), GideonPanel (⌘O), SearchView,
// ProjectBoardView (⌘N, ⌘[ ⌘], ⌘F, ⌘,), BoardRedesign (⌘Z, quick add ⌘↩ / Esc), TaskBatchDuplicate
// (⌘A, ⌘D), BlockEditorView / TaskDetailView (⌘K link), DocsView (⌘E, ⌘↩), CalendarView, MessagesView,
// VaultMediaViewer and Sheets/SheetGrid.swift keyCommands.
// ─────────────────────────────────────────────────────────────────────────────

/// One line of the sheet: what it does, and one or more key combos (each combo is drawn as key caps).
struct ShortcutHelpRow: Identifiable {
    let label: String
    /// Each entry is one combo, its key caps separated by spaces: "⌘ ⇧ Z".
    let keys: [String]
    var id: String { label + keys.joined(separator: "|") }
}

struct ShortcutHelpSection: Identifiable {
    let title: String
    var whereText: String? = nil
    let rows: [ShortcutHelpRow]
    var id: String { title }
}

@MainActor
enum AppShortcutList {
    /// Built on each call so labels follow the app's language (T reads the current one).
    static func sections() -> [ShortcutHelpSection] {
        var anywhere: [ShortcutHelpRow] = [
            ShortcutHelpRow(label: T("Search NEXUS"), keys: ["⌘ K"]),
            ShortcutHelpRow(label: T("Show or hide the sidebar"), keys: ["⌘ \\"]),
        ]
        for (i, screen) in SidebarRoot.shortcutScreens.enumerated() {
            anywhere.append(ShortcutHelpRow(label: String(format: T("Go to %@"), screen.title), keys: ["⌘ \(i + 1)"]))
        }
        anywhere.append(ShortcutHelpRow(label: T("New GIDEON chat"), keys: ["⌘ O"]))
        anywhere.append(ShortcutHelpRow(label: T("Keyboard shortcuts"), keys: ["⌘ /"]))
        anywhere.append(ShortcutHelpRow(label: T("Close the dialog or menu"), keys: ["Esc"]))

        return [
            ShortcutHelpSection(title: T("Anywhere"), rows: anywhere),
            ShortcutHelpSection(title: T("Search"), rows: [
                ShortcutHelpRow(label: T("Move through results"), keys: ["↑", "↓"]),
                ShortcutHelpRow(label: T("Open the result"), keys: ["↩"]),
                ShortcutHelpRow(label: T("Back to the search box"), keys: ["⌘ F"]),
            ]),
            ShortcutHelpSection(title: T("Project"), rows: [
                ShortcutHelpRow(label: T("New task"), keys: ["⌘ N"]),
                ShortcutHelpRow(label: T("Previous / next tab"), keys: ["⌘ [", "⌘ ]"]),
                ShortcutHelpRow(label: T("Search the project"), keys: ["⌘ F"]),
                ShortcutHelpRow(label: T("Project settings"), keys: ["⌘ ,"]),
            ]),
            ShortcutHelpSection(title: T("Tasks"), whereText: T("Board, list, table"), rows: [
                ShortcutHelpRow(label: T("Undo the last task move"), keys: ["⌘ Z"]),
                ShortcutHelpRow(label: T("Quick add: save and open the task"), keys: ["⌘ ↩"]),
                ShortcutHelpRow(label: T("Quick add: close"), keys: ["Esc"]),
                ShortcutHelpRow(label: T("Duplicating: pick every task on screen"), keys: ["⌘ A"]),
                ShortcutHelpRow(label: T("Duplicating: duplicate the picked tasks"), keys: ["⌘ D"]),
            ]),
            ShortcutHelpSection(title: T("Text editor"), whereText: T("Pages, task descriptions, comments"), rows: [
                ShortcutHelpRow(label: T("Add a link"), keys: ["⌘ K"]),
                ShortcutHelpRow(label: T("Edit the page"), keys: ["⌘ E"]),
                ShortcutHelpRow(label: T("Done editing"), keys: ["⌘ ↩"]),
            ]),
            ShortcutHelpSection(title: T("Calendar"), rows: [
                ShortcutHelpRow(label: T("Today"), keys: ["⌘ T"]),
                ShortcutHelpRow(label: T("Previous / next month (week in People)"), keys: ["⌘ ←", "⌘ →"]),
                ShortcutHelpRow(label: T("Previous / next day"), keys: ["⌥ ←", "⌥ →"]),
                ShortcutHelpRow(label: T("By division / by person"), keys: ["⌥⌘ 1", "⌥⌘ 2"]),
                ShortcutHelpRow(label: T("Filters"), keys: ["⌘ F"]),
                ShortcutHelpRow(label: T("Reload"), keys: ["⌘ R"]),
            ]),
            ShortcutHelpSection(title: T("Chat"), whereText: T("Messages, GIDEON, comments"), rows: [
                ShortcutHelpRow(label: T("Send"), keys: ["↩"]),
                ShortcutHelpRow(label: T("New line"), keys: ["⇧ ↩"]),
                ShortcutHelpRow(label: T("New chat"), keys: ["⌘ N"]),
            ]),
            ShortcutHelpSection(title: T("Photos and videos"), whereText: T("Z Vault viewer"), rows: [
                ShortcutHelpRow(label: T("Previous / next file"), keys: ["←", "→"]),
                ShortcutHelpRow(label: T("Close"), keys: ["Esc"]),
            ]),
            ShortcutHelpSection(title: T("Spreadsheet"), rows: [
                ShortcutHelpRow(label: T("Move between cells"), keys: ["↑ ↓ ← →"]),
                ShortcutHelpRow(label: T("Extend the selection"), keys: ["⇧ ↑ ↓ ← →"]),
                ShortcutHelpRow(label: T("Jump to the edge of the data"), keys: ["⌘ ↑ ↓ ← →"]),
                ShortcutHelpRow(label: T("Next / previous cell"), keys: ["Tab", "⇧ Tab"]),
                ShortcutHelpRow(label: T("Cell below / above"), keys: ["↩", "⇧ ↩"]),
                ShortcutHelpRow(label: T("Edit the cell"), keys: ["F2"]),
                ShortcutHelpRow(label: T("Clear the cells"), keys: ["⌫"]),
                ShortcutHelpRow(label: T("Keep only the active cell selected"), keys: ["Esc"]),
                ShortcutHelpRow(label: T("Copy"), keys: ["⌘ C"]),
                ShortcutHelpRow(label: T("Cut"), keys: ["⌘ X"]),
                ShortcutHelpRow(label: T("Paste"), keys: ["⌘ V"]),
                ShortcutHelpRow(label: T("Undo / redo"), keys: ["⌘ Z", "⌘ ⇧ Z"]),
                ShortcutHelpRow(label: T("Select all"), keys: ["⌘ A"]),
                ShortcutHelpRow(label: T("Bold"), keys: ["⌘ B"]),
                ShortcutHelpRow(label: T("Italic"), keys: ["⌘ I"]),
            ]),
        ]
    }
}

/// The sheet itself. Presented with its environment passed explicitly (a sheet on Mac Catalyst does not
/// always inherit it); it reads none today, but a row that someday opens a screen will.
struct KeyboardShortcutsHelp: View {
    @Environment(\.dismiss) private var dismiss

    private let columns = [GridItem(.adaptive(minimum: 300, maximum: 520), spacing: 16, alignment: .top)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 16) {
                        ForEach(AppShortcutList.sections()) { section in
                            ShortcutHelpSectionCard(section: section)
                        }
                    }
                    Text(T("Shortcuts never fire while you type in a field; there the editor's own keys win."))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(16)
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(T("Keyboard shortcuts"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(T("Close")) { dismiss() }.keyboardShortcut(.cancelAction)
                }
            }
            // ⌘/ again closes it, as on the web.
            .background {
                Button("") { dismiss() }
                    .keyboardShortcut("/", modifiers: .command)
                    .opacity(0).accessibilityHidden(true)
            }
        }
    }
}

private struct ShortcutHelpSectionCard: View {
    let section: ShortcutHelpSection

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                SectionLabel(section.title)
                if let w = section.whereText {
                    Text("· " + w).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
            }
            VStack(spacing: 0) {
                ForEach(Array(section.rows.enumerated()), id: \.element.id) { idx, row in
                    if idx > 0 { Divider().overlay(NX.border.opacity(0.6)) }
                    ShortcutHelpRowView(row: row)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard(padding: 14, radius: 18)
    }
}

private struct ShortcutHelpRowView: View {
    let row: ShortcutHelpRow

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Text(row.label).font(NXFont.text(13)).foregroundStyle(NX.foreground)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            HStack(spacing: 4) {
                ForEach(Array(row.keys.enumerated()), id: \.offset) { idx, combo in
                    if idx > 0 { Text("/").font(NXFont.text(11)).foregroundStyle(NX.mutedFg) }
                    KeyCapCombo(combo: combo)
                }
            }
            .fixedSize()
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

private struct KeyCapCombo: View {
    let combo: String

    private var parts: [String] { combo.split(separator: " ").map(String.init) }

    var body: some View {
        HStack(spacing: 2) {
            ForEach(Array(parts.enumerated()), id: \.offset) { _, part in
                Text(part)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(NX.foreground)
                    .frame(minWidth: 22)
                    .padding(.horizontal, 5).padding(.vertical, 2)
                    .background(NX.muted, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(NX.border))
            }
        }
    }
}

/// Settings › Appearance (iPad, Mac): the way to the sheet for anyone who doesn't know ⌘/. Owns its own
/// sheet, so SettingsView keeps its one `.sheet`.
struct KeyboardShortcutsCard: View {
    // Only the store SettingsView itself reads: Settings is also shown where no router is in scope.
    @Environment(AuthStore.self) private var auth
    @State private var open = false

    var body: some View {
        Button { open = true } label: {
            HStack(spacing: 12) {
                Image(systemName: "keyboard").font(.system(size: 17, weight: .semibold)).foregroundStyle(NX.violetText)
                    .frame(width: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(T("Keyboard shortcuts")).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
                    Text(T("Every shortcut of the app. Press ⌘/ anywhere to see them."))
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .nexusCard()
        .sheet(isPresented: $open) { KeyboardShortcutsHelp().environment(auth) }
    }
}
