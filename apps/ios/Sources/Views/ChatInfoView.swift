import SwiftUI
import UIKit

// ─────────────────────────────────────────────────────────────────────────────
// Chat info, like WhatsApp's group info (owner, 8 Oct 2026: "gabisa liat anggota member saat itu
// juga, harusnya ada menu kaya wa group").
//
// Opened by tapping the chat's title. Pushed inside the chat's own NavigationStack — the phone's, or
// the detail column's on iPad and Mac — never a second sheet over the thread. What it shows depends
// on the room:
//   GROUP   picture, name, "Group · N members", description; Add / Search / Mute; media; members
//           (tap one: Message, View profile, Remove); Exit group; Delete group for whoever may (Manager
//           and above, or the only member left — who cannot exit, so Delete takes Exit's place).
//   PROJECT the same without Add, Remove or Exit: "Members follow the project", Open project.
//   DM      the person's card; Search / Mute; media. No member list.
//
// Data: GET /api/conversations/:id/info, /media and /search. A server from before this screen has
// none of them (404 without a sentence); the screen then draws what the chat list already knows —
// name, members, mute — and leaves out media and search instead of showing an error.
// ─────────────────────────────────────────────────────────────────────────────

/// What the thread already knows about the room, handed to the info screen so it can draw at once
/// and still has something to show against a server without the info route.
struct ChatInfoContext {
    let conversationId: String
    let title: String
    /// "DM" | "GROUP" | "PROJECT", or nil when the caller does not know (a project's Chat tab).
    let type: String?
    let projectId: String?
    let members: [Conversation.Member]
    let canManageMembers: Bool?
}

/// The one sheet the info screen presents. One `.sheet(item:)` for both: two `.sheet`s on one view
/// and only one of them ever presents.
private enum ChatInfoSheet: String, Identifiable {
    case addPeople, edit
    var id: String { rawValue }
}

/// Where the info screen pushes to. One `navigationDestination(item:)` for all of them.
private enum ChatInfoRoute: Hashable {
    case profile(ProfileTarget)
    case dm(id: String, title: String)
    case media
    case project(id: String, name: String)
}

/// What the one confirmation alert is asking about.
private enum ChatInfoConfirm: Identifiable {
    case remove(ChatInfoMember)
    case exit
    case delete

    var id: String {
        switch self {
        case .remove(let m): return "remove-" + m.userId
        case .exit: return "exit"
        case .delete: return "delete"
        }
    }
}

private enum ChatSearchState: Equatable {
    case idle, loading, done, unavailable
    case failed(String)
}

struct ChatInfoView: View {
    let context: ChatInfoContext
    /// True in the two-pane layout, where the thread hides the navigation bar and draws its own
    /// header; this screen does the same, with a back button, so the column keeps one look.
    var usesInlineHeader: Bool = false
    /// A search result was picked: the thread closes this screen and scrolls to that message.
    let onJump: (String) -> Void
    /// The group's name was changed here.
    let onRenamed: (String) -> Void
    /// The viewer left the group, or deleted it. The thread closes and goes back to the chat list.
    let onLeft: () -> Void

    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State private var store = ChatStore.shared

    @State private var info: ChatInfoResponse?
    /// The server has no info route yet: drawn from `context`, without media and search.
    @State private var legacy = false
    @State private var loading = true
    @State private var loadError: String?
    /// An action failed (red). Successes say nothing here: the thread's system line confirms them.
    @State private var notice: String?
    /// Something worth knowing that is not a failure (muted).
    @State private var infoNote: String?
    @State private var busy = false
    /// Exit was refused because nobody else is left (LAST_MEMBER): Delete takes its place.
    @State private var lastRefused = false

    @State private var searching = false
    @State private var query = ""
    @State private var hits: [ChatSearchHit] = []
    @State private var hitsCursor: String?
    @State private var searchState: ChatSearchState = .idle
    @FocusState private var searchFocused: Bool

    @State private var sheet: ChatInfoSheet?
    @State private var route: ChatInfoRoute?
    @State private var memberActions: ChatInfoMember?
    @State private var confirm: ChatInfoConfirm?

    private var meId: String? { auth.session?.userId }
    private var conversation: ChatInfo? { info?.conversation }

    /// The room's kind: what the server says, else what the thread said, else a project room when it
    /// belongs to a project.
    private var kind: String {
        conversation?.type ?? context.type ?? (context.projectId != nil ? "PROJECT" : "GROUP")
    }
    private var isGroup: Bool { kind == "GROUP" }
    private var isProject: Bool { kind == "PROJECT" }
    private var isDM: Bool { kind == "DM" }

    private var groupName: String {
        if isDM { return dmPartner?.displayName ?? context.title }
        let name = conversation?.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? context.title : name
    }

    private var canManage: Bool { (conversation?.canManageMembers ?? context.canManageMembers) == true }
    /// Today any member of a GROUP may rename it; the server says so per room once it can.
    private var canEdit: Bool { isGroup && (conversation?.canEdit ?? true) }
    /// The server says so per room (Manager and above, or the only member left); nil = no such route.
    private var canDelete: Bool { isGroup && !legacy && conversation?.canDelete == true }
    /// The viewer is the only one left: a group can't be left by its last member, only deleted.
    private var onlyMember: Bool {
        guard isGroup else { return false }
        if lastRefused { return true }
        guard memberCount == 1, let only = members.first else { return false }
        return only.isMe || only.userId == meId
    }

