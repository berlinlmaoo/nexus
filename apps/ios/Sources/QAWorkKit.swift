import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// QA web fixes ported to the app (13 Oct 2026, part 1 — work, people, projects). Small shared pieces:
//   • UntitledText — anything stored or sent without a name reads "Tanpa judul" (task / project / page) in
//     Indonesian, never the stored English word (web docTitle + "Untitled task/project", QA S-29 / B31).
// See also ProjectAccess.swift (access levels) and FailureText.swift (failure wording + toast).
// ─────────────────────────────────────────────────────────────────────────────

enum UntitledText {
    private static func isBlank(_ s: String?) -> Bool {
        let v = (s ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return v.isEmpty || v == "Untitled"
    }
    /// A task's title for display.
    static func task(_ title: String?) -> String {
        let v = (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return isBlank(v) || v == "Untitled task" ? T("Untitled task") : v
    }
    /// A project's name for display.
    static func project(_ name: String?) -> String {
        let v = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return isBlank(v) || v == "Untitled project" ? T("Untitled project") : v
    }
    /// A title as wrapped text: a spaced dash sticks to the word AFTER it (a word joiner and a no-break space
    /// behind it), as the web does since run 17. A line may start with "– Cymenggs" but never ends on a dash,
    /// so a two-line clamp never reads "Clippers –…" (it replaces the run 16 "dash with the word before" rule,
    /// R16-B-11 / iPad R17-I-12).
    static func wrapped(_ title: String) -> String {
        title.replacingOccurrences(of: " – ", with: " –\u{2060}\u{00A0}")
            .replacingOccurrences(of: " — ", with: " —\u{2060}\u{00A0}")
            .replacingOccurrences(of: " - ", with: " -\u{2060}\u{00A0}")
    }
    /// Anything else (a page, an event): "Untitled" / "Tanpa judul".
    static func any(_ title: String?) -> String {
        isBlank(title) ? T("Untitled") : (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
