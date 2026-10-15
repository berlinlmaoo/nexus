import SwiftUI

/// A notification's mark (symbol + colour) from its type — the web inbox's `notificationMark`
/// (apps/web/src/routes/_app/inbox.tsx), same order of rules, same hues.
struct NotificationMark {
    let symbol: String
    let color: Color
    /// An asset glyph instead of the SF symbol (Legal's scales).
    var asset: String? = nil

    /// Legal requests: the Legal module's scales, never a sender's face (UI tour run 13, W-B10 / F-32).
    static func isLegal(_ type: String?) -> Bool { (type ?? "").lowercased().hasPrefix("legal") }

    static func of(_ type: String?) -> NotificationMark {
        let t = (type ?? "").lowercased()
        // The web's lavender circle with the purple scales (UI tour run 15, Q-IA13: grey on grey).
        if isLegal(t) { return .init(symbol: "doc.text", color: Color(hex: "#7c3aed"), asset: "LegalScaleGlyph") }
        if t.contains("mention") { return .init(symbol: "at", color: Color(hex: "#0284c7")) }
        if t == "task_assigned" || t == "project_invite" || t == "members_added" {
            return .init(symbol: "person.badge.plus", color: NX.foreground)
        }
        if t == "task_completed" { return .init(symbol: "checkmark.circle", color: Color(hex: "#059669")) }
        if t.hasPrefix("comment") || t.hasPrefix("message") || t.hasPrefix("feed_") || t == "complaint_reply" {
            return .init(symbol: "bubble.left", color: Color(hex: "#7c3aed"))
        }
        if t.contains("due") || t.contains("reminder") || t == "booking_soon" || t == "streak_at_risk" {
            return .init(symbol: "alarm", color: Color(hex: "#b45309"))
        }
        if t.hasPrefix("attendance") || t.hasPrefix("offsite") || t.contains("dayoff") || t.contains("quota") {
            return .init(symbol: "calendar.badge.checkmark", color: Color(hex: "#0f766e"))
        }
        if t.contains("announcement") { return .init(symbol: "megaphone", color: Color(hex: "#c2410c")) }
        if t.hasPrefix("complaint") { return .init(symbol: "lifepreserver", color: Color(hex: "#e11d48")) }
        if t == "submission_status" || t == "doc_mention" { return .init(symbol: "doc.text", color: Color(hex: "#475569")) }
        if t.hasPrefix("quest") { return .init(symbol: "trophy", color: Color(hex: "#a16207")) }
        if t.hasPrefix("member_") || t.hasPrefix("group_") { return .init(symbol: "door.left.hand.open", color: Color(hex: "#475569")) }
        if t == "status_update" { return .init(symbol: "waveform.path.ecg", color: NX.foreground) }
        return .init(symbol: "bell", color: NX.mutedFg)
    }
}
