import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Notion-style project access levels (owner, 13 Oct 2026; server lib/rbac.ts, web AccessLevelPicker.tsx).
//
//   FULL    = Full access  — settings, rename, members (add / level / remove), invite, statuses and
//                            columns, automations, delete the project. The "Project Owner" (role LEAD).
//   EDIT    = Can edit     — tasks incl. delete, docs, sheets, files.
//   COMMENT = Can comment  — read + comment (task comments, posting in the project chat).
//   VIEW    = Can view     — read only.
//
// BoD / One Above All have Full access to every project of their workspace, Pipelines included (owner,
// 16 Oct 2026); Managers and Staff only see projects they are members of, at their level. The server answers
// GET /api/projects/:id with `viewerAccessLevel` and `viewerCanManage`, and ProjectMember rows with
// `accessLevel` next to the old `role` (kept in step for released apps).
//
// What this decides is what is DRAWN. Every route re-checks the level; hiding a button the server would
// refuse is a courtesy. An older server sends no level: then nothing is hidden (as before).
// ─────────────────────────────────────────────────────────────────────────────

enum ProjectAccessLevel: String, CaseIterable, Identifiable, Sendable {
    case full = "FULL", edit = "EDIT", comment = "COMMENT", view = "VIEW"
    var id: String { rawValue }

    /// VIEW 1 … FULL 4, the server's LEVEL_RANK.
    var rank: Int {
        switch self { case .view: return 1; case .comment: return 2; case .edit: return 3; case .full: return 4 }
    }
    func atLeast(_ other: ProjectAccessLevel) -> Bool { rank >= other.rank }

    var label: String {
        switch self {
        case .full: return T("Full access")
        case .edit: return T("Can edit")
        case .comment: return T("Can comment")
        case .view: return T("Can view")
        }
    }
    /// What the level allows, under its name in the picker (the web's hint line).
    var hint: String {
        switch self {
        case .full: return T("Edit, manage members and settings, delete the project")
        case .edit: return T("Create, edit and delete tasks, docs and comments")
        case .comment: return T("Read and comment")
        case .view: return T("Read only")
        }
    }

    init?(server: String?) {
        guard let s = server?.uppercased(), let v = ProjectAccessLevel(rawValue: s) else { return nil }
        self = v
    }

    /// A membership's level, the server's memberAccessLevel(): role wins where it is specific (LEAD = Full,
    /// GUEST = Can comment, VIEWER = Can view) because older code paths write only role; a plain MEMBER
    /// reads accessLevel, and never Full from it.
    static func ofMember(role: String?, accessLevel: String?) -> ProjectAccessLevel {
        switch (role ?? "").uppercased() {
        case "LEAD": return .full
        case "GUEST": return .comment
        case "VIEWER": return .view
        default:
            if let l = ProjectAccessLevel(server: accessLevel), l != .full { return l }
            return .edit
        }
    }
}

extension ProjectDetail {
    /// The viewer's level here; nil = an older server (nothing is gated then).
    var viewerLevel: ProjectAccessLevel? { ProjectAccessLevel(server: viewerAccessLevel) }

    /// Full access: settings, members, statuses / columns, automations, delete. Falls back to the old
    /// `viewerCanManage` flag, then to "allowed" for a server that sends neither.
    var canManageProject: Bool {
        if let l = viewerLevel { return l == .full }
        return viewerCanManage ?? true
    }
    /// Can edit or more: create / edit / delete tasks, docs, sheets, files.
    var canEditProject: Bool {
        if let l = viewerLevel { return l.atLeast(.edit) }
        return true
    }
    /// Can comment or more: task comments and posting in the project chat.
    var canCommentProject: Bool {
        if let l = viewerLevel { return l.atLeast(.comment) }
        return true
    }
    /// Can view / Can comment get a quiet chip in the header (Notion shows the level in its Share button).
    var readOnlyLevelChip: String? {
        guard let l = viewerLevel, l == .view || l == .comment else { return nil }
        return l.label
    }
}

extension ProjectDetail.ProjectMember {
    var level: ProjectAccessLevel { ProjectAccessLevel.ofMember(role: role, accessLevel: accessLevel) }
    /// The Project Owner (stored role LEAD; shown as "Project Owner" everywhere since 13 Oct 2026).
    var isProjectOwner: Bool { (role ?? "").uppercased() == "LEAD" }
}

