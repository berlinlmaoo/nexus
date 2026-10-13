// swiftc Sources/ChatSystemText.swift Sources/MessagesModels.swift Tests/ChatSystemText/main.swift -o /tmp/chatsys && /tmp/chatsys
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
let bagas = P(id: "u-bagas", name: "Bagas Putro")
let mey = P(id: "u-mey", name: "Mey")
let yuza = P(id: "u-yuza", name: "Yuza")
let angela = P(id: "u-angela", name: "Angela")
let fallback = "Bagas Putro menambahkan Mey ke grup"

/// Both languages at once: [EN, ID].
func both(_ e: ChatSystemEvent?, me: String?, _ en: String, _ id: String, _ label: String) {
    expect(ChatSystemText.sentence(e, fallback: fallback, meId: me, lang: .en), en, label + " [en]")
    expect(ChatSystemText.sentence(e, fallback: fallback, meId: me, lang: .id), id, label + " [id]")
}

// members_added
let added1 = ChatSystemEvent(type: "members_added", actor: bagas, targets: [mey])
both(added1, me: "u-other", "Bagas Putro added Mey", "Bagas Putro menambahkan Mey", "added: them")
both(added1, me: "u-bagas", "You added Mey", "Kamu menambahkan Mey", "added: actor is me")
both(added1, me: "u-mey", "Bagas Putro added you", "Bagas Putro menambahkan kamu", "added: target is me")
both(added1, me: nil, "Bagas Putro added Mey", "Bagas Putro menambahkan Mey", "added: signed-out reader")
let added2 = ChatSystemEvent(type: "members_added", actor: bagas, targets: [mey, yuza])
both(added2, me: "u-other", "Bagas Putro added Mey and Yuza", "Bagas Putro menambahkan Mey dan Yuza", "added: two")
let added3 = ChatSystemEvent(type: "members_added", actor: bagas, targets: [mey, yuza, angela])
both(added3, me: "u-other", "Bagas Putro added Mey, Yuza and Angela", "Bagas Putro menambahkan Mey, Yuza dan Angela", "added: three")
both(added3, me: "u-yuza", "Bagas Putro added you, Mey and Angela", "Bagas Putro menambahkan kamu, Mey dan Angela", "added: me among three")
both(added3, me: "u-bagas", "You added Mey, Yuza and Angela", "Kamu menambahkan Mey, Yuza dan Angela", "added: me adding three")
let addedDup = ChatSystemEvent(type: "members_added", actor: bagas, targets: [mey, mey])
both(addedDup, me: "u-other", "Bagas Putro added Mey", "Bagas Putro menambahkan Mey", "added: duplicate target")
let addedNoNames = ChatSystemEvent(type: "members_added", actor: bagas, targets: [P(id: "u-x", name: nil)])
both(addedNoNames, me: "u-other", fallback, fallback, "added: no target names -> content")
let addedNoActor = ChatSystemEvent(type: "members_added", actor: nil, targets: [mey])
both(addedNoActor, me: "u-other", fallback, fallback, "added: no actor -> content")

// member_removed
let removed = ChatSystemEvent(type: "member_removed", actor: bagas, targets: [mey])
both(removed, me: "u-other", "Bagas Putro removed Mey", "Bagas Putro mengeluarkan Mey", "removed: them")
both(removed, me: "u-bagas", "You removed Mey", "Kamu mengeluarkan Mey", "removed: actor is me")
both(removed, me: "u-mey", "Bagas Putro removed you", "Bagas Putro mengeluarkan kamu", "removed: target is me")

// member_left
let left = ChatSystemEvent(type: "member_left", actor: mey)
both(left, me: "u-other", "Mey left", "Mey keluar", "left: them")
both(left, me: "u-mey", "You left", "Kamu keluar", "left: me")
let leftAsTarget = ChatSystemEvent(type: "member_left", actor: nil, targets: [mey])
both(leftAsTarget, me: "u-other", "Mey left", "Mey keluar", "left: named only as target")

