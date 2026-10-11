import Foundation

// MARK: - Project types and per-project tabs (owner, 9 Oct 2026)
//
// "tiap kali buat project tuh ada dikasih pilihan ada Task Project, Finance Dashboard, Content
// Planner, Pipeline Dashboard" — every project has a type, chosen first in New project. Task Project
// and, since 9 Oct 2026, Pipeline Dashboard exist (the GM's deal board, PipelineView.swift); Finance
// Dashboard and Content Planner wait for Berlin's references, are shown as coming soon, and the server
// refuses them too (POST /api/projects → 400 TYPE_COMING_SOON), so nothing half-built can be created.
// Since 10 Oct 2026 the Finance Dashboard card is the Outlet Sales Dashboard (OutletSalesView.swift).
//
// "ada bbrp project yg ga butuh spreadsheets/automation/list" — a project hides the tabs it does not
// need. The server stores the HIDDEN keys (Project.hiddenTabs), the same keys web uses
// (src/lib/project-tabs.ts on the server), so a tab added later shows everywhere by default. Hiding
// only hides: nothing in the tab is deleted. Finance and P&L are not hideable tabs — each is an
// opt-in flag of its own (financeEnabled, enablePnlDashboard), switched by BoD and above.

enum ProjectKind: String, CaseIterable, Identifiable {
    // Outlet Sales Dashboard took Finance Dashboard's card (owner, 10 Oct 2026, for Ryan), in the web's
    // order: Task Project · Outlet Sales Dashboard · Content Planner · Pipeline Dashboard. FINANCE stays a
    // type the server knows (and refuses to create, 400 TYPE_COMING_SOON); it is just no longer offered.
    case task = "TASK", outlet = "OUTLET_SALES", content = "CONTENT", pipeline = "PIPELINE"

    var id: String { rawValue }

    /// Task Project, Pipeline Dashboard (owner, 9 Oct 2026) and Outlet Sales Dashboard (10 Oct 2026) can
    /// be created; Content Planner is coming soon.
    var available: Bool { self != .content }

    /// The owner's names for them; the same in both languages.
    var title: String {
        switch self {
        case .task: return "Task Project"
        case .outlet: return "Outlet Sales Dashboard"
        case .content: return "Content Planner"
        case .pipeline: return "Pipeline Dashboard"
        }
    }

    var blurb: String {
        switch self {
        case .task: return T("Board, list, calendar and timeline for work with owners and due dates.")
        case .outlet: return T("One outlet: sales and pax against the month's target, a calendar of events, and a report form for every night.")
        case .content: return T("Plan and schedule content across your channels.")
        case .pipeline: return T("Follow every deal from first contact to paid.")
        }
    }

    var symbol: String {
        switch self {
        case .task: return "checklist"
        case .outlet: return "storefront"
        case .content: return "calendar.badge.clock"
        case .pipeline: return "line.3.horizontal.decrease.circle"
        }
    }
}

extension ProjectTab {
    /// The key the server and web use for this tab in Project.hiddenTabs. nil for Finance and P&L,
    /// which are switched by their own flags rather than hidden, and for Pipeline, which a Pipeline
    /// Dashboard always shows and no other project has (owner, 9 Oct 2026), and for Report form, which
    /// only an Outlet Sales Dashboard has (10 Oct 2026).
    var key: String? {
        switch self {
        case .finance, .pnl, .pipeline, .reportForm: return nil
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
