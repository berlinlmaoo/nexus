import Foundation

// What the live screens listen for (owner, 8 Oct 2026). RealtimeClient posts these when the server's
// Socket.IO connection says something changed (Sources/Realtime), the app posts some itself (a
// restore it just made), and the screens' own fallback timers (LiveRefresh) cover the time the
// connection is down. Declared once, here, so the client and the screens cannot drift apart.
//
// A notification without userInfo means "something of this kind may have changed": RealtimeClient
// posts every one of them that way after each (re)connect, to catch up on what was missed.
//
// Post from any thread: LiveRefresh hops to the main queue before it acts.

extension Notification.Name {
    /// Control Room → Audit: the log gained an entry, or an entry changed (a delete was restored).
    /// userInfo, optional: `RealtimeKey.auditId` — the entry that changed.
    static let nexusAuditChanged = Notification.Name("nexus.audit.changed")

    /// The workspace's structure changed: a project was created, renamed, moved to another folder,
    /// deleted or restored, or a folder changed. userInfo: `RealtimeKey.kind` ("projects" | "folders"
    /// | "audit"), optionally `RealtimeKey.projectId` / `RealtimeKey.folderId`.
    static let nexusWorkspaceChanged = Notification.Name("nexus.workspace.changed")

    /// A task of a project was created, changed, moved or deleted, a comment was added to one, or a
    /// sprint changed — on any device. userInfo, each optional: `RealtimeKey.projectId` (absent when
    /// it cannot be told: every open project screen counts it), `RealtimeKey.taskId`, and
    /// `RealtimeKey.parentId` when the task is a subtask.
    static let nexusProjectTasksChanged = Notification.Name("nexus.project.tasks.changed")

    /// A new Inbox notification was written for this person.
    static let nexusInboxChanged = Notification.Name("nexus.inbox.changed")
}

/// The userInfo keys of the notifications above.
enum RealtimeKey {
    static let kind = "kind"
    static let projectId = "projectId"
    static let folderId = "folderId"
    static let auditId = "auditId"
    static let taskId = "taskId"
    static let parentId = "parentId"
}

/// The values of `RealtimeKey.kind`.
enum RealtimeKind {
    static let projects = "projects"
    static let folders = "folders"
    static let audit = "audit"
}
