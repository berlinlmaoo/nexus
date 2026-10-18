import Foundation
import Observation
import SwiftUI
import UIKit

/// Something that rode along with a question, kept so the thread can still show it.
///
/// It has two lives. Freshly attached it is bytes in this process and nothing else — `bytes` is the
/// file the composer is holding, and there is no copy anywhere else yet. Once the answer lands the
/// server keeps what was sent, under /api/files behind the same session as every other upload in the
/// app, and history hands it back with a `url`. That second life is what makes the chip survive the
/// app being killed, and what makes it worth tapping later: a handle onto a real file rather than a
/// paperclip drawn from a remembered name.
///
/// The shim's copy is a third thing and unrelated: /api/gideon still hands it the file, it still
/// writes it to its workdir, and it still deletes it once it has answered.
struct GideonAttachment: Sendable, Equatable {
    enum Kind: Sendable, Equatable { case image, document }

    let kind: Kind
    /// Filename with its extension for a document. Empty for a photo, which never had one.
    let name: String
    /// The bytes this process is still holding — the downscaled JPEG for a photo, the file byte for
    /// byte for a document. Nil for anything read back from history, where the file is at `url`.
    ///
    /// Carried for BOTH kinds, not just the picture it started as, because for the thirty to ninety
    /// seconds a question is open this is the only copy of the file that exists anywhere the app can
    /// reach: the server keeps nothing until it has an answer to keep it with. It is what the chip
    /// draws its thumbnail from and, more importantly, what it opens.
    let bytes: Data?
    /// Where the file lives now, e.g. "/api/files/attachments/gideon/<uuid>.pdf".
    ///
    /// A PATH and never a full URL, the same as every other file reference in this app: the host is
    /// added where it is used, so the file keeps working over the office LAN. Nil while the question
    /// is still in flight — nothing is stored until the turn has an answer to be stored with.
    let url: String?
    /// The server's type for it, for choosing a viewer. Empty for one that is not stored yet.
    let mime: String

    init(kind: Kind, name: String, bytes: Data?, url: String? = nil, mime: String = "") {
        self.kind = kind
        self.name = name
        self.bytes = bytes
        self.url = url
        self.mime = mime
    }
}

// MARK: - the new GIDEON (dev server, 12 Oct 2026: Notion AI 1:1 — context, steps, sources, cards, approval)

/// A string that may arrive as a string, a number, a bool or null.
struct GideonLoose: Decodable, Sendable, Equatable {
    let text: String?
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { text = nil }
        else if let s = try? c.decode(String.self) { text = s }
        else if let d = try? c.decode(Double.self) { text = (d == d.rounded() && abs(d) < 9e15) ? String(Int64(d)) : String(d) }
        else if let b = try? c.decode(Bool.self) { text = b ? "true" : "false" }
        else { text = nil }
    }
}

/// One thing GIDEON did while answering ("Reading Finance Management").
struct GideonStep: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let tool: String?
    /// The human handle the tool worked on (a search query, a project or task name). The step line is
    /// worded from `tool` + `arg` in the app's language, like the web's stepText; `label` is the
    /// server's English fallback for a tool the app does not know yet.
    var arg: String? = nil
    let label: String?
    let status: String?
    var error: String? = nil
}

/// Something an answer is drawn from: a task, project, page… the account can open.
struct GideonRef: Decodable, Sendable, Equatable, Identifiable, Hashable {
    let kind: String
    let id: String
    let title: String?
    let projectId: String?
}

/// Something GIDEON made or changed (with "Don't ask" or after an approval).
struct GideonCard: Decodable, Sendable, Equatable, Identifiable {
    let kind: String?
    let action: String?
    let id: String
    let title: String?
    let projectName: String?
    let status: String?
}

/// A change GIDEON proposes and waits to be approved for ("Review" mode).
struct GideonProposal: Decodable, Sendable, Equatable, Identifiable {
    let id: String
    let action: String?
    let summary: String?
    let status: String
    let error: String?
    let diff: [Row]?
    /// book_room only (16 Oct 2026): what the booking card draws. Builds before it ignore the field, and the
    /// server refuses their Apply ("open on the latest app or the web to choose a room").
    let booking: GideonBooking?
    /// move_room_booking / cancel_room_booking only (16 Oct 2026): the booking before and after. Builds before it
    /// ignore the field and draw the diff rows; the server refuses their Apply ("open on the latest app or the web").
    let bookingChange: GideonBookingChange?
    struct Row: Decodable, Sendable, Equatable {
        let field: String?
        let from: GideonLoose?
        let to: GideonLoose?
    }
    var isPending: Bool { status == "PENDING" }
}

/// A room GIDEON wants to book (web GideonBookingView): the slot as ISO instants, the room named (or nil: the
/// person picks it on the card), and once applied the booking made.
struct GideonBooking: Decodable, Sendable, Equatable {
    let title: String?
    let startsAt: String?
    let endsAt: String?
    let room: String?
    let bookingId: String?
}

/// The room and slot picked on the card, sent with Apply; the server checks both again. On a move card it also
/// carries the booking being moved; a cancel card sends only that (`cancel(_:)`, room and slot empty).
struct GideonBookingChoice: Sendable, Equatable {
    let room: String
    let startsAt: String
    let endsAt: String
    var bookingId: String? = nil

    static func cancel(_ bookingId: String) -> GideonBookingChoice {
        GideonBookingChoice(room: "", startsAt: "", endsAt: "", bookingId: bookingId)
    }

    /// The `booking` object of POST /api/gideon/proposals/:id.
    var body: [String: Any] {
        var b: [String: Any] = [:]
        if !room.isEmpty { b["room"] = room; b["startsAt"] = startsAt; b["endsAt"] = endsAt }
        if let bookingId { b["bookingId"] = bookingId }
        return b
    }
}

/// A booking GIDEON wants to move or cancel (web GideonBookingChangeView): the booking as it was when the card was
/// made, where a move puts it (its room nil when it is picked on the card), and once applied where it landed.
struct GideonBookingChange: Decodable, Sendable, Equatable {
    struct Slot: Decodable, Sendable, Equatable {
        let room: String?
        let startsAt: String
        let endsAt: String
    }
    struct After: Decodable, Sendable, Equatable {
        let room: String?
        let candidates: [String]?
        let startsAt: String
        let endsAt: String
    }
    let kind: String
    let bookingId: String
    let title: String?
    let bookedBy: String?
    let before: Slot
    let after: After?
    let applied: Slot?
    var isMove: Bool { kind == "move" }
}

