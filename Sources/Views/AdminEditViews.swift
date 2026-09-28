import SwiftUI
import PhotosUI

// MARK: models

// AuditLogsResponse / AuditLog live in Sources/AuditModels.swift, beside the detail model.
struct AdminQuestsResponse: Decodable, Sendable { let quests: [AdminQuest]? }
struct AdminQuest: Decodable, Identifiable, Sendable {
    let id: String
    let title: String
    let requirementType: String?
    let requiredCount: Int?
    let xpReward: Int?
    let deadline: String?
}
/// GET /api/admin/app-installs — one row per person, their most recently seen device.
struct AppInstalls: Decodable, Sendable {
    let installs: [Row]?
    /// Members with no registered device. Optional: older servers never sent it.
    let notInstalled: [Missing]?
    let totals: Totals?

    struct Missing: Decodable, Sendable {
        let id: String
        let name: String?
        let email: String?
        let lastActiveAt: String?
    }

    struct Row: Decodable, Sendable {
        let id: String
        let appVersion: String?
        let buildNumber: String?
        let osVersion: String?
        let lastSeenAt: String?
        let user: Person?
        struct Person: Decodable, Sendable { let name: String?; let email: String? }

        var versionLabel: String {
            guard let appVersion else { return "—" }
            return buildNumber.map { "\(appVersion) (\($0))" } ?? appVersion
        }
    }
    struct Totals: Decodable, Sendable {
        let people: Int?
        let devices: Int?
        let notInstalled: Int?
    }
}

/// GET /api/gideon/usage — counts and dates only, never anybody's questions.
struct GideonUsage: Decodable, Sendable {
    let users: [Row]?
    let totals: Totals?

    struct Row: Decodable, Sendable {
        let id: String
        let name: String?
        let email: String?
        let asked: Int?
        let answered: Int?
        let toolCalls: Int?
        let firstUsed: String?
        let lastUsed: String?
    }
    struct Totals: Decodable, Sendable {
        let people: Int?
        let asked: Int?
        let toolCalls: Int?
    }
}

struct AnnouncementsResponse: Decodable, Sendable { let announcements: [AdminAnnouncement]? }
struct AdminAnnouncement: Decodable, Identifiable, Sendable {
    let id: String
    let title: String
    let body: String?
    let tone: String?
    let active: Bool?
    /// Sent by /api/announcements/active. The admin list omits it, hence optional on both.
    let imageUrl: String?
    let seenCount: Int?
    let createdAt: String?
}

// MARK: - Control Room (segmented: Users / Audit / Quests / Pengumuman)

struct AdminView: View {
    @State private var section = 0
    @State private var workspaceId: String?
    @State private var viewer = Viewer.shared

    /// Built rather than fixed, because the announcements tab is BoD-only. Hiding it by index would
    /// silently renumber every tab after it; there is nothing after it today, and that is exactly
    /// the kind of assumption that breaks the day somebody appends one.
    private var tabs: [(title: String, id: String)] {
        var t: [(String, String)] = [("Users", "users"), ("Absensi", "attendance"),
                                     ("Audit", "audit"), ("Quests", "quests")]
        if viewer.canAnnounce {
            t.append(("Pengumuman", "announcements"))
            t.append((T("Extra day off"), "extra-dayoff"))
            t.append(("GIDEON", "gideon"))
            t.append(("App", "app"))
        }
        return t
    }

    /// A scrolling row of pills, not a segmented control.
    ///
    /// `Picker(.segmented)` divides its width equally between every option, so seven of them on a
    /// phone leaves each about 50pt wide: the labels truncate ("Pengu…"), the tap targets fall below
    /// what a thumb can reliably hit, and the tabs that matter most to a BoD are the ones squeezed
    /// hardest. It also cannot grow — the next tab added makes all of them worse.
    ///
    /// Pills size to their own text instead, so a label is never cut and every target is at least as
    /// wide as the word it carries. The strip scrolls, and follows the selection so a tab chosen off
    /// screen does not leave the row looking unchanged.
    @ViewBuilder private var tabStrip: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(tabs.indices, id: \.self) { i in
                        let selected = i == section
                        Button {
                            withAnimation(.easeOut(duration: 0.18)) { section = i }
                        } label: {
                            Text(tabs[i].title)
                                .font(NXFont.text(13, selected ? .bold : .semibold))
                                .foregroundStyle(selected ? Color.white : NX.mutedFg)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(selected ? NX.violet : NX.muted.opacity(0.6),
                                            in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .id(i)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            }
            .onChange(of: section) { _, new in
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(new, anchor: .center) }
            }
        }
    }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            VStack(spacing: 0) {
                tabStrip
                Divider().overlay(NX.border)
                // Switched on the tab's id, not its index, so a hidden tab cannot shift the others.
                switch tabs.indices.contains(section) ? tabs[section].id : "users" {
                case "attendance": AttendanceAdminSection(workspaceId: workspaceId)
                case "audit": AdminAuditSection()
                case "quests": AdminQuestsSection(workspaceId: workspaceId)
                case "announcements": AdminAnnouncementsSection()
                case "extra-dayoff": AdminExtraDayOffSection()
                case "gideon": AdminGideonUsageSection()
                case "app": AdminAppInstallsSection()
                default: AdminUsersSection(workspaceId: workspaceId)
                }
            }
        }
        .navigationTitle("Control Room").navigationBarTitleDisplayMode(.inline)
        .task {
            await viewer.loadIfNeeded()
            workspaceId = (try? await APIClient.shared.workspaceInfo())?.workspaceId
        }
    }
}

// MARK: - Users (roster + role edit + delete)

struct AdminUsersSection: View {
    let workspaceId: String?
    @Environment(AuthStore.self) private var auth
    @State private var roster: WorkspaceRoster?
    @State private var loading = true
    @State private var filter = "ALL"
    @State private var query = ""
    @State private var memberships: [String: UserMemberships] = [:]
    @State private var allTeams: [Team] = []
    @State private var allProjects: [Project] = []
    /// userId orang yang detailnya sedang dibuka. Layar detail dibangun ulang dari `members`
    /// setiap daftar ini dimuat ulang, jadi perubahan di sana langsung terlihat di sana juga.
    @State private var openUser: String?
    @State private var showChart = false
    @State private var joining: Set<String> = []

