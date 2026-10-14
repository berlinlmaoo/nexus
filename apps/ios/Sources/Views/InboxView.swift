import SwiftUI

/// Port of web inbox.tsx ("Signal Inbox"): unread banner + notification rows (icon, title,
/// message, date·type) + mark-read / mark-all.
struct InboxView: View {
    /// False when pushed into another stack — the More tab's, where Inbox lives since the Calendar
    /// took its place in the phone's tab bar (owner, 8 Oct 2026). A NavigationStack nested inside
    /// another one loses the back button on everything above it (same rule as MessagesView).
    var providesOwnStack = true
    @Environment(AuthStore.self) private var auth
    @Environment(AppRouter.self) private var router
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var items: [NexusNotification] = []
    @State private var unread = 0
    @State private var loading = true
    @State private var error: String?
    /// What a tapped notification pushed into THIS stack — a task or a project, which are single
    /// records rather than screens and so cannot travel through AppRouter the way `.attendance`
    /// and `.messages` do.
    ///
    /// One binding carrying one type, rather than two `String?` ones: a NavigationStack keys a
    /// destination by the type of its value, and ProjectDetailView — pushed from right here —
    /// declares a `String?` destination of its own for the tasks on its board.
    @State private var openTarget: NotificationTarget?
    /// Which bucket the chips are on, and the chips themselves. The tabs are recomputed only when
    /// the list is (re)loaded — the counts cannot change while nobody is fetching, and this bar
    /// sits above a scroll view.
    @State private var group: NotificationGroup = .all
    @State private var tabs: [NotificationFilterTab] = []
    /// The submission a notification asked for, opened over this screen rather than by sending the
    /// reader off to the board and making them find the row again.
    @State private var openSubmission: SubmissionRef?

    var body: some View {
        if providesOwnStack {
            NavigationStack { screen }
        } else {
            screen
        }
    }

    /// The sidebar's Notifications page on an iPad or Mac: the web's page header instead of the nav bar.
    private var isRoot: Bool { NXSidebarPage.isRoot(.inbox, hSize: hSize, router: router) }

