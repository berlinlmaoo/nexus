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
    /// deleted or restored, or a folder changed; or something in Z Vault was added, renamed, moved,
    /// trashed, restored or locked ("vault", server since 9 Oct 2026). userInfo: `RealtimeKey.kind`
    /// ("projects" | "folders" | "audit" | "vault"), optionally `RealtimeKey.projectId` /
    /// `RealtimeKey.folderId`.
    static let nexusWorkspaceChanged = Notification.Name("nexus.workspace.changed")

    /// A task of a project was created, changed, moved or deleted, or a comment was added to one — on
    /// any device. userInfo, each optional: `RealtimeKey.projectId` (absent when
    /// it cannot be told: every open project screen counts it), `RealtimeKey.taskId`, and
    /// `RealtimeKey.parentId` when the task is a subtask.
    static let nexusProjectTasksChanged = Notification.Name("nexus.project.tasks.changed")

    /// A new Inbox notification was written for this person.
    static let nexusInboxChanged = Notification.Name("nexus.inbox.changed")

    /// A group chat was deleted (server since 9 Oct 2026: `conversation-updated` with reason
    /// "deleted"). userInfo: `RealtimeKey.conversationId`. An open thread of it closes with a note;
    /// the chat list follows `.nexusChatPush`, which is posted for it as well.
    static let nexusChatDeleted = Notification.Name("nexus.chat.deleted")

    /// A deal of a Pipeline Dashboard project was created, edited, deleted or restored (server since
    /// 9 Oct 2026: `pipeline-changed` to the project's room, owner). userInfo, each optional:
    /// `RealtimeKey.projectId`, `RealtimeKey.dealId`. An open pipeline refetches, and an open deal with it.
    static let nexusPipelineChanged = Notification.Name("nexus.pipeline.changed")

    /// An event of an Outlet Sales Dashboard was created, edited, deleted or restored, or a month's
    /// target changed (server since 10 Oct 2026: `outlet-sales-changed` to the project's room). userInfo,
    /// optional: `RealtimeKey.projectId`. A ping: the open outlet refetches the month it shows.
    static let nexusOutletSalesChanged = Notification.Name("nexus.outletSales.changed")

    /// A project's automations changed: a rule created, edited, toggled, deleted or run, by anyone or by
    /// the clock (DEV server since 12 Oct 2026: `automations-changed` { projectId, automationId, actorId }
    /// to the project's room). userInfo, optional: `RealtimeKey.projectId`, `RealtimeKey.automationId`.
    static let nexusAutomationsChanged = Notification.Name("nexus.automations.changed")

    /// A page (Doc) of a project changed (server `doc-changed` { projectId, docId, actorId } to the
    /// project's room). userInfo, optional: `RealtimeKey.projectId`. An open page re-reads.
    static let nexusDocChanged = Notification.Name("nexus.doc.changed")
    /// `sheet-cells` in an open spreadsheet's room: other people's saves, with the rows (RealtimeKey.json).
    static let nexusSheetCells = Notification.Name("nexus.sheet.cells")
    /// `sheet-structure`: rows / columns / settings changed; the open sheet reads itself again.
    static let nexusSheetStructure = Notification.Name("nexus.sheet.structure")
    /// `join-denied` with reason "revoked": the socket was taken out of a room (RealtimeKey.room) because
    /// access to that project ended.
    static let nexusRoomRevoked = Notification.Name("nexus.room.revoked")
    /// `form-responses-changed` { projectId, formId }: a form got (or lost) a response.
    static let nexusFormResponsesChanged = Notification.Name("nexus.form.responses.changed")
}

/// The userInfo keys of the notifications above.
enum RealtimeKey {
    static let kind = "kind"
    static let projectId = "projectId"
    static let folderId = "folderId"
    static let auditId = "auditId"
    static let taskId = "taskId"
    static let parentId = "parentId"
    /// On `.nexusChatPush`: the conversation that moved. Absent = "some chat may have moved".
    static let conversationId = "conversationId"
    /// On `.nexusPipelineChanged`: the deal that changed.
    static let dealId = "dealId"
    /// On `.nexusAutomationsChanged`: the rule that changed or ran.
    static let automationId = "automationId"
    /// On the sheet notifications: the event's payload as JSON text.
    static let json = "json"
    /// On `.nexusRoomRevoked`: "project:<id>" or "sheet:<id>".
    static let room = "room"
    /// On `.nexusFormResponsesChanged`: the form.
    static let formId = "formId"
}

/// The values of `RealtimeKey.kind`.
enum RealtimeKind {
    static let projects = "projects"
    static let folders = "folders"
    static let audit = "audit"
    /// Z Vault: anything a colleague would see change in a folder listing. Ids only, like the rest.
    static let vault = "vault"
    /// My Submissions: a submission of mine moved, was answered or got a proof (to my own room).
    static let submissions = "submissions"
}