    // A–Z, peka lokal — urutan server adalah urutan bergabung, yang tidak membantu siapa pun
    // mencari nama di daftar 49 orang.
    private var members: [WorkspaceRoster.Member] {
        (roster?.members ?? []).sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
    }
    private var registered: [WorkspaceRoster.Registered] {
        (roster?.availableUsers ?? []).sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
    }
    private var viewerRole: String? { roster?.role }
    /// Flexi dan mode Mobile mengubah aturan absensi seseorang, jadi BoD ke atas — aturan
    /// yang sama dengan `canManageShift` di Control Room web, bukan `canEditTier`.
    private var canManageAttendanceFlags: Bool { viewerRole == "BOD" || viewerRole == "ONE_ABOVE_ALL" }
    private var unassignedStaff: [WorkspaceRoster.Member] { members.filter { ($0.role == "STAFF" || $0.role == "MANAGER") && $0.approverId == nil } }
    private var chainSummary: String {
        let placed = members.filter { $0.approverId != nil }.count
        let n = unassignedStaff.count
        return n == 0
            ? "\(placed) \(T("orang punya atasan, semua sudah ditaruh"))"
            : "\(n) \(T("belum ditaruh — request-nya masuk ke semua BoD"))"
    }
    private func count(_ r: String) -> Int { members.filter { $0.role == r }.count }
    private var rows: [WorkspaceRoster.Member] {
        let base = filter == "ALL" ? members : members.filter { ($0.role ?? "STAFF") == filter }
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return base }
        return base.filter { $0.displayName.lowercased().contains(q) || ($0.emailText ?? "").lowercased().contains(q) }
    }

    var body: some View {
        Group {
            if loading { ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity) }
            else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        let cols = [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())]
                        LazyVGrid(columns: cols, spacing: 10) {
                            AdminStat(label: "Total", value: members.count, active: filter == "ALL") { filter = "ALL" }
                            AdminStat(label: "One Above All", value: count("ONE_ABOVE_ALL"), active: filter == "ONE_ABOVE_ALL") { toggle("ONE_ABOVE_ALL") }
                            AdminStat(label: "BoD", value: count("BOD"), active: filter == "BOD") { toggle("BOD") }
                            AdminStat(label: "Manager", value: count("MANAGER"), active: filter == "MANAGER") { toggle("MANAGER") }
                            AdminStat(label: "Staff", value: count("STAFF"), active: filter == "STAFF") { toggle("STAFF") }
                        }
                        if canManageAttendanceFlags {
                            Button { showChart = true } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: "arrow.triangle.branch").font(.system(size: 14, weight: .semibold)).foregroundStyle(NX.violetText)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(T("Bagan Approval")).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                                        Text(chainSummary).font(NXFont.text(11)).foregroundStyle(unassignedStaff.isEmpty ? NX.mutedFg : NX.warning)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.mutedFg)
                                }
                                .padding(.horizontal, 14).padding(.vertical, 12)
                                .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(NX.border))
                            }
                            .buttonStyle(.plain)
                        }
                        HStack(spacing: 8) {
                            Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.mutedFg)
                            TextField(T("Search name or email…"), text: $query)
                                .font(NXFont.text(14)).textInputAutocapitalization(.never).autocorrectionDisabled()
                            if !query.isEmpty {
                                Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg) }.buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                        VStack(spacing: 0) {
                            ForEach(Array(rows.enumerated()), id: \.element.idv) { idx, m in
                                if idx > 0 { Divider().overlay(NX.border) }
                                row(m)
                            }
                            if rows.isEmpty {
                                Text(T("Nggak ada yang cocok.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).padding(14)
                            }
                        }
                        .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border)).nexusShadowSoft()

                        // Akun yang mendaftar sendiri tanpa kode workspace. Satu tombol, langsung
                        // jadi Staff; perannya bisa diubah sesudahnya dari detail orangnya.
                        if !registered.isEmpty, canManageAttendanceFlags, let wsId = workspaceId {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("\(T("Not in the workspace yet")) · \(registered.count)")
                                    .font(NXFont.text(11, .semibold)).foregroundStyle(NX.warning)
                                VStack(spacing: 0) {
                                    ForEach(Array(registered.enumerated()), id: \.element.id) { idx, r in
                                        if idx > 0 { Divider().overlay(NX.border) }
                                        HStack(spacing: 12) {
                                            AvatarView(url: r.avatar, initial: r.initial, size: 34)
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(r.displayName).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                                                Text(r.email).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                                            }
                                            Spacer(minLength: 6)
                                            Button {
                                                Task { await join(r, wsId) }
                                            } label: {
                                                Text(joining.contains(r.id) ? T("…") : T("Masukkan"))
                                                    .font(NXFont.text(12, .semibold))
                                                    .padding(.horizontal, 10).padding(.vertical, 6)
                                                    .background(NX.success.opacity(0.12), in: Capsule())
                                                    .foregroundStyle(NX.success)
                                            }
                                            .buttonStyle(.plain)
                                            .disabled(joining.contains(r.id))
                                        }
                                        .padding(.horizontal, 14).padding(.vertical, 10)
                                    }
                                }
                                .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border)).nexusShadowSoft()
                            }
                        }
                    }.padding(16)
                }
            }
        }
        .task { await load() }
        // Satu layar untuk semua pengaturan orang itu — bukan menu yang menempel di chip peran.
        // Dibangun ulang dari `members` yang segar tiap kali daftar dimuat ulang.
        .navigationDestination(item: $openUser) { uid in
            if let m = members.first(where: { $0.userId == uid }) {
                AdminUserDetailView(
                    member: m, workspaceId: workspaceId, viewerRole: viewerRole,
                    memberships: memberships[uid], allTeams: allTeams, allProjects: allProjects,
                    members: members
                ) { await load() }
            }
        }
        // Layar penuh, bukan sheet: bagan butuh setiap piksel yang ada, dan sheet yang bisa ditarik
        // turun berebut gerakan geser dengan kanvasnya.
        .fullScreenCover(isPresented: $showChart) {
            ApprovalChartView(members: members, workspaceId: workspaceId ?? "") { await load() }
        }
    }

    /// Baris ringkas: siapa, perannya, dan keadaan yang perlu dilihat sekilas. Semua pengaturan
    /// ada di layar detail — ketuk barisnya.
    private func row(_ m: WorkspaceRoster.Member) -> some View {
        Button {
            if let uid = m.userId { openUser = uid }
        } label: {
            HStack(spacing: 12) {
                AvatarView(url: m.avatarURL, initial: m.initial, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(m.displayName).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    if let e = m.emailText, !e.isEmpty { Text(e).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1) }
                    // Hanya digambar saat MENYALA: 46 dari 49 orang tidak memakai keduanya, dan
                    // lencana "mati" di tiap baris membuat yang menyala berhenti terlihat.
                    if (m.flexiTimeEnabled ?? false) || (m.noGeofenceMode ?? false) || (m.googleWorkspaceEmail?.isEmpty == false) {
                        HStack(spacing: 6) {
                            if m.flexiTimeEnabled ?? false {
                                Label(T("Flexi"), systemImage: "bolt.fill").font(NXFont.text(10, .semibold)).foregroundStyle(NX.warning)
                            }
                            if m.noGeofenceMode ?? false {
                                Label(T("Mobile"), systemImage: "iphone").font(NXFont.text(10, .semibold)).foregroundStyle(NX.violetText)
                            }
                            if let g = m.googleWorkspaceEmail, !g.isEmpty {
                                Image(systemName: "at").font(.system(size: 10, weight: .bold)).foregroundStyle(NX.violetText)
                            }
                        }
                    }
                    // Rantai bebas: siapa pun bisa punya atasan. Peringatan "belum ditaruh" hanya
                    // untuk Staff/Manager — BoD tanpa atasan memang puncak.
                    if let a = m.approver?.name, !a.isEmpty {
                        Text("\(T("Approver")): \(a)").font(NXFont.text(10)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    } else if m.role == "STAFF" || m.role == "MANAGER" {
                        Text(T("Not placed on the Approval Chart")).font(NXFont.text(10, .semibold)).foregroundStyle(NX.warning)
                    }
                    if let uid = m.userId {
                        Text(membershipSummary(memberships[uid])).font(NXFont.text(10, .semibold)).foregroundStyle(NX.mutedFg)
                    }
                }
                Spacer(minLength: 6)
                RoleChip(role: m.role ?? "STAFF")
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg)
            }
            .padding(.horizontal, 14).padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(m.userId == nil)
    }

    private func toggle(_ r: String) { filter = (filter == r) ? "ALL" : r }

    /// Masukkan akun terdaftar ke workspace ini sebagai Staff. Server mencari user-nya lewat
    /// email dan membuat keanggotaannya — tidak membuat akun baru.
    private func join(_ r: WorkspaceRoster.Registered, _ wsId: String) async {
        joining.insert(r.id)
        defer { joining.remove(r.id) }
        try? await APIClient.shared.inviteWorkspaceMember(email: r.email, role: "STAFF", workspaceId: wsId, absorbPersonalWorkspace: true)
        await load()
    }
    private func load() async {
        do { roster = try await APIClient.shared.roster(includeRegistered: true) } catch APIError.unauthorized { auth.logout() } catch {}
        // Gagal diam-diam DI SINI memang yang diinginkan: keanggotaan adalah keterangan tambahan,
        // dan Control Room yang menolak terbuka karena satu panggilan tambahan gagal jauh lebih
        // buruk daripada baris tanpa dropdown.
        if let r = try? await APIClient.shared.adminUserMemberships() { memberships = r.byUser }
        if let t = try? await APIClient.shared.teams() { allTeams = t }
        if let p = try? await APIClient.shared.projects() { allProjects = p }
        loading = false
    }
}

