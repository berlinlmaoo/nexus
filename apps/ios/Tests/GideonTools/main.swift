import Foundation
var checks = 0
func check(_ value: Bool, _ label: String) { if !value { fatalError(label) }; checks += 1 }
check(GideonToolAction.all.count == 19, "all tool write actions covered")
check(Set(GideonToolAction.all.map(\.id)).count == 19, "unique actions")
check(GideonToolAction.get("unknown_future_tool") == nil, "unknown tool keeps fallback")
check(GideonToolAction.get("delete_task") == nil, "task confirmation remains distinct")
check(GideonToolAction.all.filter(\.destructive).map(\.id) == ["cancel_reminder"], "destructive reminder cancel")
let raw = #"{"preview":"Full message\nSecond line","link":"/reminders","note":"Saved","sheetEdit":{"cells":[{"ref":"B2","from":123,"to":"Complete"},{"ref":"C3","from":null,"to":false}],"newRows":[["hello",123]]}}"#
let extra = try JSONDecoder().decode(GideonActionExtra.self, from: Data(raw.utf8))
check(extra.preview == "Full message\nSecond line", "full multiline preview")
check(extra.sheetEdit?.cells?.count == 2, "cell table")
check(extra.sheetEdit?.cells?[0].from?.text == "123", "numeric before")
check(extra.sheetEdit?.cells?[1].from?.text == nil && extra.sheetEdit?.cells?[1].to?.text == "false", "null and boolean")
check(try JSONDecoder().decode(GideonActionExtra.self, from: Data("{}".utf8)).preview == nil, "old extra compatible")
let reminders = #"{"upcoming":[{"id":"019a0000-0000-7000-b000-000000000001","text":"Test","remindAt":"2026-10-20T04:00:00Z","firedAt":null,"createdAt":"2026-10-19T03:00:00Z"}],"done":[]}"#
let page = try JSONDecoder().decode(NexusReminders.self, from: Data(reminders.utf8))
check(page.upcoming.count == 1 && page.done.isEmpty, "reminders response")
check(page.upcoming[0].firedAt == nil && page.upcoming[0].id.contains("-"), "UUID reminder")
print("GIDEON tool and reminder contracts passed: \(checks)")
