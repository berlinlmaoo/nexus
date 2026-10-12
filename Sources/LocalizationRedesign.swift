import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Indonesian for the dev redesign (owner, 12 Oct 2026: the app ships together with the redesigned web).
//
// A second table rather than more lines in Localization.swift: that literal is 3 300 lines long and every
// string added there is one more chance of a duplicate key, which traps at runtime the moment somebody
// picks Bahasa Indonesia (0.1.5). AppLanguage.translate reads Localization.swift first, then this.
//
// The pre-build script in project.yml and scripts/check-localization.sh fail on a key that appears twice
// in either table OR in both. Add new strings here; change an existing translation where it lives.
// ─────────────────────────────────────────────────────────────────────────────

extension AppLanguage {
    static let indonesianRedesign: [String: String] = [
        "“%@” wasn't saved. Check your connection and try again.": "“%@” belum tersimpan. Cek koneksimu lalu coba lagi.",
        // ── marker: entries are appended above this line by tooling; keep it last ──
        "__redesign_end__": "__redesign_end__",
    ]
}
