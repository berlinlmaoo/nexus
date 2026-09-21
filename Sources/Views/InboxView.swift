import SwiftUI

/// Port of web inbox.tsx ("Signal Inbox"): unread banner + notification rows (icon, title,
/// message, date·type) + mark-read / mark-all.
struct InboxView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppRouter.self) private var router
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
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                content
            }
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
            .navigationTitle(T("Signal Inbox"))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await markAll() } } label: { Label(T("Mark all"), systemImage: "checkmark.circle") }
                        .disabled(unread == 0)
                }
            }
            .task { await load() }
        }
    }

    @ViewBuilder private var content: some View {
        if loading {
            SkeletonList()
        } else if let error {
            errorState(error)
        } else {
            ScrollView {
                VStack(spacing: 12) {
                    HStack {
                        Text("\(unread) unread signal(s) waiting for you.")
                            .font(NXFont.text(13, .semibold)).foregroundStyle(NX.violetText)
                        Spacer()
                    }
                    .padding(14)
                    .background(NX.violet.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(NX.violet.opacity(0.12)))

                    if items.isEmpty {
                        EmptyState(icon: "tray", title: T("Inbox clean"),
                                   subtitle: T("Requests to approve, replies to your tickets, mentions and announcements land here the moment they happen. Nothing needs you right now."),
                                   tint: NX.success, compact: true)
                    } else {
                        NotificationFilterBar(tabs: tabs, group: $group)
                        if shown.isEmpty {
                            EmptyState(icon: "line.3.horizontal.decrease.circle", title: T("Nothing of this kind"),
                                       subtitle: T("This filter only shows one type of signal. Everything else is still in All."),
                                       actionTitle: T("Show all"), actionIcon: "tray.full", action: { group = .all }, compact: true)
                        } else {
                            VStack(spacing: 0) {
                                ForEach(Array(shown.enumerated()), id: \.element.id) { idx, n in
                                    if idx > 0 { Divider().overlay(NX.border) }
                                    NotificationRow(notification: n) { open(n) }
                                }
                            }
                            .background {
                                RoundedRectangle(cornerRadius: 18, style: .continuous).fill(NX.card)
                                    .nexusShadowSoft()
                                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
                            }
                        }
                    }
                }
                .padding(16)
            }
            .refreshable { await load() }
        }
    }

    private var shown: [NexusNotification] {
        group == .all ? items : items.filter { $0.group == group }
    }

    private func errorState(_ msg: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark").font(.system(size: 40)).foregroundStyle(NX.mutedFg)
            Text(msg).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
            Button(T("Try again")) { Task { await load() } }.buttonStyle(NexusPrimaryButton(fullWidth: false))
        }.padding(32).frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func load() async {
        error = nil
        do {
            let res = try await APIClient.shared.notifications()
            items = res.notifications ?? []
            unread = res.unreadCount ?? items.filter { !$0.isRead }.count
            tabs = notificationFilterTabs(items)
            // The last thing in a bucket can be deleted while its chip is selected, and a filter
            // pinned to a bucket that no longer has a chip shows an empty list with no way back.
            if !tabs.contains(where: { $0.group == group }) { group = .all }
        } catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Login required to open the inbox.") }
        loading = false
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
}

struct NotificationRow: View {
    let notification: NexusNotification
    let onTap: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().fill(NX.violet.opacity(0.12)).frame(width: 38, height: 38)
                Text("N").font(NXFont.display(15, .black)).foregroundStyle(NX.violetText)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(notification.title ?? notification.typeLabel).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                Text(notification.message ?? T("New NEXUS signal arrived.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).lineLimit(2)
                Text(metaText).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            Spacer(minLength: 4)
            if !notification.isRead {
                Circle().fill(NX.violet).frame(width: 8, height: 8).padding(.top, 6)
            }
            if notification.tapTarget != nil {
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
                    .foregroundStyle(NX.mutedFg).padding(.top, 4)
            }
        }
        .padding(14)
        .contentShape(Rectangle())
        .onTapGesture { onTap() }
    }

    /// The web's own meta line, hint included: a row that opens something says so, and a row that
    /// opens nothing must not claim otherwise.
    private var metaText: String {
        let base = "\(dateText) · \(notification.type ?? "signal")"
        return notification.tapTarget == nil ? base : base + " · " + T("tap to open")
    }

    private var dateText: String {
        guard let d = ProjDate.parse(notification.createdAt) else { return "" }
        return ProjDate.fmt("d MMM, HH:mm").string(from: d)   // cached parser + formatter
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
        if tabs.count > 2 {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(tabs) { t in
                        let on = group == t.group
                        Button { group = t.group } label: {
                            HStack(spacing: 5) {
                                Text(t.group.label).font(NXFont.text(compact ? 11 : 12, .semibold))
                                Text("\(t.count)").font(NXFont.text(compact ? 9 : 10, .bold))
                                    .padding(.horizontal, 5).padding(.vertical, 1)
                                    .background(on ? Color.white.opacity(0.25) : NX.muted, in: Capsule())
                            }
                            .foregroundStyle(on ? Color.white : NX.mutedFg)
                            .padding(.horizontal, compact ? 10 : 13)
                            .padding(.vertical, compact ? 6 : 7)
                            .background(on ? NX.violet : NX.card, in: Capsule())
                            .overlay(Capsule().strokeBorder(on ? Color.clear : NX.border))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(t.group.label), \(t.count)")
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }
}
