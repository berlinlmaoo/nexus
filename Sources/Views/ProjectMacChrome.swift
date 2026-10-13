import SwiftUI

// The project page's regular-width chrome (iPad landscape, Mac Catalyst), as on the dev web
// (routes/_app/projects/$projectId.tsx + components/projects/views/view-toolbar.tsx, owner screenshots
// 266/267, 13 Oct 2026): the members' avatar stack in the header, one tab row with the views as labelled
// tabs (the active one carries its ▾ menu), the project's modules as icon-only tabs after a divider, and the
// view tools as icons on the right next to the split "+ Add task ▾" button. The phone keeps its own row.

// MARK: - dates in the app's language

/// Month and weekday names in the app's language (English unless Bahasa Indonesia was picked), Jakarta
/// time like the rest of the project screens. Cached per pattern + language.
enum ProjLocaleDate {
    private static let lock = NSLock()
    private static var cache: [String: DateFormatter] = [:]

    static func fmt(_ pattern: String) -> DateFormatter {
        let id = AppLanguage.shared.lang == .id
        let key = (id ? "id|" : "en|") + pattern
        lock.lock(); defer { lock.unlock() }
        if let f = cache[key] { return f }
        let f = DateFormatter()
        f.locale = Locale(identifier: id ? "id_ID" : "en_US")
        f.timeZone = ProjDate.cal.timeZone
        f.dateFormat = pattern
        cache[key] = f
        return f
    }
}

// MARK: - header

/// The project's members as overlapping avatars with "+N" (web ProjectMembersAvatars: four faces).
struct ProjectMemberStack: View {
    let members: [ProjectDetail.ProjectMember]
    var maxShown = 4
    let action: () -> Void

    private var people: [ProjectDetail.ProjectMember] { members.filter { !$0.uid.isEmpty } }

    var body: some View {
        if !people.isEmpty {
            Button(action: action) {
                HStack(spacing: -8) {
                    ForEach(Array(people.prefix(maxShown)), id: \.uid) { m in
                        AvatarView(url: m.user?.avatar, initial: m.initial, size: 28)
                            .overlay(Circle().strokeBorder(NX.card, lineWidth: 2))
                    }
                    if people.count > maxShown {
                        Text("+\(people.count - maxShown)")
                            .font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg).monospacedDigit()
                            .frame(width: 28, height: 28)
                            .background(NX.muted, in: Circle())
                            .overlay(Circle().strokeBorder(NX.card, lineWidth: 2))
                    }
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .help(people.map(\.displayName).joined(separator: ", "))
            .accessibilityLabel(String(format: T("%d members"), people.count))
        }
    }
}

// MARK: - tab row

/// A labelled view tab (Board, List, a saved view…). The tab on screen gets a soft fill and, when it is a
/// saved view, a ▾ that opens the view's menu (web ViewTabsBar).
struct ProjectViewTab<MenuItems: View>: View {
    let title: String
    let icon: String
    let on: Bool
    var filtered = false
    var hasMenu = false
    let action: () -> Void
    @ViewBuilder var menu: () -> MenuItems

    var body: some View {
        HStack(spacing: 0) {
            Button(action: action) {
                HStack(spacing: 7) {
                    Image(systemName: icon).font(.system(size: 13, weight: .regular))
                    Text(title).font(NXFont.text(15, on ? .semibold : .regular)).lineLimit(1)
                    if filtered { Circle().fill(NX.violet).frame(width: 5, height: 5) }
                }
                .padding(.leading, 10).padding(.trailing, on && hasMenu ? 4 : 10)
                .frame(height: 34)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if on && hasMenu {
                Menu { menu() } label: {
                    Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold))
                        .frame(width: 24, height: 34).contentShape(Rectangle())
                }
                .menuStyle(.button)
            .buttonStyle(.plain)
                .menuIndicator(.hidden)
                .fixedSize()
                .accessibilityLabel(String(format: T("Options for %@"), title))
            }
        }
        .foregroundStyle(on ? NX.foreground : NX.mutedFg)
        .background(on ? NX.muted : Color.clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .frame(minHeight: 44)
        .hoverEffect(.highlight)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// A module tab drawn as an icon only (Spreadsheet, Pages, Forms, Chat); its name is the tooltip.
struct ProjectIconTab: View {
    let title: String
    let icon: String
    let on: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 15, weight: .regular))
                .foregroundStyle(on ? NX.foreground : NX.mutedFg)
                .frame(width: 36, height: 34)
                .background(on ? NX.muted : Color.clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .help(title)
        .accessibilityLabel(title)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// One icon in the tools at the right of the tab row (filter, sort, group, automations, GIDEON…).
struct ProjectToolIcon: View {
    let icon: String
    let label: String
    var active = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 15, weight: .regular))
                .foregroundStyle(active ? NX.violetText : NX.mutedFg)
                .frame(width: 34, height: 34)
                .background(active ? NX.accentBg : Color.clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .help(label)
        .accessibilityLabel(label)
    }
}

/// The web's ToolbarSearch: a magnifier that opens into a small field; empty and unfocused, it closes again.
struct ProjectToolbarSearch: View {
    @Binding var query: String
    @Binding var open: Bool
    var focused: FocusState<Bool>.Binding
    /// "3/84" while a search is typed (the answer, not a failure: an empty board then reads right).
    var count: String? = nil