// MARK: - Audit
// AdminAuditSection lives in AdminAuditViews.swift.

// MARK: - Quests admin

struct AdminQuestsSection: View {
    let workspaceId: String?
    @State private var quests: [AdminQuest] = []
    @State private var loading = true
    @State private var showCreate = false

    var body: some View {
        Group {
            if loading { ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity) }
            else {
                ScrollView {
                    VStack(spacing: 12) {
                        Button { showCreate = true } label: {
                            Label("Assign quest baru", systemImage: "plus").font(NXFont.text(13, .bold)).foregroundStyle(.white)
                                .frame(maxWidth: .infinity).padding(.vertical, 11).background(NX.violet, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }.buttonStyle(.plain).disabled(workspaceId == nil)
                        if quests.isEmpty { TabEmpty(icon: "trophy", text: T("No quests yet. Create one above.")) }
                        else { ForEach(quests) { questRow($0) } }
                    }.padding(16)
                }
            }
        }
        .task(id: workspaceId) { await load() }
        .sheet(isPresented: $showCreate) { if let w = workspaceId { CreateQuestSheet(workspaceId: w) { await load() } } }
    }
    private func questRow(_ q: AdminQuest) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "trophy.fill").foregroundStyle(NX.warning)
            VStack(alignment: .leading, spacing: 2) {
                Text(q.title).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                HStack(spacing: 6) {
                    Text("target \(q.requiredCount ?? 0)").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    Text("+\(q.xpReward ?? 0) XP").font(NXFont.text(11, .bold)).foregroundStyle(NX.success)
                    if let d = q.deadline, let dt = ProjDate.parse(d) { Text("· s/d \(ProjDate.dayLabel(dt))").font(NXFont.text(11)).foregroundStyle(NX.mutedFg) }
                }
            }
            Spacer()
            Button { Task { try? await APIClient.shared.deleteAdminQuest(q.id); await load() } } label: {
                Image(systemName: "trash").font(.system(size: 14)).foregroundStyle(NX.danger)
            }.buttonStyle(.plain)
        }.nexusCard(padding: 12)
    }
    private func load() async {
        guard let w = workspaceId else { loading = false; return }
        quests = (try? await APIClient.shared.adminQuests(workspaceId: w)) ?? []; loading = false
    }
}

struct CreateQuestSheet: View {
    let workspaceId: String
    let onCreated: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var reqType = "task_count"
    @State private var count = "5"
    @State private var xp = "50"
    @State private var hasDeadline = false
    @State private var deadline = Date()
    @State private var busy = false
    @State private var err: String?

    private let types: [(String, String)] = [("task_count", T("Complete N tasks")), ("overdue_cleared", "Clear N overdue"), ("priority_done", "Complete N Urgent"), ("has_overdue", T("Has ≥N overdue (penalty)"))]

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        f(T("TITLE")) { TextField(T("e.g. Finish 5 tasks this week"), text: $title).font(NXFont.text(15)).padding(12).background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border)) }
                        f("JENIS") {
                            Menu {
                                ForEach(types, id: \.0) { t in Button(t.1) { reqType = t.0 } }
                            } label: {
                                HStack { Text(types.first { $0.0 == reqType }?.1 ?? reqType).font(NXFont.text(15)).foregroundStyle(NX.foreground); Spacer(); Image(systemName: "chevron.up.chevron.down").font(.system(size: 11)).foregroundStyle(NX.mutedFg) }
                                    .padding(12).background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                            }
                        }
                        HStack(spacing: 12) {
                            f("TARGET") { TextField("5", text: $count).keyboardType(.numberPad).font(NXFont.text(15)).padding(12).background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border)) }
                            f("XP (maks 50)") { TextField("50", text: $xp).keyboardType(.numberPad).font(NXFont.text(15)).padding(12).background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border)) }
                        }
                        f("DEADLINE") {
                            Toggle(isOn: $hasDeadline.animation()) { Text("Pakai deadline").font(NXFont.text(14)).foregroundStyle(NX.foreground) }.tint(NX.violetText)
                            if hasDeadline { DatePicker("", selection: $deadline, displayedComponents: .date).datePickerStyle(.compact).labelsHidden().tint(NX.violetText) }
                        }
                        if let err { Text(err).font(NXFont.text(12)).foregroundStyle(NX.danger) }
                        Button { Task { await create() } } label: { HStack(spacing: 8) { if busy { ProgressView().tint(.white) }; Text("Assign quest") } }
                            .buttonStyle(NexusPrimaryButton()).disabled(busy || title.trimmingCharacters(in: .whitespaces).isEmpty)
                    }.padding(20)
                }
            }
            .navigationTitle("Quest baru").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() } } }
        }
    }
    private func f<C: View>(_ l: String, @ViewBuilder _ c: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) { SectionLabel(l); c() }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func create() async {
        busy = true; defer { busy = false }
        let dl: String? = hasDeadline ? { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = ProjDate.cal.timeZone; return f.string(from: deadline) }() : nil
        do {
            _ = try await APIClient.shared.createAdminQuest(workspaceId: workspaceId, title: title.trimmingCharacters(in: .whitespaces), requirementType: reqType, requiredCount: Int(count) ?? 5, xpReward: min(50, max(0, Int(xp) ?? 0)), deadline: dl)
            await onCreated(); dismiss()
        } catch { err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't create the quest.") }
    }
}

// MARK: - Announcements admin

struct AdminAnnouncementsSection: View {
    @State private var rows: [AdminAnnouncement] = []
    @State private var loading = true
    @State private var showCreate = false

