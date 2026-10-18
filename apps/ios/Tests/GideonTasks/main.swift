import Foundation
var checks = 0
func expect(_ ok: @autoclosure () -> Bool, _ message: String) { checks += 1; if !ok() { fatalError(message) } }
let json = #"{"sections":[{"id":"todo","name":"To do","taskStatus":"TODO"},{"id":"doing","name":"Doing","taskStatus":"IN_PROGRESS"}],"members":[{"id":"a","name":"A"},{"id":"b","name":"B"}]}"#
let options = try JSONDecoder().decode(GideonTaskOptions.self, from: Data(json.utf8))
var choice = GideonTaskChoice(projectId: "project", taskListId: "old-column", assigneeIds: ["a", "gone"], dueDate: nil)
choice.reconcile(options, status: "IN_PROGRESS")
expect(choice.taskListId == "doing", "Match status in the chosen project's sections")
expect(choice.assigneeIds == ["a"], "Drop PIC outside the newly chosen project")
expect(choice.body["dueDate"] is NSNull, "Clearing a due day must send null")
expect(choice.body["assigneeIds"] as? [String] == ["a"], "Send the selected PIC")
choice.taskListId = "todo"; choice.reconcile(options, status: "IN_PROGRESS")
expect(choice.taskListId == "todo", "Keep a section belonging to the project")
choice.taskListId = nil; choice.reconcile(options, status: "UNKNOWN")
expect(choice.taskListId == "todo", "Fallback to the first project section")
choice.dueDate = "2026-10-23"
expect(choice.body["dueDate"] as? String == "2026-10-23", "Date-only wire day remains unchanged")
let empty = try JSONDecoder().decode(GideonTaskOptions.self, from: Data(#"{"sections":[],"members":[]}"#.utf8))
choice.reconcile(empty, status: "TODO")
expect(choice.taskListId == nil && choice.assigneeIds.isEmpty, "Empty options cannot retain stale members/columns")
let deleted = try JSONDecoder().decode(GideonTaskDelete.self, from: Data(#"{"taskId":"task","title":"Private task","assignees":[],"deleted":true}"#.utf8))
expect(deleted.taskId == "task" && deleted.deleted == true, "Deletion confirmation is bound to the proposal task")
let target = try JSONDecoder().decode(GideonTaskTarget.self, from: Data(#"{"title":"New task","projects":[{"id":"p","name":"P"}]}"#.utf8))
expect(target.projectId == nil && target.projects.count == 1, "Missing target waits for a project choice")
print("\(checks) task proposal contract checks passed")
