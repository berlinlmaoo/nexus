import Foundation

/// GET /api/conversations.
struct Conversation: Decodable, Identifiable, Sendable {
    let id: String
    let type: String?      // DM | GROUP | PROJECT
    let name: String?
    let projectId: String?
    let members: [Member]?
    let lastMessage: ChatMessage?
    let unreadCount: Int?

    struct Member: Decodable, Sendable {
        let userId: String?
        let user: UserRef?
        struct UserRef: Decodable, Sendable { let id: String?; let name: String?; let avatar: String? }
    }

    var isGroupish: Bool { type == "PROJECT" || type == "GROUP" }

    private func otherMember(meId: String?) -> Member? {
        (members ?? []).first { ($0.userId ?? $0.user?.id) != meId }
    }

    func title(meId: String?) -> String {
        if type == "DM" {
            return otherMember(meId: meId)?.user?.name ?? name ?? "Direct"
        }
        return name ?? (type == "PROJECT" ? "Project chat" : "Group")
    }
    func initial(meId: String?) -> String { String(title(meId: meId).first ?? "?").uppercased() }
    /// DM counterpart's photo (nil for group/project — those use a group icon).
    func avatarURL(meId: String?) -> String? { type == "DM" ? otherMember(meId: meId)?.user?.avatar : nil }
}

struct ChatMessage: Decodable, Identifiable, Sendable {
    let id: String
    let userId: String?
    let content: String
    let createdAt: String?
    let user: UserRef?
    /// Set when the message carries a picture. Server-relative, e.g. "/api/files/chat/<uuid>.jpg".
    let attachmentUrl: String?
    let attachmentType: String?
    /// The message this one answers. Optional because every message sent before replies existed
    /// has none, and the server sends null rather than omitting the key.
    let replyTo: Quoted?
    struct UserRef: Decodable, Sendable { let id: String?; let name: String?; let avatar: String? }
    /// Only what a quote needs to draw itself — never the full replied-to message.
    struct Quoted: Decodable, Sendable {
        let id: String
        let content: String?
        let attachmentType: String?
        let user: UserRef?
    }
}

struct ChatUpload: Decodable, Sendable { let url: String; let type: String? }
struct ConversationsResponse: Decodable, Sendable { let conversations: [Conversation]? }
struct ConversationResponse: Decodable, Sendable { let conversation: Conversation }
struct MessagesResponse: Decodable, Sendable { let messages: [ChatMessage]? }
