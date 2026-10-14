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
    /// false = a project room this person can read but not post in (Can view, access levels round 2,
    /// 13 Oct 2026). nil = a server from before it: posting stays open.
    let canPost: Bool?

    struct Member: Decodable, Sendable {
        let userId: String?
        let user: UserRef?
        struct UserRef: Decodable, Sendable { let id: String?; let name: String?; let avatar: String? }
    }

    private enum CodingKeys: String, CodingKey {
        case id, type, name, projectId, members, lastMessage, unreadCount, mutedUntil, canManageMembers, canPost
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
        canPost = (try? c.decodeIfPresent(Bool.self, forKey: .canPost)) ?? nil
    }

    var isGroupish: Bool { type == "PROJECT" || type == "GROUP" }

    private func otherMember(meId: String?) -> Member? {
        (members ?? []).first { ($0.userId ?? $0.user?.id) != meId }
    }

    func title(meId: String?) -> String {
        if type == "DM" {
            // A DM whose other side is unknown reads as the web names it (UI tour 13 Oct 2026: "Direct").
            return otherMember(meId: meId)?.user?.name ?? name ?? T("Direct message")
        }
        return name ?? (type == "PROJECT" ? "Project chat" : "Group")
    }
    /// The web's initials (messages list): first letters of the first two words, "Budi Z" -> "BZ",
    /// "Direct message" -> "DM". One letter made two different Budi rows look alike (UI tour run 3).
    func initial(meId: String?) -> String {
        let words = title(meId: meId).split(whereSeparator: { $0 == " " }).prefix(2)
        let letters = words.compactMap(\.first).map { String($0).uppercased() }.joined()
        return letters.isEmpty ? "?" : letters
    }
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
    /// "USER" or "SYSTEM" (owner, 8 Oct 2026). A row without it is a person's message: that is every
    /// row an older server sends, so nothing changes against one.
    let kind: String?
    /// What a SYSTEM row says happened; the sentence is built from it (ChatSystemText). nil on every
    /// USER row.
    let event: ChatSystemEvent?
    struct UserRef: Decodable, Sendable { let id: String?; let name: String?; let avatar: String? }
    /// Only what a quote needs to draw itself — never the full replied-to message.
    struct Quoted: Decodable, Sendable {
        let id: String
        let content: String?
        let attachmentType: String?
        /// The quoted picture, when the server sends it. Today's server leaves it out; the thread
        /// then takes it from the quoted message itself if that one is loaded.
        let attachmentUrl: String?
        let user: UserRef?

        private enum CodingKeys: String, CodingKey { case id, content, attachmentType, attachmentUrl, user }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            content = try? c.decodeIfPresent(String.self, forKey: .content)
            attachmentType = try? c.decodeIfPresent(String.self, forKey: .attachmentType)
            attachmentUrl = try? c.decodeIfPresent(String.self, forKey: .attachmentUrl)
            user = try? c.decodeIfPresent(UserRef.self, forKey: .user)
        }

        init(id: String, content: String?, attachmentType: String?, attachmentUrl: String? = nil, user: UserRef?) {
            self.id = id
            self.content = content
            self.attachmentType = attachmentType
            self.attachmentUrl = attachmentUrl
            self.user = user
        }
    }

    var isSystem: Bool { kind == "SYSTEM" }

    private enum CodingKeys: String, CodingKey {
        case id, userId, content, createdAt, user, attachmentUrl, attachmentType, replyTo, kind, event
    }

    /// Lenient past `id`: one row this build cannot fully read must not empty the whole page, and the
    /// two new fields in particular may arrive in a shape nobody has seen yet.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        userId = try? c.decodeIfPresent(String.self, forKey: .userId)
        content = (try? c.decodeIfPresent(String.self, forKey: .content)) ?? ""
        createdAt = try? c.decodeIfPresent(String.self, forKey: .createdAt)
        user = try? c.decodeIfPresent(UserRef.self, forKey: .user)
        attachmentUrl = try? c.decodeIfPresent(String.self, forKey: .attachmentUrl)
        attachmentType = try? c.decodeIfPresent(String.self, forKey: .attachmentType)
        replyTo = try? c.decodeIfPresent(Quoted.self, forKey: .replyTo)
        kind = try? c.decodeIfPresent(String.self, forKey: .kind)
        event = try? c.decodeIfPresent(ChatSystemEvent.self, forKey: .event)
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
    /// An `around=` page only: whether there are messages newer than the page.
    let hasMoreNewer: Bool?

    private enum CodingKeys: String, CodingKey { case messages, hasMore, nextCursor, hasMoreNewer }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        messages = try c.decodeIfPresent([ChatMessage].self, forKey: .messages)
        hasMore = try? c.decodeIfPresent(Bool.self, forKey: .hasMore)
        nextCursor = try? c.decodeIfPresent(String.self, forKey: .nextCursor)
        hasCursorField = c.contains(.nextCursor)
        hasMoreNewer = try? c.decodeIfPresent(Bool.self, forKey: .hasMoreNewer)
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