/// GET /api/room-bookings/availability: every room for one slot, and the nearest free slots when none is free.
struct GideonRoomAvailability: Decodable, Sendable, Equatable {
    struct Room: Decodable, Sendable, Equatable, Identifiable {
        let room: String
        let free: Bool
        let busy: Busy?
        var id: String { room }
        struct Busy: Decodable, Sendable, Equatable { let title: String?; let by: String?; let endsAt: String? }
    }
    struct Slot: Decodable, Sendable, Equatable, Identifiable {
        let startsAt: String
        let endsAt: String
        var id: String { startsAt }
    }
    let rooms: [Room]
    let freeSlots: [Slot]
}

/// Where the person asked from: GIDEON reads that project first, with the person's own access.
///
/// Sent as the body's `context` exactly as the web's streamGideon builds it (lib/gideon.ts):
/// `{projectId?, taskId?, docId?, refs?}` — the page on screen (project / task / doc) plus the pages
/// added with @. The server re-checks access on every id and silently drops what this account cannot see.
struct GideonContext: Equatable, Sendable {
    var projectId: String?
    var projectName: String?
    var taskId: String?
    var taskTitle: String?
    /// A page (doc) the person is reading (web pushGideonPage kind "doc").
    var docId: String? = nil
    var docTitle: String? = nil
    /// Pages, tasks and projects added with @ in the composer (web chips; at most 8). The server checks
    /// each one and drops what this account cannot open.
    var refs: [GideonRef] = []
    /// True when this names a page (project / task / doc), apart from the @ refs.
    var hasPage: Bool { projectId != nil || taskId != nil || docId != nil }
    var isEmpty: Bool { !hasPage && refs.isEmpty }
    /// The same context without the page part (the @ refs stay).
    var withoutPage: GideonContext { GideonContext(refs: refs) }
    /// The chip's words (web chipLabel): the task, else the doc, else the project.
    var pageLabel: String? {
        if let taskTitle, !taskTitle.isEmpty {
            if let projectName, !projectName.isEmpty { return "\(projectName) › \(taskTitle)" }
            return taskTitle
        }
        if let docTitle, !docTitle.isEmpty { return docTitle }
        return projectName
    }
    /// The name the empty state and the suggestions use (web chipLabel without the project prefix).
    var shortLabel: String? {
        if let taskTitle, !taskTitle.isEmpty { return taskTitle }
        if let docTitle, !docTitle.isEmpty { return docTitle }
        return projectName
    }
    var json: [String: Any] {
        var o: [String: Any] = [:]
        if let projectId { o["projectId"] = projectId }
        if let taskId { o["taskId"] = taskId }
        if let docId { o["docId"] = docId }
        if !refs.isEmpty { o["refs"] = refs.map { ["kind": $0.kind, "id": $0.id] } }
        return o
    }
}

/// Which writes wait for the person (web GIDEON_APPROVAL_MODES; same ids as the server's needsApproval).
enum GideonApprovalMode: String, CaseIterable, Identifiable, Sendable {
    case alwaysAsk = "always_ask"
    case review
    case dontAsk = "dont_ask"

    var id: String { rawValue }
    static let fallback: GideonApprovalMode = .review

    var name: String {
        switch self {
        case .alwaysAsk: return T("Always ask")
        case .review: return T("Review before writing")
        case .dontAsk: return T("Don't ask")
        }
    }

    var blurb: String {
        switch self {
        case .alwaysAsk: return T("Every change GIDEON wants to make waits for you.")
        case .review: return T("Edits, comments and tasks for other people wait for you. Your own new tasks and docs are made directly.")
        case .dontAsk: return T("GIDEON makes changes right away, as you.")
        }
    }
}

/// The pages on screen that GIDEON should treat as "here" (web lib/gideon-ai.ts pushGideonPage /
/// useGideonPage): a project board, a task, a doc register themselves while they are showing and leave
/// when they go. The panel reads the TOP one when it opens or starts a new chat, which is what makes "task
/// disini" mean the project the person is looking at — and never a project from an earlier "Ask GIDEON"
/// (owner, 13 Oct 2026: the singleton kept the last project's context alive on the sidebar page).
@MainActor
final class GideonPages {
    static let shared = GideonPages()
    private var stack: [(token: UUID, context: GideonContext)] = []
    private init() {}

    /// The page on screen now, or nil (Home, the GIDEON page itself, a list).
    var current: GideonContext? { stack.last?.context }

    func push(_ context: GideonContext, token: UUID) {
        stack.removeAll { $0.token == token }
        stack.append((token, context))
    }

    func pop(_ token: UUID) {
        stack.removeAll { $0.token == token }
    }

    /// Signing out: nothing from the last session is "here" any more.
    func reset() { stack.removeAll() }
}

private struct GideonPageModifier: ViewModifier {
    let context: GideonContext?
    @State private var token = UUID()

    func body(content: Content) -> some View {
        content
            .onAppear { register(context) }
            .onDisappear { GideonPages.shared.pop(token) }
            .onChange(of: context) { _, next in register(next) }
    }

    private func register(_ c: GideonContext?) {
        if let c, c.hasPage { GideonPages.shared.push(c, token: token) } else { GideonPages.shared.pop(token) }
    }
}

extension View {
    /// Marks this screen as the page GIDEON is asked about while it is showing (web pushGideonPage).
    func gideonPage(_ context: GideonContext?) -> some View {
        modifier(GideonPageModifier(context: context))
    }
}

/// One conversation in the chats list.
struct GideonChatSummary: Decodable, Identifiable, Sendable {
    let id: String
    let title: String?
    let updatedAt: String?
    /// For a search: the line that matched, so the list can show why a chat is there.
    var match: String? = nil
}

/// One turn of a GIDEON conversation.
struct GideonTurn: Identifiable, Sendable, Equatable {
    enum Role: String, Codable, Sendable { case user, assistant }

    let id: String
    var role: Role
    var content: String
    /// NEXUS tools GIDEON reached for on this turn. Empty until the tools are wired back up
    /// server-side; carried now so history from the web renders the same here.
    var tools: [String]
    /// What was attached to this question. Always empty on an assistant turn. A turn read back from
    /// history carries whatever the server kept for it — see `GideonAttachment`.
    var attachments: [GideonAttachment]
    /// What GIDEON did, what it read, what it made and what it asks to change (assistant turns).
    var steps: [GideonStep] = []
    var sources: [GideonRef] = []
    var cards: [GideonCard] = []
    var proposals: [GideonProposal] = []

