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
    /// Any spaced dash counts (decision 4 of run 18): "-", "–" or "—" with any whitespace around it, a no-break
    /// space or several spaces included. "PATS ARCHIVE -  INVOICE" kept a plain space after the glue and still
    /// ended a line on its dash (UI tour run 18, R18-M-10).
    static func wrapped(_ title: String) -> String {
        title.replacingOccurrences(of: "[\\s\u{00A0}]+([-–—])[\\s\u{00A0}]+", with: " $1\u{2060}\u{00A0}",
                                   options: .regularExpression)
    }
    /// The largest Inter size, from `base` down to `minimum` in half points, at which the title's longest word
    /// fits `room`: a narrow name column wraps between words and never breaks one ("REIMBURS / E", Q-1).
    static func fittingSize(_ title: String, room: CGFloat, base: CGFloat, minimum: CGFloat,
                            weight: UIFont.Weight = .medium) -> CGFloat {
        let words = wrapped(title).split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "\t" })
        var size = base
        while size > minimum {
            let desc = UIFontDescriptor(name: "Inter", size: size)
                .addingAttributes([.traits: [UIFontDescriptor.TraitKey.weight: weight]])
            let font = UIFont(descriptor: desc, size: size)
            let widest = words.map { (String($0) as NSString).size(withAttributes: [.font: font]).width }.max() ?? 0
            // A little slack: the measured width can be a shade under the drawn medium weight.
            if widest * 1.04 <= room { break }
            size -= 0.5
        }
        return size
    }
    /// Anything else (a page, an event): "Untitled" / "Tanpa judul".
    static func any(_ title: String?) -> String {
        isBlank(title) ? T("Untitled") : (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
