import Foundation

// Linux test of the spreadsheet's plain model: selection rules, the per-sheet pending writes, the filter
// (every case of the web's lib/sheet-filter.test.mjs) and the grid's pure parity pieces (borders, merges,
// overflow, colours, freeze). Run from the repo root:
//   docker run --rm -v "$PWD":/w -w /w swift:5.10-jammy bash -c "swiftc -O -o /tmp/t \
//     Sources/Sheets/SheetModel.swift Sources/Sheets/SheetFilter.swift Sources/Sheets/SheetGridModel.swift \
//     Sources/Sheets/SheetFormula*.swift Sources/Sheets/SheetNumFmt.swift Sources/Sheets/SheetValidation.swift \
//     Sources/Sheets/SheetCF.swift Sources/Sheets/SheetTypes.swift Sources/Sheets/SheetClipboard.swift \
//     Tests/SheetModel/*.swift && /tmp/t"

var checks = 0, fails = 0
func check(_ ok: Bool, _ what: String) {
    checks += 1
    if !ok { fails += 1; print("FAIL:", what) }
}

// selection
var s = SheetSelection(SheetPos(r: 2, c: 1))
s.extend(to: SheetPos(r: 4, c: 3))
check(s.current.top == 2 && s.current.bottom == 4 && s.current.left == 1 && s.current.right == 3, "extend makes a block")
check(s.active == SheetPos(r: 2, c: 1), "extend keeps the active cell")
s.add(SheetPos(r: 9, c: 0))
check(s.ranges.count == 2 && s.active == SheetPos(r: 9, c: 0), "cmd-click adds a range")
check(s.contains(SheetPos(r: 3, c: 2)) && s.contains(SheetPos(r: 9, c: 0)) && !s.contains(SheetPos(r: 8, c: 0)), "contains over ranges")
s.clamp(rows: 5, cols: 2)
check(s.active == SheetPos(r: 4, c: 0) && s.ranges[0].right == 1, "clamp to a smaller sheet")
s.select(SheetPos(r: 0, c: 0))
check(s.isSingleCell, "select resets")
check(SheetRange(SheetPos(r: 1, c: 1), SheetPos(r: 0, c: 0)).positions.count == 4, "range positions")

// A1
check(SheetA1.letters(0) == "A" && SheetA1.letters(25) == "Z" && SheetA1.letters(26) == "AA" && SheetA1.letters(701) == "ZZ" && SheetA1.letters(702) == "AAA", "letters")
check(SheetA1.range(top: 0, left: 0, bottom: 3, right: 2) == "A1:C4" && SheetA1.range(top: 4, left: 1, bottom: 4, right: 1) == "B5", "range text")

// pending writes
var q = SheetPendingWrites()
q.put(row: "r1", col: "a", value: "x")
q.put(row: "r2", col: "a", value: 5)
q.put(row: "r1", col: "a", value: nil)
q.putStyle(row: "r3", col: "b", style: ["b": 1])
check(q.count == 3, "newest value per cell, styles counted")
if case .some(.none) = q.pendingValue(row: "r1", col: "a") { check(true, "") } else { check(false, "pending clear reads as nil") }
let batch = q.take(maxRows: 2)
check(batch.values.map(\.rowId) == ["r1", "r2"] && batch.styles.isEmpty && q.count == 1, "take keeps order and limit")
q.put(row: "r1", col: "a", value: "newer")
q.restore(values: batch.values, styles: batch.styles)
check((q.values["r1"]?["a"] as? String) == "newer", "restore keeps newer writes on top")
check((q.values["r2"]?["a"] as? Int) == 5, "restore brings the rest back")
check(q.order.first == "r1", "restored rows go first")
q.drop(rows: ["r2"])
check(q.values["r2"] == nil && !q.order.contains("r2"), "drop deleted rows")
let data = try! JSONSerialization.data(withJSONObject: q.json)
let back = SheetPendingWrites(json: try! JSONSerialization.jsonObject(with: data) as! [String: Any])
check(back.count == q.count && back.order == q.order, "disk round trip")
let cleared = SheetPendingWrites(json: ["values": ["z": ["a": NSNull()]]])
check(cleared.order == ["z"] && cleared.pendingValue(row: "z", col: "a") != nil, "order rebuilt from keys")

runFilterTests()
runGridModelTests()
runGridTextTests()
print("checks \(checks), fails \(fails)")
exit(fails == 0 ? 0 : 1)
