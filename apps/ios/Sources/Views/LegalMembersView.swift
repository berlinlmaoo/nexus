import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Who has Legal (owner, 14 Oct 2026; web LegalMembers): the owner always; BoD members he invites may
// invite staff; invited staff may not invite. Removing someone keeps their row (and who invited them) for
// the record, behind "Show removed people".
// ─────────────────────────────────────────────────────────────────────────────

struct LegalMembersPane: View {
    let gutter: CGFloat

    @State private var members: [LegalMember]?
    @State private var power: LegalInvitePower = .none
    @State private var error: String?
    @State private var showFormer = false
    @State private var inviting = false
    @State private var revoking: LegalMember?

    private var active: [LegalMember] { (members ?? []).filter(\.active) }
    private var former: [LegalMember] { (members ?? []).filter { !$0.active } }

    private var explanation: String {
        switch power {
        case .any: return T("Legal is by invitation only. You can invite anyone of the company.")
        case .staff: return T("Legal is by invitation only. You can invite staff and remove the people you invited.")
        case .none: return T("Legal is by invitation only. Ask the owner or a BoD member to invite someone.")
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                LegalSectionHeader(title: T("People with Legal access"), subtitle: explanation) {
                    if power.canInvite {
                        Button { inviting = true } label: { Label(T("Invite"), systemImage: "person.badge.plus") }
                            .buttonStyle(.nxPrimary)
                    }
                }
                if members == nil && error == nil {
                    LegalLoadingRow()
                } else if let error, members == nil {
                    Text(error).font(NXFont.text(13)).foregroundStyle(NX.danger)
                } else {
                    LegalListCard {
                        ForEach(Array(active.enumerated()), id: \.element.id) { i, m in
                            if i > 0 { Divider().overlay(NX.border) }
                            LegalMemberRow(member: m) { revoking = m }
                        }
                    }
                }
                if !former.isEmpty {
                    Button { withAnimation(.easeOut(duration: 0.15)) { showFormer.toggle() } } label: {
                        Text(showFormer ? T("Hide removed people") : String(format: T("Show removed people (%d)"), former.count))
                            .font(NXFont.text(13, .medium)).foregroundStyle(NX.mutedFg)
                    }
                    .buttonStyle(.plain)
                    if showFormer {
                        LegalListCard {
                            ForEach(Array(former.enumerated()), id: \.element.id) { i, m in
                                if i > 0 { Divider().overlay(NX.border) }
                                LegalMemberRow(member: m, onRevoke: nil)
                            }
                        }
                        .opacity(0.8)
                    }
                }
            }
            .padding(.horizontal, gutter)
            .padding(.vertical, 16)
        }
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $inviting, onDismiss: { Task { await load() } }) { LegalInviteSheet() }
        .alert(String(format: T("Remove %@ from Legal?"), revoking?.name ?? ""),
               isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } })) {
            Button(T("Cancel"), role: .cancel) { revoking = nil }
            Button(T("Remove"), role: .destructive) {
                if let m = revoking {
                    revoking = nil
                    Task { await revoke(m) }
                }
            }
        } message: {
            Text(T("They lose access to every legal document and template right away. You can invite them again later."))
        }
    }

    private func load() async {
        do {
            let r = try await APIClient.shared.legalMembers()
            members = r.members
            power = r.invitePower
            error = nil
        } catch {
            if members == nil { self.error = error.legalMessage } else { LegalToasts.shared.failure(error) }
        }
    }

    private func revoke(_ m: LegalMember) async {
        do {
            try await APIClient.shared.legalRevoke(userId: m.userId)
            LegalToasts.shared.success(T("Legal access removed"))
            await load()
        } catch {
            LegalToasts.shared.failure(error)
        }
    }
}

private struct LegalMemberRow: View {
    let member: LegalMember
    let onRevoke: (() -> Void)?

    private var m: LegalMember { member }

    private var line: String {
        if m.isRoot { return T("Always has Legal") }
        if m.revokedAt != nil {
            return String(format: T("Removed by %@ on %@"), m.revokedBy?.name ?? "—", LegalLabels.date(m.revokedAt))
        }
        if m.active { return String(format: T("Invited by %@ on %@"), m.invitedBy?.name ?? "—", LegalLabels.date(m.invitedAt)) }
        return T("No longer in the company")
    }

    var body: some View {
        HStack(spacing: 12) {
            AvatarView(url: m.avatar, initial: String((m.name.isEmpty ? m.email : m.name).first ?? "?").uppercased(), size: 34)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(m.name.isEmpty ? m.email : m.name).font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground).lineLimit(1)
                    if m.isRoot { NexusChip(text: T("Owner"), tone: .accent) }
                    if let role = LegalLabels.role(m.orgRole) {
                        Text(role).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                    if !m.isRoot && m.active && m.invitePower == .staff { NexusChip(text: T("Can invite staff"), tone: .info) }
                }
                Text(line).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            Spacer(minLength: 4)
            if let onRevoke, m.canRevoke {
                Button(action: onRevoke) { Label(T("Remove"), systemImage: "person.badge.minus") }
                    .buttonStyle(NXButtonStyle(kind: .ghost, compact: true))
                    .accessibilityLabel(String(format: T("Remove %@ from Legal?"), m.name))
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
    }
}

private struct LegalInviteSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var q = ""
    @State private var candidates: [LegalCandidate]?
    @State private var error: String?
    @State private var inviting: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if let error {
                        Text(error).font(NXFont.text(13)).foregroundStyle(NX.danger)
                    } else if candidates == nil {
                        LegalLoadingRow()
                    } else if let candidates, candidates.isEmpty {
                        Text(T("Nobody to invite")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                    } else if let candidates {
                        ForEach(candidates) { c in row(c) }
                    }
                } footer: {
                    Text(T("They will see the Legal menu and every legal document and template."))
                }
            }
            .searchable(text: $q, placement: .navigationBarDrawer(displayMode: .always), prompt: T("Search people…"))
            .task(id: q) { await load() }
            .navigationTitle(T("Invite to Legal"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { dismiss() } } }
        }
        .legalToasts()
    }

    private func row(_ c: LegalCandidate) -> some View {
        HStack(spacing: 12) {
            AvatarView(url: c.avatar, initial: String((c.name.isEmpty ? c.email : c.name).first ?? "?").uppercased(), size: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(c.name.isEmpty ? c.email : c.name).font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground).lineLimit(1)
                Text([LegalLabels.role(c.orgRole), c.email].compactMap { $0 }.joined(separator: " · "))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            Spacer(minLength: 4)
            Button { Task { await invite(c) } } label: {
                if inviting == c.userId { ProgressView() } else { Text(T("Invite")) }
            }
            .buttonStyle(NXButtonStyle(kind: .bordered, compact: true))
            .disabled(inviting != nil)
        }
    }

    private func load() async {
        if !q.isEmpty { try? await Task.sleep(nanoseconds: 250_000_000) }
        guard !Task.isCancelled else { return }
        do {
            candidates = try await APIClient.shared.legalInviteCandidates(q: q.trimmingCharacters(in: .whitespacesAndNewlines))
            error = nil
        } catch {
            if !Task.isCancelled { self.error = error.legalMessage }
        }
    }

    private func invite(_ c: LegalCandidate) async {
        inviting = c.userId
        defer { inviting = nil }
        do {
            try await APIClient.shared.legalInvite(userId: c.userId)
            LegalToasts.shared.success(T("Invited to Legal"))
            candidates?.removeAll { $0.userId == c.userId }
        } catch {
            LegalToasts.shared.failure(error)
        }
    }
}
