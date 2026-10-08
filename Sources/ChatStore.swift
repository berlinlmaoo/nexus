import SwiftUI
import Observation

extension Notification.Name {
    /// "A chat push just arrived while the app is open."
    ///
    /// Posted on the main thread by the notification delegate (NotificationManager.willPresent) for
    /// a push whose `type` is MESSAGE or MESSAGE_MENTION, with `userInfo["conversationId"]` set to
    /// the push's conversation (ChatPresence.conversationId(of:) reads it from the content). The open
    /// thread for that conversation polls at once instead of up to five seconds later, the Messages
    /// list refreshes, and the unread badges on Home and More re-count. Posting it with no
    /// conversationId refreshes the list and the badges only.
    static let nexusChatPush = Notification.Name("nexus.chat.push")
}

/// Chat state that outlives any one screen: the unread total behind the badges on Home and More,
/// which conversations are muted, and whether this server already speaks the newer chat endpoints.
///
/// Fed by every conversation-list fetch (APIClient.conversationsPage) and by the thread as it marks
/// messages read, so a badge never has to wait for the Messages screen to be opened.
@MainActor
@Observable
final class ChatStore {
    static let shared = ChatStore()

    /// What the badges show: the server's `totalUnread` when it sends one, otherwise the sum of the
    /// list's unread counts over the chats that are not muted.
    private(set) var totalUnread = 0 {
        didSet { if totalUnread != oldValue { AppIconBadge.sync() } }
    }
    /// conversationId → raw `mutedUntil` as the server last said it, "" for a chat known to be
    /// unmuted. Absent means this store has not seen the chat yet.
    private(set) var mutedUntilById: [String: String] = [:]
    /// nil until known. False once the server answered 404 to a mute: the old server has no such
    /// route, and an option that can only fail is better not drawn.
    private(set) var muteSupported: Bool?

    @ObservationIgnored private var unreadById: [String: Int] = [:]
    /// nil until tried; false once /api/conversations/unread answered 404 (old server).
    @ObservationIgnored private var unreadEndpoint: Bool?
    @ObservationIgnored private var lastRefresh: Date?
    @ObservationIgnored private var refreshing = false
    @ObservationIgnored private var ownerId: String?

    private init() {}

    // MARK: reading

    /// Whether a raw `mutedUntil` still mutes now. "forever", or any value this build cannot read
    /// as a date, counts as muted: the server only ever writes the field to mute.
    nonisolated static func isMuted(_ raw: String?, now: Date = Date()) -> Bool {
        guard let raw, !raw.isEmpty else { return false }
        guard let until = parseDate(raw) else { return true }
        return until > now
    }