    var body: some View {
        Group {
            if loading { ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity) }
            else {
                ScrollView {
                    VStack(spacing: 12) {
                        Button { showCreate = true } label: {
                            Label("Pengumuman baru", systemImage: "megaphone.fill").font(NXFont.text(13, .bold)).foregroundStyle(.white)
                                .frame(maxWidth: .infinity).padding(.vertical, 11).background(NX.violet, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }.buttonStyle(.plain)
                        if rows.isEmpty { TabEmpty(icon: "megaphone", text: T("No announcements yet.")) }
                        else { ForEach(rows) { announcementRow($0) } }
                    }.padding(16)
                }
            }
        }
        .task { await load() }
        .sheet(isPresented: $showCreate) { CreateAnnouncementSheet { await load() } }
    }
    private func announcementRow(_ a: AdminAnnouncement) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(a.title).font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                NexusChip(text: (a.active ?? false) ? T("Active") : T("Inactive"), tone: (a.active ?? false) ? .success : .neutral)
                Spacer()
                Button { Task { try? await APIClient.shared.deleteAnnouncement(a.id); await load() } } label: { Image(systemName: "trash").font(.system(size: 13)).foregroundStyle(NX.danger) }.buttonStyle(.plain)
            }
            if let b = a.body, !b.isEmpty { Text(b).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(3) }
            HStack {
                Text("\(T("read by")) \(a.seenCount ?? 0) \(T("people"))").font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
                Spacer()
                Button { Task { try? await APIClient.shared.updateAnnouncementActive(id: a.id, active: !(a.active ?? false)); await load() } } label: {
                    Text((a.active ?? false) ? T("Deactivate") : T("Activate")).font(NXFont.text(12, .bold)).foregroundStyle(NX.violetText)
                }.buttonStyle(.plain)
            }
        }.nexusCard(padding: 12)
    }
    private func load() async { rows = (try? await APIClient.shared.announcements()) ?? []; loading = false }
}

struct CreateAnnouncementSheet: View {
    let onCreated: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var body_ = ""
    @State private var tone = "info"
    @State private var busy = false
    @State private var problem: String?
    /// 0 = posted once, which is what every announcement did before repeats existed.
    @State private var repeatDays = 0
    @State private var repeatAt = Self.defaultTime
    private let tones: [(String, String)] = [("info", "Info"), ("success", "Success"), ("warning", "Warning")]
    private let repeatChoices: [Int] = [0, 2, 3, 5, 7]
    /// 09:00 today, in the device's own zone. Only the hour and minute are ever sent.
    private static var defaultTime: Date {
        Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Date()) ?? Date()
    }
    private var repeatAtHHmm: String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: repeatAt)
        return String(format: "%02d:%02d", c.hour ?? 9, c.minute ?? 0)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        f(T("TITLE")) { TextField(T("Announcement title"), text: $title).font(NXFont.text(15)).padding(12).background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border)) }
                        f(T("BODY")) { TextField(T("Announcement body…"), text: $body_, axis: .vertical).font(NXFont.text(15)).lineLimit(3...8).padding(12).background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border)) }
                        f("TONE") {
                            HStack(spacing: 8) {
                                ForEach(tones, id: \.0) { t in
                                    Button { tone = t.0 } label: {
                                        Text(t.1).font(NXFont.text(13, .semibold)).padding(.horizontal, 14).padding(.vertical, 8)
                                            .foregroundStyle(tone == t.0 ? .white : NX.mutedFg).background(tone == t.0 ? NX.violet : NX.card, in: Capsule()).overlay(Capsule().strokeBorder(tone == t.0 ? .clear : NX.border))
                                    }.buttonStyle(.plain)
                                }
                            }
                        }
                        // Repeat. A notice posted once reaches whoever happened to open NEXUS that
                        // hour; "wear your ID card this week" has to be said on each of those days,
                        // and re-typing it every morning is how it stops being said at all.
                        f(T("REPEAT")) {
                            VStack(alignment: .leading, spacing: 10) {
                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: 8) {
                                        ForEach(repeatChoices, id: \.self) { d in
                                            Button { repeatDays = d } label: {
                                                Text(d == 0 ? T("Once") : "+\(d) \(T("days"))")
                                                    .font(NXFont.text(13, .semibold))
                                                    .padding(.horizontal, 14).padding(.vertical, 8)
                                                    .foregroundStyle(repeatDays == d ? .white : NX.mutedFg)
                                                    .background(repeatDays == d ? NX.violet : NX.card, in: Capsule())
                                                    .overlay(Capsule().strokeBorder(repeatDays == d ? .clear : NX.border))
                                            }.buttonStyle(.plain)
                                        }
                                    }
                                }
                                if repeatDays > 0 {
                                    DatePicker(T("Time (WIB)"), selection: $repeatAt, displayedComponents: .hourAndMinute)
                                        .font(NXFont.text(13))
                                    Text(T("Goes out now, then again each day at that hour — pop-up and push. It reappears for everyone, including people who already dismissed it."))
                                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }
                        // Title AND body are required — the server refuses without both ("title &
                        // body required"), so the button says why it is off instead of just being off.
                        let missing: String? = title.trimmingCharacters(in: .whitespaces).isEmpty
                            ? T("Add a title to post.")
                            : body_.trimmingCharacters(in: .whitespaces).isEmpty ? T("Add the announcement body to post.") : nil
                        Button { Task { await create() } } label: { HStack(spacing: 8) { if busy { ProgressView().tint(.white) }; Text(busy ? T("Posting…") : T("Post")) } }
                            .buttonStyle(NexusPrimaryButton()).disabled(busy || missing != nil)
                        if let missing {
                            Text(missing).font(NXFont.text(11, .semibold)).foregroundStyle(NX.warning)
                                .frame(maxWidth: .infinity, alignment: .center)
                        }
                        if let problem {
                            Text(problem).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                                .frame(maxWidth: .infinity, alignment: .center)
                        }
                    }.padding(20)
                }
            }
            .navigationTitle("Pengumuman baru").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() } } }
        }
    }
    private func f<C: View>(_ l: String, @ViewBuilder _ c: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) { SectionLabel(l); c() }
    }
    private func create() async {
        busy = true; defer { busy = false }
        problem = nil
        do {
            _ = try await APIClient.shared.createAnnouncement(
                title: title.trimmingCharacters(in: .whitespaces),
                body: body_.trimmingCharacters(in: .whitespaces),
                tone: tone, repeatDays: repeatDays, repeatAtTime: repeatAtHHmm)
        } catch {
            // Swallowed before: a refused post closed the sheet as if it had worked.
            problem = (error as? LocalizedError)?.errorDescription ?? T("Couldn't post.")
            return
        }
        await onCreated(); dismiss()
    }
}

// MARK: - GIDEON usage

/// Who uses GIDEON, and how much.
///
/// Counts and dates only. What somebody asked an assistant is between them and it — a screen showing
/// the questions would change how people use it, and the ones who most need the help would stop
/// asking.
struct AdminGideonUsageSection: View {
    @State private var data: GideonUsage?
    @State private var loading = true
    @State private var error: String?

