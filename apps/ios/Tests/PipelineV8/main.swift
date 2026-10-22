import Foundation

var checks = 0
var failures = 0
func expect<T: Equatable>(_ actual: T, _ wanted: T, _ label: String) {
    checks += 1
    if actual != wanted { failures += 1; print("FAIL \(label): \(actual) != \(wanted)") }
}
func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try JSONDecoder().decode(type, from: Data(json.utf8))
}
func query() -> [String: String] {
    let items = URLComponents(url: APIClient.last!.url!, resolvingAgainstBaseURL: false)!.queryItems ?? []
    return Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
}
func requestBody() throws -> [String: Any] {
    try JSONSerialization.jsonObject(with: APIClient.last!.httpBody!) as! [String: Any]
}

// Older servers omit every v8 key. Existing commercial, real-cost and term data must survive.
var legacy = try decode(PipelineDeal.self, #"{"id":"d","netValue":100000000,"notes":"keep this","costs":[{"id":"c","label":"Venue","amount":43000000}],"terms":[{"id":"t","amount":25000000}],"links":[{"id":"l","type":"Kontrak","url":"https://example.invalid"}]}"#)
expect(legacy.barterValue, 0, "legacy barter")
expect(legacy.barterCompensation, "", "legacy compensation")
expect(legacy.cashback.count, 0, "legacy cashback")
expect(legacy.cashbackTotal, 0, "legacy cashback total")
expect(legacy.contacts.count, 0, "legacy contacts")
expect(legacy.budgets.count, 0, "legacy budgets")
expect(legacy.budgetTotal, 0, "legacy budget total")
expect(legacy.eventYear, nil, "legacy event year")
expect(legacy.source, nil, "legacy source")
expect(legacy.costs.first?.budgetId, nil, "legacy cost category")
legacy.apply(["barterValue": 7000000, "barterCompensation": "Booth 3x3"])
expect(legacy.barterValue, 7000000, "optimistic barter")
expect(legacy.barterCompensation, "Booth 3x3", "optimistic compensation")
expect(legacy.notes, "keep this", "unrelated notes preserved")
expect(legacy.costTotal, 43000000, "unrelated costs preserved")
expect(legacy.terms.first?.amount, 25000000, "unrelated terms preserved")
expect(legacy.links.first?.type, "Kontrak", "stored document type preserved")

let v8JSON = #"""
{"id":"v8","netValue":100000000,"mainDate":"2026-11-02","eventYear":2026,
 "barterValue":5000000,"barterCompensation":"2 slot iklan TV","cashbackTotal":2000000,"budgetTotal":40000000,
 "costs":[{"id":"c_venue","label":"Sewa venue","amount":31000000,"budgetId":"b_venue"},
          {"id":"c_talent","label":"Talent fee","amount":10000000,"budgetId":"b_talent"},
          {"id":"c_misc","label":"Lain-lain","amount":2000000,"budgetId":null}],
 "cashback":[{"id":"cb","dealId":"v8","position":1024,"name":"Budi","amount":1500000},
             {"id":"cb2","position":2048,"name":"Sari","amount":500000},null,{}],
 "contacts":[{"id":"ct","role":"PM (client side)","name":"Rina","phone":"0813-3333"},
             {"id":"ct2"},{"id":"ct3","role":"A future role"},null],
 "budgets":[{"id":"b_venue","name":"Venue","amount":25000000,"spent":31000000,"remaining":-6000000},
            {"id":"b_talent","name":"Talent","amount":15000000,"spent":10000000,"remaining":5000000},{}],
 "source":{"projectId":"p_company","name":"Pipeline Suwara"}}
"""#
var v8 = try decode(PipelineDeal.self, v8JSON)
expect(v8.barterValue, 5000000, "v8 barter")
expect(v8.barterCompensation, "2 slot iklan TV", "v8 compensation")
expect(v8.cashback.map(\.name), ["Budi", "Sari"], "bad cashback rows do not discard good rows")
expect(v8.cashbackTotal, 2000000, "cashback total")
expect(v8.contacts.map(\.role), ["PM (client side)", "Client", "A future role"], "contact role defaults and future values")
expect(v8.contacts.first?.phone, "0813-3333", "free-form phone")
expect(v8.budgets.map(\.remaining), [-6000000, 5000000], "over and under budget")
expect(v8.budgetTotal, 40000000, "budget total")
expect(v8.costTotal, 43000000, "budget does not change cost")
expect(v8.margin, 57000000, "budget and cashback do not change margin")
expect(v8.source?.projectId, "p_company", "deal opens its own board")
expect(v8.source?.companyName, "Suwara", "company chip")
expect(v8.eventYear, 2026, "server event year")
expect(v8.costs.map(\.budgetId), ["b_venue", "b_talent", nil], "cost categories")

// Every line serializes an explicit category, including null, in both costs and costsBase.
let costJSON = try JSONSerialization.jsonObject(with: JSONSerialization.data(withJSONObject: v8.costs.map(\.json))) as! [[String: Any]]
expect(costJSON[0]["budgetId"] as? String, "b_venue", "linked category encoded")
expect(costJSON[2]["budgetId"] is NSNull, true, "unassigned category is explicit null")
expect(costJSON.allSatisfy { $0.keys.contains("budgetId") }, true, "category key never omitted")
v8.apply(["costs": [["id":"c_venue", "label":"Changed", "amount":32000000]]])
expect(v8.costs[0].budgetId, "b_venue", "older cost patch preserves category")
v8.apply(["costs": [["id":"c_venue", "label":"Changed", "amount":32000000, "budgetId": NSNull()]]])
expect(v8.costs[0].budgetId, nil, "explicit null clears category")
v8.apply(["mainDate": "2027-01-01"])
expect(v8.eventYear, 2027, "optimistic event year follows main date")
v8.apply(["mainDate": NSNull()])
expect(v8.eventYear, nil, "cleared main date clears event year")
let emptyKeys = try decode(PipelineDeal.self, #"{"id":"nulls","barterValue":null,"barterCompensation":null,"cashback":null,"contacts":null,"budgets":null,"eventYear":null,"source":null}"#)
expect(emptyKeys.barterValue, 0, "null money defaults")
expect(emptyKeys.cashback.count + emptyKeys.contacts.count + emptyKeys.budgets.count, 0, "null lists default")

let fallback = try decode(PipelineVocab.self, "{}")
expect(fallback.linkTypes, ["Deck", "Quotation", "Kontrak", "SPK", "MOU", "Invoice", "Report", "Lainnya"], "v8 fallback document order")
expect(fallback.contactRoles, ["Client", "Vendor", "Broker", "PM (client side)", "Finance", "Admin", "Other"], "fallback contact roles")
let future = try decode(PipelineVocab.self, #"{"linkTypes":["Deck","Future type"],"contactRoles":["Future role"]}"#)
expect(future.linkTypes, ["Deck", "Future type"], "server document types win")
expect(future.contactRoles, ["Future role"], "server contact roles win")
expect(PipelineText.link("Lainnya"), "Other", "stored document key keeps correct English label")
expect(PipelineText.contactRole("Other"), "Other contact", "other contact label")
for language: AppLang in [.en, .id] {
    AppLanguage.shared.lang = language
    expect(PipelineFormat.idrFull(6000000), "Rp 6.000.000", "rupiah grouping in both languages")
}

let oldBoard = try decode(PipelineResponse.self, "{}")
expect(oldBoard.years, [], "legacy board years")
expect(oldBoard.year, nil, "legacy selected year")
expect(oldBoard.canEdit, true, "legacy edit permission preserved")
let board = try decode(PipelineResponse.self, #"{"years":[2027,2026],"year":2026,"canEdit":false,"deals":[{"id":"ok"},{}]}"#)
expect(board.years, [2027,2026], "available years")
expect(board.year, 2026, "selected year")
expect(board.deals.map(\.id), ["ok"], "malformed deal isolation")
expect(board.canEdit, false, "read-only board")
let all = try decode(PipelineAllResponse.self, "{\"boards\":[{\"id\":\"p\",\"name\":\"Pipeline Suwara\",\"dealCount\":3},{}],\"deals\":[\(v8JSON)],\"years\":[2027,2026],\"year\":2026,\"source\":\"p\",\"canEdit\":true}")
expect(all.canEdit, false, "all pipelines is always read-only")
expect(all.boards.first?.dealCount, 3, "board deal count")
expect(all.boards.count, 1, "malformed board isolation")
expect(all.deals.first?.source?.projectId, "p_company", "combined deal source")
expect(all.years, [2027,2026], "combined years")
expect(all.source, "p", "combined selected source")
let emptyAll = try decode(PipelineAllResponse.self, "{}")
expect(emptyAll.canEdit, false, "empty all pipelines remains read-only")
expect(emptyAll.boards.count, 0, "empty all boards")
let history = try decode(PipelineChange.self, #"{"field":"budget.amount","termId":"b","termLabel":"Venue","before":25000000,"after":30000000}"#)
expect(history.termId, "b", "item history id")
expect(history.termLabel, "Venue", "item history label")
expect(history.before?.foundation as? Int, 25000000, "item history amount")

// History snapshots contain private amounts too. Contacts never render an amount, even if supplied.
for kind in ["cashback", "budget"] {
    for action in ["created", "deleted", "restored"] {
        let snapshot = AuditJSON.object(["name":.string("Venue"), "amount":.number(6000000)])
        expect(PipelineItemHistory.value(field: "\(kind).\(action)", value: snapshot, presenting: true), "Rp ••••", "lifecycle amount masked")
        expect(PipelineItemHistory.value(field: "\(kind).\(action)", value: snapshot, presenting: false), "Rp 6.000.000", "lifecycle amount visible")
    }
    expect(PipelineItemHistory.value(field: "\(kind).amount", value: .number(6000000), presenting: true), "Rp ••••", "changed amount masked")
    expect(PipelineItemHistory.value(field: "\(kind).amount", value: .string("6000000"), presenting: true), "Rp ••••", "numeric string amount masked")
    expect(PipelineItemHistory.value(field: "\(kind).amount", value: .object(["unknown":.number(6000000)]), presenting: true), "Rp ••••", "unknown amount payload remains private")
}
let contactSnapshot = AuditJSON.object(["role":.string("Client"), "name":.string("Andi"), "phone":.string("0812"), "amount":.number(6000000)])
for presenting in [false, true] {
    for action in ["created", "deleted", "restored"] {
        expect(PipelineItemHistory.value(field: "contact.\(action)", value: contactSnapshot, presenting: presenting), "Client · Andi · 0812", "contact snapshots contain no money")
    }
    expect(PipelineItemHistory.value(field: "contact.amount", value: .number(6000000), presenting: presenting), "–", "contact amount never rendered")
    expect(PipelineItemHistory.value(field: "contact.phone", value: .string("0899"), presenting: presenting), "0899", "contact phone stays visible")
}
expect(PipelineItemHistory.value(field: "contact.role", value: .string("Other"), presenting: false), "Other contact", "history role labels")
expect(PipelineItemHistory.value(field: "contact.phone", value: .null, presenting: false), "empty", "null item value")
expect(PipelineItemHistory.value(field: "netValue", value: .number(6000000), presenting: true), nil, "non-item history keeps existing renderer")

// Exercise actual API methods with actual makeRequest URL construction and a recording transport.
let api = APIClient.shared
_ = try await api.pipeline(projectId: "board-id_~", year: 2026)
expect(APIClient.last!.url!.path, "/api/projects/board-id_~/pipeline", "board id path")
expect(query(), ["year":"2026"], "board year query")
_ = try await api.pipeline(projectId: "p")
expect(query(), [:], "all years omits year")
_ = try await api.pipelineBoards(workspaceId: "workspace /+&")
expect(APIClient.last!.url!.path, "/api/pipelines/boards", "board list path")
expect(query(), ["workspaceId":"workspace /+&"], "workspace query escaping")
_ = try await api.pipelineAll(workspaceId: "w", source: "source/&", year: 2027)
expect(APIClient.last!.url!.path, "/api/pipelines/all", "combined path")
expect(query(), ["workspaceId":"w", "source":"source/&", "year":"2027"], "combined filters")

let tapId = UUID().uuidString
APIClient.payload = Data(#"{"deal":{"id":"d","cashback":[{"id":"item"}]},"item":{"id":"item","kind":"cashback"}}"#.utf8)
let added = try await api.pipelineAddItem(projectId: "p", dealId: "d", kind: "cashback", fields: ["name":"Budi", "amount":1500000], clientRequestId: tapId)
expect(APIClient.last!.httpMethod, "POST", "item add method")
expect(APIClient.last!.url!.path, "/api/projects/p/pipeline/d/items", "item add path")
var body = try requestBody()
expect(body["clientRequestId"] as? String, tapId, "add carries caller tap id")
expect(body["kind"] as? String, "cashback", "add kind")
expect(body["amount"] as? Int, 1500000, "add amount")
expect(added.deal?.cashback.first?.id, "item", "add returns whole deal")
expect(added.duplicate, false, "new item not duplicate")
APIClient.payload = Data(#"{"deal":{"id":"d"},"item":{"id":"item","kind":"cashback"},"duplicate":true}"#.utf8)
let duplicate = try await api.pipelineAddItem(projectId: "p", dealId: "d", kind: "cashback", clientRequestId: tapId)
body = try requestBody()
expect(body["clientRequestId"] as? String, tapId, "retry reuses tap id")
expect(duplicate.duplicate, true, "duplicate response")
expect(duplicate.item?.id, "item", "duplicate retains original item")
_ = try await api.pipelineUpdateItem(projectId: "p", dealId: "d", itemId: "item /", fields: ["phone":"0899"])
expect(APIClient.last!.httpMethod, "PATCH", "item edit method")
body = try requestBody()
expect(Set(body.keys), Set(["phone"]), "edit sends changed fields only")
_ = try await api.pipelineDeleteItem(projectId: "p", dealId: "d", itemId: "item")
expect(APIClient.last!.httpMethod, "DELETE", "item delete method")
expect(APIClient.last!.httpBody == nil, true, "delete has no body")

APIClient.payload = Data(#"{"id":"d"}"#.utf8)
_ = try await api.pipelineUpdate(projectId: "p", dealId: "d", fields: ["barterCompensation":"Booth"])
body = try requestBody()
expect(Set(body.keys), Set(["barterCompensation"]), "barter edit cannot wipe older fields")
_ = try await api.pipelineUpdate(projectId: "p", dealId: "d", fields: ["costs":v8.costs.map(\.json), "costsBase":legacy.costs.map(\.json)])
body = try requestBody()
expect((body["costs"] as! [[String: Any]])[0]["budgetId"] is NSNull, true, "cost patch explicit clear")
expect((body["costsBase"] as! [[String: Any]])[0]["budgetId"] is NSNull, true, "merge base explicit unassigned category")

APIClient.payload = Data("xlsx bytes".utf8)
let boardExport = try await api.pipelineExport(projectId: "p", lang: "id", year: 2026)
expect(query(), ["lang":"id", "year":"2026"], "board export retains year")
expect(boardExport.pathExtension, "xlsx", "workbook extension")
expect(try Data(contentsOf: boardExport), APIClient.payload, "downloaded workbook intact")
try FileManager.default.removeItem(at: boardExport.deletingLastPathComponent())
let allExport = try await api.pipelineAllExport(lang: "en", workspaceId: "w", source: "p /&", year: 2027)
expect(APIClient.last!.url!.path, "/api/pipelines/all/export", "combined workbook path")
expect(query(), ["lang":"en", "workspaceId":"w", "source":"p /&", "year":"2027"], "combined workbook filters")
try FileManager.default.removeItem(at: allExport.deletingLastPathComponent())

APIClient.status = 403
APIClient.payload = Data(#"{"error":"All Pipelines is for BoD and One Above All only.","code":"ALL_PIPELINES_FORBIDDEN"}"#.utf8)
do {
    _ = try await api.pipelineBoards(workspaceId: "w")
    expect(false, true, "403 must be surfaced to hide entry points")
} catch APIError.http(let code, let message) {
    expect(code, 403, "forbidden status")
    expect(message, "All Pipelines is for BoD and One Above All only.", "server refusal preserved")
}
APIClient.status = 404
do {
    _ = try await api.pipelineDeleteItem(projectId: "p", dealId: "d", itemId: "gone")
    expect(false, true, "deleted item 404 must surface")
} catch APIError.http(let code, _) { expect(code, 404, "already-deleted item status") }
APIClient.status = 200
APIClient.transportFails = true
do {
    _ = try await api.pipelineAll()
    expect(false, true, "transport failure must surface")
} catch APIError.offline { expect(true, true, "transport failure maps to no answer") }

// A directory read from an earlier login can finish after another account (or the same account
// signing in again). It must neither block the new read nor replace its authorization/board list.
APIClient.transportFails = false
let directory = PipelineBoardDirectory.shared
for oldResultIsForbidden in [true, false] {
    directory.reset()
    var activeWorkspace = "old"
    var pending: CheckedContinuation<(Data, URLResponse), Error>?
    APIClient.workspaceProbe = { WorkspaceInfo(workspaceId: activeWorkspace, role: "BOD") }
    APIClient.requestProbe = { request in
        let workspace = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!.first!.value!
        if workspace == "old" {
            return try await withCheckedThrowingContinuation { pending = $0 }
        }
        return (Data(#"{"workspaceId":"new","boards":[{"id":"new-board","name":"New board"}]}"#.utf8),
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
    let oldRead = Task { await directory.load(viewerId: "same-viewer") }
    while pending == nil { await Task.yield() }
    directory.reset()
    activeWorkspace = "new"
    await directory.load(viewerId: oldResultIsForbidden ? "different-viewer" : "same-viewer")
    expect(directory.canView, true, "new login starts before old directory request completes")
    expect(directory.boards.map(\.id), ["new-board"], "new account boards loaded immediately")
    if oldResultIsForbidden {
        pending!.resume(throwing: APIError.http(403, "Old session was forbidden"))
    } else {
        let response = HTTPURLResponse(url: URL(string: "https://native.invalid/api/pipelines/boards")!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        pending!.resume(returning: (Data(#"{"workspaceId":"old","boards":[{"id":"old-board"}]}"#.utf8), response))
    }
    await oldRead.value
    expect(directory.canView, true, "old request completion cannot revoke current authorization")
    expect(directory.boards.map(\.id), ["new-board"], "old response cannot restore previous session data")
}
APIClient.requestProbe = nil
APIClient.workspaceProbe = nil
directory.reset()

print("Pipeline v8: \(checks) checks, \(failures) failures")
exit(failures == 0 ? 0 : 1)