    init(id: String = UUID().uuidString, role: Role, content: String, tools: [String] = [],
         attachments: [GideonAttachment] = []) {
        self.id = id
        self.role = role
        self.content = content
        self.tools = tools
        self.attachments = attachments
    }
}

/// Wire shapes. The server answers history as `{messages:[{role,content,tools,attachments}]}`.
private struct GideonHistoryResponse: Decodable {
    let messages: [Row]?
    /// The conversation this is (dev server): absent from older servers.
    let chat: ChatRef?
    struct ChatRef: Decodable { let id: String; let title: String? }
    struct Meta: Decodable {
        let steps: [GideonStep]?
        let sources: [GideonRef]?
        let cards: [GideonCard]?
        let proposals: [GideonProposal]?
    }
    struct Row: Decodable {
        let role: String?
        let content: String?
        let tools: [String]?
        let meta: Meta?
        /// Absent from any server that predates kept attachments, and an empty array on every turn
        /// that carried nothing — which is nearly all of them. Optional covers both.
        let attachments: [Attachment]?
    }
    /// One kept file. Mirrors `StoredGideonAttachment` in src/lib/gideon-attachments.ts; `size` is
    /// sent as well and deliberately not read, because nothing here draws it.
    struct Attachment: Decodable {
        let kind: String?
        let url: String?
        let name: String?
        let mime: String?
    }
}

/// One SSE frame: `data: {"type":"text","content":"…"}`, and the new events (dev server).
private struct GideonEvent: Decodable {
    let type: String
    let content: String?
    let id: String?
    let title: String?
    let step: GideonStep?
    let sources: [GideonRef]?
    let card: GideonCard?
    let proposal: GideonProposal?
}

/// What the stream hands the chat, in order.
enum GideonStreamEvent: Sendable {
    /// Append (`delta`, or the old single `text`).
    case delta(String)
    /// A tool round started: drop the text so far.
    case reset
    /// The authoritative answer: replace.
    case final(String)
    case step(GideonStep)
    case sources([GideonRef])
    case card(GideonCard)
    case proposal(GideonProposal)
    case chat(id: String, title: String?)
}

private struct GideonChatsResponse: Decodable { let chats: [GideonChatSummary]? }
private struct GideonProposalEnvelope: Decodable { let proposal: GideonProposal?; let error: String? }

/// A refusal that arrives INSTEAD of the stream — a rejected attachment comes back as plain JSON
/// with a 4xx before any SSE exists. `error` is written in Indonesian for the user to read.
private struct GideonRefusal: Decodable {
    let error: String?
    /// "file_too_large", "unsupported_file_type", "not_configured", "rate_limited"… (QA 13 Oct 2026: the
    /// sentence is Indonesian only, so the app words it from the code instead).
    let code: String?
}

/// A document attached to one question.
///
/// The filename is carried with its extension because the route decides how to read a file from the
/// extension first and only falls back to the MIME type — a provider that hands over a generic
/// `public.data` would otherwise get the attachment refused for no reason the owner can act on.
struct GideonDocument: Sendable, Equatable {
    /// Filename WITH extension, e.g. "invoice-agustus.pdf".
    let name: String
    /// MIME type from the picker. Only consulted when `name` has no usable extension.
    let type: String
    let data: Data

    /// Extensions the server accepts. Mirrors DOC_EXTENSIONS in /api/gideon, which refuses anything
    /// else with a 415: Hermes reaches a document through a converter, and a type that converter
    /// cannot decode reaches the model as bytes it will confidently describe without having read.
    /// The server stays the authority — this copy only ever prevents an upload, never permits one.
    static let acceptedExtensions: Set<String> = [
        "pdf",
        "txt", "md", "csv", "tsv", "json", "log", "yml", "yaml", "xml", "html",
        "docx", "doc", "xlsx", "xls", "pptx", "ppt",
        "odt", "ods", "odp", "rtf", "epub", "ipynb",
    ]

    static let maxBytes = 10 * 1024 * 1024
}

/// The three GIDEON tiers.
///
/// Which model each one runs is decided on the server, and deliberately not named here: retuning a
/// tier must not require shipping a new build through review.
enum GideonTier: String, CaseIterable, Identifiable, Sendable {
    case astra, luna, terra, experimental

    var id: String { rawValue }
    static let fallback: GideonTier = .luna

    var label: String {
        switch self {
        case .astra: return "Artemis"
        case .luna: return "Phaëthon"
        case .terra: return "Aphrodite"
        case .experimental: return "Model 0"
        }
    }

    var blurb: String {
        switch self {
        case .astra: return T("Deepest. For analysis and decisions.")
        case .luna: return T("Everyday.")
        case .terra: return T("Light. Short questions.")
        // Runs on the office GPU rather than a hosted API. Measurably weaker than the others, so
        // the blurb says so instead of letting somebody discover it in a wrong answer.
        case .experimental: return T("Local model in the office. Slow, and can be wrong.")
        }
    }
}

/// Talks to GIDEON.
///
/// Kept out of APIClient on purpose: every other call there decodes one JSON body and returns, while
/// this one holds a response open and emits as it arrives. Threading that through `run` would mean
/// bending the shared path around a single caller.
enum GideonClient {

    /// A conversation is stored server-side per user, so the same thread continues on the web and on
    /// the phone rather than each device keeping its own half.
    static func history(chatId: String? = nil) async throws -> (turns: [GideonTurn], chatId: String?, title: String?) {
        var request = authed("/api/gideon/history", query: chatId.map { "chatId=\(enc($0))" })
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await fetch(request)
        try check(response)
        let decoded = try JSONDecoder().decode(GideonHistoryResponse.self, from: data)
        let turns: [GideonTurn] = (decoded.messages ?? []).compactMap { row in
            guard let role = GideonTurn.Role(rawValue: row.role ?? ""), let content = row.content else { return nil }
            // A kept file with no url is dropped rather than drawn. A chip that opens nothing is
            // precisely what this feature exists to stop showing, so an attachment the server can
            // no longer name is better represented by the plain text it was always shown as.
            let carried: [GideonAttachment] = (row.attachments ?? []).compactMap { item in
                guard let url = item.url, !url.isEmpty else { return nil }
                return GideonAttachment(kind: item.kind == "image" ? .image : .document,
                                        name: item.name ?? "",
                                        bytes: nil,
                                        url: url,
                                        mime: item.mime ?? "")
            }
            var turn = GideonTurn(role: role, content: content, tools: row.tools ?? [], attachments: carried)
            turn.steps = row.meta?.steps ?? []
            turn.sources = row.meta?.sources ?? []
            turn.cards = row.meta?.cards ?? []
            turn.proposals = row.meta?.proposals ?? []
            return turn
        }
        return (turns, decoded.chat?.id, decoded.chat?.title)
    }

