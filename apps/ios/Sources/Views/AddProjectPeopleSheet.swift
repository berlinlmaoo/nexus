import SwiftUI

/// Where the people being picked are going.
enum AddPeopleTarget {
    /// A project room. Its membership is derived from the project, so the honest operation is
    /// "add them to the project" — their seat in the room follows.
    case project(String)
    /// A plain group chat, which owns its own member list.
    case group(conversationId: String)
}

/// Add people to a PROJECT chat room.
///
/// There is no "add member to conversation" endpoint, and it turns out none is needed: the server
/// provisions a project's chat room from the project's member list (`provisionProjectRooms`, called
/// on every `GET /api/conversations`). So the honest operation here is "add them to the project" —
/// their seat in this room follows from that. The copy says so out loud, because quietly handing
/// someone access to a whole project when they thought they were being added to a chat is exactly
/// the kind of surprise that costs trust.
///
/// One consequence worth knowing: their membership materialises when *they* next open the app, so
/// the roster on this side won't change the instant you tap Add.
struct AddProjectPeopleSheet: View {
    let target: AddPeopleTarget
    /// Already in the room — hidden from the list so you can't add the same person twice.
    let existingUserIds: Set<String>
    let onAdded: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var roster: [WorkspaceRoster.Member] = []
    @State private var picked: Set<String> = []
    @State private var search = ""
    @State private var loading = true
    @State private var busy = false
    @State private var error: String?

    private var candidates: [WorkspaceRoster.Member] {
        roster.filter { m in
            guard let uid = m.userId, !uid.isEmpty else { return false }
            return !existingUserIds.contains(uid)
        }
    }

    private var results: [WorkspaceRoster.Member] {
        let q = search.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return candidates }
        return candidates.filter {
            ($0.name ?? "").localizedCaseInsensitiveContains(q) || ($0.email ?? "").localizedCaseInsensitiveContains(q)
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                if loading {
                    ProgressView().tint(NX.violetText)
                } else if candidates.isEmpty {
                    EmptyState(icon: "person.badge.plus", title: T("Everyone's already here"),
                               subtitle: isGroup ? T("Every workspace member is already in this chat.")
                                                 : T("Every workspace member is already in this project."))
                } else {
                    pickerList
                }
            }
            .navigationTitle(T("Add people"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(addPeopleTitle(picked.count)) { Task { await add() } }.disabled(picked.isEmpty || busy)
                }
            }
            .task { await load() }
        }
    }

    private var pickerList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                // Only the project case needs a warning. Quietly handing someone a whole project
                // when they thought they were joining a chat is the surprise worth naming; joining
                // a group chat is exactly what it looks like.
                if !isGroup {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "info.circle.fill").font(.system(size: 12)).foregroundStyle(NX.violetText)
                        Text(T("Anyone you add joins the project itself, not just this chat."))
                            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(NX.accentBg, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }

                TextField(T("Search people"), text: $search)
                    .font(NXFont.text(15)).padding(12)
                    .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))

                if let error {
                    Text(error).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                }

                VStack(spacing: 0) {
                    ForEach(Array(results.enumerated()), id: \.element.userId) { idx, m in
                        if idx > 0 { Divider().overlay(NX.border) }
                        row(m)
                    }
                }
                .background {
                    RoundedRectangle(cornerRadius: 18, style: .continuous).fill(NX.card)
                        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
                }
            }
            .padding(16)
        }
    }

    private func row(_ m: WorkspaceRoster.Member) -> some View {
        let uid = m.userId ?? ""
        let on = picked.contains(uid)
        let display = m.name?.isEmpty == false ? m.name! : (m.email ?? "—")
        return Button {
            if on { picked.remove(uid) } else { picked.insert(uid) }
        } label: {
            HStack(spacing: 10) {
                AvatarView(url: m.avatar, initial: String(display.first ?? "?").uppercased(), size: 34, userId: m.userId, name: m.displayName)
                VStack(alignment: .leading, spacing: 2) {
                    Text(display).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    if let email = m.email, !email.isEmpty, email != display {
                        Text(email).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 19)).foregroundStyle(on ? NX.violet : NX.border)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var isGroup: Bool {
        if case .group = target { return true }
        return false
    }

    private func load() async {
        if let r = try? await APIClient.shared.roster() { roster = r.members ?? [] }
        loading = false
    }

    private func add() async {
        busy = true
        error = nil
        defer { busy = false }
        switch target {
        case .project(let projectId):
            // One call for everyone (`{ userIds }`); people already in are skipped by the server, not
            // an error.
            do {
                _ = try await APIClient.shared.addProjectMembers(projectId: projectId, userIds: Array(picked))
                onAdded()
                dismiss()
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription
                    ?? T("Couldn't add everyone. Some people were left out.")
            }

        case .group(let conversationId):
            // One call for everyone: the conversation endpoint takes the whole list, so either the
            // room changes or it doesn't — there is no half-added state to explain.
            do {
                _ = try await APIClient.shared.addConversationMembers(conversationId, userIds: Array(picked))
                onAdded()
                dismiss()
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription
                    ?? T("Couldn't add everyone. Some people were left out.")
            }
        }
    }
}