enum ProjectAccessText {
    /// The sentence for a failed level change / removal. 409 LAST_OWNER gets its own line, as on the web.
    static func changeFailed(_ error: Error) -> String {
        // 409 LAST_OWNER, on a level change AND on Remove (server from 13 Oct 2026, QA BoD R2 N01): the
        // server's own sentence wins (T() translates the known one); the fixed line covers an empty body.
        if case APIError.http(409, let message) = error {
            if let message, !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return T(message) }
            return T("A project keeps at least one Project Owner. Give someone else Full access first.")
        }
        if case APIError.http(403, _) = error {
            return T("That didn't go through. You need Full access to the project.")
        }
        return (error as? LocalizedError)?.errorDescription ?? T("Couldn't change their access")
    }
}

/// Notion's access dropdown: the four levels with their hints, and Remove when `onRemove` is given. Used
/// next to Add / Invite (the level for everyone in that batch) and on each member row.
struct AccessLevelMenu: View {
    let value: ProjectAccessLevel
    var disabled: Bool = false
    var accessibilityName: String? = nil
    let onChange: (ProjectAccessLevel) -> Void
    var onRemove: (() -> Void)? = nil

    var body: some View {
        Menu {
            ForEach(ProjectAccessLevel.allCases) { level in
                Button { if level != value { onChange(level) } } label: {
                    if level == value {
                        Label { Text(level.label); Text(level.hint) } icon: { Image(systemName: "checkmark") }
                    } else {
                        Text(level.label); Text(level.hint)
                    }
                }
            }
            if let onRemove {
                Divider()
                Button(role: .destructive) { onRemove() } label: { Label(T("Remove"), systemImage: "person.badge.minus") }
            }
        } label: {
            HStack(spacing: 3) {
                Text(value.label).lineLimit(1)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold))
            }
            .font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
            .padding(.horizontal, 8).frame(minHeight: 32)
            .contentShape(Rectangle())
        }
        .disabled(disabled)
        .accessibilityLabel(accessibilityName.map { String(format: T("Access for %@"), $0) } ?? T("Access"))
        .accessibilityValue(value.label)
    }
}

/// The read-only chip for Can view / Can comment, next to the project's title.
struct ProjectLevelChip: View {
    let text: String
    var body: some View {
        Text(text)
            .font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(NX.muted, in: Capsule())
            .accessibilityHint(T("Ask the Project Owner if you need more access."))
    }
}

/// Why a project didn't open, as the web's project page tells it apart (QA 13 Oct 2026): deleted / wrong
/// link (404), not a member (403), or no answer (offline: try again). Anything else is the server's words.
enum ProjectOpenFailure {
    /// Sentinel messages, so a screen that keeps `error: String?` can hand them to ProjectUnavailableView.
    static var notFoundText: String { T("It was deleted, or the link is wrong. A deleted project can be restored from Control Room → Audit.") }
    static var forbiddenText: String { T("You need to be signed in and be a member of this project. Ask its Project Owner to add you.") }

    /// The message to keep for a failed GET /api/projects/:id.
    static func message(for error: Error) -> String {
        if case APIError.http(404, _) = error { return notFoundText }
        if case APIError.http(403, _) = error { return forbiddenText }
        return (error as? LocalizedError)?.errorDescription ?? T("Couldn't load the project.")
    }
}

/// The project page when the project can't be shown: not found (with a way back to Projects), no access
/// (who to ask), or the shared ErrorState with Try again for everything else.
struct ProjectUnavailableView: View {
    let message: String
    let retry: () -> Void
    /// "Go to Projects" on the not-found state; nil hides it.
    var goToProjects: (() -> Void)? = nil

    var body: some View {
        if message == ProjectOpenFailure.notFoundText {
            EmptyState(icon: "magnifyingglass", title: T("Project not found"), subtitle: message,
                       actionTitle: goToProjects == nil ? nil : T("Go to Projects"), actionIcon: "folder",
                       action: goToProjects)
        } else if message == ProjectOpenFailure.forbiddenText {
            EmptyState(icon: "lock", title: T("You can't open this project"), subtitle: message,
                       actionTitle: T("Try again"), actionIcon: "arrow.clockwise", action: retry)
        } else {
            ErrorState(message: message, icon: "exclamationmark.triangle", retry: retry)
        }
    }
}