    /// The person's conversations, newest first; `q` searches titles and messages.
    static func chats(query: String = "") async throws -> [GideonChatSummary] {
        let q = query.trimmingCharacters(in: .whitespaces)
        var request = authed("/api/gideon/chats", query: q.isEmpty ? "limit=50" : "limit=50&q=\(enc(q))")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await fetch(request)
        try check(response)
        return (try JSONDecoder().decode(GideonChatsResponse.self, from: data)).chats ?? []
    }

    /// Renames one of the person's own conversations (web ChatHistoryList; the server trims to 80).
    static func renameChat(_ id: String, title: String) async throws {
        var request = authed("/api/gideon/chats/\(enc(id))")
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["title": title])
        let (_, response) = try await URLSession.shared.data(for: request)
        try check(response)
    }

    static func deleteChat(_ id: String) async throws {
        var request = authed("/api/gideon/chats/\(enc(id))")
        request.httpMethod = "DELETE"
        let (_, response) = try await URLSession.shared.data(for: request)
        try check(response)
    }

    /// Apply or discard a proposed change. The server re-checks access at the moment of applying, and a
    /// double tap applies once (409 "Already decided" still carries the proposal).
    /// `booking`: the room and slot picked on a book_room card (required to apply one).
    static func decide(_ proposalId: String, apply: Bool, booking: GideonBookingChoice? = nil) async throws -> GideonProposal? {
        var request = authed("/api/gideon/proposals/\(enc(proposalId))")
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["decision": apply ? "apply" : "discard"]
        if let booking { body["booking"] = booking.body }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.offline }
        if http.statusCode == 401 { throw APIError.unauthorized }
        let env = try? JSONDecoder().decode(GideonProposalEnvelope.self, from: data)
        if (200..<300).contains(http.statusCode) || [409, 410, 422].contains(http.statusCode), let p = env?.proposal { return p }
        throw APIError.http(http.statusCode, env?.error)
    }

    /// Every room for one slot, for the book_room / move card's picker (read live: availability changes by the
    /// minute). `excludeBookingId`: the booking a move card is moving, so its own slot does not count as taken.
    static func roomAvailability(startsAt: String, endsAt: String, excludeBookingId: String? = nil) async throws -> GideonRoomAvailability {
        let exclude = excludeBookingId.map { "&excludeBookingId=\(enc($0))" } ?? ""
        var request = authed("/api/room-bookings/availability", query: "startsAt=\(enc(startsAt))&endsAt=\(enc(endsAt))\(exclude)")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await fetch(request)
        try check(response)
        return try JSONDecoder().decode(GideonRoomAvailability.self, from: data)
    }

    static func clearHistory(chatId: String? = nil) async throws {
        var request = authed("/api/gideon/history", query: chatId.map { "chatId=\(enc($0))" })
        request.httpMethod = "DELETE"
        let (_, response) = try await URLSession.shared.data(for: request)
        try check(response)
    }

    /// Streams one answer.
    ///
    /// An AsyncThrowingStream rather than a callback: chunks arrive off the main actor, and hopping
    /// each one across with its own Task gives no ordering guarantee — the answer would assemble
    /// itself out of order the first time the backend emits token by token. Iterating a stream keeps
    /// the sequence the server sent.
    ///
    /// Today the backend answers in a single frame. Appending rather than replacing means nothing
    /// here changes when that stops being true.
    static func stream(messages: [GideonTurn], model: String, image: Data? = nil,
                       document: GideonDocument? = nil, chatId: String? = nil, newChat: Bool = false,
                       context: GideonContext? = nil,
                       approvalMode: GideonApprovalMode = .fallback) -> AsyncThrowingStream<GideonStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var request = authed("/api/gideon")
                    request.httpMethod = "POST"
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    // A tool call on the far side can take well over half a minute; the default 60s
                    // would cut the answer off mid-thought and report it as a network failure.
                    request.timeoutInterval = 180
                    var payload: [String: Any] = [
                        "messages": messages.map { ["role": $0.role.rawValue, "content": $0.content] },
                        "model": model,
                        // The new contract (dev server): delta/reset/step/sources/card/proposal/final.
                        "stream": true,
                        "uiLang": AppLanguage.shared.lang == .id ? "id" : "en",
                        // The composer's "Review before writing ▾" (web default review; the server's
                        // default for clients that send nothing is to just do it).
                        "approvalMode": approvalMode.rawValue,
                    ]
                    if let chatId { payload["chatId"] = chatId } else if newChat { payload["newChat"] = true }
                    if let context, !context.isEmpty { payload["context"] = context.json }
                    // Base64 rather than multipart: the route already speaks JSON, and the server
                    // downscales again on arrival, so a slightly large upload costs seconds, not
                    // correctness.
                    if let image { payload["image"] = image.base64EncodedString() }
                    // A document rides the same JSON body and may travel WITH an image. `name` is
                    // what the route reads the extension off; `type` is only its fallback.
                    if let document {
                        payload["file"] = [
                            "name": document.name,
                            "type": document.type,
                            "data": document.data.base64EncodedString(),
                        ]
                    }
                    request.httpBody = try JSONSerialization.data(withJSONObject: payload)

                    let bytes: URLSession.AsyncBytes
                    let response: URLResponse
                    do { (bytes, response) = try await URLSession.shared.bytes(for: request) } catch { throw GideonProblem.from(error) }
                    try await check(response, refusalIn: bytes)

                    // SSE frames are separated by a blank line, and `lines` already splits on
                    // newlines — a blank line simply carries no payload and is skipped.
                    for try await line in bytes.lines {
                        guard line.hasPrefix("data:") else { continue }
                        let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                        guard !payload.isEmpty, let data = payload.data(using: .utf8) else { continue }
                        // A malformed frame is skipped rather than ending the stream: losing one
                        // chunk is recoverable, losing the rest of the answer is not.
                        guard let event = try? JSONDecoder().decode(GideonEvent.self, from: data) else { continue }

                        switch event.type {
                        case "text", "delta":
                            if let content = event.content, !content.isEmpty { continuation.yield(.delta(content)) }
                        case "reset":
                            continuation.yield(.reset)
                        case "final":
                            // "(Gideon balas kosong — coba ulang.)" is the route saying the model gave
                            // nothing back: an empty answer the store reports, not text to show.
                            let text = event.content ?? ""
                            continuation.yield(.final(GideonProblem.isEmptyPlaceholder(text) ? "" : text))
                        case "step":
                            if let step = event.step { continuation.yield(.step(step)) }
                        case "sources", "cited":
                            continuation.yield(.sources(event.sources ?? []))
                        case "card":
                            if let card = event.card { continuation.yield(.card(card)) }
                        case "proposal":
                            if let p = event.proposal { continuation.yield(.proposal(p)) }
                        case "chat":
                            if let id = event.id { continuation.yield(.chat(id: id, title: event.title)) }
                        case "error":
                            throw GideonProblem.stream(event.content ?? "")
                        case "done":
                            continuation.finish()
                            return
                        default:
                            // tool_result, and anything added later: nothing to draw yet.
                            continue
                        }
                    }
                    continuation.finish()
                } catch let error as GideonProblem {
                    continuation.finish(throwing: error)
                } catch APIError.unauthorized {
                    continuation.finish(throwing: APIError.unauthorized)
                } catch {
                    // A connection dropped mid-answer: "can't be reached", not URLSession's sentence.
                    continuation.finish(throwing: (error is URLError) ? GideonProblem.unreachable : error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: - plumbing

    private static func authed(_ path: String, query: String? = nil) -> URLRequest {
        var url = Config.baseURL.appendingPathComponent(path)
        if let query, var comps = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            comps.percentEncodedQuery = query
            url = comps.url ?? url
        }
        var request = URLRequest(url: url)
        if let session = Keychain.load() {
            request.setValue(session.cookieHeader, forHTTPHeaderField: "Cookie")
        }
        // Who is asking, like every other request in the app (it was missing here).
        request.setValue(APIClient.clientTag, forHTTPHeaderField: "X-Nexus-Client")
        request.setValue(APIClient.userAgent, forHTTPHeaderField: "User-Agent")
        return request
    }

    private static func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? s }

    private static func check(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw APIError.offline }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode, nil) }
    }

    /// Reads (history, chats) that go through URLSession directly: a dropped connection is said in the
    /// app's words, not URLSession's.
    private static func fetch(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do { return try await URLSession.shared.data(for: request) } catch { throw APIError.nothingAnswered(error) }
    }

    /// The streaming variant: on a refusal the body is JSON, not SSE, so it is read here before the
    /// caller starts parsing frames.
    ///
    /// The server's own sentence names the file and says what to do about it; "Server error (415)"
    /// would throw away the only useful part. The read is capped because a proxy can refuse an
    /// oversized body itself, with an HTML page there is no reason to read to the end.
    private static func check(_ response: URLResponse, refusalIn bytes: URLSession.AsyncBytes) async throws {
        guard let http = response as? HTTPURLResponse else { throw APIError.offline }
        if http.statusCode == 401 { throw APIError.unauthorized }
        if (200..<300).contains(http.statusCode) { return }

        var body = ""
        for try await line in bytes.lines {
            body += line
            if body.count > 8192 { break }
        }
        // The route's own refusals (413/415 with a code, 429, 503 when GIDEON is not connected) and a
        // proxy's (no JSON) are worded from the status and the code (QA 13 Oct 2026): the route's
        // sentence is Indonesian only, and "Server error (503)." says nothing useful.
        let refusal = try? JSONDecoder().decode(GideonRefusal.self, from: Data(body.utf8))
        throw GideonProblem.http(status: http.statusCode, code: refusal?.code, message: refusal?.error)
    }
}

