import Foundation

// What the live screens listen for (owner, 8 Oct 2026). iOS has no socket yet, so for now these are
// posted only by the app itself, and the screens fall back to refreshing on a timer (LiveRefresh).
// The Socket.IO client that follows posts the same names when the server says something changed —
// declared once, here, so the client and the screens cannot drift apart.
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
}

/// The userInfo keys of the notifications above.
enum RealtimeKey {
    static let kind = "kind"
    static let projectId = "projectId"
    static let folderId = "folderId"
    static let auditId = "auditId"
}

/// The values of `RealtimeKey.kind`.
enum RealtimeKind {
    static let projects = "projects"
    static let folders = "folders"
    static let audit = "audit"
}
