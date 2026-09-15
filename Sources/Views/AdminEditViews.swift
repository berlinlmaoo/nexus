import SwiftUI

// MARK: models

struct AuditLogsResponse: Decodable, Sendable { let logs: [AuditLog]? }
struct AuditLog: Decodable, Identifiable, Sendable {
    let id: String
    let action: String?
    let entityType: String?
    let entityName: String?
    let createdAt: String?
    let user: UserRef?
    struct UserRef: Decodable, Sendable { let name: String? }
}
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
    let totals: Totals?

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
    @State private var deleteTarget: WorkspaceRoster.Member?
    @State private var openProfile: ProfileTarget?
    @State private var linkTarget: GoogleLinkTarget?

    private var members: [WorkspaceRoster.Member] { roster?.members ?? [] }
    private var viewerRole: String? { roster?.role }
    private func count(_ r: String) -> Int { members.filter { $0.role == r }.count }
    private var rows: [WorkspaceRoster.Member] { filter == "ALL" ? members : members.filter { ($0.role ?? "STAFF") == filter } }

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
                        VStack(spacing: 0) {
                            ForEach(Array(rows.enumerated()), id: \.element.idv) { idx, m in
                                if idx > 0 { Divider().overlay(NX.border) }
                                row(m)
                            }
                        }
                        .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border)).nexusShadowSoft()
                    }.padding(16)
                }
            }
        }
        .task { await load() }
        .confirmationDialog("\(T("Delete account")) \"\(deleteTarget?.displayName ?? "")\"?", isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } }), titleVisibility: .visible) {
            Button(T("Delete permanently"), role: .destructive) { if let m = deleteTarget { deleteTarget = nil; Task { await deleteUser(m) } } }
            Button(T("Cancel"), role: .cancel) { deleteTarget = nil }
        } message: { Text(T("Their tasks/files/quests are reassigned to you. This cannot be undone.")) }
        .navigationDestination(item: $openProfile) { MemberProfileView(target: $0) }
        // Sheet, bukan Menu. Workspace ini punya 22 akun dan menu sepanjang itu di layar HP tidak
        // bisa dipakai — tidak bisa dicari, dan separuhnya di luar layar.
        .sheet(item: $linkTarget) { t in
            NavigationStack { GoogleLinkSheet(target: t) { linkTarget = nil; Task { await load() } } }
        }
    }

    private func row(_ m: WorkspaceRoster.Member) -> some View {
        HStack(spacing: 12) {
            // Same split as the Tuning Room roster: the name opens the person, the role chip keeps
            // its menu, and neither swallows the other's tap.
            Button {
                if let uid = m.userId {
                    openProfile = ProfileTarget(userId: uid, name: m.displayName, avatar: m.avatarURL)
                }
            } label: {
                HStack(spacing: 12) {
                    AvatarView(url: m.avatarURL, initial: m.initial, size: 38)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(m.displayName).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                        if let e = m.emailText, !e.isEmpty { Text(e).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1) }
                        // Tenang, bukan menonjol: sebagian besar orang memang belum punya, dan
                        // ketiadaannya bukan sesuatu yang perlu diteriakkan di tiap baris.
                        if let g = m.googleWorkspaceEmail, !g.isEmpty {
                            Label(g, systemImage: "at")
                                .font(NXFont.text(10))
                                .foregroundStyle(NX.violetText)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 6)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(m.userId == nil)
            if canEditTier(viewerRole, m.role), let wsId = workspaceId {
                Menu {
                    ForEach(assignableRoles(viewerRole), id: \.self) { r in Button(orgRoleLabel(r)) { Task { await setRole(m, r, wsId) } } }
                    Divider()
                    if let uid = m.userId {
                        Button {
                            linkTarget = GoogleLinkTarget(id: uid, userId: uid, name: m.displayName, current: m.googleWorkspaceEmail)
                        } label: {
                            Label(m.googleWorkspaceEmail == nil ? T("Link Google account") : T("Change Google account"),
                                  systemImage: "at")
                        }
                    }
                    Divider()
                    Button(role: .destructive) { deleteTarget = m } label: { Label(T("Delete account"), systemImage: "trash") }
                } label: { RoleChip(role: m.role ?? "STAFF") }
            } else { RoleChip(role: m.role ?? "STAFF") }
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
    }

    private func toggle(_ r: String) { filter = (filter == r) ? "ALL" : r }
    private func load() async {
        do { roster = try await APIClient.shared.roster() } catch APIError.unauthorized { auth.logout() } catch {}
        loading = false
    }
    private func setRole(_ m: WorkspaceRoster.Member, _ role: String, _ wsId: String) async {
        guard let id = m.id else { return }
        try? await APIClient.shared.updateWorkspaceMemberRole(memberId: id, role: role, workspaceId: wsId); await load()
    }
    private func deleteUser(_ m: WorkspaceRoster.Member) async {
        guard let uid = m.userId else { return }
        try? await APIClient.shared.deleteUser(uid); await load()
    }
}

// MARK: - Audit (read-only)

struct AdminAuditSection: View {
    @State private var logs: [AuditLog] = []
    @State private var loading = true
    var body: some View {
        Group {
            if loading { ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if logs.isEmpty { TabEmpty(icon: "scroll", text: T("No audit entries yet.")) }
            else {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(Array(logs.enumerated()), id: \.element.id) { idx, l in
                            if idx > 0 { Divider().overlay(NX.border) }
                            HStack(spacing: 10) {
                                Text(humanizeEnum(l.action ?? "").uppercased()).font(NXFont.text(9, .bold)).foregroundStyle(NX.mutedFg)
                                    .padding(.horizontal, 6).padding(.vertical, 3).background(NX.muted, in: Capsule())
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(l.entityName ?? l.entityType ?? "—").font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                                    Text(l.user?.name ?? "system").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                                }
                                Spacer()
                                Text(ProjDate.parse(l.createdAt).map { ProjDate.dayLabel($0) } ?? "").font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
                            }.padding(.horizontal, 14).padding(.vertical, 11)
                        }
                    }
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border)).padding(16)
                }
            }
        }
        .task { logs = (try? await APIClient.shared.auditLogs()) ?? []; loading = false }
    }
}

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
        try? await APIClient.shared.createAdminQuest(workspaceId: workspaceId, title: title.trimmingCharacters(in: .whitespaces), requirementType: reqType, requiredCount: Int(count) ?? 5, xpReward: min(50, max(0, Int(xp) ?? 0)), deadline: dl)
        await onCreated(); dismiss()
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
                NexusChip(text: (a.active ?? false) ? "Aktif" : "Nonaktif", tone: (a.active ?? false) ? .success : .neutral)
                Spacer()
                Button { Task { try? await APIClient.shared.deleteAnnouncement(a.id); await load() } } label: { Image(systemName: "trash").font(.system(size: 13)).foregroundStyle(NX.danger) }.buttonStyle(.plain)
            }
            if let b = a.body, !b.isEmpty { Text(b).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(3) }
            HStack {
                Text("dibaca \(a.seenCount ?? 0) orang").font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
                Spacer()
                Button { Task { try? await APIClient.shared.updateAnnouncementActive(id: a.id, active: !(a.active ?? false)); await load() } } label: {
                    Text((a.active ?? false) ? "Nonaktifin" : "Aktifin").font(NXFont.text(12, .bold)).foregroundStyle(NX.violetText)
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
                        Button { Task { await create() } } label: { HStack(spacing: 8) { if busy { ProgressView().tint(.white) }; Text("Posting") } }
                            .buttonStyle(NexusPrimaryButton()).disabled(busy || title.trimmingCharacters(in: .whitespaces).isEmpty || body_.trimmingCharacters(in: .whitespaces).isEmpty)
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
        try? await APIClient.shared.createAnnouncement(
            title: title.trimmingCharacters(in: .whitespaces),
            body: body_.trimmingCharacters(in: .whitespaces),
            tone: tone, repeatDays: repeatDays, repeatAtTime: repeatAtHHmm)
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
/// TIDAK bisa membuat akun baru di sini — itu mengisi seat lisensi berbayar dan menampilkan sandi
/// sementara yang hanya muncul sekali. Keduanya pekerjaan meja, dan ada di Control Room web.
struct GoogleLinkSheet: View {
    let target: GoogleLinkTarget
    var onDone: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var data: GoogleWorkspaceAccounts?
    @State private var loading = true
    @State private var busy = false
    @State private var problem: String?
    @State private var query = ""

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
            } else {
                List {
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
                .searchable(text: $query, prompt: T("Cari akun…"))
            }
        }
        .navigationTitle(target.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } }
            if busy { ToolbarItem(placement: .topBarTrailing) { ProgressView() } }
        }
        .task { await load() }
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
