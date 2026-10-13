// swiftc -O Sources/Shared/CalendarCore.swift Tests/CalendarGolden/main.swift -o /tmp/calgolden && /tmp/calgolden Tests/CalendarGolden
//
// Runs CalendarCore on the server's golden output of 18 Sep and 3 Oct 2026 at a fixed "now" and compares
// every value with the web's golden-client files (apps/web/src/lib/calendar/core.test.mjs
// builds them). Exit 1 on the first difference. Linux: swift:5.10-jammy in Docker.
import Foundation

let dir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
func load(_ path: String) -> Data { FileManager.default.contents(atPath: "\(dir)/\(path)")! }
let dec = JSONDecoder()

struct Golden: Decodable { let units: [CalUnit]; let people: [CalPerson] }
let structure = try! dec.decode(Golden.self, from: load("server/structure.json"))
let ix = CalIndex(units: structure.units, people: structure.people)
let now = Date(timeIntervalSince1970: 1_791_176_400) // 2026-10-05T05:00:00Z
let today = "2026-10-05"
let window = 14
func unit(_ name: String) -> CalUnit { structure.units.first { $0.name == name }! }

func brief(_ n: CalTreeNode?) -> Any {
    guard let n else { return NSNull() }
    return [
        "unit": n.unit.name, "count": n.count,
        "items": n.items.map { $0.key }, "loose": n.loose.map { $0.key },
        "people": n.people.map { ["userId": $0.userId, "items": $0.items.map { $0.key }] as [String: Any] },
        "children": n.children.map { brief($0) },
    ] as [String: Any]
}

var failures = 0
var checked = 0
for day in ["2026-09-18", "2026-10-03"] {
    for who in ["bod", "staff"] {
        let items = try! dec.decode([CalItem].self, from: load("server/items-\(day).\(who).json"))
        for (fname, fid) in [("top", ix.top!.id), ("fa", unit("Framework Agency").id), ("pats", unit("PATS").id)] {
            let shown = CalendarCore.underFocus(items, ix, focus: fid)
            let tree = CalendarCore.dayTree(shown, ix, focus: fid, today: today, now: now, windowDays: window)
            let cell = CalendarCore.dayCell(day, shown, ix, focus: fid, today: today, now: now, windowDays: window)
            let week: [Any] = CalendarCore.weekRows(shown, ix, focus: fid, monday: CalDays.mondayOf(day), today: today, now: now, windowDays: window).map { r in
                switch r {
                case let .unit(u, depth, count): return ["kind": "unit", "unit": u.name, "depth": depth, "count": count] as [String: Any]
                case let .unplaced(depth, count): return ["kind": "unplaced", "depth": depth, "count": count] as [String: Any]
                case let .person(unitId, userId, depth, days): return ["kind": "person", "unitId": unitId ?? NSNull(), "userId": userId, "depth": depth, "days": days.map { $0.map { $0.key } }] as [String: Any]
                case let .loose(unitId, depth, days): return ["kind": "loose", "unitId": unitId, "userId": NSNull(), "depth": depth, "days": days.map { $0.map { $0.key } }] as [String: Any]
                }
            }
            var overdue: [String: Any] = [:]
            for i in items { overdue[i.key] = CalendarCore.overdueState(i, today: today, now: now, windowDays: window).rawValue }
            let mine: [String: Any] = [
                "cell": ["day": cell.day, "count": cell.count, "dots": cell.dots.map { ["unitId": $0.unitId, "filled": $0.filled, "count": $0.count] as [String: Any] }, "overdue": cell.overdue] as [String: Any],
                "legend": CalendarCore.legend(shown, ix, focus: fid).map { ["unitId": $0.unitId, "count": $0.count] as [String: Any] },
                "tree": ["total": tree.total, "people": tree.people, "unplaced": tree.unplaced.map { ["userId": $0.userId, "items": $0.items.map { $0.key }] as [String: Any] }, "root": brief(tree.root)] as [String: Any],
                "week": week,
                "overdue": overdue,
            ]
            let file = "\(day).\(who).\(fname).json"
            let golden = try! JSONSerialization.jsonObject(with: load("client/\(file)")) as! [String: Any]
            let ours = try! JSONSerialization.jsonObject(with: JSONSerialization.data(withJSONObject: mine)) as! [String: Any]
            checked += 1
            for key in ["cell", "legend", "tree", "week", "overdue"] {
                // Same values = the same JSON text once both are re-serialised with sorted keys.
                let g = String(data: try! JSONSerialization.data(withJSONObject: golden[key]!, options: [.sortedKeys]), encoding: .utf8)!
                let o = String(data: try! JSONSerialization.data(withJSONObject: ours[key]!, options: [.sortedKeys]), encoding: .utf8)!
                if g != o {
                    failures += 1
                    let at = zip(g, o).enumerated().first { $0.element.0 != $0.element.1 }?.offset ?? min(g.count, o.count)
                    print("DIFF \(file) \(key) at \(at)\n  golden: …\(g.dropFirst(max(0, at - 200)).prefix(400))\n  swift:  …\(o.dropFirst(max(0, at - 200)).prefix(400))")
                }
            }
        }
    }
}
// Days and months
precondition(CalDays.monthGrid("2026-10-18").first == "2026-09-28" && CalDays.monthGrid("2026-10-18").last == "2026-11-08")
precondition(CalDays.shiftMonth("2026-01-31", 1) == "2026-02-28" && CalDays.shiftMonth("2026-12-15", 1) == "2027-01-15")
precondition(CalDays.wibToday(Date(timeIntervalSince1970: 1_791_133_200)) == "2026-10-05") // 2026-10-04T17:00Z = 00:00 WIB
print(failures == 0 ? "CalendarCore golden: \(checked) files match" : "CalendarCore golden: \(failures) differences")
exit(failures == 0 ? 0 : 1)
