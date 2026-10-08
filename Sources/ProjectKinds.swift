import Foundation

// MARK: - Project types and per-project tabs (owner, 9 Oct 2026)
//
// "tiap kali buat project tuh ada dikasih pilihan ada Task Project, Finance Dashboard, Content
// Planner, Pipeline Dashboard" — every project has a type, chosen first in New mission. Only Task
// Project exists today; the other three are shown as coming soon and the server refuses them too
// (POST /api/projects → 400 TYPE_COMING_SOON), so nothing half-built can be created.
//
// "ada bbrp project yg ga butuh spreadsheets/automation/list" — a project hides the tabs it does not
// need. The server stores the HIDDEN keys (Project.hiddenTabs), the same keys web uses
// (src/lib/project-tabs.ts on the server), so a tab added later shows everywhere by default. Hiding
// only hides: nothing in the tab is deleted. Finance and P&L are not hideable tabs — each is an
// opt-in flag of its own (financeEnabled, enablePnlDashboard), switched by BoD and above.

enum ProjectKind: String, CaseIterable, Identifiable {
    case task = "TASK", finance = "FINANCE", content = "CONTENT", pipeline = "PIPELINE"

    var id: String { rawValue }

    /// Only Task Project can be created today.
    var available: Bool { self == .task }

    /// The owner's names for them; the same in both languages.
    var title: String {
        switch self {
        case .task: return "Task Project"
        case .finance: return "Finance Dashboard"
        case .content: return "Content Planner"
        case .pipeline: return "Pipeline Dashboard"
        }
    }

    var blurb: String {
        switch self {
        case .task: return T("Board, list, calendar and timeline for work with owners and due dates.")
        case .finance: return T("Revenue, OPEX and profit, month by month.")
        case .content: return T("Plan and schedule content across your channels.")
        case .pipeline: return T("Follow every deal from first contact to paid.")
        }
    }

    var symbol: String {
        switch self {
        case .task: return "checklist"
        case .finance: return "chart.bar.fill"
        case .content: return "calendar.badge.clock"
        case .pipeline: return "line.3.horizontal.decrease.circle"
        }
    }
}

extension ProjectTab {
    /// The key the server and web use for this tab in Project.hiddenTabs. nil for Finance and P&L,
    /// which are switched by their own flags rather than hidden.
    var key: String? {
        switch self {
        case .finance, .pnl: return nil
        case .sheet: return "sheet"
        default: return rawValue.lowercased()
        }
    }

    /// What the tab bar and Project settings → Tabs call it.
    var label: String { T(rawValue) }

    /// The tabs a project can hide, in tab-bar order.
    static var hideable: [ProjectTab] { allCases.filter { $0.key != nil } }

    /// One of these always stays visible (the server answers 400 TASK_VIEW_REQUIRED otherwise).
    static let taskViews: [ProjectTab] = [.board, .list]
}

/// A project's icon as something to draw: the emoji itself, or the emoji a NAMED icon stands for.
///
/// `Project.icon` holds an uploaded picture ("/api/files/…"), an emoji, or a name — "folder" is the
/// column's default and "briefcase" is what the Finance projects were made with. Settings used to put
/// the name straight into its two-character emoji field, which is how "briefcase" showed as "br". Same
/// table and fallback as web's ProjectIcon.tsx, so both draw the same thing. nil for a picture or for
/// no icon at all.
func projectIconEmoji(_ icon: String?) -> String? {
    guard let icon, !icon.isEmpty, !icon.hasPrefix("/"), !icon.hasPrefix("http") else { return nil }
    // Web treats anything that does not start with ASCII as the emoji itself; so does this.
    if isEmojiIcon(icon) || (icon.unicodeScalars.first?.value ?? 0) > 127 { return icon }
    return namedProjectIcons[icon.lowercased()] ?? "📁"
}

private let namedProjectIcons: [String: String] = [
    "folder": "📁", "rocket": "🚀", "star": "⭐", "zap": "⚡", "target": "🎯",
    "briefcase": "💼", "code": "💻", "globe": "🌍", "heart": "❤️", "shield": "🛡️",
    "layers": "📚", "box": "📦", "cpu": "🔧", "database": "🗄️", "feather": "✏️",
    "flag": "🏁", "megaphone": "📢", "grid": "🔲",
]
