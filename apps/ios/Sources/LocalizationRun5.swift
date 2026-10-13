import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Indonesian for the UI tour run 5 fixes (14 Oct 2026): the board's linked lanes. Wording from the dev
// web's apps/web/src/lib/i18n (id-views.ts). Keys must not appear in any other Localization*.swift
// (scripts/check-localization.sh).
// ─────────────────────────────────────────────────────────────────────────────

extension AppLanguage {
    static let indonesianRun5: [String: String] = [
        "Linked": "Tertaut",
        "Another project": "Project lain",
    ]
}