    private var rows: [GideonUsage.Row] { data?.users ?? [] }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if loading && data == nil {
                    ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.top, 40)
                } else if let error {
                    Text(error).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                } else {
                    if let t = data?.totals {
                        HStack(spacing: 10) {
                            stat(T("People"), t.people ?? 0)
                            stat(T("Questions"), t.asked ?? 0)
                            stat(T("Tools used"), t.toolCalls ?? 0)
                        }
                    }
                    if rows.isEmpty {
                        TabEmpty(icon: "sparkles", text: T("Nobody has used GIDEON yet."))
                    } else {
                        VStack(spacing: 0) {
                            ForEach(rows, id: \.id) { row in
                                personRow(row)
                                if row.id != rows.last?.id { Divider().overlay(NX.border) }
                            }
                        }
                        .nexusCard(padding: 0)
                    }
                }
            }
            .padding(16)
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func stat(_ label: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(value)").font(NXFont.display(20, .black)).foregroundStyle(NX.foreground)
            Text(label).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(NX.border))
    }

    private func personRow(_ row: GideonUsage.Row) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text(row.name ?? row.email ?? "—").font(NXFont.text(14)).foregroundStyle(NX.foreground).lineLimit(1)
                Text(shortDate(row.lastUsed).map { T("Last used") + " " + $0 } ?? T("Never"))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 1) {
                Text("\(row.asked ?? 0)").font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground)
                Text(T("questions")).font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
    }

    private func shortDate(_ iso: String?) -> String? {
        guard let iso else { return nil }
        let p = ISO8601DateFormatter(); p.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = p.date(from: iso) ?? { let q = ISO8601DateFormatter(); q.formatOptions = [.withInternetDateTime]; return q.date(from: iso) }() else { return nil }
        return d.formatted(date: .abbreviated, time: .omitted)
    }

    private func load() async {
        error = nil
        do { data = try await APIClient.shared.gideonUsage() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load.") }
        loading = false
    }
}

// MARK: - who has the app

/// Who has the app, and which build they are on.
///
/// One row per person, their most recently seen device. "Belum dilaporkan" is honest: the version
/// columns are newer than most installs, so anyone who has not opened a build that reports them has
/// no answer, and a guess would be worse than a blank.
struct AdminAppInstallsSection: View {
    @State private var data: AppInstalls?
    @State private var loading = true
    @State private var error: String?

    private var rows: [AppInstalls.Row] { data?.installs ?? [] }
    private var missing: [AppInstalls.Missing] { data?.notInstalled ?? [] }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if loading && data == nil {
                    ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.top, 40)
                } else if let error {
                    Text(error).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                } else {
                    if let t = data?.totals {
                        HStack(spacing: 10) {
                            stat(T("Using the app"), t.people ?? 0)
                            stat(T("Not using it"), t.notInstalled ?? missing.count)
                            stat(T("Devices"), t.devices ?? 0)
                        }
                    }
                    if rows.isEmpty {
                        TabEmpty(icon: "iphone", text: T("Nobody has installed the app yet."))
                    } else {
                        VStack(spacing: 0) {
                            ForEach(rows, id: \.id) { row in
                                personRow(row)
                                if row.id != rows.last?.id { Divider().overlay(NX.border) }
                            }
                        }
                        .nexusCard(padding: 0)
                    }
                    // The people with no phone registered at all. A list of devices cannot show an
                    // absence, and these are exactly the ones a BoD needs to chase.
                    if !missing.isEmpty {
                        Text(String(format: T("NOT USING THE APP · %d"), missing.count))
                            .font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
                            .padding(.top, 6)
                        VStack(spacing: 0) {
                            ForEach(missing, id: \.id) { m in
                                missingRow(m)
                                if m.id != missing.last?.id { Divider().overlay(NX.border) }
                            }
                        }
                        .nexusCard(padding: 0)
                    }
                }
            }
            .padding(16)
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func stat(_ label: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(value)").font(NXFont.display(20, .black)).foregroundStyle(NX.foreground)
            Text(label).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(NX.border))
    }

    private func personRow(_ row: AppInstalls.Row) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text(row.user?.name ?? row.user?.email ?? "—")
                    .font(NXFont.text(14)).foregroundStyle(NX.foreground).lineLimit(1)
                Text(row.osVersion ?? "—").font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            Spacer(minLength: 8)
            if row.appVersion == nil {
                Text(T("Not reported")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            } else {
                NexusChip(text: row.versionLabel, tone: .accent)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
    }

    private func missingRow(_ m: AppInstalls.Missing) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text(m.name ?? m.email ?? "—").font(NXFont.text(14)).foregroundStyle(NX.foreground).lineLimit(1)
                if let email = m.email { Text(email).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1) }
            }
            Spacer(minLength: 8)
            Text(Self.activity(m.lastActiveAt)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                .multilineTextAlignment(.trailing)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
    }

    /// "Web only · 24 Sep" when they sign in somewhere, "Never signed in" when they never have —
    /// the two need different follow-ups.
    private static func activity(_ iso: String?) -> String {
        guard let iso, let d = ProjDate.parse(iso) else { return T("Never signed in") }
        return String(format: T("Web only · %@"), dayFormatter.string(from: d))
    }
    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "d MMM"; f.timeZone = TimeZone(identifier: "Asia/Jakarta"); return f
    }()

    private func load() async {
        error = nil
        do { data = try await APIClient.shared.appInstalls() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load.") }
        loading = false
    }
}


/// Siapa yang sedang ditautkan. Tipe sendiri, bukan `WorkspaceRoster.Member`, karena `id` di sana
/// opsional dan dua anggota tanpa id akan bertabrakan sebagai item sheet.
struct GoogleLinkTarget: Identifiable, Hashable {
    let id: String
    let userId: String
    let name: String
    let current: String?
}

/// Memilih akun Google Workspace untuk satu orang.
///
/// Memilih, bukan mengetik. Alamat yang diketik tangan akan salah ketik suatu hari, dan alamat
/// yang salah terlihat persis sama dengan yang benar sampai ada yang mencoba mengirim surat.
/// Server tetap memverifikasi ulang; daftar ini hanya menghapus kesempatannya.
///
/// Bisa juga MEMBUAT mailbox baru. Itu mengisi satu seat lisensi berbayar dan mengembalikan sandi
/// sementara yang hanya muncul sekali — jadi jalurnya dibuat berbeda dari sekadar menautkan:
/// sebuah formulir terpisah, dan panel sandi yang menutupi layar sampai ditutup dengan sengaja.
/// Menutupnya membuang sandinya untuk selamanya; server tidak menyimpannya.
struct GoogleLinkSheet: View {
    let target: GoogleLinkTarget
    var onDone: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var data: GoogleWorkspaceAccounts?
    @State private var loading = true
    @State private var busy = false
    @State private var problem: String?
    @State private var query = ""
    @State private var making = false
    @State private var made: CreatedGoogleAccount?
    @State private var givenName = ""
    @State private var familyName = ""
    @State private var localPart = ""
    @State private var domain = ""

