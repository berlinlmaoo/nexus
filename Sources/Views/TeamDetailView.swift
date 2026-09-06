import SwiftUI

/// Manage one team: who is in it, and which projects it opens up.
///
/// The screen the cards on Teams never had — tapping one did nothing at all, so members and project
/// access could only be changed from the web.
struct TeamDetailView: View {
    @Environment(AuthStore.self) private var auth

    /// Kept as state rather than read from the parent: every action here re-fetches, and the list
    /// behind us must not be the thing deciding what this screen shows.
    @State private var team: Team
    private let onChanged: () -> Void

    @State private var roster: [WorkspaceRoster.Member] = []
    @State private var allProjects: [Project] = []
    /// Keys currently in flight, so one row can be busy without freezing the rest of the screen.
    @State private var busy: Set<String> = []
    @State private var error: String?
    @State private var showAddMember = false
    @State private var showLinkProject = false

    init(team: Team, onChanged: @escaping () -> Void = {}) {
        _team = State(initialValue: team)
        self.onChanged = onChanged
    }

    private var canManage: Bool { team.canManage ?? false }
    private var color: Color { Color(hex: team.color ?? "#7b68ee") }
    private var members: [Team.Member] { team.members ?? [] }
    private var links: [Team.ProjectLink] { team.projects ?? [] }

    /// Everyone in the workspace who is not already on this team.
    private var addableMembers: [WorkspaceRoster.Member] {
        let taken = Set(members.compactMap { $0.uid })
        return roster.filter { member in
            guard let id = member.userId ?? member.id else { return false }
            return !taken.contains(id)
        }
    }

