import Foundation

/// Indonesian strings for the 20 Oct 2026 round (R-20 Pipeline presentation mode, and the QA fixes of the
/// 19 Oct device-review rounds). Keys must not appear in any other Localization*.swift (scripts/check-localization.sh).
extension AppLanguage {
    static let indonesianQARev20Oct: [String: String] = [
        // R-20 Pipeline presentation mode (same words as the web's id-pipeline.ts)
        "Presentation mode": "Mode Presentasi",
        "Amounts are hidden. Tap to show them.": "Semua nominal disembunyikan. Ketuk untuk menampilkannya.",
        "Hides every amount on screen": "Menyembunyikan semua nominal di layar",
        "hidden in presentation mode": "disembunyikan di Mode Presentasi",
    ]
}