    private var rows: [GoogleWorkspaceAccount] {
        let all = data?.accounts ?? []
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return all }
        return all.filter { $0.email.lowercased().contains(q) || $0.fullName.lowercased().contains(q) }
    }

    var body: some View {
        Group {
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if data?.configured == false {
                empty("link.badge.plus", T("Google Workspace belum disambungkan"),
                      data?.error ?? T("Hubungi BoD untuk menyambungkannya."))
            } else if let made {
                madePanel(made)
            } else if making {
                makeForm
            } else {
                List {
                    Section {
                        Button { startMaking() } label: {
                            Label(T("Create a company mailbox"), systemImage: "plus.circle")
                                .font(NXFont.text(14, .semibold))
                        }
                        .disabled(busy)
                    } footer: {
                        Text(T("Mengisi satu seat lisensi Workspace."))
                            .font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
                    }
                    if let current = target.current {
                        Section {
                            Button(role: .destructive) { Task { await link(nil) } } label: {
                                Label("\(T("Lepas tautan")) — \(current)", systemImage: "link.badge.plus")
                            }
                            .disabled(busy)
                        }
                    }
                    Section(T("Akun di Workspace")) {
                        ForEach(rows) { a in
                            // Yang sudah dipakai orang LAIN tidak bisa dipilih, dan menyebut
                            // pemakainya. Indeks unik di server menolaknya juga, tapi ditolak
                            // setelah memilih terbaca seperti kesalahan pemakai.
                            let takenByOther = a.linkedTo != nil && a.linkedTo?.id != target.userId
                            Button { Task { await link(a.email) } } label: {
                                HStack(spacing: 10) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(a.email).font(NXFont.text(14, .semibold))
                                            .foregroundStyle(takenByOther ? NX.mutedFg : NX.foreground)
                                        HStack(spacing: 6) {
                                            if !a.fullName.isEmpty {
                                                Text(a.fullName).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                                            }
                                            if a.suspended {
                                                Text(T("suspended")).font(NXFont.text(10)).foregroundStyle(NX.warning)
                                            }
                                            if let owner = a.linkedTo, takenByOther {
                                                Text("\(T("dipakai")) \(owner.name)").font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
                                            }
                                        }
                                    }
                                    Spacer(minLength: 4)
                                    if a.email == target.current {
                                        Image(systemName: "checkmark").foregroundStyle(NX.success)
                                    }
                                }
                            }
                            .disabled(busy || takenByOther)
                        }
                    }
                    if let problem {
                        Section { Text(problem).font(NXFont.text(12)).foregroundStyle(NX.danger) }
                    }
                }
                .searchable(text: $query, prompt: T("Search accounts…"))
            }
        }
        .navigationTitle(target.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // Tidak ada tombol Close selagi sandi sementara masih di layar: satu ketukan refleks
            // di sana menghapus satu-satunya salinan yang pernah ada.
            if made == nil {
                ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } }
            }
            if busy && made == nil { ToolbarItem(placement: .topBarTrailing) { ProgressView() } }
        }
        .interactiveDismissDisabled(made != nil)
        .task { await load() }
    }

    /// Tebakan awal dari nama NEXUS orang itu. Ditebak, bukan dipaksakan: setiap kotak masih bisa
    /// disunting, karena "Muhammad Omar Karim" bisa jadi omar@ atau omar.karim@ tergantung orangnya.
    private func startMaking() {
        let parts = target.name.split(whereSeparator: \.isWhitespace).map(String.init)
        givenName = parts.first ?? ""
        // Google MEWAJIBKAN nama belakang. "-" adalah yang dipakai web untuk nama tunggal.
        familyName = parts.count > 1 ? parts.dropFirst().joined(separator: " ") : "-"
        localPart = (parts.first ?? "").lowercased().filter { $0.isLetter || $0.isNumber || $0 == "." || $0 == "_" || $0 == "-" }
        domain = data?.domains?.first ?? ""
        problem = nil
        making = true
    }

    private var canSubmit: Bool {
        !busy && !localPart.trimmingCharacters(in: .whitespaces).isEmpty
            && !domain.isEmpty && !givenName.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private var makeForm: some View {
        Form {
            Section(T("Name in Google")) {
                TextField(T("First name"), text: $givenName).textInputAutocapitalization(.words)
                TextField(T("Last name"), text: $familyName).textInputAutocapitalization(.words)
            }
            Section {
                HStack(spacing: 4) {
                    TextField("nama.alamat", text: $localPart)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Text("@").foregroundStyle(NX.mutedFg)
                    Menu {
                        ForEach(data?.domains ?? [], id: \.self) { d in
                            Button(d) { domain = d }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Text(domain.isEmpty ? T("pilih") : domain).font(NXFont.text(13, .semibold))
                            Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold))
                        }
                        .foregroundStyle(NX.violetText)
                    }
                }
            } header: {
                Text(T("Alamat"))
            } footer: {
                Text(T("Akun baru mengisi satu seat lisensi Workspace. Sandi sementaranya cuma bisa dilihat sekali."))
                    .font(NXFont.text(10))
            }
            if let problem {
                Section { Text(problem).font(NXFont.text(12)).foregroundStyle(NX.danger) }
            }
            Section {
                Button { Task { await create() } } label: {
                    HStack {
                        Text(busy ? T("Membuat…") : T("Buat akun")).font(NXFont.text(14, .semibold))
                        Spacer()
                        if busy { ProgressView() }
                    }
                }
                .disabled(!canSubmit)
                Button(T("Cancel"), role: .cancel) { making = false; problem = nil }
            }
        }
    }

    /// Satu-satunya kesempatan melihat sandinya. Tidak ada tombol tutup di toolbar selagi panel ini
    /// terbuka — hanya "Sudah disalin", supaya tidak ada yang kehilangan sandinya karena refleks.
    private func madePanel(_ r: CreatedGoogleAccount) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Label("\(r.account.email) \(T("dibuat"))", systemImage: "checkmark.seal.fill")
                    .font(NXFont.display(15, .bold)).foregroundStyle(NX.success)
                Text(T("Sandi sementara — salin sekarang, tidak bisa dilihat lagi:"))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                HStack {
                    Text(r.account.temporaryPassword)
                        .font(.system(size: 15, weight: .semibold, design: .monospaced))
                        .textSelection(.enabled)
                        .foregroundStyle(NX.foreground)
                    Spacer(minLength: 8)
                    Button {
                        UIPasteboard.general.string = r.account.temporaryPassword
                    } label: { Image(systemName: "doc.on.doc").foregroundStyle(NX.violetText) }
                    .buttonStyle(.plain)
                }
                .padding(12)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))

                Text(T("Dia wajib menggantinya saat login pertama."))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)

                if r.notified?.email == true {
                    Text("\(T("Sandi sudah dikirim ke")) \(r.notified?.emailTo ?? "-"). \(T("Kamu tidak perlu meneruskannya."))")
                        .font(NXFont.text(11)).foregroundStyle(NX.success)
                } else {
                    // Kegagalan email harus terlihat SEKARANG, selagi sandinya masih di layar.
                    // Ditemukan nanti lewat orang yang bingung berarti sandinya sudah hilang.
                    Text(T("Email GAGAL terkirim — sampaikan sandi ini sendiri, dan jangan lewat chat grup."))
                        .font(NXFont.text(11, .semibold)).foregroundStyle(NX.danger)
                }
                if r.linked == false {
                    Text(r.error ?? T("Akunnya dibuat tapi belum tertaut ke profil ini."))
                        .font(NXFont.text(11)).foregroundStyle(NX.warning)
                }

                Button(T("Sudah disalin")) {
                    made = nil
                    making = false
                    onDone()
                    dismiss()
                }
                .buttonStyle(NexusPrimaryButton(fullWidth: true))
                .padding(.top, 4)
            }
            .padding(18)
        }
    }

    private func create() async {
        busy = true
        defer { busy = false }
        problem = nil
        do {
            made = try await APIClient.shared.createGoogleWorkspaceAccount(
                userId: target.userId,
                localPart: localPart.trimmingCharacters(in: .whitespaces),
                domain: domain,
                givenName: givenName.trimmingCharacters(in: .whitespaces),
                familyName: familyName.trimmingCharacters(in: .whitespaces))
        } catch {
            // Pesan server dibawa apa adanya: "alamat sudah dipakai" dan "domain tidak dikenal"
            // adalah dua hal berbeda, dan menggantinya dengan "gagal" membuang petunjuknya.
            problem = (error as? LocalizedError)?.errorDescription ?? T("Gagal membuat akun.")
        }
    }

    private func empty(_ icon: String, _ title: String, _ msg: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 38)).foregroundStyle(NX.mutedFg)
            Text(title).font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground)
            Text(msg).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity).padding(28)
    }

    private func load() async {
        do { data = try await APIClient.shared.googleWorkspaceAccounts() }
        catch { problem = (error as? LocalizedError)?.errorDescription ?? T("Gagal memuat daftar akun.") }
        loading = false
    }

    private func link(_ email: String?) async {
        busy = true
        defer { busy = false }
        problem = nil
        do {
            try await APIClient.shared.linkGoogleWorkspace(userId: target.userId, email: email)
            onDone()
            dismiss()
        } catch {
            // Pesan server dibawa apa adanya: "sudah ditautkan ke X" dan "tidak ada di Google"
            // adalah dua hal berbeda, dan menggantinya dengan "gagal" membuang petunjuknya.
            problem = (error as? LocalizedError)?.errorDescription ?? T("Gagal menautkan.")
        }
    }
}