    nonisolated static func parseDate(_ raw: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: raw) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: raw)
    }

    /// The store's word when it has one (it hears about a mute the moment it is set), else what the
    /// conversation itself carried.
    func isMuted(_ convo: Conversation) -> Bool {
        Self.isMuted(mutedUntilById[convo.id] ?? convo.mutedUntil)
    }

    func isMuted(conversationId: String) -> Bool {
        Self.isMuted(mutedUntilById[conversationId])
    }

    func mutedUntil(conversationId: String) -> String? {
        let raw = mutedUntilById[conversationId]
        return Self.isMuted(raw) ? raw : nil
    }

    // MARK: writing

    /// A fresh conversation list. Replaces what the store knew: the list is complete.
    func absorb(_ page: ConversationsResponse) {
        let list = page.conversations ?? []
        var unread: [String: Int] = [:]
        var muted: [String: String] = [:]
        for c in list {
            unread[c.id] = c.unreadCount ?? 0
            muted[c.id] = c.mutedUntil ?? ""
        }
        unreadById = unread
        mutedUntilById = muted
        // Both arrive together with the newer server; either one is proof it can mute.
        if page.totalUnread != nil || list.contains(where: { $0.mutedUntil != nil }) { muteSupported = true }
        totalUnread = max(0, page.totalUnread ?? localTotal())
        lastRefresh = Date()
    }

    /// The list as it was cached on disk, drawn before the network answers. Never overrides
    /// anything the store has already heard from the server in this session.
    func absorbCached(_ page: ConversationsResponse) {
        guard lastRefresh == nil else { return }
        absorb(page)
        lastRefresh = nil
    }

    /// The thread just marked this conversation read. Takes its count off the badge at once; the
    /// server's own total replaces this guess on the next refresh.
    func markedRead(_ conversationId: String) {
        guard let had = unreadById[conversationId] else {
            // A chat the store has never seen (opened from a push before any list loaded): there is
            // nothing to subtract, so ask the server instead.
            Task { await refreshUnread(force: false) }
            return
        }
        unreadById[conversationId] = 0
        if had > 0, !isMuted(conversationId: conversationId) {
            totalUnread = max(0, totalUnread - had)
        }
    }

    /// A mute was just set or cleared on the server.
    func setMuted(_ conversationId: String, until raw: String?) {
        mutedUntilById[conversationId] = raw ?? ""
        muteSupported = true
        if unreadEndpoint != true { totalUnread = max(0, localTotal()) }
    }

    /// The server answered 404 to a mute.
    func muteUnavailable() {
        muteSupported = false
    }

    /// Re-count the badge. Throttled to one request per 20 seconds, because it runs on every
    /// appearance of Home and More and on every return to the app; `force` (a chat push arrived)
    /// shortens that to 3 seconds, so a busy group pushing every second costs one request, not
    /// one per message per badge on screen.
    func refreshUnread(userId: String? = nil, force: Bool = false) async {
        if let userId, userId != ownerId {
            // Somebody else signed in on this launch: nothing of the previous person's may show.
            ownerId = userId
            totalUnread = 0
            unreadById = [:]
            mutedUntilById = [:]
            lastRefresh = nil
        }
        if refreshing { return }
        if let last = lastRefresh, Date().timeIntervalSince(last) < (force ? 3 : 20) { return }
        refreshing = true
        defer { refreshing = false }
        if unreadEndpoint != false {
            do {
                let r = try await APIClient.shared.chatUnread()
                if let total = r.totalUnread {
                    unreadEndpoint = true
                    totalUnread = max(0, total)
                    lastRefresh = Date()
                    return
                }
            } catch APIError.http(let code, _) where code == 404 {
                unreadEndpoint = false
            } catch {
                return
            }
        }
        // The old server: the whole list is the only place the counts live. `conversationsPage`
        // feeds `absorb`, which sets the total.
        _ = try? await APIClient.shared.conversationsPage()
    }

    private func localTotal() -> Int {
        unreadById.reduce(0) { sum, entry in
            Self.isMuted(mutedUntilById[entry.key]) ? sum : sum + entry.value
        }
    }
}

/// The small red count on the ways into Messages (the Chat tile on Home, the Messages tile in More).
///
/// Draws nothing at zero but stays in the hierarchy, so its refresh still runs: an empty view in a
/// SwiftUI `if` never appears, and a badge that only refreshes once it is already showing a number
/// would never show the first one.
struct ChatUnreadBadge: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.scenePhase) private var scenePhase
    @State private var store = ChatStore.shared

    var body: some View {
        let count = store.totalUnread
        let label: String = count > 99 ? "99+" : "\(count)"
        // Drawn exactly like the Inbox count on its More tile, so the two read as one family.
        Text(label)
            .font(NXFont.text(11, .bold)).monospacedDigit()
            .foregroundStyle(Color.white)
            .padding(.horizontal, 6)
            .frame(minWidth: 22, minHeight: 22)
            .background(NX.danger, in: Capsule())
            .opacity(count > 0 ? 1 : 0)
            .allowsHitTesting(false)
            .accessibilityHidden(count == 0)
            .accessibilityLabel(String(format: T("%d unread messages"), count))
            .task(id: auth.session?.userId) {
                await store.refreshUnread(userId: auth.session?.userId)
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                Task { await store.refreshUnread(userId: auth.session?.userId) }
            }
            .onReceive(NotificationCenter.default.publisher(for: .nexusChatPush)) { _ in
                Task { await store.refreshUnread(userId: auth.session?.userId, force: true) }
            }
    }
}
