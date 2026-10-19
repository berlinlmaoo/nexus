import Foundation
var checks = 0
func check(_ ok: Bool, _ message: String) { checks += 1; if !ok { fatalError(message) } }
let decoder = JSONDecoder()
let summary = #"""
{"unlimited":false,"role":"STAFF","dayKey":"2026-10-18","periodKey":"2026-09",
 "period":{"startKey":"2026-09-28","endKey":"2026-10-27","resetsAt":"2026-10-27T17:00:00.000Z"},
 "dayResetsAt":"2026-10-18T17:00:00.000Z","today":{"used":64,"limit":100,"remaining":36,"answers":7},
 "pool":{"used":125,"limit":1000,"bonus":0,"remaining":875},"period_used":725,"over":0,
 "fallbackToday":2,"fallbackPerDay":30,"enforced":false,"next":"ok"}
"""#
let s = try decoder.decode(GideonCreditSummary.self, from: Data(summary.utf8))
check(s.today.used == 64 && s.today.limit == 100, "meter wire fields")
check(s.pool.remaining == 875 && s.period.endKey == "2026-10-27", "monthly pool and period")
check(s.period_used == 725 && !s.enforced, "record-only summary")
let unlimited = summary.replacingOccurrences(of: "\"unlimited\":false", with: "\"unlimited\":true")
check(try decoder.decode(GideonCreditSummary.self, from: Data(unlimited.utf8)).unlimited, "unlimited account")
let fallback = summary.replacingOccurrences(of: "\"next\":\"ok\"", with: "\"next\":\"fallback\"").replacingOccurrences(of: "\"enforced\":false", with: "\"enforced\":true")
let f = try decoder.decode(GideonCreditSummary.self, from: Data(fallback.utf8))
check(f.enforced && f.next == "fallback" && f.fallbackPerDay - f.fallbackToday == 28, "server-controlled fallback allowance")
let n = try decoder.decode(GideonCreditNotice.self, from: Data(#"{"kind":"fallback","en":"Aphrodite answered","id":"Aphrodite menjawab"}"#.utf8))
check(n.text == "Aphrodite answered", "English fallback notice")
AppLanguage.shared.lang = .id
check(n.text == "Aphrodite menjawab", "Indonesian fallback notice")
let history = """
{"summary":\(summary),"items":[{"id":"u1","tier":"luna","credits":10,"createdAt":"2026-10-18T10:00:00Z","title":null,"billable":true,"fallback":false}],"nextBefore":"2026-10-18T10:00:00Z","days":[]}
"""
let page = try decoder.decode(GideonCreditHistory.self, from: Data(history.utf8))
check(page.items.count == 1 && page.items[0].title == nil, "history nullable question title")
check(page.nextBefore != nil && page.items[0].credits == 10, "history pagination and per-answer cost")
print("\(checks) credit contract checks passed")