/// "3 projects · 2 teams" — atau "0 projects" kalau memang belum masuk ke mana pun.
private func membershipSummary(_ mem: UserMemberships?) -> String {
    let p = mem?.projects.count ?? 0
    let t = mem?.teams.count ?? 0
    let projectPart = "\(p) project" + (p == 1 ? "" : "s")
    guard t > 0 else { return projectPart }
    return projectPart + " · \(t) team" + (t == 1 ? "" : "s")
}

struct NXChipData: Identifiable, Hashable { let id: String; let text: String; let color: Color }

/// Chip yang membungkus ke baris berikutnya, memakai FlowLayout yang sudah ada di
/// CustomFieldChips.swift. `LazyVGrid` tidak bisa dipakai di sini: lebarnya
/// ditentukan teks tiap chip, bukan jumlah kolom tetap, dan grid kolom-tetap membuat "BD AGENZ"
/// dan "FINANCE MANAGEMENT" menempati ruang yang sama lalu salah satunya terpotong.
struct NXFlow: View {
    let items: [NXChipData]
    init(_ items: [NXChipData]) { self.items = items }

    var body: some View {
        FlowLayout(spacing: 6) {
            ForEach(items) { it in
                HStack(spacing: 5) {
                    Circle().fill(it.color).frame(width: 6, height: 6)
                    Text(it.text).font(NXFont.text(11, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                }
                .padding(.horizontal, 8).padding(.vertical, 5)
                .background(NX.background, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
            }
        }
    }
}

struct TeamPickTarget: Identifiable, Hashable {
    let id: String
    let userId: String
    let name: String
    let already: Set<String>
}

struct TeamExitTarget: Identifiable, Hashable {
    let id: String
    let userId: String
    let userName: String
    let teamId: String
    let teamName: String
    let losing: [String]
}

/// Memilih tim untuk satu orang. Bisa dicari, karena workspace ini punya 21 tim dengan nama yang
/// mirip-mirip ("BOD AGENZ", "BD AGENZ") dan memilih dari daftar panjang tanpa pencarian adalah
/// cara paling gampang memasukkan orang ke tim yang salah.
struct TeamPickSheet: View {
    let target: TeamPickTarget
    let teams: [Team]
    var onPick: (String) -> Void
    /// Tim yang baru dibuat langsung diisi orangnya, lalu pengaturannya dibuka — tim baru selalu
    /// butuh divisi dan project, dan membuatnya lalu meninggalkannya kosong adalah cara tim hantu
    /// bermunculan.
    var onCreate: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var creating = false

    private var rows: [Team] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? teams : teams.filter { $0.name.lowercased().contains(q) }
    }

    /// Nama untuk tim baru, atau nil kalau yang diketik terlalu pendek atau sudah jadi nama tim.
    /// Dibandingkan ke SELURUH daftar yang lewat ke sini, bukan ke hasil saringan.
    private var newTeamName: String? {
        let n = query.trimmingCharacters(in: .whitespaces)
        guard n.count > 1, !teams.contains(where: { $0.name.lowercased() == n.lowercased() }) else { return nil }
        return n
    }

    var body: some View {
        Group {
            if teams.isEmpty && query.trimmingCharacters(in: .whitespaces).isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "person.3").font(.system(size: 36)).foregroundStyle(NX.mutedFg)
                    Text(T("Already in every team you can manage."))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity).padding(28)
            } else {
                List {
                    // Bikin tim baru dari sini, karena tidak ada halaman Teams lagi yang punya
                    // tombolnya. Hanya muncul kalau yang diketik belum jadi nama tim mana pun.
                    if let n = newTeamName {
                        Section {
                            Button {
                                creating = true
                                onCreate(n)
                            } label: {
                                Label("\(T("Create team")) \u{201C}\(n)\u{201D}", systemImage: creating ? "hourglass" : "plus.circle")
                                    .font(NXFont.text(14, .semibold))
                            }
                            .disabled(creating)
                        }
                    }
                    ForEach(rows) { t in
                        Button { onPick(t.id) } label: {
                            HStack(spacing: 8) {
                                Circle().fill(Color(hex: t.color ?? "#7B2FBE")).frame(width: 8, height: 8)
                                Text(t.name).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                                Spacer(minLength: 4)
                                if let n = t.members?.count {
                                    Text("\(n)").font(NXFont.text(11)).foregroundStyle(NX.mutedFg).monospacedDigit()
                                }
                            }
                        }
                    }
                }
                .searchable(text: $query, prompt: T("Search teams…"))
            }
        }
        .navigationTitle(target.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } } }
    }
}

// MARK: - Bagan Approval

struct ApproverPickTarget: Identifiable, Hashable {
    let id: String
    let memberId: String
    let workspaceId: String
    let name: String
    let current: String?
    /// userId orang yang sedang diatur — supaya dia tidak muncul sebagai calon atasannya sendiri.
    let selfUserId: String?
}

/// Memilih atasan untuk satu orang — rantai bebas, jadi kandidatnya semua orang di workspace kecuali
/// dirinya (dan server menolak lingkaran). Dikelompokkan per peran supaya "cari BoD-nya" tidak perlu
/// mengeja nama.
struct ApproverPickSheet: View {
    let target: ApproverPickTarget
    let candidates: [WorkspaceRoster.Member]
    var onPick: (String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var rows: [WorkspaceRoster.Member] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? candidates : candidates.filter { $0.displayName.lowercased().contains(q) }
    }
    private let roleOrder = ["ONE_ABOVE_ALL", "BOD", "MANAGER", "STAFF"]
    private func group(_ role: String) -> [WorkspaceRoster.Member] { rows.filter { ($0.role ?? "STAFF") == role } }

