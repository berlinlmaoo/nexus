import Foundation

struct GideonActionExtra: Decodable, Sendable, Equatable {
    let preview: String?
    let link: String?
    let note: String?
    let sheetEdit: SheetEdit?
    struct SheetEdit: Decodable, Sendable, Equatable {
        let cells: [Cell]?
        let newRows: GideonLoose?
    }
    struct Cell: Decodable, Sendable, Equatable {
        let ref: String
        let from: GideonLoose?
        let to: GideonLoose?
    }
}

/// Only these actions echo proposalId. Booking and task confirmations keep their own contracts.
struct GideonToolAction: Equatable, Sendable {
    let id: String
    let icon: String
    let title: String
    let apply: String
    let done: String
    var destructive: Bool { id == "cancel_reminder" }
    static let all: [Self] = [
        .init(id: "send_message", icon: "message", title: "Send a message", apply: "Send", done: "Message sent"),
        .init(id: "create_reminder", icon: "alarm", title: "Set a reminder", apply: "Set reminder", done: "Reminder set"),
        .init(id: "cancel_reminder", icon: "alarm", title: "Cancel a reminder", apply: "Cancel reminder", done: "Reminder cancelled"),
        .init(id: "submit_leave_request", icon: "calendar.badge.checkmark", title: "Submit a request", apply: "Submit", done: "Request submitted"),
        .init(id: "decide_attendance_request", icon: "checkmark.circle", title: "Decide a request", apply: "Confirm", done: "Request decided"),
        .init(id: "bulk_update_tasks", icon: "checklist", title: "Change several tasks", apply: "Apply all", done: "Tasks updated"),
        .init(id: "add_subtasks", icon: "checklist", title: "Add subtasks", apply: "Add", done: "Subtasks added"),
        .init(id: "move_deal_stage", icon: "rectangle.3.group", title: "Move a deal", apply: "Move", done: "Deal moved"),
        .init(id: "add_payment_term", icon: "receipt", title: "Add a payment term", apply: "Add", done: "Payment term added"),
        .init(id: "log_outlet_sales", icon: "chart.line.uptrend.xyaxis", title: "Enter outlet sales", apply: "Save", done: "Outlet sales saved"),
        .init(id: "log_social_media_day", icon: "chart.line.uptrend.xyaxis", title: "Enter social media numbers", apply: "Save", done: "Social media numbers saved"),
        .init(id: "create_legal_draft", icon: "scalemass", title: "Create a legal draft", apply: "Create draft", done: "Legal draft created"),
        .init(id: "create_vault_share_link", icon: "link", title: "Create a share link", apply: "Create link", done: "Share link created"),
        .init(id: "draft_announcement", icon: "megaphone", title: "Post an announcement", apply: "Post", done: "Announcement posted"),
        .init(id: "edit_doc", icon: "pencil", title: "Edit a doc", apply: "Apply edit", done: "Doc updated"),
        .init(id: "edit_sheet_cells", icon: "tablecells", title: "Edit spreadsheet", apply: "Apply", done: "Spreadsheet updated"),
        .init(id: "create_sheet", icon: "tablecells", title: "Create a spreadsheet", apply: "Create", done: "Spreadsheet created"),
        .init(id: "save_file_to_vault", icon: "folder.badge.plus", title: "Save to Z Vault", apply: "Save", done: "Saved to Z Vault")
    ]
    static func get(_ id: String?) -> Self? { all.first { $0.id == id } }
}

struct NexusReminder: Decodable, Sendable, Identifiable {
    let id: String
    let text: String
    let remindAt: String
    let firedAt: String?
    let createdAt: String
}
struct NexusReminders: Decodable { let upcoming: [NexusReminder]; let done: [NexusReminder] }
