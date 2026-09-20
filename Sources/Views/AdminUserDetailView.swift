import SwiftUI

/// Semua pengaturan satu orang di satu layar — pasangan dari kartu "Detail" di Control Room web.
///
/// Dulu semua ini berupa satu Menu panjang yang menempel di chip peran: sebelas tombol tanpa
/// konteks, separuhnya di luar layar, dan tidak ada yang bisa melihat NILAI saat ini (siapa
/// atasannya, jam kerjanya berapa) sebelum mengubahnya. Sekarang: ketuk orangnya, lihat semua
/// keadaannya, ubah yang perlu. Setiap perubahan memuat ulang daftar di belakang lewat
/// `onChanged`, dan layar ini digambar ulang dari data yang segar — bukan menambal state lokal,
/// karena satu perubahan tim ikut mengubah daftar project orang itu.
struct AdminUserDetailView: View {
    let member: WorkspaceRoster.Member
    let workspaceId: String?
    let viewerRole: String?
    let memberships: UserMemberships?
    let allTeams: [Team]
    let allProjects: [Project]
    /// Semua anggota workspace — calon atasan, dan untuk membaca nama atasan/bawahan.
    let members: [WorkspaceRoster.Member]
    var onChanged: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var problem: String?

    @State private var accountTarget: AccountEditTarget?
    @State private var approverTarget: ApproverPickTarget?
    @State private var linkTarget: GoogleLinkTarget?
    @State private var projectPickFor: ProjectPickTarget?
    @State private var addTeamFor: TeamPickTarget?
    @State private var exitTarget: TeamExitTarget?
    @State private var confirmDelete = false
    @State private var openProfile: ProfileTarget?
    @State private var openTeamId: String?
    @State private var openAttendance = false