// group_created
let created = ChatSystemEvent(type: "group_created", actor: bagas, targets: [mey, yuza], name: "QA")
both(created, me: "u-other", "Bagas Putro created the group “QA”", "Bagas Putro membuat grup “QA”", "created: them")
both(created, me: "u-bagas", "You created the group “QA”", "Kamu membuat grup “QA”", "created: me")
both(created, me: "u-mey", "Bagas Putro created the group “QA”", "Bagas Putro membuat grup “QA”", "created: me as a first member")
let createdNoName = ChatSystemEvent(type: "group_created", actor: bagas, name: "  ")
both(createdNoName, me: "u-other", "Bagas Putro created the group", "Bagas Putro membuat grup", "created: no name")

// group_renamed
let renamed = ChatSystemEvent(type: "group_renamed", actor: bagas, name: "QA baru", previousName: "QA")
both(renamed, me: "u-other", "Bagas Putro renamed the group to “QA baru”", "Bagas Putro mengubah nama grup jadi “QA baru”", "renamed: them")
both(renamed, me: "u-bagas", "You renamed the group to “QA baru”", "Kamu mengubah nama grup jadi “QA baru”", "renamed: me")
let renamedNoName = ChatSystemEvent(type: "group_renamed", actor: bagas, name: nil)
both(renamedNoName, me: "u-other", fallback, fallback, "renamed: no name -> content")

// unknown / missing
both(ChatSystemEvent(type: "description_changed", actor: bagas), me: "u-bagas", fallback, fallback, "unknown type -> content")
both(ChatSystemEvent(type: nil, actor: bagas), me: "u-bagas", fallback, fallback, "no type -> content")
both(nil, me: "u-bagas", fallback, fallback, "no event -> content")

// names list
expect(ChatSystemText.joinNames([], lang: .en), "", "join 0")
expect(ChatSystemText.joinNames(["Mey"], lang: .en), "Mey", "join 1")
expect(ChatSystemText.joinNames(["Mey", "Yuza"], lang: .en), "Mey and Yuza", "join 2 en")
expect(ChatSystemText.joinNames(["Mey", "Yuza"], lang: .id), "Mey dan Yuza", "join 2 id")
expect(ChatSystemText.joinNames(["Mey", "Yuza", "Angela", "Gerro"], lang: .en), "Mey, Yuza, Angela and Gerro", "join 4 en")
expect(ChatSystemText.joinNames(["Mey", "Yuza", "Angela", "Gerro"], lang: .id), "Mey, Yuza, Angela dan Gerro", "join 4 id")

// MARK: decoding

let dec = JSONDecoder()
func json<T: Decodable>(_ s: String, as: T.Type) -> T? { try? dec.decode(T.self, from: Data(s.utf8)) }

// An older server: no kind, no event — a USER message exactly as before.
let oldPage = json("""
{"messages":[{"id":"m1","userId":"u-bagas","content":"halo","createdAt":"2026-10-08T10:00:00.000Z",
"user":{"id":"u-bagas","name":"Bagas Putro","avatar":null},"attachmentUrl":null,"attachmentType":null,"replyTo":null}],
"hasMore":false}
""", as: MessagesResponse.self)
expectTrue(oldPage?.messages?.count == 1, "old page decodes")
expectTrue(oldPage?.messages?.first?.isSystem == false, "old row is USER")
expectTrue(oldPage?.messages?.first?.event == nil, "old row has no event")
expectTrue(oldPage?.hasCursorField == false, "old page has no cursor field")

// The new server: a SYSTEM row next to a USER row, plus a reply quoting a picture.
let newPage = json("""
{"messages":[
 {"id":"s1","userId":"u-bagas","content":"Bagas Putro menambahkan Mey ke grup","createdAt":"2026-10-08T10:01:00.000Z",
  "kind":"SYSTEM","event":{"type":"members_added","actor":{"id":"u-bagas","name":"Bagas Putro"},"targets":[{"id":"u-mey","name":"Mey"}]},
  "user":{"id":"u-bagas","name":"Bagas Putro","avatar":null},"replyTo":null},
 {"id":"m2","userId":"u-mey","content":"makasih","createdAt":"2026-10-08T10:02:00.000Z","kind":"USER","event":null,
  "replyTo":{"id":"m0","content":"","attachmentType":"image/jpeg","attachmentUrl":"/api/files/chat/a.jpg","user":{"id":"u-bagas","name":"Bagas Putro"}}},
 {"id":"s2","userId":"u-bagas","content":"Bagas Putro melakukan sesuatu","createdAt":"2026-10-08T10:03:00.000Z",
  "kind":"SYSTEM","event":"not an object"}
],"hasMore":false,"nextCursor":null}
""", as: MessagesResponse.self)
let rows = newPage?.messages ?? []
expectTrue(rows.count == 3, "new page decodes all three rows")
expectTrue(rows.first?.isSystem == true, "SYSTEM row recognised")
expect(ChatSystemText.sentence(rows.first?.event, fallback: rows.first?.content ?? "", meId: "u-mey", lang: .en),
       "Bagas Putro added you", "decoded SYSTEM row, read by the target")