    var body: some View {
        if open || !query.isEmpty {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(NX.mutedFg)
                TextField(T("Search tasks…"), text: $query)
                    .focused(focused)
                    .font(NXFont.text(14))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                if let count, !query.isEmpty {
                    Text(count).font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg).monospacedDigit().fixedSize()
                }
                if !query.isEmpty {
                    Button { query = ""; open = false } label: {
                        Image(systemName: "xmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(NX.mutedFg)
                            .frame(width: 24, height: 24).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(T("Clear search"))
                }
            }
            .padding(.horizontal, 9)
            .frame(width: 230, height: 32)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(focused.wrappedValue ? NX.violet.opacity(0.6) : NX.border))
            .onAppear { if open { focused.wrappedValue = true } }
            .onChange(of: focused.wrappedValue) { _, isFocused in
                if !isFocused && query.isEmpty { open = false }
            }
        } else {
            ProjectToolIcon(icon: "magnifyingglass", label: T("Search")) { open = true }
        }
    }
}

/// "+ Add task ▾" (web AddTaskSplit): the main part adds to the project's first to-do section, the arrow
/// picks the section.
struct AddTaskSplitButton: View {
    let sections: [ProjectDetail.Lane]
    var enabled = true
    let onAdd: (String?) -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button { onAdd(nil) } label: {
                HStack(spacing: 6) {
                    Image(systemName: "plus").font(.system(size: 13, weight: .semibold))
                    Text(T("Add task")).font(NXFont.text(14, .medium)).lineLimit(1)
                }
                .padding(.leading, 12).padding(.trailing, 10)
                .frame(height: 34)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Rectangle().fill(NX.background.opacity(0.25)).frame(width: 1, height: 34)
            Menu {
                Section(T("Add a task to")) {
                    ForEach(sections) { s in
                        Button { onAdd(s.id) } label: { Label(s.name, systemImage: "plus") }
                    }
                }
            } label: {
                Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold))
                    .frame(width: 30, height: 34).contentShape(Rectangle())
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
            .accessibilityLabel(T("More ways to add"))
        }
        .foregroundStyle(NX.background)
        .background(NX.onyx, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .opacity(enabled ? 1 : 0.45)
        .disabled(!enabled)
        .frame(minHeight: 44)
        .hoverEffect(.lift)
    }
}

/// The hairline between the views and the module icons.
struct ProjectTabDivider: View {
    var body: some View {
        Rectangle().fill(NX.border).frame(width: 1, height: 20).padding(.horizontal, 6)
    }
}

/// The outline icons the web's tab row uses (lucide), as SF Symbols.
extension ProjectTab {
    var macIcon: String {
        switch self {
        case .overview: return "waveform.path.ecg"
        case .board:    return "rectangle.split.3x1"
        case .list:     return "list.bullet"
        case .table:    return "tablecells"
        case .sheet:    return "squareshape.split.3x3"
        case .calendar: return "calendar"
        case .timeline: return "text.alignleft"
        case .automations: return "bolt"
        case .pages:    return "doc.text"
        case .forms:    return "rectangle.and.pencil.and.ellipsis"
        case .chat:     return "bubble.left"
        default:        return icon
        }
    }
}
