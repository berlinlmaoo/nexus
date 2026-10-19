import Foundation
var checks=0
@MainActor func check(_ condition: @autoclosure () -> Bool, _ name:String) { precondition(condition(),name);checks+=1 }
@MainActor func run() {
    let q=StartupModalQueue()
    q.update(.update,pending:true)
    check(q.owner == nil,"update waits while announcement is loading")
    q.update(.attendance,pending:true)
    q.update(.announcement,pending:true)
    check(q.owner == .announcement,"announcement precedes attendance and update")
    q.update(.xp,pending:true)
    check(q.owner == .announcement,"active notice is never pre-empted")
    q.finish(.announcement)
    check(q.owner == .xp,"highest pending notice opens after dismissal")
    q.finish(.xp)
    check(q.owner == .attendance,"attendance precedes update")
    q.finish(.attendance)
    check(q.owner == .update,"update opens after higher notices finish")
    q.update(.announcement,pending:true,loading:true)
    check(q.owner == .update,"an already open update is never pre-empted by a later load")
    q.finish(.update)
    check(q.owner == nil,"next notice waits until its own load finishes")
    q.update(.announcement,pending:true)
    check(q.owner == .announcement,"loaded pending announcement resumes")
    q.reset()
    check(q.owner == nil,"account reset clears presentation")
    print("Startup modal queue: \(checks) ordering, loading and non-preemption checks passed")
}
Task { @MainActor in run(); exit(0) }
dispatchMain()
