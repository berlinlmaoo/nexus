import Foundation
var checks = 0
func check(_ value: @autoclosure () -> Bool, _ message: String) { checks += 1; precondition(value(),message) }
let raw = #"{"userId":"me","state":"future_state","tone":"yellow","reason":"future_reason","label":{"en":"Server words","id":"Kata server"},"until":"2026-10-20T13:00:00Z","manual":{"id":"019a0000-0000-7000-b000-000000000001","text":"Meeting","startsAt":"2026-10-20T11:00:00Z","endsAt":"2026-10-20T13:00:00Z"},"latitude":123,"address":"never persisted"}"#
let status = try JSONDecoder().decode(PresenceStatus.self, from: Data(raw.utf8))
check(status.localizedLabel("id") == "Kata server" && status.localizedLabel("en") == "Server words", "Unknown state and reason display server labels")
let encoded = String(decoding: try JSONEncoder().encode(status), as: UTF8.self)
check(!encoded.contains("latitude") && !encoded.contains("address"), "Only label data is retained")
let today = PresenceTime.instant("2026-10-20T05:00:00Z")!
check(PresenceTime.until(status.until, now: today, language: "en") == "20:00 WIB", "Instant is WIB")
check(PresenceTime.until("2026-10-21", now: today, language: "en") == "21 Oct 2026", "Request end is a day, not midnight UTC")
check(PresenceTime.iso(PresenceTime.todayEnd(today)) == "2026-10-20T16:59:00Z", "Today ends at 23:59 WIB")
func envelope(_ status: String = raw, enabled: Bool = true) -> Data { Data("{\"enabled\":\(enabled),\"statuses\":[\(status)],\"serverTime\":\"2026-10-20T05:00:00Z\"}".utf8) }
@MainActor func run() async throws {
    let store = PresenceStore()
    NativeAPI.replies = [.init(data: envelope())]; await store.refresh()
    check(store.status("me")?.reason == "future_reason", "Workspace cache populated")
    let newRaw = raw.replacingOccurrences(of: "Server words", with: "New status")
    let newStatus = try JSONDecoder().decode(PresenceStatus.self, from: Data(newRaw.utf8))
    let count = NativeAPI.requests.count
    store.event("{\"userId\":\"me\",\"status\":\(newRaw)}")
    check(NativeAPI.requests.count == count && store.status("me") == newStatus, "Realtime patches without fetching")
    NativeAPI.replies = [.init(data: envelope(), delay: 30_000_000)]
    let fetching = Task { await store.refresh() }
    try await Task.sleep(nanoseconds: 5_000_000)
    store.accept(newStatus); await fetching.value
    check(store.status("me") == newStatus, "Slow GET cannot overwrite a newer realtime event")
    NativeAPI.replies = [.init(data: Data("{\"cleared\":0,\"status\":\(newRaw)}".utf8))]
    try await store.clear(id: status.manual!.id)
    check(NativeAPI.requests.last?.0 == "/api/presence/manual?id=" + status.manual!.id, "Clear sends displayed UUID")
    check(store.status("me") == newStatus, "Clear race adopts replacement even when cleared is zero")
    NativeAPI.replies = [.init(data: Data("{\"status\":\(raw)}".utf8))]
    try await store.save(text: "Meeting", startsAt: nil, endsAt: today)
    check(NativeAPI.requests.last?.1 == "PUT" && NativeAPI.requests.last?.2["startsAt"] is NSNull, "Now sends null start")
    RemoteConfig.shared.presenceStatus = false
    check(!store.enabled && store.status("me") == nil, "Remote off hides cache")
    RemoteConfig.shared.presenceStatus = true
    NativeAPI.replies = [.init(data: envelope(enabled:false))]; await store.refresh()
    check(!store.enabled && store.statuses.isEmpty, "Server off hides every status")
    NativeAPI.replies = [.init(data: envelope(), delay: 30_000_000)]
    let old = Task { await store.refresh() }
    try await Task.sleep(nanoseconds: 5_000_000)
    store.reset(); Keychain.session = Session(userId: "new-owner")
    await old.value
    check(store.statuses.isEmpty && store.status("me") == nil, "Logout invalidates in-flight fetch")
    store.accept(status)
    check(store.statuses.isEmpty, "Old events cannot revive a logged-out cache")
}
try await run()
print("\(checks) presence labels, WIB and session/realtime race checks passed")
