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
    /// Offboard (someone who left the company): BoD+, never yourself, never someone at or above
    /// your level. Decided by the list, which knows who is looking.
    let canOffboard: Bool
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
    /// Why the last delete was refused, shown in the danger card where the button is.
    @State private var deleteProblem: String?
    @State private var offboardTarget: OffboardTarget?
    /// The offboarding went through: once its sheet closes, this person is no longer a member, so
    /// this screen leaves too.
    @State private var offboarded = false
    @State private var openProfile: ProfileTarget?
    @State private var openTeamId: String?
    @State private var openAttendance = false

    private var isBod: Bool { viewerRole == "BOD" || viewerRole == "ONE_ABOVE_ALL" }
    private var canEdit: Bool { canEditTier(viewerRole, member.role) }
    private var reports: [WorkspaceRoster.Member] {
        guard let uid = member.userId else { return [] }
        return members.filter { $0.approverId == uid }
    }
    /// The attendance period key (28th cut-off) — both the xlsx export and the day-off allowance behind
    /// this sheet are per period, not per calendar month.
    private var monthKey: String { OfflineSync.monthKey() }

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
                if isBod { restDaysCard }
                if isBod { workHoursCard }
                if canEdit { googleCard }
                membershipCard
                if canOffboard { offboardCard }
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
        .alert(
            exitTarget.map { "\(T("Keluarkan")) \($0.userName) \(T("dari")) \($0.teamName)?" } ?? "",
            isPresented: Binding(get: { exitTarget != nil }, set: { if !$0 { exitTarget = nil } })
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
        .alert("\(T("Delete account")) \"\(member.displayName)\"?", isPresented: $confirmDelete) {
            Button(T("Delete permanently"), role: .destructive) {
                Task {
                    guard let uid = member.userId else { return }
                    // Leaves only when it worked: a refusal (an account with attendance history is
                    // offboarded, never deleted) has to stay on screen to be read.
                    busy = true
                    deleteProblem = nil
                    do {
                        _ = try await APIClient.shared.deleteUser(uid)
                        await onChanged()
                        busy = false
                        dismiss()
                    } catch {
                        deleteProblem = (error as? LocalizedError)?.errorDescription ?? T("Something went wrong. Nothing was changed.")
                        busy = false
                    }
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
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .nxChoiceChip(on: on)
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

    /// Fixed weekly rest days. The offices run seven days; before this, "Sunday is my day off" had
    /// to be filed as a day-off request every week, and a forgotten one cost −150 XP and a token.
    private var restDaysCard: some View {
        let current = Set(member.restDays ?? [])
        let names = [1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun"]
        func save(_ days: Set<Int>) {
            guard let mid = member.id, let wsId = workspaceId else { return }
            Task { await run { _ = try await APIClient.shared.updateWorkspaceMemberAttendanceFlags(memberId: mid, workspaceId: wsId, restDays: days.sorted()) } }
        }
        return card(T("Rest days"), current.isEmpty ? T("Works every office day; a day off must be requested.") : T("No reminder, lateness or absence on these days. No day-off request needed.")) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    ForEach(1...7, id: \.self) { d in
                        let on = current.contains(d)
                        Button {
                            var next = current; if on { next.remove(d) } else { next.insert(d) }
                            save(next)
                        } label: {
                            Text(T(names[d] ?? "")).font(NXFont.text(12, .bold))
                                .foregroundStyle(on ? Color.white : NX.mutedFg)
                                .frame(maxWidth: .infinity).padding(.vertical, 7)
                                .background(on ? NX.violet : NX.card, in: Capsule())
                                .overlay(Capsule().strokeBorder(on ? Color.clear : NX.border))
                        }
                        .buttonStyle(.plain).disabled(!canEdit || busy)
                    }
                }
                if canEdit {
                    HStack(spacing: 14) {
                        Button(T("Sunday off")) { save([7]) }
                        Button(T("Sat + Sun off")) { save([6, 7]) }
                        Button(T("Works every day")) { save([]) }
                    }
                    .font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText).buttonStyle(.plain).disabled(busy)
                }
            }
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
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border, lineWidth: 1))
    }

    /// Offboard: rare and heavy, so near the end, and only for those who may. Its sheet hangs off this
    /// card rather than off the screen, which already carries the other sheets.
    private var offboardCard: some View {
        card(T("Offboard"), T("For someone who resigned, whose contract ended, or who was let go. Their history stays.")) {
            navRow("person.badge.minus", String(format: T("Offboard %@…"), member.displayName), nil, tint: NX.danger) {
                if let uid = member.userId {
                    offboardTarget = OffboardTarget(id: uid, name: member.displayName, joinedAt: member.joinedAt)
                }
            }
        }
        .sheet(item: $offboardTarget, onDismiss: {
            guard offboarded else { return }
            offboarded = false
            dismiss()
            Task { await onChanged() }
        }) { t in
            NavigationStack { OffboardUserSheet(target: t) { offboarded = true } }
        }
    }

    private var dangerCard: some View {
        card(T("Zona berbahaya")) {
            navRow("trash", T("Delete account"), nil, tint: NX.danger) { confirmDelete = true }
            if let deleteProblem {
                Text(deleteProblem).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

// MARK: - Offboarding (owner, 8 Oct 2026)

/// Who the offboard sheet is for. `id` is the user id.
struct OffboardTarget: Identifiable {
    let id: String
    let name: String
    /// When they joined the workspace (ISO): the earliest last working day the server accepts.
    let joinedAt: String?
}

/// Offboard: someone resigned, their contract ended, or they were let go
/// (POST /api/admin/users/:id/offboard). Says plainly what happens and what stays before, and what is
/// left for someone to do after: their pending requests, their open tasks, and the people who lost
/// them as approver. The web's OffboardUserModal, in the app's sheet structure.
struct OffboardUserSheet: View {
    let target: OffboardTarget
    /// The server confirmed it. Called once, before the result is shown.
    let onOffboarded: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var day = Date()
    @State private var reason = "RESIGNED"
    @State private var note = ""
    @State private var busy = false
    @State private var problem: String?
    @State private var result: OffboardResult?

    /// The attendance calendar's zone: "today" and the last working day are Jakarta dates.
    private static let jakarta = TimeZone(identifier: "Asia/Jakarta") ?? .current
    private static let reasons: [(code: String, label: String)] = [
        ("RESIGNED", "Resigned"), ("CONTRACT_ENDED", "Contract ended"), ("DISMISSED", "Dismissed"), ("OTHER", "Other"),
    ]

    /// Not before they joined (the server's own floor), not after today.
    private var range: ClosedRange<Date> {
        let now = Date()
        guard let joined = ProjDate.parse(target.joinedAt), joined <= now else { return Date.distantPast...now }
        return joined...now
    }

    var body: some View {
        Group {
            if let result { resultList(result) } else { form }
        }
        .navigationTitle(result == nil ? String(format: T("Offboard %@"), target.name) : T("Offboard"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if result == nil {
                ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() }.disabled(busy) }
            }
            if result != nil {
                ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { dismiss() }.bold() }
            }
        }
        .interactiveDismissDisabled(busy)
    }

    // MARK: form

    private var form: some View {
        Form {
            Section {
                Text(T("For someone who resigned, whose contract ended, or who was let go. Their history stays."))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }
            Section {
                DatePicker(T("Last working day"), selection: $day, in: range, displayedComponents: .date)
                    .environment(\.timeZone, Self.jakarta)
                    .tint(NX.violetText)
            }
            Section(T("Reason")) {
                Picker(T("Reason"), selection: $reason) {
                    ForEach(Self.reasons, id: \.code) { r in Text(T(r.label)).tag(r.code) }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }
            Section(T("Note (optional)")) {
                TextField(T("Note (optional)"), text: $note, axis: .vertical)
                    .lineLimit(2...5)
            }
            Section(T("What happens")) {
                ForEach(happens, id: \.self) { line in
                    Text(line).font(NXFont.text(13)).foregroundStyle(NX.foreground)
                }
            }
            if let problem {
                Section {
                    Text(problem).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger)
                }
            }
            Section {
                Button(role: .destructive) { Task { await submit() } } label: {
                    HStack(spacing: 8) {
                        Spacer()
                        if busy { ProgressView() }
                        Text(busy ? T("Offboarding…") : T("Offboard")).font(NXFont.text(15, .bold))
                        Spacer()
                    }
                }
                .disabled(busy)
            }
        }
    }

    private var happens: [String] {
        [
            T("Can't sign in anymore, on any device."),
            T("Removed from projects, teams and chats."),
            T("Their attendance, requests, projects, tasks and messages stay."),
            T("Their open tasks stay assigned to them."),
            T("Anyone who had them as approver goes back to the BoD safety net."),
        ]
    }

    private func submit() async {
        busy = true
        problem = nil
        defer { busy = false }
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = Self.jakarta
        f.dateFormat = "yyyy-MM-dd"
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let r = try await APIClient.shared.offboardUser(target.id, lastWorkingDay: f.string(from: day), reason: reason,
                                                            note: trimmed.isEmpty ? nil : String(trimmed.prefix(500)))
            onOffboarded()
            result = r
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Something went wrong. Nothing was changed.")
        }
    }

    // MARK: result

    private func resultList(_ r: OffboardResult) -> some View {
        let pending = r.pendingRequests ?? 0
        let openTasks = r.openTasks ?? 0
        let lost = r.approverEdgesCleared ?? []
        let canceled = r.autoDeductionsCanceled ?? 0
        return List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(String(format: T("%@ is offboarded."), r.user?.name ?? target.name))
                        .font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground)
                    if let last = Self.longDay(r.lastWorkingDay) {
                        let places = (r.workspaces ?? []).joined(separator: ", ")
                        Text(String(format: T("Last working day: %@"), last) + (places.isEmpty ? "" : " · \(places)"))
                            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    }
                }
                .padding(.vertical, 2)
            }
            Section {
                count(pending, T("Pending requests"),
                      pending > 0 ? T("Still waiting for a decision in Attendance.") : T("Nothing waiting."))
                count(openTasks, T("Open tasks"),
                      openTasks > 0 ? T("Still assigned to them. Reassign them if someone should take over.") : T("Nothing open."))
            }
            if !lost.isEmpty {
                Section {
                    ForEach(lost) { p in
                        Text(p.name ?? "—").font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                    }
                } header: {
                    Text(String(format: lost.count == 1 ? T("%d person lost their approver") : T("%d people lost their approver"), lost.count))
                } footer: {
                    Text(T("Their requests go to the BoD until you set a new approver in the Approval chart."))
                }
            }
            if canceled > 0 {
                Section {
                    Text(String(format: canceled == 1
                                ? T("%d automatic deduction dated after their last day was canceled.")
                                : T("%d automatic deductions dated after their last day were canceled."), canceled))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
            }
        }
    }

    private func count(_ n: Int, _ title: String, _ note: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text("\(n)").font(NXFont.display(22, .bold)).monospacedDigit().foregroundStyle(NX.foreground)
                .frame(minWidth: 28, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                Text(note).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 2)
    }

    /// "10 October 2026" from a "YYYY-MM-DD" attendance date (read in UTC, see LeftTag.dateText).
    private static func longDay(_ key: String?) -> String? {
        guard let key, key.count >= 10 else { return nil }
        let parse = DateFormatter()
        parse.calendar = Calendar(identifier: .gregorian)
        parse.locale = Locale(identifier: "en_US_POSIX")
        parse.timeZone = TimeZone(identifier: "UTC")
        parse.dateFormat = "yyyy-MM-dd"
        guard let d = parse.date(from: String(key.prefix(10))) else { return key }
        let out = DateFormatter()
        out.timeZone = TimeZone(identifier: "UTC")
        out.locale = Locale(identifier: AppLanguage.shared.lang == .id ? "id_ID" : "en_GB")
        out.dateFormat = "d MMMM yyyy"
        return out.string(from: d)
    }
}
