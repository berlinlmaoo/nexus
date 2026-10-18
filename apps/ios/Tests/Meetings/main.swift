import Foundation
let base = #"{"meeting":{"id":"019a12d5-0000-7000-8000-000000000001","title":"Meeting","status":"READY","progress":1,"language":"auto","source":"upload","projectId":"019a12d5-0000-7000-8000-000000000002","createdBy":{"id":"person","name":"Person"},"audio":{"name":"meeting.m4a","mime":"audio/mp4","bytes":100,"received":100,"available":true},"durationSec":60,"taskCount":0,"version":1,"createdAt":"2026-10-18T00:00:00Z","updatedAt":"2026-10-18T00:00:00Z","can":{"edit":true,"apply":true,"delete":true,"retry":true},"queue":{"waiting":true,"position":2,"etaSec":300},"mom":{"attendees":[],"topics":[],"decisions":[],"openQuestions":[],"actionItems":[]},"proposals":[],"transcript":[]}}"#
var checks = 0
func expect(_ condition: @autoclosure () -> Bool, _ reason: String) { checks += 1; precondition(condition(), reason) }
func payload(_ title: String, _ version: Int) -> Data { Data(base.replacingOccurrences(of: "\"title\":\"Meeting\"", with: "\"title\":\"\(title)\"").replacingOccurrences(of: "\"version\":1", with: "\"version\":\(version)").utf8) }
@MainActor func run() async throws {
    var m = try JSONDecoder().decode(MeetingEnvelope.self, from: Data(base.utf8)).meeting
    expect(m.queue?.position == 2 && m.canApplyDraft, "Zero selected tasks still permits saving the minutes")
    m.projectId = ""; expect(!m.canApplyDraft, "Empty project cannot Apply")
    m.projectId = "project"
    m.proposals = [.init(key: "a", include: true, title: "  ", description: "", assigneeIds: [], dueDate: nil, actionIndex: nil)]
    expect(!m.canApplyDraft, "A ticked blank title blocks Apply")
    m.proposals?[0].include = false; expect(m.canApplyDraft, "Unticked blank proposals do not block Apply")
    m.status = "APPLIED"; expect(!m.canApplyDraft, "Applied minutes cannot create tasks twice")
    expect(MeetingIssue.message("TOO_LARGE", metadata: ["maxBytes":123])?.contains("123") == true, "Use server size limit")
    expect(MeetingIssue.message("TOO_LONG", metadata: ["maxMinutes":7])?.contains("7") == true, "Use server duration limit")
    let store = MeetingStore(id: "meeting")
    NativeAPI.replies = [.init(data: payload("Meeting",1))]; await store.load()
    NativeAPI.requests = []
    store.change(["title":"First"]) { $0.title = "First" }
    NativeAPI.replies = [.init(data: payload("First",2), delay: 50_000_000), .init(data: payload("Latest",3))]
    let saving = Task { await store.flush() }
    try await Task.sleep(nanoseconds: 10_000_000)
    store.change(["title":"Latest"]) { $0.title = "Latest" }
    let saved = await saving.value
    expect(saved && store.meeting?.title == "Latest" && store.meeting?.version == 3, "In-flight save retains and sends the latest edit")
    expect(NativeAPI.requests.map { $0.1["version"] as? Int } == [1,2], "Serial PATCHes use the last acknowledged version")
    expect(NativeAPI.requests.allSatisfy { Set($0.1.keys) == ["title","version"] }, "PATCH sends only changed fields plus version")
    store.change(["overview":"Draft"]) { $0.overview = "Draft" }
    NativeAPI.replies = [.init(data: payload("Other person",4), conflict: true)]
    let conflict = await store.flush()
    expect(!conflict && store.meeting?.title == "Other person" && !store.hasUnsaved, "Conflict adopts server state and clears rejected edits")
    expect(store.notice != nil, "Conflict is explained")
    store.change(["title":"Final"]) { $0.title = "Final" }
    NativeAPI.replies = [.init(data: payload("Final",5), delay: 30_000_000), .init(data: payload("Concurrent",6))]
    let heldSave = Task { await store.flush() }
    try await Task.sleep(nanoseconds: 5_000_000)
    await store.event(#"{"meetingId":"meeting","version":6,"status":"READY"}"#)
    _ = await heldSave.value
    expect(store.meeting?.version == 6 && store.meeting?.title == "Concurrent", "An event held during a save is reconciled after pending edits drain")
    await store.event(#"{"meetingId":"meeting","version":3,"status":"UPLOADING"}"#)
    expect(store.meeting?.version == 6, "Stale events cannot regress state")
    await store.event(#"{"meetingId":"different","deleted":true}"#)
    expect(!store.deleted, "Other meetings' events are ignored")
    await store.event(#"{"meetingId":"meeting","deleted":true}"#)
    expect(store.deleted, "Deleted event closes this meeting")
}
try await run()
print("\(checks) meeting wire and concurrent autosave checks passed")