/// The GIDEON conversation, held OUTSIDE the panel that draws it.
///
/// It lives here because the panel is a sheet, and a sheet's `@State` is destroyed the moment it is
/// dismissed. An answer takes thirty to ninety seconds, people close the panel while they wait, and
/// with the transcript in the view that close took the question, the dots and the queue with it —
/// reopening ran `.task` on a fresh view, which refetched a history that could not contain any of
/// them: /api/gideon writes the question and the answer TOGETHER, once, after the model replies, so
/// for the whole length of a question the server has nothing to hand back.
///
/// The request itself was never the thing that broke. `Task { }` started from a tap is unstructured
/// and is not cancelled by a view going away, so it ran to completion and wrote its rows — into
/// `@State` storage that nothing was left holding. What was lost was the transcript, not the answer.
///
/// A singleton for the reason AppRouter is one: there is exactly one conversation per person, and
/// whether a sheet happens to be mounted is not a fact about it. `reset()` is what stops it
/// outliving the session that filled it.
@MainActor
@Observable
final class GideonChat {
    static let shared = GideonChat()

    private(set) var turns: [GideonTurn] = []
    private(set) var sending = false
    /// The last thing that went wrong, in words. Settable from outside because the composer's own
    /// refusals — a file that is too big, one nothing here can read — belong on the same line.
    var error: String?
    /// What the composer is holding. Here rather than in the view for the same reason the transcript
    /// is: a half-typed question and an already-picked file are work somebody did, and closing a
    /// panel is not a decision to throw it away.
    var draft = ""
    /// JPEG bytes, held until the next question is sent.
    var attachment: Data?
    /// A picked document, held until the next question is sent.
    var document: GideonDocument?
    /// Set when GIDEON answered a 401, and read by the panel — which is the thing that has an
    /// AuthStore to tell. Deliberately not acted on here: signing somebody out from a background
    /// task while they are reading the dashboard is a worse surprise than the next screen they open
    /// doing it, and this type having no view attachments is what lets it survive the panel at all.
    private(set) var sessionExpired = false
    /// The conversation on screen (dev server). nil = the person's latest, which the next history read
    /// names; `startNew` makes the next question open a new one.
    private(set) var chatId: String?
    private(set) var chatTitle: String?
    private var startNew = false
    /// Bumped whenever a conversation is picked (new chat, a chat from the list): a history read started
    /// before the pick must not land after it. See `refresh()`.
    @ObservationIgnored private var pickEpoch = 0
    /// The assistant turn being answered right now: its steps show live and it has no Copy / Save yet.
    private(set) var answeringId: String?
    /// What every question carries as `context`: the page it was opened on (unless its chip was removed)
    /// plus the @ refs. Sent with every question until removed.
    var context = GideonContext()
    /// The page this conversation was opened on (web `pageContext` before a dismissal): what New chat and
    /// opening another chat bring the chip back to. nil on the GIDEON page itself, Home and lists.
    private(set) var pageContext: GideonContext?

