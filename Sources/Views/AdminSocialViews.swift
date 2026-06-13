import SwiftUI

// MARK: - Control Room (admin.tsx — Users tab, read-only roster)

/// Port of admin.tsx "Users" view: org role-count stats + member roster with role chips.
/// Role editing / shift / day-off / delete stay on desktop (sensitive RBAC) — native is read-only.
struct AdminView: View {
    @Environment(AuthStore.self) private var auth
    @State private var roster: WorkspaceRoster?
    @State private var loading = true
    @State private var error: String?
    @State private var filter: String = "ALL"

    private var members: [WorkspaceRoster.Member] { roster?.members ?? [] }
    private func count(_ role: String) -> Int { members.filter { $0.role == role }.count }
    private var rows: [WorkspaceRoster.Member] {
        filter == "ALL" ? members : members.filter { ($0.role ?? "STAFF") == filter }
    }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            if loading {
                ProgressView().tint(NX.violet).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error {
                ErrorState(message: error) { Task { await load() } }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Semua user + atur role org (One Above All › BoD › Manager › Staff).")
                            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)

                        // Stat cards (tap to filter)
                        let cols = [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())]
                        LazyVGrid(columns: cols, spacing: 10) {
                            AdminStat(label: "Total", value: members.count, active: filter == "ALL") { filter = "ALL" }
                            AdminStat(label: "One Above All", value: count("ONE_ABOVE_ALL"), active: filter == "ONE_ABOVE_ALL") { toggle("ONE_ABOVE_ALL") }
                            AdminStat(label: "BoD", value: count("BOD"), active: filter == "BOD") { toggle("BOD") }
                            AdminStat(label: "Manager", value: count("MANAGER"), active: filter == "MANAGER") { toggle("MANAGER") }
                            AdminStat(label: "Staff", value: count("STAFF"), active: filter == "STAFF") { toggle("STAFF") }
                        }

                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "shield.fill").font(.system(size: 12)).foregroundStyle(NX.mutedFg).padding(.top, 1)
                            Text("Hierarki role: One Above All › BoD › Manager › Staff. Atur role & shift lewat web (desktop).")
                                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        }
                        .padding(12)
                        .background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

                        // Roster
                        VStack(spacing: 0) {
                            ForEach(Array(rows.enumerated()), id: \.element.idv) { idx, m in
                                if idx > 0 { Divider().overlay(NX.border) }
                                AdminMemberRow(member: m)
                            }
                            if rows.isEmpty {
                                Text("Gak ada user.").font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                                    .frame(maxWidth: .infinity).padding(.vertical, 28)
                            }
                        }
                        .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
                        .nexusShadowSoft()
                    }
                    .padding(16)
                }
            }
        }
        .navigationTitle("Control Room")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func toggle(_ r: String) { filter = (filter == r) ? "ALL" : r }

    private func load() async {
        error = nil
        do { roster = try await APIClient.shared.roster() }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = "Butuh akses admin untuk lihat user management." }
        loading = false
    }
}

struct AdminStat: View {
    let label: String
    let value: Int
    let active: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 3) {
                Text("\(value)").font(NXFont.display(22, .bold)).foregroundStyle(NX.foreground)
                Text(label).font(NXFont.text(11, .medium)).foregroundStyle(NX.mutedFg).lineLimit(1).minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(active ? NX.violet : NX.border, lineWidth: active ? 1.5 : 1))
        }
        .buttonStyle(.plain)
    }
}

