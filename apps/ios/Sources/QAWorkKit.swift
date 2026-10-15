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
    /// A title as wrapped text: a spaced dash stays with the word before it (a no-break space in front),
    /// so no line ends "Gaji Clippers" over "–Cymenggs" or ends in "–…" (UI tour run 16, R16-B-11,
    /// decision 12; the web does the same).
    static func wrapped(_ title: String) -> String {
        title.replacingOccurrences(of: " – ", with: "\u{00A0}– ")
            .replacingOccurrences(of: " — ", with: "\u{00A0}— ")
            .replacingOccurrences(of: " - ", with: "\u{00A0}- ")
    }
    /// Anything else (a page, an event): "Untitled" / "Tanpa judul".
    static func any(_ title: String?) -> String {
        isBlank(title) ? T("Untitled") : (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
