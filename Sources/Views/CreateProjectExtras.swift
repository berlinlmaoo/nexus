import SwiftUI

// MARK: - New project: starting tabs and members (owner, 11 Oct 2026)
//
// Both go up with POST /api/projects: `hiddenTabs` (Task Project only, the same keys as Project
// settings → Tabs) and `memberIds` (any type; the server drops the creator and duplicates).

/// The tabs a new Task Project starts with. All on by default; Board or List always stays on (the
/// server answers 400 TASK_VIEW_REQUIRED otherwise). Holds the HIDDEN keys, as the server stores them.
struct NewProjectTabsPicker: View {
    @Binding var hiddenTabs: Set<String>

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(T("Turn off the tabs this project doesn't need. You can change them later in Project settings → Tabs."))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                .fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 0) {
                ForEach(ProjectTab.hideable) { tab in
                    if tab != ProjectTab.hideable.first { Divider().overlay(NX.border) }
                    row(tab)
                }
            }
            .padding(.horizontal, 12)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
        }
    }

    private func row(_ tab: ProjectTab) -> some View {
        let key = tab.key ?? ""
        let shown = !hiddenTabs.contains(key)
        let shownTaskViews = ProjectTab.taskViews.filter { !hiddenTabs.contains($0.key ?? "") }
        let lastTaskView = shown && shownTaskViews == [tab]
        return Toggle(isOn: Binding(
            get: { !hiddenTabs.contains(key) },
            set: { on in if on { hiddenTabs.remove(key) } else { hiddenTabs.insert(key) } }
        )) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 8) {
                    Image(systemName: tab.icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.violetText).frame(width: 18)
                    Text(tab.label).font(NXFont.text(14, .semibold)).foregroundStyle(shown ? NX.foreground : NX.mutedFg)
                }
                if lastTaskView {
                    Text(T("Board or List stays on")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
            }
        }
        .tint(NX.violetText)
        .disabled(lastTaskView)
        .padding(.vertical, 8)
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
