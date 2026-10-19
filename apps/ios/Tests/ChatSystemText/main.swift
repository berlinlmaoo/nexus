// Run scripts/check-native-contracts.sh from apps/ios (includes document and legacy-message contracts).
//
// The SYSTEM message sentences (contract SYSTEM-MESSAGES.md, owner 8 Oct 2026) in English and
// Indonesian, the "You"/"Kamu" variants, the names list, the fallback to `content`, and the lenient
// decoding of `kind`/`event` and of the group-info routes. Linux: swift:5.10-jammy in Docker.
// Exit 1 on any failure.
import Foundation

var failures = 0
var checks = 0

func expect(_ got: String, _ want: String, _ label: String) {
    checks += 1
    if got != want {
        failures += 1
        print("FAIL \(label)\n  got:  \(got)\n  want: \(want)")
    }
}

func expectTrue(_ ok: Bool, _ label: String) {
    checks += 1
    if !ok {
        failures += 1
        print("FAIL \(label)")
    }
}

typealias P = ChatSystemEvent.Person
let budi = P(id: "u-budi", name: "Budi Santoso")
let mira = P(id: "u-mira", name: "Mira")
let yuda = P(id: "u-yuda", name: "Yuda")
let anita = P(id: "u-anita", name: "Anita")
let fallback = "Budi Santoso menambahkan Mira ke grup"

/// Both languages at once: [EN, ID].
func both(_ e: ChatSystemEvent?, me: String?, _ en: String, _ id: String, _ label: String) {
    expect(ChatSystemText.sentence(e, fallback: fallback, meId: me, lang: .en), en, label + " [en]")
    expect(ChatSystemText.sentence(e, fallback: fallback, meId: me, lang: .id), id, label + " [id]")
}

// members_added
let added1 = ChatSystemEvent(type: "members_added", actor: budi, targets: [mira])
both(added1, me: "u-other", "Budi Santoso added Mira", "Budi Santoso menambahkan Mira", "added: them")
both(added1, me: "u-budi", "You added Mira", "Kamu menambahkan Mira", "added: actor is me")
both(added1, me: "u-mira", "Budi Santoso added you", "Budi Santoso menambahkan kamu", "added: target is me")
both(added1, me: nil, "Budi Santoso added Mira", "Budi Santoso menambahkan Mira", "added: signed-out reader")
let added2 = ChatSystemEvent(type: "members_added", actor: budi, targets: [mira, yuda])
both(added2, me: "u-other", "Budi Santoso added Mira and Yuda", "Budi Santoso menambahkan Mira dan Yuda", "added: two")
let added3 = ChatSystemEvent(type: "members_added", actor: budi, targets: [mira, yuda, anita])
both(added3, me: "u-other", "Budi Santoso added Mira, Yuda and Anita", "Budi Santoso menambahkan Mira, Yuda dan Anita", "added: three")
both(added3, me: "u-yuda", "Budi Santoso added you, Mira and Anita", "Budi Santoso menambahkan kamu, Mira dan Anita", "added: me among three")
both(added3, me: "u-budi", "You added Mira, Yuda and Anita", "Kamu menambahkan Mira, Yuda dan Anita", "added: me adding three")
let addedDup = ChatSystemEvent(type: "members_added", actor: budi, targets: [mira, mira])
both(addedDup, me: "u-other", "Budi Santoso added Mira", "Budi Santoso menambahkan Mira", "added: duplicate target")
let addedNoNames = ChatSystemEvent(type: "members_added", actor: budi, targets: [P(id: "u-x", name: nil)])
both(addedNoNames, me: "u-other", fallback, fallback, "added: no target names -> content")
let addedNoActor = ChatSystemEvent(type: "members_added", actor: nil, targets: [mira])
both(addedNoActor, me: "u-other", fallback, fallback, "added: no actor -> content")

// member_removed
let removed = ChatSystemEvent(type: "member_removed", actor: budi, targets: [mira])
both(removed, me: "u-other", "Budi Santoso removed Mira", "Budi Santoso mengeluarkan Mira", "removed: them")
both(removed, me: "u-budi", "You removed Mira", "Kamu mengeluarkan Mira", "removed: actor is me")
both(removed, me: "u-mira", "Budi Santoso removed you", "Budi Santoso mengeluarkan kamu", "removed: target is me")

