import SwiftUI

/// Start a direct message or a group from the Messages list.
///
/// The server already does the hard part: `POST /api/conversations` takes `{ type, userIds, name }`
/// and de-dupes DMs, so picking someone you already have a 1:1 with reopens that thread instead of
/// creating a second one. Picking two or more people flips this sheet into group mode.
struct NewConversationSheet: View {
    let onCreated: (Conversation) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth
    @State private var roster: [WorkspaceRoster.Member] = []
    @State private var picked: Set<String> = []
    @State private var groupName = ""
    @State private var search = ""
    @State private var loading = true
    @State private var creating = false
    @State private var error: String?

    private var isGroup: Bool { picked.count > 1 }

    /// Anyone we could actually open a conversation with: needs a userId, and isn't us.
    private var candidates: [WorkspaceRoster.Member] {
        roster.filter { m in
            guard let uid = m.userId, !uid.isEmpty else { return false }
            return uid != auth.session?.userId
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
                    EmptyState(icon: "person.2", title: T("Nobody to chat with yet"),
                               subtitle: T("Workspace members show up here once they've joined."))
                } else {
                    pickerList
                }
            }
            .navigationTitle(isGroup ? T("New group") : T("New chat"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(T("Create")) { Task { await create() } }
                        .disabled(picked.isEmpty || creating)
                }
            }
            .task { await load() }
        }
    }

    private var pickerList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                TextField(T("Search people"), text: $search)
                    .font(NXFont.text(15)).padding(12)
                    .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))

                // Only groups carry a name; a DM's title is always the other person.
                if isGroup {
                    TextField(T("Group name (optional)"), text: $groupName)
                        .font(NXFont.text(15)).padding(12)
                        .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }

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
                AvatarView(url: m.avatar, initial: String(display.first ?? "?").uppercased(), size: 34)
                VStack(alignment: .leading, spacing: 2) {
                    Text(display).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    if let email = m.email, !email.isEmpty, email != display {
                        Text(email).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 19))
                    .foregroundStyle(on ? NX.violet : NX.border)
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func load() async {
        if let r = try? await APIClient.shared.roster() { roster = r.members ?? [] }
        loading = false
    }

    private func create() async {
        creating = true
        error = nil
        defer { creating = false }
        let ids = Array(picked)
        let name = groupName.trimmingCharacters(in: .whitespaces)
        do {
            let convo = try await APIClient.shared.createConversation(
                type: ids.count > 1 ? "GROUP" : "DM",
                userIds: ids,
                name: name.isEmpty ? nil : name
            )
            onCreated(convo)
            dismiss()
        } catch let failure {
            // Bind the thrown value under another name: an unnamed `catch` introduces a constant
            // called `error`, which shadows this view's `@State var error` and makes the assignment
            // target the immutable one.
            error = (failure as? LocalizedError)?.errorDescription ?? T("Couldn't start that chat. Try again.")
        }
    }
}
