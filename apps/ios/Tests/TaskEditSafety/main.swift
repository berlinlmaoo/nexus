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
print("\(checks) task edit safety checks passed")