expectTrue(rows.count > 1 && rows[1].isSystem == false, "kind USER is a person's message")
expectTrue(rows.count > 1 && rows[1].replyTo?.attachmentUrl == "/api/files/chat/a.jpg", "quote carries its picture when sent")
expectTrue(rows.count > 2 && rows[2].isSystem && rows[2].event == nil, "malformed event costs the event, not the row")
expect(ChatSystemText.sentence(rows.count > 2 ? rows[2].event : nil, fallback: rows.count > 2 ? rows[2].content : "", meId: nil, lang: .en),
       "Bagas Putro melakukan sesuatu", "malformed event -> content")
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
 "lastMessage":{"id":"s1","userId":"u-bagas","content":"Bagas Putro mengubah nama grup jadi “QA”","kind":"SYSTEM",
 "event":{"type":"group_renamed","actor":{"id":"u-bagas","name":"Bagas Putro"},"name":"QA","previousName":"QA lama"}}}],"totalUnread":0}
""", as: ConversationsResponse.self)
let last = list?.conversations?.first?.lastMessage
expectTrue(last?.isSystem == true, "list preview row is SYSTEM")
expect(ChatSystemText.sentence(last?.event, fallback: last?.content ?? "", meId: "u-mey", lang: .en),
       "Bagas Putro renamed the group to “QA”", "list preview sentence [en]")
expect(ChatSystemText.sentence(last?.event, fallback: last?.content ?? "", meId: "u-bagas", lang: .id),
       "Kamu mengubah nama grup jadi “QA”", "list preview sentence [id]")

// GET /info, with one member the server shaped wrongly: that member is dropped, not the screen.
let info = json("""
{"conversation":{"id":"c1","type":"GROUP","name":"QA","description":null,"projectId":null,"createdAt":"2026-10-01T00:00:00.000Z",
 "createdBy":{"id":"u-bagas","name":"Bagas Putro"},"memberCount":3,"mutedUntil":null,"canManageMembers":true,"canEdit":true},
 "members":[{"userId":"u-bagas","name":"Bagas Putro","avatar":null,"isMe":true,"isAdmin":true,"deactivatedAt":null},
            {"userId":"u-mey","name":"Mey","avatar":"/uploads/avatars/u-mey.jpg?t=1","isMe":false,"isAdmin":false,"deactivatedAt":"2026-10-07T00:00:00.000Z"},
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
{"items":[{"messageId":"m1","createdAt":"2026-10-08T10:00:00.000Z","sender":{"id":"u-mey","name":"Mey"},"url":"https://a.example/x"},
          {"messageId":"m1","url":"https://a.example/y","title":"Y"},{"url":"missing id"}],"nextCursor":"abc"}
""", as: ChatMediaPage.self)
expectTrue(media?.items.count == 2 && media?.nextCursor == "abc", "media page, lossy")
expectTrue(Set(media?.items.map(\.id) ?? []).count == 2, "two links of one message have distinct ids")

let search = json("""
{"results":[{"messageId":"m9","createdAt":"2026-10-08T10:00:00.000Z","sender":{"id":"u-mey","name":"Mey"},"snippet":"…rapat jam 3…"}],"nextCursor":null}
""", as: ChatSearchPage.self)
expectTrue(search?.results.first?.snippet == "…rapat jam 3…" && search?.nextCursor == nil, "search page")

print(failures == 0 ? "OK — \(checks) checks passed" : "\(failures) of \(checks) checks failed")
exit(failures == 0 ? 0 : 1)