// member_left
let left = ChatSystemEvent(type: "member_left", actor: mira)
both(left, me: "u-other", "Mira left", "Mira keluar", "left: them")
both(left, me: "u-mira", "You left", "Kamu keluar", "left: me")
let leftAsTarget = ChatSystemEvent(type: "member_left", actor: nil, targets: [mira])
both(leftAsTarget, me: "u-other", "Mira left", "Mira keluar", "left: named only as target")

// group_created
let created = ChatSystemEvent(type: "group_created", actor: budi, targets: [mira, yuda], name: "QA")
both(created, me: "u-other", "Budi Santoso created the group “QA”", "Budi Santoso membuat grup “QA”", "created: them")
both(created, me: "u-budi", "You created the group “QA”", "Kamu membuat grup “QA”", "created: me")
both(created, me: "u-mira", "Budi Santoso created the group “QA”", "Budi Santoso membuat grup “QA”", "created: me as a first member")
let createdNoName = ChatSystemEvent(type: "group_created", actor: budi, name: "  ")
both(createdNoName, me: "u-other", "Budi Santoso created the group", "Budi Santoso membuat grup", "created: no name")

// group_renamed
let renamed = ChatSystemEvent(type: "group_renamed", actor: budi, name: "QA baru", previousName: "QA")
both(renamed, me: "u-other", "Budi Santoso renamed the group to “QA baru”", "Budi Santoso mengubah nama grup jadi “QA baru”", "renamed: them")
both(renamed, me: "u-budi", "You renamed the group to “QA baru”", "Kamu mengubah nama grup jadi “QA baru”", "renamed: me")
let renamedNoName = ChatSystemEvent(type: "group_renamed", actor: budi, name: nil)
both(renamedNoName, me: "u-other", fallback, fallback, "renamed: no name -> content")

// unknown / missing
both(ChatSystemEvent(type: "description_changed", actor: budi), me: "u-budi", fallback, fallback, "unknown type -> content")
both(ChatSystemEvent(type: nil, actor: budi), me: "u-budi", fallback, fallback, "no type -> content")
both(nil, me: "u-budi", fallback, fallback, "no event -> content")

// names list
expect(ChatSystemText.joinNames([], lang: .en), "", "join 0")
expect(ChatSystemText.joinNames(["Mira"], lang: .en), "Mira", "join 1")
expect(ChatSystemText.joinNames(["Mira", "Yuda"], lang: .en), "Mira and Yuda", "join 2 en")
expect(ChatSystemText.joinNames(["Mira", "Yuda"], lang: .id), "Mira dan Yuda", "join 2 id")
expect(ChatSystemText.joinNames(["Mira", "Yuda", "Anita", "Gilang"], lang: .en), "Mira, Yuda, Anita and Gilang", "join 4 en")
expect(ChatSystemText.joinNames(["Mira", "Yuda", "Anita", "Gilang"], lang: .id), "Mira, Yuda, Anita dan Gilang", "join 4 id")

// MARK: decoding

let dec = JSONDecoder()
func json<T: Decodable>(_ s: String, as: T.Type) -> T? { try? dec.decode(T.self, from: Data(s.utf8)) }

// An older server: no kind, no event — a USER message exactly as before.
let oldPage = json("""
{"messages":[{"id":"m1","userId":"u-budi","content":"halo","createdAt":"2026-10-08T10:00:00.000Z",
"user":{"id":"u-budi","name":"Budi Santoso","avatar":null},"attachmentUrl":null,"attachmentType":null,"replyTo":null}],
"hasMore":false}
""", as: MessagesResponse.self)
expectTrue(oldPage?.messages?.count == 1, "old page decodes")
expectTrue(oldPage?.messages?.first?.isSystem == false, "old row is USER")
expectTrue(oldPage?.messages?.first?.event == nil, "old row has no event")
expectTrue(oldPage?.hasCursorField == false, "old page has no cursor field")

