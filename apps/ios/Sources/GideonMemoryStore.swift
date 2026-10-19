import Foundation
import Observation

@MainActor @Observable
final class GideonMemoryStore {
    static let shared = GideonMemoryStore()
    private(set) var memories: [GideonMemory] = []
    private(set) var available = true
    private(set) var profileAvailable = false
    private(set) var profile: GideonMemoryProfile?
    private(set) var updatedAt: String?
    private(set) var paused = false
    private(set) var max = 40
    private(set) var textMax = 200
    private(set) var loaded = false
    private(set) var loading = false
    private(set) var busy = false
    private(set) var sessionExpired = false
    var failure: String?
    var notice: String?
    private var owner: String?
    private var epoch = UUID()
    private var revision = 0
    var full: Bool { memories.count >= max }
    func reset() {
        epoch = UUID(); owner = nil; memories = []; paused = false; max = 40; textMax = 200
        available = true; profileAvailable = false; profile = nil; updatedAt = nil
        loaded = false; loading = false; busy = false; failure = nil; notice = nil; sessionExpired = false; revision = 0
    }
    private func context() -> String? {
        guard let uid = Keychain.load()?.userId else { reset(); return nil }
        if owner != uid { reset(); owner = uid }
        return uid
    }
    private func current(_ ticket: UUID, _ uid: String) -> Bool { ticket == epoch && owner == uid && Keychain.load()?.userId == uid }
    private func failed(_ error: Error) {
        if case APIError.unauthorized = error { sessionExpired = true }
        if !Task.isCancelled { failure = error.localizedDescription }
    }
    func refresh() async {
        guard let uid = context(), !loading, !busy else { return }
        let ticket = epoch, before = revision
        loading = true; defer { if current(ticket, uid) { loading = false } }
        do {
            let result: GideonMemories = try await GideonMemoryAPI.request()
            guard current(ticket, uid) else { return }
            if revision != before { loading = false; await refresh(); return }
            acceptState(result)
        } catch { if current(ticket, uid) { failed(error) } }
    }
    private func acceptState(_ result: GideonMemories) {
        memories = result.memories.filter { $0.status != "DELETED" }; paused = result.paused
        available = result.available ?? true; profileAvailable = result.profile != nil; profile = result.profile
        updatedAt = result.updatedAt ?? memories.map(\.updatedAt).max()
        max = Swift.max(1, result.max); textMax = Swift.max(1, result.textMax); loaded = true; failure = nil
        GideonChat.shared.reconcileMemories(memories)
    }
    @discardableResult func setProfile(field: String, value: String) async -> Bool {
        guard ["nickname", "role", "about"].contains(field), profileAvailable else { return false }
        let uid = context(), ticket = epoch
        return await mutate {
            let result: GideonMemories = try await GideonMemoryAPI.request("/profile", method: "PUT", body: [field: value])
            guard let uid, self.current(ticket, uid) else { return }
            self.revision += 1; self.acceptState(result)
        }
    }
    func acceptOwn(_ memory: GideonMemory) {
        guard context() != nil else { return }
        revision += 1; profile = nil
        updatedAt = memory.status == "DELETED" ? Date().ISO8601Format() : memory.updatedAt
        if memory.status == "DELETED" { memories.removeAll { $0.id == memory.id } }
        else if let i = memories.firstIndex(where: { $0.id == memory.id }) { memories[i] = memory }
        else { memories.append(memory) }
        GideonChat.shared.updateMemory(memory)
    }
    private func mutate(_ operation: () async throws -> Void) async -> Bool {
        guard let uid = context(), !busy else { return false }
        let ticket = epoch; busy = true; failure = nil; notice = nil
        defer { if current(ticket, uid) { busy = false } }
        do { try await operation(); return current(ticket, uid) }
        catch { if current(ticket, uid) { failed(error) }; return false }
    }
    func setPaused(_ value: Bool) async {
        let uid = context(), ticket = epoch
        _ = await mutate {
            let result: GideonMemories = try await GideonMemoryAPI.request(method: "PATCH", body: ["paused":value])
            guard let uid, self.current(ticket, uid) else { return }
            self.revision += 1; self.acceptState(result)
        }
    }
    @discardableResult func add(text: String, kind: String, date: String) async -> Bool {
        let uid = context(), ticket = epoch
        return await mutate {
            var body: [String:Any] = ["text":text,"kind":kind]
            if kind == "DATE" && !date.isEmpty { body["date"] = date }
            let reply: GideonMemoryReply = try await GideonMemoryAPI.request(method: "POST", body: body)
            guard let uid, self.current(ticket, uid) else { return }; self.acceptOwn(reply.memory)
        }
    }
    @discardableResult func edit(_ memory: GideonMemory, text: String, kind: String, date: String) async -> Bool {
        let uid = context(), ticket = epoch
        return await mutate {
            var body: [String:Any] = ["text":text,"kind":kind]
            if kind == "DATE" && !date.isEmpty { body["date"] = date }
            let reply: GideonMemoryReply = try await GideonMemoryAPI.request("/" + NativeAPI.escape(memory.id), method: "PATCH", body: body)
            guard let uid, self.current(ticket, uid) else { return }; self.acceptOwn(reply.memory)
        }
    }
    func save(_ memory: GideonMemory) async {
        let uid = context(), ticket = epoch
        _ = await mutate {
            let reply: GideonMemoryReply = try await GideonMemoryAPI.request("/" + NativeAPI.escape(memory.id), method: "PATCH", body: ["status":"ACTIVE"])
            guard let uid, self.current(ticket, uid) else { return }; self.acceptOwn(reply.memory)
        }
    }
    func remove(_ memory: GideonMemory) async {
        let uid = context(), ticket = epoch
        _ = await mutate {
            do { let _: GideonMemoryDeleted = try await GideonMemoryAPI.request("/" + NativeAPI.escape(memory.id), method: "DELETE") }
            catch let error as GideonMemoryFailure where error.status == 404 || error.code == "not_found" { /* Already forgotten. */ }
            guard let uid, self.current(ticket, uid) else { return }
            var deleted = memory; deleted.status = "DELETED"; self.acceptOwn(deleted); self.notice = T("Forgotten.")
        }
    }
    func forgetEverything() async {
        let uid = context(), ticket = epoch
        _ = await mutate {
            let _: GideonMemoriesDeleted = try await GideonMemoryAPI.request(method: "DELETE")
            guard let uid, self.current(ticket, uid) else { return }
            self.revision += 1; self.memories = []; GideonChat.shared.forgetAllMemories(); self.notice = T("Forgotten.")
        }
    }
}
