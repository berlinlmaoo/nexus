import Foundation
var checks = 0
func check(_ value: @autoclosure () -> Bool, _ reason: String) { checks += 1; precondition(value(),reason) }
let raw = #"{"id":"019a0000-0000-7000-b000-000000000001","kind":"DATE","text":"[TEST] synthetic date","monthDay":"03-14","status":"PENDING","source":"CHAT","createdAt":"2026-10-19T00:00:00Z","updatedAt":"2026-10-19T00:00:00Z"}"#
let memory = try JSONDecoder().decode(GideonMemory.self, from: Data(raw.utf8))
check(memory.kind == "DATE" && memory.monthDay == "03-14" && memory.status == "PENDING", "Date suggestion wire shape")
check(GideonMemoryIssue.message(code: "secret", error: "Server refusal", language: "id").contains("KTP"), "ID secret refusal")
check(GideonMemoryIssue.message(code: "paused", error: "Server refusal", language: "id") == "Memori GIDEON sedang mati.", "ID pause refusal")
check(GideonMemoryIssue.message(code: "full", error: "Server refusal", language: "id").contains("40"), "ID maximum refusal")
check(GideonMemoryIssue.message(code: "unknown", error: "Server refusal", language: "id") == "Server refusal", "Future refusals preserve server sentence")
check(GideonMemoryIssue.message(code: "secret", error: "Server refusal", language: "en") == "Server refusal", "English refusal is verbatim")
let frame = try JSONDecoder().decode(GideonEvent.self, from: Data("{\"type\":\"memory\",\"memory\":\(raw)}".utf8))
check(frame.type == "memory" && frame.memory == memory, "Actual SSE DTO decodes memory")
let history = try JSONDecoder().decode(GideonHistoryResponse.self, from: Data("{\"messages\":[{\"id\":\"turn\",\"role\":\"assistant\",\"content\":\"\",\"meta\":{\"memories\":[\(raw)]}}]}".utf8))
check(GideonHistoryProbe.historyTurns(history.messages ?? []).first?.memories == [memory], "Own history carries chip")
check(GideonHistoryProbe.historyTurns(history.messages ?? [], includeMemories:false).first?.memories.isEmpty == true, "Review drops memory metadata even if the server accidentally included it")
let memoryOnly = try JSONDecoder().decode(GideonHistoryResponse.self, from: Data("{\"messages\":[{\"id\":\"turn\",\"role\":\"assistant\",\"content\":null,\"meta\":{\"memories\":[\(raw)]}}]}".utf8))
check(GideonHistoryProbe.historyTurns(memoryOnly.messages ?? []).first?.memories == [memory], "Own memory-only answer is retained")
check(GideonHistoryProbe.historyTurns(memoryOnly.messages ?? [], includeMemories:false).isEmpty, "Memory-only review metadata is not exposed")
let activeRaw = raw.replacingOccurrences(of: "PENDING", with: "ACTIVE")
let active = try JSONDecoder().decode(GideonMemory.self, from: Data(activeRaw.utf8))
func page(_ text: String = raw, paused: Bool = false) -> Data { Data("{\"paused\":\(paused),\"max\":40,\"textMax\":200,\"memories\":[\(text)]}".utf8) }
@MainActor func run() async throws {
    let store = GideonMemoryStore()
    GideonChat.shared.values = [memory]
    GideonMemoryAPI.replies = [.init(data: page())]; await store.refresh()
    check(store.loaded && store.memories == [memory] && store.textMax == 200, "Own settings loaded")
    GideonMemoryAPI.replies = [.init(data: Data("{\"memory\":\(activeRaw)}".utf8))]
    await store.save(memory)
    check(GideonMemoryAPI.requests.last?.0 == "/" + memory.id && GideonMemoryAPI.requests.last?.2["status"] as? String == "ACTIVE", "Save uses opaque memory id and ACTIVE")
    check(GideonChat.shared.values.first?.status == "ACTIVE", "Save patches own chat chip")
    GideonMemoryAPI.replies = [.init(data: Data("{}".utf8),notFound:true)]
    await store.remove(active)
    check(store.memories.isEmpty && GideonChat.shared.values.first?.status == "DELETED", "404 Don't save is already forgotten")
    GideonMemoryAPI.replies = [.init(data: page(paused:true))]; await store.setPaused(true)
    check(store.paused && GideonMemoryAPI.requests.last?.2["paused"] as? Bool == true, "Pause is per person with no user selector")
    GideonMemoryAPI.replies = [.init(data: Data("{\"memory\":\(activeRaw),\"created\":true}".utf8))]
    _ = await store.add(text: "[TEST]", kind: "DATE", date: "03-14")
    check(GideonMemoryAPI.requests.last?.2["date"] as? String == "03-14", "Yearless explicit date")
    check(GideonMemoryAPI.requests.allSatisfy { !$0.2.keys.contains("userId") && !$0.0.contains("?") }, "Memory transport has no actor selector")
    GideonMemoryAPI.replies = [.init(data: page(),delay:30_000_000),.init(data:page(activeRaw))]
    let refresh = Task { await store.refresh() }; try await Task.sleep(nanoseconds:5_000_000)
    store.acceptOwn(active); await refresh.value
    check(store.memories.first?.status == "ACTIVE", "An SSE change during GET is reconciled, not overwritten")
    GideonMemoryAPI.replies = [.init(data:page(),delay:30_000_000)]
    let old = Task { await store.refresh() }; try await Task.sleep(nanoseconds:5_000_000)
    store.reset(); Keychain.session = Session(userId:"other"); await old.value
    check(store.memories.isEmpty && !store.loaded, "Logout drops records and rejects in-flight old-user response")
    GideonMemoryAPI.replies = [.init(data:page())]; await store.refresh()
    GideonMemoryAPI.replies = [.init(data: Data("{\"deleted\":1}".utf8))]; await store.forgetEverything()
    check(store.memories.isEmpty && GideonMemoryAPI.requests.last?.1 == "DELETE" && GideonMemoryAPI.requests.last?.0 == "", "Forget-all own route clears local records")
}
try await run()
print("\(checks) private memory, history exclusion, save/delete and session race checks passed")