struct AdminMemberRow: View {
    let member: WorkspaceRoster.Member
    var body: some View {
        HStack(spacing: 12) {
            Text(member.initial)
                .font(NXFont.text(13, .bold)).foregroundStyle(NX.violet)
                .frame(width: 38, height: 38)
                .background(NX.violet.opacity(0.12), in: Circle())
                .overlay(Circle().strokeBorder(NX.border))
            VStack(alignment: .leading, spacing: 2) {
                Text(member.displayName).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                if let email = member.user?.email, !email.isEmpty {
                    Text(email).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
            }
            Spacer(minLength: 6)
            RoleChip(role: member.role ?? "STAFF")
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
    }
}

/// Org-role pill matching web ORG_ROLE_LABEL / ORG_ROLE_TONE (rose / violet / sky / muted).
struct RoleChip: View {
    let role: String
    private var label: String {
        switch role {
        case "ONE_ABOVE_ALL": return "One Above All"
        case "BOD": return "BoD"
        case "MANAGER": return "Manager"
        case "STAFF": return "Staff"
        default: return role
        }
    }
    private var color: Color {
        switch role {
        case "ONE_ABOVE_ALL": return NX.danger
        case "BOD": return NX.violet
        case "MANAGER": return NX.blue
        default: return NX.mutedFg
        }
    }
    var body: some View {
        Text(label).font(NXFont.text(11, .bold))
            .padding(.horizontal, 9).padding(.vertical, 4)
            .foregroundStyle(color)
            .background(color.opacity(0.14), in: Capsule())
    }
}

// MARK: - Social Approvals (social.tsx — read-only, One Above All gated)

/// Port of social.tsx: Buffer draft review queue. Read-only on native — approve/schedule/reject
/// (outward-facing publishing) stay on desktop. Gated to One Above All like the web.
struct SocialView: View {
    @Environment(AuthStore.self) private var auth
    @State private var role: String?
    @State private var data: BufferResponse?
    @State private var loading = true
    @State private var loadError = false

    private var allowed: Bool { role == "ONE_ABOVE_ALL" }
    private var drafts: [BufferDraft] { data?.drafts ?? [] }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            if loading {
                ProgressView().tint(NX.violet).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if !allowed {
                EmptyState(icon: "megaphone", title: "Social Approvals khusus One Above All",
                           subtitle: "Halaman ini cuma buat role tertinggi.")
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Review post yang di-generate otomatis sebelum tayang lewat Buffer.")
                            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)

                        if let d = data, !d.configured {
                            NoticeCard(tone: .warning, title: "Buffer belum tersambung",
                                       message: "Token Buffer (BUFFER_API_TOKEN) belum diset di server. Kasih API key Buffer ke admin buat ngaktifin.")
                        }
                        if let err = data?.error, !err.isEmpty {
                            NoticeCard(tone: .danger, title: "Gagal narik draft", message: err)
                        }
                        if loadError && data == nil {
                            NoticeCard(tone: .danger, title: "Gagal narik draft dari server", message: "Coba lagi nanti.")
                        }

                        if let d = data, d.configured {
                            Text("\(drafts.count) draft nunggu approval")
                                .font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                        }

                        if (data?.configured ?? false) && drafts.isEmpty && (data?.error == nil) {
                            VStack(spacing: 8) {
                                Image(systemName: "checkmark.seal.fill").font(.system(size: 30)).foregroundStyle(NX.success)
                                Text("Semua beres — gak ada draft yang nunggu approval. 🎉")
                                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
                            }
                            .frame(maxWidth: .infinity).padding(.vertical, 36)
                            .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [5])))
                        }

                        ForEach(drafts) { DraftCard(draft: $0) }

                        if !drafts.isEmpty {
                            Text("Approve, jadwalin & tolak lewat web (desktop).")
                                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).padding(.top, 2)
                        }
                    }
                    .padding(16)
                }
            }
        }
        .navigationTitle("Social Approvals")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        loadError = false
        do {
            role = (try await APIClient.shared.roster()).role
            if allowed { data = try await APIClient.shared.bufferDrafts() }
        } catch APIError.unauthorized { auth.logout() }
        catch { loadError = true }
        loading = false
    }
}

struct DraftCard: View {
    let draft: BufferDraft
    private var service: String { (draft.channel?.service ?? "draft") }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(String(service.prefix(2)).uppercased())
                    .font(NXFont.text(10, .bold)).foregroundStyle(NX.mutedFg)
                    .frame(width: 28, height: 28).background(NX.muted, in: Circle())
                VStack(alignment: .leading, spacing: 1) {
                    Text(draft.channel?.name ?? "—").font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Text(service.uppercased()).font(NXFont.text(9, .bold)).foregroundStyle(NX.violet)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(NX.violet.opacity(0.12), in: Capsule())
                }
                Spacer()
                NexusChip(text: draft.status, tone: .neutral)
            }
            Text(draft.text.isEmpty ? "(tanpa caption)" : draft.text)
                .font(NXFont.text(13)).foregroundStyle(draft.text.isEmpty ? NX.mutedFg : NX.foreground)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            if let due = draft.dueAt, !due.isEmpty {
                Label("Tayang: \(AgendaRange.dayLabel(AgendaRange.dayKey(due))) · \(AgendaRange.timeLabel(due))",
                      systemImage: "calendar.badge.clock")
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
        }
        .padding(14)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
        .nexusShadowSoft()
    }
}

// MARK: - shared small states

struct NoticeCard: View {
    let tone: ChipTone
    let title: String
    let message: String
    private var color: Color { tone == .warning ? NX.warning : tone == .danger ? NX.danger : NX.blue }
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(NXFont.text(13, .bold)).foregroundStyle(color)
            Text(message).font(NXFont.text(12)).foregroundStyle(color.opacity(0.85))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(color.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [5])))
    }
}

struct ErrorState: View {
    let message: String
    let retry: () -> Void
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark").font(.system(size: 40)).foregroundStyle(NX.mutedFg)
            Text(message).font(NXFont.text(14)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
            Button("Coba lagi", action: retry).buttonStyle(NexusPrimaryButton(fullWidth: false))
        }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(32)
    }
}

struct EmptyState: View {
    let icon: String
    let title: String
    let subtitle: String
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 42)).foregroundStyle(NX.mutedFg.opacity(0.5))
            Text(title).font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground).multilineTextAlignment(.center)
            Text(subtitle).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(32)
    }
}
