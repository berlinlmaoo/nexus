import SwiftUI

/// Port of web inbox.tsx ("Signal Inbox"): unread banner + notification rows (icon, title,
/// message, date·type) + mark-read / mark-all.
struct InboxView: View {
    @Environment(AuthStore.self) private var auth
    @State private var items: [NexusNotification] = []
    @State private var unread = 0
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                content
            }
            .navigationTitle("Signal Inbox")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { Task { await markAll() } } label: { Label("Mark all", systemImage: "checkmark.circle") }
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
                            .font(NXFont.text(13, .semibold)).foregroundStyle(NX.violet)
                        Spacer()
                    }
                    .padding(14)
                    .background(NX.violet.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(NX.violet.opacity(0.12)))

                    if items.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "tray").font(.system(size: 40)).foregroundStyle(NX.mutedFg)
                            Text("Inbox clean").font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                            Text("No pings. Enjoy the rare silence.").font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                        }.padding(.top, 50)
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(items.enumerated()), id: \.element.id) { idx, n in
                                if idx > 0 { Divider().overlay(NX.border) }
                                NotificationRow(notification: n) { await markRead(n) }
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
            Button("Coba lagi") { Task { await load() } }.buttonStyle(NexusPrimaryButton(fullWidth: false))
        }.padding(32).frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func load() async {
        error = nil
        do {
            let res = try await APIClient.shared.notifications()
            items = res.notifications ?? []
            unread = res.unreadCount ?? items.filter { !$0.isRead }.count
        } catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "Login/session diperlukan untuk buka inbox." }
        loading = false
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
    let onRead: () async -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().fill(NX.violet.opacity(0.12)).frame(width: 38, height: 38)
                Text("N").font(NXFont.display(15, .black)).foregroundStyle(NX.violet)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(notification.title ?? notification.typeLabel).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                Text(notification.message ?? "New NEXUS signal arrived.").font(NXFont.text(13)).foregroundStyle(NX.mutedFg).lineLimit(2)
                Text("\(dateText) · \(notification.type ?? "signal")").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            Spacer(minLength: 4)
            if !notification.isRead {
                Circle().fill(NX.violet).frame(width: 8, height: 8).padding(.top, 6)
            }
        }
        .padding(14)
        .contentShape(Rectangle())
        .onTapGesture { Task { await onRead() } }
    }

    private var dateText: String {
        guard let d = ProjDate.parse(notification.createdAt) else { return "" }
        return ProjDate.fmt("d MMM, HH:mm").string(from: d)   // cached parser + formatter
    }
}