    /// Questions the composer has accepted but the network has not taken yet. See `submit()`.
    private var outbox: [Outgoing] = []
    /// What "Try again" under the error line does (QA 13 Oct 2026): ask the failed question again (its
    /// bubble is still in the transcript), or open the conversation that failed to load. nil = no retry
    /// makes sense (a file type, GIDEON not connected on this server).
    private var retryAction: RetryAction?
    private enum RetryAction {
        case resend(Outgoing)
        case open(String)
    }
    /// Draws "Try again" under the error.
    var canRetry: Bool { retryAction != nil && !sending }
    private var drainTask: Task<Void, Never>?

    private init() {}

    /// One accepted-but-not-yet-sent question, paired with the transcript turn already drawn for it.
    /// The tier is captured here rather than read at dispatch: a queued question is answered by the
    /// model that was selected when it was written, not by whatever the picker says a minute later.
    private struct Outgoing {
        let turnId: String
        let text: String
        let model: String
        let image: Data?
        let document: GideonDocument?
        /// The context as it was when the question was written: a queued question is about the page it was
        /// asked on, not whatever the chip says by the time the queue reaches it.
        let context: GideonContext
        let approvalMode: GideonApprovalMode
    }

    /// The one animation a turn arriving is allowed to have.
    ///
    /// Read from UIAccessibility rather than taken from the environment, because the two places that
    /// add a turn without a view in the call stack — the answer's empty bubble, and the queue
    /// reaching its next question — have no environment to read it from.
    private var arrive: Animation? {
        UIAccessibility.isReduceMotionEnabled ? nil : Animation.easeOut(duration: 0.22)
    }

    // MARK: - history

    /// Picks up whatever was said on the web, and swaps a just-sent attachment's bytes for the url
    /// the server kept once there is one.
    ///
    /// Skipped outright while anything is in flight or queued. History is only written once an
    /// answer exists, so a refetch mid-question would replace the transcript with one missing the
    /// very exchange being waited on — which is the bug this whole type exists to end.
    ///
    /// A failed fetch leaves what is on screen alone. This used to read `?? []`, which was harmless
    /// while the panel owned the state and rebuilt it on every open; now that the transcript
    /// outlives the panel, it would blank a conversation the app is still holding the moment
    /// somebody opened the panel out of signal.
    func refresh() async {
        guard !sending, outbox.isEmpty, !startNew else { return }
        // The read takes a moment, and the panel may decide what it opens on meanwhile: the GIDEON page
        // asks for a new chat on appear, and on the phone that landed AFTER this read had passed the
        // guard, so the latest old conversation was drawn over the fresh one (UI tour 13 Oct 2026: the
        // iPhone opened on "task disini …"). Anything that picks a conversation bumps `pickEpoch`, and
        // an answer for a pick that is no longer current is dropped.
        let epoch = pickEpoch
        let asked = chatId
        guard let fresh = try? await GideonClient.history(chatId: asked) else { return }
        guard epoch == pickEpoch, chatId == asked, !sending, outbox.isEmpty, !startNew else { return }
        turns = fresh.turns
        if chatId == nil { chatId = fresh.chatId }
        chatTitle = fresh.title ?? chatTitle
    }

    /// A fresh conversation about `page` (the project / task / doc on screen; nil = none).
    ///
    /// "Ask GIDEON" opens a new chat with that context, not the last chat about something else (web
    /// G-BUG-1). A question still in flight is let go first, as the web's newChat aborts its stream: the
    /// server keeps answering and saves the reply into the conversation it was asked in. The old code only
    /// swapped `context` under the running conversation here, which is how a follow-up "task disini"
    /// landed on a different project than the thread was about (owner, 13 Oct 2026).
    func startChat(page: GideonContext? = nil) {
        pickEpoch += 1
        if sending || !outbox.isEmpty { abandonInFlight() }
        turns = []
        chatId = nil
        chatTitle = nil
        startNew = true
        error = nil
        retryAction = nil
        setPage(page)
    }

    /// The panel opened on `page` without asking for a new chat (the launcher button): the latest chat,
    /// with the chip following the page on screen (web contextOf: the page on screen wins). Left alone while
    /// a question is in flight — that one keeps the context it was asked with.
    func follow(page: GideonContext?) {
        guard !sending, outbox.isEmpty else { return }
        setPage(page)
    }

    /// The chip was removed: this conversation stops carrying the page until New chat / another chat.
    func dismissPage() {
        context = context.withoutPage
    }

    /// GIDEON's own page while a question from elsewhere is still being answered: no page is "here"
    /// any more, so neither the next question nor New chat may carry one.
    func leavePage() {
        pageContext = nil
        context = context.withoutPage
    }

    /// "Delete this chat" in the ⋯ menu: the conversation on screen goes, and a new one starts.
    func deleteCurrent() async {
        guard let id = chatId else { startChat(page: pageContext); return }
        do {
            try await GideonClient.deleteChat(id)
            startChat(page: pageContext)
        } catch APIError.unauthorized {
            sessionExpired = true
        } catch {
            self.error = GideonProblem.from(error).text
        }
    }

    /// "Clear all chat history" (web): every conversation of this person, on every device.
    func clearAll() async {
        do {
            try await GideonClient.clearHistory(chatId: nil)
            startChat(page: pageContext)
        } catch APIError.unauthorized {
            sessionExpired = true
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? T("Failed.")
        }
    }

    private func setPage(_ page: GideonContext?) {
        let clean: GideonContext? = page.flatMap { $0.hasPage ? GideonContext(projectId: $0.projectId, projectName: $0.projectName,
                                                                              taskId: $0.taskId, taskTitle: $0.taskTitle,
                                                                              docId: $0.docId, docTitle: $0.docTitle) : nil }
        pageContext = clean
        context = clean ?? GideonContext()
    }

