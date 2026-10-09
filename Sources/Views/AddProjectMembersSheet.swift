import SwiftUI

/// Project settings → Project members → "Add members" (owner, 9 Oct 2026: "kenapa drop down gini
/// doang? gaada search bar dan gabisa select multiple org"). A searchable multi-select over the
/// workspace people who are not in the project yet — the same for task projects and the Pipeline
/// Dashboard. Everyone picked goes up in one request (`{ userIds }`); the server still writes one audit
/// entry and sends one "added to project" notification per person. Mirrors the web picker.
struct AddProjectMembersSheet: View {
    let projectId: String
    let roster: [WorkspaceRoster.Member]
    /// User ids already in the project: never offered again.
    let memberIds: Set<String>
    /// Called with the rows the server added, before the sheet closes.
    let onAdded: ([ProjectDetail.ProjectMember]) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var picked: Set<String> = []
    @State private var search = ""
    @State private var adding = false
    @State private var error: String?

    /// Workspace people with an account who aren't in the project yet, A→Z.
    private var candidates: [WorkspaceRoster.Member] {
        roster
            .filter { m in
                guard let uid = m.userId, !uid.isEmpty else { return false }
                return !memberIds.contains(uid)
            }
            .sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
    }

    private var results: [WorkspaceRoster.Member] {
        let q = search.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return candidates }
        return candidates.filter {
            $0.displayName.localizedCaseInsensitiveContains(q) || ($0.emailText ?? "").localizedCaseInsensitiveContains(q)
        }
    }

    private var addTitle: String {
        picked.isEmpty ? T("Add") : String(format: T("Add (%d)"), picked.count)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                if candidates.isEmpty {
                    EmptyState(icon: "person.2.fill", title: T("Everyone is already in this project."),
                               subtitle: T("To bring in someone from outside the workspace, use Invite by email."))
                        .padding(24)
                } else {
                    pickerList
                }
            }
            .navigationTitle(T("Add members"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if adding {
                        ProgressView()
                    } else {
                        Button(addTitle) { Task { await add() } }
                            .fontWeight(.bold)
                            .disabled(picked.isEmpty)
                    }
                }
            }
            .interactiveDismissDisabled(adding)
        }
    }

    private var pickerList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
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
                .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))

                HStack {
                    Text(picked.isEmpty ? T("Pick one or more people") : String(format: T("%d selected"), picked.count))
                        .font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                    Spacer()
                    if !picked.isEmpty {
                        Button(T("Clear")) { picked.removeAll() }
                            .font(NXFont.text(12, .bold)).foregroundStyle(NX.violetText)
                            .buttonStyle(.plain)
                    }
                }

                if let error {
                    Text(error).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                }

                if results.isEmpty {
                    EmptyState(icon: "magnifyingglass", title: T("No one matches that search"),
                               subtitle: T("Try part of their name or their email."), compact: true)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 24)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(results.enumerated()), id: \.element.idv) { idx, m in
                            if idx > 0 { Divider().overlay(NX.border) }
                            row(m)
                        }
                    }
                    .background {
                        RoundedRectangle(cornerRadius: 18, style: .continuous).fill(NX.card)
                            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
                    }
                }
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func row(_ m: WorkspaceRoster.Member) -> some View {
        let uid = m.userId ?? ""
        let on = picked.contains(uid)
        let display = m.displayName
        return Button {
            if on { picked.remove(uid) } else { picked.insert(uid) }
            error = nil
        } label: {
            HStack(spacing: 10) {
                AvatarView(url: m.avatarURL, initial: m.initial, size: 34)
                VStack(alignment: .leading, spacing: 2) {
                    Text(display).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    if let email = m.emailText, !email.isEmpty, email != display {
                        Text(email).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                }
                Spacer(minLength: 6)
                if let role = m.role, !role.isEmpty { RoleChip(role: role) }
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(on ? NX.violet : NX.border)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func add() async {
        guard !picked.isEmpty, !adding else { return }
        adding = true
        error = nil
        do {
            let added = try await APIClient.shared.addProjectMembers(projectId: projectId, userIds: Array(picked))
            await onAdded(added)
            adding = false
            dismiss()
        } catch let failure {
            // Named, so it doesn't shadow this view's `@State var error`.
            adding = false
            error = (failure as? LocalizedError)?.errorDescription ?? T("Couldn't add them. Try again.")
        }
    }
}

/// POST /api/projects/{id}/members with `{ userIds }` answers with the rows it created; people who
/// were already in are listed apart and are not an error. Servers from 9 Oct 2026.
struct AddProjectMembersResult: Decodable, Sendable {
    let added: [ProjectDetail.ProjectMember]?
    let alreadyMembers: [String]?
}
