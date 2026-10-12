import SwiftUI
import UIKit

// ─────────────────────────────────────────────────────────────────────────────
// Status options, Notion's logic (owner, 12 Oct 2026) — port of the web's lib/status-options.ts and the
// option palette in lib/project-views.ts + styles.css (--st-<colour>-*).
//
// A project's sections ARE its status options and its board columns. Each stands for a task status
// (TaskList.taskStatus) and so belongs to one of three groups — To-do, In progress, Complete. Moving a task
// into a column gives it that status; giving a task a status moves it to that status's column; ticking a
// task done moves it to Done ("Done wins"). The server does all of that (src/lib/status-sections.ts) —
// the app only shows the options in the right order and colours, and picks a column, never an enum.
// A section without a status (a project not migrated yet) keeps the old behaviour.
// ─────────────────────────────────────────────────────────────────────────────

enum StatusGroup: String, CaseIterable, Identifiable, Sendable {
    case todo
    case inProgress = "in_progress"
    case complete

    var id: String { rawValue }

    var label: String {
        switch self {
        case .todo: return T("To-do")
        case .inProgress: return T("In progress")
        case .complete: return T("Complete")
        }
    }

    var statuses: [String] {
        switch self {
        case .todo: return ["TODO"]
        case .inProgress: return ["IN_PROGRESS", "IN_REVIEW"]
        case .complete: return ["DONE", "CANCELLED"]
        }
    }

    /// The group of a task status; anything unknown (or none) is To-do, as on the web.
    static func of(_ status: String?) -> StatusGroup {
        let s = (status ?? "").uppercased()
        return allCases.first { $0.statuses.contains(s) } ?? .todo
    }

    var index: Int { Self.allCases.firstIndex(of: self) ?? 0 }

    /// The status a NEW option in this group stands for: "Review" / "Revisi" in progress → IN_REVIEW,
    /// "Cancelled" / "Batal" complete → CANCELLED (web statusForNewOption).
    func statusForNewOption(named name: String) -> String {
        let n = name.lowercased()
        switch self {
        case .todo: return "TODO"
        case .inProgress:
            let review = ["review", "revisi", "approval", "check", "qc", "cek"].contains { word in
                word.count <= 3 ? n.split(whereSeparator: { !$0.isLetter }).contains { $0 == word } : n.contains(word)
            }
            return review ? "IN_REVIEW" : "IN_PROGRESS"
        case .complete:
            return ["cancel", "batal", "gagal"].contains { n.contains($0) } ? "CANCELLED" : "DONE"
        }
    }
}

/// One colour of the option palette: the column's wash, the pill's background and text, the dot.
struct StatusSwatch {
    let lane: Color
    let bg: Color
    let fg: Color
    let dot: Color
    let border: Color
}

enum StatusColor {
    /// Notion's nine option colours, in the web's order.
    static let keys = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"]

    /// Older keys (the first views build, and what the server stores) → the palette's.
    private static let alias: [String: String] = [
        "sky": "blue", "emerald": "green", "amber": "yellow", "rose": "red", "violet": "purple", "slate": "gray",
    ]

    /// A status's colour when its option has none of its own.
    static let forStatus: [String: String] = [
        "TODO": "gray", "IN_PROGRESS": "blue", "IN_REVIEW": "yellow", "DONE": "green", "CANCELLED": "red",
    ]

    static func normalize(_ c: String?) -> String? {
        guard let c = c?.lowercased(), !c.isEmpty else { return nil }
        if keys.contains(c) { return c }
        return alias[c]
    }

    /// The key the server keeps (its list predates the nine-colour palette: "sky", "emerald", …). Brown
    /// has no older name and is sent as it is.
    static func serverKey(_ key: String) -> String {
        switch key {
        case "blue": return "sky"
        case "green": return "emerald"
        case "yellow": return "amber"
        case "red": return "rose"
        case "purple": return "violet"
        default: return key
        }
    }

    static func label(_ key: String) -> String {
        switch key {
        case "gray": return T("Gray")
        case "brown": return T("Brown")
        case "orange": return T("Orange")
        case "yellow": return T("Yellow")
        case "green": return T("Green")
        case "blue": return T("Blue")
        case "purple": return T("Purple")
        case "pink": return T("Pink")
        default: return T("Red")
        }
    }

