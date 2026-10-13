// swiftc -O Sources/Shared/CalendarCore.swift Sources/Shared/AttendanceSnapshot.swift Sources/Shared/CalendarGlance.swift \
//   Tests/CalendarGlanceGolden/main.swift -o /tmp/glgolden && /tmp/glgolden Tests/CalendarGlanceGolden
//
// Runs CalendarGlance (the widget rules) on the web's glance fixtures at four moments and compares every
// value with the web's golden files (apps/web/src/lib/calendar/glance.test.mjs builds both:
// input/ = fixtures/glance, golden/ = fixtures/golden-glance). Exit 1 on any difference.
// Linux: swift:5.10-jammy in Docker.
import Foundation

let dir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
func load(_ path: String) -> Data { FileManager.default.contents(atPath: "\(dir)/\(path)")! }

let saved = Date(timeIntervalSince1970: 1_791_172_800) // 2026-10-05T04:00:00Z
let nows: [(String, Date)] = [
    ("mon-1200", Date(timeIntervalSince1970: 1_791_176_400)), // 2026-10-05T05:00Z = 12:00 WIB
    ("mon-2359", Date(timeIntervalSince1970: 1_791_219_540)), // 16:59Z = 23:59 WIB
    ("tue-0000", Date(timeIntervalSince1970: 1_791_219_600)), // 17:00Z = 00:00 WIB 6 Oct
    ("nov-0000", Date(timeIntervalSince1970: 1_793_466_000)), // 2026-10-31T17:00Z = 00:00 WIB 1 Nov
]
let horizon: TimeInterval = 36 * 3600

func opt(_ v: Any?) -> Any { v ?? NSNull() }

func barJSON(_ b: GlanceBar) -> [String: Any] {
    ["key": b.key, "id": opt(b.id), "title": opt(b.title), "day": opt(b.day), "time": opt(b.time), "color": b.color,
     "project": opt(b.project), "priority": opt(b.priority), "dim": b.dim, "done": b.done, "masked": b.masked, "overdue": b.overdue.rawValue]
}
func dayJSON(_ d: GlanceDay, month: Bool) -> [String: Any] {
    var o: [String: Any] = ["day": d.day, "count": d.count, "open": d.open, "bars": d.bars.map(barJSON), "more": d.more,
                            "overdue": d.overdue, "today": d.today, "holiday": opt(d.holiday), "sunday": d.sunday, "covered": d.covered]
    if month { o["inMonth"] = d.inMonth }
    return o
}
func yearJSON(_ y: GlanceYear) -> [String: Any] { ["day": y.day, "days": y.days, "percent": y.percent] }

let isoSeconds: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
}()
/// "2026-10-05T12:01:00.000Z", as JavaScript's toISOString writes it.
func iso(_ d: Date) -> String {
    let ms = CalendarGlance.ms(d)
    let whole = isoSeconds.string(from: Date(timeIntervalSince1970: Double(ms / 1000)))
    return whole.replacingOccurrences(of: "Z", with: String(format: ".%03dZ", Int(ms % 1000)))
}

var failures = 0
var checked = 0
let inputs = try! FileManager.default.contentsOfDirectory(atPath: "\(dir)/input").filter { $0.hasSuffix(".json") }.sorted()
for file in inputs {
    let s = try! JSONDecoder().decode(GlanceSnapshot.self, from: load("input/\(file)"))
    for (name, now) in nows {
        let m = CalendarGlance.monthView(s, now: now, maxBars: 2)
        let inl = CalendarGlance.inline(s, now: now)
        let up = CalendarGlance.upcoming(s, now: now, limit: 4)
        let ring = CalendarGlance.todayRing(s, now: now)
        let mine: [String: Any] = [
            "freshness": CalendarGlance.freshness(s, savedAt: saved, now: now).rawValue,
            "month": ["month": m.month, "today": m.today, "year": yearJSON(m.year), "cells": m.cells.map { dayJSON($0, month: true) }] as [String: Any],
            "week": CalendarGlance.weekView(s, now: now, maxBars: 3).map { dayJSON($0, month: false) },
            "upcoming": ["rows": up.rows.map(barJSON), "more": up.more] as [String: Any],
            "quadrants": CalendarGlance.quadrants(s, now: now).map { ["quadrant": $0.quadrant.rawValue, "count": $0.count, "rows": $0.rows.map(barJSON)] as [String: Any] },
            "ring": ["done": ring.done, "total": ring.total],
            "inline": ["openToday": inl.openToday,
                       "next": inl.nextDay.map { ["day": $0, "time": opt(inl.nextTime)] as [String: Any] } ?? NSNull()] as [String: Any],
            "year": yearJSON(CalendarGlance.yearProgress(CalendarGlance.clock(now).day)),
            "redraw": CalendarGlance.redrawTimes(s, savedAt: saved, now: now, horizon: horizon).map(iso),
        ]
        let gfile = "\(file.replacingOccurrences(of: ".json", with: "")).\(name).json"
        let golden = try! JSONSerialization.jsonObject(with: load("golden/\(gfile)")) as! [String: Any]
        let ours = try! JSONSerialization.jsonObject(with: JSONSerialization.data(withJSONObject: mine)) as! [String: Any]
        checked += 1
        for key in golden.keys.sorted() {
            guard let theirs = golden[key], let mineValue = ours[key] else {
                failures += 1
                print("MISSING \(gfile) \(key)")
                continue
            }
            let wrap = { (v: Any) in String(data: try! JSONSerialization.data(withJSONObject: ["v": v], options: [.sortedKeys]), encoding: .utf8)! }
            let g = wrap(theirs)
            let o = wrap(mineValue)
            if g != o {
                failures += 1
                let at = zip(g, o).enumerated().first { $0.element.0 != $0.element.1 }?.offset ?? min(g.count, o.count)
                print("DIFF \(gfile) \(key) at \(at)\n  golden: …\(g.dropFirst(max(0, at - 160)).prefix(320))\n  swift:  …\(o.dropFirst(max(0, at - 160)).prefix(320))")
            }
        }
    }
}
precondition(CalendarGlance.clock(Date(timeIntervalSince1970: 1_791_219_600)) == ("2026-10-06", "00:00"))
precondition(CalendarGlance.instantMs("2026-10-06", "00:00") == 1_791_219_600_000)
precondition(CalendarGlance.titleOrder("Cek kontrak", "edit video recap") < 0 && CalendarGlance.titleOrder("edit video recap", "Evaluasi KPI") < 0)
print(failures == 0 ? "CalendarGlance golden: \(checked) files match" : "CalendarGlance golden: \(failures) differences")
exit(failures == 0 ? 0 : 1)