// MARK: - Group info (owner, 8 Oct 2026)
//
// GET /api/conversations/:id/info, /media and /search. Every field is optional and read leniently:
// these routes were built at the same time as this screen, and a field shaped differently from the
// contract must cost that one field, not the whole screen.

/// A person as these routes name them: `{ id, name }`.
struct ChatPersonRef: Decodable, Sendable, Hashable {
    let id: String?
    let name: String?

    private enum CodingKeys: String, CodingKey { case id, name }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try? c.decodeIfPresent(String.self, forKey: .id)
        name = try? c.decodeIfPresent(String.self, forKey: .name)
    }

    init(id: String?, name: String?) {
        self.id = id
        self.name = name
    }
}

/// GET /api/conversations/:id/info → `{ conversation, members, counts }`.
struct ChatInfoResponse: Decodable, Sendable {
    let conversation: ChatInfo?
    let members: [ChatInfoMember]
    let counts: ChatMediaCounts?

    private enum CodingKeys: String, CodingKey { case conversation, members, counts }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        conversation = try? c.decodeIfPresent(ChatInfo.self, forKey: .conversation)
        members = c.chatList(ChatInfoMember.self, forKey: .members)
        counts = try? c.decodeIfPresent(ChatMediaCounts.self, forKey: .counts)
    }

    init(conversation: ChatInfo?, members: [ChatInfoMember], counts: ChatMediaCounts?) {
        self.conversation = conversation
        self.members = members
        self.counts = counts
    }
}

struct ChatInfo: Decodable, Sendable {
    let id: String?
    /// "DM" | "GROUP" | "PROJECT".
    let type: String?
    let name: String?
    let description: String?
    let projectId: String?
    let createdAt: String?
    let createdBy: ChatPersonRef?
    let memberCount: Int?
    let mutedUntil: String?
    /// May add and remove people (GROUP, Manager and above).
    let canManageMembers: Bool?
    /// May change the name and the description (any member of a GROUP).
    let canEdit: Bool?
    /// May delete the group (servers since 9 Oct 2026): Manager and above, or the only member left.
    /// nil = a server without DELETE /api/conversations/:id — no Delete is offered.
    let canDelete: Bool?

    private enum CodingKeys: String, CodingKey {
        case id, type, name, description, projectId, createdAt, createdBy, memberCount, mutedUntil, canManageMembers, canEdit, canDelete
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try? c.decodeIfPresent(String.self, forKey: .id)
        type = try? c.decodeIfPresent(String.self, forKey: .type)
        name = try? c.decodeIfPresent(String.self, forKey: .name)
        description = try? c.decodeIfPresent(String.self, forKey: .description)
        projectId = try? c.decodeIfPresent(String.self, forKey: .projectId)
        createdAt = try? c.decodeIfPresent(String.self, forKey: .createdAt)
        createdBy = try? c.decodeIfPresent(ChatPersonRef.self, forKey: .createdBy)
        memberCount = try? c.decodeIfPresent(Int.self, forKey: .memberCount)
        mutedUntil = try? c.decodeIfPresent(String.self, forKey: .mutedUntil)
        canManageMembers = try? c.decodeIfPresent(Bool.self, forKey: .canManageMembers)
        canEdit = try? c.decodeIfPresent(Bool.self, forKey: .canEdit)
        canDelete = try? c.decodeIfPresent(Bool.self, forKey: .canDelete)
    }

    init(id: String?, type: String?, name: String?, description: String?, projectId: String?,
         memberCount: Int?, canManageMembers: Bool?, canEdit: Bool?) {
        self.id = id
        self.type = type
        self.name = name
        self.description = description
        self.projectId = projectId
        self.createdAt = nil
        self.createdBy = nil
        self.memberCount = memberCount
        self.mutedUntil = nil
        self.canManageMembers = canManageMembers
        self.canEdit = canEdit
        self.canDelete = nil
    }
}

struct ChatInfoMember: Decodable, Sendable, Identifiable, Hashable {
    let userId: String
    let name: String?
    let avatar: String?
    let isMe: Bool
    /// Manager, BoD or One Above All in the room's workspace — the people who may add and remove.
    let isAdmin: Bool
    /// Set for someone who has left the company (offboarding); drawn as LeftTag.
    let deactivatedAt: String?

    var id: String { userId }
    var displayName: String { (name?.isEmpty == false ? name : nil) ?? "—" }
    var initial: String { String(displayName.first ?? "?").uppercased() }

