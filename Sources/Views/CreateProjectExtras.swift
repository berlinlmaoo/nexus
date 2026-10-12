import SwiftUI

// MARK: - New project: starting tabs and members (owner, 11 Oct 2026)
//
// Both go up with POST /api/projects: `hiddenTabs` (Task Project only, the same keys as Project
// settings → Tabs) and `memberIds` (any type; the server drops the creator and duplicates).

/// The tabs a new Task Project starts with, as cards with a small drawing of each view (owner, 11 Oct
/// 2026, like the web). All on by default except Automations (owner, 11 Oct 2026); Board or List
/// always stays on (the server answers 400 TASK_VIEW_REQUIRED otherwise). Holds the HIDDEN keys, as the server stores them.
struct NewProjectTabsPicker: View {
    @Binding var hiddenTabs: Set<String>

    /// Two columns on iPhone, three on iPad and Mac.
    private var columns: [GridItem] {
        let count = UIDevice.current.userInterfaceIdiom == .phone ? 2 : 3
        return Array(repeating: GridItem(.flexible(), spacing: 10, alignment: .top), count: count)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(T("Turn off the tabs this project doesn't need. You can change them later in Project settings → Tabs."))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                .fixedSize(horizontal: false, vertical: true)
            LazyVGrid(columns: columns, alignment: .leading, spacing: 10) {
                ForEach(ProjectTab.hideable) { card($0) }
            }
        }
    }

    private func card(_ tab: ProjectTab) -> some View {
        let key = tab.key ?? ""
        let on = !hiddenTabs.contains(key)
        let shownTaskViews = ProjectTab.taskViews.filter { !hiddenTabs.contains($0.key ?? "") }
        let lastTaskView = on && shownTaskViews == [tab]
        return Button {
            if on { hiddenTabs.insert(key) } else { hiddenTabs.remove(key) }
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                TabThumbnail(tab: tab)
                    .padding(8)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(NX.muted, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .saturation(on ? 1 : 0)
                HStack(spacing: 6) {
                    Text(tab.label).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Spacer(minLength: 4)
                    Image(systemName: on ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 17))
                        .foregroundStyle(on ? NX.violet : NX.mutedFg)
                }
                Text(lastTaskView ? T("Board or List stays on") : tab.blurb)
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    .lineLimit(2, reservesSpace: true)
                    .multilineTextAlignment(.leading)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(on ? NX.violet.opacity(0.5) : NX.border, lineWidth: on ? 1.5 : 1))
            .opacity(on ? 1 : 0.6)
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(lastTaskView)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

extension ProjectTab {
    /// One line under the tab's card in New project.
    var blurb: String {
        switch self {
        case .overview:    return T("Progress, members and what's due")
        case .board:       return T("Cards in columns by status")
        case .list:        return T("Tasks as a simple checklist")
        case .table:       return T("Every task in a grid, fields as columns")
        case .sheet:       return T("A spreadsheet with formulas")
        case .calendar:    return T("Tasks on a month by due date")
        case .timeline:    return T("Start-to-end bars, Gantt style")
        case .automations: return T("When this happens, do that")
        case .pages:       return T("Docs and notes for the project")
        case .forms:       return T("Collect requests as tasks")
        case .chat:        return T("The project's group chat")
        case .pipeline, .reportForm: return ""
        }
    }
}

/// A small drawing of what a tab looks like, from plain shapes. Neutral parts are the text colour at
/// 15%, the highlighted part is the accent at 70%.
struct TabThumbnail: View {
    let tab: ProjectTab

    private var ink: Color { NX.foreground.opacity(0.15) }
    private var accent: Color { NX.violet.opacity(0.7) }
    /// Header rows, first columns and filled days: a step darker than `ink`.
    private var shade: Color { NX.foreground.opacity(0.3) }
    private var faint: Color { NX.foreground.opacity(0.08) }

    private func bar(_ color: Color, height: CGFloat = 4) -> some View {
        RoundedRectangle(cornerRadius: height / 2, style: .continuous).fill(color).frame(height: height)
    }

    var body: some View {
        switch tab {
        case .overview: overview
        case .board: board
        case .list: list
        case .sheet, .table: sheet
        case .calendar: calendar
        case .timeline: timeline
        case .automations: automations
        case .pages: pages
        case .forms: forms
        case .chat: chat
        case .pipeline, .reportForm: Color.clear
        }
    }

    /// Three stat boxes beside a five-bar chart, the fourth bar accent.
    private var overview: some View {
        HStack(alignment: .bottom, spacing: 6) {
            VStack(spacing: 3) {
                ForEach(0..<3, id: \.self) { _ in RoundedRectangle(cornerRadius: 2).fill(ink) }
            }
            .frame(width: 18)
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(Array([0.45, 0.7, 0.55, 1.0, 0.8].enumerated()), id: \.offset) { i, h in
                    RoundedRectangle(cornerRadius: 1.5).fill(i == 3 ? accent : ink)
                        .frame(maxHeight: .infinity, alignment: .bottom)
                        .scaleEffect(x: 1, y: h, anchor: .bottom)
                }
            }
        }
    }

    /// Three columns holding 3, 2 and 1 cards; one card outlined in accent.
    private var board: some View {
        HStack(alignment: .top, spacing: 4) {
            ForEach(Array([3, 2, 1].enumerated()), id: \.offset) { col, n in
                VStack(spacing: 3) {
                    ForEach(0..<n, id: \.self) { row in
                        RoundedRectangle(cornerRadius: 2).fill(ink).frame(height: 9)
                            .overlay(RoundedRectangle(cornerRadius: 2)
                                .strokeBorder(col == 1 && row == 0 ? accent : .clear, lineWidth: 1.2))
                    }
                    Spacer(minLength: 0)
                }
                .padding(2)
                .background(faint, in: RoundedRectangle(cornerRadius: 3))
            }
        }
    }

    /// Four rows of dot + line; the first two dots accent.
    private var list: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(0..<4, id: \.self) { i in
                HStack(spacing: 5) {
                    Circle().fill(i < 2 ? accent : ink).frame(width: 6, height: 6)
                    bar(ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.trailing, CGFloat([0, 14, 6, 20][i]))
                }
                .frame(maxHeight: .infinity)
            }
        }
    }

    /// A dense 6×5 grid, header row and first column shaded, one accent-selected cell.
    private var sheet: some View {
        grid(rows: 5, columns: 6, gap: 1.5) { r, c in
            if r == 2 && c == 3 { return accent }
            return (r == 0 || c == 0) ? shade : faint
        }
    }

    /// Seven days by four weeks, a few filled, two of them accent.
    private var calendar: some View {
        grid(rows: 4, columns: 7, gap: 2) { r, c in
            switch (r, c) {
            case (1, 2), (3, 5): return accent
            case (0, 4), (2, 1), (2, 6): return shade
            default: return faint
            }
        }
    }

    /// Four staggered bars, the second accent.
    private var timeline: some View {
        GeometryReader { geo in
            let w = geo.size.width
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array([(0.0, 0.45), (0.25, 0.45), (0.45, 0.35), (0.6, 0.4)].enumerated()), id: \.offset) { i, span in
                    bar(i == 1 ? accent : ink, height: 6)
                        .frame(width: w * span.1)
                        .padding(.leading, w * span.0)
                        .frame(maxHeight: .infinity)
                }
            }
        }
    }

    /// Box — diamond (accent) — box, joined by lines.
    private var automations: some View {
        HStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 3).fill(ink).frame(width: 18, height: 14)
            Rectangle().fill(ink).frame(height: 1.5)
            Rectangle().fill(accent).frame(width: 12, height: 12).rotationEffect(.degrees(45))
                .padding(.horizontal, 2)
            Rectangle().fill(ink).frame(height: 1.5)
            RoundedRectangle(cornerRadius: 3).fill(ink).frame(width: 18, height: 14)
        }
    }

    /// A page with a heading line and three lines of text.
    private var pages: some View {
        VStack(alignment: .leading, spacing: 4) {
            bar(NX.foreground.opacity(0.3), height: 5).frame(width: 30)
            bar(ink, height: 3)
            bar(ink, height: 3)
            bar(ink, height: 3).frame(width: 24)
            Spacer(minLength: 0)
        }
        .padding(5)
        .frame(width: 52)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 3))
        .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(ink))
    }

    /// Two label + input pairs and an accent pill button.
    private var forms: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(0..<2, id: \.self) { _ in
                bar(NX.foreground.opacity(0.3), height: 2.5).frame(width: 18)
                RoundedRectangle(cornerRadius: 2).strokeBorder(NX.foreground.opacity(0.25)).frame(height: 8)
            }
            Capsule().fill(accent).frame(width: 26, height: 6).padding(.top, 1)
        }
    }

    /// Three bubbles, the middle one on the right in accent.
    private var chat: some View {
        VStack(spacing: 3) {
            Capsule().fill(ink).frame(width: 46, height: 9).frame(maxWidth: .infinity, alignment: .leading)
            Capsule().fill(accent).frame(width: 40, height: 9).frame(maxWidth: .infinity, alignment: .trailing)
            Capsule().fill(ink).frame(width: 34, height: 9).frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func grid(rows: Int, columns: Int, gap: CGFloat, fill: @escaping (Int, Int) -> Color) -> some View {
        VStack(spacing: gap) {
            ForEach(0..<rows, id: \.self) { r in
                HStack(spacing: gap) {
                    ForEach(0..<columns, id: \.self) { c in
                        RoundedRectangle(cornerRadius: 1).fill(fill(r, c))
                    }
                }
            }
        }
    }
}

/// Workspace people to add to the new project: search by name or email, tap rows to pick, the
/// picked ones shown as chips above. Holds user ids.
struct NewProjectMembersPicker: View {
    @Binding var picked: Set<String>
    /// The creator: the server adds them anyway, so they are not offered.
    let selfUserId: String?

    @State private var roster: [WorkspaceRoster.Member] = []
    @State private var loading = true
    @State private var search = ""

    /// How many rows show before anything is typed; the search finds the rest.
    private let browseLimit = 6

    private var candidates: [WorkspaceRoster.Member] {
        roster
            .filter { m in
                guard let uid = m.userId, !uid.isEmpty else { return false }
                return uid != selfUserId
            }
            .sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
    }

    private var results: [WorkspaceRoster.Member] {
        let q = search.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return Array(candidates.prefix(browseLimit)) }
        return candidates.filter {
            $0.displayName.localizedCaseInsensitiveContains(q) || ($0.emailText ?? "").localizedCaseInsensitiveContains(q)
        }
    }

    private var pickedMembers: [WorkspaceRoster.Member] {
        candidates.filter { picked.contains($0.userId ?? "") }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !pickedMembers.isEmpty { chips }
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(NX.mutedFg)
                TextField(T("Search by name or email"), text: $search)
                    .font(NXFont.text(15))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if !search.isEmpty {
                    Button { search = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg) }
                        .buttonStyle(.plain)
                        .accessibilityLabel(T("Clear search"))
                }
            }
            .padding(12)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))

            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 8)
            } else if results.isEmpty {
                Text(candidates.isEmpty ? T("No one else is in this workspace yet.") : T("No one matches that search"))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(results.enumerated()), id: \.element.idv) { idx, m in
                        if idx > 0 { Divider().overlay(NX.border) }
                        row(m)
                    }
                }
                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
                if search.trimmingCharacters(in: .whitespaces).isEmpty && candidates.count > browseLimit {
                    Text(String(format: T("%d more — search to find them."), candidates.count - browseLimit))
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
            }
        }
        .task {
            if let r = try? await APIClient.shared.roster() { roster = r.members ?? [] }
            loading = false
        }
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(pickedMembers, id: \.idv) { m in
                    Button { picked.remove(m.userId ?? "") } label: {
                        HStack(spacing: 6) {
                            AvatarView(url: m.avatarURL, initial: m.initial, size: 20)
                            Text(m.displayName).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                            Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundStyle(NX.mutedFg)
                        }
                        .padding(.leading, 4).padding(.trailing, 10).padding(.vertical, 4)
                        .background(NX.violet.opacity(0.12), in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(String(format: T("Remove %@"), m.displayName))
                }
            }
        }
    }

    private func row(_ m: WorkspaceRoster.Member) -> some View {
        let uid = m.userId ?? ""
        let on = picked.contains(uid)
        return Button {
            if on { picked.remove(uid) } else { picked.insert(uid) }
        } label: {
            HStack(spacing: 10) {
                AvatarView(url: m.avatarURL, initial: m.initial, size: 30)
                VStack(alignment: .leading, spacing: 2) {
                    Text(m.displayName).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    if let email = m.emailText, !email.isEmpty, email != m.displayName {
                        Text(email).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                }
                Spacer(minLength: 6)
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(on ? NX.violet : NX.border)
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// "Add 1 person" / "Add N people" — the one button of every add-people picker.
func addPeopleTitle(_ count: Int) -> String {
    switch count {
    case 0: return T("Add")
    case 1: return T("Add 1 person")
    default: return String(format: T("Add %d people"), count)
    }
}
