import Foundation
import UserNotifications

/// Which chat is on screen right now, so a push for that same conversation is not shown as a banner
/// (the thread is already updating in front of the person), and its delivered notifications are
/// cleared when it opens — the way Messages and WhatsApp behave.
///
/// The thread view sets `visibleConversationId` on appear and clears it on disappear; the
/// notification delegate (NotificationManager.willPresent) reads it. Pushes for a conversation carry
/// it as the APNs `thread-id` and as `conversationId` in the payload (server, 8 Oct 2026).
@MainActor
enum ChatPresence {
    static var visibleConversationId: String?

    /// The conversation a notification belongs to: its thread identifier, else `conversationId` in the
    /// payload, else the id in a `/messages?c=<id>` link.
    nonisolated static func conversationId(of content: UNNotificationContent) -> String? {
        if !content.threadIdentifier.isEmpty { return content.threadIdentifier }
        if let id = content.userInfo["conversationId"] as? String, !id.isEmpty { return id }
        if let link = content.userInfo["link"] as? String,
           let items = URLComponents(string: link)?.queryItems,
           let id = items.first(where: { $0.name == "c" })?.value, !id.isEmpty { return id }
        return nil
    }

    /// Removes the conversation's notifications from Notification Center when the chat opens.
    static func clearDelivered(conversationId: String) {
        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { delivered in
            let ids = delivered
                .filter { ChatPresence.conversationId(of: $0.request.content) == conversationId }
                .map(\.request.identifier)
            if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
        }
    }
}

/// The number on the app icon: unread Inbox notifications plus unread chat messages, the same total
/// the server puts in every push's `aps.badge`. Set from here whenever either count changes in the
/// app, so reading a chat or the Inbox brings the icon down at once instead of at the next push.
@MainActor
enum AppIconBadge {
    static func sync() {
        let total = max(0, InboxBadge.shared.count + ChatStore.shared.totalUnread)
        UNUserNotificationCenter.current().setBadgeCount(total) { _ in }
    }
}