    private enum CodingKeys: String, CodingKey { case userId, name, avatar, isMe, isAdmin, deactivatedAt }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userId = try c.decode(String.self, forKey: .userId)
        name = try? c.decodeIfPresent(String.self, forKey: .name)
        avatar = try? c.decodeIfPresent(String.self, forKey: .avatar)
        isMe = ((try? c.decodeIfPresent(Bool.self, forKey: .isMe)) ?? nil) ?? false
        isAdmin = ((try? c.decodeIfPresent(Bool.self, forKey: .isAdmin)) ?? nil) ?? false
        deactivatedAt = try? c.decodeIfPresent(String.self, forKey: .deactivatedAt)
    }

    init(userId: String, name: String?, avatar: String?, isMe: Bool, isAdmin: Bool, deactivatedAt: String?) {
        self.userId = userId
        self.name = name
        self.avatar = avatar
        self.isMe = isMe
        self.isAdmin = isAdmin
        self.deactivatedAt = deactivatedAt
    }
}

struct ChatMediaCounts: Decodable, Sendable {
    let photos: Int
    let links: Int
    let docs: Int
    var total: Int { photos + links + docs }

    private enum CodingKeys: String, CodingKey { case photos, links, docs }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        photos = ((try? c.decodeIfPresent(Int.self, forKey: .photos)) ?? nil) ?? 0
        links = ((try? c.decodeIfPresent(Int.self, forKey: .links)) ?? nil) ?? 0
        docs = ((try? c.decodeIfPresent(Int.self, forKey: .docs)) ?? nil) ?? 0
    }
}

/// GET /api/conversations/:id/media?type=photos|links|docs&cursor= → `{ items, nextCursor }`.
struct ChatMediaPage: Decodable, Sendable {
    let items: [ChatMediaItem]
    let nextCursor: String?

    private enum CodingKeys: String, CodingKey { case items, nextCursor }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = c.chatList(ChatMediaItem.self, forKey: .items)
        nextCursor = try? c.decodeIfPresent(String.self, forKey: .nextCursor)
    }
}

struct ChatMediaItem: Decodable, Sendable, Identifiable {
    let messageId: String
    let createdAt: String?
    let sender: ChatPersonRef?
    /// The file (server-relative or absolute) for photos and docs; the address for links.
    let url: String
    let attachmentType: String?
    let title: String?

    /// A message can carry several links, one item each: the id has to tell them apart.
    var id: String { messageId + "|" + url }

    private enum CodingKeys: String, CodingKey { case messageId, createdAt, sender, url, attachmentType, title }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        messageId = try c.decode(String.self, forKey: .messageId)
        url = try c.decode(String.self, forKey: .url)
        createdAt = try? c.decodeIfPresent(String.self, forKey: .createdAt)
        sender = try? c.decodeIfPresent(ChatPersonRef.self, forKey: .sender)
        attachmentType = try? c.decodeIfPresent(String.self, forKey: .attachmentType)
        title = try? c.decodeIfPresent(String.self, forKey: .title)
    }
}

/// GET /api/conversations/:id/search?q=&cursor= → `{ results, nextCursor }`.
struct ChatSearchPage: Decodable, Sendable {
    let results: [ChatSearchHit]
    let nextCursor: String?

    private enum CodingKeys: String, CodingKey { case results, nextCursor }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        results = c.chatList(ChatSearchHit.self, forKey: .results)
        nextCursor = try? c.decodeIfPresent(String.self, forKey: .nextCursor)
    }
}

struct ChatSearchHit: Decodable, Sendable, Identifiable {
    let messageId: String
    let createdAt: String?
    let sender: ChatPersonRef?
    let snippet: String

    var id: String { messageId }

    private enum CodingKeys: String, CodingKey { case messageId, createdAt, sender, snippet }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        messageId = try c.decode(String.self, forKey: .messageId)
        createdAt = try? c.decodeIfPresent(String.self, forKey: .createdAt)
        sender = try? c.decodeIfPresent(ChatPersonRef.self, forKey: .sender)
        snippet = ((try? c.decodeIfPresent(String.self, forKey: .snippet)) ?? nil) ?? ""
    }
}

/// A successful answer whose body this app does not need (PATCH, DELETE). Read as nothing, so a body
/// shaped differently from what was agreed can never turn a change that was made into "Couldn't …".
struct ChatAck: Decodable, Sendable {
    init(from decoder: Decoder) throws {}
}

/// One element of a list that may be unreadable: nil instead of failing the whole list. Never throws,
/// so a decoder walking an array always moves past it.
struct ChatLossyElement<Wrapped: Decodable>: Decodable {
    let value: Wrapped?
    init(from decoder: Decoder) throws { value = try? Wrapped(from: decoder) }
}

extension KeyedDecodingContainer {
    /// An array whose unreadable elements are dropped; empty when absent or not an array.
    func chatList<Element: Decodable>(_ type: Element.Type, forKey key: Key) -> [Element] {
        let wrapped = (try? decodeIfPresent([ChatLossyElement<Element>].self, forKey: key)) ?? nil
        return (wrapped ?? []).compactMap(\.value)
    }
}
