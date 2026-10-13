import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Chat system messages: "Bagas Putro added Mey", like WhatsApp (owner, 8 Oct 2026).
//
// The server writes one SYSTEM row per membership change in a GROUP (created, people added, someone
// removed or leaving, renamed). The row's `content` is an Indonesian fallback sentence for clients
// that do not know `kind` yet; `event` says what happened, and every client builds the sentence in
// its own language from it, with "You"/"Kamu" for the person reading.
//
// Pure on purpose — Foundation only, no T(), no SwiftUI — so it compiles and runs on Linux:
//   Tests/ChatSystemText/main.swift checks every event type in both languages.
// ─────────────────────────────────────────────────────────────────────────────

/// What a SYSTEM message says happened (`Message.event`, JSON). Every field is optional and read
/// leniently: a server that adds a field, or sends one in a shape this build does not expect, must
/// never cost the thread a message — the row falls back to its `content`.
struct ChatSystemEvent: Decodable, Sendable, Equatable {
    struct Person: Decodable, Sendable, Equatable {
        let id: String?
        let name: String?

        init(id: String?, name: String?) {
            self.id = id
            self.name = name
        }

        private enum CodingKeys: String, CodingKey { case id, name }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try? c.decodeIfPresent(String.self, forKey: .id)
            name = try? c.decodeIfPresent(String.self, forKey: .name)
        }
    }

    /// "members_added" | "member_removed" | "member_left" | "group_created" | "group_renamed".
    let type: String?
    let actor: Person?
    /// The people added or removed. Empty when the event has none.
    let targets: [Person]
    /// The group's name (created / renamed).
    let name: String?
    /// The name before a rename.
    let previousName: String?

    init(type: String?, actor: Person?, targets: [Person] = [], name: String? = nil, previousName: String? = nil) {
        self.type = type
        self.actor = actor
        self.targets = targets
        self.name = name
        self.previousName = previousName
    }

    private enum CodingKeys: String, CodingKey { case type, actor, targets, name, previousName }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = try? c.decodeIfPresent(String.self, forKey: .type)
        actor = try? c.decodeIfPresent(Person.self, forKey: .actor)
        targets = (try? c.decodeIfPresent([Person].self, forKey: .targets)) ?? []
        name = try? c.decodeIfPresent(String.self, forKey: .name)
        previousName = try? c.decodeIfPresent(String.self, forKey: .previousName)
    }
}

/// The sentence a SYSTEM message shows, in English or Indonesian.
enum ChatSystemText {
    enum Lang: Sendable { case en, id }

    /// The pill's text for `event`, seen by `meId`.
    ///
    /// Anything this build cannot put into words — no event, an unknown type, a name missing where
    /// the sentence needs one — is the server's own `fallback` sentence (the row's `content`), as
    /// the contract says, rather than a sentence with a hole in it.
    static func sentence(_ event: ChatSystemEvent?, fallback: String, meId: String?, lang: Lang) -> String {
        guard let event, let type = event.type else { return fallback }
        let en = lang == .en
        switch type {
        case "members_added":
            guard let actor = subject(event.actor, meId: meId, lang: lang),
                  let names = objects(event.targets, meId: meId, lang: lang) else { return fallback }
            return en ? "\(actor) added \(names)" : "\(actor) menambahkan \(names)"

        case "member_removed":
            guard let actor = subject(event.actor, meId: meId, lang: lang),
                  let names = objects(event.targets, meId: meId, lang: lang) else { return fallback }
            return en ? "\(actor) removed \(names)" : "\(actor) mengeluarkan \(names)"

        case "member_left":
            // The person leaving is the actor; a server that also lists them as the target is read
            // the same way.
            guard let who = subject(event.actor ?? event.targets.first, meId: meId, lang: lang) else { return fallback }
            return en ? "\(who) left" : "\(who) keluar"

        case "group_created":
            guard let actor = subject(event.actor, meId: meId, lang: lang) else { return fallback }
            guard let group = clean(event.name) else {
                return en ? "\(actor) created the group" : "\(actor) membuat grup"
            }
            return en ? "\(actor) created the group “\(group)”" : "\(actor) membuat grup “\(group)”"

        case "group_renamed":
            guard let actor = subject(event.actor, meId: meId, lang: lang),
                  let group = clean(event.name) else { return fallback }
            return en ? "\(actor) renamed the group to “\(group)”" : "\(actor) mengubah nama grup jadi “\(group)”"

        default:
            return fallback
        }
    }

    /// "Mey", "Mey and Yuza", "Mey, Yuza and Angela" — "dan" in Indonesian. No serial comma, as the
    /// contract writes it.
    static func joinNames(_ names: [String], lang: Lang) -> String {
        let and = lang == .en ? " and " : " dan "
        switch names.count {
        case 0: return ""
        case 1: return names[0]
        default: return names.dropLast().joined(separator: ", ") + and + names[names.count - 1]
        }
    }

    // MARK: - parts

    /// The one who did it, opening the sentence: "You" / "Kamu" when that is the reader.
    private static func subject(_ person: ChatSystemEvent.Person?, meId: String?, lang: Lang) -> String? {
        guard let person else { return nil }
        if isMe(person, meId) { return lang == .en ? "You" : "Kamu" }
        return clean(person.name)
    }

    /// The people it was done to, mid-sentence: "you" / "kamu" for the reader, who is named first,
    /// the way WhatsApp says "Bagas added you and Mey". nil when nobody in the list has a name to
    /// show — the sentence would end on nothing.
    private static func objects(_ people: [ChatSystemEvent.Person], meId: String?, lang: Lang) -> String? {
        var names: [String] = []
        var seen = Set<String>()
        var includesMe = false
        for person in people {
            if let id = person.id, !id.isEmpty {
                guard !seen.contains(id) else { continue }
                seen.insert(id)
            }
            if isMe(person, meId) {
                includesMe = true
            } else if let name = clean(person.name) {
                names.append(name)
            }
        }
        if includesMe { names.insert(lang == .en ? "you" : "kamu", at: 0) }
        guard !names.isEmpty else { return nil }
        return joinNames(names, lang: lang)
    }

    private static func isMe(_ person: ChatSystemEvent.Person, _ meId: String?) -> Bool {
        guard let meId, !meId.isEmpty, let id = person.id else { return false }
        return id == meId
    }

    private static func clean(_ s: String?) -> String? {
        guard let t = s?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return nil }
        return t
    }
}
