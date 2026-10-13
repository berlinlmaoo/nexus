import Foundation
import Observation

/// "… is typing", like WhatsApp (owner, 9 Oct 2026: "di menu chat, bikin status titik titik gitu kaya wa
/// kalo ada orang lain atau lawan bicara pas lg ngetik", and the typer's photo beside the dots).
///
/// Realtime only. The server relays a member's `typing` to the room's open threads and to every
/// member's own room, so the chat list hears it too (pages/api/socket.ts), as
/// `{ conversationId, userId, name, avatar, typing }` — name and photo from the server's own record.
/// Nothing is stored or pushed. While the connection is down nothing is sent and nothing is shown;
/// there is no polling for it.
///
///   sending    while the composer has text and keys are pressed: "typing" at most every
///              `resendInterval`; "stopped" on send, on clearing the box, when the box loses focus, after
///              `idleAfter` without a keystroke, and when the thread closes.
///   receiving  someone stays shown `expireAfter` after their last "typing", unless "stopped" or their
///              message comes first. Everything clears when the connection drops.
///
/// Same timings as the web (apps/web/src/lib/chat-typing.ts).
@MainActor
@Observable
final class ChatTyping {
    static let shared = ChatTyping()

    struct Typer: Identifiable, Hashable, Sendable {
        let userId: String
        let name: String
        let avatar: String?
        var id: String { userId }
        var initial: String { String(name.first ?? "?").uppercased() }
    }

    static let resendInterval: TimeInterval = 3
    static let idleAfter: TimeInterval = 5
    static let expireAfter: TimeInterval = 6

    /// conversationId → who is typing there, in the order they started.
    private(set) var rooms: [String: [Typer]] = [:]

    @ObservationIgnored private var expiry: [String: Task<Void, Never>] = [:]
    /// The composer's side, per conversation: when "typing" last went out, and the idle timer.
    @ObservationIgnored private var outgoing: [String: (lastSent: Date, idle: Task<Void, Never>?)] = [:]

    private init() {}

    func typers(in conversationId: String) -> [Typer] { rooms[conversationId] ?? [] }
    func isTyping(in conversationId: String) -> Bool { !(rooms[conversationId]?.isEmpty ?? true) }

    // MARK: receiving (RealtimeClient)

    /// A relayed `typing` event. The viewer's own typing on another device is never shown.
    func received(_ payload: SIOJSON?, meId: String?) {
        guard let conversationId = payload?["conversationId"]?.string,
              let userId = payload?["userId"]?.string, userId != meId,
              case .bool(let typing)? = payload?["typing"] else { return }
        guard typing else {
            remove(conversationId, userId)
            return
        }
        let name = payload?["name"]?.string ?? ""
        let avatar = payload?["avatar"]?.string.flatMap { $0.isEmpty ? nil : $0 }
        let typer = Typer(userId: userId, name: name, avatar: avatar)
        var list = rooms[conversationId] ?? []
        if let i = list.firstIndex(where: { $0.userId == userId }) {
            if list[i] != typer { list[i] = typer }
        } else {
            list.append(typer)
        }
        if rooms[conversationId] != list { rooms[conversationId] = list }
        let key = conversationId + "\u{0}" + userId
        expiry[key]?.cancel()
        expiry[key] = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(Self.expireAfter * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.remove(conversationId, userId)
        }
    }

    /// Their message landed: they are done typing it.
    func messageArrived(conversationId: String?, userId: String?) {
        guard let conversationId, let userId else { return }
        remove(conversationId, userId)
    }

    /// The connection dropped: the server has told everyone this device stopped; nobody else is shown.
    func connectionLost() {
        for task in expiry.values { task.cancel() }
        expiry.removeAll()
        if !rooms.isEmpty { rooms.removeAll() }
        for state in outgoing.values { state.idle?.cancel() }
        outgoing.removeAll()
    }

    private func remove(_ conversationId: String, _ userId: String) {
        expiry.removeValue(forKey: conversationId + "\u{0}" + userId)?.cancel()
        guard var list = rooms[conversationId], let i = list.firstIndex(where: { $0.userId == userId }) else { return }
        list.remove(at: i)
        rooms[conversationId] = list.isEmpty ? nil : list
    }

    // MARK: sending (the thread's composer)

    /// Every change of the composer's text.
    func composerChanged(_ conversationId: String, text: String) {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            stop(conversationId)
            return
        }
        let now = Date()
        var state = outgoing[conversationId]
        if state == nil || now.timeIntervalSince(state!.lastSent) >= Self.resendInterval {
            // Nothing goes out without the connection; nothing is remembered either, so the first
            // keystroke after it comes back says "typing" at once.
            guard RealtimeClient.shared.sendTyping(conversationId: conversationId, typing: true) else { return }
            state = (lastSent: now, idle: state?.idle)
        }
        state?.idle?.cancel()
        state?.idle = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(Self.idleAfter * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.stop(conversationId)
        }
        outgoing[conversationId] = state
    }

    /// "Stopped", if "typing" went out for this conversation.
    func stop(_ conversationId: String) {
        guard let state = outgoing.removeValue(forKey: conversationId) else { return }
        state.idle?.cancel()
        RealtimeClient.shared.sendTyping(conversationId: conversationId, typing: false)
    }

    // MARK: words

    /// "Bagas is typing…" / "3 people are typing…".
    static func sentence(_ typers: [Typer]) -> String {
        if typers.count == 1 {
            let name = typers[0].name.isEmpty ? T("Someone") : typers[0].name
            return String(format: T("%@ is typing…"), name)
        }
        return String(format: T("%d people are typing…"), typers.count)
    }
}
