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
    /// When this person's notifications for the chat come back on: an ISO time, or nil when it is
    /// not muted. Only the newer server sends it, and it stores "Always" as a far-future date.
    let mutedUntil: String?
    /// Whether this person may add or remove people here: GROUP rooms only, Manager and above
    /// (owner, 8 Oct 2026). Anyone may still leave. nil = a server from before the rule, which
    /// keeps today's behaviour (the add button stays).
    let canManageMembers: Bool?

    struct Member: Decodable, Sendable {
        let userId: String?
        let user: UserRef?
        struct UserRef: Decodable, Sendable { let id: String?; let name: String?; let avatar: String? }
    }

    private enum CodingKeys: String, CodingKey {
        case id, type, name, projectId, members, lastMessage, unreadCount, mutedUntil, canManageMembers
    }

    /// Written out only so `mutedUntil` and `canManageMembers` can be read leniently. Every other
    /// field decodes exactly as the synthesized version did; a field the old server never sent must
    /// not be able to empty the whole chat list if the new one shapes it differently from what was
    /// agreed.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        type = try c.decodeIfPresent(String.self, forKey: .type)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        projectId = try c.decodeIfPresent(String.self, forKey: .projectId)
        members = try c.decodeIfPresent([Member].self, forKey: .members)
        lastMessage = try c.decodeIfPresent(ChatMessage.self, forKey: .lastMessage)
        unreadCount = try c.decodeIfPresent(Int.self, forKey: .unreadCount)
        mutedUntil = try? c.decodeIfPresent(String.self, forKey: .mutedUntil)
        canManageMembers = try? c.decodeIfPresent(Bool.self, forKey: .canManageMembers)
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

struct ConversationsResponse: Decodable, Sendable {
    let conversations: [Conversation]?
    /// Unread messages across the chats that are not muted (mentions still count). Newer server
    /// only; without it the badges add up the list's own `unreadCount`s.
    let totalUnread: Int?

    private enum CodingKeys: String, CodingKey { case conversations, totalUnread }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        conversations = try c.decodeIfPresent([Conversation].self, forKey: .conversations)
        totalUnread = try? c.decodeIfPresent(Int.self, forKey: .totalUnread)
    }
}

struct ConversationResponse: Decodable, Sendable { let conversation: Conversation }

/// One page of a thread: GET /api/conversations/:id/messages.
///
/// The old server answers `{ messages, hasMore }` — the newest page, oldest first — and ignores an
/// `after=` it does not know. The newer one adds `nextCursor` (opaque, sent back as `before`) and,
/// for `after=<id>`, answers only what is strictly newer than that message.
struct MessagesResponse: Decodable, Sendable {
    let messages: [ChatMessage]?
    let hasMore: Bool?
    let nextCursor: String?
    /// True when the answer carried a `nextCursor` key at all, null included. Only the newer server
    /// writes one, which is how a poll tells an `after=` answer from an old server ignoring it.
    let hasCursorField: Bool

    private enum CodingKeys: String, CodingKey { case messages, hasMore, nextCursor }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        messages = try c.decodeIfPresent([ChatMessage].self, forKey: .messages)
        hasMore = try? c.decodeIfPresent(Bool.self, forKey: .hasMore)
        nextCursor = try? c.decodeIfPresent(String.self, forKey: .nextCursor)
        hasCursorField = c.contains(.nextCursor)
    }
}

/// POST /api/conversations/:id/messages answers `{ message }` with status 201.
///
/// Read leniently on purpose: the message is already in the conversation by the time this arrives,
/// so a body this build cannot read must never turn a delivered message into "Couldn't send".
struct SentMessageResponse: Decodable, Sendable {
    let message: ChatMessage?

    private enum CodingKeys: String, CodingKey { case message }

    init(from decoder: Decoder) throws {
        if let c = try? decoder.container(keyedBy: CodingKeys.self) {
            message = try? c.decodeIfPresent(ChatMessage.self, forKey: .message)
        } else {
            message = nil
        }
    }
}

/// GET /api/conversations/unread — `{ totalUnread, mentions }`, the cheap call behind the badges.
/// Newer server only; the old one answers 404 and the badges fall back to the conversation list.
struct ChatUnreadResponse: Decodable, Sendable {
    let totalUnread: Int?
    let mentions: Int?

    private enum CodingKeys: String, CodingKey { case totalUnread, mentions }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        totalUnread = try? c.decodeIfPresent(Int.self, forKey: .totalUnread)
        mentions = try? c.decodeIfPresent(Int.self, forKey: .mentions)
    }
}

/// PATCH /api/conversations/:id/mute — `{ mutedUntil }` back, null once unmuted.
struct ChatMuteResponse: Decodable, Sendable {
    let mutedUntil: String?

    private enum CodingKeys: String, CodingKey { case mutedUntil }

    init(from decoder: Decoder) throws {
        if let c = try? decoder.container(keyedBy: CodingKeys.self) {
            mutedUntil = try? c.decodeIfPresent(String.self, forKey: .mutedUntil)
        } else {
            mutedUntil = nil
        }
    }
}
