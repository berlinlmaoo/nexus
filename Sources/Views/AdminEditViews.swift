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
        if viewer.canAnnounce { t.append(("Pengumuman", "announcements")) }
        return t
    }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            VStack(spacing: 0) {
                Picker("", selection: $section) {
                    ForEach(tabs.indices, id: \.self) { Text(tabs[$0].title).tag($0) }
                }
                .pickerStyle(.segmented).padding(12)
                Divider().overlay(NX.border)
                // Switched on the tab's id, not its index, so a hidden tab cannot shift the others.
                switch tabs.indices.contains(section) ? tabs[section].id : "users" {
                case "attendance": AttendanceAdminSection(workspaceId: workspaceId)
                case "audit": AdminAuditSection()
                case "quests": AdminQuestsSection(workspaceId: workspaceId)
                case "announcements": AdminAnnouncementsSection()
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
    }

    private func row(_ m: WorkspaceRoster.Member) -> some View {
        HStack(spacing: 12) {
            AvatarView(url: m.avatarURL, initial: m.initial, size: 38)
            VStack(alignment: .leading, spacing: 2) {
                Text(m.displayName).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                if let e = m.emailText, !e.isEmpty { Text(e).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1) }
            }
            Spacer(minLength: 6)
            if canEditTier(viewerRole, m.role), let wsId = workspaceId {
                Menu {
                    ForEach(assignableRoles(viewerRole), id: \.self) { r in Button(orgRoleLabel(r)) { Task { await setRole(m, r, wsId) } } }
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
    private let tones: [(String, String)] = [("info", "Info"), ("success", "Success"), ("warning", "Warning")]

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
        try? await APIClient.shared.createAnnouncement(title: title.trimmingCharacters(in: .whitespaces), body: body_.trimmingCharacters(in: .whitespaces), tone: tone)
        await onCreated(); dismiss()
    }
}