    /// Lets the running question go (web newChat → abortRef.abort()). A new generation, so the drain that
    /// was cancelled can neither clear `sending` for the next one nor write into the new transcript.
    private func abandonInFlight() {
        generation += 1
        drainTask?.cancel()
        drainTask = nil
        outbox.removeAll()
        sending = false
    }

    /// Opens one conversation from the chats list. A conversation that cannot be loaded says so with
    /// Try again (web QA 13 Oct 2026: it used to open as an empty new chat, hiding the failure).
    func openChat(_ id: String) async {
        guard !sending else { return }
        pickEpoch += 1
        error = nil
        retryAction = nil
        do {
            let fresh = try await GideonClient.history(chatId: id)
            chatId = id
            startNew = false
            turns = fresh.turns
            chatTitle = fresh.title
            // Web openChat: the @ refs belong to the conversation that had them; the page chip comes back.
            context = pageContext ?? GideonContext()
        } catch APIError.unauthorized {
            sessionExpired = true
        } catch APIError.http(404, _) {
            error = T("This conversation doesn't exist any more. Start a new chat below.")
        } catch APIError.http(403, _) {
            error = T("This conversation doesn't exist any more. Start a new chat below.")
        } catch {
            self.error = String(format: T("Couldn't open this conversation. %@"), GideonProblem.from(error).text)
            retryAction = .open(id)
        }
    }

    /// "Try again" under the error line.
    func retry() {
        guard !sending, let action = retryAction else { return }
        retryAction = nil
        error = nil
        switch action {
        case .open(let id):
            Task { await openChat(id) }
        case .resend(let item):
            // The question's bubble is still in the transcript; only the answer is asked for again.
            guard turns.contains(where: { $0.id == item.turnId }) else { return }
            outbox.append(item)
            sending = true
            drainTask = Task { await drain() }
        }
    }

    /// Apply or discard a proposal shown in the thread; the turn shows the result.
    func decide(_ proposal: GideonProposal, apply: Bool, booking: GideonBookingChoice? = nil) async {
        do {
            if let updated = try await GideonClient.decide(proposal.id, apply: apply, booking: booking) {
                replace(updated)
                if apply, let e = updated.error, !e.isEmpty { error = e }
            }
        } catch APIError.unauthorized {
            sessionExpired = true
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? T("GIDEON failed.")
        }
    }

    private func replace(_ p: GideonProposal) {
        for i in turns.indices {
            if let j = turns[i].proposals.firstIndex(where: { $0.id == p.id }) { turns[i].proposals[j] = p }
        }
    }

    func clear() async {
        do {
            try await GideonClient.clearHistory(chatId: chatId)
            turns = []
            error = nil
            retryAction = nil
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? T("Failed.")
        }
    }

    // MARK: - asking

    /// Takes the composer's question and puts it in the outbox. Returns the turn that was drawn for
    /// it, which is what lets the caller decode its thumbnail before the first frame that shows it.
    ///
    /// The composer stays live while an answer is in flight, so a second question can arrive before
    /// the first is answered. It is QUEUED rather than sent alongside: the conversation is stored
    /// server-side as one thread, so two requests in flight would both append to it and the second
    /// answer would be written against a transcript missing the first. Either way the user's bubble
    /// is drawn at the moment of the tap — text that leaves the composer and appears nowhere is the
    /// one outcome worth ruling out.
    func submit(tier: GideonTier, approvalMode: GideonApprovalMode = .fallback) -> GideonTurn? {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        draft = ""
        error = nil
        retryAction = nil

        // The attachment is recorded ON the turn as well as posted with it. A question about a file
        // that draws as bare text leaves nothing in the thread saying which file was meant, so the
        // answer under it reads as if it came from nowhere. Image first, then document: the order
        // the composer strip lists them in, so nothing appears to move when the message is sent.
        //
        // The BYTES ride along and not merely the name. They are the same bytes the request is
        // already carrying, so this costs a retain and not a copy, and they are what makes the chip
        // openable in the minute before /api/files has anything to serve.
        var carried: [GideonAttachment] = []
        if let attachment {
            carried.append(GideonAttachment(kind: .image, name: "", bytes: attachment))
        }
        if let document {
            carried.append(GideonAttachment(kind: .document, name: document.name, bytes: document.data))
        }

        let turn = GideonTurn(role: .user, content: text, attachments: carried)
        withAnimation(arrive) { turns.append(turn) }
        outbox.append(Outgoing(turnId: turn.id, text: text, model: tier.rawValue,
                               image: attachment, document: document,
                               context: context, approvalMode: approvalMode))
        // Cleared with the draft, not after the request: an attachment silently riding along on the
        // NEXT question would be baffling, and re-attaching is one tap.
        attachment = nil
        document = nil

        // A drain already running will reach this on its next lap. The flag is raised HERE and not
        // inside `drain`, because a Task's first line runs on a later turn of the main actor and two
        // taps inside that gap would each start a drain competing for the same outbox.
        guard !sending else { return turn }
        sending = true
        drainTask = Task { await drain() }
        return turn
    }

    /// Which drain is the current one. reset() starts a new generation, so a drain that was cancelled
    /// mid-answer can never clear `sending` for (or race) the drain a new question started after it.
    @ObservationIgnored private var generation = 0

    private func drain() async {
        let mine = generation
        defer { if generation == mine { sending = false } }
        while generation == mine, !outbox.isEmpty, !Task.isCancelled {
            await send(outbox.removeFirst())
        }
    }