// The new server: a SYSTEM row next to a USER row, plus a reply quoting a picture.
let newPage = json("""
{"messages":[
 {"id":"s1","userId":"u-budi","content":"Budi Santoso menambahkan Mira ke grup","createdAt":"2026-10-08T10:01:00.000Z",
  "kind":"SYSTEM","event":{"type":"members_added","actor":{"id":"u-budi","name":"Budi Santoso"},"targets":[{"id":"u-mira","name":"Mira"}]},
  "user":{"id":"u-budi","name":"Budi Santoso","avatar":null},"replyTo":null},
 {"id":"m2","userId":"u-mira","content":"makasih","createdAt":"2026-10-08T10:02:00.000Z","kind":"USER","event":null,
  "replyTo":{"id":"m0","content":"","attachmentType":"image/jpeg","attachmentUrl":"/api/files/chat/a.jpg","user":{"id":"u-budi","name":"Budi Santoso"}}},
 {"id":"s2","userId":"u-budi","content":"Budi Santoso melakukan sesuatu","createdAt":"2026-10-08T10:03:00.000Z",
  "kind":"SYSTEM","event":"not an object"}
],"hasMore":false,"nextCursor":null}
""", as: MessagesResponse.self)
let rows = newPage?.messages ?? []
expectTrue(rows.count == 3, "new page decodes all three rows")
expectTrue(rows.first?.isSystem == true, "SYSTEM row recognised")
expect(ChatSystemText.sentence(rows.first?.event, fallback: rows.first?.content ?? "", meId: "u-mira", lang: .en),
       "Budi Santoso added you", "decoded SYSTEM row, read by the target")
expectTrue(rows.count > 1 && rows[1].isSystem == false, "kind USER is a person's message")
expectTrue(rows.count > 1 && rows[1].replyTo?.attachmentUrl == "/api/files/chat/a.jpg", "quote carries its picture when sent")
expectTrue(rows.count > 2 && rows[2].isSystem && rows[2].event == nil, "malformed event costs the event, not the row")
expect(ChatSystemText.sentence(rows.count > 2 ? rows[2].event : nil, fallback: rows.count > 2 ? rows[2].content : "", meId: nil, lang: .en),
       "Budi Santoso melakukan sesuatu", "malformed event -> content")
expectTrue(newPage?.hasCursorField == true, "new page has the cursor field")
expectTrue(newPage?.hasMoreNewer == nil, "a plain page has no hasMoreNewer")

// An around= page (the server's shape, 8 Oct 2026): older cursor as before, plus the newer side.
let around = json("""
{"messages":[{"id":"m4","content":"a"},{"id":"m5","content":"b"},{"id":"m6","content":"c"}],
 "hasMore":true,"nextCursor":"cur-old","hasMoreNewer":false,"newerCursor":null,"anchorId":"m5"}
""", as: MessagesResponse.self)
expectTrue(around?.messages?.count == 3 && around?.hasMore == true && around?.nextCursor == "cur-old", "around page, older side")
expectTrue(around?.hasMoreNewer == false, "around page, newer side")

// The conversation list's lastMessage carries them too.
let list = json("""
{"conversations":[{"id":"c1","type":"GROUP","name":"QA","members":[],"unreadCount":0,
 "lastMessage":{"id":"s1","userId":"u-budi","content":"Budi Santoso mengubah nama grup jadi “QA”","kind":"SYSTEM",
 "event":{"type":"group_renamed","actor":{"id":"u-budi","name":"Budi Santoso"},"name":"QA","previousName":"QA lama"}}}],"totalUnread":0}
""", as: ConversationsResponse.self)
let last = list?.conversations?.first?.lastMessage
expectTrue(last?.isSystem == true, "list preview row is SYSTEM")
expect(ChatSystemText.sentence(last?.event, fallback: last?.content ?? "", meId: "u-mira", lang: .en),
       "Budi Santoso renamed the group to “QA”", "list preview sentence [en]")
expect(ChatSystemText.sentence(last?.event, fallback: last?.content ?? "", meId: "u-budi", lang: .id),
       "Kamu mengubah nama grup jadi “QA”", "list preview sentence [id]")