    /// Light values from styles.css :root; dark from .dark (rgb with alpha over the dark surface).
    static func swatch(_ key: String) -> StatusSwatch {
        switch normalize(key) ?? "gray" {
        case "brown":  return make(lane: 0xfbf8f6, bg: 0xeee0da, fg: 0x44291d, dot: 0x9f6b53, dark: 0xa27763, darkFg: 0xdfab95, darkDot: 0xa27763)
        case "orange": return make(lane: 0xfdf6f0, bg: 0xfadec9, fg: 0x49290e, dot: 0xd9730d, dark: 0xd9730d, darkFg: 0xffa344, darkDot: 0xd9730d)
        case "yellow": return make(lane: 0xfcf8ec, bg: 0xfbecc8, fg: 0x402c1b, dot: 0xcb912f, dark: 0xcb912f, darkFg: 0xffdc49, darkDot: 0xcb912f)
        case "green":  return make(lane: 0xf5f9f4, bg: 0xdbeddb, fg: 0x1c3829, dot: 0x448361, dark: 0x4dab9a, darkFg: 0x7dd3b8, darkDot: 0x4dab9a)
        case "blue":   return make(lane: 0xf3f8fb, bg: 0xd3e5ef, fg: 0x183347, dot: 0x337ea9, dark: 0x529cca, darkFg: 0x8cc4ec, darkDot: 0x529cca)
        case "purple": return make(lane: 0xf9f6fb, bg: 0xe8deee, fg: 0x412454, dot: 0x9065b0, dark: 0x9a6dd7, darkFg: 0xc7a6f0, darkDot: 0x9a6dd7)
        case "pink":   return make(lane: 0xfcf5f8, bg: 0xf5e0e9, fg: 0x4c2337, dot: 0xc14c8a, dark: 0xe255a1, darkFg: 0xf19bc9, darkDot: 0xe255a1)
        case "red":    return make(lane: 0xfdf5f4, bg: 0xffe2dd, fg: 0x5d1715, dot: 0xd44c47, dark: 0xff7369, darkFg: 0xff9d96, darkDot: 0xff7369)
        default:       return make(lane: 0xf9f9f8, bg: 0xe3e2e0, fg: 0x32302c, dot: 0x91918e, dark: 0x9b9a97, darkFg: 0xc9c8c5, darkDot: 0x9b9a97)
        }
    }

    private static func make(lane: UInt, bg: UInt, fg: UInt, dot: UInt, dark: UInt, darkFg: UInt, darkDot: UInt) -> StatusSwatch {
        StatusSwatch(
            lane: dynamic(light: lane, lightAlpha: 1, dark: dark, darkAlpha: 0.07),
            bg: dynamic(light: bg, lightAlpha: 1, dark: dark, darkAlpha: 0.22),
            fg: Color(light: fg, dark: darkFg),
            dot: Color(light: dot, dark: darkDot),
            border: dynamic(light: dot, lightAlpha: 0.33, dark: dark, darkAlpha: 0.4)
        )
    }

    private static func dynamic(light: UInt, lightAlpha: CGFloat, dark: UInt, darkAlpha: CGFloat) -> Color {
        Color(uiColor: UIColor { trait in
            trait.userInterfaceStyle == .dark
                ? UIColor(rgb: dark).withAlphaComponent(darkAlpha)
                : UIColor(rgb: light).withAlphaComponent(lightAlpha)
        })
    }
}

extension ProjectDetail.Lane {
    /// The colour this option draws in: its own, else its status's.
    var colorKey: String { StatusColor.normalize(color) ?? StatusColor.forStatus[(taskStatus ?? "TODO").uppercased()] ?? "gray" }
    var swatch: StatusSwatch { StatusColor.swatch(colorKey) }
    var group: StatusGroup { StatusGroup.of(taskStatus) }

    /// The same section with another set of cards (search, filters, subtask merge) — every other field kept.
    func with(tasks: [BoardTask]) -> ProjectDetail.Lane {
        ProjectDetail.Lane(id: id, name: name, tasks: tasks, taskStatus: taskStatus, color: color, position: position)
    }
}

enum StatusOptions {
    /// Does the project work with status options (any section bound to a status)?
    static func inUse(_ lanes: [ProjectDetail.Lane]) -> Bool { lanes.contains { $0.taskStatus != nil } }

    /// Options in display order: by group (To-do, In progress, Complete), then the project's own order.
    /// A project without status options keeps its sections exactly as they are.
    static func ordered(_ lanes: [ProjectDetail.Lane]) -> [ProjectDetail.Lane] {
        guard inUse(lanes) else { return lanes }
        return lanes.enumerated().sorted { a, b in
            let ga = a.element.group.index, gb = b.element.group.index
            if ga != gb { return ga < gb }
            let pa = a.element.position ?? a.offset, pb = b.element.position ?? b.offset
            return pa != pb ? pa < pb : a.offset < b.offset
        }.map(\.element)
    }

    /// The option a new task starts in: the first To-do option, else the first option.
    static func defaultOption(_ lanes: [ProjectDetail.Lane]) -> ProjectDetail.Lane? {
        let o = ordered(lanes)
        return o.first { $0.group == .todo } ?? o.first
    }

    /// The first Complete/DONE option — where "mark done" lands.
    static func doneOption(_ lanes: [ProjectDetail.Lane]) -> ProjectDetail.Lane? {
        ordered(lanes).first { ($0.taskStatus ?? "").uppercased() == "DONE" }
    }
}

/// A status as a Notion pill: tinted background, coloured dot, the option's name.
struct StatusPill: View {
    let name: String
    let colorKey: String
    var size: CGFloat = 12

    var body: some View {
        let s = StatusColor.swatch(colorKey)
        HStack(spacing: 5) {
            Circle().fill(s.dot).frame(width: 7, height: 7)
            Text(name).font(NXFont.text(size, .semibold)).lineLimit(1)
        }
        .foregroundStyle(s.fg)
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(s.bg, in: Capsule())
    }
}

/// A task priority in the app's language (the copy sweep: never the raw enum, e.g. "Urgent" in Bahasa).
enum TaskPriorityName {
    static let all = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"]
    static func label(_ p: String?) -> String {
        switch (p ?? "").uppercased() {
        case "URGENT": return T("Urgent")
        case "HIGH": return T("High")
        case "MEDIUM": return T("Medium")
        case "LOW": return T("Low")
        default: return T("No priority")
        }
    }
}