    var body: some View {
        List {
            Section {
                Text(T("Request absensinya akan masuk ke orang ini saja. BoD tetap bisa override."))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            ForEach(roleOrder, id: \.self) { role in
                let list = group(role)
                if !list.isEmpty {
                    Section(orgRoleLabel(role)) {
                        ForEach(list, id: \.idv) { m in
                            Button { onPick(m.userId) } label: {
                                HStack(spacing: 10) {
                                    AvatarView(url: m.avatarURL, initial: m.initial, size: 30)
                                    Text(m.displayName).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                                    Spacer(minLength: 4)
                                    if m.userId == target.current { Image(systemName: "checkmark").foregroundStyle(NX.success) }
                                }
                            }
                        }
                    }
                }
            }
            if rows.isEmpty {
                Section { Text(T("Nggak ada yang cocok.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
            }
            if target.current != nil {
                Section {
                    Button(role: .destructive) { onPick(nil) } label: {
                        Label(T("Lepas dari bagan — request-nya kembali ke BoD"), systemImage: "arrow.uturn.backward")
                    }
                }
            }
        }
        .searchable(text: $query, prompt: T("Search names…"))
        .navigationTitle(target.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } } }
    }
}

// MARK: - Edit akun (BoD)

struct AccountEditTarget: Identifiable, Hashable {
    let id: String
    let userId: String
    let memberId: String
    let name: String
    let email: String
    let avatar: String?
}

/// Foto, nama, email login, sandi orang lain — BoD saja. Sandi diketik sekali, terlihat, dikirim
/// sekali; sandi lama tidak diminta karena orangnya memang tidak ada di sini. Tiga tombol simpan
/// terpisah (identitas, sandi, foto) supaya salah satu gagal tidak membatalkan yang lain.
struct AccountEditSheet: View {
    let target: AccountEditTarget
    var onDone: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var email: String
    @State private var password = ""
    @State private var busy = false
    @State private var problem: String?
    @State private var notice: String?
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var avatarURL: String?

    init(target: AccountEditTarget, onDone: @escaping () -> Void) {
        self.target = target
        self.onDone = onDone
        _name = State(initialValue: target.name)
        _email = State(initialValue: target.email)
        _avatarURL = State(initialValue: target.avatar)
    }

    private var identityDirty: Bool {
        name.trimmingCharacters(in: .whitespaces) != target.name || email.trimmingCharacters(in: .whitespaces).lowercased() != target.email.lowercased()
    }

    var body: some View {
        Form {
            Section {
                HStack(spacing: 14) {
                    AvatarView(url: avatarURL, initial: String(name.first ?? "?").uppercased(), size: 56)
                    PhotosPicker(selection: $pickedPhoto, matching: .images, photoLibrary: .shared()) {
                        Label(T("Change photo"), systemImage: "photo").font(NXFont.text(13, .semibold))
                    }
                    .disabled(busy)
                }
            } header: { Text(T("Foto profil")) }

            Section {
                TextField(T("Name"), text: $name).textInputAutocapitalization(.words)
                TextField(T("Email login"), text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button { Task { await saveIdentity() } } label: {
                    HStack { Text(T("Save name & email")); Spacer(); if busy { ProgressView() } }
                }
                .disabled(!identityDirty || busy)
            } header: { Text(T("Identitas")) }

            Section {
                // Teks biasa, bukan SecureField: yang mengetik BoD, dan sandi yang tidak terlihat
                // adalah sandi yang salah ketik lalu disampaikan salah.
                TextField(T("Sandi baru (min. 8 karakter)"), text: $password)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .font(.system(.body, design: .monospaced))
                Button(role: .destructive) { Task { await savePassword() } } label: {
                    Text(T("Change password"))
                }
                .disabled(password.count < 8 || busy)
            } header: { Text(T("Sandi")) } footer: {
                Text(T("Sampaikan sandi barunya langsung ke orangnya, jangan lewat chat grup."))
            }

            if let notice { Section { Text(notice).font(NXFont.text(12)).foregroundStyle(NX.success) } }
            if let problem { Section { Text(problem).font(NXFont.text(12)).foregroundStyle(NX.danger) } }
        }
        .navigationTitle(target.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { onDone(); dismiss() } } }
        .onChange(of: pickedPhoto) { _, item in
            if let item { Task { await uploadPhoto(item) } }
        }
    }

    private func run(_ work: () async throws -> Void, done: String) async {
        busy = true
        problem = nil; notice = nil
        defer { busy = false }
        do { try await work(); notice = done }
        catch { problem = (error as? LocalizedError)?.errorDescription ?? T("Gagal.") }
    }

    private func saveIdentity() async {
        let n = name.trimmingCharacters(in: .whitespaces)
        let e = email.trimmingCharacters(in: .whitespaces).lowercased()
        await run({
            try await APIClient.shared.updateAdminAccount(
                userId: target.userId,
                name: n != target.name ? n : nil,
                email: e != target.email.lowercased() ? e : nil)
        }, done: T("Name & email saved."))
    }

    private func savePassword() async {
        let pw = password
        await run({ try await APIClient.shared.updateAdminAccount(userId: target.userId, password: pw) },
                  done: T("Sandi diganti."))
        if problem == nil { password = "" }
    }

    /// Sama dengan SettingsView.upload: diperkecil ke 1024px sisi terpanjang, JPEG 0.85.
    private func uploadPhoto(_ item: PhotosPickerItem) async {
        defer { pickedPhoto = nil }
        guard let raw = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: raw) else {
            problem = T("Couldn't read that photo."); return
        }
        let maxEdge: CGFloat = 1024
        let scale = min(1, maxEdge / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let resized = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        guard let jpeg = resized.jpegData(compressionQuality: 0.85) else { problem = T("Couldn't read that photo."); return }
        await run({
            try await APIClient.shared.uploadMemberAvatar(memberId: target.memberId, fileName: "avatar.jpg", mime: "image/jpeg", data: jpeg)
            // Tampilkan langsung dari data yang baru diunggah; URL server akan menggantikannya
            // saat daftar dimuat ulang sesudah sheet ditutup.
            avatarURL = nil
        }, done: T("Foto profil diganti."))
    }
}

// MARK: - Pemilih project

struct ProjectPickTarget: Identifiable, Hashable {
    let id: String
    let userId: String
    let name: String
    let already: Set<String>
}

/// Menambahkan orang ke project secara LANGSUNG (source "direct"), tidak lewat tim. Bisa dicari.
struct ProjectPickSheet: View {
    let target: ProjectPickTarget
    let projects: [Project]
    var onPick: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var rows: [Project] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? projects : projects.filter { $0.name.lowercased().contains(q) }
    }

    var body: some View {
        List {
            ForEach(rows) { p in
                Button { onPick(p.id) } label: {
                    HStack(spacing: 8) {
                        Circle().fill(Color(hex: p.color ?? "#94A3B8")).frame(width: 8, height: 8)
                        Text(p.name).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                        Spacer(minLength: 4)
                    }
                }
            }
            if rows.isEmpty {
                Text(projects.isEmpty ? T("Sudah masuk semua project.") : T("Nggak ada yang cocok."))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
        }
        .searchable(text: $query, prompt: T("Search projects…"))
        .navigationTitle(target.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } } }
    }
}
