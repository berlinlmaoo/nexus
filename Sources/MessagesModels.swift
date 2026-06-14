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
    struct UserRef: Decodable, Sendable { let id: String?; let name: String?; let avatar: String? }
}

struct ConversationsResponse: Decodable, Sendable { let conversations: [Conversation]? }
struct MessagesResponse: Decodable, Sendable { let messages: [ChatMessage]? }
