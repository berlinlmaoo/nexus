import SwiftUI

/// Manage one team: who is in it, and which projects it opens up.
///
/// The screen the cards on Teams never had — tapping one did nothing at all, so members and project
/// access could only be changed from the web.
struct TeamDetailView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss

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
    @State private var openProfile: ProfileTarget?
    @State private var showLinkProject = false
    @State private var divisions: [Division] = []
    @State private var showRename = false
    @State private var nameDraft = ""
    @State private var showDelete = false
    @State private var showDivisions = false
    // Jam shift disimpan sebagai state layar, bukan dibaca langsung dari `team`: dua DatePicker
    // yang menulis ke server tiap detik geseran akan mengirim puluhan permintaan untuk satu
    // perubahan. Disimpan, lalu dikirim sekali lewat tombol Simpan.
    @State private var shiftOn = false
    @State private var shiftStart = Date()
    @State private var shiftEnd = Date()
    @State private var shiftDirty = false

    init(team: Team, onChanged: @escaping () -> Void = {}) {
        _team = State(initialValue: team)
        self.onChanged = onChanged
    }

    private var canManage: Bool { team.canManage ?? false }
    /// Supervisor absensi boleh mengatur jam shift tim tanpa jadi Manager/BoD — izin yang
    /// berbeda, dan server yang memutuskannya per tim.
    private var canManageAtt: Bool { team.canManageAttendanceSettings ?? canManage }
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
                    if canManage { settingsSection }
                    if canManageAtt { shiftSection }
                    membersSection
                    projectsSection
                }
                .padding(16)
            }
            .refreshable { await reload() }
        }
        .navigationTitle(team.name)
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $openProfile) { MemberProfileView(target: $0) }
        .toolbar {
            if canManage {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { nameDraft = team.name; showRename = true } label: { Label(T("Ganti nama"), systemImage: "pencil") }
                        Button { showDivisions = true } label: { Label(T("Kelola divisi"), systemImage: "folder") }
                        Divider()
                        Button(role: .destructive) { showDelete = true } label: { Label(T("Hapus tim"), systemImage: "trash") }
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
        }
        .alert(T("Ganti nama tim"), isPresented: $showRename) {
            TextField(T("Nama tim"), text: $nameDraft)
            Button(T("Simpan")) {
                let next = nameDraft.trimmingCharacters(in: .whitespaces)
                guard !next.isEmpty, next != team.name else { return }
                Task { await act("rename") { try await APIClient.shared.teamRename(teamId: team.id, name: next) } }
            }
            Button(T("Cancel"), role: .cancel) { }
        }
        .alert(T("Hapus tim ini?"), isPresented: $showDelete) {
            Button(T("Hapus"), role: .destructive) {
                Task {
                    try? await APIClient.shared.teamDelete(teamId: team.id)
                    onChanged()
                    dismiss()
                }
            }
            Button(T("Cancel"), role: .cancel) { }
        } message: {
            // Menghapus tim mencabut akses semua anggotanya ke project yang ditautkan tim ini.
            // Angkanya disebut, bukan diperkirakan pemakainya.
            Text("\(members.count) \(T("orang kehilangan akses ke")) \(links.count) \(T("project yang ditautkan tim ini."))")
        }
        .sheet(isPresented: $showDivisions) {
            NavigationStack { DivisionManagerSheet(divisions: divisions) { Task { await loadSupporting() } } }
        }
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

    private var settingsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader(T("Division"), action: nil)
            Menu {
                Button(T("— Tanpa divisi —")) { Task { await act("div") { try await APIClient.shared.teamSetDivision(teamId: team.id, divisionId: nil) } } }
                ForEach(divisions) { d in
                    Button(d.name) { Task { await act("div") { try await APIClient.shared.teamSetDivision(teamId: team.id, divisionId: d.id) } } }
                }
            } label: {
                HStack(spacing: 8) {
                    Circle().fill(Color(hex: team.division?.color ?? "#64748B")).frame(width: 8, height: 8)
                    Text(team.division?.name ?? T("— Tanpa divisi —"))
                        .font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                    Spacer(minLength: 6)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(NX.mutedFg)
                }
                .padding(.horizontal, 14).padding(.vertical, 12)
            }
            .disabled(busy.contains("div"))
            .nexusCard(padding: 0)
        }
    }

    /// Jam masuk/keluar khusus tim. Dimatikan = anggotanya memakai jam masing-masing dari
    /// Control Room; dinyalakan = jam tim ini menang untuk semuanya.
    private var shiftSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader(T("Jam shift tim"), action: nil)
            VStack(alignment: .leading, spacing: 12) {
                Toggle(isOn: Binding(get: { shiftOn }, set: { shiftOn = $0; shiftDirty = true })) {
                    Text(T("Pakai jam khusus untuk tim ini")).font(NXFont.text(13)).foregroundStyle(NX.foreground)
                }
                .tint(NX.violet)
                if shiftOn {
                    HStack(spacing: 14) {
                        DatePicker(T("Masuk"), selection: Binding(get: { shiftStart }, set: { shiftStart = $0; shiftDirty = true }), displayedComponents: .hourAndMinute)
                        DatePicker(T("Keluar"), selection: Binding(get: { shiftEnd }, set: { shiftEnd = $0; shiftDirty = true }), displayedComponents: .hourAndMinute)
                    }
                    .font(NXFont.text(12))
                } else {
                    Text(T("Anggota memakai jam masing-masing dari Control Room."))
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                if shiftDirty {
                    Button {
                        Task {
                            await act("shift") {
                                try await APIClient.shared.teamUpdateShift(
                                    teamId: team.id, enabled: shiftOn,
                                    start: Self.hhmm(shiftStart), end: Self.hhmm(shiftEnd))
                            }
                            shiftDirty = false
                        }
                    } label: {
                        Text(busy.contains("shift") ? T("Menyimpan…") : T("Simpan jam shift"))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(NexusPrimaryButton(fullWidth: true))
                    .disabled(busy.contains("shift"))
                }
            }
            .padding(14)
            .nexusCard(padding: 0)
        }
    }

    /// Server menyimpannya sebagai "HH:mm" 24 jam, apa pun format jam si pemakai.
    private static func hhmm(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }

    private static func date(from hhmm: String?) -> Date? {
        guard let hhmm else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        return f.date(from: hhmm)
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
            // Only the person half is the button. The row's menu has to stay outside it: a Menu
            // nested inside a Button's label never receives the tap.
            Button {
                if let uid = member.uid {
                    openProfile = ProfileTarget(userId: uid, name: member.user?.name, avatar: member.user?.avatar)
                }
            } label: {
                HStack(spacing: 12) {
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
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            // A membership row with no user id points at nobody. Leave it inert rather than open
            // somebody else's profile.
            .disabled(member.uid == nil)
            if member.isAttendancePrimary ?? false {
                Image(systemName: "star.fill").font(.system(size: 10)).foregroundStyle(NX.warning)
            }
            if member.isLead { NexusChip(text: T("Lead"), tone: .accent) }
            if canManage, let uid = member.uid {
                Menu {
                    Button(member.isLead ? T("Make member") : T("Make lead")) {
                        Task { await act(key) {
                            try await APIClient.shared.teamSetMemberRole(teamId: team.id, userId: uid, lead: !member.isLead)
                        } }
                    }
                    if canManageAtt {
                        // Tim absensi UTAMA orang ini: yang jam shiftnya benar-benar dipakai kalau
                        // dia ada di lebih dari satu tim. Tanpa ini di HP, orang yang masuk dua tim
                        // hanya bisa diperbaiki lewat web.
                        Button {
                            Task { await act(key) {
                                try await APIClient.shared.teamSetAttendancePrimary(
                                    teamId: team.id, userId: uid, isPrimary: !(member.isAttendancePrimary ?? false))
                            } }
                        } label: {
                            Label((member.isAttendancePrimary ?? false) ? T("Lepas tim absensi utama") : T("Jadikan tim absensi utama"),
                                  systemImage: (member.isAttendancePrimary ?? false) ? "star.fill" : "star")
                        }
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
        seedShift()
    }

    private func loadSupporting() async {
        if let roster = try? await APIClient.shared.roster() { self.roster = roster.members ?? [] }
        if let projects = try? await APIClient.shared.projects() { self.allProjects = projects }
        if let d = try? await APIClient.shared.divisions() { self.divisions = d }
        seedShift()
    }

    /// Isi kedua DatePicker dari tim. TIDAK dipanggil lagi setelah ada suntingan yang belum
    /// disimpan — memuat ulang di tengah pengeditan akan menelan jam yang baru saja dipilih orang.
    private func seedShift() {
        guard !shiftDirty else { return }
        shiftOn = team.attendanceShiftOverrideEnabled ?? false
        // Default 09:00–18:00 saat belum pernah diisi, supaya picker tidak membuka di jam sekarang
        // dan menyimpan jam masuk pukul 14:37 hanya karena tombol Simpan tersentuh.
        shiftStart = Self.date(from: team.attendanceShiftStartTime) ?? Self.date(from: "09:00") ?? Date()
        shiftEnd = Self.date(from: team.attendanceShiftEndTime) ?? Self.date(from: "18:00") ?? Date()
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

// MARK: - divisi

/// Bikin, ganti nama, hapus divisi. Satu-satunya tempatnya di HP sejak halaman Crew Hub
/// dibubarkan — dan divisi yang kebetulan kosong (tidak punya tim sama sekali) hanya bisa
/// diraih dari sini, bukan dari mana pun lewat tim.
struct DivisionManagerSheet: View {
    let divisions: [Division]
    var onChanged: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var newName = ""
    @State private var busy = false
    @State private var renaming: Division?
    @State private var nameDraft = ""
    @State private var problem: String?

    var body: some View {
        List {
            Section {
                HStack(spacing: 8) {
                    TextField(T("Divisi baru…"), text: $newName)
                        .font(NXFont.text(14))
                        .submitLabel(.done)
                        .onSubmit { create() }
                    Button(T("Tambah")) { create() }
                        .font(NXFont.text(13, .semibold))
                        .disabled(busy || newName.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            Section(T("Divisi")) {
                if divisions.isEmpty {
                    Text(T("Belum ada divisi.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
                ForEach(divisions) { d in
                    HStack(spacing: 8) {
                        Circle().fill(Color(hex: d.color ?? "#64748B")).frame(width: 8, height: 8)
                        Text(d.name).font(NXFont.text(14)).foregroundStyle(NX.foreground)
                        Spacer(minLength: 6)
                        Menu {
                            Button { renaming = d; nameDraft = d.name } label: { Label(T("Ganti nama"), systemImage: "pencil") }
                            // Menghapus divisi TIDAK menghapus timnya — mereka jadi tidak
                            // berkelompok. Itu perilaku server (onDelete: SetNull), dan kalimat
                            // ini ada supaya tidak ada yang mengira timnya ikut hilang.
                            Button(role: .destructive) { run { try await APIClient.shared.divisionDelete(divisionId: d.id) } } label: {
                                Label(T("Hapus (timnya tetap ada)"), systemImage: "trash")
                            }
                        } label: { Image(systemName: "ellipsis.circle").foregroundStyle(NX.mutedFg) }
                        .disabled(busy)
                    }
                }
            }
            if let problem {
                Section { Text(problem).font(NXFont.text(12)).foregroundStyle(NX.danger) }
            }
        }
        .navigationTitle(T("Kelola divisi"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } }
            if busy { ToolbarItem(placement: .topBarTrailing) { ProgressView() } }
        }
        .alert(T("Ganti nama divisi"), isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField(T("Nama divisi"), text: $nameDraft)
            Button(T("Simpan")) {
                let next = nameDraft.trimmingCharacters(in: .whitespaces)
                if let d = renaming, !next.isEmpty, next != d.name {
                    run { try await APIClient.shared.divisionRename(divisionId: d.id, name: next) }
                }
                renaming = nil
            }
            Button(T("Cancel"), role: .cancel) { renaming = nil }
        }
    }

    private func create() {
        let n = newName.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        run { _ = try await APIClient.shared.divisionCreate(name: n); newName = "" }
    }

    private func run(_ work: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true
        problem = nil
        Task {
            do { try await work(); onChanged() }
            catch { problem = (error as? LocalizedError)?.errorDescription ?? T("Gagal.") }
            busy = false
        }
    }
}
