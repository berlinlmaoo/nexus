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
        struct UserRef: Decodable, Sendable { let id: String?; let name: String? }
    }

    var isGroupish: Bool { type == "PROJECT" || type == "GROUP" }

    func title(meId: String?) -> String {
        if type == "DM" {
            let other = (members ?? []).first { ($0.userId ?? $0.user?.id) != meId }
            return other?.user?.name ?? name ?? "Direct"
        }
        return name ?? (type == "PROJECT" ? "Project chat" : "Group")
    }
    func initial(meId: String?) -> String { String(title(meId: meId).first ?? "?").uppercased() }
}

struct ChatMessage: Decodable, Identifiable, Sendable {
    let id: String
    let userId: String?
    let content: String
    let createdAt: String?
    let user: UserRef?
    struct UserRef: Decodable, Sendable { let name: String? }
}

struct ConversationsResponse: Decodable, Sendable { let conversations: [Conversation]? }
struct MessagesResponse: Decodable, Sendable { let messages: [ChatMessage]? }