    private var linkableProjects: [Project] {
        let taken = Set(links.compactMap { $0.pid })
        return allProjects.filter { !taken.contains($0.id) }
    }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    if let error {
                        Text(error)
                            .font(NXFont.text(12))
                            .foregroundStyle(NX.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    membersSection
                    projectsSection
                }
                .padding(16)
            }
            .refreshable { await reload() }
        }
        .navigationTitle(team.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadSupporting() }
        .sheet(isPresented: $showAddMember) {
            PickerSheet(title: T("Add member"),
                        rows: addableMembers.map { PickerRow(id: ($0.userId ?? $0.id ?? ""),
                                                             title: $0.name ?? $0.email ?? "Unknown",
                                                             subtitle: $0.email) },
                        empty: T("Everyone in the workspace is already on this team.")) { id in
                await act("add-\(id)") { try await APIClient.shared.teamAddMember(teamId: team.id, userId: id) }
            }
        }
        .sheet(isPresented: $showLinkProject) {
            PickerSheet(title: T("Link project"),
                        rows: linkableProjects.map { PickerRow(id: $0.id, title: $0.name, subtitle: $0.status) },
                        empty: T("Every project is already linked.")) { id in
                await act("link-\(id)") { try await APIClient.shared.teamLinkProject(teamId: team.id, projectId: id) }
            }
        }
    }

    // MARK: - sections

    private var header: some View {
        HStack(spacing: 12) {
            Text(team.initial)
                .font(NXFont.display(18, .black)).foregroundStyle(.white)
                .frame(width: 48, height: 48)
                .background(color, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(team.name).font(NXFont.display(18, .bold)).foregroundStyle(NX.foreground)
                Text("\(members.count) \(T("members")) · \(links.count) \(T("projects"))")
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            Spacer()
        }
    }

    private var membersSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader(T("Members"), action: canManage ? { showAddMember = true } : nil)
            if members.isEmpty {
                emptyRow(T("Nobody on this team yet."))
            } else {
                VStack(spacing: 0) {
                    ForEach(members, id: \.idv) { member in
                        memberRow(member)
                        if member.idv != members.last?.idv { Divider().overlay(NX.border) }
                    }
                }
                .nexusCard(padding: 0)
            }
        }
    }

    private func memberRow(_ member: Team.Member) -> some View {
        let key = "member-\(member.idv)"
        return HStack(spacing: 12) {
            Text(member.initial)
                .font(NXFont.display(13, .bold)).foregroundStyle(NX.violetText)
                .frame(width: 34, height: 34)
                .background(NX.accentBg, in: Circle())
            VStack(alignment: .leading, spacing: 1) {
                Text(member.displayName).font(NXFont.text(14)).foregroundStyle(NX.foreground).lineLimit(1)
                if let email = member.user?.email {
                    Text(email).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if member.isLead { NexusChip(text: T("Lead"), tone: .accent) }
            if canManage, let uid = member.uid {
                Menu {
                    Button(member.isLead ? T("Make member") : T("Make lead")) {
                        Task { await act(key) {
                            try await APIClient.shared.teamSetMemberRole(teamId: team.id, userId: uid, lead: !member.isLead)
                        } }
                    }
                    Button(T("Remove from team"), role: .destructive) {
                        Task { await act(key) {
                            try await APIClient.shared.teamRemoveMember(teamId: team.id, userId: uid)
                        } }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle").foregroundStyle(NX.mutedFg)
                }
                .disabled(busy.contains(key))
                .opacity(busy.contains(key) ? 0.4 : 1)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private var projectsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader(T("Projects"), action: canManage ? { showLinkProject = true } : nil)
            Text(T("Team members automatically get access to the linked projects."))
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            if links.isEmpty {
                emptyRow(T("No projects linked yet."))
            } else {
                VStack(spacing: 0) {
                    ForEach(links, id: \.idv) { link in
                        projectRow(link)
                        if link.idv != links.last?.idv { Divider().overlay(NX.border) }
                    }
                }
                .nexusCard(padding: 0)
            }
        }
    }

    private func projectRow(_ link: Team.ProjectLink) -> some View {
        let key = "project-\(link.idv)"
        return HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(Color(hex: link.project?.color ?? "#7b68ee"))
                .frame(width: 10, height: 10)
            Text(link.displayName).font(NXFont.text(14)).foregroundStyle(NX.foreground).lineLimit(1)
            Spacer(minLength: 8)
            if canManage, let pid = link.pid {
                Button {
                    Task { await act(key) {
                        try await APIClient.shared.teamUnlinkProject(teamId: team.id, projectId: pid)
                    } }
                } label: {
                    Image(systemName: "minus.circle").foregroundStyle(NX.danger)
                }
                .buttonStyle(.plain)
                .disabled(busy.contains(key))
                .opacity(busy.contains(key) ? 0.4 : 1)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private func sectionHeader(_ title: String, action: (() -> Void)?) -> some View {
        HStack {
            Text(title).font(NXFont.display(14, .bold)).foregroundStyle(NX.foreground)
            Spacer()
            if let action {
                Button(action: action) {
                    Image(systemName: "plus.circle.fill").foregroundStyle(NX.violetText)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func emptyRow(_ text: String) -> some View {
        Text(text)
            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .nexusCard(padding: 0)
    }

    // MARK: - work

    /// One wrapper for every mutation: guard against a double tap, run it, re-read the team from the
    /// server, and tell the list behind us. Re-reading rather than patching local state means the
    /// screen can never disagree with what the server actually accepted.
    private func act(_ key: String, _ work: @escaping () async throws -> Void) async {
        guard !busy.contains(key) else { return }
        busy.insert(key)
        defer { busy.remove(key) }
        error = nil
        do {
            try await work()
            await reload()
            onChanged()
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? T("Failed.")
        }
    }

    private func reload() async {
        guard let fresh = try? await APIClient.shared.teams().first(where: { $0.id == team.id }) else { return }
        team = fresh
    }

    private func loadSupporting() async {
        if let roster = try? await APIClient.shared.roster() { self.roster = roster.members ?? [] }
        if let projects = try? await APIClient.shared.projects() { self.allProjects = projects }
    }
}

// MARK: - picker

private struct PickerRow: Identifiable {
    let id: String
    let title: String
    let subtitle: String?
}

/// One sheet for both "add member" and "link project". They differ only in their rows.
private struct PickerSheet: View {
    let title: String
    let rows: [PickerRow]
    let empty: String
    let pick: (String) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var filtered: [PickerRow] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return rows }
        return rows.filter {
            $0.title.lowercased().contains(q) || ($0.subtitle?.lowercased().contains(q) ?? false)
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                if rows.isEmpty {
                    Text(empty)
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                        .multilineTextAlignment(.center).padding(32)
                } else {
                    List(filtered) { row in
                        Button {
                            // Closed first, on purpose: the work continues on the parent, and a sheet
                            // that lingers behind a spinner invites a second tap on a row that has
                            // already been submitted.
                            dismiss()
                            Task { await pick(row.id) }
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.title).font(NXFont.text(14)).foregroundStyle(NX.foreground)
                                if let subtitle = row.subtitle, !subtitle.isEmpty {
                                    Text(subtitle).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                                }
                            }
                        }
                        .listRowBackground(NX.card)
                    }
                    .scrollContentBackground(.hidden)
                    .searchable(text: $query)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(T("Cancel")) { dismiss() }
                }
            }
        }
    }
}