    private var isBod: Bool { viewerRole == "BOD" || viewerRole == "ONE_ABOVE_ALL" }
    private var canEdit: Bool { canEditTier(viewerRole, member.role) }
    private var reports: [WorkspaceRoster.Member] {
        guard let uid = member.userId else { return [] }
        return members.filter { $0.approverId == uid }
    }
    private var monthKey: String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM"; f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: Date())
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header
                if let problem {
                    Text(problem).font(NXFont.text(12)).foregroundStyle(NX.danger)
                }
                if canEdit { roleCard }
                if isBod { accountCard }
                if isBod { approvalCard }
                if isBod { attendanceModeCard }
                if isBod { workHoursCard }
                if canEdit { googleCard }
                membershipCard
                if canEdit { dangerCard }
                Color.clear.frame(height: 8)
            }
            .padding(16)
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(member.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { if busy { ToolbarItem(placement: .topBarTrailing) { ProgressView() } } }
        .navigationDestination(item: $openProfile) { MemberProfileView(target: $0) }
        .navigationDestination(item: $openTeamId) { tid in
            if let t = allTeams.first(where: { $0.id == tid }) {
                TeamDetailView(team: t) { Task { await onChanged() } }
            }
        }
        .navigationDestination(isPresented: $openAttendance) {
            MemberAttendanceSheet(member: member, workspaceId: workspaceId, month: monthKey)
        }
        .sheet(item: $accountTarget) { t in
            NavigationStack { AccountEditSheet(target: t) { accountTarget = nil; Task { await onChanged() } } }
        }
        .sheet(item: $approverTarget) { t in
            NavigationStack {
                ApproverPickSheet(target: t, candidates: members.filter { $0.userId != t.selfUserId }) { approverId in
                    approverTarget = nil
                    Task { await run { _ = try await APIClient.shared.setAttendanceApprover(memberId: t.memberId, approverId: approverId, workspaceId: t.workspaceId) } }
                }
            }
        }
        .sheet(item: $linkTarget) { t in
            NavigationStack { GoogleLinkSheet(target: t) { linkTarget = nil; Task { await onChanged() } } }
        }
        .sheet(item: $projectPickFor) { t in
            NavigationStack {
                ProjectPickSheet(target: t, projects: allProjects.filter { !t.already.contains($0.id) }) { projectId in
                    projectPickFor = nil
                    Task { await run { _ = try await APIClient.shared.addProjectMember(projectId: projectId, userId: t.userId) } }
                }
            }
        }
        .sheet(item: $addTeamFor) { t in
            NavigationStack {
                TeamPickSheet(
                    target: t,
                    teams: allTeams.filter { $0.canManage == true && !t.already.contains($0.id) },
                    onPick: { teamId in
                        addTeamFor = nil
                        Task { await run { _ = try await APIClient.shared.teamAddMember(teamId: teamId, userId: t.userId) } }
                    },
                    onCreate: { name in
                        addTeamFor = nil
                        Task {
                            await run {
                                let team = try await APIClient.shared.teamCreate(name: name)
                                _ = try await APIClient.shared.teamAddMember(teamId: team.id, userId: t.userId)
                            }
                        }
                    }
                )
            }
        }
        .confirmationDialog(
            exitTarget.map { "\(T("Keluarkan")) \($0.userName) \(T("dari")) \($0.teamName)?" } ?? "",
            isPresented: Binding(get: { exitTarget != nil }, set: { if !$0 { exitTarget = nil } }),
            titleVisibility: .visible
        ) {
            Button(T("Keluarkan"), role: .destructive) {
                if let t = exitTarget {
                    exitTarget = nil
                    Task { await run { _ = try await APIClient.shared.teamRemoveMember(teamId: t.teamId, userId: t.userId) } }
                }
            }
            Button(T("Cancel"), role: .cancel) { exitTarget = nil }
        } message: {
            Text(exitTarget.map { t in
                t.losing.isEmpty
                    ? T("Tim ini tidak menautkan project, jadi tidak ada akses yang hilang.")
                    : "\(T("Ikut hilang: akses ke")) \(t.losing.count) project — \(t.losing.joined(separator: ", "))"
            } ?? "")
        }
        .confirmationDialog("\(T("Delete account")) \"\(member.displayName)\"?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(T("Delete permanently"), role: .destructive) {
                Task {
                    guard let uid = member.userId else { return }
                    await run { _ = try await APIClient.shared.deleteUser(uid) }
                    dismiss()
                }
            }
            Button(T("Cancel"), role: .cancel) {}
        } message: { Text(T("Their tasks/files/quests are reassigned to you. This cannot be undone.")) }
    }

    /// Satu jalur untuk semua perubahan: kunci layar, jalankan, muat ulang, tampilkan galatnya.
    private func run(_ body: () async throws -> Void) async {
        busy = true
        problem = nil
        do { try await body() } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Gagal menyimpan.")
        }
        await onChanged()
        busy = false
    }

    // MARK: header

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 14) {
                AvatarView(url: member.avatarURL, initial: member.initial, size: 64)
                VStack(alignment: .leading, spacing: 3) {
                    Text(member.displayName).font(NXFont.display(19, .bold)).foregroundStyle(NX.foreground).lineLimit(2)
                    if let e = member.emailText, !e.isEmpty {
                        Text(e).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                    RoleChip(role: member.role ?? "STAFF")
                }
                Spacer(minLength: 0)
            }
            HStack(spacing: 8) {
                if let uid = member.userId {
                    Button {
                        openProfile = ProfileTarget(userId: uid, name: member.displayName, avatar: member.avatarURL)
                    } label: {
                        Label(T("Lihat profil"), systemImage: "person.crop.circle")
                            .font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(NX.accentBg, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
                if member.flexiTimeEnabled ?? false {
                    Label(T("Flexi"), systemImage: "bolt.fill").font(NXFont.text(11, .semibold)).foregroundStyle(NX.warning)
                }
                if member.noGeofenceMode ?? false {
                    Label(T("Mobile"), systemImage: "iphone").font(NXFont.text(11, .semibold)).foregroundStyle(NX.violetText)
                }
            }
        }
        .nexusCard(padding: 14)
    }

    // MARK: cards

    private func card<Content: View>(_ title: String, _ hint: String? = nil, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title.uppercased()).font(NXFont.text(10.5, .bold)).tracking(0.8).foregroundStyle(NX.mutedFg)
            content()
            if let hint {
                Text(hint).font(NXFont.text(10.5)).foregroundStyle(NX.mutedFg.opacity(0.85)).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard(padding: 14)
    }

    /// Baris "judul → nilai" dengan panah, membuka sesuatu.
    private func navRow(_ icon: String, _ title: String, _ value: String?, tint: Color = NX.foreground, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.violetText).frame(width: 22)
                Text(title).font(NXFont.text(14, .semibold)).foregroundStyle(tint)
                Spacer(minLength: 6)
                if let value {
                    Text(value).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1).truncationMode(.middle)
                }
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy)
    }

    private var roleCard: some View {
        card(T("Peran"), T("Menentukan apa yang bisa dilihat dan diatur orang ini di NEXUS.")) {
            HStack(spacing: 8) {
                ForEach(assignableRoles(viewerRole), id: \.self) { r in
                    let on = (member.role ?? "STAFF") == r
                    Button {
                        guard !on, let mid = member.id, let wsId = workspaceId else { return }
                        Task { await run { _ = try await APIClient.shared.updateWorkspaceMemberRole(memberId: mid, role: r, workspaceId: wsId) } }
                    } label: {
                        Text(orgRoleLabel(r))
                            .font(NXFont.text(12, on ? .bold : .semibold))
                            .foregroundStyle(on ? Color.white : NX.mutedFg)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(on ? NX.violet : NX.muted.opacity(0.7), in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(busy)
                }
            }
        }
    }

    private var accountCard: some View {
        card(T("Akun")) {
            navRow("person.text.rectangle", T("Foto, nama, email login, sandi"), nil) {
                if let uid = member.userId, let mid = member.id {
                    accountTarget = AccountEditTarget(id: uid, userId: uid, memberId: mid, name: member.displayName, email: member.emailText ?? "", avatar: member.avatarURL)
                }
            }
        }
    }

    private var approvalCard: some View {
        card(T("Approval absensi"), T("Izin, cuti, dan sakit orang ini masuk ke atasannya. Tanpa atasan, request-nya jatuh ke semua BoD.")) {
            HStack(spacing: 10) {
                if let a = member.approver {
                    AvatarView(url: a.avatar, initial: String((a.name ?? "?").first ?? "?").uppercased(), size: 28)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(T("Atasan")).font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
                        Text(a.name ?? "—").font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                    }
                } else if member.role == "STAFF" || member.role == "MANAGER" {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(NX.warning)
                    Text(T("Not placed on the Approval Chart")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.warning)
                } else {
                    Image(systemName: "crown.fill").foregroundStyle(NX.violetText)
                    Text(T("Puncak — tidak punya atasan")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                }
                Spacer(minLength: 0)
            }
            navRow("arrow.triangle.branch", member.approverId == nil ? T("Place under an approver…") : T("Change approver…"), nil) {
                if let mid = member.id, let wsId = workspaceId {
                    approverTarget = ApproverPickTarget(id: mid, memberId: mid, workspaceId: wsId, name: member.displayName, current: member.approverId, selfUserId: member.userId)
                }
            }
            if !reports.isEmpty {
                Divider().overlay(NX.border)
                Text("\(T("Menyetujui request")) · \(reports.count)").font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
                FlowLayout(spacing: 6) {
                    ForEach(reports, id: \.idv) { r in
                        HStack(spacing: 5) {
                            AvatarView(url: r.avatarURL, initial: r.initial, size: 16)
                            Text(r.displayName).font(NXFont.text(11, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                        }
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(NX.background, in: Capsule())
                        .overlay(Capsule().strokeBorder(NX.border))
                    }
                }
            }
        }
    }

    private var attendanceModeCard: some View {
        card(T("Mode absensi")) {
            Toggle(isOn: Binding(
                get: { member.flexiTimeEnabled ?? false },
                set: { v in
                    guard let mid = member.id, let wsId = workspaceId else { return }
                    Task { await run { _ = try await APIClient.shared.updateWorkspaceMemberAttendanceFlags(memberId: mid, workspaceId: wsId, flexi: v) } }
                })) {
                VStack(alignment: .leading, spacing: 1) {
                    Label(T("Flexi Time"), systemImage: "bolt.fill").font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                    Text(T("Masuk kapan saja 12:00–15:00, pulang = masuk + 9 jam. Jam kerja tetap diabaikan.")).font(NXFont.text(10.5)).foregroundStyle(NX.mutedFg)
                }
            }
            .tint(NX.warning)
            .disabled(busy)
            Divider().overlay(NX.border)
            Toggle(isOn: Binding(
                get: { member.noGeofenceMode ?? false },
                set: { v in
                    guard let mid = member.id, let wsId = workspaceId else { return }
                    Task { await run { _ = try await APIClient.shared.updateWorkspaceMemberAttendanceFlags(memberId: mid, workspaceId: wsId, noGeofence: v) } }
                })) {
                VStack(alignment: .leading, spacing: 1) {
                    Label(T("Mode Mobile"), systemImage: "iphone").font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                    Text(T("Absen dari mana saja: geofence mati, check-out di luar kantor tanpa approval.")).font(NXFont.text(10.5)).foregroundStyle(NX.mutedFg)
                }
            }
            .tint(NX.violet)
            .disabled(busy)
        }
    }

    private var workHoursCard: some View {
        card(T("Jam kerja & day off")) {
            navRow("clock", T("Shift & jatah day off"),
                   (member.flexiTimeEnabled ?? false) ? T("Flexi") : (member.shiftLabel ?? T("team / office default"))) {
                openAttendance = true
            }
        }
    }

    private var googleCard: some View {
        card(T("Google Workspace"), T("Alamat kantor yang dipakai NEXUS untuk kalender, Meet, dan email atas nama orang ini.")) {
            navRow("at", member.googleWorkspaceEmail == nil ? T("Link Google account") : T("Change Google account"),
                   member.googleWorkspaceEmail ?? T("belum ditautkan")) {
                if let uid = member.userId {
                    linkTarget = GoogleLinkTarget(id: uid, userId: uid, name: member.displayName, current: member.googleWorkspaceEmail)
                }
            }
        }
    }

    private var membershipCard: some View {
        card(T("Teams & projects"), canEdit ? T("Joining a team grants access to the projects linked to it.") : nil) {
            Label(T("Projects"), systemImage: "square.stack.3d.up").font(NXFont.text(10, .semibold)).foregroundStyle(NX.mutedFg)
            projectChips
            Label(T("Teams"), systemImage: "person.3").font(NXFont.text(10, .semibold)).foregroundStyle(NX.mutedFg)
            teamChips
        }
    }

    /// Chip project. Yang LANGSUNG bisa dilepas; yang lewat tim tidak — sinkronisasi tim akan
    /// menuliskannya lagi, jadi tombol lepas di sana cuma janji palsu.
    @ViewBuilder private var projectChips: some View {
        let ps = memberships?.projects ?? []
        let editable = canEdit && member.userId != nil
        FlowLayout(spacing: 6) {
            ForEach(ps) { p in
                let chip = HStack(spacing: 5) {
                    Circle().fill(Color(hex: p.color ?? "#94A3B8")).frame(width: 6, height: 6)
                    Text(p.viaTeam == nil ? p.name : "\(p.name) · via \(p.viaTeam!)")
                        .font(NXFont.text(11, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                }
                .padding(.horizontal, 8).padding(.vertical, 5)
                .background(NX.background, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
                if editable, p.viaTeam == nil, let uid = member.userId {
                    Menu {
                        Button(role: .destructive) {
                            Task { await run { _ = try await APIClient.shared.removeProjectMember(projectId: p.id, userId: uid) } }
                        } label: { Label(T("Lepas dari project"), systemImage: "minus.circle") }
                    } label: { chip }
                    .disabled(busy)
                } else {
                    chip
                }
            }
            if editable, let uid = member.userId {
                Button {
                    projectPickFor = ProjectPickTarget(id: uid, userId: uid, name: member.displayName, already: Set(ps.map(\.id)))
                } label: { addChip(T("project")) }
                .buttonStyle(.plain)
                .disabled(busy)
            }
        }
        if ps.isEmpty && !editable {
            Text(T("Not in any project yet.")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
        }
    }

    @ViewBuilder private var teamChips: some View {
        let teams = memberships?.teams ?? []
        let editable = canEdit && member.userId != nil
        FlowLayout(spacing: 6) {
            ForEach(teams) { t in
                let chip = HStack(spacing: 5) {
                    Circle().fill(Color(hex: t.color ?? "#7B2FBE")).frame(width: 6, height: 6)
                    Text(t.name).font(NXFont.text(11, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                }
                .padding(.horizontal, 8).padding(.vertical, 5)
                .background(NX.background, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
                if editable, let uid = member.userId {
                    Menu {
                        if let full = allTeams.first(where: { $0.id == t.id }), full.canManage == true {
                            Button { openTeamId = full.id } label: { Label(T("Manage this team"), systemImage: "gearshape") }
                        }
                        Button(role: .destructive) {
                            exitTarget = TeamExitTarget(
                                id: "\(uid)-\(t.id)", userId: uid, userName: member.displayName,
                                teamId: t.id, teamName: t.name,
                                losing: (memberships?.projects ?? []).filter { $0.viaTeam == t.name }.map(\.name)
                            )
                        } label: { Label(T("Remove from team"), systemImage: "person.badge.minus") }
                    } label: { chip }
                    .disabled(busy)
                } else {
                    chip
                }
            }
            if editable, let uid = member.userId {
                Button {
                    addTeamFor = TeamPickTarget(id: uid, userId: uid, name: member.displayName, already: Set(teams.map(\.id)))
                } label: { addChip(T("team")) }
                .buttonStyle(.plain)
                .disabled(busy)
            }
        }
        if teams.isEmpty && !editable {
            Text(T("Not in any team yet.")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
        }
    }

    private func addChip(_ label: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: busy ? "hourglass" : "plus").font(.system(size: 9, weight: .bold))
            Text(label).font(NXFont.text(11, .semibold))
        }
        .foregroundStyle(NX.mutedFg)
        .padding(.horizontal, 8).padding(.vertical, 5)
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [3, 2])))
    }

    private var dangerCard: some View {
        card(T("Zona berbahaya")) {
            navRow("trash", T("Delete account"), nil, tint: NX.danger) { confirmDelete = true }
        }
    }
}
