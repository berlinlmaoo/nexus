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
                // Never stored: a whole screen goes through the router, not through this stack.
                case .screen:          EmptyView()
                }
            }
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
                        VStack(spacing: 8) {
                            Image(systemName: "tray").font(.system(size: 40)).foregroundStyle(NX.mutedFg)
                            Text(T("Inbox clean")).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                            Text(T("No pings. Enjoy the rare silence.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                        }.padding(.top, 50)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(items.enumerated()), id: \.element.id) { idx, n in
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
                .padding(16)
            }
            .refreshable { await load() }
        }
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
        guard let target = n.tapTarget else { return }
        if case .screen(let screen) = target { router.go(screen); return }
        openTarget = target
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