    private var screen: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .nxSidebarPageChrome(isRoot, phoneSubtitle: T("Mentions, assignments, approvals and replies that need you.")) { pageHeader }
        .navigationDestination(item: $openTarget) { target in
            switch target {
            case .task(let id):    TaskDetailView(taskId: id)
            // A notification carries the project's id and no name; the board fills its own
            // header in once it loads.
            case .project(let id): ProjectDetailView(projectId: id, projectName: "")
            // Never stored: a whole screen goes through the router, and a submission opens as a
            // sheet over this one — neither travels through this stack.
            default: EmptyView()
            }
        }
        .sheet(item: $openSubmission) { SubmissionDetailSheet(submissionId: $0.id, preview: $0.preview) }
        .navigationTitle(T("Notifications"))
        // Inline, like Messages / Tickets / Threads. With the default large title the iPhone (iOS 26+ bar)
        // drew an empty band that covered the filter tabs: only their underline showed (UI tour 13 Oct 2026).
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { Task { await markAll() } } label: { Label(T("Mark all"), systemImage: "checkmark.circle") }
                    .disabled(unread == 0)
            }
        }
        .task { await load() }
        // A notification written for this person while the Inbox is open shows up in it, as it does
        // on the web: RealtimeClient posts this on the server's `new-notification`.
        .liveRefresh(every: 60, on: [.nexusInboxChanged]) { await reloadQuietly() }
    }

    /// Web inbox.tsx PageHeader, with the filter tabs in its tabs row.
    private var pageHeader: some View {
        VStack(spacing: 0) {
            NXPageHeader(title: T("Notifications"), subtitle: T("Mentions, assignments, approvals and replies that need you.")) {
                Button { Task { await markAll() } } label: { Label(T("Mark all as read"), systemImage: "checkmark") }
                    .buttonStyle(.nxBordered)
                    .disabled(unread == 0)
                    .opacity(unread == 0 ? 0.6 : 1)
            }
            if !loading, error == nil, !items.isEmpty, tabs.count > 2 {
                NXPageTabsRow(items: tabs.map { NXTabItem(id: $0.group, label: $0.group.label, count: $0.count) },
                              selection: $group, accessibilityName: T("Notifications"))
            }
        }
    }

    @ViewBuilder private var content: some View {
        if loading {
            SkeletonList()
        } else if let error {
            errorState(error)
        } else {
            VStack(spacing: 0) {
                // The phone's filter tabs stay under the title while the list scrolls, as on the web's
                // mobile inbox (UI tour run 12, IP2: they scrolled away). On the iPad / Mac page the tabs
                // sit in the header.
                if !isRoot, !items.isEmpty, tabs.count > 2 {
                    // Full width under the subtitle, like the Settings and Legal tab rows.
                    NotificationFilterBar(tabs: tabs, group: $group)
                        .background(NX.background)
                }
                list
            }
        }
    }

    private var list: some View {
        ScrollView {
            VStack(spacing: 12) {
                // A plain line, and only when something is unread (web: an empty inbox had a
                // "0 unread" bar over its empty state).
                if unread > 0 {
                    Text(unread == 1 ? T("1 unread notification") : String(format: T("%d unread notifications"), unread))
                        .font(NXFont.text(14, .medium)).foregroundStyle(NX.mutedFg)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                if items.isEmpty {
                    EmptyState(icon: "tray", title: T("Inbox clean"),
                               subtitle: T("Requests to approve, replies to your tickets, mentions and announcements land here the moment they happen. Nothing needs you right now."),
                               tint: NX.success, compact: true)
                } else {
                    if shown.isEmpty {
                        EmptyState(icon: "line.3.horizontal.decrease.circle", title: T("Nothing of this kind"),
                                   subtitle: T("This filter only shows one type of notification. Everything else is still in All."),
                                   actionTitle: T("Show all"), actionIcon: nil, action: { group = .all }, compact: true)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(shown.enumerated()), id: \.element.id) { idx, n in
                                if idx > 0 { Divider().overlay(NX.border) }
                                NotificationRow(notification: n, onDelete: { Task { await delete(n) } },
                                                onMarkRead: { Task { await markRead(n) } }) { open(n) }
                            }
                        }
                        // Hairline card like the web's (rounded-xl border bg-card), no drop shadow.
                        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
            }
            .padding(.horizontal, NXSidebarPage.gutter(isRoot))
            .padding(.vertical, isRoot ? 24 : 16)
        }
        .refreshable { await load() }
    }

    private var shown: [NexusNotification] {
        group == .all ? items : items.filter { $0.group == group }
    }

    private func errorState(_ msg: String) -> some View {
        ErrorState(message: msg) { Task { await load() } }
    }

    private func load() async {
        error = nil
        do {
            let res = try await APIClient.shared.notifications()
            items = activeNotifications(res.notifications ?? [])
            unread = res.unreadCount ?? items.filter { !$0.isRead }.count
            // The tab bar's count (More, or the Inbox tab while the Calendar is held back) follows
            // what this screen just read — a mark-read and Mark all come through here too.
            InboxBadge.shared.set(unread)
            tabs = notificationFilterTabs(items)
            // The last thing in a bucket can be deleted while its chip is selected, and a filter
            // pinned to a bucket that no longer has a chip shows an empty list with no way back.
            if !tabs.contains(where: { $0.group == group }) { group = .all }
        } catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Login required to open the inbox.") }
        loading = false
    }

    /// The live reload: the list as the server has it now. Quiet — a failure leaves the list alone,
    /// and a screen showing an error keeps its own retry.
    private func reloadQuietly() async {
        guard !loading, error == nil else { return }
        guard let res = try? await APIClient.shared.notifications() else { return }
        items = activeNotifications(res.notifications ?? [])
        unread = res.unreadCount ?? items.filter { !$0.isRead }.count
        InboxBadge.shared.set(unread)
        tabs = notificationFilterTabs(items)
        if !tabs.contains(where: { $0.group == group }) { group = .all }
    }

    /// Tapping a row: mark it read, and go where the web's inbox would go.
    ///
    /// Mark-read runs whether or not there is anywhere to go, which is slightly more than the web
    /// does — there a row with no destination is not clickable at all and only its "Read" button
    /// marks it. This screen has marked on tap since it was written, and taking that away to match
    /// would be a regression wearing parity's clothes.
    private func open(_ n: NexusNotification) {
        Task { await markRead(n) }
        if let link = n.link, link.hasPrefix("http"), let url = URL(string: link) { UIApplication.shared.open(url); return }
        guard let target = n.tapTarget else { return }
        if case .screen(let screen) = target { router.go(screen); return }
        // The web sends the reader to the board with `?id=` and pops the drawer there. On a phone
        // that would be a tab change plus a push plus a sheet to read three lines, so the sheet is
        // opened here instead — same destination, one step.
        if case .submission(let id) = target { openSubmission = SubmissionRef(id: id); return }
        switch target {
        case .task, .project: openTarget = target
        // A record on another screen: the router walks there and hands the id over, exactly as a
        // tapped push does. One path, so the Inbox row and the lock screen cannot drift apart.
        default: router.open(target)
        }
    }

    private func markRead(_ n: NexusNotification) async {
        guard !n.isRead else { return }
        try? await APIClient.shared.markNotificationRead(id: n.id)
        await load()
    }
    private func markAll() async {
        try? await APIClient.shared.markAllNotificationsRead()
        await load()
    }
    /// The web's per-row trash: gone at once, put back if the server says no. Restorable from Audit.
    private func delete(_ n: NexusNotification) async {
        let before = items
        withAnimation(.easeOut(duration: 0.18)) { items.removeAll { $0.id == n.id } }
        do {
            try await APIClient.shared.deleteNotification(id: n.id)
            await reloadQuietly()
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            items = before
        }
    }
}