    /// The member list: the server's (admins first, then A–Z), else the chat list's. The viewer first.
    private var members: [ChatInfoMember] {
        let list: [ChatInfoMember]
        if let info, !legacy {
            list = info.members
        } else {
            list = context.members.compactMap { (m: Conversation.Member) -> ChatInfoMember? in
                let uid = m.uid
                guard !uid.isEmpty else { return nil }
                return ChatInfoMember(userId: uid, name: m.user?.name, avatar: m.user?.avatar,
                                      isMe: uid == meId, isAdmin: false, deactivatedAt: nil)
            }
        }
        let mine = list.filter { $0.isMe || $0.userId == meId }
        let others = list.filter { !($0.isMe || $0.userId == meId) }
        return mine + others
    }

    private var memberCount: Int { conversation?.memberCount ?? members.count }
    private var dmPartner: ChatInfoMember? { members.first { !($0.isMe || $0.userId == meId) } }

    var body: some View {
        VStack(spacing: 0) {
            if usesInlineHeader {
                ChatPaneHeader(title: isDM ? T("Contact info") : T("Group info")) { dismiss() }
                Divider().overlay(NX.border)
            }
            ZStack {
                NX.background.ignoresSafeArea()
                if loading && info == nil && !legacy {
                    ProgressView().tint(NX.violetText)
                } else if let loadError, info == nil, !legacy {
                    ErrorState(message: loadError, icon: "person.2") { Task { await load(spinner: true) } }
                } else {
                    ScrollView {
                        VStack(spacing: 16) {
                            if searching {
                                searchSection
                            } else {
                                header
                                actionRow
                                notices
                                if !legacy { mediaRow }
                                if isProject { projectSection }
                                if isDM { dmSection } else { membersSection }
                                if isGroup { leaveSection }
                                if legacy {
                                    Text(T("Media, search and member roles come with the next server update."))
                                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                                        .multilineTextAlignment(.center)
                                        .frame(maxWidth: .infinity)
                                }
                            }
                        }
                        .padding(16)
                        .frame(maxWidth: 640)
                        .frame(maxWidth: .infinity)
                    }
                    .refreshable { await load(spinner: false) }
                    // A centred alert, never a confirmationDialog: iOS 26 draws those as a bubble pinned
                    // to the row with big glass buttons, which the owner turned down on 29 Sep 2026
                    // (173ffff) and again here on 9 Oct. On the scroll view, not the screen, so it never
                    // shares a view with the Remove / Exit alert below.
                    .alert(memberActions?.displayName ?? "", isPresented: memberActionsShown, presenting: memberActions) { m in
                        memberActionButtons(m)
                    }
                }
            }
        }
        .navigationTitle(usesInlineHeader ? "" : (isDM ? T("Contact info") : T("Group info")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(usesInlineHeader ? .hidden : .visible, for: .navigationBar)
        .task { await load(spinner: true) }
        // A membership change, a rename or a message in this room — from the realtime connection or a
        // push — reloads the screen; every minute otherwise, while it is on screen.
        .liveRefresh(every: 60, on: [.nexusChatPush], conversationId: context.conversationId) {
            await load(spinner: false)
        }
        .sheet(item: $sheet) { which in sheetContent(which) }
        .navigationDestination(item: $route) { r in destination(r) }
        .alert(confirmTitle, isPresented: confirmShown, presenting: confirm) { c in
            confirmButtons(c)
        } message: { c in
            confirmMessage(c)
        }
    }

    // MARK: presentations

    private var memberActionsShown: Binding<Bool> {
        Binding(get: { memberActions != nil }, set: { if !$0 { memberActions = nil } })
    }

    private var confirmShown: Binding<Bool> {
        Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } })
    }

    @ViewBuilder private func sheetContent(_ which: ChatInfoSheet) -> some View {
        switch which {
        case .addPeople:
            AddProjectPeopleSheet(
                target: .group(conversationId: context.conversationId),
                existingUserIds: Set(members.map(\.userId)),
                // No toast: the "… added …" line in the thread is the confirmation now.
                onAdded: { Task { await changed() } }
            )
        case .edit:
            ChatEditDetailsSheet(
                name: groupName,
                description: conversation?.description ?? "",
                descriptionEditable: !legacy,
                onSave: { (name: String?, description: String) async throws in
                    try await save(name: name, description: description)
                }
            )
        }
    }

    @ViewBuilder private func destination(_ r: ChatInfoRoute) -> some View {
        switch r {
        case .profile(let target):
            MemberProfileView(target: target)
        case .dm(let id, let title):
            ChatThreadView(conversationId: id, title: title, type: "DM")
        case .media:
            ChatMediaView(conversationId: context.conversationId, usesInlineHeader: usesInlineHeader)
        case .project(let id, let name):
            ProjectDetailView(projectId: id, projectName: name)
        }
    }

    @ViewBuilder private func memberActionButtons(_ m: ChatInfoMember) -> some View {
        if m.deactivatedAt == nil {
            Button(T("Message")) { Task { await message(m) } }
        }
        Button(T("View profile")) {
            route = .profile(ProfileTarget(userId: m.userId, name: m.name, avatar: m.avatar))
        }
        if isGroup && canManage && !(m.isMe || m.userId == meId) {
            Button(T("Remove from group"), role: .destructive) {
                // One alert at a time: the confirmation opens once this one has finished closing.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { confirm = .remove(m) }
            }
        }
        Button(T("Cancel"), role: .cancel) {}
    }

    @ViewBuilder private func confirmButtons(_ c: ChatInfoConfirm) -> some View {
        switch c {
        case .remove(let m):
            Button(T("Remove"), role: .destructive) { Task { await remove(m) } }
        case .exit:
            Button(T("Exit group"), role: .destructive) { Task { await leaveGroup() } }
        case .delete:
            Button(T("Delete group"), role: .destructive) { Task { await deleteGroup() } }
        }
        Button(T("Cancel"), role: .cancel) {}
    }

    private func confirmMessage(_ c: ChatInfoConfirm) -> Text {
        switch c {
        case .remove:
            return Text(T("They stop getting this group's messages. A manager can add them back."))
        case .exit:
            return Text(T("You stop getting this group's messages. A manager can add you back."))
        case .delete:
            return Text(T("Its messages and members go with it. It can be restored from Control Room → Audit."))
        }
    }

    private var confirmTitle: String {
        switch confirm {
        case .remove(let m): return String(format: T("Remove %@ from %@?"), m.displayName, groupName)
        case .exit: return String(format: T("Exit “%@”?"), groupName)
        case .delete: return String(format: T("Delete “%@”?"), groupName)
        case nil: return ""
        }
    }

    // MARK: header

    private var header: some View {
        VStack(spacing: 8) {
            picture
            Button {
                if canEdit { sheet = .edit }
            } label: {
                HStack(spacing: 6) {
                    Text(groupName)
                        .font(NXFont.display(20, .bold))
                        .foregroundStyle(NX.foreground)
                        .multilineTextAlignment(.center)
                    if canEdit {
                        Image(systemName: "pencil").font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(NX.violetText)
                            .accessibilityHidden(true)
                    }
                }
            }
            .buttonStyle(.plain)
            .disabled(!canEdit)
            .accessibilityHint(canEdit ? T("Edit the group's name and description") : "")
            if !isDM {
                Text(subtitle).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }
            descriptionBlock
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    @ViewBuilder private var picture: some View {
        if isDM {
            Button {
                if let p = dmPartner {
                    route = .profile(ProfileTarget(userId: p.userId, name: p.name, avatar: p.avatar))
                }
            } label: {
                AvatarView(url: dmPartner?.avatar, initial: String(groupName.first ?? "?").uppercased(), size: 88)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(T("View profile"))
        } else {
            ZStack {
                Circle().fill(NX.muted).frame(width: 88, height: 88)
                Image(systemName: "person.2").font(.system(size: 30, weight: .medium)).foregroundStyle(NX.mutedFg)
            }
            .accessibilityHidden(true)
        }
    }

    private var subtitle: String {
        if isProject {
            return memberCount == 1 ? T("Project room · 1 member") : String(format: T("Project room · %d members"), memberCount)
        }
        return memberCount == 1 ? T("Group · 1 member") : String(format: T("Group · %d members"), memberCount)
    }

    @ViewBuilder private var descriptionBlock: some View {
        let text = (conversation?.description ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty {
            Button { if canEdit && !legacy { sheet = .edit } } label: {
                Text(text)
                    .font(NXFont.text(14))
                    .foregroundStyle(NX.foreground)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .buttonStyle(.plain)
            .disabled(!(canEdit && !legacy))
            .padding(.top, 4)
        } else if canEdit && !legacy {
            Button { sheet = .edit } label: {
                Label(T("Add group description"), systemImage: "plus")
                    .font(NXFont.text(13, .semibold))
                    .foregroundStyle(NX.violetText)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: actions

    private var actionRow: some View {
        HStack(spacing: 10) {
            if isGroup && canManage {
                actionTile(T("Add"), icon: "person.badge.plus") { sheet = .addPeople }
            }
            if !legacy {
                actionTile(T("Search"), icon: "magnifyingglass") { searching = true }
            }
            if store.muteSupported != false {
                ChatMuteMenu(conversationId: context.conversationId, onNotice: show) { muted in
                    tileLabel(muted ? T("Muted") : T("Mute"), icon: muted ? "bell.slash.fill" : "bell")
                }
            }
        }
    }

    private func actionTile(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { tileLabel(title, icon: icon) }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
    }

    private func tileLabel(_ title: String, icon: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 18, weight: .semibold)).foregroundStyle(NX.violetText)
            Text(title).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
        }
        .frame(maxWidth: .infinity, minHeight: 64)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(NX.border))
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    @ViewBuilder private var notices: some View {
        if let until = store.mutedUntil(conversationId: context.conversationId) {
            Text(ChatMute.caption(until)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
        }
        if let infoNote {
            Label(infoNote, systemImage: "info.circle")
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        if let notice {
            Text(notice).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func show(_ text: String?, isError: Bool) {
        if isError {
            notice = text
            infoNote = nil
        } else {
            infoNote = text
            notice = nil
        }
    }

    // MARK: media

    private var mediaRow: some View {
        Button { route = .media } label: {
            HStack(spacing: 12) {
                Image(systemName: "photo.on.rectangle").font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(NX.violetText).frame(width: 24)
                Text(T("Media, links and docs")).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
                Spacer(minLength: 8)
                if let total = info?.counts?.total {
                    Text("\(total)").font(NXFont.text(14)).foregroundStyle(NX.mutedFg).monospacedDigit()
                }
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(NX.mutedFg)
            }
            .padding(14)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
    }

    // MARK: members

    private var membersSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(memberCount == 1 ? T("1 member") : String(format: T("%d members"), memberCount))
                .padding(.leading, 4)
            VStack(spacing: 0) {
                ForEach(Array(members.enumerated()), id: \.element.userId) { idx, m in
                    if idx > 0 { Divider().overlay(NX.border).padding(.leading, 58) }
                    memberRow(m)
                }
            }
            .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
        }
    }

    private func memberRow(_ m: ChatInfoMember) -> some View {
        let me = m.isMe || m.userId == meId
        return Button {
            if me {
                route = .profile(ProfileTarget(userId: m.userId, name: m.name, avatar: m.avatar))
            } else {
                memberActions = m
            }
        } label: {
            HStack(spacing: 12) {
                AvatarView(url: m.avatar, initial: m.initial, size: 36)
                HStack(spacing: 6) {
                    Text(me ? T("You") : m.displayName)
                        .font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    if m.deactivatedAt != nil { LeftTag(leftAt: m.deactivatedAt) }
                }
                Spacer(minLength: 8)
                if m.isAdmin {
                    Text(T("Admin"))
                        .font(NXFont.text(10, .semibold))
                        .foregroundStyle(ChipTone.accent.fg)
                        .padding(.horizontal, 7).padding(.vertical, 3)
                        .background(ChipTone.accent.bg, in: Capsule())
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
    }

    // MARK: project room / DM

    private var projectSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "info.circle").font(.system(size: 14)).foregroundStyle(NX.violetText)
                VStack(alignment: .leading, spacing: 2) {
                    Text(T("Members follow the project")).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                    Text(T("Add or remove people in the project; this room follows it."))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            if let pid = conversation?.projectId ?? context.projectId {
                Divider().overlay(NX.border)
                Button { route = .project(id: pid, name: groupName) } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "rectangle.stack").font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(NX.violetText).frame(width: 24)
                        Text(T("Open project")).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(NX.mutedFg)
                    }
                    .padding(14)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
            }
        }
        .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
    }

    @ViewBuilder private var dmSection: some View {
        if let p = dmPartner {
            Button {
                route = .profile(ProfileTarget(userId: p.userId, name: p.name, avatar: p.avatar))
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "person.crop.circle").font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(NX.violetText).frame(width: 24)
                    Text(T("View profile")).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
                    if p.deactivatedAt != nil { LeftTag(leftAt: p.deactivatedAt) }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(NX.mutedFg)
                }
                .padding(14)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
        }
    }

    /// Exit, and Delete for whoever may. The only member left can't exit: a muted line says why, and
    /// Delete takes Exit's place.
    @ViewBuilder private var leaveSection: some View {
        VStack(spacing: 10) {
            if onlyMember {
                Label(T("You're the only member left, so you can't leave. Delete the group instead."), systemImage: "info.circle")
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                exitSection
            }
            if canDelete { deleteSection }
        }
    }

    private var deleteSection: some View {
        Button { confirm = .delete } label: {
            HStack(spacing: 12) {
                Image(systemName: "trash").font(.system(size: 15, weight: .semibold))
                    .frame(width: 24)
                Text(T("Delete group")).font(NXFont.text(15, .semibold))
                Spacer(minLength: 8)
                if busy { ProgressView().controlSize(.small).tint(NX.danger) }
            }
            .foregroundStyle(NX.danger)
            .padding(14)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .hoverEffect(.highlight)
    }

    private var exitSection: some View {
        Button { confirm = .exit } label: {
            HStack(spacing: 12) {
                Image(systemName: "rectangle.portrait.and.arrow.right").font(.system(size: 15, weight: .semibold))
                    .frame(width: 24)
                Text(T("Exit group")).font(NXFont.text(15, .semibold))
                Spacer(minLength: 8)
                if busy { ProgressView().controlSize(.small).tint(NX.danger) }
            }
            .foregroundStyle(NX.danger)
            .padding(14)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .hoverEffect(.highlight)
    }

    // MARK: search

    private var searchSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundStyle(NX.mutedFg)
                    TextField(T("Search this chat"), text: $query)
                        .font(NXFont.text(15))
                        .focused($searchFocused)
                        .submitLabel(.search)
                        .autocorrectionDisabled()
                        .onSubmit { Task { await runSearch(reset: true) } }
                }
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                Button(T("Cancel")) {
                    searching = false
                    query = ""
                    hits = []
                    hitsCursor = nil
                    searchState = .idle
                }
                .font(NXFont.text(14, .semibold))
                .foregroundStyle(NX.violetText)
            }
            searchResults
        }
        // The field exists only once this section is drawn, so the keyboard comes up from here.
        .task {
            try? await Task.sleep(for: .milliseconds(150))
            searchFocused = true
        }
        // Typing pauses for a moment before asking: one request per word, not per keystroke.
        .task(id: query) {
            try? await Task.sleep(for: .milliseconds(350))
            if Task.isCancelled { return }
            await runSearch(reset: true)
        }
    }

    @ViewBuilder private var searchResults: some View {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if q.count < 2 {
            Text(T("Type at least 2 characters to search."))
                .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                .padding(.horizontal, 4)
        } else {
            switch searchState {
            case .unavailable:
                EmptyState(icon: "magnifyingglass", title: T("Search isn't available yet"),
                           subtitle: T("It comes with the next server update."), compact: true)
            case .failed(let message):
                VStack(spacing: 8) {
                    Text(message).font(NXFont.text(13)).foregroundStyle(NX.danger).multilineTextAlignment(.center)
                    Button(T("Try again")) { Task { await runSearch(reset: true) } }
                        .buttonStyle(NexusPrimaryButton(fullWidth: false))
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 12)
            case .loading where hits.isEmpty, .idle:
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.top, 24)
            case .done where hits.isEmpty:
                EmptyState(icon: "magnifyingglass", title: T("No messages found"),
                           subtitle: String(format: T("Nothing in this chat matches “%@”. Check the spelling, or try a shorter word."), q),
                           compact: true)
            default:
                VStack(spacing: 0) {
                    ForEach(Array(hits.enumerated()), id: \.element.id) { idx, hit in
                        if idx > 0 { Divider().overlay(NX.border) }
                        Button { onJump(hit.messageId) } label: { hitRow(hit) }
                            .buttonStyle(.plain)
                            .hoverEffect(.highlight)
                    }
                }
                .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
                if hitsCursor != nil {
                    Button { Task { await runSearch(reset: false) } } label: {
                        HStack(spacing: 6) {
                            if searchState == .loading { ProgressView().controlSize(.small).tint(NX.violetText) }
                            Text(T("Load more")).font(NXFont.text(13, .semibold))
                        }
                        .foregroundStyle(NX.violetText)
                        .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .disabled(searchState == .loading)
                }
            }
        }
    }

    private func hitRow(_ hit: ChatSearchHit) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(hit.sender?.id == meId ? T("You") : (hit.sender?.name ?? "—"))
                    .font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                Spacer(minLength: 8)
                if let when = ChatMute.dateText(hit.createdAt) {
                    Text(when).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
            }
            Text(hit.snippet).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).lineLimit(2)
                .multilineTextAlignment(.leading)
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private func runSearch(reset: Bool) async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard q.count >= 2 else {
            hits = []
            hitsCursor = nil
            searchState = .idle
            return
        }
        if !reset && hitsCursor == nil { return }
        searchState = .loading
        do {
            let page = try await APIClient.shared.searchConversation(
                context.conversationId, query: q, cursor: reset ? nil : hitsCursor)
            // The words may have changed while this was out; an answer to old words is dropped.
            guard q == query.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
            hits = reset ? page.results : hits + page.results.filter { h in !hits.contains { $0.id == h.id } }
            hitsCursor = page.nextCursor
            searchState = .done
        } catch APIError.unauthorized {
            auth.logout()
        } catch let failure {
            // Typing on cancelled this search; the next one is already on its way.
            if Task.isCancelled || failure is CancellationError { return }
            if APIClient.isMissingRoute(failure) {
                searchState = .unavailable
            } else {
                searchState = .failed((failure as? LocalizedError)?.errorDescription ?? T("Couldn't search this chat."))
            }
        }
    }

    // MARK: loading and actions

    private func load(spinner: Bool) async {
        if spinner && info == nil { loading = true }
        defer { loading = false }
        do {
            let fresh = try await APIClient.shared.conversationInfo(context.conversationId)
            info = fresh
            legacy = false
            loadError = nil
            // Tell the store a mute it has not heard of: opened from a push, before any list loaded.
            if store.mutedUntilById[context.conversationId] == nil, let until = fresh.conversation?.mutedUntil {
                store.setMuted(context.conversationId, until: until)
            }
        } catch APIError.unauthorized {
            auth.logout()
        } catch let failure {
            if APIClient.isMissingRoute(failure) {
                legacy = true
                loadError = nil
            } else if info == nil {
                // A refresh that fails leaves what is on screen alone; only a first load says so.
                loadError = (failure as? LocalizedError)?.errorDescription ?? T("Couldn't load this chat's info.")
            }
        }
    }

    /// Something about the room changed here: reload, and tell the thread and the list (the same
    /// signal a realtime event gives), so the thread fetches its new system line at once.
    private func changed() async {
        NotificationCenter.default.post(name: .nexusChatPush, object: nil,
                                        userInfo: [RealtimeKey.conversationId: context.conversationId])
        await load(spinner: false)
    }

    private func save(name: String?, description: String) async throws {
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines)
        let newName = (trimmed?.isEmpty == false && trimmed != groupName) ? trimmed : nil
        if legacy {
            // The old server has no description; the name goes through the rename it has always had.
            guard let newName else { return }
            _ = try await APIClient.shared.renameConversation(context.conversationId, name: newName)
        } else {
            try await APIClient.shared.updateConversationDetails(context.conversationId, name: newName,
                                                                 description: description)
        }
        if let newName { onRenamed(newName) }
        notice = nil
        await changed()
    }

    private func message(_ m: ChatInfoMember) async {
        notice = nil
        do {
            let convo = try await APIClient.shared.createConversation(type: "DM", userIds: [m.userId], name: nil)
            route = .dm(id: convo.id, title: m.displayName)
        } catch APIError.unauthorized {
            auth.logout()
        } catch let failure {
            notice = (failure as? LocalizedError)?.errorDescription ?? T("Couldn't open a chat with them.")
        }
    }

    private func remove(_ m: ChatInfoMember) async {
        busy = true
        notice = nil
        defer { busy = false }
        do {
            try await APIClient.shared.removeConversationMember(context.conversationId, userId: m.userId)
            await changed()
        } catch APIError.unauthorized {
            auth.logout()
        } catch let failure {
            notice = (failure as? LocalizedError)?.errorDescription ?? T("Couldn't change who is in this group.")
        }
    }

    private func leaveGroup() async {
        guard let meId else { return }
        busy = true
        notice = nil
        defer { busy = false }
        do {
            try await APIClient.shared.removeConversationMember(context.conversationId, userId: meId)
            // The list and the badges drop the room; then the thread closes itself.
            NotificationCenter.default.post(name: .nexusChatPush, object: nil)
            onLeft()
        } catch APIError.unauthorized {
            auth.logout()
        } catch is ChatLastMemberRefusal {
            // Nobody else is left (someone left a moment ago): not a failure to shout about. The
            // muted line and Delete take Exit's place.
            lastRefused = true
            await load(spinner: false)
        } catch let failure {
            notice = (failure as? LocalizedError)?.errorDescription ?? T("Couldn't leave this group.")
        }
    }

    /// Deletes the group (restorable from Control Room → Audit) and goes back to the chat list, the
    /// way Exit does.
    private func deleteGroup() async {
        busy = true
        notice = nil
        defer { busy = false }
        do {
            try await APIClient.shared.deleteConversation(context.conversationId)
            NotificationCenter.default.post(name: .nexusChatPush, object: nil)
            onLeft()
        } catch APIError.unauthorized {
            auth.logout()
        } catch APIError.http(let code, _) where code == 404 {
            // Already gone: deleted on another device, or by someone else a moment ago.
            NotificationCenter.default.post(name: .nexusChatPush, object: nil)
            onLeft()
        } catch let failure {
            notice = (failure as? LocalizedError)?.errorDescription ?? T("Couldn't delete this group.")
            await load(spinner: false)
        }
    }
}

