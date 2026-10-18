import Foundation
import Observation

/// One workspace cache. Avatars never make individual requests or retain another session's status.
@MainActor @Observable
final class PresenceStore {
    static let shared = PresenceStore()
    private(set) var statuses: [String: PresenceStatus] = [:]
    private var serverEnabled = true
    private var owner: String?
    private var epoch = UUID()
    private var fetching = false
    private var revision = 0
    private var changed: [String: Int] = [:]
    var enabled: Bool { RemoteConfig.shared.presenceStatus && serverEnabled }
    func status(_ userId: String?) -> PresenceStatus? {
        guard enabled, owner == Keychain.load()?.userId, let userId else { return nil }
        return statuses[userId]
    }
    func reset() {
        epoch = UUID(); owner = nil; statuses = [:]; changed = [:]; revision = 0; fetching = false; serverEnabled = true
    }
    private func context() -> String? {
        guard let userId = Keychain.load()?.userId else { reset(); return nil }
        if owner != userId { reset(); owner = userId }
        return userId
    }
    func refresh() async {
        guard let userId = context(), RemoteConfig.shared.presenceStatus, !fetching else { return }
        fetching = true
        let ticket = epoch, started = revision
        defer { if ticket == epoch { fetching = false } }
        do {
            let response: PresenceEnvelope = try await NativeAPI.request("/api/presence")
            guard ticket == epoch, owner == userId, Keychain.load()?.userId == userId else { return }
            serverEnabled = response.enabled
            guard response.enabled else { statuses = [:]; return }
            var next = statuses.filter { (changed[$0.key] ?? 0) > started }
            for status in response.statuses ?? [] where (changed[status.userId] ?? 0) <= started { next[status.userId] = status }
            statuses = next
        } catch { /* A temporary outage keeps this session's last server labels. */ }
    }
    func accept(_ status: PresenceStatus) {
        guard enabled, owner != nil, owner == Keychain.load()?.userId else { return }
        revision += 1; changed[status.userId] = revision; statuses[status.userId] = status
    }
    func event(_ json: String) {
        struct Event: Decodable { let userId: String; let status: PresenceStatus }
        guard let event = try? JSONDecoder().decode(Event.self, from: Data(json.utf8)), event.userId == event.status.userId else { return }
        accept(event.status)
    }
    func save(text: String, startsAt: Date?, endsAt: Date) async throws {
        guard let userId = context() else { throw APIError.unauthorized }
        let ticket = epoch
        let result: PresenceMutation = try await NativeAPI.request("/api/presence/manual", method: "PUT", body: ["text":text, "startsAt": startsAt.map { PresenceTime.iso($0) as Any } ?? NSNull(), "endsAt": PresenceTime.iso(endsAt)])
        guard ticket == epoch, owner == userId, Keychain.load()?.userId == userId else { return }
        accept(result.status)
    }
    func clear(id: String) async throws {
        guard let userId = context() else { throw APIError.unauthorized }
        let ticket = epoch
        let result: PresenceMutation = try await NativeAPI.request("/api/presence/manual?id=" + NativeAPI.escape(id), method: "DELETE")
        guard ticket == epoch, owner == userId, Keychain.load()?.userId == userId else { return }
        // cleared == 0 means another device replaced this manual status. Keep that newer status.
        accept(result.status)
    }
}