// GET /info, with one member the server shaped wrongly: that member is dropped, not the screen.
let info = json("""
{"conversation":{"id":"c1","type":"GROUP","name":"QA","description":null,"projectId":null,"createdAt":"2026-10-01T00:00:00.000Z",
 "createdBy":{"id":"u-budi","name":"Budi Santoso"},"memberCount":3,"mutedUntil":null,"canManageMembers":true,"canEdit":true},
 "members":[{"userId":"u-budi","name":"Budi Santoso","avatar":null,"isMe":true,"isAdmin":true,"deactivatedAt":null},
            {"userId":"u-mira","name":"Mira","avatar":"/uploads/avatars/u-mira.jpg?t=1","isMe":false,"isAdmin":false,"deactivatedAt":"2026-10-07T00:00:00.000Z"},
            {"name":"no id"}],
 "counts":{"photos":4,"links":2,"docs":0}}
""", as: ChatInfoResponse.self)
expectTrue(info?.conversation?.canManageMembers == true && info?.conversation?.canEdit == true, "info flags")
expectTrue(info?.conversation?.memberCount == 3, "info memberCount")
expectTrue(info?.members.count == 2, "info drops the unreadable member only")
expectTrue(info?.members.first?.isAdmin == true && info?.members.first?.isMe == true, "info member flags")
expectTrue(info?.members.last?.deactivatedAt != nil, "info deactivatedAt")
expectTrue(info?.counts?.total == 6, "info counts")

let media = json("""
{"items":[{"messageId":"m1","createdAt":"2026-10-08T10:00:00.000Z","sender":{"id":"u-mira","name":"Mira"},"url":"https://a.example/x"},
          {"messageId":"m1","url":"https://a.example/y","title":"Y"},{"url":"missing id"}],"nextCursor":"abc"}
""", as: ChatMediaPage.self)
expectTrue(media?.items.count == 2 && media?.nextCursor == "abc", "media page, lossy")
expectTrue(Set(media?.items.map(\.id) ?? []).count == 2, "two links of one message have distinct ids")

let search = json("""
{"results":[{"messageId":"m9","createdAt":"2026-10-08T10:00:00.000Z","sender":{"id":"u-mira","name":"Mira"},"snippet":"…rapat jam 3…"}],"nextCursor":null}
""", as: ChatSearchPage.self)
expectTrue(search?.results.first?.snippet == "…rapat jam 3…" && search?.nextCursor == nil, "search page")

// Document attachments preserve metadata and remain compatible with pre-document messages.
let document = json(#"{"id":"doc","content":"","attachmentUrl":"/api/files/chat/example.docx","attachmentType":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","attachmentName":"Meeting notes.docx","attachmentSize":4096}"#, as: ChatMessage.self)
expectTrue(document?.attachmentName == "Meeting notes.docx" && document?.attachmentSize == 4096, "document message metadata")
let oldImage = json(#"{"id":"image","content":"","attachmentUrl":"/api/files/chat/image.jpg","attachmentType":"image/jpeg"}"#, as: ChatMessage.self)
expectTrue(oldImage?.attachmentName == nil && oldImage?.attachmentSize == nil, "old images decode without file metadata")
let upload = json(#"{"url":"/api/files/chat/a.pdf","type":"application/pdf","kind":"file","name":"Agenda.pdf","size":128}"#, as: ChatUpload.self)
expectTrue(upload?.name == "Agenda.pdf" && upload?.kind == "file", "document upload contract")
let oldUpload = json(#"{"url":"/api/files/chat/a.jpg","type":"image/jpeg"}"#, as: ChatUpload.self)
expectTrue(oldUpload?.name == nil && oldUpload?.kind == nil, "old upload contract")
expectTrue(ChatAttachment.isDocument("application/pdf", path: nil), "PDF is a document")
expectTrue(ChatAttachment.isDocument(nil, path: "/api/files/chat/a.xlsx"), "legacy Office URL is a document")
expectTrue(!ChatAttachment.isDocument("image/jpeg", path: "/api/files/chat/a.jpg"), "images keep their photo viewer")
expectTrue(!ChatAttachment.isDocument(nil, path: nil), "text-only messages don't become files")

let docsMedia = json(#"{"messageId":"d1","url":"/api/files/chat/spec.pdf","attachmentType":"application/pdf","name":"Specification.pdf","size":2048}"#, as: ChatMediaItem.self)
expectTrue(docsMedia?.name == "Specification.pdf" && docsMedia?.size == 2048, "Docs tab preserves file name and size")
expectTrue(media?.items.first?.name == nil && media?.items.first?.size == nil, "older media remains compatible")

print(failures == 0 ? "OK — \(checks) checks passed" : "\(failures) of \(checks) checks failed")
exit(failures == 0 ? 0 : 1)