    private func send(_ item: Outgoing) async {
        let gen = generation
        // History is cut at this question. Anything queued behind it is already in `turns`, and
        // sending that as context would have the server answer the wrong message.
        let messages = history(upTo: item)
        // The empty assistant turn goes in directly after its question rather than at the end of the
        // list, which with a queue is somebody else's place. It is what the dots are drawn in and
        // where the answer lands.
        let answer = GideonTurn(role: .assistant, content: "")
        let at = turns.firstIndex(where: { $0.id == item.turnId }).map { $0 + 1 } ?? turns.count
        withAnimation(arrive) { turns.insert(answer, at: at) }
        answeringId = answer.id
        defer { if answeringId == answer.id { answeringId = nil } }

        let wantNew = startNew
        startNew = false
        do {
            for try await event in GideonClient.stream(messages: messages, model: item.model,
                                                       image: item.image, document: item.document,
                                                       chatId: chatId, newChat: wantNew && chatId == nil,
                                                       context: item.context, approvalMode: item.approvalMode) {
                // Let go by startChat (or reset): nothing here belongs to the transcript on screen any more.
                if generation != gen { break }
                guard let index = turns.firstIndex(where: { $0.id == answer.id }) else { continue }
                switch event {
                case .delta(let chunk):
                    // Only the first chunk is animated, and only to cross-fade the dots out.
                    if turns[index].content.isEmpty {
                        withAnimation(.easeOut(duration: 0.18)) { turns[index].content += chunk }
                    } else {
                        turns[index].content += chunk
                    }
                case .reset:
                    turns[index].content = ""
                case .final(let text):
                    if !text.isEmpty { turns[index].content = text }
                case .step(let step):
                    if let j = turns[index].steps.firstIndex(where: { $0.id == step.id }) { turns[index].steps[j] = step }
                    else { turns[index].steps.append(step) }
                case .sources(let refs):
                    turns[index].sources = refs
                case .card(let card):
                    turns[index].cards.append(card)
                case .proposal(let p):
                    if let j = turns[index].proposals.firstIndex(where: { $0.id == p.id }) { turns[index].proposals[j] = p }
                    else { turns[index].proposals.append(p) }
                case .chat(let id, let title):
                    chatId = id
                    if let title { chatTitle = title }
                }
            }
            if generation != gen { return }
            // A stream that ends without a word is a failure the user can see but not explain.
            if let index = turns.firstIndex(where: { $0.id == answer.id }), turns[index].content.isEmpty,
               turns[index].proposals.isEmpty, turns[index].cards.isEmpty {
                turns.remove(at: index)
                error = T("GIDEON didn't answer. Try again.")
                retryAction = .resend(item)
            }
        } catch APIError.unauthorized {
            // An answer from before reset() belongs to a session that is gone: nothing to touch.
            guard generation == gen else { return }
            // Drop the queue as well: the session is gone, so replaying it would only produce the
            // same 401 once per queued message.
            turns.removeAll { $0.id == answer.id }
            outbox.removeAll()
            sessionExpired = true
        } catch {
            // A cancelled drain is `reset()` taking the session away, not something that went
            // wrong. The transcript this would write into belongs to somebody who has signed out.
            guard !Task.isCancelled, generation == gen else { return }
            turns.removeAll { $0.id == answer.id }
            // Worded by GideonProblem (status / code / the route's fixed sentences, EN + ID). A failure a
            // retry can fix keeps the question for "Try again"; nothing was stored server-side for a
            // failed turn, so asking again cannot duplicate it.
            let problem = GideonProblem.from(error)
            self.error = problem.text
            // Only the newest failure is retried; the queue behind it carries on by itself.
            retryAction = problem.retryable && outbox.isEmpty ? .resend(item) : nil
        }
    }

    /// Everything up to and including this question, minus assistant turns still waiting to be
    /// filled in. Cutting there is what keeps a queued question out of the context of the one in
    /// front of it — the server answers the LAST message it is given.
    private func history(upTo item: Outgoing) -> [GideonTurn] {
        guard let end = turns.firstIndex(where: { $0.id == item.turnId }) else {
            // The transcript was replaced under us. Ask the question on its own rather than posting
            // an empty `messages`, which the route reads the last element of.
            return [GideonTurn(id: item.turnId, role: .user, content: item.text)]
        }
        return turns[...end].filter { !($0.role == .assistant && $0.content.isEmpty) }
    }

    // MARK: - session

    /// The panel has passed the 401 on to the AuthStore. Cleared so signing back in on the same
    /// launch is not immediately undone by a flag nobody lowered.
    func clearSessionExpiry() { sessionExpired = false }

    /// A conversation must not outlive the session that held it — the next person to sign in on this
    /// phone would open the panel onto somebody else's questions, and onto a file they attached.
    /// Called from `AuthStore.logout()`, beside the cached roster and the Live Activity, for exactly
    /// that reason. Cancelling the drain is part of it: an answer still arriving would otherwise
    /// write itself into the transcript the next person sees.
    func reset() {
        generation += 1
        pickEpoch += 1
        drainTask?.cancel()
        drainTask = nil
        outbox.removeAll()
        turns = []
        draft = ""
        attachment = nil
        document = nil
        error = nil
        retryAction = nil
        sessionExpired = false
        sending = false
        chatId = nil
        chatTitle = nil
        startNew = false
        context = GideonContext()
        pageContext = nil
        GideonPages.shared.reset()
    }
}


// MARK: - Personalize and Save as doc (web, 12 Oct 2026)

/// What the person told GIDEON about themselves: its name for them, and standing instructions.
struct GideonPrefs: Codable, Sendable, Equatable {
    var assistantName: String?
    var instructions: String?
}

extension GideonClient {
    private static func jsonRequest(_ path: String, method: String, body: [String: Any]?) throws -> URLRequest {
        var request = URLRequest(url: Config.baseURL.appendingPathComponent(path))
        if let session = Keychain.load() { request.setValue(session.cookieHeader, forHTTPHeaderField: "Cookie") }
        request.setValue(APIClient.clientTag, forHTTPHeaderField: "X-Nexus-Client")
        request.setValue(APIClient.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpMethod = method
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return request
    }

    private static func send(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.offline }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let msg = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["error"] as? String
            throw APIError.http(http.statusCode, msg)
        }
        return data
    }

    static func prefs() async throws -> GideonPrefs {
        try JSONDecoder().decode(GideonPrefs.self, from: try await send(try jsonRequest("/api/gideon/prefs", method: "GET", body: nil)))
    }

    /// Empty values are stored as nothing (the server trims and caps: name 40, instructions 2000).
    static func savePrefs(_ p: GideonPrefs) async throws -> GideonPrefs {
        let body: [String: Any] = ["assistantName": p.assistantName ?? NSNull(), "instructions": p.instructions ?? NSNull()]
        return try JSONDecoder().decode(GideonPrefs.self, from: try await send(try jsonRequest("/api/gideon/prefs", method: "PUT", body: body)))
    }

    /// An answer saved as a page in a project (MEMBER). Returns the new page's id.
    static func saveAsDoc(projectId: String, title: String, markdown: String) async throws -> String {
        let data = try await send(try jsonRequest("/api/gideon/save-doc", method: "POST",
                                                  body: ["projectId": projectId, "title": title, "markdown": String(markdown.prefix(60_000))]))
        guard let id = (((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["doc"] as? [String: Any])?["id"] as? String else { throw APIError.decoding }
        return id
    }
}