// MARK: - Header for the two-pane layout

/// The bar a pushed screen draws for itself in the iPad/Mac two-pane layout, where the thread column
/// hides the navigation bar: a back button and the title, over the column it belongs to.
struct ChatPaneHeader: View {
    let title: String
    let onBack: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(NX.violetText)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(T("Back"))
            Text(title)
                .font(NXFont.display(17, .bold))
                .foregroundStyle(NX.foreground)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.leading, 6).padding(.trailing, 16)
        .frame(height: 52)
        .background(NX.background)
    }
}

// MARK: - Edit name and description

/// The group's name and description, in one sheet. A sheet rather than an alert because a
/// description runs to 500 characters and several lines.
private struct ChatEditDetailsSheet: View {
    let name: String
    let description: String
    /// False against a server without descriptions: only the name is offered.
    let descriptionEditable: Bool
    let onSave: (_ name: String?, _ description: String) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var nameDraft = ""
    @State private var descriptionDraft = ""
    @State private var saving = false
    @State private var error: String?

    private static let maxDescription = 500

    var body: some View {
        NavigationStack {
            Form {
                Section(T("Group name")) {
                    TextField(T("Group name"), text: $nameDraft)
                        .font(NXFont.text(15))
                }
                if descriptionEditable {
                    Section {
                        TextField(T("Add group description"), text: $descriptionDraft, axis: .vertical)
                            .font(NXFont.text(15))
                            .lineLimit(3...10)
                            .onChange(of: descriptionDraft) { _, value in
                                if value.count > Self.maxDescription {
                                    descriptionDraft = String(value.prefix(Self.maxDescription))
                                }
                            }
                    } header: {
                        Text(T("Description"))
                    } footer: {
                        Text("\(descriptionDraft.count)/\(Self.maxDescription)").monospacedDigit()
                    }
                }
                if let error {
                    Section {
                        Text(error).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(T("Edit group"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() }.keyboardShortcut(.cancelAction) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(T("Save")) { Task { await save() } }
                        .disabled(saving || nameDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear {
                nameDraft = name
                descriptionDraft = description
            }
        }
    }

    private func save() async {
        saving = true
        error = nil
        defer { saving = false }
        do {
            try await onSave(nameDraft, descriptionDraft)
            dismiss()
        } catch let failure {
            error = (failure as? LocalizedError)?.errorDescription ?? T("Couldn't save the group's details.")
        }
    }
}

// MARK: - Mute

/// The chat's mute menu: the thread's bell and the info screen's Mute tile are the same menu.
struct ChatMuteMenu<MenuLabel: View>: View {
    let conversationId: String
    /// A sentence for the screen to show, and whether it is a failure (red) or only worth knowing.
    var onNotice: (String?, Bool) -> Void = { _, _ in }
    @ViewBuilder let label: (_ muted: Bool) -> MenuLabel

    @Environment(AuthStore.self) private var auth
    @State private var store = ChatStore.shared

    var body: some View {
        let muted = store.isMuted(conversationId: conversationId)
        Menu {
            if let until = store.mutedUntil(conversationId: conversationId) {
                Section(ChatMute.caption(until)) {
                    Button { Task { await setMute(nil) } } label: {
                        Label(T("Unmute"), systemImage: "bell")
                    }
                }
            } else {
                Button { Task { await setMute(ChatMute.until(hours: 8)) } } label: {
                    Label(T("Mute for 8 hours"), systemImage: "bell.slash")
                }
                Button { Task { await setMute(ChatMute.until(hours: 24 * 7)) } } label: {
                    Label(T("Mute for 1 week"), systemImage: "bell.slash")
                }
                Button { Task { await setMute("forever") } } label: {
                    Label(T("Mute always"), systemImage: "bell.slash.fill")
                }
            }
        } label: {
            label(muted)
        }
        .accessibilityLabel(muted ? T("Muted") : T("Mute notifications"))
    }

    private func setMute(_ until: String?) async {
        onNotice(nil, true)
        do {
            let stored = try await APIClient.shared.setConversationMute(conversationId, until: until)
            // A server that answers without the field still did what was asked.
            let effective: String? = until == nil ? nil : (stored ?? until)
            store.setMuted(conversationId, until: effective)
        } catch APIError.unauthorized {
            auth.logout()
        } catch APIError.http(let code, _) where code == 404 {
            // The old server has no mute route. Take the option away rather than offer it again.
            store.muteUnavailable()
            onNotice(T("Muting isn't available yet. It comes with the next server update."), false)
        } catch let failure {
            onNotice((failure as? LocalizedError)?.errorDescription ?? T("Couldn't change notifications for this chat."), true)
        }
    }
}

/// Mute wording and times, shared by the menu and the info screen.
enum ChatMute {
    /// "Muted until 9 Oct, 02:00", or just "Muted" for "Always" (stored as a far-future date).
    static func caption(_ raw: String) -> String {
        guard let until = ChatStore.parseDate(raw),
              until.timeIntervalSinceNow < 5 * 365 * 24 * 3600 else { return T("Muted") }
        return String(format: T("Muted until %@"), until.formatted(date: .abbreviated, time: .shortened))
    }

    static func until(hours: Double) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: Date().addingTimeInterval(hours * 3600))
    }

    /// A message's time as a row shows it: "8 Oct 2026, 14:05".
    static func dateText(_ raw: String?) -> String? {
        guard let raw, let date = ChatStore.parseDate(raw) else { return nil }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

// MARK: - Media, links and docs

private enum ChatMediaKind: String, CaseIterable, Identifiable {
    case photos, links, docs
    var id: String { rawValue }

    var title: String {
        switch self {
        case .photos: return T("Photos")
        case .links: return T("Links")
        case .docs: return T("Docs")
        }
    }
}

/// Every photo, link and file sent in one chat, newest first, a page at a time.
struct ChatMediaView: View {
    let conversationId: String
    var usesInlineHeader: Bool = false

    @Environment(\.dismiss) private var dismiss
    @State private var tab: ChatMediaKind = .photos

    var body: some View {
        VStack(spacing: 0) {
            if usesInlineHeader {
                ChatPaneHeader(title: T("Media, links and docs")) { dismiss() }
                Divider().overlay(NX.border)
            }
            Picker(T("Show"), selection: $tab) {
                ForEach(ChatMediaKind.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16).padding(.vertical, 10)
            // Keyed by tab: each tab starts from its own first page, not the last tab's.
            ChatMediaList(conversationId: conversationId, kind: tab)
                .id(tab)
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(usesInlineHeader ? "" : T("Media, links and docs"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(usesInlineHeader ? .hidden : .visible, for: .navigationBar)
    }
}

/// What a doc row opens: the app's own viewer when it can show the file, the share sheet otherwise.
/// One enum for the one sheet this list presents.
private enum ChatDocOpen: Identifiable {
    case preview(AttachmentPreview)
    case share(ShareItem)

    var id: String {
        switch self {
        case .preview(let p): return "preview-" + p.id
        case .share(let s): return "share-" + s.id.uuidString
        }
    }
}

private struct ChatMediaList: View {
    let conversationId: String
    let kind: ChatMediaKind

    @Environment(AuthStore.self) private var auth
    @Environment(\.openURL) private var openURL
    @State private var items: [ChatMediaItem] = []
    @State private var cursor: String?
    @State private var loading = true
    @State private var loadingMore = false
    @State private var error: String?
    @State private var unavailable = false
    @State private var viewing: PhotoRef?
    @State private var docOpen: ChatDocOpen?
    @State private var opening: String?

    var body: some View {
        Group {
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if unavailable {
                EmptyState(icon: "photo.on.rectangle", title: T("Media isn't available yet"),
                           subtitle: T("It comes with the next server update."))
            } else if let error, items.isEmpty {
                ErrorState(message: error, icon: "photo.on.rectangle") { Task { await load(reset: true) } }
            } else if items.isEmpty {
                empty
            } else {
                ScrollView {
                    switch kind {
                    case .photos: photoGrid
                    case .links, .docs: rows
                    }
                    if loadingMore {
                        ProgressView().tint(NX.violetText).padding(.vertical, 16)
                    }
                }
                .refreshable { await load(reset: true) }
            }
        }
        .task { await load(reset: true) }
    }

    @ViewBuilder private var empty: some View {
        switch kind {
        case .photos:
            EmptyState(icon: "photo.on.rectangle", title: T("No photos yet"),
                       subtitle: T("Photos sent in this chat show up here."))
        case .links:
            EmptyState(icon: "link", title: T("No links yet"),
                       subtitle: T("Links sent in this chat show up here."))
        case .docs:
            EmptyState(icon: "doc", title: T("No documents yet"),
                       subtitle: T("Files sent in this chat show up here."))
        }
    }

    private var photoGrid: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 4)], spacing: 4) {
            ForEach(items) { item in
                if let url = ChatMessage.fileURL(item.url) {
                    Color.clear
                        .aspectRatio(1, contentMode: .fit)
                        .overlay {
                            ChatPhoto(url: url, style: .tile, ink: NX.foreground) {
                                viewing = PhotoRef(url: url, name: nil)
                            }
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .onAppear { if item.id == items.last?.id { Task { await load(reset: false) } } }
                }
            }
        }
        .padding(.horizontal, 16).padding(.bottom, 16)
        // One presentation per view: the grid has the photo viewer, the rows have the file sheet.
        .fullScreenCover(item: $viewing) { PhotoViewer(photo: $0) }
    }

    private var rows: some View {
        LazyVStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { idx, item in
                if idx > 0 { Divider().overlay(NX.border).padding(.leading, 56) }
                Button { Task { await open(item) } } label: { row(item) }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                    .onAppear { if item.id == items.last?.id { Task { await load(reset: false) } } }
            }
        }
        .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
        .padding(.horizontal, 16).padding(.bottom, 16)
        .sheet(item: $docOpen) { which in
            switch which {
            case .preview(let p): AttachmentViewerView(preview: p)
            case .share(let s): ActivityView(items: [s.url])
            }
        }
    }

    private func row(_ item: ChatMediaItem) -> some View {
        let glyph: String = kind == .links
            ? "link"
            : (AttachmentKind(mime: item.attachmentType, name: fileName(item))?.glyph ?? "doc")
        return HStack(spacing: 12) {
            Image(systemName: glyph).font(.system(size: 15, weight: .semibold)).foregroundStyle(NX.violetText)
                .frame(width: 32, height: 32)
                .background(NX.accentBg, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(primary(item)).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                if kind == .links {
                    Text(item.url).font(NXFont.text(12)).foregroundStyle(NX.violetText).lineLimit(1)
                }
                Text(secondary(item)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            Spacer(minLength: 8)
            if opening == item.id { ProgressView().controlSize(.small).tint(NX.violetText) }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .contentShape(Rectangle())
    }

    private func fileName(_ item: ChatMediaItem) -> String {
        if let title = item.title, !title.isEmpty { return title }
        let last = item.url.split(separator: "/").last.map(String.init) ?? item.url
        return last.split(separator: "?").first.map(String.init) ?? last
    }

    private func primary(_ item: ChatMediaItem) -> String {
        if kind == .links {
            if let title = item.title, !title.isEmpty { return title }
            return URL(string: item.url)?.host ?? item.url
        }
        return fileName(item)
    }

    private func secondary(_ item: ChatMediaItem) -> String {
        [item.sender?.name, ChatMute.dateText(item.createdAt)].compactMap { $0 }.joined(separator: " · ")
    }

    private func open(_ item: ChatMediaItem) async {
        if kind == .links {
            if let url = URL(string: item.url) { openURL(url) }
            return
        }
        // A file: through the app, which carries the session `/api/files` asks for.
        let name = fileName(item)
        let kindOfFile = AttachmentKind(mime: item.attachmentType, name: name)
        if kindOfFile == .image, let remote = ChatMessage.fileURL(item.url) {
            docOpen = .preview(AttachmentPreview(id: item.id, name: name, kind: .image, source: remote))
            return
        }
        opening = item.id
        defer { opening = nil }
        do {
            let file = try await APIClient.shared.downloadAttachment(url: item.url, fileName: name)
            if let kindOfFile {
                docOpen = .preview(AttachmentPreview(id: item.id, name: name, kind: kindOfFile, source: file))
            } else {
                docOpen = .share(ShareItem(url: file))
            }
        } catch APIError.unauthorized {
            auth.logout()
        } catch let failure {
            error = (failure as? LocalizedError)?.errorDescription ?? T("Couldn't open this file.")
        }
    }

    private func load(reset: Bool) async {
        if !reset && (cursor == nil || loadingMore) { return }
        if reset { cursor = nil } else { loadingMore = true }
        defer {
            loading = false
            loadingMore = false
        }
        do {
            let page = try await APIClient.shared.conversationMedia(conversationId, type: kind.rawValue,
                                                                    cursor: reset ? nil : cursor)
            if reset {
                items = page.items
            } else {
                let known = Set(items.map(\.id))
                items += page.items.filter { !known.contains($0.id) }
            }
            cursor = page.nextCursor
            error = nil
            unavailable = false
        } catch APIError.unauthorized {
            auth.logout()
        } catch let failure {
            if APIClient.isMissingRoute(failure) {
                unavailable = true
            } else {
                error = (failure as? LocalizedError)?.errorDescription ?? T("Couldn't load this chat's media.")
            }
        }
    }
}
