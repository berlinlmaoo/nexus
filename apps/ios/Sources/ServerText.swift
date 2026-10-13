import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Server-written text in the app's language — port of the web's lib/server-text.ts (audit, 12 Oct 2026).
// The server stores English sentences with raw enums ("Changed status from TODO to IN_PROGRESS"); known
// shapes are rewritten here, anything else is shown as stored with the enum words replaced.
// ─────────────────────────────────────────────────────────────────────────────

enum ServerText {
    private static let enumLabel: [String: String] = [
        "TODO": "To do", "IN_PROGRESS": "In progress", "IN_REVIEW": "In review", "DONE": "Done", "CANCELLED": "Cancelled",
        "URGENT": "Urgent", "HIGH": "High", "MEDIUM": "Medium", "LOW": "Low", "NONE": "No priority",
    ]

    /// A status/priority enum value as words in the app's language; anything else unchanged.
    static func enumWord(_ v: String) -> String { enumLabel[v].map(T) ?? v }

    private static func groups(_ pattern: String, _ s: String) -> [String]? {
        guard let re = try? NSRegularExpression(pattern: pattern),
              let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
        return (0..<m.numberOfRanges).map { i in Range(m.range(at: i), in: s).map { String(s[$0]) } ?? "" }
    }

    /// One task activity line. `fallback` is what to show when there are no details (the action).
    static func activity(_ details: String?, fallback: String) -> String {
        let d = (details ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if d.isEmpty { return fallback }
        if let m = groups(#"^Changed status from (\w+) to (\w+)$"#, d) {
            return String(format: T("Changed the status from %@ to %@"), enumWord(m[1]), enumWord(m[2]))
        }
        if let m = groups(#"^Created "(.+)" from form "(.+)"$"#, d) {
            return String(format: T("Created this task from the form “%@”"), m[2])
        }
        if d.hasPrefix("Created task \"") { return T("Created this task") }
        if d.hasPrefix("Added a comment on \"") { return T("Added a comment") }
        if d.hasPrefix("Added assignee to \"") { return T("Added an assignee") }
        if d.hasPrefix("Removed assignee from \"") { return T("Removed an assignee") }
        guard let re = try? NSRegularExpression(pattern: #"\b(TODO|IN_PROGRESS|IN_REVIEW|DONE|CANCELLED|URGENT|HIGH|MEDIUM|LOW)\b"#) else { return d }
        var out = d
        for m in re.matches(in: d, range: NSRange(d.startIndex..., in: d)).reversed() {
            guard let r = Range(m.range, in: out) else { continue }
            out.replaceSubrange(r, with: enumWord(String(out[r])))
        }
        return out
    }
}