/// The Inbox row's context menu; none at all where the row has no actions (Dashboard's list).
private struct NotificationRowMenu: ViewModifier {
    let isRead: Bool
    let onMarkRead: (() -> Void)?
    let onDelete: (() -> Void)?

    func body(content: Content) -> some View {
        if onMarkRead == nil && onDelete == nil {
            content
        } else {
            content.contextMenu {
                if let onMarkRead, !isRead {
                    Button(action: onMarkRead) { Label(T("Mark as read"), systemImage: "checkmark") }
                }
                if let onDelete {
                    Button(role: .destructive, action: onDelete) { Label(T("Delete notification"), systemImage: "trash") }
                }
            }
        }
    }
}

struct NotificationRow: View {
    let notification: NexusNotification
    /// The web's trash button at the row's right (Inbox only; nil elsewhere).
    var onDelete: (() -> Void)? = nil
    /// The web's per-row "Mark as read" on an unread row, without opening it (UI tour run 9, P12).
    var onMarkRead: (() -> Void)? = nil
    let onTap: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            mark.accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(Self.keepSeparators(notification.title ?? notification.typeLabel)).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
                Text(Self.keepSeparators(notification.message ?? T("New notification"))).font(NXFont.text(14)).foregroundStyle(NX.mutedFg).lineLimit(2)
                Text(metaText).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            Spacer(minLength: 4)
            if !notification.isRead {
                // Near-black like the web's unread dot (it was violet).
                Circle().fill(NX.foreground).frame(width: 8, height: 8).padding(.top, 6)
            }
            if let onMarkRead, !notification.isRead {
                Button(action: onMarkRead) {
                    Image(systemName: "checkmark").font(.system(size: 13, weight: .medium))
                        .foregroundStyle(NX.foreground)
                        .frame(width: 34, height: 34)
                        .background(NX.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
                }
                .buttonStyle(.plain)
                .help(T("Mark as read"))
                .accessibilityLabel(T("Mark as read"))
            }
            if let onDelete {
                Button(action: onDelete) {
                    Image(systemName: "trash").font(.system(size: 13, weight: .medium))
                        .foregroundStyle(NX.foreground)
                        .frame(width: 34, height: 34)
                        .background(NX.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(T("Delete notification"))
            } else if notification.tapTarget != nil {
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
                    .foregroundStyle(NX.mutedFg).padding(.top, 4)
            }
        }
        .padding(14)
        .contentShape(Rectangle())
        .onTapGesture { onTap() }
        // Long press (right click on the Mac): the row's actions, as the web row's buttons.
        .modifier(NotificationRowMenu(isRead: notification.isRead, onMarkRead: onMarkRead, onDelete: onDelete))
    }

    /// The sender's avatar with the kind as a small badge (web inbox, 13 Oct 2026, from `actor`); system
    /// signals and rows from before the server kept the sender show the kind's mark instead.
    @ViewBuilder private var mark: some View {
        if let actor = notification.actor, !NotificationMark.isLegal(notification.type) {
            AvatarView(url: actor.avatar, initial: actor.initial, size: 38)
                .overlay(alignment: .bottomTrailing) {
                    kindMark(size: 18)
                        .overlay(Circle().strokeBorder(NX.card, lineWidth: 2))
                        .offset(x: 3, y: 3)
                }
        } else {
            kindMark(size: 38)
        }
    }

    /// The kind's own circle, mapped from the type as the web's notificationMark does (inbox.tsx): a chat
    /// bubble for threads and comments, an alarm for reminders and streaks, a calendar check for attendance…
    /// (UI tour 13 Oct 2026: every kind but "outside the office" was a violet "N").
    private func kindMark(size: CGFloat) -> some View {
        let mark = NotificationMark.of(notification.type)
        return ZStack {
            // On the card colour first, so the small badge is not see-through over the avatar.
            Circle().fill(NX.card)
            Circle().fill(mark.color.opacity(0.14))
            if let asset = mark.asset {
                Image(asset).renderingMode(.template).resizable().scaledToFit()
                    .frame(width: size * 0.46, height: size * 0.46).foregroundStyle(mark.color)
            } else {
                Image(systemName: mark.symbol).font(.system(size: size * 0.42, weight: .semibold)).foregroundStyle(mark.color)
            }
        }
        .frame(width: size, height: size)
    }

    /// " · " joined to the word before it, so a wrapped line never starts with "· PATS" (F-32).
    static func keepSeparators(_ s: String) -> String {
        s.replacingOccurrences(of: " · ", with: "\u{00A0}·\u{00A0}")
    }

    /// The web's own meta line, hint included: a row that opens something says so, and a row that
    /// opens nothing must not claim otherwise.
    private var metaText: String {
        // The date only, as on the web (the raw type under every row was noise).
        dateText
    }

    private var dateText: String {
        guard let d = ProjDate.parse(notification.createdAt) else { return "" }
        // Day and month only, as web fmtDay ("13 Oct"), UI tour run 7. Cached parser + formatter.
        return ProjDate.fmt("d MMM").string(from: d)
    }
}

/// The "narrow this list" chips, drawn by both notification surfaces: this screen and the
/// dashboard's bell panel.
///
/// Same capsule idiom as the Ticket screen's status filter and the attendance Submissions card —
/// this is the app's existing gesture for cutting a list down, and notifications do not need a
/// second one. The count rides on the chip because an empty bucket is never offered: a chip that is
/// there always has something behind it, and the number says how much.
struct NotificationFilterBar: View {
    let tabs: [NotificationFilterTab]
    @Binding var group: NotificationGroup
    /// The bell panel, where the bar sits inside a card that already has its own padding.
    var compact = false

    var body: some View {
        // "All" plus a single bucket is not a choice — every row is in that bucket either way.
        // Light underline tabs with counts (web UI sweep, 12 Oct 2026), the app's one filter look.
        if tabs.count > 2 {
            NXUnderlineTabs(items: tabs.map { NXTabItem(id: $0.group, label: $0.group.label, count: $0.count) },
                            selection: $group, accessibilityName: T("Notifications"))
        }
    }
}

/// The web's inbox rule (nexus-api.ts activeNotifications): a notification READ more than 7 days ago
/// leaves the list; unread ones always stay. createdAt stands in for the read time, as on the web.
/// Without it the app listed 50 where the web listed 19 (UI tour run 3, 13 Oct 2026).
func activeNotifications(_ list: [NexusNotification], maxAgeDays: Double = 7) -> [NexusNotification] {
    let cutoff = Date().addingTimeInterval(-maxAgeDays * 86400)
    return list.filter { n in
        if !n.isRead { return true }
        guard let raw = n.createdAt, let at = ChatStore.parseDate(raw) else { return false }
        return at >= cutoff
    }
}
