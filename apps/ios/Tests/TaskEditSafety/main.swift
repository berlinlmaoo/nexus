import Foundation
var checks = 0
func check(_ condition: Bool, _ name: String) {
    checks += 1
    if !condition { fatalError(name) }
}
let edit = StringSetEdit(base: ["a", "b"], selected: ["b", "c"])
check(edit.added == ["c"] && edit.removed == ["a"], "only touched assignees travel")
let concurrentlyAssigned: Set<String> = ["a", "b", "remote"]
let result = concurrentlyAssigned.union(edit.added).subtracting(edit.removed)
check(result == ["b", "c", "remote"], "other device's assignee survives")
let unchanged = StringSetEdit(base: ["a"], selected: ["a"])
check(unchanged.added.isEmpty && unchanged.removed.isEmpty, "unchanged picker sends no replacement")
var tracker = TaskVersionTracker()
tracker.remember("t", "2026-10-18T12:00:01.000Z")
check(!tracker.accepts("t", "2026-10-18T12:00:00.999Z"), "old socket event ignored")
check(tracker.accepts("t", "2026-10-18T12:00:01.000Z"), "same version may invalidate comments")
check(tracker.accepts("t", "2026-10-18T12:00:02Z"), "new timestamp without milliseconds accepted")
tracker.remember("t", "2026-10-18T12:00:00Z")
check(!tracker.accepts("t", "2026-10-18T12:00:00.999Z"), "late HTTP response never lowers held version")
check(tracker.accepts("unknown", "2026-10-18T12:00:00Z"), "unknown task refetches")
check(tracker.accepts("t", nil) && tracker.accepts("t", "malformed"), "old server timestamps don't suppress refresh")
tracker.reset()
check(tracker.accepts("t", "2026-10-18T12:00:00Z"), "sign-out resets version history")
// A colleague reordered the untouched neighbours and added a card after our drag.
let original = ["a", "b", "c", "d", "e"]
let undoMoves = TaskReorderMove.restoring(movedIds: ["b", "d"], in: original)
var liveOrder = ["b", "d", "a", "e", "c", "remote"]
let untouched = liveOrder.filter { !["b", "d"].contains($0) }
for move in undoMoves {
    liveOrder.removeAll { move.movedIds.contains($0) }
    let at = move.beforeId.flatMap { liveOrder.firstIndex(of: $0) } ?? liveOrder.count
    liveOrder.insert(contentsOf: move.movedIds, at: at)
}
check(liveOrder.filter { !["b", "d"].contains($0) } == untouched, "Undo preserves concurrent neighbour order and inserted cards")
check(liveOrder.firstIndex(of: "b")! + 1 == liveOrder.firstIndex(of: "c")!, "first selected run returns to its original anchor")
check(liveOrder.firstIndex(of: "d")! + 1 == liveOrder.firstIndex(of: "e")!, "separate selected run returns to its own anchor")
let adjacent = TaskReorderMove.restoring(movedIds: ["c", "b"], in: original)
check(adjacent == [TaskReorderMove(movedIds: ["b", "c"], beforeId: "d")], "adjacent movers use original lane order")
let trailing = TaskReorderMove.restoring(movedIds: ["e", "d"], in: original)
check(trailing == [TaskReorderMove(movedIds: ["d", "e"], beforeId: nil)], "trailing movers return to the end in lane order")
check(TaskReorderMove.restoring(movedIds: [], in: original).isEmpty, "an empty drag has no undo writes")
print("\(checks) task edit safety checks passed")
